#!/usr/bin/env node
/* Copie locale de la base de production : sauvegardes/dunelab-admin-AAAA-MM-JJ.sql
   (en plus des sauvegardes automatiques dans R2). À garder hors du dépôt Git. */

import { mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Nom de la base tel que déclaré dans wrangler.jsonc (« wrangler d1 export » n'accepte pas le binding)
const base = readFileSync("wrangler.jsonc", "utf8").match(/"database_name"\s*:\s*"([^"]+)"/)?.[1] || "dunelab-admin";
const jour = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
const fichier = `sauvegardes/${base}-${jour}.sql`;
mkdirSync("sauvegardes", { recursive: true });

const resultat = spawnSync("npx", ["wrangler", "d1", "export", base, "--remote", "--output", fichier], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (resultat.status === 0) console.log(`\nSauvegarde enregistrée : ${fichier}`);
process.exit(resultat.status ?? 1);
