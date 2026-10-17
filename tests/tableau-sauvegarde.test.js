/* Tableau de bord (seuil de franchise), export CSV, sauvegarde R2 et restauration */

import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { creerAvoir, creerFacture, emettreFacture, enregistrerPaiement } from "../src/admin/factures.js";
import { chiffreAffaires, niveauSeuil, tableauDeBord } from "../src/admin/tableau-de-bord.js";
import { exporterDonnees, facturesCsv } from "../src/admin/exports.js";
import { sauvegarderDansR2 } from "../src/admin/sauvegarde.js";
import { sauvegardeEnSql } from "../scripts/restaurer.js";
import { creerD1 } from "./outils/d1.js";
import { ajouterClient, creerApplication, ligne, lireGrille } from "./outils/application.js";

async function facturePayee(app, client, euros, datePaiement) {
  app.aujourdhui = datePaiement; // émise et payée le même jour
  const f = await emettreFacture(app, (await creerFacture(app, { client_id: client.id, objet: "Prestation", lignes: [ligne("Prestation", 1, euros)] })).id);
  return enregistrerPaiement(app, f.id, { date_paiement: datePaiement, montant: f.montant_ttc });
}

test("seuil de franchise : alerte à 80 % de 37 500 €, puis dépassement", () => {
  const seuil = Math.round(lireGrille().tva.seuil_franchise * 100);
  assert.equal(seuil, 3750000);
  assert.equal(niveauSeuil(2999999, seuil), "normal");
  assert.equal(niveauSeuil(3000000, seuil), "alerte");
  assert.equal(niveauSeuil(3750000, seuil), "depasse");
});

test("chiffre d'affaires encaissé sur l'année civile, avoirs remboursés déduits", async () => {
  const app = creerApplication({ aujourdhui: "2026-12-20" });
  const client = await ajouterClient(app);
  await facturePayee(app, client, 20000, "2026-12-01");
  const f2 = await facturePayee(app, client, 11000, "2026-12-15");
  await emettreFacture(app, (await creerFacture(app, { client_id: client.id, lignes: [ligne("Non payée", 1, 5000)] })).id);

  app.aujourdhui = "2026-12-20";
  const avoir = await emettreFacture(app, (await creerAvoir(app, f2.id)).id);
  await enregistrerPaiement(app, avoir.id, { date_paiement: "2026-12-20", montant: 100000 }); // 1 000 € remboursés

  assert.deepEqual(await chiffreAffaires(app, 2026), { encaisse_ttc: 3000000, encaisse_ht: 3000000 });
  assert.deepEqual(await chiffreAffaires(app, 2027), { encaisse_ttc: 0, encaisse_ht: 0 });

  const tableau = await tableauDeBord(app, 2026);
  assert.equal(tableau.franchise.niveau, "alerte");
  assert.equal(tableau.factures_impayees.length, 1);
  assert.equal(tableau.factures_impayees[0].reste_du, 500000);
  assert.deepEqual(tableau.emetteur_incomplet, []);
});

test("factures en retard au tableau de bord", async () => {
  const app = creerApplication();
  const client = await ajouterClient(app);
  await emettreFacture(app, (await creerFacture(app, { client_id: client.id, lignes: [ligne("Conseil", 1, 60)] })).id);
  app.aujourdhui = "2026-12-01";
  const tableau = await tableauDeBord(app);
  assert.equal(tableau.factures_en_retard.length, 1);
  assert.equal(tableau.factures_impayees.length, 0);
});

test("export CSV : séparateur point-virgule, virgule décimale, avoirs en négatif", async () => {
  const app = creerApplication();
  const client = await ajouterClient(app);
  const f = await facturePayee(app, client, 1800, "2026-10-16");
  await emettreFacture(app, (await creerAvoir(app, f.id)).id);
  await creerFacture(app, { client_id: client.id, lignes: [ligne("Brouillon", 1, 1)] }); // non exporté

  const csv = await facturesCsv(app, 2026);
  const lignes = csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lignes.length, 3);
  assert.match(lignes[0], /^Numéro;Type;Date d'émission;/);
  assert.match(lignes[1], /^F-2026-001;Facture;16\/10\/2026;16\/10\/2026;;15\/11\/2026;Kahwa Café SARL;987654321;1800,00;0,00;1800,00;Payée;16\/10\/2026;1800,00;;$/);
  assert.match(lignes[2], /^A-2026-001;Avoir;16\/10\/2026;.*;-1800,00;0,00;-1800,00;Émis;;;;F-2026-001$/);
});

test("sauvegarde dans R2 : quotidienne, et mensuelle écrite une seule fois", async () => {
  const app = creerApplication();
  const client = await ajouterClient(app);
  await facturePayee(app, client, 500, "2026-10-16");
  const env = { DB: app.db, ARCHIVES: app.r2 };

  const cles = await sauvegarderDansR2(env, new Date("2026-10-16T03:00:00Z"));
  assert.deepEqual(cles, ["sauvegardes/quotidiennes/2026-10-16.json.gz", "sauvegardes/mensuelles/2026-10.json.gz"]);
  const contenu = JSON.parse(gunzipSync(app.r2.objets.get(cles[0]).octets).toString("utf8"));
  assert.equal(contenu.tables.factures.length, 1);

  const lendemain = await sauvegarderDansR2(env, new Date("2026-10-17T03:00:00Z"));
  assert.deepEqual(lendemain, ["sauvegardes/quotidiennes/2026-10-17.json.gz"]);
});

test("restauration : une sauvegarde rejouée dans une base neuve redonne exactement les mêmes données", async () => {
  const app = creerApplication();
  const client = await ajouterClient(app);
  const f = await facturePayee(app, client, 1234.56, "2026-10-16");
  await emettreFacture(app, (await creerAvoir(app, f.id)).id);
  await creerFacture(app, { client_id: client.id, objet: "L'apostrophe « et » les guillemets", lignes: [ligne("Brouillon", 1, 1)] });
  const avant = await exporterDonnees(app.db, new Date("2026-10-16T12:00:00Z"));

  const neuve = creerD1();
  neuve.sqlite.exec(sauvegardeEnSql(JSON.parse(JSON.stringify(avant))));
  const apres = await exporterDonnees(neuve, new Date("2026-10-16T12:00:00Z"));
  assert.deepEqual(apres, avant);

  // Les triggers protègent aussi la base restaurée
  assert.throws(() => neuve.sqlite.prepare("DELETE FROM factures WHERE id = ?").run(f.id), /suppression interdite/);
});
