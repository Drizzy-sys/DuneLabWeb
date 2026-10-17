/* ==========================================================================
   PDF des devis, factures et avoirs (pdf-lib), aux couleurs du site.
   --------------------------------------------------------------------------
   Le PDF est construit uniquement à partir des données du document (lignes,
   montants, contexte figé) : un document émis se régénérerait à l'identique,
   mais il ne l'est jamais, on sert la copie archivée dans R2.
   Polices embarquées (Inter, Fraunces), condition du format PDF/A-3 exigé
   plus tard par Factur-X : public/assets/fonts/pdf/ (sous-ensembles latins).
   ========================================================================== */

import { PDFDocument, rgb, degrees } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { calculerDevis, calculerDocument, calculerEcheancier, estLignePourcentage } from "../../public/admin/js/lib/calcul.js";
import { periodeDeLigne, phraseAbonnement } from "../../public/admin/js/lib/abonnement.js";
import { questionsDuDevis, typesDesRefs } from "../../public/admin/js/lib/questions.js";
import {
  ajouterJours,
  formaterDate,
  formaterMontant,
  formaterNombre,
  formaterPourcentage,
} from "../../public/admin/js/lib/format.js";
import { TYPES_FACTURE } from "../../public/admin/js/lib/libelles.js";
import { LOGO_DUNE, LOGO_LETTRES } from "./logo.js";

export const FICHIERS_POLICES = {
  normal: "/assets/fonts/pdf/Inter-Regular.ttf",
  gras: "/assets/fonts/pdf/Inter-SemiBold.ttf",
  titre: "/assets/fonts/pdf/Fraunces-SemiBold.ttf",
};

/* ---------- Thème : mêmes couleurs que public/assets/css/style.css ---------- */

function couleur(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const C = {
  texte: couleur("#2b211a"),
  attenue: couleur("#5e5248"),
  accent: couleur("#1f4e5f"),
  surAccent: couleur("#faf6ef"),
  ocre: couleur("#c48a45"),
  ocreTexte: couleur("#8a5a2b"),
  filet: couleur("#e3d5be"),
  fondAlt: couleur("#f1e8d9"),
};

const LARGEUR = 595.28; // A4 en points
const HAUTEUR = 841.89;
const MARGE = 48;
const BAS = 72; // au-dessus du pied de page
const CONTENU = LARGEUR - 2 * MARGE;
const DROITE = LARGEUR - MARGE;

/* ---------- Composition : texte, retours à la ligne, sauts de page ---------- */

class Composeur {
  constructor(pdf, polices) {
    this.pdf = pdf;
    this.polices = polices;
    this.textes = []; // tout le texte écrit, pour les tests
    this.siNouvellePage = null;
    this.caracteres = new Map();
    this.nouvellePage();
  }

  nouvellePage() {
    this.page = this.pdf.addPage([LARGEUR, HAUTEUR]);
    this.y = HAUTEUR - MARGE;
  }

  /** Garantit `hauteur` points libres, sinon passe à la page suivante */
  reserver(hauteur) {
    if (this.y - hauteur >= BAS) return false;
    this.nouvellePage();
    if (this.siNouvellePage) this.siNouvellePage();
    return true;
  }

  // Remplace les caractères absents de la police (emoji, alphabets non latins)
  nettoyer(texte, police) {
    if (!this.caracteres.has(police)) this.caracteres.set(police, new Set(police.getCharacterSet()));
    const disponibles = this.caracteres.get(police);
    return [...String(texte ?? "").replace(/\t/g, " ").replace(/ /g, " ")]
      .map((c) => (disponibles.has(c.codePointAt(0)) ? c : "?"))
      .join("");
  }

  largeur(texte, police, taille) {
    return police.widthOfTextAtSize(this.nettoyer(texte, police), taille);
  }

  ecrire(texte, x, y, { police = this.polices.normal, taille = 9.5, teinte = C.texte, align = "gauche" } = {}) {
    const propre = this.nettoyer(texte, police);
    if (propre === "") return;
    this.textes.push(propre);
    const l = police.widthOfTextAtSize(propre, taille);
    const depart = align === "droite" ? x - l : align === "centre" ? x - l / 2 : x;
    this.page.drawText(propre, { x: depart, y, size: taille, font: police, color: teinte });
  }

  /** Découpe un texte en lignes de largeur maximale `largeur` */
  couper(texte, police, taille, largeur) {
    const lignes = [];
    for (const paragraphe of String(texte ?? "").split("\n")) {
      let ligne = "";
      for (const mot of paragraphe.split(" ")) {
        const essai = ligne ? `${ligne} ${mot}` : mot;
        if (this.largeur(essai, police, taille) <= largeur) {
          ligne = essai;
          continue;
        }
        if (ligne) lignes.push(ligne);
        // Mot plus long que la ligne (adresse e-mail, IBAN) : coupé au caractère
        ligne = "";
        for (const c of mot) {
          if (this.largeur(ligne + c, police, taille) > largeur && ligne) {
            lignes.push(ligne);
            ligne = "";
          }
          ligne += c;
        }
      }
      lignes.push(ligne);
    }
    return lignes;
  }

  /** Paragraphe à la position courante, avec sauts de page si besoin */
  paragraphe(texte, { x = MARGE, largeur = CONTENU, police = this.polices.normal, taille = 9.5, teinte = C.texte, interligne = 1.45 } = {}) {
    const hauteurLigne = taille * interligne;
    for (const ligne of this.couper(texte, police, taille, largeur)) {
      this.reserver(hauteurLigne);
      this.y -= hauteurLigne;
      this.ecrire(ligne, x, this.y + taille * 0.3, { police, taille, teinte });
    }
  }

  filet(y, { x1 = MARGE, x2 = DROITE, epaisseur = 0.6, teinte = C.filet } = {}) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: epaisseur, color: teinte });
  }

  rectangle(x, y, largeur, hauteur, options) {
    this.page.drawRectangle({ x, y, width: largeur, height: hauteur, ...options });
  }

  /** Titre de section ; `suite` : hauteur du contenu qui doit rester sur la même page */
  titreSection(texte, suite = 40) {
    this.reserver(40 + suite);
    this.y -= 26;
    this.ecrire(texte, MARGE, this.y, { police: this.polices.titre, taille: 13, teinte: C.accent });
    this.y -= 8;
    this.filet(this.y, { x2: MARGE + 28, epaisseur: 1.4, teinte: C.ocre });
    this.y -= 4;
  }
}

