/* ==========================================================================
   Numérotation : D-AAAA-NNN (devis), F-AAAA-NNN (factures), A-AAAA-NNN (avoirs)
   --------------------------------------------------------------------------
   Le compteur de la série et de l'année est incrémenté dans le même batch D1
   que l'écriture du numéro sur le document. Un batch D1 est une transaction :
   soit les deux instructions passent, soit aucune. D'où :
     - pas de doublon : le numéro est lu dans le compteur au moment de
       l'écriture (D1 exécute les écritures l'une après l'autre), et la
       colonne numero est UNIQUE ;
     - pas de trou pour les factures : le compteur n'avance que si la facture
       est encore un brouillon, une facture émise n'est jamais supprimée
       (trigger SQL) et un brouillon n'a pas de numéro.
   ========================================================================== */

// Numéro formaté à partir du compteur : ?1 = série, ?2 = année
export const SQL_NUMERO = "(SELECT printf('%s-%d-%03d', serie, annee, dernier) FROM compteurs WHERE serie = ?1 AND annee = ?2)";

// Incrémente (ou crée) le compteur : ?1 = série, ?2 = année
const SQL_INCREMENTER = `INSERT INTO compteurs (serie, annee, dernier) VALUES (?1, ?2, 1)
  ON CONFLICT (serie, annee) DO UPDATE SET dernier = dernier + 1`;

// Idem, seulement si la facture ?3 est encore un brouillon
const SQL_INCREMENTER_SI_BROUILLON = `INSERT INTO compteurs (serie, annee, dernier)
  SELECT ?1, ?2, 1 WHERE EXISTS (SELECT 1 FROM factures WHERE id = ?3 AND statut = 'brouillon')
  ON CONFLICT (serie, annee) DO UPDATE SET dernier = dernier + 1`;

/**
 * Instructions du batch qui crée un devis numéroté.
 * insertion : requête INSERT … RETURNING id dont ?1 et ?2 sont réservés
 * à la série et à l'année (le numéro s'écrit ${SQL_NUMERO}).
 */
export function batchNouveauDevis(db, annee, insertion, parametres) {
  return [db.prepare(SQL_INCREMENTER).bind("D", annee), db.prepare(insertion).bind("D", annee, ...parametres)];
}

/**
 * Émet une facture ou un avoir : attribue le numéro et fige le contenu.
 * champs : colonnes à écrire en même temps (date_emission obligatoire).
 * Renvoie le numéro attribué, ou null si la facture n'était plus un brouillon.
 */
export async function attribuerNumeroFacture(db, { id, serie, annee, champs }) {
  const colonnes = Object.keys(champs);
  const affectations = colonnes.map((colonne, i) => `${colonne} = ?${i + 4}`).join(", ");
  const [, miseAJour] = await db.batch([
    db.prepare(SQL_INCREMENTER_SI_BROUILLON).bind(serie, annee, id),
    db
      .prepare(
        `UPDATE factures SET numero = ${SQL_NUMERO}, statut = 'emise', ${affectations},
           modifie_le = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?3 AND statut = 'brouillon' RETURNING numero`
      )
      .bind(serie, annee, id, ...colonnes.map((colonne) => champs[colonne])),
  ]);
  return miseAJour.results?.[0]?.numero ?? null;
}
