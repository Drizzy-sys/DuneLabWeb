/* Une facture émise ne peut plus être modifiée ni supprimée : on la corrige par un avoir */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annulerPaiement,
  creerAvoir,
  creerFacture,
  emettreFacture,
  enregistrerPaiement,
  lireFacture,
  modifierFacture,
  modifierNotes,
  pdfFacture,
  supprimerFacture,
} from "../src/admin/factures.js";
import { enregistrerGrille } from "../src/admin/grille.js";
import { ajouterClient, creerApplication, grilleComplete, ligne } from "./outils/application.js";

async function factureEmise() {
  const app = creerApplication();
  const client = await ajouterClient(app);
  const brouillon = await creerFacture(app, {
    client_id: client.id,
    objet: "Maintenance Sérénité, octobre",
    prestation_debut: "2026-10-01",
    prestation_fin: "2026-10-31",
    lignes: [ligne("Maintenance Sérénité", 1, 89)],
  });
  const facture = await emettreFacture(app, brouillon.id);
  return { app, client, facture };
}

const sql = (app, requete, ...parametres) => () => app.db.sqlite.prepare(requete).run(...parametres);

test("un brouillon se modifie et se supprime librement", async () => {
  const app = creerApplication();
  const client = await ajouterClient(app);
  const f = await creerFacture(app, { client_id: client.id, lignes: [ligne("Conseil", 2, 60)] });
  const modifiee = await modifierFacture(app, f.id, { client_id: client.id, lignes: [ligne("Conseil", 3, 60)] });
  assert.equal(modifiee.montant_ttc, 18000);
  await supprimerFacture(app, f.id);
  await assert.rejects(lireFacture(app, f.id), /introuvable/);
});

test("facture émise : modification refusée par l'application", async () => {
  const { app, client, facture } = await factureEmise();
  await assert.rejects(
    modifierFacture(app, facture.id, { client_id: client.id, lignes: [ligne("Maintenance", 1, 1)] }),
    /modification interdite/
  );
  assert.equal((await lireFacture(app, facture.id)).montant_ttc, 8900);
});

test("facture émise : suppression refusée par l'application", async () => {
  const { app, facture } = await factureEmise();
  await assert.rejects(supprimerFacture(app, facture.id), /suppression interdite/);
});

test("facture émise : la base refuse toute modification du contenu, même en SQL direct", async () => {
  const { app, facture } = await factureEmise();
  const refus = /Facture émise : modification interdite/;
  assert.throws(sql(app, "UPDATE factures SET montant_ttc = 1 WHERE id = ?", facture.id), refus);
  assert.throws(sql(app, "UPDATE factures SET lignes = '[]' WHERE id = ?", facture.id), refus);
  assert.throws(sql(app, "UPDATE factures SET numero = 'F-2026-999' WHERE id = ?", facture.id), refus);
  assert.throws(sql(app, "UPDATE factures SET date_emission = '2026-01-01' WHERE id = ?", facture.id), refus);
  assert.throws(sql(app, "UPDATE factures SET client_id = client_id + 1 WHERE id = ?", facture.id), refus);
  assert.throws(sql(app, "UPDATE factures SET contexte = '{}' WHERE id = ?", facture.id), refus);
  assert.throws(sql(app, "UPDATE factures SET statut = 'brouillon', numero = NULL, date_emission = NULL WHERE id = ?", facture.id), refus);
  assert.throws(sql(app, "UPDATE factures SET pdf_cle = 'autre.pdf' WHERE id = ?", facture.id), refus);
  assert.equal((await lireFacture(app, facture.id)).montant_ttc, 8900);
});

test("facture émise : la base refuse la suppression, même en SQL direct", async () => {
  const { app, facture } = await factureEmise();
  assert.throws(sql(app, "DELETE FROM factures WHERE id = ?", facture.id), /suppression interdite/);
  assert.throws(sql(app, "DELETE FROM factures"), /suppression interdite/);
});

