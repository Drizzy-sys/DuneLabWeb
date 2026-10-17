/* Tableau de bord : chiffre d'affaires encaissé, seuil de franchise, relances */

import { emetteurIncomplet, fichierGrilleAImporter, grilleCourante } from "./grille.js";
import { listerDevis } from "./devis.js";
import { SQL_LISTE_FACTURES, abonnementsAFacturer, enrichirFacture } from "./factures.js";
import { anneeDe } from "../../public/admin/js/lib/format.js";

const ALERTE = 0.8; // alerte à 80 % du seuil

/**
 * Encaissements de l'année civile : factures payées moins avoirs remboursés,
 * à la date du paiement. Le seuil de franchise se compare au montant HT.
 */
export async function chiffreAffaires(app, annee) {
  const { results } = await app.db
    .prepare(
      `SELECT serie, montant_paye, montant_ht, montant_ttc FROM factures
       WHERE statut = 'payee' AND date_paiement LIKE ?`
    )
    .bind(`${annee}-%`)
    .all();
  let ttc = 0;
  let ht = 0;
  for (const f of results) {
    const signe = f.serie === "A" ? -1 : 1;
    // Part HT d'un paiement (égale au paiement en franchise de TVA)
    const partHt = f.montant_ttc > 0 ? Math.round((f.montant_paye * f.montant_ht) / f.montant_ttc) : f.montant_paye;
    ttc += signe * f.montant_paye;
    ht += signe * partHt;
  }
  return { encaisse_ttc: ttc, encaisse_ht: ht };
}

export function niveauSeuil(encaisseHt, seuilCentimes) {
  if (encaisseHt >= seuilCentimes) return "depasse";
  if (encaisseHt >= seuilCentimes * ALERTE) return "alerte";
  return "normal";
}

export async function tableauDeBord(app, annee = anneeDe(app.aujourdhui)) {
  // La grille d'abord (elle peut être créée au premier appel), puis le reste en parallèle
  const grille = await grilleCourante(app);
  const [ca, devis, { results }, { results: annees }, abonnements, fichierAImporter] = await Promise.all([
    chiffreAffaires(app, annee),
    listerDevis(app),
    app.db.prepare(`${SQL_LISTE_FACTURES} WHERE f.serie = 'F' AND f.statut = 'emise' ORDER BY f.date_echeance, f.numero`).all(),
    app.db
      .prepare(
        `SELECT DISTINCT substr(date_emission, 1, 4) AS annee FROM factures WHERE date_emission IS NOT NULL
         UNION SELECT DISTINCT substr(date_paiement, 1, 4) FROM factures WHERE date_paiement IS NOT NULL`
      )
      .all(),
    abonnementsAFacturer(app),
    fichierGrilleAImporter(app),
  ]);
  const franchise = grille.contenu.tva.regime === "franchise_en_base";
  const seuil = Math.round(grille.contenu.tva.seuil_franchise * 100);
  const aEncaisser = results.map((f) => enrichirFacture(f, app.aujourdhui)).filter((f) => f.reste_du > 0);

  return {
    annee,
    annees: [...new Set([anneeDe(app.aujourdhui), ...annees.map((a) => Number(a.annee))])].sort((a, b) => b - a),
    ...ca,
    franchise: franchise
      ? { seuil, taux_alerte: ALERTE, niveau: niveauSeuil(ca.encaisse_ht, seuil), part: seuil ? ca.encaisse_ht / seuil : 0 }
      : null,
    devis_en_attente: devis.filter((d) => d.statut_affiche === "envoye"),
    devis_expires: devis.filter((d) => d.statut_affiche === "expire"),
    brouillons_devis: devis.filter((d) => d.statut === "brouillon").length,
    factures_en_retard: aEncaisser.filter((f) => f.statut_affiche === "en_retard"),
    factures_impayees: aEncaisser.filter((f) => f.statut_affiche === "emise"),
    abonnements_a_facturer: abonnements,
    emetteur_incomplet: emetteurIncomplet(grille.contenu),
    grille_fichier_a_importer: fichierAImporter,
  };
}
