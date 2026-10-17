/* Cadrage du projet et notes internes : rattachés au devis, modifiables même après l'envoi */

import { test } from "node:test";
import assert from "node:assert/strict";
import { creerDevis, dupliquerDevis, envoyerDevis, lireDevis, modifierDevis, modifierSuiviDevis } from "../src/admin/devis.js";
import { validerGrille } from "../src/admin/grille.js";
import { ajouterClient, creerApplication, ligne, lireGrille } from "./outils/application.js";

const CADRAGE = {
  types: ["site"],
  questions: [
    { question: "Combien de pages, et lesquelles (accueil, services, à propos, contact…) ?", reponse: "5 pages : accueil, carte, équipe, galerie, contact" },
    { question: "Accès au tableau de bord de l'ancien hébergeur ?", reponse: "", perso: true },
  ],
};

async function devisAvecCadrage() {
  const app = creerApplication();
  const client = await ajouterClient(app);
  const devis = await creerDevis(app, {
    client_id: client.id,
    mode: "forfait",
    lignes: [ligne("Site vitrine", 1, 1800, { ref: "site-vitrine" })],
    notes: "Rappeler mardi.",
    cadrage: CADRAGE,
  });
  return { app, client, devis };
}

test("le cadrage et les notes sont enregistrés avec le devis", async () => {
  const { app, devis } = await devisAvecCadrage();
  const relu = await lireDevis(app, devis.id);
  assert.deepEqual(relu.cadrage, CADRAGE);
  assert.equal(relu.notes, "Rappeler mardi.");
});

test("un devis sans cadrage renvoie un cadrage vide", async () => {
  const app = creerApplication();
  const client = await ajouterClient(app);
  const devis = await creerDevis(app, { client_id: client.id, mode: "forfait", lignes: [] });
  assert.deepEqual(devis.cadrage, { types: [], questions: [] });
});

test("après l'envoi : cadrage et notes restent modifiables, le PDF archivé ne change pas", async () => {
  const { app, client, devis } = await devisAvecCadrage();
  const envoye = await envoyerDevis(app, devis.id);
  const pdf = app.r2.objets.get(envoye.pdf_cle).octets;

  // Le contenu commercial est figé…
  await assert.rejects(modifierDevis(app, devis.id, { client_id: client.id, mode: "forfait", lignes: [] }), /Dupliquez-le/);

  // …mais le suivi interne continue
  const cadrage = { ...CADRAGE, questions: [...CADRAGE.questions, { question: "Date de mise en ligne ?", reponse: "Avant Pâques", perso: true }] };
  const suivi = await modifierSuiviDevis(app, devis.id, { notes: "Client OK sur le devis, attend son associé.", cadrage });
  assert.equal(suivi.notes, "Client OK sur le devis, attend son associé.");
  assert.equal(suivi.cadrage.questions.length, 3);
  assert.equal(suivi.statut, "envoye");
  assert.equal(suivi.montant_ttc, envoye.montant_ttc);
  assert.equal(suivi.pdf_sha256, envoye.pdf_sha256);
  assert.deepEqual(app.r2.objets.get(envoye.pdf_cle).octets, pdf);
});

test("dupliquer un devis reprend son cadrage et ses notes", async () => {
  const { app, devis } = await devisAvecCadrage();
  const copie = await dupliquerDevis(app, devis.id);
  assert.deepEqual(copie.cadrage, CADRAGE);
  assert.equal(copie.notes, "Rappeler mardi.");
});

test("cadrage invalide refusé", async () => {
  const { app, devis } = await devisAvecCadrage();
  await assert.rejects(modifierSuiviDevis(app, devis.id, { cadrage: { questions: [{ question: "", reponse: "x" }] } }), /obligatoire/);
  await assert.rejects(modifierSuiviDevis(app, devis.id, { cadrage: "texte" }), /Cadrage invalide/);
});

test("grille : options rattachées à une catégorie existante, questions sous forme de liste", () => {
  assert.deepEqual(validerGrille(lireGrille()), []);
  const g = lireGrille();
  g.categories.find((c) => c.id === "option").options_de = "inexistante";
  g.categories[0].questions = "pas une liste";
  const erreurs = validerGrille(g).join("\n");
  assert.match(erreurs, /options de/);
  assert.match(erreurs, /questions doivent être une liste/);
});
