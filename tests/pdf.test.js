/* PDF : toutes les mentions obligatoires de grille.json sont imprimées */

import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { genererPdf, vueDevis, vueFacture } from "../src/admin/pdf.js";
import { construireContexte } from "../src/admin/grille.js";
import { CLIENT_PARTICULIER, CLIENT_PRO, grilleComplete, ligne, lirePolices } from "./outils/application.js";

const polices = lirePolices();
const grille = grilleComplete();
const espaces = (t) => t.replace(/[  ]/g, " ");

async function texteDuPdf(vue) {
  const { octets, textes } = await genererPdf(vue, polices);
  const pdf = await PDFDocument.load(octets);
  // Lignes réunies par des espaces : une phrase coupée en fin de ligne se retrouve entière
  return { pdf, texte: espaces(textes.join(" ")) };
}

const devis = (client) => ({
  numero: "D-2026-001",
  statut: "envoye",
  date_devis: "2026-10-16",
  validite_jours: 30,
  objet: "Site vitrine",
  mode: "forfait",
  delai_execution: "4 semaines",
  lignes: [ligne("Site vitrine jusqu'à 5 pages", 1, 1800, { unite: "forfait" }), ligne("Page supplémentaire", 2, 150, { unite: "page" })],
  remise: null,
  taux_tva: 0,
  contexte: construireContexte(grille, 1, client),
});

const facture = (client, extra = {}) => ({
  serie: "F",
  numero: "F-2026-001",
  type: "standard",
  statut: "emise",
  date_emission: "2026-10-16",
  prestation_debut: "2026-10-01",
  prestation_fin: "2026-10-31",
  date_echeance: "2026-11-15",
  objet: "Maintenance",
  lignes: [ligne("Maintenance Sérénité", 1, 89, { unite: "mois" })],
  remise: null,
  deductions: [],
  taux_tva: 0,
  contexte: construireContexte(grille, 1, client),
  ...extra,
});

test("devis : mentions de grille.json (numéro, validité, émetteur, client, détail, totaux, conditions, bon pour accord)", async () => {
  const { pdf, texte } = await texteDuPdf(vueDevis(devis({ ...CLIENT_PRO, siren: "987654321", pays: "France" })));
  assert.equal(pdf.getTitle(), "Devis D-2026-001");
  for (const attendu of [
    "Devis", "D-2026-001", "16/10/2026", "Valable jusqu’au", "15/11/2026", "30 jours",
    "Dune Lab", "SASU au capital de 1 000 €", "20 Avenue des Pinsons", "33115 La Teste-de-Buch", "SIREN 123 456 789", "RCS Bordeaux",
    "Kahwa Café SARL", "12 rue du Port", "33120 Arcachon", "SIREN 987654321",
    "Qté", "Unité", "Prix unit. HT", "Total HT", "1 800,00 €", "300,00 €", "page",
    "TVA (0 %)", "Total TTC", "2 100,00 €", "TVA non applicable, art. 293 B du CGI",
    "Délai d’exécution", "4 semaines", "Conditions de paiement", "Échéancier", "630,00 €", "840,00 €",
    "Bon pour accord", "Date :", "Signature :",
  ]) {
    assert.ok(texte.includes(attendu), `absent du devis : « ${attendu} »`);
  }
});

test("facture : mentions obligatoires (dates, échéance, franchise, pénalités, 40 € pour un pro, escompte, IBAN)", async () => {
  const { pdf, texte } = await texteDuPdf(vueFacture(facture({ ...CLIENT_PRO, siren: "987654321", pays: "France" }), {}, "2026-10-16"));
  assert.equal(pdf.getTitle(), "Facture F-2026-001");
  for (const attendu of [
    "Facture", "F-2026-001", "Date d’émission", "16/10/2026", "Période de la prestation", "du 01/10/2026 au 31/10/2026",
    "Échéance", "15/11/2026", "SIREN 987654321", "Nature de l’opération : Prestation de services",
    "TVA non applicable, art. 293 B du CGI", "Net à payer TTC", "89,00 €",
    "trois fois le taux d'intérêt légal", "40 €", "Pas d'escompte pour paiement anticipé",
    "IBAN", "FR76 1234 5678 9012 3456 7890 123",
  ]) {
    assert.ok(texte.includes(attendu), `absent de la facture : « ${attendu} »`);
  }
});

test("facture à un particulier : pas d'indemnité forfaitaire de 40 €", async () => {
  const { texte } = await texteDuPdf(vueFacture(facture({ ...CLIENT_PARTICULIER, siren: "", pays: "France" }), {}, "2026-10-16"));
  assert.ok(!texte.includes("Indemnité forfaitaire"));
  assert.ok(texte.includes("Pas d'escompte"));
});

test("assujetti à la TVA : TVA à 20 %, plus de mention de franchise", async () => {
  const contexte = construireContexte(grilleComplete((g) => ({ ...g, tva: { ...g.tva, regime: "assujetti" } })), 1, { ...CLIENT_PRO, pays: "France" });
  const { texte } = await texteDuPdf(vueFacture(facture(CLIENT_PRO, { contexte, taux_tva: contexte.tva.taux }), {}, "2026-10-16"));
  assert.ok(texte.includes("TVA (20 %)"));
  assert.ok(texte.includes("17,80 €"));
  assert.ok(texte.includes("106,80 €"));
  assert.ok(!texte.includes("293 B"));
});

test("brouillon : filigrane et pas de numéro ; un PDF émis est reproductible octet pour octet", async () => {
  const brouillon = await texteDuPdf(vueFacture(facture(CLIENT_PRO, { statut: "brouillon", numero: null, date_emission: null }), {}, "2026-10-16"));
  assert.ok(brouillon.texte.includes("Brouillon, sans numéro"));

  const vue = vueFacture(facture(CLIENT_PRO), {}, "2026-10-16");
  const a = await genererPdf(vue, polices);
  const b = await genererPdf(vueFacture(facture(CLIENT_PRO), {}, "2030-01-01"), polices);
  assert.deepEqual(a.octets, b.octets);
});

test("long devis : plusieurs pages numérotées", async () => {
  const long = devis(CLIENT_PRO);
  long.lignes = Array.from({ length: 40 }, (_, i) => ligne(`Prestation ${i + 1}`, 1, 100, { description: "Description sur une ligne" }));
  const { pdf, texte } = await texteDuPdf(vueDevis(long));
  assert.ok(pdf.getPageCount() >= 3);
  assert.ok(texte.includes(`Page ${pdf.getPageCount()} / ${pdf.getPageCount()}`));
});
