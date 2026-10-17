/* Contexte d'application de test : base, archives, polices, grille et date maîtrisées */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { creerD1, creerR2 } from "./d1.js";
import { creerClient } from "../../src/admin/clients.js";

const racine = (chemin) => fileURLToPath(new URL(`../../${chemin}`, import.meta.url));

export function lireGrille() {
  return JSON.parse(readFileSync(racine("data/grille.json"), "utf8"));
}

/** Grille de data/grille.json avec les informations de l'émetteur remplies */
export function grilleComplete(modifier = (g) => g) {
  const grille = lireGrille();
  Object.assign(grille.emetteur, {
    siren: "123 456 789",
    rcs: "RCS Bordeaux 123 456 789",
    email: "contact@exemple.fr",
    iban: "FR76 1234 5678 9012 3456 7890 123",
  });
  return modifier(grille);
}

export function lirePolices() {
  return {
    normal: readFileSync(racine("public/assets/fonts/pdf/Inter-Regular.ttf")),
    gras: readFileSync(racine("public/assets/fonts/pdf/Inter-SemiBold.ttf")),
    titre: readFileSync(racine("public/assets/fonts/pdf/Fraunces-SemiBold.ttf")),
  };
}

export function creerApplication({ aujourdhui = "2026-10-16", grille = grilleComplete() } = {}) {
  const polices = lirePolices();
  return {
    db: creerD1(),
    r2: creerR2(),
    aujourdhui,
    grilleInitiale: grille,
    polices: async () => polices,
  };
}

export const CLIENT_PRO = {
  type: "professionnel",
  nom: "Kahwa Café SARL",
  siren: "987 654 321",
  adresse: "12 rue du Port",
  code_postal: "33120",
  ville: "Arcachon",
  email: "bonjour@kahwa.fr",
};

export const CLIENT_PARTICULIER = {
  type: "particulier",
  nom: "Alice Pellerin",
  adresse: "4 allée des Mimosas",
  code_postal: "33260",
  ville: "La Teste-de-Buch",
  email: "",
};

export async function ajouterClient(app, client = CLIENT_PRO) {
  return creerClient(app, client);
}

/** Ligne de devis ou de facture */
export function ligne(designation, quantite, euros, extra = {}) {
  return {
    ref: null,
    designation,
    description: "",
    unite: "forfait",
    quantite,
    prix_unitaire: Math.round(euros * 100),
    pourcentage: null,
    ...extra,
  };
}