/* ---------- Blocs du document ---------- */

function dessinerLogo(page, x, yHaut, echelle) {
  // Le tracé SVG commence à y = -77 : on aligne le haut du logo sur yHaut
  const origine = { x: x - 1 * echelle, y: yHaut - 77 * echelle };
  page.drawSvgPath(LOGO_LETTRES, { ...origine, scale: echelle, color: C.texte, borderWidth: 0 });
  page.drawSvgPath(LOGO_DUNE, { ...origine, scale: echelle, borderColor: C.ocre, borderWidth: 2.6 * echelle });
}

function enTete(z, vue) {
  const haut = HAUTEUR - MARGE;
  dessinerLogo(z.page, MARGE, haut - 2, 0.3);

  z.ecrire(vue.titre, DROITE, haut - 20, { police: z.polices.titre, taille: 22, teinte: C.accent, align: "droite" });
  z.ecrire(vue.sousTitre || (vue.numero ? `N° ${vue.numero}` : "Brouillon, sans numéro"), DROITE, haut - 38, {
    police: z.polices.gras,
    taille: 10.5,
    align: "droite",
  });
  let y = haut - 54;
  for (const [libelle, valeur] of vue.dates) {
    const largeurValeur = z.largeur(valeur, z.polices.normal, 8.5);
    z.ecrire(valeur, DROITE, y, { taille: 8.5, align: "droite" });
    z.ecrire(`${libelle} :`, DROITE - largeurValeur - 4, y, { taille: 8.5, teinte: C.attenue, align: "droite" });
    y -= 12.5;
  }
  z.y = Math.min(y + 4, haut - 44) - 12;
  z.filet(z.y, { epaisseur: 1, teinte: C.ocre });
}

function lignesEmetteur(e) {
  const lignes = [`${e.forme} au capital de ${e.capital}`, ...String(e.siege).split(/,\s*/)];
  lignes.push(`SIREN ${e.siren} · ${e.rcs}`);
  if (e.tva_intracom) lignes.push(`TVA intracommunautaire : ${e.tva_intracom}`);
  if (e.email) lignes.push(e.email);
  return lignes;
}

function lignesClient(c) {
  const lignes = [...String(c.adresse || "").split("\n"), `${c.code_postal} ${c.ville}`.trim()];
  if (c.pays && c.pays.toLowerCase() !== "france") lignes.push(c.pays);
  if (c.type === "professionnel" && c.siren) lignes.push(`SIREN ${c.siren}`);
  if (c.email) lignes.push(c.email);
  return lignes.filter((l) => l.trim() !== "");
}

function parties(z, vue) {
  const { emetteur, client } = vue.contexte;
  const colonne = (CONTENU - 20) / 2;
  const xClient = MARGE + colonne + 20;
  const haut = z.y - 16;
  const pas = 12.5;

  // Client : encadré sable, hauteur calculée avant de dessiner
  const adresseClient = client ? lignesClient(client).flatMap((l) => z.couper(l, z.polices.normal, 9, colonne - 24)) : [];
  const nomClient = client ? z.couper(client.nom, z.polices.gras, 10.5, colonne - 24) : ["Client à choisir"];
  const hauteurClient = 26 + nomClient.length * 14 + adresseClient.length * pas + 8;
  z.rectangle(xClient, haut - hauteurClient, colonne, hauteurClient, { color: C.fondAlt });

  let y = haut - 16;
  z.ecrire("CLIENT", xClient + 12, y, { police: z.polices.gras, taille: 7.5, teinte: C.ocreTexte });
  y -= 15;
  for (const l of nomClient) {
    z.ecrire(l, xClient + 12, y, { police: z.polices.gras, taille: 10.5 });
    y -= 14;
  }
  for (const l of adresseClient) {
    z.ecrire(l, xClient + 12, y, { taille: 9 });
    y -= pas;
  }

  // Émetteur
  y = haut - 16;
  z.ecrire("ÉMETTEUR", MARGE, y, { police: z.polices.gras, taille: 7.5, teinte: C.ocreTexte });
  y -= 15;
  z.ecrire(emetteur.denomination, MARGE, y, { police: z.polices.gras, taille: 10.5 });
  y -= 14;
  for (const l of lignesEmetteur(emetteur).flatMap((l) => z.couper(l, z.polices.normal, 9, colonne))) {
    z.ecrire(l, MARGE, y, { taille: 9 });
    y -= pas;
  }

  z.y = Math.min(y, haut - hauteurClient) - 10;
}

