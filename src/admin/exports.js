/* ==========================================================================
   Exports : CSV des factures (comptabilité) et sauvegarde complète en JSON.
   La même sauvegarde JSON est écrite chaque nuit dans R2 (sauvegarde.js) et
   se restaure avec scripts/restaurer.js.
   ========================================================================== */

import { SQL_LISTE_FACTURES, enrichirFacture } from "./factures.js";
import { formaterDate, formaterMontantCsv } from "../../public/admin/js/lib/format.js";
import { STATUTS_FACTURE, TYPES_FACTURE } from "../../public/admin/js/lib/libelles.js";

// Ordre d'insertion à la restauration (clés étrangères)
export const TABLES = ["clients", "grilles", "compteurs", "devis", "factures"];
export const FORMAT_SAUVEGARDE = "dunelab-admin-sauvegarde";

function celluleCsv(valeur) {
  let texte = String(valeur ?? "");
  // Un texte commençant par = + @ serait exécuté comme une formule par le tableur
  if (/^[=+@\t\r]/.test(texte)) texte = `'${texte}`;
  return /[";\n\r]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

/**
 * Factures et avoirs émis dans l'année, une ligne par document.
 * Point-virgule et virgule décimale : s'ouvre directement dans Excel ou LibreOffice.
 * Les avoirs sont en négatif, pour que les colonnes s'additionnent.
 */
export async function facturesCsv(app, annee) {
  const { results } = await app.db
    .prepare(`${SQL_LISTE_FACTURES} WHERE f.statut <> 'brouillon' AND f.date_emission LIKE ? ORDER BY f.serie DESC, f.numero`)
    .bind(`${annee}-%`)
    .all();
  const entetes = [
    "Numéro", "Type", "Date d'émission", "Début de prestation", "Fin de prestation", "Échéance",
    "Client", "SIREN client", "Total HT", "TVA", "Total TTC", "Statut", "Date de paiement",
    "Montant encaissé", "Devis", "Facture d'origine",
  ];
  const lignes = results.map((brut) => {
    const f = enrichirFacture(brut, app.aujourdhui);
    const signe = f.serie === "A" ? -1 : 1;
    return [
      f.numero,
      TYPES_FACTURE[f.type],
      formaterDate(f.date_emission),
      formaterDate(f.prestation_debut),
      formaterDate(f.prestation_fin),
      formaterDate(f.date_echeance),
      f.client_nom,
      f.client_siren,
      formaterMontantCsv(signe * f.montant_ht),
      formaterMontantCsv(signe * f.montant_tva),
      formaterMontantCsv(signe * f.montant_ttc),
      STATUTS_FACTURE[f.statut_affiche],
      formaterDate(f.date_paiement),
      f.montant_paye !== null ? formaterMontantCsv(signe * f.montant_paye) : "",
      f.devis_numero,
      f.origine_numero,
    ];
  });
  // BOM UTF-8 : Excel reconnaît les accents
  return "﻿" + [entetes, ...lignes].map((l) => l.map(celluleCsv).join(";")).join("\r\n") + "\r\n";
}

/** Toutes les données, table par table */
export async function exporterDonnees(db, maintenant = new Date()) {
  const tables = {};
  for (const table of TABLES) {
    const { results } = await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    tables[table] = results;
  }
  return { format: FORMAT_SAUVEGARDE, version: 1, exporte_le: maintenant.toISOString(), tables };
}
