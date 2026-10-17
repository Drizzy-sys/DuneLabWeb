/* ==========================================================================
   Factures (série F) et avoirs (série A)
   --------------------------------------------------------------------------
   brouillon (sans numéro, modifiable, supprimable)
     → émise : numéro attribué, contenu figé, PDF archivé dans R2.
       Plus aucune modification ni suppression (contrôlé ici ET par les
       triggers SQL) : on corrige par un avoir.
     → payée (date et montant), annulable en cas d'erreur de saisie.
   « En retard » et « annulée par avoir » sont calculés.
   ========================================================================== */

import { ErreurMetier, introuvable } from "./http.js";
import * as v from "./validation.js";
import { lireClient } from "./clients.js";
import { construireContexte, emetteurIncomplet, grilleCourante } from "./grille.js";
import { attribuerNumeroFacture } from "./numerotation.js";
import { archiverPdf, clePdf, empreinteSha256, lirePdfArchive } from "./archives.js";
import { genererPdf, vueFacture } from "./pdf.js";
import { decoderDevis } from "./devis.js";
import { calculerDevis, calculerDocument, calculerEcheancier } from "../../public/admin/js/lib/calcul.js";
import { PERIODES, periodeDeLigne, estLigneRecurrente } from "../../public/admin/js/lib/abonnement.js";
import { ajouterJours, ajouterMois, anneeDe, formaterDate, formaterMontant, formaterPourcentage } from "../../public/admin/js/lib/format.js";

export function decoderFacture(ligne) {
  return {
    ...ligne,
    lignes: JSON.parse(ligne.lignes),
    remise: ligne.remise ? JSON.parse(ligne.remise) : null,
    deductions: JSON.parse(ligne.deductions),
    contexte: JSON.parse(ligne.contexte),
    transmission: ligne.transmission ? JSON.parse(ligne.transmission) : null,
  };
}

export function statutFacture(f, aujourdhui) {
  if (f.statut === "brouillon") return "brouillon";
  if (f.serie === "A") return f.statut === "payee" ? "rembourse" : "emis";
  if (f.statut === "payee") return "payee";
  if (f.avoirs_ttc >= f.montant_ttc) return "annulee";
  if (f.date_echeance && f.date_echeance < aujourdhui) return "en_retard";
  return "emise";
}

// Liste avec client, devis, facture d'origine et total des avoirs émis
export const SQL_LISTE_FACTURES = `
  SELECT f.id, f.serie, f.numero, f.type, f.statut, f.client_id, c.nom AS client_nom, c.siren AS client_siren,
    f.devis_id, d.numero AS devis_numero, f.facture_origine_id, o.numero AS origine_numero,
    f.periodicite, f.objet, f.date_emission, f.prestation_debut, f.prestation_fin, f.date_echeance,
    f.montant_ht, f.montant_tva, f.montant_ttc, f.date_paiement, f.montant_paye, f.pdf_cle, f.pdf_sha256,
    COALESCE((SELECT SUM(a.montant_ttc) FROM factures a
              WHERE a.facture_origine_id = f.id AND a.statut <> 'brouillon'), 0) AS avoirs_ttc
  FROM factures f
  JOIN clients c ON c.id = f.client_id
  LEFT JOIN devis d ON d.id = f.devis_id
  LEFT JOIN factures o ON o.id = f.facture_origine_id`;

export function enrichirFacture(f, aujourdhui) {
  return {
    ...f,
    statut_affiche: statutFacture(f, aujourdhui),
    reste_du: f.serie === "F" && f.statut === "emise" ? Math.max(0, f.montant_ttc - f.avoirs_ttc) : 0,
  };
}

async function ligneFacture(app, id) {
  const ligne = await app.db.prepare("SELECT * FROM factures WHERE id = ?").bind(id).first();
  if (!ligne) throw introuvable("Facture");
  return decoderFacture(ligne);
}

