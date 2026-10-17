/* ==========================================================================
   Abonnements dans un devis : les lignes à l'unité « mois » ou « an » ne font
   pas partie du forfait. Elles sortent du total, de l'échéancier et de la
   remise, s'affichent à part (« puis 29,00 € HT/mois… ») et sont facturées
   chaque période, à partir de la livraison.
   Partagé entre le navigateur et le Worker.
   ========================================================================== */

import { formaterMontant } from "./format.js";

// Unité de la grille → durée d'une période, en mois
export const PERIODES = { mois: 1, an: 12 };

export function periodeDeLigne(ligne) {
  const unite = String(ligne?.unite ?? "").trim().toLowerCase();
  return Object.hasOwn(PERIODES, unite) ? unite : null;
}

export function estLigneRecurrente(ligne) {
  return periodeDeLigne(ligne) !== null;
}

/**
 * « puis 29,00 € HT/mois à partir de la mise en ligne, engagement 12 mois »
 * periodes : [{ unite: "mois", total_ht }] ; conditions : contexte du document.
 */
export function phraseAbonnement(periodes, conditions = {}) {
  if (!periodes?.length) return "";
  const montants = periodes.map((p) => `${formaterMontant(p.total_ht)} HT/${p.unite}`).join(" et ");
  const debut = conditions.abonnement_debut ? ` ${conditions.abonnement_debut}` : "";
  const engagement = conditions.abonnement_engagement_mois ? `, engagement ${conditions.abonnement_engagement_mois} mois` : "";
  return `puis ${montants}${debut}${engagement}`;
}
