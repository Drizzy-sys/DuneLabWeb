#!/usr/bin/env node
/* ==========================================================================
   Restauration d'une sauvegarde de l'espace admin
   --------------------------------------------------------------------------
   Transforme une sauvegarde JSON (export de l'admin, ou fichier .json.gz du
   dossier sauvegardes/ de R2) en instructions SQL à exécuter sur une base
   D1 neuve, après ses migrations. Mode d'emploi complet : README, « Restaurer ».

     node scripts/restaurer.js 2026-10-16.json.gz restauration.sql
   ========================================================================== */

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

// Même ordre que src/admin/exports.js : parents avant enfants (clés étrangères)
const TABLES = ["clients", "grilles", "compteurs", "devis", "factures"];
const FORMAT = "dunelab-admin-sauvegarde";

function valeurSql(valeur) {
  if (valeur === null || valeur === undefined) return "NULL";
  if (typeof valeur === "number") {
    if (!Number.isFinite(valeur)) throw new Error(`nombre invalide : ${valeur}`);
    return String(valeur);
  }
  return `'${String(valeur).replace(/'/g, "''")}'`;
}

export function sauvegardeEnSql(donnees) {
  if (donnees?.format !== FORMAT) throw new Error("Ce fichier n'est pas une sauvegarde de l'espace admin Dune Lab.");
  const lignes = [`-- Restauration de la sauvegarde du ${donnees.exporte_le}`];
  for (const table of TABLES) {
    for (const enregistrement of donnees.tables[table] || []) {
      const colonnes = Object.keys(enregistrement);
      lignes.push(
        `INSERT INTO ${table} (${colonnes.join(", ")}) VALUES (${colonnes.map((c) => valeurSql(enregistrement[c])).join(", ")});`
      );
    }
  }
  return lignes.join("\n") + "\n";
}

export function lireSauvegarde(chemin) {
  let octets = readFileSync(chemin);
  if (chemin.endsWith(".gz")) octets = gunzipSync(octets);
  return JSON.parse(octets.toString("utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) {
    console.error("Usage : node scripts/restaurer.js <sauvegarde.json ou .json.gz> <restauration.sql>");
    process.exit(1);
  }
  const donnees = lireSauvegarde(source);
  writeFileSync(destination, sauvegardeEnSql(donnees));
  const nombre = (t) => (donnees.tables[t] || []).length;
  console.log(
    `${destination} écrit : ${nombre("clients")} clients, ${nombre("devis")} devis, ${nombre("factures")} factures et avoirs.\n` +
      `Ensuite : npx wrangler d1 execute <base> --remote --file ${destination}`
  );
}
