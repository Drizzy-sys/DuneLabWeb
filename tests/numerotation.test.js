/* Numérotation : D-AAAA-NNN, F-AAAA-NNN, A-AAAA-NNN, unique, chronologique et sans trou */

import { test } from "node:test";
import assert from "node:assert/strict";
import { creerDevis, supprimerDevis } from "../src/admin/devis.js";
import { creerAvoir, creerFacture, emettreFacture, supprimerFacture } from "../src/admin/factures.js";
import { attribuerNumeroFacture } from "../src/admin/numerotation.js";
import { ajouterClient, creerApplication, ligne, lireGrille } from "./outils/application.js";

async function preparer(options) {
  const app = creerApplication(options);
  const client = await ajouterClient(app);
  const nouvelleFacture = (euros = 100) => creerFacture(app, { client_id: client.id, objet: "Maintenance", lignes: [ligne("Maintenance", 1, euros)] });
  const nouveauDevis = () => creerDevis(app, { client_id: client.id, mode: "forfait", lignes: [ligne("Site", 1, 900)] });
  return { app, client, nouvelleFacture, nouveauDevis };
}

const compteur = (app, serie, annee) =>
  app.db.prepare("SELECT dernier FROM compteurs WHERE serie = ? AND annee = ?").bind(serie, annee).first("dernier");

test("devis numérotés à la création : D-2026-001, D-2026-002…", async () => {
  const { nouveauDevis } = await preparer();
  assert.equal((await nouveauDevis()).numero, "D-2026-001");
  assert.equal((await nouveauDevis()).numero, "D-2026-002");
  assert.equal((await nouveauDevis()).numero, "D-2026-003");
});

test("un numéro de devis supprimé n'est jamais réattribué", async () => {
  const { app, nouveauDevis } = await preparer();
  await nouveauDevis();
  const deuxieme = await nouveauDevis();
  await supprimerDevis(app, deuxieme.id);
  assert.equal((await nouveauDevis()).numero, "D-2026-003");
});

test("la numérotation repart à 001 chaque année", async () => {
  const { app, nouveauDevis, nouvelleFacture } = await preparer({ aujourdhui: "2026-12-31" });
  await nouveauDevis();
  await emettreFacture(app, (await nouvelleFacture()).id);
  await emettreFacture(app, (await nouvelleFacture()).id);
  app.aujourdhui = "2027-01-01";
  assert.equal((await nouveauDevis()).numero, "D-2027-001");
  const f = await emettreFacture(app, (await nouvelleFacture()).id);
  assert.equal(f.numero, "F-2027-001");
  assert.equal(f.date_emission, "2027-01-01");
});

test("un brouillon de facture n'a pas de numéro ; il est attribué à l'émission", async () => {
  const { app, nouvelleFacture } = await preparer();
  const brouillon = await nouvelleFacture();
  assert.equal(brouillon.numero, null);
  assert.equal(await compteur(app, "F", 2026), null);
  const emise = await emettreFacture(app, brouillon.id);
  assert.equal(emise.numero, "F-2026-001");
  assert.equal(emise.statut, "emise");
  assert.equal(emise.date_emission, "2026-10-16");
  assert.equal(emise.date_echeance, "2026-11-15"); // délai de paiement de la grille : 30 jours
});

test("factures sans trou : l'ordre d'émission fait foi, les brouillons supprimés ne comptent pas", async () => {
  const { app, nouvelleFacture } = await preparer();
  const a = await nouvelleFacture();
  const b = await nouvelleFacture();
  const c = await nouvelleFacture();
  await supprimerFacture(app, b.id);
  assert.equal((await emettreFacture(app, c.id)).numero, "F-2026-001");
  assert.equal((await emettreFacture(app, a.id)).numero, "F-2026-002");
  assert.equal((await emettreFacture(app, (await nouvelleFacture()).id)).numero, "F-2026-003");

  const { results } = await app.db.prepare("SELECT numero FROM factures WHERE numero IS NOT NULL ORDER BY numero").all();
  assert.deepEqual(results.map((r) => r.numero), ["F-2026-001", "F-2026-002", "F-2026-003"]);
});

