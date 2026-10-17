/* ==========================================================================
   Formats français : montants, pourcentages, quantités, dates.
   Partagé entre le navigateur (espace admin) et le Worker (PDF, CSV).
   Montants en centimes, pourcentages en points de base (2000 = 20 %),
   dates au format AAAA-MM-JJ.
   ========================================================================== */

// Espace insécable : « 1 800,00 € » ne se coupe jamais en fin de ligne
const ESPACE = " ";
const MOINS = "−";

function grouperMilliers(entier) {
  return String(entier).replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE);
}

/** 180000 → « 1 800,00 € » ; -27000 → « −270,00 € » */
export function formaterMontant(centimes) {
  const valeur = Math.round(centimes);
  const absolu = Math.abs(valeur);
  const euros = grouperMilliers(Math.floor(absolu / 100));
  const cents = String(absolu % 100).padStart(2, "0");
  return `${valeur < 0 ? MOINS : ""}${euros},${cents}${ESPACE}€`;
}

/** Montant pour un tableur : 180000 → « 1800,00 », sans séparateur de milliers */
export function formaterMontantCsv(centimes) {
  const valeur = Math.round(centimes);
  const absolu = Math.abs(valeur);
  return `${valeur < 0 ? "-" : ""}${Math.floor(absolu / 100)},${String(absolu % 100).padStart(2, "0")}`;
}

/** Nombre décimal à la française, sans zéros inutiles : 1.5 → « 1,5 » */
export function formaterNombre(nombre, decimalesMax = 3) {
  const texte = Number(nombre.toFixed(decimalesMax)).toString();
  const [entier, decimales] = texte.split(".");
  const signe = entier.startsWith("-") ? MOINS : "";
  const partieEntiere = grouperMilliers(entier.replace("-", ""));
  return signe + partieEntiere + (decimales ? "," + decimales : "");
}

/** 3000 → « 30 % » ; 1250 → « 12,5 % » */
export function formaterPourcentage(pointsDeBase) {
  return `${formaterNombre(pointsDeBase / 100, 2)}${ESPACE}%`;
}

/** « 2026-10-16 » → « 16/10/2026 » */
export function formaterDate(iso) {
  if (!iso) return "";
  const [annee, mois, jour] = iso.slice(0, 10).split("-");
  return `${jour}/${mois}/${annee}`;
}

/**
 * Lit un montant saisi en euros (« 1 800,50 », « 1800.5 », « 1 800 € »)
 * et renvoie des centimes, ou NaN si la saisie n'est pas un montant.
 */
export function analyserMontant(texte) {
  const nombre = analyserNombre(String(texte).replace(/€/g, ""));
  return Number.isFinite(nombre) ? Math.round(nombre * 100) : NaN;
}

/** Lit un nombre saisi à la française (« 1,5 », « 1 000 », « 2.25 ») ; NaN sinon */
export function analyserNombre(texte) {
  const nettoye = String(texte).replace(/[\s  ]/g, "").replace(",", ".").replace(MOINS, "-");
  if (!/^-?\d+(\.\d+)?$/.test(nettoye)) return NaN;
  return Number(nettoye);
}

/** Fraction de la grille (0.15) → points de base (1500) */
export function enPointsDeBase(fraction) {
  return Math.round(Number(fraction) * 10000);
}

/** Prix de la grille en euros (1800) → centimes (180000) */
export function enCentimes(euros) {
  return Math.round(Number(euros) * 100);
}

/** Date du jour à Paris, au format AAAA-MM-JJ */
export function aujourdhui(maintenant = new Date()) {
  // Le format canadien anglais donne directement AAAA-MM-JJ
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(maintenant);
}

/** « 2026-10-16 » + 30 → « 2026-11-15 » */
export function ajouterJours(iso, jours) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + jours);
  return date.toISOString().slice(0, 10);
}

/** « 2026-01-31 » + 1 mois → « 2026-02-28 » (le jour est ramené à la fin du mois si besoin) */
export function ajouterMois(iso, mois) {
  const [annee, m, jour] = iso.split("-").map(Number);
  const cible = new Date(Date.UTC(annee, m - 1 + mois, 1));
  const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(jour, dernierJour));
  return cible.toISOString().slice(0, 10);
}

export function anneeDe(iso) {
  return Number(iso.slice(0, 4));
}

/** Vérifie qu'une chaîne est une vraie date AAAA-MM-JJ */
export function estDateIso(texte) {
  if (typeof texte !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(texte)) return false;
  const date = new Date(`${texte}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === texte;
}
