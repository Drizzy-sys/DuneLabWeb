/* Devis mêlant forfait et abonnement : l'abonnement sort du forfait et se facture chaque mois */

import { test } from "node:test";
import assert from "node:assert/strict";
import { calculerDevis, calculerEcheancier } from "../public/admin/js/lib/calcul.js";
import { phraseAbonnement } from "../public/admin/js/lib/abonnement.js";
import { ajouterMois, enPointsDeBase } from "../public/admin/js/lib/format.js";
import { changerStatutDevis, creerDevis, envoyerDevis, lireDevis } from "../src/admin/devis.js";
import {
  abonnementsAFacturer,
  creerFactureAbonnement,
  creerFactureDepuisDevis,
  emettreFacture,
  enregistrerPaiement,
} from "../src/admin/factures.js";
import { chiffreAffaires } from "../src/admin/tableau-de-bord.js";
import { construireContexte } from "../src/admin/grille.js";
import { genererPdf, vueDevis } from "../src/admin/pdf.js";
import { ajouterClient, creerApplication, grilleComplete, ligne, lirePolices } from "./outils/application.js";

const lisible = (t) => t.replace(/[  ]/g, " ");
const INSTALLATION = ligne("Espace admin devis et factures", 1, 1200, { ref: "gest-installation" });
const ABONNEMENT = ligne("Abonnement espace admin devis et factures", 1, 29, { ref: "gest-abonnement", unite: "mois" });
const DOMAINE = ligne("Nom de domaine", 1, 15, { ref: "abo-domaine", unite: "an" });
const EXPRESS = ligne("Livraison express", 1, 0, { prix_unitaire: null, pourcentage: 2500, unite: "majoration" });

test("calcul : les lignes « mois » et « an » sortent du forfait, de la remise et de la majoration", () => {
  const calcul = calculerDevis({
    lignes: [INSTALLATION, ABONNEMENT, DOMAINE, EXPRESS],
    remise: { type: "pourcentage", valeur: 1000, libelle: "Remise" },
  });
  assert.equal(calcul.sous_total, 150000); // 1 200 € + 25 % de 1 200 €, sans l'abonnement
  assert.equal(calcul.total_ht, 135000); // remise de 10 % sur le forfait seul
  assert.deepEqual(calcul.recurrent.periodes.map((p) => [p.unite, p.total_ht]), [["mois", 2900], ["an", 1500]]);
});

test("phrase du devis : « puis 29 € HT/mois à partir de la mise en ligne, engagement 12 mois »", () => {
  const conditions = construireContexte(grilleComplete(), 1, null).conditions;
  const { recurrent } = calculerDevis({ lignes: [INSTALLATION, ABONNEMENT] });
  assert.equal(lisible(phraseAbonnement(recurrent.periodes, conditions)), "puis 29,00 € HT/mois à partir de la mise en ligne, engagement 12 mois");
});

test("périodes d'abonnement : fins de mois et changement d'année", () => {
  assert.equal(ajouterMois("2026-10-16", 1), "2026-11-16");
  assert.equal(ajouterMois("2026-12-15", 1), "2027-01-15");
  assert.equal(ajouterMois("2026-01-31", 1), "2026-02-28");
  assert.equal(ajouterMois("2028-01-31", 1), "2028-02-29");
  assert.equal(ajouterMois("2026-10-16", 12), "2027-10-16");
});

