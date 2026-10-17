/* ==========================================================================
   Espace admin : /admin (interface) et /api/admin/* (données)
   --------------------------------------------------------------------------
   Chaque requête doit porter un jeton Cloudflare Access valide (acces.js).
   Sinon : page 404 du site, comme si l'admin n'existait pas.
   Les fichiers de l'interface (public/admin/) ne sont servis qu'après cette
   vérification : le Worker passe avant eux (run_worker_first, wrangler.jsonc).
   ========================================================================== */

import grilleInitiale from "../../data/grille.json" with { type: "json" };
import { verifierAcces } from "./acces.js";
import { ErreurMetier, avecEntetesAdmin, fichier, json, reponseErreur, ENTETES_ADMIN } from "./http.js";
import { chargerPolices } from "./pdf.js";
import {
  emetteurIncomplet,
  enregistrerGrille,
  fichierGrilleAImporter,
  grilleCourante,
  historiqueGrille,
  importerGrilleDuFichier,
  lireVersionGrille,
} from "./grille.js";
import { creerClient, listerClients, lireClient, modifierClient, supprimerClient } from "./clients.js";
import {
  changerStatutDevis,
  creerDevis,
  dupliquerDevis,
  envoyerDevis,
  listerDevis,
  lireDevis,
  modifierDevis,
  modifierSuiviDevis,
  pdfDevis,
  supprimerDevis,
  syntheseDevis,
} from "./devis.js";
import {
  annulerPaiement,
  creerAvoir,
  creerFacture,
  creerFactureAbonnement,
  creerFactureDepuisDevis,
  dupliquerFacture,
  emettreFacture,
  enregistrerPaiement,
  listerFactures,
  lireFacture,
  modifierFacture,
  modifierNotes,
  pdfFacture,
  supprimerFacture,
  transmettreFacture,
} from "./factures.js";
import { connecteurFacturation } from "./connecteurs/index.js";
import { tableauDeBord } from "./tableau-de-bord.js";
import { exporterDonnees, facturesCsv } from "./exports.js";
import { aujourdhui } from "../../public/admin/js/lib/format.js";

export function estRouteAdmin(chemin) {
  return chemin === "/admin" || chemin.startsWith("/admin/") || chemin === "/api/admin" || chemin.startsWith("/api/admin/");
}

// Polices du PDF : chargées une fois par instance du Worker
let polices = null;

function contexteApplication(env) {
  return {
    db: env.DB,
    r2: env.ARCHIVES,
    aujourdhui: aujourdhui(),
    grilleInitiale,
    env,
    connecteur: connecteurFacturation(env),
    polices: () => {
      polices ??= chargerPolices(env.ASSETS).catch((erreur) => {
        polices = null;
        throw erreur;
      });
      return polices;
    },
  };
}

async function pageIntrouvable(env, url) {
  if (url.pathname.startsWith("/api/")) return json({ erreur: "Introuvable." }, 404);
  const page = await env.ASSETS.fetch(new Request(new URL("/introuvable", url)));
  const reponse = new Response(page.body, { status: 404, headers: page.headers });
  reponse.headers.set("X-Robots-Tag", ENTETES_ADMIN["X-Robots-Tag"]);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}

export async function gererAdmin(request, env) {
  const url = new URL(request.url);
  let acces;
  try {
    acces = await verifierAcces(request, env);
  } catch (erreur) {
    acces = { ok: false, raison: `vérification impossible : ${erreur.message}` };
  }
  if (!acces.ok) {
    console.warn(`Admin : accès refusé (${acces.raison}) pour ${request.method} ${url.pathname}`);
    return pageIntrouvable(env, url);
  }

  if (url.pathname === "/api/admin" || url.pathname.startsWith("/api/admin/")) return api(request, env, url);

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD", ...ENTETES_ADMIN } });
  }
  return avecEntetesAdmin(await env.ASSETS.fetch(request));
}

/* ---------- API ---------- */

const id = (p) => Number(p[1]);
const anneeDemandee = (url, app) => {
  const annee = Number(url.searchParams.get("annee"));
  return Number.isInteger(annee) && annee > 2000 && annee < 2200 ? annee : Number(app.aujourdhui.slice(0, 4));
};
const pdf = ({ octets, nom }) => fichier(octets, "application/pdf", nom, true);

