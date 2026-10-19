/* ==========================================================================
   Vérification de Cloudflare Access sur /admin et /api/admin
   --------------------------------------------------------------------------
   Cloudflare Access demande un code par e-mail avant de laisser passer la
   requête, puis la transmet avec un jeton signé (JWT) dans l'en-tête
   Cf-Access-Jwt-Assertion. Le Worker vérifie ce jeton à chaque requête :
   signature, émetteur, audience, expiration et adresse e-mail. Sans cette
   vérification, l'admin resterait joignable par l'adresse *.workers.dev ou
   une URL de prévisualisation, qui ne passent pas par Access.

   Réglages :
     ACCESS_TEAM_DOMAIN  https://<équipe>.cloudflareaccess.com (wrangler.jsonc, « vars »)
     ACCESS_AUD          « Application Audience (AUD) Tag » de l'application Access (idem)
     ADMIN_EMAIL         seule adresse autorisée : secret du Worker, hors du dépôt public
   En local uniquement (fichier .dev.vars) : ADMIN_ACCES_LOCAL=1 sur localhost.
   ========================================================================== */

const MARGE_HORLOGE = 60; // secondes tolérées sur exp / nbf
const DUREE_CACHE_CLES = 60 * 60 * 1000;
// Rechargement forcé (clé inconnue) au plus une fois par minute : un jeton
// forgé avec un « kid » au hasard ne déclenche pas un appel à chaque requête
const INTERVALLE_RECHARGEMENT = 60 * 1000;

let cacheCles = { equipe: null, cles: null, expire: 0, recharge: 0 };

function base64UrlEnOctets(texte) {
  const base64 = texte.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(texte.length / 4) * 4, "=");
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

function decoderPartie(texte) {
  return JSON.parse(new TextDecoder().decode(base64UrlEnOctets(texte)));
}

function lireCookie(request, nom) {
  const cookies = request.headers.get("Cookie") || "";
  for (const morceau of cookies.split(";")) {
    const [cle, ...valeur] = morceau.trim().split("=");
    if (cle === nom) return valeur.join("=");
  }
  return null;
}

function reglageValide(valeur) {
  return typeof valeur === "string" && valeur.trim() !== "" && !/COMPL[ÉE]TER/i.test(valeur);
}

async function clesPubliques(equipe, chercher, forcer = false) {
  const enCache = cacheCles.equipe === equipe && cacheCles.expire > Date.now();
  if (enCache && (!forcer || Date.now() - cacheCles.recharge < INTERVALLE_RECHARGEMENT)) return cacheCles.cles;
  const reponse = await chercher(`${equipe}/cdn-cgi/access/certs`);
  if (!reponse.ok) throw new Error(`clés Access indisponibles (${reponse.status})`);
  const { keys } = await reponse.json();
  cacheCles = { equipe, cles: keys || [], expire: Date.now() + DUREE_CACHE_CLES, recharge: Date.now() };
  return cacheCles.cles;
}

/** Vide le cache des clés (tests) */
export function oublierClesAccess() {
  cacheCles = { equipe: null, cles: null, expire: 0, recharge: 0 };
}

/**
 * Renvoie { ok: true, email } si la requête porte un jeton Access valide
 * pour l'administrateur, sinon { ok: false, raison }.
 * options.fetch et options.maintenant (secondes) servent aux tests.
 */
export async function verifierAcces(request, env, options = {}) {
  const chercher = options.fetch || fetch;
  const maintenant = options.maintenant ?? Math.floor(Date.now() / 1000);

  // Développement local (wrangler dev) : Access n'existe pas sur localhost
  const hote = new URL(request.url).hostname;
  if (env.ADMIN_ACCES_LOCAL === "1" && (hote === "localhost" || hote === "127.0.0.1")) {
    return { ok: true, email: "local" };
  }

  if (!reglageValide(env.ACCESS_TEAM_DOMAIN) || !reglageValide(env.ACCESS_AUD) || !reglageValide(env.ADMIN_EMAIL)) {
    return { ok: false, raison: "Access non configuré (ACCESS_TEAM_DOMAIN, ACCESS_AUD, ADMIN_EMAIL)" };
  }
  const equipe = env.ACCESS_TEAM_DOMAIN.trim().replace(/\/+$/, "").replace(/^(?!https:\/\/)/, "https://");

  const jeton = request.headers.get("Cf-Access-Jwt-Assertion") || lireCookie(request, "CF_Authorization");
  if (!jeton) return { ok: false, raison: "jeton Access absent" };

  const parties = jeton.split(".");
  if (parties.length !== 3) return { ok: false, raison: "jeton mal formé" };

  let entete, contenu;
  try {
    entete = decoderPartie(parties[0]);
    contenu = decoderPartie(parties[1]);
  } catch {
    return { ok: false, raison: "jeton illisible" };
  }
  if (entete.alg !== "RS256" || !entete.kid) return { ok: false, raison: "algorithme refusé" };

  let cles = await clesPubliques(equipe, chercher);
  let jwk = cles.find((cle) => cle.kid === entete.kid);
  if (!jwk) {
    // Clés renouvelées par Cloudflare : on recharge une fois
    cles = await clesPubliques(equipe, chercher, true);
    jwk = cles.find((cle) => cle.kid === entete.kid);
  }
  if (!jwk) return { ok: false, raison: "clé de signature inconnue" };

  const cle = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signatureValide = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cle,
    base64UrlEnOctets(parties[2]),
    new TextEncoder().encode(`${parties[0]}.${parties[1]}`)
  );
  if (!signatureValide) return { ok: false, raison: "signature invalide" };

  if (contenu.iss !== equipe) return { ok: false, raison: "émetteur inattendu" };
  const audiences = Array.isArray(contenu.aud) ? contenu.aud : [contenu.aud];
  if (!audiences.includes(env.ACCESS_AUD.trim())) return { ok: false, raison: "audience inattendue" };
  if (typeof contenu.exp !== "number" || contenu.exp + MARGE_HORLOGE < maintenant) return { ok: false, raison: "jeton expiré" };
  if (typeof contenu.nbf === "number" && contenu.nbf - MARGE_HORLOGE > maintenant) return { ok: false, raison: "jeton pas encore valide" };

  const email = String(contenu.email || "").toLowerCase();
  if (email !== env.ADMIN_EMAIL.trim().toLowerCase()) return { ok: false, raison: "adresse non autorisée" };

  return { ok: true, email };
}
