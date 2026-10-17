/* ==========================================================================
   Devis
   --------------------------------------------------------------------------
   brouillon → envoyé → accepté / refusé ; « expiré » est calculé (envoyé et
   date de validité dépassée). Le devis est numéroté dès sa création. À
   l'envoi, son contenu est figé et son PDF archivé dans R2 : pour le
   modifier ensuite, on le duplique.
   ========================================================================== */

import { ErreurMetier, introuvable } from "./http.js";
import * as v from "./validation.js";
import { lireClient } from "./clients.js";
import { construireContexte, emetteurIncomplet, grilleCourante } from "./grille.js";
import { SQL_NUMERO, batchNouveauDevis } from "./numerotation.js";
import { archiverPdf, clePdf, lirePdfArchive } from "./archives.js";
import { genererPdf, vueDevis, vueSynthese } from "./pdf.js";
// Les colonnes montant_* d'un devis sont celles du forfait, sans les abonnements
import { calculerDevis, calculerEcheancier } from "../../public/admin/js/lib/calcul.js";
// Dépendance circulaire sans risque : fonctions appelées seulement à l'exécution
import { SQL_LISTE_FACTURES, devisLivre, enrichirFacture, suiviAbonnements } from "./factures.js";
import { ajouterJours, anneeDe } from "../../public/admin/js/lib/format.js";

const MODES = ["forfait", "regie", "abonnement"];

export function decoderDevis(ligne) {
  return {
    ...ligne,
    lignes: JSON.parse(ligne.lignes),
    remise: ligne.remise ? JSON.parse(ligne.remise) : null,
    contexte: JSON.parse(ligne.contexte),
    cadrage: { types: [], questions: [], ...JSON.parse(ligne.cadrage || "{}") },
  };
}

export function statutDevis(devis, aujourdhui) {
  if (devis.statut === "envoye" && ajouterJours(devis.date_devis, devis.validite_jours) < aujourdhui) return "expire";
  return devis.statut;
}

function validerDevis(donnees) {
  if (!MODES.includes(donnees?.mode)) throw new ErreurMetier("Mode de facturation invalide.", 422);
  return {
    client_id: v.identifiant(donnees.client_id, "Client"),
    objet: v.texte(donnees.objet, "Objet", 300),
    mode: donnees.mode,
    delai_execution: v.texte(donnees.delai_execution, "Délai d'exécution", 300),
    lignes: v.lignes(donnees.lignes ?? []),
    remise: v.remise(donnees.remise),
    notes: v.texte(donnees.notes, "Notes internes", 5000, { multiligne: true }),
    cadrage: v.cadrage(donnees.cadrage),
  };
}

// Contexte (grille et client actuels) et montants d'un devis en préparation
async function preparer(app, champs) {
  const client = await lireClient(app, champs.client_id);
  const grille = await grilleCourante(app);
  const contexte = construireContexte(grille.contenu, grille.id, client);
  const calcul = calculerDevis({ lignes: champs.lignes, remise: champs.remise, taux_tva: contexte.tva.taux });
  return { grille, contexte, calcul };
}

async function ligneDevis(app, id) {
  const ligne = await app.db.prepare("SELECT * FROM devis WHERE id = ?").bind(id).first();
  if (!ligne) throw introuvable("Devis");
  return decoderDevis(ligne);
}

export async function listerDevis(app) {
  const { results } = await app.db
    .prepare(
      `SELECT d.id, d.numero, d.statut, d.objet, d.date_devis, d.validite_jours, d.mode, d.lignes, d.taux_tva,
         d.montant_ht, d.montant_ttc, d.client_id, c.nom AS client_nom,
         (SELECT COUNT(*) FROM factures f WHERE f.devis_id = d.id) AS nb_factures
       FROM devis d JOIN clients c ON c.id = d.client_id
       ORDER BY d.id DESC`
    )
    .all();
  return results.map(({ lignes, ...d }) => ({
    ...d,
    // Abonnements, affichés à côté du montant du forfait (« + 29,00 € HT/mois »)
    abonnement: calculerDevis({ lignes: JSON.parse(lignes), remise: null, taux_tva: d.taux_tva }).recurrent.periodes,
    date_fin_validite: ajouterJours(d.date_devis, d.validite_jours),
    statut_affiche: statutDevis(d, app.aujourdhui),
  }));
}

