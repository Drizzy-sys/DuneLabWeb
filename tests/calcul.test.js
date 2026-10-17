/* Calcul des totaux, remises, TVA, échéancier et format des montants */

import { test } from "node:test";
import assert from "node:assert/strict";
import { calculerDocument, calculerEcheancier, calculerLignes, appliquerTaux } from "../public/admin/js/lib/calcul.js";
import {
  ajouterJours,
  analyserMontant,
  aujourdhui,
  enCentimes,
  enPointsDeBase,
  formaterDate,
  formaterMontant,
  formaterMontantCsv,
  formaterPourcentage,
} from "../public/admin/js/lib/format.js";
import { ligne, lireGrille } from "./outils/application.js";

// Les espaces des montants sont insécables : on les rend visibles pour comparer
const lisible = (texte) => texte.replace(/ /g, " ");

test("montants au format français « 1 800,00 € »", () => {
  assert.equal(lisible(formaterMontant(180000)), "1 800,00 €");
  assert.equal(lisible(formaterMontant(0)), "0,00 €");
  assert.equal(lisible(formaterMontant(5)), "0,05 €");
  assert.equal(lisible(formaterMontant(12345678901)), "123 456 789,01 €");
  assert.equal(lisible(formaterMontant(-27000)), "−270,00 €");
  // Espace insécable : le montant ne se coupe jamais en fin de ligne
  assert.equal(formaterMontant(180000), "1 800,00 €");
});

test("montants pour le tableur, pourcentages et dates", () => {
  assert.equal(formaterMontantCsv(180000), "1800,00");
  assert.equal(formaterMontantCsv(-5), "-0,05");
  assert.equal(lisible(formaterPourcentage(3000)), "30 %");
  assert.equal(lisible(formaterPourcentage(1250)), "12,5 %");
  assert.equal(formaterDate("2026-10-16"), "16/10/2026");
  assert.equal(ajouterJours("2026-10-16", 30), "2026-11-15");
  assert.equal(ajouterJours("2026-12-15", 30), "2027-01-14");
  assert.equal(ajouterJours("2028-02-28", 1), "2028-02-29");
  // Minuit passé à Paris, encore la veille en UTC
  assert.equal(aujourdhui(new Date("2026-10-15T22:30:00Z")), "2026-10-16");
});

test("saisie des montants", () => {
  assert.equal(analyserMontant("1 800,50"), 180050);
  assert.equal(analyserMontant("1800.5"), 180050);
  assert.equal(analyserMontant("1 800 €"), 180000);
  assert.equal(analyserMontant("0,1"), 10);
  assert.ok(Number.isNaN(analyserMontant("douze")));
  assert.ok(Number.isNaN(analyserMontant("")));
  assert.equal(enCentimes(0.29), 29);
  assert.equal(enPointsDeBase(0.15), 1500);
});

test("total de chaque ligne : quantité × prix unitaire, arrondi au centime", () => {
  const [a, b, c] = calculerLignes([
    ligne("Développement", 1.5, 400),
    ligne("Conseil", 0.333, 1),
    ligne("Pages", 3, 0.1),
  ]);
  assert.equal(a.total, 60000);
  assert.equal(b.total, 33); // 0,333 € arrondi
  assert.equal(c.total, 30); // pas d'erreur de virgule flottante (3 × 0,1)
});

test("majoration en pourcentage calculée sur les lignes à prix unitaire", () => {
  const lignes = calculerLignes([
    ligne("Site vitrine", 1, 1800),
    ligne("Pages supplémentaires", 2, 150),
    ligne("Livraison express", 1, 0, { prix_unitaire: null, pourcentage: 2500 }),
  ]);
  assert.equal(lignes[2].total, 52500); // 25 % de 2 100 €
});

