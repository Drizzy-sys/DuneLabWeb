/* ==========================================================================
   Archives R2 : PDF des devis envoyés, des factures et des avoirs émis.
   --------------------------------------------------------------------------
   Un PDF archivé n'est jamais régénéré ni remplacé : on l'écrit une seule
   fois, avec son empreinte SHA-256 (recopiée dans D1 pour prouver qu'il n'a
   pas changé). Le verrou de rétention du bucket (voir README) interdit en
   plus toute suppression pendant 11 ans.
   ========================================================================== */

export async function empreinteSha256(octets) {
  const condensat = await crypto.subtle.digest("SHA-256", octets);
  return [...new Uint8Array(condensat)].map((o) => o.toString(16).padStart(2, "0")).join("");
}

export function clePdf(genre, numero) {
  const dossier = { devis: "devis", facture: "factures", avoir: "avoirs" }[genre];
  const annee = numero.split("-")[1];
  return `${dossier}/${annee}/${numero}.pdf`;
}

/**
 * Écrit le PDF s'il n'existe pas encore et renvoie { cle, sha256 }.
 * S'il existe déjà (tentative précédente interrompue), il est conservé tel quel.
 */
export async function archiverPdf(r2, cle, octets) {
  const existant = await r2.head(cle);
  if (existant) {
    return { cle, sha256: existant.customMetadata?.sha256 || null };
  }
  const sha256 = await empreinteSha256(octets);
  await r2.put(cle, octets, {
    sha256,
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { sha256 },
  });
  return { cle, sha256 };
}

export async function lirePdfArchive(r2, cle) {
  const objet = await r2.get(cle);
  if (!objet) return null;
  return new Uint8Array(await objet.arrayBuffer());
}