/** Devis complet : montants, échéancier et factures déjà créées */
export async function lireDevis(app, id) {
  const devis = await ligneDevis(app, id);
  const client = await app.db.prepare("SELECT nom FROM clients WHERE id = ?").bind(devis.client_id).first();
  // Factures du devis avec leur statut réel (dont « annulée par avoir »), et livraison
  const [{ results }, suivi] = await Promise.all([
    app.db.prepare(`${SQL_LISTE_FACTURES} WHERE f.devis_id = ? AND f.serie = 'F' ORDER BY f.id`).bind(id).all(),
    suiviAbonnements(app, id),
  ]);
  const factures = results.map((f) => enrichirFacture(f, app.aujourdhui));
  const calcul = calculerDevis({ lignes: devis.lignes, remise: devis.remise, taux_tva: devis.taux_tva });
  return {
    ...devis,
    client_nom: client?.nom ?? "",
    statut_affiche: statutDevis(devis, app.aujourdhui),
    date_fin_validite: ajouterJours(devis.date_devis, devis.validite_jours),
    calcul,
    // Échéancier du forfait seul : les abonnements se facturent à part
    echeancier: devis.mode === "forfait" && calcul.lignes.length ? calculerEcheancier(calcul.total_ht, calcul.taux_tva, devis.contexte.conditions.echeancier) : null,
    factures,
    livre: devisLivre(devis, suivi),
  };
}

export async function creerDevis(app, donnees) {
  const champs = validerDevis(donnees);
  const { contexte, calcul } = await preparer(app, champs);
  const [, insertion] = await app.db.batch(
    batchNouveauDevis(
      app.db,
      anneeDe(app.aujourdhui),
      `INSERT INTO devis (numero, client_id, objet, date_devis, validite_jours, mode, delai_execution,
         lignes, remise, taux_tva, montant_ht, montant_tva, montant_ttc, contexte, notes, cadrage)
       VALUES (${SQL_NUMERO}, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
       RETURNING id`,
      [
        champs.client_id,
        champs.objet,
        app.aujourdhui,
        contexte.conditions.validite_devis_jours,
        champs.mode,
        champs.delai_execution,
        JSON.stringify(champs.lignes),
        champs.remise ? JSON.stringify(champs.remise) : null,
        contexte.tva.taux,
        calcul.montant_ht,
        calcul.montant_tva,
        calcul.montant_ttc,
        JSON.stringify(contexte),
        champs.notes,
        JSON.stringify(champs.cadrage),
      ]
    )
  );
  return lireDevis(app, insertion.results[0].id);
}

export async function modifierDevis(app, id, donnees) {
  const devis = await ligneDevis(app, id);
  if (devis.statut !== "brouillon") {
    throw new ErreurMetier("Ce devis a été envoyé : il ne peut plus être modifié. Dupliquez-le pour en faire une nouvelle version.");
  }
  const champs = validerDevis(donnees);
  const { contexte, calcul } = await preparer(app, champs);
  await app.db
    .prepare(
      `UPDATE devis SET client_id = ?, objet = ?, mode = ?, delai_execution = ?, lignes = ?, remise = ?,
         validite_jours = ?, taux_tva = ?, montant_ht = ?, montant_tva = ?, montant_ttc = ?, contexte = ?, notes = ?, cadrage = ?,
         modifie_le = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? AND statut = 'brouillon'`
    )
    .bind(
      champs.client_id,
      champs.objet,
      champs.mode,
      champs.delai_execution,
      JSON.stringify(champs.lignes),
      champs.remise ? JSON.stringify(champs.remise) : null,
      contexte.conditions.validite_devis_jours,
      contexte.tva.taux,
      calcul.montant_ht,
      calcul.montant_tva,
      calcul.montant_ttc,
      JSON.stringify(contexte),
      champs.notes,
      JSON.stringify(champs.cadrage),
      id
    )
    .run();
  return lireDevis(app, id);
}

/**
 * Notes internes et cadrage : jamais imprimés sur le PDF, donc modifiables
 * à tout moment, même une fois le devis envoyé ou accepté.
 */
