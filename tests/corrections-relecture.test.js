/* Scénarios remontés par la relecture du code, corrigés */

import { test } from "node:test";
import assert from "node:assert/strict";
import { changerStatutDevis, creerDevis, envoyerDevis, lireDevis, pdfDevis } from "../src/admin/devis.js";
import {
  abonnementsAFacturer,
  creerAvoir,
  creerFactureAbonnement,
  creerFactureDepuisDevis,
  emettreFacture,
  lireFacture,
  modifierFacture,
} from "../src/admin/factures.js";
import { facturesCsv } from "../src/admin/exports.js";
import { validerGrille } from "../src/admin/grille.js";
import { ajouterClient, creerApplication, grilleComplete, ligne, lireGrille } from "./outils/application.js";

// Assujetti à la TVA : le n° de TVA intracommunautaire est alors obligatoire
const assujetti = () =>
  grilleComplete((g) => ({ ...g, tva: { ...g.tva, regime: "assujetti" }, emetteur: { ...g.emetteur, tva_intracom: "FR12 123456789" } }));

async function devisAccepte(app, lignes, { mode = "forfait", client } = {}) {
  client ??= await ajouterClient(app);
  const devis = await creerDevis(app, { client_id: client.id, mode, objet: "Projet", lignes });
  await envoyerDevis(app, devis.id);
  await changerStatutDevis(app, devis.id, "accepte");
  return { devis, client };
}

const emettreEtape = async (app, devisId, rang) => emettreFacture(app, (await creerFactureDepuisDevis(app, devisId, rang)).id);

test("avoir total sur une facture de solde : exact au centime, même avec la TVA (100,10 € HT, 30/40/30, 20 %)", async () => {
  // Le scénario de la relecture, puis une série de totaux voisins
  for (let centimes = 10000; centimes <= 10040; centimes += 1) {
    const app = creerApplication({ grille: assujetti() });
    const { devis } = await devisAccepte(app, [ligne("Site", 1, centimes / 100)]);
    await emettreEtape(app, devis.id, 0);
    await emettreEtape(app, devis.id, 1);
    const solde = await emettreEtape(app, devis.id, 2);
    const avoir = await emettreFacture(app, (await creerAvoir(app, solde.id)).id);
    assert.equal(avoir.montant_ttc, solde.montant_ttc, `total ${centimes} centimes`);
    assert.equal(avoir.montant_tva, solde.montant_tva, `total ${centimes} centimes`);
    assert.equal((await lireFacture(app, solde.id)).statut_affiche, "annulee");
  }
});

test("avoir partiel puis avoir total du reste : la facture est annulée au centime près", async () => {
  const app = creerApplication({ grille: assujetti() });
  const client = await ajouterClient(app);
  const facture = await emettreFacture(app, (await (await import("../src/admin/factures.js")).creerFacture(app, { client_id: client.id, lignes: [ligne("Conseil", 3, 33.37)] })).id);
  const partiel = await creerAvoir(app, facture.id, { partiel: true });
  assert.equal(partiel.montant_ttc, 0);
  await modifierFacture(app, partiel.id, { lignes: [ligne("Geste commercial", 1, 10.01)] });
  await emettreFacture(app, partiel.id);
  const total = await emettreFacture(app, (await creerAvoir(app, facture.id)).id);
  const relue = await lireFacture(app, facture.id);
  assert.equal(relue.avoirs_ttc, facture.montant_ttc);
  assert.equal(relue.statut_affiche, "annulee");
  assert.ok(total.deductions.some((d) => d.numero === "A-2026-001"));
});

test("échéancier : pas de solde tant qu'un acompte est en brouillon, plus d'acompte après le solde", async () => {
  const app = creerApplication();
  const { devis } = await devisAccepte(app, [ligne("Site", 1, 1800)]);
  const acompte = await creerFactureDepuisDevis(app, devis.id, 0);
  await assert.rejects(creerFactureDepuisDevis(app, devis.id, 2), /encore en brouillon/);

  // Acompte sauté (supprimé), solde facturé en entier : l'acompte ne peut plus venir après
  const { supprimerFacture } = await import("../src/admin/factures.js");
  await supprimerFacture(app, acompte.id);
  const solde = await emettreEtape(app, devis.id, 2);
  assert.equal(solde.montant_ttc, 180000);
  await assert.rejects(creerFactureDepuisDevis(app, devis.id, 0), /solde est déjà facturé/);
  await assert.rejects(creerFactureDepuisDevis(app, devis.id, 1), /solde est déjà facturé/);
});

