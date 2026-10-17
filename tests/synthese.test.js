/* Questions par thème, incompatibilités entre prestations, synthèse du projet */

import { test } from "node:test";
import assert from "node:assert/strict";
import { questionsDuDevis, questionsEnTexte, texteEnQuestions, themesDeQuestions } from "../public/admin/js/lib/questions.js";
import { carteIncompatibilites, conflitsAvec } from "../public/admin/js/lib/incompatibilites.js";
import { validerGrille } from "../src/admin/grille.js";
import { creerDevis, lireDevis, modifierSuiviDevis, syntheseDevis } from "../src/admin/devis.js";
import { genererPdf, vueSynthese } from "../src/admin/pdf.js";
import { ajouterClient, creerApplication, ligne, lireGrille, lirePolices } from "./outils/application.js";

const lisible = (t) => t.replace(/[  ]/g, " ");
const FORME = "Couleurs : celles de la marque, celles à éviter ? Plutôt fond clair ou sombre ?";
const PROJET = "Quel est le projet en une phrase, et pour qui (clientèle, cible) ?";

test("questions de la grille : thèmes pour un site, dont la forme et l'identité visuelle", () => {
  const grille = lireGrille();
  const site = grille.categories.find((c) => c.id === "site");
  assert.deepEqual(themesDeQuestions(site.questions).map((t) => t.theme), ["Projet et contenu", "Forme et identité visuelle"]);
  const groupes = questionsDuDevis(grille, ["site"]);
  assert.deepEqual(groupes.map((g) => g.titre), ["Général", "Sites web"]);
  assert.ok(groupes[1].themes[1].questions.includes(FORME));
  assert.ok(groupes[1].themes[1].questions.some((q) => q.startsWith("Typographie")));
});

test("édition des questions : « ## Thème » ouvre un thème, aller-retour sans perte", () => {
  const liste = ["Question libre ?", { theme: "Forme", questions: ["Couleurs ?", "Typographie ?"] }];
  const texte = questionsEnTexte(liste);
  assert.equal(texte, "Question libre ?\n## Forme\nCouleurs ?\nTypographie ?");
  assert.deepEqual(texteEnQuestions(texte), liste);
  // Les lignes vides sont ignorées ; un thème sans question disparaît
  assert.deepEqual(texteEnQuestions("## Forme\n\n  Couleurs ?  "), [{ theme: "Forme", questions: ["Couleurs ?"] }]);
  assert.deepEqual(texteEnQuestions("## Vide\n## Plein\nQuestion ?"), [{ theme: "Plein", questions: ["Question ?"] }]);
});

test("incompatibilités : réciproques, et signalées face aux prestations déjà choisies", () => {
  const carte = carteIncompatibilites(lireGrille());
  assert.ok(carte.get("opt-paiement").has("site-ecommerce"));
  assert.ok(carte.get("site-ecommerce").has("opt-paiement"));
  assert.deepEqual(conflitsAvec(carte, "opt-page", ["site-onepage", "opt-seo"]), ["site-onepage"]);
  assert.deepEqual(conflitsAvec(carte, "opt-page", ["site-vitrine"]), []);
  assert.deepEqual(conflitsAvec(carte, "site-onepage", ["opt-page", "opt-blog"]), ["opt-page", "opt-blog"]);
});

test("grille : incompatibilités et thèmes validés", () => {
  assert.deepEqual(validerGrille(lireGrille()), []);
  const g = lireGrille();
  g.categories[0].prestations[0].incompatible_avec = ["inexistante"];
  g.categories[0].questions.push({ theme: "", questions: ["?"] });
  const erreurs = validerGrille(g).join("\n");
  assert.match(erreurs, /incompatible_avec/);
  assert.match(erreurs, /liste de textes \(ou de thèmes\)/);
});

async function devisAvecCadrage() {
  const app = creerApplication();
  const client = await ajouterClient(app);
  const devis = await creerDevis(app, {
    client_id: client.id,
    objet: "Site vitrine du café",
    mode: "forfait",
    delai_execution: "20 jours",
    lignes: [ligne("Site vitrine jusqu'à 5 pages", 1, 1800, { ref: "site-vitrine" }), ligne("Page supplémentaire", 2, 150, { ref: "opt-page", unite: "page" })],
  });
  await modifierSuiviDevis(app, devis.id, {
    notes: "Le gérant hésite sur la boutique.",
    cadrage: {
      types: ["site"],
      questions: [
        { question: PROJET, reponse: "Présenter le café et la carte.", theme: "Général" },
        { question: FORME, reponse: "Terracotta et crème, fond clair.", theme: "Sites web · Forme et identité visuelle" },
        { question: "Photos pro à prévoir ?", reponse: "Séance photo en mars.", perso: true, theme: "Questions ajoutées" },
      ],
    },
  });
  return { app, devis };
}

test("synthèse à partager : prestations sans prix, réponses par thème, points à préciser, validation, sans les notes", async () => {
  const { app, devis } = await devisAvecCadrage();
  const { octets, nom } = await syntheseDevis(app, devis.id);
  assert.equal(nom, `synthese-${devis.numero}.pdf`);
  assert.ok(octets.length > 1000);

  const relu = await lireDevis(app, devis.id);
  const { textes } = await genererPdf(vueSynthese(relu, app.grilleInitiale, { aujourdhui: "2026-10-16" }), lirePolices());
  const texte = lisible(textes.join(" "));
  for (const attendu of [
    "Synthèse du projet", `Devis ${devis.numero}`, "Prestations retenues", "Site vitrine jusqu'à 5 pages", "Page supplémentaire (2 pages)",
    "Délai d’exécution", "20 jours", "Général", "Présenter le café et la carte.",
    "Sites web · Forme et identité visuelle", "Terracotta et crème, fond clair.",
    "Questions ajoutées", "Séance photo en mars.", "Points restant à préciser", "Validation du projet",
  ]) {
    assert.ok(texte.includes(attendu), `absent de la synthèse : « ${attendu} »`);
  }
  assert.ok(texte.includes("Typographie"), "les questions sans réponse sont listées à préciser");
  assert.ok(!texte.includes("hésite"), "les notes internes ne sont pas dans la version à partager");
  assert.ok(!texte.includes("1 800,00"), "pas de prix dans la synthèse");
});

test("synthèse interne : avec les notes, sans cadre de validation", async () => {
  const { app, devis } = await devisAvecCadrage();
  const relu = await lireDevis(app, devis.id);
  const { textes } = await genererPdf(vueSynthese(relu, app.grilleInitiale, { avecNotes: true, aujourdhui: "2026-10-16" }), lirePolices());
  const texte = lisible(textes.join(" "));
  assert.ok(texte.includes("Notes internes"));
  assert.ok(texte.includes("Le gérant hésite sur la boutique."));
  assert.ok(!texte.includes("Validation du projet"));
  const { nom } = await syntheseDevis(app, devis.id, { avecNotes: true });
  assert.equal(nom, `synthese-${devis.numero}-interne.pdf`);
});
