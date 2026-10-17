/* ==========================================================================
   Calcul des devis, factures et avoirs.
   Partagé : le navigateur l'utilise pour l'aperçu en direct, le Worker pour
   les montants enregistrés (c'est toujours le calcul du Worker qui fait foi).

   Unités : montants en centimes d'euro (entiers), taux et pourcentages en
   points de base (10000 = 100 %, 2000 = 20 %).

   Ligne :
     {
       ref: "site-vitrine" | null,   identifiant de la prestation dans la grille (null : ligne libre)
       designation: "Site vitrine jusqu'à 5 pages",
       description: "Maquette, intégration…",
       unite: "forfait",
       quantite: 1,                  nombre, jusqu'à 3 décimales (1.5 jour)
       prix_unitaire: 180000,        centimes HT, ou null pour une ligne en pourcentage
       pourcentage: null             points de base (2500 = +25 %) : majoration calculée
     }                               sur le total des lignes à prix unitaire

   Remise : null, { type: "pourcentage", valeur: 1500, libelle, ref }
            ou { type: "montant", valeur: 5000, libelle }

   Déduction (facture de solde) :
     { facture_id, numero, date_emission, montant_ht, montant_tva, montant_ttc }

   Devis : les lignes à l'unité « mois » ou « an » (abonnements) sont mises à
   part avec separerRecurrent (voir lib/abonnement.js).
   ========================================================================== */

import { periodeDeLigne } from "./abonnement.js";

export const CENT_POUR_CENT = 10000;

// Arrondi au centime, la moitié s'éloignant de zéro (arrondi commercial)
function arrondir(valeur) {
  return Math.sign(valeur) * Math.round(Math.abs(valeur));
}

/** Applique un taux en points de base à un montant en centimes, arrondi au centime */
export function appliquerTaux(montant, pointsDeBase) {
  return arrondir((montant * pointsDeBase) / CENT_POUR_CENT);
}

// Quantité en millièmes : évite les erreurs de virgule flottante (1.1 × 3)
function quantiteEnMilliemes(quantite) {
  return Math.round(Number(quantite) * 1000);
}

function totalLigneAPrix(ligne) {
  return arrondir((quantiteEnMilliemes(ligne.quantite) * ligne.prix_unitaire) / 1000);
}

export function estLignePourcentage(ligne) {
  return ligne.pourcentage !== null && ligne.pourcentage !== undefined;
}

/** Ajoute à chaque ligne son total HT en centimes */
export function calculerLignes(lignes) {
  const base = lignes
    .filter((ligne) => !estLignePourcentage(ligne))
    .reduce((somme, ligne) => somme + totalLigneAPrix(ligne), 0);
  return lignes.map((ligne) => ({
    ...ligne,
    total: estLignePourcentage(ligne) ? appliquerTaux(base, ligne.pourcentage) : totalLigneAPrix(ligne),
  }));
}

/**
 * Totaux d'un document.
 * total_* : la prestation complète ; montant_* : ce que ce document facture
 * (égal au total, sauf pour une facture de solde qui déduit les acomptes).
 * separerRecurrent (devis) : les abonnements (« mois », « an ») sortent du
 * total, de la remise et de la base des majorations ; ils sont totalisés par
 * période dans recurrent : { lignes, periodes: [{ unite, total_ht, total_tva, total_ttc }] }.
 */
export function calculerDocument({ lignes = [], remise = null, taux_tva = 0, deductions = [], separerRecurrent = false }) {
  const recurrentes = separerRecurrent ? lignes.filter((l) => periodeDeLigne(l)) : [];
  const ponctuelles = separerRecurrent ? lignes.filter((l) => !periodeDeLigne(l)) : lignes;
  const lignesCalculees = calculerLignes(ponctuelles);
  const sous_total = lignesCalculees.reduce((somme, ligne) => somme + ligne.total, 0);

  let montantRemise = 0;
  if (remise && remise.type === "pourcentage") montantRemise = appliquerTaux(sous_total, remise.valeur);
  if (remise && remise.type === "montant") montantRemise = Math.min(remise.valeur, sous_total);

  const total_ht = sous_total - montantRemise;
  const total_tva = appliquerTaux(total_ht, taux_tva);
  const total_ttc = total_ht + total_tva;

  const deduit = deductions.reduce(
    (somme, d) => ({ ht: somme.ht + d.montant_ht, tva: somme.tva + d.montant_tva }),
    { ht: 0, tva: 0 }
  );
  const montant_ht = total_ht - deduit.ht;
  const montant_tva = total_tva - deduit.tva;

  return {
    lignes: lignesCalculees,
    sous_total,
    remise: remise ? { ...remise, montant: montantRemise } : null,
    total_ht,
    taux_tva,
    total_tva,
    total_ttc,
    deductions,
    montant_ht,
    montant_tva,
    montant_ttc: montant_ht + montant_tva,
    recurrent: calculerRecurrent(recurrentes, taux_tva),
  };
}

/**
 * Montants d'un devis : le forfait (total, échéancier, remise) d'un côté,
 * les abonnements (lignes « mois » ou « an ») de l'autre, dans recurrent.
 */
export function calculerDevis({ lignes = [], remise = null, taux_tva = 0 }) {
  return calculerDocument({ lignes, remise, taux_tva, separerRecurrent: true });
}

/** Abonnements d'un devis, totalisés par période (mois, puis an) */
function calculerRecurrent(lignes, taux_tva) {
  const calculees = calculerLignes(lignes);
  const periodes = ["mois", "an"]
    .map((unite) => {
      const total_ht = calculees.filter((l) => periodeDeLigne(l) === unite).reduce((s, l) => s + l.total, 0);
      const total_tva = appliquerTaux(total_ht, taux_tva);
      return { unite, total_ht, total_tva, total_ttc: total_ht + total_tva };
    })
    .filter((p) => calculees.some((l) => periodeDeLigne(l) === p.unite));
  return { lignes: calculees, periodes };
}

/**
 * Échéancier d'un devis au forfait, à partir de ses étapes
 * [{ etape: "Acompte à la signature", pourcentage: 3000 }, …].
 * La dernière étape reçoit le reste : la somme des échéances est toujours
 * exactement égale au total, au centime près.
 */
export function calculerEcheancier(total_ht, taux_tva, etapes) {
  const total_tva = appliquerTaux(total_ht, taux_tva);
  let resteHt = total_ht;
  let resteTva = total_tva;
  return etapes.map((etape, rang) => {
    const derniere = rang === etapes.length - 1;
    const montant_ht = derniere ? resteHt : appliquerTaux(total_ht, etape.pourcentage);
    const montant_tva = derniere ? resteTva : appliquerTaux(montant_ht, taux_tva);
    resteHt -= montant_ht;
    resteTva -= montant_tva;
    return {
      rang,
      etape: etape.etape,
      pourcentage: etape.pourcentage,
      type: derniere ? "solde" : rang === 0 ? "acompte" : "intermediaire",
      montant_ht,
      montant_tva,
      montant_ttc: montant_ht + montant_tva,
    };
  });
}