function objet(z, vue) {
  if (vue.objet) {
    z.y -= 6;
    const largeurLibelle = z.largeur("Objet : ", z.polices.gras, 10.5);
    const lignes = z.couper(vue.objet, z.polices.normal, 10.5, CONTENU - largeurLibelle);
    z.y -= 14;
    z.ecrire("Objet :", MARGE, z.y, { police: z.polices.gras, taille: 10.5 });
    lignes.forEach((ligne, i) => {
      if (i > 0) z.y -= 14;
      z.ecrire(ligne, MARGE + largeurLibelle, z.y, { taille: 10.5 });
    });
  }
  for (const reference of vue.references) {
    z.y -= 13;
    z.ecrire(reference, MARGE, z.y, { taille: 9, teinte: C.attenue });
  }
  z.y -= 14;
}

// Colonnes du tableau des prestations : x de départ, largeur, alignement
const COLONNES = (() => {
  const qte = 40, unite = 70, pu = 82, total = 84;
  const designation = CONTENU - qte - unite - pu - total;
  let x = MARGE;
  const col = (largeur, align) => {
    const c = { x, largeur, align };
    x += largeur;
    return c;
  };
  return {
    designation: col(designation, "gauche"),
    quantite: col(qte, "droite"),
    unite: col(unite, "gauche"),
    prix: col(pu, "droite"),
    total: col(total, "droite"),
  };
})();

function texteColonne(z, colonne, texte, y, options) {
  const x = colonne.align === "droite" ? colonne.x + colonne.largeur - 8 : colonne.x + 8;
  z.ecrire(texte, x, y, { ...options, align: colonne.align });
}

function enTeteTableau(z) {
  const hauteur = 20;
  z.reserver(hauteur + 30);
  z.rectangle(MARGE, z.y - hauteur, CONTENU, hauteur, { color: C.accent });
  const y = z.y - 13.5;
  const style = { police: z.polices.gras, taille: 8, teinte: C.surAccent };
  texteColonne(z, COLONNES.designation, "Désignation", y, style);
  texteColonne(z, COLONNES.quantite, "Qté", y, style);
  texteColonne(z, COLONNES.unite, "Unité", y, style);
  texteColonne(z, COLONNES.prix, "Prix unit. HT", y, style);
  texteColonne(z, COLONNES.total, "Total HT", y, style);
  z.y -= hauteur;
}

// Une ligne du tableau ; suffixe : « /mois » pour un abonnement
function rangeeLigne(z, ligne, suffixe = "") {
  const largeurTexte = COLONNES.designation.largeur - 16;
  const designation = z.couper(ligne.designation, z.polices.gras, 9.5, largeurTexte);
  const description = ligne.description ? z.couper(ligne.description, z.polices.normal, 8.5, largeurTexte) : [];
  const hauteur = 8 + designation.length * 13 + description.length * 11.5 + 6;
  z.reserver(hauteur);

  let y = z.y - 8 - 9.5;
  const premiereLigne = y;
  for (const l of designation) {
    z.ecrire(l, COLONNES.designation.x + 8, y, { police: z.polices.gras, taille: 9.5 });
    y -= 13;
  }
  y += 1.5;
  for (const l of description) {
    z.ecrire(l, COLONNES.designation.x + 8, y, { taille: 8.5, teinte: C.attenue });
    y -= 11.5;
  }
  const pourcentage = estLignePourcentage(ligne);
  texteColonne(z, COLONNES.quantite, formaterNombre(ligne.quantite), premiereLigne, {});
  texteColonne(z, COLONNES.unite, ligne.unite, premiereLigne, { teinte: C.attenue });
  texteColonne(z, COLONNES.prix, pourcentage ? `+${formaterPourcentage(ligne.pourcentage)}` : formaterMontant(ligne.prix_unitaire), premiereLigne, {});
  texteColonne(z, COLONNES.total, `${formaterMontant(ligne.total)}${suffixe}`, premiereLigne, {});

  z.y -= hauteur;
  z.filet(z.y);
}

/**
 * Lignes du document ; abonnements (devis) : lignes « mois » ou « an »,
 * regroupées sous leur propre intertitre, hors du total du forfait.
 */
