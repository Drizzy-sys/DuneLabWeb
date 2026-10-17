/* ==========================================================================
   Facturation électronique : connecteur vers une plateforme agréée (PA)
   --------------------------------------------------------------------------
   À partir de septembre 2027, une facture émise doit être transmise par une
   plateforme agréée. Chaque plateforme (Qonto ou autre) a son connecteur,
   interchangeable : on choisit lequel dans wrangler.jsonc, variable
   FACTURATION_ELECTRONIQUE (« aucun » tant que rien n'est branché).

   Contrat d'un connecteur (voir aucun.js) :
     nom          identifiant, celui de FACTURATION_ELECTRONIQUE
     libelle      nom affiché dans l'admin
     transmettre({ facture, pdf, env })
                  facture : document émis (lignes, montants, contexte figé :
                  émetteur, client, TVA, mentions) ; pdf : octets archivés.
                  Renvoie { statut, reference?, message? }, statut parmi
                  « deposee » (acceptée par la plateforme) ou « rejetee ».
                  Le format attendu par la plateforme (Factur-X, UBL, CII)
                  se construit dans le connecteur, à partir de ces données.
     suivre({ reference, env })     facultatif : statut du cycle de vie
                  (reçue, acceptée, refusée, encaissée…).
   Pour ajouter une plateforme : créer connecteurs/<nom>.js sur ce modèle,
   l'inscrire dans CONNECTEURS, puis régler FACTURATION_ELECTRONIQUE.
   ========================================================================== */

import aucun from "./aucun.js";

export const CONNECTEURS = { [aucun.nom]: aucun };

export function connecteurFacturation(env = {}) {
  const nom = (env.FACTURATION_ELECTRONIQUE || "aucun").trim();
  const connecteur = CONNECTEURS[nom];
  if (!connecteur) throw new Error(`Connecteur de facturation électronique inconnu : « ${nom} »`);
  return connecteur;
}