export async function listerFactures(app, { annee } = {}) {
  const filtre = annee ? "WHERE f.statut = 'brouillon' OR f.date_emission LIKE ?" : "";
  const requete = app.db.prepare(
    `${SQL_LISTE_FACTURES} ${filtre} ORDER BY (f.statut = 'brouillon') DESC, f.date_emission DESC, f.numero DESC, f.id DESC`
  );
  const { results } = await (annee ? requete.bind(`${annee}-%`) : requete).all();
  return results.map((f) => enrichirFacture(f, app.aujourdhui));
}

export async function lireFacture(app, id) {
  const f = await ligneFacture(app, id);
  const resume = await app.db.prepare(`${SQL_LISTE_FACTURES} WHERE f.id = ?`).bind(id).first();
  const { results: avoirs } = await app.db
    .prepare("SELECT id, numero, statut, date_emission, montant_ht, montant_ttc FROM factures WHERE facture_origine_id = ? ORDER BY id")
    .bind(id)
    .all();
  const calcul = calculerDocument({ lignes: f.lignes, remise: f.remise, taux_tva: f.taux_tva, deductions: f.deductions });
  return { ...enrichirFacture({ ...resume, ...f }, app.aujourdhui), calcul, avoirs };
}

/* ---------- Création et modification des brouillons ---------- */

function validerFacture(donnees) {
  const champs = {
    client_id: v.identifiant(donnees?.client_id, "Client"),
    objet: v.texte(donnees.objet, "Objet", 300),
    prestation_debut: v.date(donnees.prestation_debut, "Date de prestation"),
    prestation_fin: v.date(donnees.prestation_fin, "Fin de la période"),
    lignes: v.lignes(donnees.lignes ?? []),
    remise: v.remise(donnees.remise),
    notes: v.texte(donnees.notes, "Notes internes", 5000, { multiligne: true }),
  };
  if (champs.prestation_fin && !champs.prestation_debut) {
    throw new ErreurMetier("Indiquez le début de la période de prestation.", 422);
  }
  if (champs.prestation_fin && champs.prestation_fin < champs.prestation_debut) {
    throw new ErreurMetier("La fin de la période précède son début.", 422);
  }
  return champs;
}

// Contexte actuel ; un avoir reprend la TVA de la facture qu'il corrige
async function contexteActuel(app, clientId, origine = null) {
  const grille = await grilleCourante(app);
  const contexte = construireContexte(grille.contenu, grille.id, await lireClient(app, clientId));
  if (origine) contexte.tva = { ...origine.contexte.tva };
  return { grille, contexte };
}

