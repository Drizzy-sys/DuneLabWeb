/* ==========================================================================
   Grille tarifaire : versions enregistrées dans D1, validation, et contexte
   copié dans chaque devis ou facture.
   --------------------------------------------------------------------------
   data/grille.json est la version initiale. Chaque enregistrement depuis la
   page « Grille tarifaire » ajoute une version ; la plus récente fait foi.
   Les documents ne lisent jamais la grille après coup : leurs lignes gardent
   le prix du moment, et leur contexte (émetteur, TVA, conditions, mentions)
   est figé à l'envoi du devis ou à l'émission de la facture.
   ========================================================================== */

import { ErreurMetier } from "./http.js";
import { empreinteSha256 } from "./archives.js";
import { enPointsDeBase } from "../../public/admin/js/lib/format.js";

const REGIMES_TVA = ["franchise_en_base", "assujetti"];

/** Version courante { id, contenu, cree_le } ; importe data/grille.json au premier appel */
export async function grilleCourante(app) {
  const ligne = await app.db.prepare("SELECT id, contenu, cree_le FROM grilles ORDER BY id DESC LIMIT 1").first();
  if (ligne) return { id: ligne.id, contenu: JSON.parse(ligne.contenu), cree_le: ligne.cree_le };
  if (!app.grilleInitiale) throw new ErreurMetier("Aucune grille tarifaire enregistrée.", 500);
  return importerGrilleDuFichier(app);
}

export async function enregistrerGrille(app, contenu, empreinteFichier = null) {
  const erreurs = validerGrille(contenu);
  if (erreurs.length) throw new ErreurMetier("La grille contient des erreurs.", 422, erreurs);
  const ligne = await app.db
    .prepare("INSERT INTO grilles (contenu, empreinte_fichier) VALUES (?, ?) RETURNING id, cree_le")
    .bind(JSON.stringify(contenu), empreinteFichier)
    .first();
  return { id: ligne.id, contenu, cree_le: ligne.cree_le };
}

function empreinteGrille(contenu) {
  return empreinteSha256(new TextEncoder().encode(JSON.stringify(contenu)));
}

/**
 * data/grille.json (publié avec le Worker) a-t-il changé depuis son dernier
 * import ? Une modification du fichier suivie d'un déploiement est alors
 * proposée à l'import, sans écraser les modifications faites dans l'admin.
 */
export async function fichierGrilleAImporter(app) {
  if (!app.grilleInitiale) return false;
  const empreinte = await empreinteGrille(app.grilleInitiale);
  const deja = await app.db.prepare("SELECT 1 AS oui FROM grilles WHERE empreinte_fichier = ? LIMIT 1").bind(empreinte).first();
  return !deja;
}

const aCompleter = (valeur) => String(valeur ?? "").trim() === "" || /COMPL[ÉE]TER/i.test(String(valeur));

/**
 * Nouvelle version de la grille à partir de data/grille.json. Les champs de
 * l'émetteur déjà remplis dans l'admin (SIREN, IBAN…) sont gardés quand le
 * fichier les laisse encore « À COMPLÉTER ».
 */
export async function importerGrilleDuFichier(app) {
  const contenu = structuredClone(app.grilleInitiale);
  const actuelle = await app.db.prepare("SELECT contenu FROM grilles ORDER BY id DESC LIMIT 1").first();
  if (actuelle) {
    const emetteurActuel = JSON.parse(actuelle.contenu).emetteur || {};
    for (const [cle, valeur] of Object.entries(emetteurActuel)) {
      if (aCompleter(contenu.emetteur?.[cle]) && !aCompleter(valeur)) contenu.emetteur[cle] = valeur;
    }
  }
  return enregistrerGrille(app, contenu, await empreinteGrille(app.grilleInitiale));
}

export async function historiqueGrille(app) {
  const { results } = await app.db.prepare("SELECT id, cree_le FROM grilles ORDER BY id DESC LIMIT 100").all();
  return results;
}