test("devis forfait + abonnement : forfait et échéancier sans l'abonnement, abonnement facturé chaque mois à partir de la livraison, compté dans le chiffre d'affaires", async () => {
  const app = creerApplication({ aujourdhui: "2026-10-16" });
  const client = await ajouterClient(app);
  const devis = await creerDevis(app, {
    client_id: client.id,
    objet: "Espace admin devis et factures",
    mode: "forfait",
    lignes: [INSTALLATION, ABONNEMENT],
  });

  // Le devis : 1 200 € de forfait, échéancier 30/40/30 sur 1 200 €, abonnement à part
  assert.equal(devis.montant_ttc, 120000);
  assert.deepEqual(devis.echeancier.map((e) => e.montant_ttc), [36000, 48000, 36000]);
  assert.deepEqual(devis.calcul.recurrent.periodes.map((p) => p.total_ht), [2900]);

  // Le PDF affiche le total du forfait, puis l'abonnement
  const { textes } = await genererPdf(vueDevis(devis), lirePolices());
  const texte = lisible(textes.join(" "));
  assert.ok(texte.includes("1 200,00 €"));
  assert.ok(texte.includes("puis 29,00 € HT/mois à partir de la mise en ligne, engagement 12 mois."));
  assert.ok(texte.includes("29,00 €/mois"));
  assert.ok(!texte.includes("1 229,00"));

  await envoyerDevis(app, devis.id);
  await changerStatutDevis(app, devis.id, "accepte");

  // Avant la livraison : pas d'abonnement à facturer
  assert.deepEqual(await abonnementsAFacturer(app), []);

  // Forfait : acompte, intermédiaire, solde = 1 200 €, sans l'abonnement
  const factures = [];
  for (const [rang, jour] of [[0, "2026-10-16"], [1, "2026-10-30"], [2, "2026-11-10"]]) {
    app.aujourdhui = jour;
    factures.push(await emettreFacture(app, (await creerFactureDepuisDevis(app, devis.id, rang)).id));
  }
  const solde = factures[2];
  assert.ok(!solde.lignes.some((l) => l.unite === "mois"));
  assert.equal(factures.reduce((s, f) => s + f.montant_ttc, 0), 120000);

  // Livré le 10/11 : le premier mois est à facturer, du 10/11 au 09/12
  assert.deepEqual((await abonnementsAFacturer(app)).map((a) => [a.devis_numero, a.periodicite, a.montant_ht]), [[devis.numero, "mois", 2900]]);
  const mois1 = await emettreFacture(app, (await creerFactureAbonnement(app, devis.id, "mois")).id);
  assert.equal(mois1.montant_ttc, 2900);
  assert.equal(mois1.periodicite, "mois");
  assert.deepEqual([mois1.prestation_debut, mois1.prestation_fin], ["2026-11-10", "2026-12-09"]);
  assert.deepEqual(mois1.lignes.map((l) => l.designation), ["Abonnement espace admin devis et factures"]);
  assert.deepEqual(await abonnementsAFacturer(app), []); // période en cours couverte

  // Le mois suivant s'enchaîne, sans trou ni chevauchement
  app.aujourdhui = "2026-12-10";
  assert.equal((await abonnementsAFacturer(app)).length, 1);
  const mois2 = await emettreFacture(app, (await creerFactureAbonnement(app, devis.id, "mois")).id);
  assert.deepEqual([mois2.prestation_debut, mois2.prestation_fin], ["2026-12-10", "2027-01-09"]);

  // Les factures d'abonnement payées comptent dans le suivi du seuil de franchise
  for (const f of [...factures, mois1, mois2]) await enregistrerPaiement(app, f.id, { date_paiement: "2026-12-10", montant: f.montant_ttc });
  assert.deepEqual(await chiffreAffaires(app, 2026), { encaisse_ttc: 120000 + 2900 * 2, encaisse_ht: 120000 + 2900 * 2 });

  // Le devis relu liste à part les factures d'abonnement
  const relu = await lireDevis(app, devis.id);
  assert.equal(relu.factures.filter((f) => f.periodicite === "mois").length, 2);
});

test("devis d'abonnement seul : pas de forfait ni d'échéancier, factures par période uniquement", async () => {
  const app = creerApplication();
  const client = await ajouterClient(app);
  const devis = await creerDevis(app, { client_id: client.id, mode: "abonnement", lignes: [ABONNEMENT] });
  assert.equal(devis.montant_ttc, 0);
  assert.equal(devis.echeancier, null);
  await envoyerDevis(app, devis.id);
  await changerStatutDevis(app, devis.id, "accepte");
  await assert.rejects(creerFactureDepuisDevis(app, devis.id, null), /que des abonnements/);
  // Sans forfait à livrer, le premier mois est à facturer tout de suite
  assert.equal((await abonnementsAFacturer(app)).length, 1);
  const brouillon = await creerFactureAbonnement(app, devis.id, "mois");
  assert.deepEqual([brouillon.prestation_debut, brouillon.prestation_fin], ["2026-10-16", "2026-11-15"]);
  await assert.rejects(creerFactureAbonnement(app, devis.id, "mois"), /brouillon d'abonnement existe déjà/);
  await assert.rejects(creerFactureAbonnement(app, devis.id, "an"), /pas d'abonnement annuel/);
});

test("échéancier : calculé sur le forfait seul, au centime près", () => {
  const { total_ht, taux_tva } = calculerDevis({ lignes: [INSTALLATION, ABONNEMENT], taux_tva: 2000 });
  const etapes = [0.3, 0.4, 0.3].map((p, i) => ({ etape: `Étape ${i + 1}`, pourcentage: enPointsDeBase(p) }));
  const echeances = calculerEcheancier(total_ht, taux_tva, etapes);
  assert.equal(echeances.reduce((s, e) => s + e.montant_ttc, 0), 144000); // 1 200 € HT + 20 %
});
