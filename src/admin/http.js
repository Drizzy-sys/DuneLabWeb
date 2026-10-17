/* Réponses HTTP de l'espace admin et erreurs métier */

/** Erreur affichée telle quelle à l'utilisateur (statut HTTP 400, 404, 409, 422) */
export class ErreurMetier extends Error {
  constructor(message, statut = 409, details = undefined) {
    super(message);
    this.statut = statut;
    this.details = details;
  }
}

export const introuvable = (quoi) => new ErreurMetier(`${quoi} introuvable.`, 404);

// En-têtes de toutes les réponses de l'admin : jamais indexées, jamais en cache
export const ENTETES_ADMIN = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; " +
    "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
};

export function json(donnees, statut = 200) {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "Content-Type": "application/json; charset=utf-8", ...ENTETES_ADMIN },
  });
}

export function reponseErreur(erreur) {
  if (erreur instanceof ErreurMetier) {
    return json({ erreur: erreur.message, details: erreur.details }, erreur.statut);
  }
  // Refus des triggers SQLite (facture émise, numérotation) : message lisible
  const message = String(erreur?.message ?? "");
  const refus = message.match(/(Facture émise[^"]*?\.|Numérotation non chronologique[^"]*?\.)/);
  if (refus) return json({ erreur: refus[1] }, 409);
  console.error("Erreur interne de l'admin :", erreur);
  return json({ erreur: "Erreur interne. Détails dans les journaux du Worker." }, 500);
}

/** Ajoute les en-têtes de l'admin à une réponse existante (fichiers statiques) */
export function avecEntetesAdmin(reponse) {
  const copie = new Response(reponse.body, reponse);
  for (const [nom, valeur] of Object.entries(ENTETES_ADMIN)) copie.headers.set(nom, valeur);
  return copie;
}

// PDF et CSV : pas de politique de contenu de page (la visionneuse PDF du navigateur pourrait la refuser)
export function fichier(contenu, type, nomFichier, enLigne = false) {
  const { "Content-Security-Policy": _csp, "X-Frame-Options": _cadre, ...entetes } = ENTETES_ADMIN;
  return new Response(contenu, {
    headers: {
      ...entetes,
      "Content-Type": type,
      "Content-Disposition": `${enLigne ? "inline" : "attachment"}; filename="${nomFichier}"`,
    },
  });
}