function tableauLignes(z, lignes, abonnements = [], conditions = {}) {
  enTeteTableau(z);
  z.siNouvellePage = () => enTeteTableau(z);
  for (const ligne of lignes) rangeeLigne(z, ligne);
  if (abonnements.length) {
    z.reserver(60);
    z.rectangle(MARGE, z.y - 20, CONTENU, 20, { color: C.fondAlt });
    const debut = conditions.abonnement_debut ? `, ${conditions.abonnement_debut}` : "";
    z.ecrire(`Abonnement : facturé à part, chaque période${debut}`, MARGE + 8, z.y - 13.5, { police: z.polices.gras, taille: 8.5, teinte: C.ocreTexte });
    z.y -= 20;
    for (const ligne of abonnements) rangeeLigne(z, ligne, `/${periodeDeLigne(ligne)}`);
  }
  z.siNouvellePage = null;
}

function totaux(z, vue) {
  const { calcul, contexte } = vue;
  const largeur = 270;
  const x = DROITE - largeur;
  const periodes = calcul.recurrent?.periodes || [];
  // Devis d'abonnement seul, sans forfait : le montant par période est mis en avant
  if (vue.genre === "devis" && calcul.lignes.length === 0 && periodes.length) {
    totauxAbonnementSeul(z, vue, periodes, x, largeur);
    return;
  }
  const rangs = [];
  if (calcul.remise) {
    rangs.push(["Sous-total HT", formaterMontant(calcul.sous_total)]);
    const taux = calcul.remise.type === "pourcentage" ? ` (${formaterPourcentage(calcul.remise.valeur)})` : "";
    rangs.push([`${calcul.remise.libelle}${taux}`, formaterMontant(-calcul.remise.montant)]);
  }
  rangs.push(["Total HT", formaterMontant(calcul.total_ht)]);
  rangs.push([`TVA (${formaterPourcentage(calcul.taux_tva)})`, formaterMontant(calcul.total_tva)]);
  const aDeduire = calcul.deductions.length > 0;
  if (aDeduire) {
    rangs.push(["Total TTC", formaterMontant(calcul.total_ttc)]);
    for (const d of calcul.deductions) {
      rangs.push([`${vue.genre === "avoir" ? "Déjà déduit" : "Déjà facturé"} : ${d.numero} du ${formaterDate(d.date_emission)}`, formaterMontant(-d.montant_ttc)]);
    }
  }

  const libelles = rangs.map(([libelle]) => z.couper(libelle, z.polices.normal, 9, largeur - 110));
  const hauteur = libelles.reduce((h, l) => h + l.length * 12 + 6, 0) + 40;
  z.reserver(hauteur);
  z.y -= 6;
  rangs.forEach(([, valeur], i) => {
    z.y -= 14;
    libelles[i].forEach((l, j) => z.ecrire(l, x + 10, z.y - j * 12, { taille: 9, teinte: C.attenue }));
    z.ecrire(valeur, DROITE - 10, z.y, { taille: 9.5, align: "droite" });
    z.y -= (libelles[i].length - 1) * 12 + 4;
    z.filet(z.y, { x1: x });
  });

  // Montant à payer, mis en avant
  z.y -= 30;
  z.rectangle(x, z.y, largeur, 28, { color: C.accent });
  const libelleFinal = vue.genre === "devis" ? "Total TTC" : vue.genre === "avoir" ? "Total de l’avoir TTC" : "Net à payer TTC";
  z.ecrire(libelleFinal, x + 10, z.y + 10, { police: z.polices.gras, taille: 10.5, teinte: C.surAccent });
  z.ecrire(formaterMontant(calcul.montant_ttc), DROITE - 10, z.y + 10, { police: z.polices.gras, taille: 11.5, teinte: C.surAccent, align: "droite" });

  // Devis avec abonnement : « puis 29,00 € HT/mois à partir de la mise en ligne, engagement 12 mois »
  if (periodes.length) {
    for (const ligne of z.couper(`${phraseAbonnement(periodes, contexte.conditions)}.`, z.polices.gras, 9.5, largeur)) {
      z.y -= 14;
      z.ecrire(ligne, DROITE, z.y, { police: z.polices.gras, taille: 9.5, teinte: C.accent, align: "droite" });
    }
  }
  mentionTva(z, contexte);
}

function mentionTva(z, contexte) {
  if (contexte.tva.mention) {
    z.y -= 16;
    z.ecrire(contexte.tva.mention, DROITE, z.y, { taille: 8.5, teinte: C.attenue, align: "droite" });
  }
}