test("facture émise : paiement, annulation du paiement et notes internes restent possibles", async () => {
  const { app, facture } = await factureEmise();
  const payee = await enregistrerPaiement(app, facture.id, { date_paiement: "2026-10-16", montant: 8900 });
  assert.equal(payee.statut_affiche, "payee");
  assert.equal(payee.date_paiement, "2026-10-16");
  const annulee = await annulerPaiement(app, facture.id);
  assert.equal(annulee.statut, "emise");
  assert.equal((await modifierNotes(app, facture.id, "Relancé par téléphone")).notes, "Relancé par téléphone");
});

test("paiement : date dans le futur ou avant l'émission refusée", async () => {
  const { app, facture } = await factureEmise();
  await assert.rejects(enregistrerPaiement(app, facture.id, { date_paiement: "2026-10-17", montant: 8900 }), /futur/);
  await assert.rejects(enregistrerPaiement(app, facture.id, { date_paiement: "2026-10-01", montant: 8900 }), /précède/);
});

test("en retard : échéance dépassée et facture non payée", async () => {
  const { app, facture } = await factureEmise();
  assert.equal((await lireFacture(app, facture.id)).statut_affiche, "emise");
  app.aujourdhui = "2026-11-16";
  assert.equal((await lireFacture(app, facture.id)).statut_affiche, "en_retard");
});

test("correction par avoir : la facture d'origine est annulée, l'avoir est lui aussi verrouillé", async () => {
  const { app, facture } = await factureEmise();
  const brouillon = await creerAvoir(app, facture.id);
  assert.equal(brouillon.type, "avoir");
  assert.equal(brouillon.facture_origine_id, facture.id);
  assert.equal(brouillon.montant_ttc, 8900);
  const avoir = await emettreFacture(app, brouillon.id);
  assert.equal(avoir.numero, "A-2026-001");
  assert.equal((await lireFacture(app, facture.id)).statut_affiche, "annulee");
  assert.throws(sql(app, "DELETE FROM factures WHERE id = ?", avoir.id), /suppression interdite/);
  await assert.rejects(creerAvoir(app, facture.id), /déjà entièrement annulée/);
});

test("un avoir ne peut pas dépasser le montant restant de la facture", async () => {
  const { app, facture } = await factureEmise();
  const brouillon = await creerAvoir(app, facture.id);
  await modifierFacture(app, brouillon.id, { lignes: [ligne("Annulation", 1, 100)] });
  await assert.rejects(emettreFacture(app, brouillon.id), /dépasse le montant restant/);
});

test("le PDF est archivé dans R2 à l'émission et ne change plus, même si la grille change", async () => {
  const { app, facture } = await factureEmise();
  assert.equal(facture.pdf_cle, "factures/2026/F-2026-001.pdf");
  assert.match(facture.pdf_sha256, /^[0-9a-f]{64}$/);
  const archive = app.r2.objets.get(facture.pdf_cle).octets;

  // Nouvel IBAN et passage à la TVA après l'émission
  await enregistrerGrille(app, grilleComplete((g) => {
    g.emetteur.iban = "FR76 0000 0000 0000 0000 0000 000";
    g.tva.regime = "assujetti";
    return g;
  }));
  app.aujourdhui = "2027-03-01";
  const { octets } = await pdfFacture(app, facture.id);
  assert.deepEqual(octets, archive);
  const relue = await lireFacture(app, facture.id);
  assert.equal(relue.contexte.emetteur.iban, "FR76 1234 5678 9012 3456 7890 123");
  assert.equal(relue.montant_tva, 0);
});

test("PDF effacé de R2 : recréé seulement s'il est identique à l'original (empreinte SHA-256)", async () => {
  const { app, facture } = await factureEmise();
  const original = app.r2.objets.get(facture.pdf_cle).octets;
  app.r2.objets.delete(facture.pdf_cle);
  app.aujourdhui = "2030-01-01";
  const { octets } = await pdfFacture(app, facture.id);
  assert.deepEqual(octets, original);
});