test("émettre deux fois la même facture ne consomme pas de numéro", async () => {
  const { app, nouvelleFacture } = await preparer();
  const f = await nouvelleFacture();
  await emettreFacture(app, f.id);
  await assert.rejects(emettreFacture(app, f.id), /déjà été émise/);
  assert.equal(await compteur(app, "F", 2026), 1);
  assert.equal((await emettreFacture(app, (await nouvelleFacture()).id)).numero, "F-2026-002");
});

test("deux émissions simultanées du même brouillon : un seul numéro", async () => {
  const { app, nouvelleFacture } = await preparer();
  const f = await nouvelleFacture();
  const resultats = await Promise.allSettled([emettreFacture(app, f.id), emettreFacture(app, f.id)]);
  assert.equal(resultats.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await compteur(app, "F", 2026), 1);
});

test("une émission refusée ne consomme pas de numéro", async () => {
  const { app, client, nouvelleFacture } = await preparer();
  const vide = await creerFacture(app, { client_id: client.id, lignes: [] });
  await assert.rejects(emettreFacture(app, vide.id), /au moins une ligne/);
  assert.equal(await compteur(app, "F", 2026), null);
  assert.equal((await emettreFacture(app, (await nouvelleFacture()).id)).numero, "F-2026-001");
});

test("émetteur incomplet (SIREN, IBAN… à compléter) : émission bloquée, aucun numéro consommé", async () => {
  const { app, nouvelleFacture } = await preparer({ grille: lireGrille() });
  const f = await nouvelleFacture();
  await assert.rejects(emettreFacture(app, f.id), /SIREN, RCS, e-mail, IBAN/);
  assert.equal(await compteur(app, "F", 2026), null);
});

test("avoirs dans leur propre série : A-2026-001", async () => {
  const { app, nouvelleFacture } = await preparer();
  const facture = await emettreFacture(app, (await nouvelleFacture()).id);
  const avoir = await creerAvoir(app, facture.id);
  assert.equal(avoir.numero, null);
  assert.equal((await emettreFacture(app, avoir.id)).numero, "A-2026-001");
  assert.equal((await emettreFacture(app, (await nouvelleFacture()).id)).numero, "F-2026-002");
});

test("ordre chronologique : pas d'émission à une date antérieure à la dernière facture", async () => {
  const { app, nouvelleFacture } = await preparer({ aujourdhui: "2026-10-20" });
  await emettreFacture(app, (await nouvelleFacture()).id);
  const f = await nouvelleFacture();
  app.aujourdhui = "2026-10-18";
  await assert.rejects(emettreFacture(app, f.id), /déjà été émise le 20\/10\/2026/);
  assert.equal(await compteur(app, "F", 2026), 1);
});

test("la base refuse elle-même un numéro antidaté, et annule alors l'incrément du compteur", async () => {
  const { app, nouvelleFacture } = await preparer({ aujourdhui: "2026-10-20" });
  await emettreFacture(app, (await nouvelleFacture()).id);
  const f = await nouvelleFacture();
  // Contourne les contrôles du code : seul le trigger SQL protège
  await assert.rejects(
    attribuerNumeroFacture(app.db, { id: f.id, serie: "F", annee: 2026, champs: { date_emission: "2026-10-01" } }),
    /Numérotation non chronologique/
  );
  assert.equal(await compteur(app, "F", 2026), 1); // batch annulé en entier
  const relue = await app.db.prepare("SELECT statut, numero FROM factures WHERE id = ?").bind(f.id).first();
  assert.deepEqual(relue, { statut: "brouillon", numero: null });
});

test("la base refuse un numéro en double", async () => {
  const { app, nouvelleFacture } = await preparer();
  const emise = await emettreFacture(app, (await nouvelleFacture()).id);
  const f = await nouvelleFacture();
  assert.throws(
    () =>
      app.db.sqlite
        .prepare("UPDATE factures SET numero = ?, statut = 'emise', date_emission = '2026-10-16' WHERE id = ?")
        .run(emise.numero, f.id),
    /UNIQUE/
  );
});