function totauxAbonnementSeul(z, vue, periodes, x, largeur) {
  const { calcul, contexte } = vue;
  z.reserver(40 + periodes.length * 36 + 40);
  z.y -= 6;
  for (const p of periodes) {
    for (const [libelle, valeur] of [[`Total HT / ${p.unite}`, p.total_ht], [`TVA (${formaterPourcentage(calcul.taux_tva)}) / ${p.unite}`, p.total_tva]]) {
      z.y -= 14;
      z.ecrire(libelle, x + 10, z.y, { taille: 9, teinte: C.attenue });
      z.ecrire(formaterMontant(valeur), DROITE - 10, z.y, { taille: 9.5, align: "droite" });
      z.y -= 4;
      z.filet(z.y, { x1: x });
    }
  }
  const principale = periodes[0];
  z.y -= 30;
  z.rectangle(x, z.y, largeur, 28, { color: C.accent });
  z.ecrire(`Abonnement TTC`, x + 10, z.y + 10, { police: z.polices.gras, taille: 10.5, teinte: C.surAccent });
  z.ecrire(`${formaterMontant(principale.total_ttc)} / ${principale.unite}`, DROITE - 10, z.y + 10, { police: z.polices.gras, taille: 11.5, teinte: C.surAccent, align: "droite" });
  const suite = [contexte.conditions.abonnement_debut, contexte.conditions.abonnement_engagement_mois ? `engagement ${contexte.conditions.abonnement_engagement_mois} mois` : ""].filter(Boolean).join(", ");
  if (suite) {
    z.y -= 14;
    z.ecrire(suite.replace(/^./, (c) => c.toUpperCase()) + ".", DROITE, z.y, { police: z.polices.gras, taille: 9.5, teinte: C.accent, align: "droite" });
  }
  mentionTva(z, contexte);
}

/** Liste « Libellé : valeur » sur deux colonnes */
function definitions(z, paires) {
  const largeurLibelle = 128;
  for (const [libelle, valeur] of paires) {
    if (valeur === null || valeur === undefined || valeur === "") continue;
    const lignes = z.couper(valeur, z.polices.normal, 9, CONTENU - largeurLibelle);
    z.reserver(lignes.length * 13 + 4);
    z.y -= 15;
    z.ecrire(libelle, MARGE, z.y, { police: z.polices.gras, taille: 9 });
    lignes.forEach((ligne, i) => z.ecrire(ligne, MARGE + largeurLibelle, z.y - i * 13, { taille: 9 }));
    z.y -= (lignes.length - 1) * 13;
  }
}

function echeancier(z, etapes) {
  const colonnes = [
    { titre: "Échéance", x: MARGE + 8, align: "gauche" },
    { titre: "Part", x: MARGE + 330, align: "droite" },
    { titre: "Montant TTC", x: DROITE - 8, align: "droite" },
  ];
  z.reserver(22 + etapes.length * 18 + 10);
  z.y -= 12;
  z.rectangle(MARGE, z.y - 18, CONTENU, 18, { color: C.fondAlt });
  for (const c of colonnes) z.ecrire(c.titre, c.x, z.y - 12.5, { police: z.polices.gras, taille: 8.5, align: c.align });
  z.y -= 18;
  for (const etape of etapes) {
    z.y -= 16;
    z.ecrire(etape.etape, colonnes[0].x, z.y + 4, { taille: 9 });
    z.ecrire(formaterPourcentage(etape.pourcentage), colonnes[1].x, z.y + 4, { taille: 9, align: "droite" });
    z.ecrire(formaterMontant(etape.montant_ttc), colonnes[2].x, z.y + 4, { taille: 9, align: "droite" });
    z.filet(z.y - 2);
  }
}

// Cadre de signature du client : « Bon pour accord » (devis) ou validation (synthèse)
function blocAccord(z, vue, titre = vue.contexte.textes.bon_pour_accord, consigne = "Mention manuscrite « Bon pour accord », date et signature du client.") {
  const hauteur = 140;
  z.reserver(hauteur + 30);
  z.y -= 24;
  const haut = z.y;
  z.rectangle(MARGE, haut - hauteur, CONTENU, hauteur, { borderColor: C.filet, borderWidth: 1 });
  z.ecrire(titre, MARGE + 14, haut - 22, { police: z.polices.titre, taille: 13, teinte: C.accent });
  z.ecrire(consigne, MARGE + 14, haut - 38, {
    taille: 8.5,
    teinte: C.attenue,
  });

  const champ = (libelle, y) => {
    z.ecrire(libelle, MARGE + 14, y, { taille: 9 });
    z.filet(y - 3, { x1: MARGE + 14 + z.largeur(libelle, z.polices.normal, 9) + 6, x2: MARGE + 230, teinte: C.attenue, epaisseur: 0.5 });
  };
  champ("Date :", haut - 66);
  champ("Nom :", haut - 90);
  champ("Qualité :", haut - 114);

  const xSignature = MARGE + 250;
  z.ecrire("Signature :", xSignature, haut - 66, { taille: 9 });
  const basSignature = haut - hauteur + 14;
  z.rectangle(xSignature, basSignature, DROITE - 14 - xSignature, haut - 76 - basSignature, { borderColor: C.filet, borderWidth: 0.8 });
  z.y = haut - hauteur;
}

