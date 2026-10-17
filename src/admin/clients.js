/* Fiches clients */

import { ErreurMetier, introuvable } from "./http.js";
import * as v from "./validation.js";

const EMAIL_RE = /^[^\s@<>"(),;:\\]+@[^\s@<>"(),;:\\]+\.[^\s@<>"(),;:\\]{2,}$/;

function validerClient(donnees) {
  const type = donnees?.type;
  if (type !== "particulier" && type !== "professionnel") {
    throw new ErreurMetier("Indiquez s'il s'agit d'un particulier ou d'un professionnel.", 422);
  }
  const siren = v.texte(donnees.siren, "SIREN", 20).replace(/\s/g, "");
  if (type === "professionnel" && !/^\d{9}$/.test(siren)) {
    throw new ErreurMetier("SIREN : 9 chiffres attendus pour un client professionnel.", 422);
  }
  const email = v.texte(donnees.email, "E-mail", 254);
  if (email && !EMAIL_RE.test(email)) throw new ErreurMetier("E-mail : adresse invalide.", 422);
  return {
    type,
    nom: v.texte(donnees.nom, "Nom ou raison sociale", 200, { requis: true }),
    siren: type === "professionnel" ? siren : "",
    adresse: v.texte(donnees.adresse, "Adresse", 500, { requis: true, multiligne: true }),
    code_postal: v.texte(donnees.code_postal, "Code postal", 20, { requis: true }),
    ville: v.texte(donnees.ville, "Ville", 120, { requis: true }),
    pays: v.texte(donnees.pays, "Pays", 80) || "France",
    email,
  };
}

export async function listerClients(app) {
  const { results } = await app.db
    .prepare(
      `SELECT c.*,
         (SELECT COUNT(*) FROM devis d WHERE d.client_id = c.id) AS nb_devis,
         (SELECT COUNT(*) FROM factures f WHERE f.client_id = c.id) AS nb_factures
       FROM clients c ORDER BY c.nom COLLATE NOCASE`
    )
    .all();
  return results;
}

export async function lireClient(app, id) {
  const client = await app.db.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
  if (!client) throw introuvable("Client");
  return client;
}

export async function creerClient(app, donnees) {
  const c = validerClient(donnees);
  const ligne = await app.db
    .prepare(
      `INSERT INTO clients (type, nom, siren, adresse, code_postal, ville, pays, email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(c.type, c.nom, c.siren, c.adresse, c.code_postal, c.ville, c.pays, c.email)
    .first();
  return ligne;
}

/** Les documents déjà envoyés ou émis gardent la copie du client prise à ce moment-là */
export async function modifierClient(app, id, donnees) {
  await lireClient(app, id);
  const c = validerClient(donnees);
  return app.db
    .prepare(
      `UPDATE clients SET type = ?, nom = ?, siren = ?, adresse = ?, code_postal = ?, ville = ?, pays = ?, email = ?,
         modifie_le = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE id = ? RETURNING *`
    )
    .bind(c.type, c.nom, c.siren, c.adresse, c.code_postal, c.ville, c.pays, c.email, id)
    .first();
}

export async function supprimerClient(app, id) {
  const client = await app.db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM devis WHERE client_id = ?1) + (SELECT COUNT(*) FROM factures WHERE client_id = ?1) AS documents,
         EXISTS (SELECT 1 FROM clients WHERE id = ?1) AS existe`
    )
    .bind(id)
    .first();
  if (!client.existe) throw introuvable("Client");
  if (client.documents > 0) throw new ErreurMetier("Ce client a des devis ou des factures : il ne peut pas être supprimé.");
  await app.db.prepare("DELETE FROM clients WHERE id = ?").bind(id).run();
}
