/* Parcours complet : devis → envoi → acceptation → acompte, intermédiaire, solde */

import { test } from "node:test";
import assert from "node:assert/strict";
import { changerStatutDevis, creerDevis, dupliquerDevis, envoyerDevis, lireDevis, modifierDevis } from "../src/admin/devis.js";
import { creerFactureDepuisDevis, emettreFacture, enregistrerPaiement } from "../src/admin/factures.js";
import { enregistrerGrille, prestationsDeLaGrille } from "../src/admin/grille.js";
import { enCentimes } from "../public/admin/js/lib/format.js";
import { ajouterClient, creerApplication, grilleComplete, ligne } from "./outils/application.js";

// Ligne de devis à partir d'une prestation de la grille (ce que fait l'interface)
function depuisLaGrille(grille, id, quantite = 1) {
  const p = prestationsDeLaGrille(grille).find((x) => x.id === id);
  return {
    ref: p.id,
    designation: p.nom,
    description: p.description || "",
    unite: p.unite,
    quantite,
    prix_unitaire: p.prix_pourcentage === undefined ? enCentimes(p.prix) : null,
    pourcentage: p.prix_pourcentage === undefined ? null : Math.round(p.prix_pourcentage * 10000),
  };
}

async function devisAccepte() {
  const app = creerApplication();
  const grille = app.grilleInitiale;
  const client = await ajouterClient(app);
  const devis = await creerDevis(app, {
    client_id: client.id,
    objet: "Site vitrine",
    mode: "forfait",
    lignes: [depuisLaGrille(grille, "site-vitrine"), depuisLaGrille(grille, "opt-page", 2)],
    remise: { type: "pourcentage", valeur: 1500, libelle: "Offre de lancement", ref: "rem-lancement" },
  });
  await envoyerDevis(app, devis.id);
  await changerStatutDevis(app, devis.id, "accepte");
  return { app, client, devis: await lireDevis(app, devis.id) };
}

test("les prix viennent de la grille et le devis les garde si la grille change", async () => {
  const app = creerApplication();
  const client = await ajouterClient(app);
  const grille = app.grilleInitiale;
  const prixGrille = prestationsDeLaGrille(grille).find((p) => p.id === "site-vitrine").prix;
  const devis = await creerDevis(app, { client_id: client.id, mode: "forfait", lignes: [depuisLaGrille(grille, "site-vitrine")] });
  assert.equal(devis.montant_ht, enCentimes(prixGrille));

  await enregistrerGrille(app, grilleComplete((g) => {
    g.categories[0].prestations.find((p) => p.id === "site-vitrine").prix = 2500;
    return g;
  }));
  const relu = await lireDevis(app, devis.id);
  assert.equal(relu.lignes[0].prix_unitaire, enCentimes(prixGrille));
  assert.equal(relu.montant_ht, enCentimes(prixGrille));
});

test("devis : totaux, validité de 30 jours et échéancier", async () => {
  const { devis } = await devisAccepte();
  assert.equal(devis.calcul.sous_total, 210000); // 1 800 + 2 × 150
  assert.equal(devis.montant_ht, 178500); // − 15 %
  assert.equal(devis.montant_ttc, 178500); // franchise de TVA
  assert.equal(devis.date_fin_validite, "2026-11-15");
  assert.deepEqual(devis.echeancier.map((e) => e.montant_ttc), [53550, 71400, 53550]);
});

test("devis envoyé : figé, son PDF est archivé ; on le duplique pour le modifier", async () => {
  const { app, client, devis } = await devisAccepte();
  assert.equal(devis.pdf_cle, "devis/2026/D-2026-001.pdf");
  assert.ok(app.r2.objets.has(devis.pdf_cle));
  await assert.rejects(modifierDevis(app, devis.id, { client_id: client.id, mode: "forfait", lignes: [] }), /Dupliquez-le/);
  const copie = await dupliquerDevis(app, devis.id);
  assert.equal(copie.numero, "D-2026-002");
  assert.equal(copie.statut, "brouillon");
  assert.equal(copie.montant_ttc, devis.montant_ttc);
});

test("devis expiré après 30 jours sans réponse", async () => {
  const app = creerApplication();
  const client = await ajouterClient(app);
  const devis = await creerDevis(app, { client_id: client.id, mode: "forfait", lignes: [ligne("Audit", 1, 450)] });
  await envoyerDevis(app, devis.id);
  app.aujourdhui = "2026-11-15";
  assert.equal((await lireDevis(app, devis.id)).statut_affiche, "envoye");
  app.aujourdhui = "2026-11-16";
  assert.equal((await lireDevis(app, devis.id)).statut_affiche, "expire");
});

test("acompte 30 %, intermédiaire 40 %, solde : la somme facturée égale le devis", async () => {
  const { app, devis } = await devisAccepte();
  const acompte = await emettreFacture(app, (await creerFactureDepuisDevis(app, devis.id, 0)).id);
  assert.equal(acompte.type, "acompte");
  assert.equal(acompte.montant_ttc, 53550);
  assert.match(acompte.lignes[0].designation, /^Acompte de 30/);

  const intermediaire = await emettreFacture(app, (await creerFactureDepuisDevis(app, devis.id, 1)).id);
  assert.equal(intermediaire.type, "intermediaire");
  assert.equal(intermediaire.montant_ttc, 71400);

  const solde = await emettreFacture(app, (await creerFactureDepuisDevis(app, devis.id, 2)).id);
  assert.equal(solde.type, "solde");
  assert.equal(solde.calcul.total_ttc, 178500); // la facture de solde reprend toute la prestation…
  assert.deepEqual(solde.deductions.map((d) => d.numero), ["F-2026-001", "F-2026-002"]); // …moins les acomptes
  assert.equal(solde.montant_ttc, 53550);
  assert.equal(acompte.montant_ttc + intermediaire.montant_ttc + solde.montant_ttc, devis.montant_ttc);
});

test("une étape déjà facturée ne peut pas l'être deux fois ; un devis non accepté ne se facture pas", async () => {
  const { app, client, devis } = await devisAccepte();
  await emettreFacture(app, (await creerFactureDepuisDevis(app, devis.id, 0)).id);
  await assert.rejects(creerFactureDepuisDevis(app, devis.id, 0), /déjà facturée \(F-2026-001\)/);

  const autre = await creerDevis(app, { client_id: client.id, mode: "forfait", lignes: [ligne("Audit", 1, 450)] });
  await assert.rejects(creerFactureDepuisDevis(app, autre.id, 0), /devis accepté/);
});

test("facture directe d'abonnement et paiement", async () => {
  const { app, client } = await devisAccepte();
  const { creerFacture } = await import("../src/admin/factures.js");
  const brouillon = await creerFacture(app, {
    client_id: client.id,
    objet: "Abonnement",
    prestation_debut: "2026-10-01",
    prestation_fin: "2026-10-31",
    lignes: [depuisLaGrille(app.grilleInitiale, "abo-essentiel")],
  });
  const facture = await emettreFacture(app, brouillon.id);
  assert.equal(facture.montant_ttc, 3900);
  const payee = await enregistrerPaiement(app, facture.id, { date_paiement: "2026-10-16", montant: 3900 });
  assert.equal(payee.statut_affiche, "payee");
});