test("devis en franchise : TVA à 0 %, TTC = HT", () => {
  const calcul = calculerDocument({
    lignes: [ligne("Site vitrine", 1, 1800), ligne("Rédaction", 3, 90)],
    taux_tva: 0,
  });
  assert.equal(calcul.sous_total, 207000);
  assert.equal(calcul.total_ht, 207000);
  assert.equal(calcul.total_tva, 0);
  assert.equal(calcul.total_ttc, 207000);
  assert.equal(calcul.montant_ttc, 207000);
});

test("TVA à 20 % arrondie au centime", () => {
  const calcul = calculerDocument({ lignes: [ligne("Site", 1, 1800), ligne("Conseil", 1, 12.34)], taux_tva: 2000 });
  assert.equal(calcul.total_ht, 181234);
  assert.equal(calcul.total_tva, 36247); // 362,468 € → 362,47 €
  assert.equal(calcul.total_ttc, 217481);
});

test("remise en pourcentage (arrondi commercial) et remise en montant", () => {
  const lignes = [ligne("Site", 1, 1800), ligne("Pages", 2, 150), ligne("Rédaction", 3, 90), ligne("Express", 1, 0, { prix_unitaire: null, pourcentage: 2500 })];
  const pourcentage = calculerDocument({ lignes, remise: { type: "pourcentage", valeur: 1500, libelle: "Offre de lancement" } });
  assert.equal(pourcentage.sous_total, 296250);
  assert.equal(pourcentage.remise.montant, 44438); // 444,375 € → 444,38 €
  assert.equal(pourcentage.total_ht, 251812);

  const montant = calculerDocument({ lignes: [ligne("Site", 1, 900)], remise: { type: "montant", valeur: 10000, libelle: "Geste" } });
  assert.equal(montant.total_ht, 80000);

  // Une remise ne peut pas dépasser le sous-total
  const plafonnee = calculerDocument({ lignes: [ligne("Conseil", 1, 60)], remise: { type: "montant", valeur: 999999, libelle: "Geste" } });
  assert.equal(plafonnee.total_ht, 0);
});

test("remise de la grille appliquée avant la TVA", () => {
  const calcul = calculerDocument({ lignes: [ligne("Site", 1, 1000)], remise: { type: "pourcentage", valeur: 1000, libelle: "Association" }, taux_tva: 2000 });
  assert.equal(calcul.total_ht, 90000);
  assert.equal(calcul.total_tva, 18000);
  assert.equal(calcul.total_ttc, 108000);
});

test("échéancier 30/40/30 : la somme des échéances est exactement le total", () => {
  const etapes = lireGrille().conditions.echeancier_forfait.map((e) => ({ etape: e.etape, pourcentage: enPointsDeBase(e.pourcentage) }));

  const simple = calculerEcheancier(180000, 0, etapes);
  assert.deepEqual(simple.map((e) => e.montant_ttc), [54000, 72000, 54000]);
  assert.deepEqual(simple.map((e) => e.type), ["acompte", "intermediaire", "solde"]);

  for (const [total, taux] of [[251812, 0], [99999, 2000], [1, 2000], [333333, 2000]]) {
    const echeances = calculerEcheancier(total, taux, etapes);
    const somme = (cle) => echeances.reduce((s, e) => s + e[cle], 0);
    assert.equal(somme("montant_ht"), total);
    assert.equal(somme("montant_tva"), appliquerTaux(total, taux));
    assert.equal(somme("montant_ttc"), total + appliquerTaux(total, taux));
  }
});

test("facture de solde : total moins les acomptes déjà facturés", () => {
  const calcul = calculerDocument({
    lignes: [ligne("Site", 1, 1800)],
    taux_tva: 2000,
    deductions: [
      { numero: "F-2026-001", montant_ht: 54000, montant_tva: 10800, montant_ttc: 64800 },
      { numero: "F-2026-002", montant_ht: 72000, montant_tva: 14400, montant_ttc: 86400 },
    ],
  });
  assert.equal(calcul.total_ttc, 216000);
  assert.equal(calcul.montant_ht, 54000);
  assert.equal(calcul.montant_tva, 10800);
  assert.equal(calcul.montant_ttc, 64800);
});