async function insererBrouillon(app, f) {
  const { contexte } = await contexteActuel(app, f.client_id, f.origine);
  const calcul = calculerDocument({ lignes: f.lignes, remise: f.remise, taux_tva: contexte.tva.taux, deductions: f.deductions || [] });
  const ligne = await app.db
    .prepare(
      `INSERT INTO factures (serie, type, client_id, devis_id, etape, periodicite, facture_origine_id, objet,
         prestation_debut, prestation_fin, lignes, remise, deductions, taux_tva,
         montant_ht, montant_tva, montant_ttc, contexte, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .bind(
      f.type === "avoir" ? "A" : "F",
      f.type,
      f.client_id,
      f.devis_id ?? null,
      f.etape ?? null,
      f.periodicite ?? null,
      f.origine?.id ?? null,
      f.objet ?? "",
      f.prestation_debut ?? null,
      f.prestation_fin ?? null,
      JSON.stringify(f.lignes),
      f.remise ? JSON.stringify(f.remise) : null,
      JSON.stringify(f.deductions || []),
      contexte.tva.taux,
      calcul.montant_ht,
      calcul.montant_tva,
      calcul.montant_ttc,
      JSON.stringify(contexte),
      f.notes ?? ""
    )
    .first();
  return lireFacture(app, ligne.id);
}

/** Facture directe : abonnement mensuel, régie au temps passé, prestation ponctuelle */
export async function creerFacture(app, donnees) {
  return insererBrouillon(app, { type: "standard", ...validerFacture(donnees) });
}

export async function modifierFacture(app, id, donnees) {
  const f = await ligneFacture(app, id);
  if (f.statut !== "brouillon") throw new ErreurMetier("Facture émise : modification interdite. Corrigez-la par un avoir.");
  const champs = validerFacture({ ...donnees, client_id: f.type === "standard" ? donnees?.client_id : f.client_id });
  const origine = f.facture_origine_id ? await ligneFacture(app, f.facture_origine_id) : null;
  const { contexte } = await contexteActuel(app, champs.client_id, origine);
  const deductions = f.type === "solde" ? await deductionsDuDevis(app, f.devis_id) : [];
  const calcul = calculerDocument({ lignes: champs.lignes, remise: champs.remise, taux_tva: contexte.tva.taux, deductions });
  await app.db
    .prepare(
      `UPDATE factures SET client_id = ?, objet = ?, prestation_debut = ?, prestation_fin = ?, lignes = ?, remise = ?,
         deductions = ?, taux_tva = ?, montant_ht = ?, montant_tva = ?, montant_ttc = ?, contexte = ?, notes = ?,
         modifie_le = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? AND statut = 'brouillon'`
    )
    .bind(
      champs.client_id,
      champs.objet,
      champs.prestation_debut,
      champs.prestation_fin,
      JSON.stringify(champs.lignes),
      champs.remise ? JSON.stringify(champs.remise) : null,
      JSON.stringify(deductions),
      contexte.tva.taux,
      calcul.montant_ht,
      calcul.montant_tva,
      calcul.montant_ttc,
      JSON.stringify(contexte),
      champs.notes,
      id
    )
    .run();
  return lireFacture(app, id);
}

/** Seul un brouillon (sans numéro) peut être supprimé */
export async function supprimerFacture(app, id) {
  const f = await ligneFacture(app, id);
  if (f.statut !== "brouillon") throw new ErreurMetier("Facture émise : suppression interdite. Corrigez-la par un avoir.");
  await app.db.prepare("DELETE FROM factures WHERE id = ? AND statut = 'brouillon'").bind(id).run();
}

/** Nouveau brouillon reprenant client, objet et lignes (facture mensuelle suivante) */
export async function dupliquerFacture(app, id) {
  const f = await ligneFacture(app, id);
  if (f.serie === "A") throw new ErreurMetier("Un avoir ne se duplique pas.");
  return insererBrouillon(app, {
    type: "standard",
    client_id: f.client_id,
    objet: f.objet,
    lignes: f.lignes,
    remise: f.remise,
  });
}

/* ---------- Factures issues d'un devis accepté ---------- */

// Acomptes et factures intermédiaires émis pour un devis, nets de leurs avoirs
async function deductionsDuDevis(app, devisId) {
  const { results } = await app.db
    .prepare(
      `SELECT f.id, f.numero, f.date_emission, f.montant_ht, f.montant_tva, f.montant_ttc,
         COALESCE((SELECT SUM(a.montant_ht) FROM factures a WHERE a.facture_origine_id = f.id AND a.statut <> 'brouillon'), 0) AS avoirs_ht,
         COALESCE((SELECT SUM(a.montant_tva) FROM factures a WHERE a.facture_origine_id = f.id AND a.statut <> 'brouillon'), 0) AS avoirs_tva
       FROM factures f
       WHERE f.devis_id = ? AND f.serie = 'F' AND f.type IN ('acompte', 'intermediaire') AND f.statut <> 'brouillon'
       ORDER BY f.date_emission, f.id`
    )
    .bind(devisId)
    .all();
  return results
    .map((f) => {
      const montant_ht = f.montant_ht - f.avoirs_ht;
      const montant_tva = f.montant_tva - f.avoirs_tva;
      return { facture_id: f.id, numero: f.numero, date_emission: f.date_emission, montant_ht, montant_tva, montant_ttc: montant_ht + montant_tva };
    })
    .filter((d) => d.montant_ttc > 0);
}

/**
 * Crée le brouillon de facture d'une étape de l'échéancier (forfait),
 * ou la facture du devis entier (régie, abonnement : rang null).
 */
export async function creerFactureDepuisDevis(app, devisId, rang) {
  const ligne = await app.db.prepare("SELECT * FROM devis WHERE id = ?").bind(devisId).first();
  if (!ligne) throw introuvable("Devis");
  const devis = decoderDevis(ligne);
  if (devis.statut !== "accepte") throw new ErreurMetier("Seul un devis accepté peut être facturé.");

  // Forfait seul : les abonnements se facturent à part (creerFactureAbonnement)
  const calculDevis = calculerDevis({ lignes: devis.lignes, remise: devis.remise, taux_tva: devis.taux_tva });
  const lignesForfait = devis.lignes.filter((l) => !estLigneRecurrente(l));
  if (!lignesForfait.length) {
    throw new ErreurMetier("Ce devis ne contient que des abonnements : utilisez « Facturer l'abonnement ».", 422);
  }
  let etape = null;
  if (devis.mode === "forfait") {
    const echeancier = calculerEcheancier(calculDevis.total_ht, calculDevis.taux_tva, devis.contexte.conditions.echeancier);
    etape = echeancier[rang];
    if (!etape) throw new ErreurMetier("Étape d'échéancier inconnue.", 422);
  } else if (rang !== null && rang !== undefined) {
    throw new ErreurMetier("Ce devis n'a pas d'échéancier.", 422);
  }

  const { results: existantes } = await app.db
    .prepare(
      `${SQL_LISTE_FACTURES} WHERE f.devis_id = ? AND f.serie = 'F' AND f.etape IS ? AND f.periodicite IS NULL`
    )
    .bind(devisId, etape ? etape.rang : null)
    .all();
  for (const f of existantes.map((e) => enrichirFacture(e, app.aujourdhui))) {
    if (f.statut === "brouillon") throw new ErreurMetier("Un brouillon existe déjà pour cette étape.", 409, { facture_id: f.id });
    if (f.statut_affiche !== "annulee" && devis.mode === "forfait") {
      throw new ErreurMetier(`Cette étape est déjà facturée (${f.numero}).`, 409, { facture_id: f.id });
    }
  }

  const base = {
    client_id: devis.client_id,
    devis_id: devis.id,
    objet: devis.objet,
    etape: etape ? etape.rang : null,
  };
  if (!etape) {
    return insererBrouillon(app, { ...base, type: "standard", lignes: lignesForfait, remise: devis.remise });
  }
  if (etape.type === "solde") {
    return insererBrouillon(app, {
      ...base,
      type: "solde",
      lignes: lignesForfait,
      remise: devis.remise,
      deductions: await deductionsDuDevis(app, devis.id),
    });
  }
  const intitule = { acompte: "Acompte", intermediaire: "Échéance intermédiaire" }[etape.type];
  return insererBrouillon(app, {
    ...base,
    type: etape.type,
    lignes: [
      {
        ref: null,
        designation: `${intitule} de ${formaterPourcentage(etape.pourcentage)} : ${etape.etape}`,
        description: `Devis ${devis.numero} du ${formaterDate(devis.date_devis)}, total ${formaterMontant(calculDevis.total_ht)} HT${devis.objet ? `. ${devis.objet}` : ""}`,
        unite: "forfait",
        quantite: 1,
        prix_unitaire: etape.montant_ht,
        pourcentage: null,
      },
    ],
  });
}

/* ---------- Abonnements issus d'un devis ---------- */

// Livraison : date de prestation de la facture de solde émise, sinon aujourd'hui
async function dateDeLivraison(app, devisId) {
  const solde = await app.db
    .prepare("SELECT prestation_debut FROM factures WHERE devis_id = ? AND type = 'solde' AND statut <> 'brouillon' ORDER BY id DESC LIMIT 1")
    .bind(devisId)
    .first();
  return solde?.prestation_debut || app.aujourdhui;
}

/**
 * Brouillon de facture d'abonnement d'un devis accepté, pour une période
 * (« mois » ou « an ») : reprend les lignes de cette périodicité. La première
 * période commence à la livraison, les suivantes s'enchaînent sans trou ni
 * chevauchement. Facture ordinaire : elle compte dans le chiffre d'affaires
 * encaissé et le suivi du seuil de franchise.
 */
export async function creerFactureAbonnement(app, devisId, periodicite) {
  if (!Object.hasOwn(PERIODES, periodicite)) throw new ErreurMetier("Périodicité « mois » ou « an » attendue.", 422);
  const ligne = await app.db.prepare("SELECT * FROM devis WHERE id = ?").bind(devisId).first();
  if (!ligne) throw introuvable("Devis");
  const devis = decoderDevis(ligne);
  if (devis.statut !== "accepte") throw new ErreurMetier("Seul un devis accepté peut être facturé.");
  const lignes = devis.lignes.filter((l) => periodeDeLigne(l) === periodicite);
  if (!lignes.length) throw new ErreurMetier(`Ce devis n'a pas d'abonnement ${periodicite === "mois" ? "mensuel" : "annuel"}.`, 422);

  const { results: precedentes } = await app.db
    .prepare(
      `SELECT id, statut, COALESCE(prestation_fin, prestation_debut, date_emission) AS fin
       FROM factures WHERE devis_id = ? AND periodicite = ? AND serie = 'F'
       ORDER BY fin DESC, id DESC`
    )
    .bind(devisId, periodicite)
    .all();
  const brouillon = precedentes.find((f) => f.statut === "brouillon");
  if (brouillon) throw new ErreurMetier("Un brouillon d'abonnement existe déjà pour ce devis.", 409, { facture_id: brouillon.id });

  const debut = precedentes.length ? ajouterJours(precedentes[0].fin, 1) : await dateDeLivraison(app, devis.id);
  return insererBrouillon(app, {
    type: "standard",
    client_id: devis.client_id,
    devis_id: devis.id,
    periodicite,
    objet: `Abonnement${devis.objet ? ` : ${devis.objet}` : ""}`,
    prestation_debut: debut,
    prestation_fin: ajouterJours(ajouterMois(debut, PERIODES[periodicite]), -1),
    lignes,
  });
}

/**
 * Abonnements dont la période suivante est à facturer : devis accepté avec
 * des lignes « mois » ou « an », livré (ou sans forfait), dont la dernière
 * facture d'abonnement couvre une période terminée.
 */
export async function abonnementsAFacturer(app) {
  const { results } = await app.db
    .prepare(
      `SELECT d.id, d.numero, d.objet, d.lignes, d.taux_tva, c.nom AS client_nom,
         (SELECT COUNT(*) FROM factures s WHERE s.devis_id = d.id AND s.type = 'solde' AND s.statut <> 'brouillon') AS livre
       FROM devis d JOIN clients c ON c.id = d.client_id
       WHERE d.statut = 'accepte'`
    )
    .all();
  const aFacturer = [];
  for (const d of results) {
    const lignes = JSON.parse(d.lignes);
    const forfait = lignes.some((l) => !estLigneRecurrente(l));
    for (const periodicite of Object.keys(PERIODES)) {
      const lignesPeriode = lignes.filter((l) => periodeDeLigne(l) === periodicite);
      if (!lignesPeriode.length) continue;
      const derniere = await app.db
        .prepare(
          `SELECT statut, COALESCE(prestation_fin, prestation_debut, date_emission) AS fin FROM factures
           WHERE devis_id = ? AND periodicite = ? AND serie = 'F' ORDER BY fin DESC, id DESC LIMIT 1`
        )
        .bind(d.id, periodicite)
        .first();
      if (derniere?.statut === "brouillon") continue;
      const du = derniere ? derniere.fin < app.aujourdhui : !forfait || d.livre > 0;
      if (!du) continue;
      const calcul = calculerDocument({ lignes: lignesPeriode, taux_tva: d.taux_tva });
      aFacturer.push({
        devis_id: d.id,
        devis_numero: d.numero,
        client_nom: d.client_nom,
        objet: d.objet,
        periodicite,
        depuis: derniere ? ajouterJours(derniere.fin, 1) : null,
        montant_ht: calcul.montant_ht,
      });
    }
  }
  return aFacturer;
}

/* ---------- Avoirs ---------- */

/** Brouillon d'avoir sur une facture émise (annulation totale par défaut, modifiable) */
export async function creerAvoir(app, factureId) {
  const origine = await lireFacture(app, factureId);
  if (origine.serie !== "F" || origine.statut === "brouillon") {
    throw new ErreurMetier("Un avoir se fait sur une facture émise.");
  }
  if (origine.avoirs.some((a) => a.statut === "brouillon")) {
    throw new ErreurMetier("Un avoir brouillon existe déjà pour cette facture.", 409, { facture_id: origine.avoirs.find((a) => a.statut === "brouillon").id });
  }
  if (origine.montant_ttc - origine.avoirs_ttc <= 0) throw new ErreurMetier("Cette facture est déjà entièrement annulée par avoir.");
  const resteHt = origine.montant_ht - origine.avoirs.filter((a) => a.statut !== "brouillon").reduce((s, a) => s + a.montant_ht, 0);

  // Facture simple sans avoir précédent : on reprend ses lignes ; sinon une ligne du montant restant
  const reprendreLignes = origine.deductions.length === 0 && origine.avoirs_ttc === 0;
  const lignes = reprendreLignes
    ? origine.lignes
    : [
        {
          ref: null,
          designation: `Annulation de la facture ${origine.numero}`,
          description: `Facture du ${formaterDate(origine.date_emission)}`,
          unite: "forfait",
          quantite: 1,
          prix_unitaire: resteHt,
          pourcentage: null,
        },
      ];
  return insererBrouillon(app, {
    type: "avoir",
    client_id: origine.client_id,
    origine,
    objet: `Avoir sur la facture ${origine.numero}`,
    lignes,
    remise: reprendreLignes ? origine.remise : null,
  });
}

/* ---------- Émission ---------- */

export async function emettreFacture(app, id) {
  const f = await ligneFacture(app, id);
  if (f.statut !== "brouillon") throw new ErreurMetier("Cette facture a déjà été émise.");
  if (f.lignes.length === 0) throw new ErreurMetier("Ajoutez au moins une ligne avant d'émettre.", 422);

  const origine = f.facture_origine_id ? await lireFacture(app, f.facture_origine_id) : null;
  const { grille, contexte } = await contexteActuel(app, f.client_id, origine);
  const manquants = emetteurIncomplet(grille.contenu);
  if (manquants.length) {
    throw new ErreurMetier(`Complétez d'abord vos informations (page Grille tarifaire, Émetteur) : ${manquants.join(", ")}.`, 422);
  }

  const deductions = f.type === "solde" ? await deductionsDuDevis(app, f.devis_id) : [];
  const calcul = calculerDocument({ lignes: f.lignes, remise: f.remise, taux_tva: contexte.tva.taux, deductions });
  if (calcul.montant_ttc <= 0) throw new ErreurMetier("Le montant à facturer doit être positif.", 422);
  if (origine && calcul.montant_ttc > origine.montant_ttc - origine.avoirs_ttc) {
    throw new ErreurMetier("Le montant de l'avoir dépasse le montant restant de la facture d'origine.", 422);
  }

  const date_emission = app.aujourdhui;
  const serie = f.serie;
  const derniere = await app.db
    .prepare("SELECT MAX(date_emission) AS d FROM factures WHERE serie = ? AND numero IS NOT NULL")
    .bind(serie)
    .first("d");
  if (derniere && derniere > date_emission) {
    throw new ErreurMetier(`Une ${serie === "A" ? "facture d'avoir" : "facture"} a déjà été émise le ${formaterDate(derniere)} : vérifiez la date du serveur.`);
  }

  const numero = await attribuerNumeroFacture(app.db, {
    id,
    serie,
    annee: anneeDe(date_emission),
    champs: {
      date_emission,
      prestation_debut: f.prestation_debut || date_emission,
      date_echeance: serie === "A" ? null : ajouterJours(date_emission, contexte.conditions.delai_paiement_jours),
      deductions: JSON.stringify(deductions),
      taux_tva: contexte.tva.taux,
      montant_ht: calcul.montant_ht,
      montant_tva: calcul.montant_tva,
      montant_ttc: calcul.montant_ttc,
      contexte: JSON.stringify(contexte),
    },
  });
  if (!numero) throw new ErreurMetier("Cette facture a déjà été émise.");

  // Archivage du PDF : en cas d'échec, la facture reste émise et le PDF sera
  // archivé à la première consultation
  let avertissement = null;
  try {
    await archiverFacture(app, id);
  } catch (erreur) {
    console.error(`Archivage du PDF de ${numero} impossible :`, erreur);
    avertissement = "Facture émise, mais le PDF n'a pas pu être archivé : il le sera à sa première ouverture.";
  }

  // Facturation électronique : transmission à la plateforme agréée, si un connecteur est branché
  if (!avertissement && app.connecteur && app.connecteur.nom !== "aucun") {
    const transmission = await transmettreFacture(app, id);
    if (transmission.statut !== "deposee") {
      avertissement = `Facture émise, mais sa transmission à la plateforme a échoué : ${transmission.message || transmission.statut}. Relancez-la depuis la facture.`;
    }
  }
  return { ...(await lireFacture(app, id)), avertissement };
}