function sectionsDevis(z, vue) {
  const { contexte, devis, calcul } = vue;
  const conditions = contexte.conditions;
  const abonnement = (calcul.recurrent?.periodes || []).length > 0;
  z.titreSection("Conditions", 60);
  const facturation = {
    forfait: devis.echeancier ? "Selon l’échéancier ci-dessous, chaque échéance faisant l’objet d’une facture." : "",
    regie: conditions.echeancier_regie,
    abonnement: conditions.abonnement,
  }[devis.mode];
  definitions(z, [
    ["Validité de l’offre", `${devis.validite_jours} jours, jusqu’au ${formaterDate(devis.date_fin_validite)}`],
    ["Délai d’exécution", devis.delai_execution],
    ["Conditions de paiement", `À ${conditions.delai_paiement_jours} jours à compter de la date de chaque facture, par virement bancaire.`],
    ["Facturation", facturation],
    // Abonnement compris dans un devis au forfait : ses conditions, à part
    ["Abonnement", abonnement && devis.mode !== "abonnement" ? conditions.abonnement : ""],
    ["Propriété", conditions.propriete],
    ["Révisions incluses", conditions.revisions_incluses !== null ? String(conditions.revisions_incluses) : ""],
  ]);
  if (devis.echeancier) {
    z.titreSection("Échéancier", 40 + devis.echeancier.length * 16);
    echeancier(z, devis.echeancier);
  }
  blocAccord(z, vue);
}

function sectionsFacture(z, vue) {
  const { contexte, facture } = vue;
  const { emetteur, textes, client } = contexte;
  if (vue.genre === "facture") {
    z.titreSection("Paiement", 4 * 15);
    definitions(z, [
      ["Date d’échéance", facture.date_echeance ? formaterDate(facture.date_echeance) : `${contexte.conditions.delai_paiement_jours} jours après l’émission`],
      ["Mode de paiement", "Virement bancaire"],
      ["IBAN", emetteur.iban],
      ["Référence du virement", vue.numero || "numéro de la facture"],
    ]);
  }
  z.titreSection("Mentions légales", 50);
  const mentions = [`Nature de l’opération : ${textes.nature_operation}.`];
  if (vue.genre === "facture") {
    mentions.push(textes.penalites_retard);
    if (client?.type === "professionnel") mentions.push(textes.indemnite_recouvrement);
    mentions.push(textes.escompte);
  }
  for (const mention of mentions) {
    z.y -= 4;
    z.paragraphe(mention, { taille: 8.5, teinte: C.attenue });
  }
}

function piedsDePage(z, vue) {
  const e = vue.contexte.emetteur;
  const morceaux = [e.denomination, `${e.forme} au capital de ${e.capital}`, e.siege, `SIREN ${e.siren}`, e.rcs];
  // Une ligne si possible, sinon deux
  let lignes = [morceaux.join(" · ")];
  if (z.largeur(lignes[0], z.polices.normal, 7.5) > CONTENU) {
    lignes = [morceaux.slice(0, 3).join(" · "), morceaux.slice(3).join(" · ")];
  }
  const pages = z.pdf.getPages();
  pages.forEach((page, i) => {
    z.page = page;
    z.filet(54);
    lignes.forEach((ligne, j) => z.ecrire(ligne, LARGEUR / 2, 43 - j * 9.5, { taille: 7.5, teinte: C.attenue, align: "centre" }));
    const reference = vue.numero ? `${vue.titre} ${vue.numero}` : `${vue.titre} (brouillon)`;
    z.ecrire(reference, MARGE, 22, { taille: 7.5, teinte: C.attenue });
    z.ecrire(`Page ${i + 1} / ${pages.length}`, DROITE, 22, { taille: 7.5, teinte: C.attenue, align: "droite" });
    if (vue.brouillon) {
      // Filigrane centré sur la page, en diagonale
      const taille = 80;
      const angle = (38 * Math.PI) / 180;
      const demi = z.largeur("BROUILLON", z.polices.titre, taille) / 2;
      page.drawText("BROUILLON", {
        x: LARGEUR / 2 - demi * Math.cos(angle) + (taille / 3) * Math.sin(angle),
        y: HAUTEUR / 2 - demi * Math.sin(angle) - (taille / 3) * Math.cos(angle),
        size: taille,
        font: z.polices.titre,
        color: C.ocre,
        opacity: 0.12,
        rotate: degrees(38),
      });
    }
  });
}

/* ---------- Vues : ce que le PDF affiche, à partir d'une ligne de D1 ---------- */

/** devis : ligne de la table devis, colonnes JSON déjà décodées */
export function vueDevis(devis) {
  const conditions = devis.contexte.conditions;
  // Forfait d'un côté, abonnements (« mois », « an ») de l'autre
  const calcul = calculerDevis({ lignes: devis.lignes, remise: devis.remise, taux_tva: devis.taux_tva });
  const finValidite = ajouterJours(devis.date_devis, devis.validite_jours);
  return {
    genre: "devis",
    titre: "Devis",
    numero: devis.numero,
    brouillon: devis.statut === "brouillon",
    dates: [
      ["Date", formaterDate(devis.date_devis)],
      ["Valable jusqu’au", formaterDate(finValidite)],
    ],
    objet: devis.objet,
    references: [],
    contexte: devis.contexte,
    calcul,
    devis: {
      mode: devis.mode,
      delai_execution: devis.delai_execution,
      validite_jours: devis.validite_jours,
      date_fin_validite: finValidite,
      // Échéancier du forfait seul : les abonnements n'y entrent pas
      echeancier: devis.mode === "forfait" && calcul.lignes.length ? calculerEcheancier(calcul.total_ht, calcul.taux_tva, conditions.echeancier) : null,
    },
  };
}

