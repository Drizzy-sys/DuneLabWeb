/* ==========================================================================
   Incompatibilités entre prestations de la grille (« incompatible_avec »).
   Toujours réciproques : déclarer Paiement en ligne incompatible avec
   Boutique en ligne suffit pour que l'inverse soit vrai aussi.
   ========================================================================== */

/** Map identifiant → Set des identifiants incompatibles, dans les deux sens */
export function carteIncompatibilites(grille) {
  const prestations = (grille.categories || []).flatMap((c) => c.prestations || []);
  const carte = new Map(prestations.map((p) => [p.id, new Set()]));
  for (const p of prestations) {
    for (const autre of p.incompatible_avec || []) {
      if (!carte.has(autre) || autre === p.id) continue;
      carte.get(p.id).add(autre);
      carte.get(autre).add(p.id);
    }
  }
  return carte;
}

/** Prestations déjà choisies (refs) qui empêchent la prestation `id` */
export function conflitsAvec(carte, id, refs) {
  const incompatibles = carte.get(id);
  return incompatibles ? refs.filter((ref) => incompatibles.has(ref)) : [];
}