/**
 * Transmet une facture émise à la plateforme agréée (connecteur choisi dans
 * wrangler.jsonc) et enregistre le résultat. Rejouable en cas d'échec.
 */
export async function transmettreFacture(app, id) {
  const f = await ligneFacture(app, id);
  if (f.statut === "brouillon") throw new ErreurMetier("Émettez d'abord la facture.");
  if (!app.connecteur || app.connecteur.nom === "aucun") throw new ErreurMetier("Aucune plateforme de facturation électronique n'est branchée.");
  if (f.transmission?.statut === "deposee") throw new ErreurMetier("Cette facture a déjà été transmise.");
  let resultat;
  try {
    resultat = await app.connecteur.transmettre({ facture: f, pdf: f.pdf_cle ? await lirePdfArchive(app.r2, f.pdf_cle) : null, env: app.env });
  } catch (erreur) {
    console.error(`Transmission de ${f.numero} impossible :`, erreur);
    resultat = { statut: "erreur", message: erreur.message };
  }
  const transmission = {
    connecteur: app.connecteur.nom,
    statut: resultat.statut,
    reference: resultat.reference ?? null,
    message: resultat.message ?? null,
    le: new Date().toISOString(),
  };
  await app.db.prepare("UPDATE factures SET transmission = ? WHERE id = ?").bind(JSON.stringify(transmission), id).run();
  return transmission;
}