export async function lireVersionGrille(app, id) {
  const ligne = await app.db.prepare("SELECT id, contenu, cree_le FROM grilles WHERE id = ?").bind(id).first();
  return ligne && { id: ligne.id, contenu: JSON.parse(ligne.contenu), cree_le: ligne.cree_le };
}

/** Champs de l'émetteur encore à compléter (bloquent l'envoi des devis et l'émission des factures) */
export function emetteurIncomplet(grille) {
  const emetteur = grille.emetteur || {};
  const champs = { siren: "SIREN", rcs: "RCS", email: "e-mail", iban: "IBAN" };
  if (grille.tva?.regime === "assujetti") champs.tva_intracom = "n° de TVA intracommunautaire";
  return Object.entries(champs)
    .filter(([cle]) => {
      const valeur = String(emetteur[cle] ?? "").trim();
      return aCompleter(valeur);
    })
    .map(([, libelle]) => libelle);
}

/** Toutes les prestations de la grille, à plat, avec le nom de leur catégorie */
export function prestationsDeLaGrille(grille) {
  return (grille.categories || []).flatMap((categorie) =>
    (categorie.prestations || []).map((prestation) => ({ ...prestation, categorie: categorie.nom }))
  );
}

/**
 * Contexte copié dans un document : tout ce que le PDF affiche en dehors des
 * lignes. Montants et taux convertis en centimes et points de base.
 */
export function construireContexte(grille, grilleId, client) {
  const assujetti = grille.tva.regime === "assujetti";
  const conditions = grille.conditions;
  return {
    grille_id: grilleId,
    emetteur: { ...grille.emetteur },
    client: client
      ? {
          type: client.type,
          nom: client.nom,
          siren: client.siren,
          adresse: client.adresse,
          code_postal: client.code_postal,
          ville: client.ville,
          pays: client.pays,
          email: client.email,
        }
      : null,
    tva: {
      regime: grille.tva.regime,
      taux: assujetti ? enPointsDeBase(grille.tva.taux_si_assujetti) : 0,
      mention: assujetti ? "" : grille.tva.mention_franchise,
    },
    conditions: {
      validite_devis_jours: conditions.validite_devis_jours,
      echeancier: conditions.echeancier_forfait.map((e) => ({ etape: e.etape, pourcentage: enPointsDeBase(e.pourcentage) })),
      echeancier_regie: conditions.echeancier_regie || "",
      delai_paiement_jours: conditions.delai_paiement_jours,
      abonnement: conditions.abonnement || "",
      abonnement_debut: conditions.abonnement_debut || "",
      abonnement_engagement_mois: conditions.abonnement_engagement_mois ?? null,
      propriete: conditions.propriete || "",
      revisions_incluses: conditions.revisions_incluses ?? null,
    },
    mentions: {
      devis: [...(grille.mentions?.devis || [])],
      facture: [...(grille.mentions?.facture || [])],
    },
    textes: { ...grille.mentions.textes },
  };
}

/* ---------- Validation ---------- */

const estTexte = (v) => typeof v === "string";
const estNombre = (v) => typeof v === "number" && Number.isFinite(v);
const estEntierPositif = (v) => Number.isInteger(v) && v >= 0;
const estFraction = (v) => estNombre(v) && v >= 0 && v <= 1;