/**
 * facture : ligne de la table factures, colonnes JSON décodées.
 * liens : { devis: { numero, date_devis }, origine: { numero, date_emission } } si besoin.
 * aujourdhui : date affichée sur l'aperçu d'un brouillon.
 */
export function vueFacture(facture, liens = {}, aujourdhui) {
  const avoir = facture.serie === "A";
  const dateEmission = facture.date_emission || aujourdhui;
  const prestation = facture.prestation_debut || dateEmission;
  const dates = [["Date d’émission", formaterDate(dateEmission)]];
  if (facture.prestation_fin && facture.prestation_fin !== prestation) {
    dates.push(["Période de la prestation", `du ${formaterDate(prestation)} au ${formaterDate(facture.prestation_fin)}`]);
  } else {
    dates.push(["Date de la prestation", formaterDate(prestation)]);
  }
  const echeance = facture.date_echeance || (avoir ? null : ajouterJours(dateEmission, facture.contexte.conditions.delai_paiement_jours));
  if (echeance) dates.push(["Échéance", formaterDate(echeance)]);

  const references = [];
  if (liens.devis) references.push(`Selon devis ${liens.devis.numero} du ${formaterDate(liens.devis.date_devis)}`);
  if (liens.origine) references.push(`Avoir sur la facture ${liens.origine.numero} du ${formaterDate(liens.origine.date_emission)}`);

  return {
    genre: avoir ? "avoir" : "facture",
    titre: TYPES_FACTURE[facture.type],
    numero: facture.numero,
    brouillon: facture.statut === "brouillon",
    dates,
    objet: facture.objet,
    references,
    contexte: facture.contexte,
    calcul: calculerDocument({
      lignes: facture.lignes,
      remise: facture.remise,
      taux_tva: facture.taux_tva,
      deductions: facture.deductions,
    }),
    facture: { date_echeance: echeance },
  };
}

/* ---------- Synthèse du projet ---------- */

/**
 * Synthèse d'un devis, pour soi ou à faire valider par le client : prestations
 * retenues (sans les prix, qui sont dans le devis), réponses du cadrage par
 * thème, points restant à préciser, cadre de validation.
 * avecNotes : version interne, avec les notes libres et sans cadre de validation.
 */
export function vueSynthese(devis, grille, { avecNotes = false, aujourdhui }) {
  const calcul = calculerDevis({ lignes: devis.lignes, remise: devis.remise, taux_tva: devis.taux_tva });
  const types = [...new Set([...(devis.cadrage?.types || []), ...typesDesRefs(grille, devis.lignes.map((l) => l.ref))])];
  const reponses = new Map((devis.cadrage?.questions || []).filter((q) => q.reponse.trim()).map((q) => [q.question, q]));

  // Réponses dans l'ordre de la grille, rangées par thème ; puis celles hors grille
  const rubriques = [];
  const aPreciser = [];
  const placees = new Set();
  for (const groupe of questionsDuDevis(grille, types)) {
    for (const theme of groupe.themes) {
      const titre = theme.theme ? `${groupe.titre} · ${theme.theme}` : groupe.titre;
      const repondues = theme.questions.filter((q) => reponses.has(q)).map((q) => ({ question: q, reponse: reponses.get(q).reponse }));
      theme.questions.filter((q) => !reponses.has(q)).forEach((q) => aPreciser.push(q));
      theme.questions.forEach((q) => placees.add(q));
      if (repondues.length) rubriques.push({ titre, questions: repondues });
    }
  }
  for (const q of reponses.values()) {
    if (placees.has(q.question)) continue;
    const titre = q.theme || "Autres questions";
    let rubrique = rubriques.find((r) => r.titre === titre);
    if (!rubrique) rubriques.push((rubrique = { titre, questions: [] }));
    rubrique.questions.push({ question: q.question, reponse: q.reponse });
  }

  return {
    genre: "synthese",
    titre: "Synthèse du projet",
    numero: devis.numero,
    sousTitre: `Devis ${devis.numero}`,
    brouillon: false,
    dates: [["Version du", formaterDate(aujourdhui)]],
    objet: devis.objet,
    references: [],
    contexte: devis.contexte,
    synthese: {
      prestations: calcul.lignes,
      abonnements: calcul.recurrent.lignes,
      delai: devis.delai_execution,
      rubriques,
      aPreciser,
      notes: avecNotes ? devis.notes : "",
      validation: !avecNotes,
    },
  };
}