async function liensFacture(app, f) {
  const liens = {};
  if (f.devis_id) liens.devis = await app.db.prepare("SELECT numero, date_devis FROM devis WHERE id = ?").bind(f.devis_id).first();
  if (f.facture_origine_id) {
    liens.origine = await app.db.prepare("SELECT numero, date_emission FROM factures WHERE id = ?").bind(f.facture_origine_id).first();
  }
  return liens;
}

async function produirePdf(app, f) {
  const { octets } = await genererPdf(vueFacture(f, await liensFacture(app, f), app.aujourdhui), await app.polices());
  return octets;
}

async function archiverFacture(app, id) {
  const f = await ligneFacture(app, id);
  if (f.statut === "brouillon") throw new ErreurMetier("Un brouillon n'est pas archivé.");
  if (f.pdf_cle) return f;
  const octets = await produirePdf(app, f);
  const { cle, sha256 } = await archiverPdf(app.r2, clePdf(f.serie === "A" ? "avoir" : "facture", f.numero), octets);
  await app.db.prepare("UPDATE factures SET pdf_cle = ?, pdf_sha256 = ? WHERE id = ? AND pdf_cle IS NULL").bind(cle, sha256, id).run();
  return { ...f, pdf_cle: cle, pdf_sha256: sha256 };
}