// [méthode, chemin après /api/admin, action(app, paramètres, corps, url)]
const ROUTES = [
  ["GET", /^\/tableau-de-bord$/, (app, p, c, url) => tableauDeBord(app, anneeDemandee(url, app))],

  ["GET", /^\/grille$/, async (app) => {
    const grille = await grilleCourante(app);
    return { ...grille, emetteur_incomplet: emetteurIncomplet(grille.contenu), fichier_a_importer: await fichierGrilleAImporter(app) };
  }],
  ["PUT", /^\/grille$/, (app, p, corps) => enregistrerGrille(app, corps?.contenu)],
  ["POST", /^\/grille\/importer-fichier$/, (app) => importerGrilleDuFichier(app)],
  ["GET", /^\/grille\/historique$/, (app) => historiqueGrille(app)],
  ["GET", /^\/grille\/(\d+)$/, async (app, p) => (await lireVersionGrille(app, id(p))) ?? Promise.reject(new ErreurMetier("Version introuvable.", 404))],

  ["GET", /^\/clients$/, (app) => listerClients(app)],
  ["POST", /^\/clients$/, (app, p, corps) => creerClient(app, corps)],
  ["GET", /^\/clients\/(\d+)$/, (app, p) => lireClient(app, id(p))],
  ["PUT", /^\/clients\/(\d+)$/, (app, p, corps) => modifierClient(app, id(p), corps)],
  ["DELETE", /^\/clients\/(\d+)$/, async (app, p) => (await supprimerClient(app, id(p)), { ok: true })],

  ["GET", /^\/devis$/, (app) => listerDevis(app)],
  ["POST", /^\/devis$/, (app, p, corps) => creerDevis(app, corps)],
  ["GET", /^\/devis\/(\d+)$/, (app, p) => lireDevis(app, id(p))],
  ["PUT", /^\/devis\/(\d+)$/, (app, p, corps) => modifierDevis(app, id(p), corps)],
  ["DELETE", /^\/devis\/(\d+)$/, async (app, p) => (await supprimerDevis(app, id(p)), { ok: true })],
  ["POST", /^\/devis\/(\d+)\/dupliquer$/, (app, p) => dupliquerDevis(app, id(p))],
  ["POST", /^\/devis\/(\d+)\/envoyer$/, (app, p) => envoyerDevis(app, id(p))],
  ["POST", /^\/devis\/(\d+)\/statut$/, (app, p, corps) => changerStatutDevis(app, id(p), corps?.statut)],
  ["PUT", /^\/devis\/(\d+)\/suivi$/, (app, p, corps) => modifierSuiviDevis(app, id(p), corps)],
  ["POST", /^\/devis\/(\d+)\/factures$/, (app, p, corps) => creerFactureDepuisDevis(app, id(p), corps?.rang ?? null)],
  ["POST", /^\/devis\/(\d+)\/abonnement$/, (app, p, corps) => creerFactureAbonnement(app, id(p), corps?.periodicite)],
  ["GET", /^\/devis\/(\d+)\/pdf$/, async (app, p) => pdf(await pdfDevis(app, id(p)))],
  ["GET", /^\/devis\/(\d+)\/synthese$/, async (app, p, c, url) => pdf(await syntheseDevis(app, id(p), { avecNotes: url.searchParams.get("notes") === "1" }))],

  ["GET", /^\/factures$/, (app, p, c, url) => listerFactures(app, { annee: url.searchParams.get("annee") ? anneeDemandee(url, app) : null })],
  ["GET", /^\/factures\.csv$/, async (app, p, c, url) => {
    const annee = anneeDemandee(url, app);
    return fichier(await facturesCsv(app, annee), "text/csv; charset=utf-8", `factures-${annee}.csv`);
  }],
  ["POST", /^\/factures$/, (app, p, corps) => creerFacture(app, corps)],
  ["GET", /^\/factures\/(\d+)$/, (app, p) => lireFacture(app, id(p))],
  ["PUT", /^\/factures\/(\d+)$/, (app, p, corps) => modifierFacture(app, id(p), corps)],
  ["DELETE", /^\/factures\/(\d+)$/, async (app, p) => (await supprimerFacture(app, id(p)), { ok: true })],
  ["POST", /^\/factures\/(\d+)\/emettre$/, (app, p) => emettreFacture(app, id(p))],
  ["POST", /^\/factures\/(\d+)\/paiement$/, (app, p, corps) => enregistrerPaiement(app, id(p), corps)],
  ["DELETE", /^\/factures\/(\d+)\/paiement$/, (app, p) => annulerPaiement(app, id(p))],
  ["POST", /^\/factures\/(\d+)\/avoir$/, (app, p) => creerAvoir(app, id(p))],
  ["POST", /^\/factures\/(\d+)\/transmettre$/, async (app, p) => (await transmettreFacture(app, id(p)), lireFacture(app, id(p)))],
  ["POST", /^\/factures\/(\d+)\/dupliquer$/, (app, p) => dupliquerFacture(app, id(p))],
  ["PUT", /^\/factures\/(\d+)\/notes$/, (app, p, corps) => modifierNotes(app, id(p), corps?.notes)],
  ["GET", /^\/factures\/(\d+)\/pdf$/, async (app, p) => pdf(await pdfFacture(app, id(p)))],

  ["GET", /^\/export\.json$/, async (app) => {
    const donnees = await exporterDonnees(app.db);
    return fichier(JSON.stringify(donnees, null, 1), "application/json; charset=utf-8", `dunelab-admin-${app.aujourdhui}.json`);
  }],
];

const TAILLE_MAX_CORPS = 1_000_000;

async function lireCorps(request, url) {
  if (request.method === "GET" || request.method === "HEAD") return null;
  // Écritures : même origine et JSON uniquement (protection contre les requêtes intersites)
  if (request.headers.get("Origin") !== url.origin) throw new ErreurMetier("Origine refusée.", 403);
  if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) {
    throw new ErreurMetier("Contenu JSON attendu.", 415);
  }
  const texte = await request.text();
  if (texte.length > TAILLE_MAX_CORPS) throw new ErreurMetier("Requête trop volumineuse.", 413);
  if (texte === "") return {};
  try {
    return JSON.parse(texte);
  } catch {
    throw new ErreurMetier("JSON invalide.", 400);
  }
}

async function api(request, env, url) {
  const chemin = url.pathname.slice("/api/admin".length) || "/";
  const methode = request.method === "HEAD" ? "GET" : request.method;
  const candidates = ROUTES.filter(([, motif]) => motif.test(chemin));
  const route = candidates.find(([m]) => m === methode);
  if (!route) {
    if (candidates.length) return json({ erreur: "Méthode non autorisée." }, 405);
    return json({ erreur: "Introuvable." }, 404);
  }
  try {
    const corps = await lireCorps(request, url);
    const app = contexteApplication(env);
    const resultat = await route[2](app, chemin.match(route[1]), corps, url);
    return resultat instanceof Response ? resultat : json(resultat);
  } catch (erreur) {
    return reponseErreur(erreur);
  }
}