function puces(z, lignes, options = {}) {
  for (const ligne of lignes) {
    const morceaux = z.couper(ligne, options.police || z.polices.normal, options.taille || 9.5, CONTENU - 16);
    morceaux.forEach((m, i) => {
      z.reserver(14);
      z.y -= 14;
      if (i === 0) z.ecrire("•", MARGE + 2, z.y, { taille: 9.5, teinte: C.ocre });
      z.ecrire(m, MARGE + 14, z.y, { taille: options.taille || 9.5, police: options.police, teinte: options.teinte });
    });
  }
}

function corpsSynthese(z, vue) {
  const s = vue.synthese;
  // « 2 pages », « 3 jours », « 2 demi-journées » ; « mois » est invariable
  const pluriel = (unite, n) => (n > 1 && !/[sxz]$/.test(unite) ? `${unite}s` : unite);
  const quantite = (l) => (l.unite === "forfait" && l.quantite === 1 ? "" : ` (${formaterNombre(l.quantite)} ${pluriel(l.unite, l.quantite)})`);
  z.titreSection("Prestations retenues", 30);
  puces(z, [
    ...s.prestations.map((l) => `${l.designation}${quantite(l)}`),
    ...s.abonnements.map((l) => `${l.designation} : abonnement, facturé chaque ${periodeDeLigne(l)}`),
  ]);
  if (s.delai) {
    z.y -= 6;
    definitions(z, [["Délai d’exécution", s.delai]]);
  }

  for (const rubrique of s.rubriques) {
    z.titreSection(rubrique.titre, 50);
    for (const { question, reponse } of rubrique.questions) {
      z.y -= 6;
      z.paragraphe(question, { police: z.polices.gras, taille: 9.5 });
      z.paragraphe(reponse, { taille: 9.5, teinte: C.texte });
    }
  }
  if (!s.rubriques.length) {
    z.titreSection("Cadrage", 20);
    z.paragraphe("Aucune réponse saisie pour l’instant.", { teinte: C.attenue });
  }

  if (s.aPreciser.length) {
    z.titreSection("Points restant à préciser", 30);
    puces(z, s.aPreciser, { teinte: C.attenue, taille: 9 });
  }
  if (s.notes) {
    z.titreSection("Notes internes", 30);
    z.paragraphe(s.notes, { taille: 9.5 });
  }
  if (s.validation) {
    blocAccord(z, vue, "Validation du projet", "Je confirme que cette synthèse correspond à mon projet. Date, nom et signature du client.");
  }
}

/* ---------- Génération ---------- */

/**
 * polices : { normal, gras, titre } en octets (TTF).
 * Renvoie { octets, textes } ; textes liste tout ce qui est écrit (tests).
 */
export async function genererPdf(vue, polices) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Polices déjà réduites aux caractères latins : embarquées entières
  // (le sous-ensemble de fontkit perd des glyphes d'Inter)
  const p = {
    normal: await pdf.embedFont(polices.normal, { subset: false }),
    gras: await pdf.embedFont(polices.gras, { subset: false }),
    titre: await pdf.embedFont(polices.titre, { subset: false }),
  };

  const e = vue.contexte.emetteur;
  const titre = vue.numero ? `${vue.titre} ${vue.numero}` : `${vue.titre} (brouillon)`;
  const date = new Date(`${(vue.dates[0][1] || "").split("/").reverse().join("-")}T12:00:00Z`);
  pdf.setTitle(titre, { showInWindowTitleBar: true });
  pdf.setAuthor(e.denomination);
  pdf.setSubject(vue.objet || titre);
  pdf.setCreator(`${e.denomination} – espace admin`);
  pdf.setProducer("pdf-lib");
  pdf.setLanguage("fr-FR");
  if (!Number.isNaN(date.getTime())) {
    pdf.setCreationDate(date);
    pdf.setModificationDate(date);
  }

  const z = new Composeur(pdf, p);
  enTete(z, vue);
  parties(z, vue);
  objet(z, vue);
  if (vue.genre === "synthese") {
    corpsSynthese(z, vue);
  } else {
    tableauLignes(z, vue.calcul.lignes, vue.calcul.recurrent?.lignes || [], vue.contexte.conditions);
    totaux(z, vue);
    if (vue.genre === "devis") sectionsDevis(z, vue);
    else sectionsFacture(z, vue);
  }
  piedsDePage(z, vue);

  const octets = await pdf.save();
  return { octets, textes: z.textes };
}

/** Charge les polices depuis les fichiers statiques du site (Worker) */
export async function chargerPolices(assets) {
  const lire = async (chemin) => {
    const reponse = await assets.fetch(new Request(`https://assets.local${chemin}`));
    if (!reponse.ok) throw new Error(`police introuvable : ${chemin}`);
    return new Uint8Array(await reponse.arrayBuffer());
  };
  const [normal, gras, titre] = await Promise.all([
    lire(FICHIERS_POLICES.normal),
    lire(FICHIERS_POLICES.gras),
    lire(FICHIERS_POLICES.titre),
  ]);
  return { normal, gras, titre };
}