/** PDF : aperçu pour un brouillon, copie archivée (jamais régénérée) pour une facture émise */
export async function pdfFacture(app, id) {
  let f = await ligneFacture(app, id);
  if (f.statut === "brouillon") {
    const origine = f.facture_origine_id ? await ligneFacture(app, f.facture_origine_id) : null;
    const { contexte } = await contexteActuel(app, f.client_id, origine);
    const deductions = f.type === "solde" ? await deductionsDuDevis(app, f.devis_id) : [];
    const octets = await produirePdf(app, { ...f, contexte, taux_tva: contexte.tva.taux, deductions });
    return { octets, nom: `${f.serie === "A" ? "avoir" : "facture"}-brouillon-${f.id}.pdf` };
  }
  if (!f.pdf_cle) f = await archiverFacture(app, id);
  let octets = await lirePdfArchive(app.r2, f.pdf_cle);
  if (!octets) {
    // Copie absente de R2 : on ne la recrée que si le PDF régénéré est identique, octet pour octet
    const regenere = await produirePdf(app, f);
    if ((await empreinteSha256(regenere)) !== f.pdf_sha256) {
      throw new ErreurMetier("PDF archivé introuvable dans R2, et la version régénérée diffère : vérifiez les sauvegardes.", 500);
    }
    await archiverPdf(app.r2, f.pdf_cle, regenere);
    octets = regenere;
  }
  return { octets, nom: `${f.numero}.pdf` };
}