/** Liste des erreurs (en français) ; liste vide si la grille est utilisable */
export function validerGrille(g) {
  const erreurs = [];
  const exiger = (condition, message) => {
    if (!condition) erreurs.push(message);
  };

  if (!g || typeof g !== "object" || Array.isArray(g)) return ["La grille doit être un objet JSON."];

  exiger(g.tva && typeof g.tva === "object", "Section « tva » manquante.");
  if (g.tva) {
    exiger(REGIMES_TVA.includes(g.tva.regime), "TVA : le régime doit être « franchise_en_base » ou « assujetti ».");
    exiger(estFraction(g.tva.taux_si_assujetti), "TVA : taux_si_assujetti doit être une fraction (0.20 pour 20 %).");
    exiger(estTexte(g.tva.mention_franchise), "TVA : mention_franchise manquante.");
    exiger(estNombre(g.tva.seuil_franchise) && g.tva.seuil_franchise > 0, "TVA : seuil_franchise doit être un montant en euros.");
  }

  exiger(g.emetteur && typeof g.emetteur === "object", "Section « emetteur » manquante.");
  if (g.emetteur) {
    for (const champ of ["denomination", "forme", "capital", "siege", "siren", "rcs", "email", "iban"]) {
      exiger(estTexte(g.emetteur[champ]), `Émetteur : champ « ${champ} » manquant.`);
    }
  }

  const ids = new Set();
  exiger(Array.isArray(g.categories), "Section « categories » manquante.");
  for (const [i, categorie] of (Array.isArray(g.categories) ? g.categories : []).entries()) {
    const ou = `Catégorie ${i + 1}${categorie?.nom ? ` (${categorie.nom})` : ""}`;
    exiger(estTexte(categorie?.id) && categorie.id !== "", `${ou} : identifiant manquant.`);
    exiger(estTexte(categorie?.nom) && categorie.nom.trim() !== "", `${ou} : nom manquant.`);
    exiger(Array.isArray(categorie?.prestations), `${ou} : liste de prestations manquante.`);
    for (const [j, p] of (Array.isArray(categorie?.prestations) ? categorie.prestations : []).entries()) {
      const ici = `${ou}, prestation ${j + 1}${p?.nom ? ` (${p.nom})` : ""}`;
      exiger(estTexte(p?.id) && p.id !== "", `${ici} : identifiant manquant.`);
      if (estTexte(p?.id)) {
        exiger(!ids.has(p.id), `${ici} : l'identifiant « ${p.id} » est déjà utilisé.`);
        ids.add(p.id);
      }
      exiger(estTexte(p?.nom) && p.nom.trim() !== "", `${ici} : nom manquant.`);
      exiger(estTexte(p?.unite) && p.unite.trim() !== "", `${ici} : unité manquante.`);
      const aPrix = p?.prix !== undefined;
      const aPourcentage = p?.prix_pourcentage !== undefined;
      exiger(aPrix !== aPourcentage, `${ici} : indiquer soit un prix, soit un pourcentage (majoration).`);
      if (aPrix) exiger(estNombre(p.prix) && p.prix >= 0, `${ici} : le prix doit être un nombre positif (en euros HT).`);
      if (aPourcentage) exiger(estFraction(p.prix_pourcentage), `${ici} : le pourcentage doit être une fraction (0.25 pour 25 %).`);
      if (p?.delai_jours !== undefined) exiger(estEntierPositif(p.delai_jours), `${ici} : le délai doit être un nombre de jours.`);
      if (p?.a_partir_de !== undefined) exiger(typeof p.a_partir_de === "boolean", `${ici} : « à partir de » doit valoir true ou false.`);
      if (p?.divise_delai !== undefined) exiger(estNombre(p.divise_delai) && p.divise_delai >= 1, `${ici} : divise_delai doit être un nombre supérieur ou égal à 1.`);
    }
  }

  // Catégorie d'options (« options_de ») : rattachée à une catégorie principale existante
  const categories = Array.isArray(g.categories) ? g.categories : [];
  for (const categorie of categories) {
    if (categorie?.options_de === undefined) continue;
    const parente = categories.find((c) => c?.id === categorie.options_de);
    exiger(
      parente && parente !== categorie && parente.options_de === undefined,
      `Catégorie « ${categorie.nom} » : « options de » doit désigner une autre catégorie principale.`
    );
  }
  for (const categorie of categories) {
    if (categorie?.choix_unique !== undefined) {
      exiger(typeof categorie.choix_unique === "boolean", `Catégorie « ${categorie.nom} » : choix_unique doit valoir true ou false.`);
    }
  }
  // Questions : textes, ou thèmes { theme, questions: [textes] }
  const question = (q) => estTexte(q) && q.trim() !== "";
  const element = (e) => question(e) || (e && typeof e === "object" && question(e.theme) && Array.isArray(e.questions) && e.questions.every(question));
  const listeDeQuestions = (liste) => liste === undefined || (Array.isArray(liste) && liste.every(element));
  exiger(listeDeQuestions(g.questions_generales), "Questions générales : une liste de questions est attendue.");
  for (const categorie of categories) {
    exiger(listeDeQuestions(categorie?.questions), `Catégorie « ${categorie?.nom} » : les questions doivent être une liste de textes (ou de thèmes).`);
  }

  // Incompatibilités : identifiants de prestations existantes
  for (const p of categories.flatMap((c) => (Array.isArray(c?.prestations) ? c.prestations : []))) {
    if (p?.incompatible_avec === undefined) continue;
    const valide = Array.isArray(p.incompatible_avec) && p.incompatible_avec.every((id) => id !== p.id && ids.has(id));
    exiger(valide, `Prestation « ${p.nom} » : incompatible_avec doit lister d'autres prestations de la grille.`);
  }

  exiger(Array.isArray(g.remises), "Section « remises » manquante.");
  for (const [i, r] of (Array.isArray(g.remises) ? g.remises : []).entries()) {
    exiger(estTexte(r?.id) && estTexte(r?.nom) && estFraction(r?.pourcentage), `Remise ${i + 1} : id, nom et pourcentage (fraction) requis.`);
  }

  const c = g.conditions;
  exiger(c && typeof c === "object", "Section « conditions » manquante.");
  if (c) {
    exiger(Number.isInteger(c.validite_devis_jours) && c.validite_devis_jours > 0, "Conditions : validite_devis_jours doit être un nombre de jours.");
    exiger(estEntierPositif(c.delai_paiement_jours), "Conditions : delai_paiement_jours doit être un nombre de jours.");
    if (c.abonnement_debut !== undefined) exiger(estTexte(c.abonnement_debut), "Conditions : abonnement_debut doit être un texte.");
    if (c.abonnement_engagement_mois !== undefined) {
      exiger(estEntierPositif(c.abonnement_engagement_mois), "Conditions : abonnement_engagement_mois doit être un nombre de mois.");
    }
    exiger(Array.isArray(c.echeancier_forfait) && c.echeancier_forfait.length > 0, "Conditions : échéancier manquant.");
    if (Array.isArray(c.echeancier_forfait)) {
      let somme = 0;
      for (const [i, e] of c.echeancier_forfait.entries()) {
        exiger(estTexte(e?.etape) && estFraction(e?.pourcentage), `Échéancier, étape ${i + 1} : libellé et pourcentage (fraction) requis.`);
        somme += enPointsDeBase(e?.pourcentage ?? 0);
      }
      exiger(somme === 10000, "Échéancier : la somme des pourcentages doit faire 100 %.");
    }
  }

  const m = g.mentions;
  exiger(m && typeof m === "object", "Section « mentions » manquante.");
  if (m) {
    exiger(Array.isArray(m.devis) && Array.isArray(m.facture), "Mentions : listes « devis » et « facture » requises.");
    exiger(m.textes && typeof m.textes === "object", "Mentions : section « textes » manquante.");
    for (const champ of ["nature_operation", "penalites_retard", "indemnite_recouvrement", "escompte", "bon_pour_accord"]) {
      exiger(estTexte(m.textes?.[champ]) && m.textes[champ].trim() !== "", `Mentions : texte « ${champ} » manquant.`);
    }
  }

  return erreurs;
}