test("échéancier : un brouillon d'acompte créé avant le solde ne peut plus être émis après lui", async () => {
  const app = creerApplication();
  const { devis } = await devisAccepte(app, [ligne("Site", 1, 1800)]);
  await emettreEtape(app, devis.id, 1); // étape intermédiaire émise
  const acompte = await creerFactureDepuisDevis(app, devis.id, 0); // brouillon
  await assert.rejects(creerFactureDepuisDevis(app, devis.id, 2), /encore en brouillon/);
  await emettreFacture(app, acompte.id);
  await emettreEtape(app, devis.id, 2);
  const total = (await lireDevis(app, devis.id)).factures.reduce((s, f) => s + f.montant_ttc, 0);
  assert.equal(total, 180000); // jamais plus que le devis
});

test("étape annulée par avoir : elle peut être refacturée", async () => {
  const app = creerApplication();
  const { devis } = await devisAccepte(app, [ligne("Site", 1, 1800)]);
  const acompte = await emettreEtape(app, devis.id, 0);
  await emettreFacture(app, (await creerAvoir(app, acompte.id)).id);
  const relu = await lireDevis(app, devis.id);
  assert.equal(relu.factures.find((f) => f.id === acompte.id).statut_affiche, "annulee");
  const nouvel = await emettreEtape(app, devis.id, 0);
  assert.equal(nouvel.montant_ttc, 54000);
});

test("envoi d'un devis : si l'archivage R2 échoue, le devis est bien envoyé, avec un avertissement", async () => {
  const app = creerApplication();
  const client = await ajouterClient(app);
  const devis = await creerDevis(app, { client_id: client.id, mode: "forfait", lignes: [ligne("Audit", 1, 450)] });
  const put = app.r2.put;
  app.r2.put = async () => {
    throw new Error("R2 indisponible");
  };
  const envoye = await envoyerDevis(app, devis.id);
  assert.equal(envoye.statut, "envoye");
  assert.match(envoye.avertissement, /pas pu être archivé/);
  app.r2.put = put;
  const { nom } = await pdfDevis(app, devis.id); // archivé maintenant
  assert.equal(nom, `${devis.numero}.pdf`);
  assert.ok((await lireDevis(app, devis.id)).pdf_cle);
});

test("abonnement d'un devis hors forfait : livré dès la facture de l'installation, puis à facturer", async () => {
  const app = creerApplication();
  const { devis } = await devisAccepte(
    app,
    [ligne("Installation", 1, 1200, { ref: "gest-installation" }), ligne("Abonnement", 1, 29, { ref: "gest-abonnement", unite: "mois" })],
    { mode: "abonnement" }
  );
  assert.equal((await lireDevis(app, devis.id)).livre, false);
  assert.deepEqual(await abonnementsAFacturer(app), []);
  const installation = await emettreFacture(app, (await creerFactureDepuisDevis(app, devis.id, null)).id);
  assert.ok(!installation.lignes.some((l) => l.unite === "mois"));
  assert.equal((await lireDevis(app, devis.id)).livre, true);
  const dus = await abonnementsAFacturer(app);
  assert.deepEqual(dus.map((a) => [a.periodicite, a.premiere, a.depuis]), [["mois", true, "2026-10-16"]]);
});

test("périodes d'abonnement comptées depuis la première : pas de dérive après un 31", async () => {
  const app = creerApplication({ aujourdhui: "2027-01-31" });
  const { devis } = await devisAccepte(app, [ligne("Abonnement", 1, 29, { unite: "mois" })], { mode: "abonnement" });
  const periodes = [];
  for (const jour of ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]) {
    app.aujourdhui = jour;
    const f = await emettreFacture(app, (await creerFactureAbonnement(app, devis.id, "mois")).id);
    periodes.push(`${f.prestation_debut}→${f.prestation_fin}`);
  }
  assert.deepEqual(periodes, ["2027-01-31→2027-02-27", "2027-02-28→2027-03-30", "2027-03-31→2027-04-29", "2027-04-30→2027-05-30"]);
});

test("export CSV : un nom commençant par « - » est neutralisé, les montants négatifs restent des nombres", async () => {
  const app = creerApplication();
  const client = await ajouterClient(app, { type: "particulier", nom: "-2+3+cmd", adresse: "1 rue", code_postal: "33000", ville: "Bordeaux" });
  const { creerFacture } = await import("../src/admin/factures.js");
  const f = await emettreFacture(app, (await creerFacture(app, { client_id: client.id, lignes: [ligne("Conseil", 1, 60)] })).id);
  await emettreFacture(app, (await creerAvoir(app, f.id)).id);
  const csv = await facturesCsv(app, 2026);
  assert.ok(csv.includes(";'-2+3+cmd;"));
  assert.ok(csv.includes(";-60,00;"));
  assert.ok(!csv.includes(";'-60,00;"));
});

test("grille : divise_delai validé (livraison express)", () => {
  const g = lireGrille();
  assert.equal(g.categories.flatMap((c) => c.prestations).find((p) => p.id === "opt-urgence").divise_delai, 2);
  assert.deepEqual(validerGrille(g), []);
  g.categories[1].prestations[0].divise_delai = 0;
  assert.match(validerGrille(g).join(" "), /divise_delai/);
});