/* ---------- Paiement ---------- */

/** Facture payée, ou avoir remboursé au client */
export async function enregistrerPaiement(app, id, donnees) {
  const f = await lireFacture(app, id);
  if (f.statut !== "emise") throw new ErreurMetier(f.statut === "payee" ? "Paiement déjà enregistré." : "Émettez d'abord la facture.");
  const date = v.date(donnees?.date_paiement, "Date de paiement", { requis: true });
  if (date > app.aujourdhui) throw new ErreurMetier("La date de paiement est dans le futur.", 422);
  if (date < f.date_emission) throw new ErreurMetier("La date de paiement précède l'émission.", 422);
  const montant = v.montantPositif(donnees.montant, "Montant (en centimes)");
  await app.db
    .prepare(
      `UPDATE factures SET statut = 'payee', date_paiement = ?, montant_paye = ?,
         modifie_le = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? AND statut = 'emise'`
    )
    .bind(date, montant, id)
    .run();
  return lireFacture(app, id);
}

export async function annulerPaiement(app, id) {
  const f = await ligneFacture(app, id);
  if (f.statut !== "payee") throw new ErreurMetier("Aucun paiement enregistré.");
  await app.db
    .prepare(
      `UPDATE factures SET statut = 'emise', date_paiement = NULL, montant_paye = NULL,
         modifie_le = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? AND statut = 'payee'`
    )
    .bind(id)
    .run();
  return lireFacture(app, id);
}

export async function modifierNotes(app, id, notes) {
  await ligneFacture(app, id);
  await app.db
    .prepare("UPDATE factures SET notes = ?, modifie_le = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?")
    .bind(v.texte(notes, "Notes internes", 5000, { multiligne: true }), id)
    .run();
  return lireFacture(app, id);
}
