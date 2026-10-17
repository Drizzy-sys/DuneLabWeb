/* Vérification du jeton Cloudflare Access (JWT) sur /admin et /api/admin */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { oublierClesAccess, verifierAcces } from "../src/admin/acces.js";

const EQUIPE = "https://dunelab.cloudflareaccess.com";
const AUD = "aud-de-test-0123456789";
const EMAIL = "admin@exemple.fr";
const ENV = { ACCESS_TEAM_DOMAIN: EQUIPE, ACCESS_AUD: AUD, ADMIN_EMAIL: EMAIL };
const MAINTENANT = 1_800_000_000;

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"]
);
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "cle-1" };

const base64Url = (octets) => Buffer.from(octets).toString("base64url");

async function jeton(contenu, { kid = "cle-1", cle = privateKey, alg = "RS256" } = {}) {
  const entete = base64Url(JSON.stringify({ alg, kid, typ: "JWT" }));
  const corps = base64Url(JSON.stringify(contenu));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cle, new TextEncoder().encode(`${entete}.${corps}`));
  return `${entete}.${corps}.${base64Url(new Uint8Array(signature))}`;
}

const contenuValide = (extra = {}) => ({ iss: EQUIPE, aud: [AUD], email: EMAIL, exp: MAINTENANT + 3600, iat: MAINTENANT, ...extra });

let appelsCles = 0;
const fetchCles = async (url) => {
  appelsCles++;
  assert.equal(url, `${EQUIPE}/cdn-cgi/access/certs`);
  return new Response(JSON.stringify({ keys: [jwk] }));
};

function requete(valeur, { hote = "www.exemple.fr", cookie = false } = {}) {
  const headers = new Headers();
  if (valeur && cookie) headers.set("Cookie", `autre=1; CF_Authorization=${valeur}`);
  else if (valeur) headers.set("Cf-Access-Jwt-Assertion", valeur);
  return new Request(`https://${hote}/api/admin/devis`, { headers });
}

const verifier = (req, env = ENV) => verifierAcces(req, env, { fetch: fetchCles, maintenant: MAINTENANT });

beforeEach(() => {
  oublierClesAccess();
  appelsCles = 0;
});

test("jeton valide (en-tête ou cookie Access) : accès accordé", async () => {
  assert.deepEqual(await verifier(requete(await jeton(contenuValide()))), { ok: true, email: EMAIL });
  assert.equal((await verifier(requete(await jeton(contenuValide()), { cookie: true }))).ok, true);
  assert.equal(appelsCles, 1); // clés publiques mises en cache
});

test("sans jeton (adresse *.workers.dev qui contourne Access) : refusé", async () => {
  const resultat = await verifier(requete(null, { hote: "dunelab.compte.workers.dev" }));
  assert.deepEqual(resultat, { ok: false, raison: "jeton Access absent" });
});

test("signature falsifiée ou clé inconnue : refusé", async () => {
  const autre = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  assert.equal((await verifier(requete(await jeton(contenuValide(), { cle: autre.privateKey })))).raison, "signature invalide");
  assert.equal((await verifier(requete(await jeton(contenuValide(), { kid: "inconnue" })))).raison, "clé de signature inconnue");

  // Contenu modifié après signature (autre adresse e-mail)
  const [entete, , signature] = (await jeton(contenuValide())).split(".");
  const triche = `${entete}.${base64Url(JSON.stringify(contenuValide({ email: "pirate@exemple.fr" })))}.${signature}`;
  assert.equal((await verifier(requete(triche))).raison, "signature invalide");
});

test("algorithme autre que RS256 refusé", async () => {
  const [, corps] = (await jeton(contenuValide())).split(".");
  const sansSignature = `${base64Url(JSON.stringify({ alg: "none", kid: "cle-1" }))}.${corps}.`;
  assert.equal((await verifier(requete(sansSignature))).raison, "algorithme refusé");
});

test("jeton d'une autre application, d'une autre équipe, expiré ou d'un autre utilisateur : refusé", async () => {
  assert.equal((await verifier(requete(await jeton(contenuValide({ aud: ["autre-application"] }))))).raison, "audience inattendue");
  assert.equal((await verifier(requete(await jeton(contenuValide({ iss: "https://autre.cloudflareaccess.com" }))))).raison, "émetteur inattendu");
  assert.equal((await verifier(requete(await jeton(contenuValide({ exp: MAINTENANT - 3600 }))))).raison, "jeton expiré");
  assert.equal((await verifier(requete(await jeton(contenuValide({ email: "quelquun@exemple.fr" }))))).raison, "adresse non autorisée");
});

test("réglages Access absents ou laissés « À COMPLÉTER » : tout est refusé", async () => {
  const valide = requete(await jeton(contenuValide()));
  for (const env of [{}, { ...ENV, ACCESS_AUD: "À COMPLÉTER" }, { ...ENV, ADMIN_EMAIL: "" }]) {
    assert.equal((await verifier(valide, env)).ok, false);
  }
});

test("accès local sans Access : seulement avec ADMIN_ACCES_LOCAL=1 et sur localhost", async () => {
  const local = { ...ENV, ADMIN_ACCES_LOCAL: "1" };
  assert.equal((await verifier(requete(null, { hote: "localhost:8787" }), local)).ok, true);
  assert.equal((await verifier(requete(null, { hote: "127.0.0.1:8787" }), local)).ok, true);
  assert.equal((await verifier(requete(null, { hote: "www.exemple.fr" }), local)).ok, false);
  assert.equal((await verifier(requete(null, { hote: "localhost:8787" }), ENV)).ok, false);
});

test("jetons forgés avec des clés inconnues : les clés Access ne sont pas rechargées à chaque requête", async () => {
  for (let i = 0; i < 5; i++) {
    const resultat = await verifier(requete(await jeton(contenuValide(), { kid: `hasard-${i}` })));
    assert.equal(resultat.raison, "clé de signature inconnue");
  }
  assert.equal(appelsCles, 1); // chargées une fois, pas de rechargement forcé dans la minute
});