export async function modifierSuiviDevis(app, id, donnees) {
  await ligneDevis(app, id);
  await app.db
    .prepare(
      `UPDATE devis SET notes = ?, cadrage = ?, modifie_le = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
    )
    .bind(
      v.texte(donnees?.notes, "Notes internes", 5000, { multiligne: true }),
      JSON.stringify(v.cadrage(donnees?.cadrage)),
      id
    )
    .run();
  return lireDevis(app, id);
}

/** Seul un brouillon peut être supprimé (son numéro n'est pas réattribué) */
export async function supprimerDevis(app, id) {
  const devis = await ligneDevis(app, id);
  if (devis.statut !== "brouillon") throw new ErreurMetier("Seul un devis brouillon peut être supprimé.");
  await app.db.prepare("DELETE FROM devis WHERE id = ? AND statut = 'brouillon'").bind(id).run();
}

/** Nouveau brouillon avec le même client, les mêmes lignes et les mêmes prix */
export async function dupliquerDevis(app, id) {
  const devis = await ligneDevis(app, id);
  return creerDevis(app, {
    client_id: devis.client_id,
    objet: devis.objet,
    mode: devis.mode,
    delai_execution: devis.delai_execution,
    lignes: devis.lignes,
    remise: devis.remise,
    notes: devis.notes,
    cadrage: devis.cadrage,
  });
}

/** Fige le devis à la date du jour et archive son PDF */
export async function envoyerDevis(app, id) {
  const devis = await ligneDevis(app, id);
  if (devis.statut !== "brouillon") throw new ErreurMetier("Ce devis a déjà été envoyé.");
  if (devis.lignes.length === 0) throw new ErreurMetier("Ajoutez au moins une prestation avant d'envoyer le devis.", 422);
  const { grille, contexte, calcul } = await preparer(app, devis);
  const manquants = emetteurIncomplet(grille.contenu);
  if (manquants.length) {
    throw new ErreurMetier(`Complétez d'abord vos informations (page Grille tarifaire, Émetteur) : ${manquants.join(", ")}.`, 422);
  }
  const resultat = await app.db
    .prepare(
      `UPDATE devis SET statut = 'envoye', date_devis = ?1, date_envoi = ?1, validite_jours = ?2, taux_tva = ?3,
         montant_ht = ?4, montant_tva = ?5, montant_ttc = ?6, contexte = ?7,
         modifie_le = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ?8 AND statut = 'brouillon'`
    )
    .bind(
      app.aujourdhui,
      contexte.conditions.validite_devis_jours,
      contexte.tva.taux,
      calcul.montant_ht,
      calcul.montant_tva,
      calcul.montant_ttc,
      JSON.stringify(contexte),
      id
    )
    .run();
  if (resultat.meta.changes !== 1) throw new ErreurMetier("Ce devis a déjà été envoyé.");
  // Archivage du PDF : en cas d'échec, le devis reste envoyé et le PDF sera
  // archivé à sa première ouverture
  let avertissement = null;
  try {
    await archiverDevis(app, id);
  } catch (erreur) {
    console.error(`Archivage du PDF du devis ${id} impossible :`, erreur);
    avertissement = "Devis envoyé, mais son PDF n'a pas pu être archivé : il le sera à sa première ouverture.";
  }
  return { ...(await lireDevis(app, id)), avertissement };
}

async function archiverDevis(app, id) {
  const devis = await ligneDevis(app, id);
  if (devis.pdf_cle) return devis;
  const { octets } = await genererPdf(vueDevis(devis), await app.polices());
  const { cle, sha256 } = await archiverPdf(app.r2, clePdf("devis", devis.numero), octets);
  await app.db.prepare("UPDATE devis SET pdf_cle = ?, pdf_sha256 = ? WHERE id = ? AND pdf_cle IS NULL").bind(cle, sha256, id).run();
  return { ...devis, pdf_cle: cle };
}

/**
 * accepte / refuse : réponse du client à un devis envoyé (même expiré).
 * envoye : annule une réponse saisie par erreur, tant qu'aucune facture n'existe.
 */
export async function changerStatutDevis(app, id, statut) {
  const devis = await lireDevis(app, id);
  if (statut === "accepte" || statut === "refuse") {
    if (!["envoye", "accepte", "refuse"].includes(devis.statut)) throw new ErreurMetier("Envoyez d'abord le devis.");
    if (devis.factures.length && statut === "refuse") throw new ErreurMetier("Des factures existent pour ce devis.");
  } else if (statut === "envoye") {
    if (devis.statut === "brouillon") throw new ErreurMetier("Utilisez « Marquer comme envoyé ».");
    if (devis.factures.length) throw new ErreurMetier("Des factures existent pour ce devis : sa réponse ne peut plus être annulée.");
  } else {
    throw new ErreurMetier("Statut inconnu.", 422);
  }
  await app.db
    .prepare(
      `UPDATE devis SET statut = ?, date_reponse = ?, modifie_le = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? AND statut <> 'brouillon'`
    )
    .bind(statut, statut === "envoye" ? null : app.aujourdhui, id)
    .run();
  return lireDevis(app, id);
}

/** PDF : aperçu calculé pour un brouillon, copie archivée sinon */
export async function pdfDevis(app, id) {
  let devis = await ligneDevis(app, id);
  if (devis.statut === "brouillon") {
    const { contexte } = await preparer(app, devis);
    const apercu = { ...devis, date_devis: app.aujourdhui, taux_tva: contexte.tva.taux, contexte };
    const { octets } = await genererPdf(vueDevis(apercu), await app.polices());
    return { octets, nom: `${devis.numero}-brouillon.pdf` };
  }
  if (!devis.pdf_cle) devis = await archiverDevis(app, id);
  const octets = await lirePdfArchive(app.r2, devis.pdf_cle);
  if (!octets) throw new ErreurMetier("PDF archivé introuvable dans R2.", 500);
  return { octets, nom: `${devis.numero}.pdf` };
}

/**
 * Synthèse du projet en PDF (prestations retenues, cadrage, points à préciser),
 * générée à la demande à partir du devis : à partager pour validation, ou pour
 * soi avec les notes internes (avecNotes).
 */
export async function syntheseDevis(app, id, { avecNotes = false } = {}) {
  const devis = await ligneDevis(app, id);
  const grille = await grilleCourante(app);
  const { octets } = await genererPdf(vueSynthese(devis, grille.contenu, { avecNotes, aujourdhui: app.aujourdhui }), await app.polices());
  return { octets, nom: `synthese-${devis.numero}${avecNotes ? "-interne" : ""}.pdf` };
}
