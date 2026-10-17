/* data/grille.json : valide, et contrôles de la page « Grille tarifaire » */

import { test } from "node:test";
import assert from "node:assert/strict";
import { construireContexte, emetteurIncomplet, enregistrerGrille, grilleCourante, validerGrille } from "../src/admin/grille.js";
import { creerApplication, grilleComplete, lireGrille } from "./outils/application.js";

test("data/grille.json est une grille valide", () => {
  assert.deepEqual(validerGrille(lireGrille()), []);
});

test("les informations à compléter sont signalées (et bloquent l'émission)", () => {
  assert.deepEqual(emetteurIncomplet(lireGrille()), ["SIREN", "RCS", "e-mail", "IBAN"]);
  assert.deepEqual(emetteurIncomplet(grilleComplete()), []);
  // Assujetti à la TVA : le numéro de TVA intracommunautaire devient obligatoire
  const assujetti = grilleComplete((g) => ({ ...g, tva: { ...g.tva, regime: "assujetti" } }));
  assert.deepEqual(emetteurIncomplet(assujetti), ["n° de TVA intracommunautaire"]);
});

test("passage à la TVA à 20 % sans toucher au code", () => {
  const franchise = construireContexte(lireGrille(), 1, null);
  assert.deepEqual(franchise.tva, { regime: "franchise_en_base", taux: 0, mention: "TVA non applicable, art. 293 B du CGI" });
  const assujetti = construireContexte({ ...lireGrille(), tva: { ...lireGrille().tva, regime: "assujetti" } }, 1, null);
  assert.deepEqual(assujetti.tva, { regime: "assujetti", taux: 2000, mention: "" });
});

test("erreurs détectées : prix négatif, identifiant en double, échéancier ≠ 100 %", () => {
  const g = lireGrille();
  g.categories[0].prestations[0].prix = -5;
  g.categories[1].prestations[0].id = g.categories[0].prestations[1].id;
  g.conditions.echeancier_forfait[0].pourcentage = 0.5;
  const erreurs = validerGrille(g).join("\n");
  assert.match(erreurs, /prix doit être un nombre positif/);
  assert.match(erreurs, /déjà utilisé/);
  assert.match(erreurs, /100 %/);
});

test("chaque enregistrement crée une nouvelle version ; une grille invalide est refusée", async () => {
  const app = creerApplication();
  const premiere = await grilleCourante(app);
  assert.equal(premiere.id, 1);
  const g = grilleComplete();
  g.categories[0].prestations[0].prix = 950;
  await enregistrerGrille(app, g);
  const courante = await grilleCourante(app);
  assert.equal(courante.id, 2);
  assert.equal(courante.contenu.categories[0].prestations[0].prix, 950);
  await assert.rejects(enregistrerGrille(app, { ...g, tva: { regime: "inconnu" } }), /erreurs/);
  assert.equal((await grilleCourante(app)).id, 2);
});
