/* Connecteur de facturation électronique interchangeable, et import de data/grille.json */

import { test } from "node:test";
import assert from "node:assert/strict";
import { creerFacture, emettreFacture, lireFacture, transmettreFacture } from "../src/admin/factures.js";
import { connecteurFacturation } from "../src/admin/connecteurs/index.js";
import { enregistrerGrille, fichierGrilleAImporter, grilleCourante, importerGrilleDuFichier, validerGrille } from "../src/admin/grille.js";
import { ajouterClient, creerApplication, grilleComplete, ligne, lireGrille } from "./outils/application.js";

// Plateforme agréée simulée : enregistre ce qu'elle reçoit
function plateforme(reponses) {
  const recues = [];
  return {
    recues,
    nom: "simulee",
    libelle: "Plateforme simulée",
    async transmettre({ facture, pdf }) {
      recues.push({ numero: facture.numero, montant: facture.montant_ttc, siren: facture.contexte.client.siren, pdf: pdf?.length });
      const reponse = reponses.shift();
      if (reponse instanceof Error) throw reponse;
      return reponse;
    },
  };
}

async function brouillon(app) {
  const client = await ajouterClient(app);
  return creerFacture(app, { client_id: client.id, lignes: [ligne("Abonnement", 1, 29)] });
}

test("par défaut, aucun connecteur : rien n'est transmis", async () => {
  assert.equal(connecteurFacturation({}).nom, "aucun");
  assert.equal(connecteurFacturation({ FACTURATION_ELECTRONIQUE: "aucun" }).nom, "aucun");
  assert.throws(() => connecteurFacturation({ FACTURATION_ELECTRONIQUE: "inconnue" }), /inconnu/);

  const app = creerApplication();
  app.connecteur = connecteurFacturation({});
  const f = await emettreFacture(app, (await brouillon(app)).id);
  assert.equal(f.transmission, null);
});

test("connecteur branché : la facture émise lui est transmise avec ses données et son PDF", async () => {
  const app = creerApplication();
  app.connecteur = plateforme([{ statut: "deposee", reference: "PA-123" }]);
  const f = await emettreFacture(app, (await brouillon(app)).id);
  assert.deepEqual(app.connecteur.recues, [{ numero: "F-2026-001", montant: 2900, siren: "987654321", pdf: app.r2.objets.get(f.pdf_cle).octets.length }]);
  assert.equal(f.transmission.statut, "deposee");
  assert.equal(f.transmission.reference, "PA-123");
  assert.equal(f.avertissement, null);
});

test("transmission en échec : la facture reste émise, l'échec est noté et se relance", async () => {
  const app = creerApplication();
  app.connecteur = plateforme([new Error("plateforme indisponible"), { statut: "deposee", reference: "PA-456" }]);
  const f = await emettreFacture(app, (await brouillon(app)).id);
  assert.equal(f.numero, "F-2026-001");
  assert.equal(f.transmission.statut, "erreur");
  assert.match(f.avertissement, /plateforme indisponible/);

  await transmettreFacture(app, f.id);
  const relue = await lireFacture(app, f.id);
  assert.equal(relue.transmission.statut, "deposee");
  assert.equal(relue.montant_ttc, 2900); // le contenu de la facture n'a pas bougé
  await assert.rejects(transmettreFacture(app, f.id), /déjà été transmise/);
});

test("data/grille.json : catégorie Outils de gestion et formule de site unique, valides", () => {
  const g = lireGrille();
  assert.deepEqual(validerGrille(g), []);
  const gestion = g.categories.find((c) => c.id === "gestion");
  assert.deepEqual(gestion.prestations.map((p) => [p.id, p.prix, p.unite]), [
    ["gest-installation", 1200, "forfait"],
    ["gest-abonnement", 29, "mois"],
    ["gest-personnalisation", 400, "jour"],
  ]);
  assert.equal(g.categories.find((c) => c.id === "site").choix_unique, true);
  g.categories[0].choix_unique = "oui";
  assert.match(validerGrille(g).join(" "), /choix_unique/);
});

test("fichier grille modifié depuis son import : proposé, importé sans perdre l'émetteur rempli dans l'admin", async () => {
  const app = creerApplication({ grille: lireGrille() }); // fichier avec « À COMPLÉTER »
  await grilleCourante(app); // premier import automatique
  assert.equal(await fichierGrilleAImporter(app), false);

  // SIREN, IBAN… remplis dans l'admin
  await enregistrerGrille(app, grilleComplete());
  assert.equal(await fichierGrilleAImporter(app), false);

  // Le fichier change (nouvelle prestation), puis déploiement
  app.grilleInitiale = lireGrille();
  app.grilleInitiale.categories[0].prestations.push({ id: "site-landing", nom: "Page d'atterrissage", prix: 600, unite: "forfait" });
  assert.equal(await fichierGrilleAImporter(app), true);

  const importee = await importerGrilleDuFichier(app);
  assert.ok(importee.contenu.categories[0].prestations.some((p) => p.id === "site-landing"));
  assert.equal(importee.contenu.emetteur.siren, "123 456 789");
  assert.equal(importee.contenu.emetteur.iban, "FR76 1234 5678 9012 3456 7890 123");
  assert.equal(await fichierGrilleAImporter(app), false);
});
