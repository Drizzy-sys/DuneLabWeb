/* Validation des données envoyées par l'interface (le navigateur n'est jamais cru sur parole) */

import { ErreurMetier } from "./http.js";
import { estDateIso } from "../../public/admin/js/lib/format.js";

export function texte(valeur, nom, max, { requis = false, multiligne = false } = {}) {
  if (valeur === undefined || valeur === null) valeur = "";
  if (typeof valeur !== "string") throw new ErreurMetier(`${nom} : texte attendu.`, 422);
  let propre = valeur.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (!multiligne) propre = propre.replace(/\s+/g, " ");
  propre = propre.trim();
  if (requis && propre === "") throw new ErreurMetier(`${nom} : champ obligatoire.`, 422);
  if (propre.length > max) throw new ErreurMetier(`${nom} : ${max} caractères au maximum.`, 422);
  return propre;
}

export function date(valeur, nom, { requis = false } = {}) {
  if (valeur === undefined || valeur === null || valeur === "") {
    if (requis) throw new ErreurMetier(`${nom} : date obligatoire.`, 422);
    return null;
  }
  if (!estDateIso(valeur)) throw new ErreurMetier(`${nom} : date invalide.`, 422);
  return valeur;
}

export function entier(valeur, nom, min, max) {
  if (!Number.isInteger(valeur) || valeur < min || valeur > max) {
    throw new ErreurMetier(`${nom} : nombre entier attendu entre ${min} et ${max}.`, 422);
  }
  return valeur;
}

export function identifiant(valeur, nom) {
  return entier(valeur, nom, 1, Number.MAX_SAFE_INTEGER);
}

const MAX_CENTIMES = 100_000_000_00; // 100 millions d'euros

/** Lignes d'un devis ou d'une facture (format décrit dans lib/calcul.js) */
export function lignes(valeur) {
  if (!Array.isArray(valeur)) throw new ErreurMetier("Lignes : liste attendue.", 422);
  if (valeur.length > 100) throw new ErreurMetier("100 lignes au maximum.", 422);
  return valeur.map((ligne, i) => {
    const ou = `Ligne ${i + 1}`;
    if (!ligne || typeof ligne !== "object") throw new ErreurMetier(`${ou} : invalide.`, 422);
    const enPourcentage = ligne.pourcentage !== null && ligne.pourcentage !== undefined;
    const quantite = Number(ligne.quantite);
    if (!Number.isFinite(quantite) || quantite <= 0 || quantite > 1_000_000 || Math.abs(Math.round(quantite * 1000) - quantite * 1000) > 1e-6) {
      throw new ErreurMetier(`${ou} : quantité positive attendue (3 décimales au plus).`, 422);
    }
    if (enPourcentage && quantite !== 1) throw new ErreurMetier(`${ou} : une majoration en pourcentage a une quantité de 1.`, 422);
    return {
      ref: ligne.ref ? texte(ligne.ref, `${ou} (référence)`, 80) : null,
      designation: texte(ligne.designation, `${ou} (désignation)`, 300, { requis: true }),
      description: texte(ligne.description, `${ou} (description)`, 2000, { multiligne: true }),
      unite: texte(ligne.unite, `${ou} (unité)`, 30),
      quantite,
      prix_unitaire: enPourcentage ? null : entier(ligne.prix_unitaire, `${ou} (prix unitaire, en centimes)`, 0, MAX_CENTIMES),
      pourcentage: enPourcentage ? entier(ligne.pourcentage, `${ou} (pourcentage)`, 0, 100_000) : null,
    };
  });
}

export function remise(valeur) {
  if (valeur === null || valeur === undefined) return null;
  if (typeof valeur !== "object") throw new ErreurMetier("Remise invalide.", 422);
  const libelle = texte(valeur.libelle, "Remise (libellé)", 200) || "Remise";
  if (valeur.type === "pourcentage") {
    const points = entier(valeur.valeur, "Remise (pourcentage)", 0, 10000);
    if (points === 0) return null;
    return { type: "pourcentage", valeur: points, libelle, ref: valeur.ref ? texte(valeur.ref, "Remise (référence)", 80) : null };
  }
  if (valeur.type === "montant") {
    const centimes = entier(valeur.valeur, "Remise (montant, en centimes)", 0, MAX_CENTIMES);
    if (centimes === 0) return null;
    return { type: "montant", valeur: centimes, libelle };
  }
  throw new ErreurMetier("Remise : type « pourcentage » ou « montant » attendu.", 422);
}

/**
 * Cadrage d'un devis : { types: ["site"], questions: [{ question, reponse, perso }] }
 * perso : question ajoutée à la main pour ce devis (gardée même sans réponse).
 */
export function cadrage(valeur) {
  if (valeur === undefined || valeur === null) return { types: [], questions: [] };
  if (typeof valeur !== "object" || Array.isArray(valeur)) throw new ErreurMetier("Cadrage invalide.", 422);
  const types = valeur.types ?? [];
  const questions = valeur.questions ?? [];
  if (!Array.isArray(types) || types.length > 20) throw new ErreurMetier("Cadrage : types de projet invalides.", 422);
  if (!Array.isArray(questions) || questions.length > 150) throw new ErreurMetier("Cadrage : 150 questions au maximum.", 422);
  return {
    types: [...new Set(types.map((t) => texte(t, "Cadrage (type de projet)", 80, { requis: true })))],
    questions: questions.map((q, i) => {
      if (!q || typeof q !== "object") throw new ErreurMetier(`Cadrage, question ${i + 1} : invalide.`, 422);
      const entree = {
        question: texte(q.question, `Cadrage, question ${i + 1}`, 500, { requis: true }),
        reponse: texte(q.reponse, `Cadrage, réponse ${i + 1}`, 5000, { multiligne: true }),
      };
      // Rubrique d'origine (« Sites web · Forme et identité visuelle »), pour la synthèse
      const theme = texte(q.theme, `Cadrage, thème ${i + 1}`, 200);
      if (theme) entree.theme = theme;
      if (q.perso === true) entree.perso = true;
      return entree;
    }),
  };
}

export function montantPositif(valeur, nom) {
  return entier(valeur, nom, 1, MAX_CENTIMES);
}
