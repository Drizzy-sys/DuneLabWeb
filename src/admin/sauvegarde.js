/* ==========================================================================
   Sauvegarde automatique dans R2 (tâche planifiée, voir « triggers » dans
   wrangler.jsonc). D1 ne garde que 30 jours d'historique : chaque nuit, toute
   la base est exportée en JSON compressé.
     sauvegardes/quotidiennes/AAAA-MM-JJ.json.gz  supprimées après 60 jours (règle de cycle de vie R2)
     sauvegardes/mensuelles/AAAA-MM.json.gz       première sauvegarde du mois, verrouillée 11 ans
   Restauration : scripts/restaurer.js (voir README).
   ========================================================================== */

import { exporterDonnees } from "./exports.js";
import { empreinteSha256 } from "./archives.js";
import { aujourdhui } from "../../public/admin/js/lib/format.js";

async function compresser(texte) {
  const flux = new Blob([texte]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

export async function sauvegarderDansR2(env, maintenant = new Date()) {
  const donnees = await exporterDonnees(env.DB, maintenant);
  const octets = await compresser(JSON.stringify(donnees));
  const sha256 = await empreinteSha256(octets);
  const jour = aujourdhui(maintenant);
  const options = {
    sha256,
    httpMetadata: { contentType: "application/gzip" },
    customMetadata: {
      sha256,
      factures: String(donnees.tables.factures.length),
      devis: String(donnees.tables.devis.length),
    },
  };

  const cles = [`sauvegardes/quotidiennes/${jour}.json.gz`];
  await env.ARCHIVES.put(cles[0], octets, options);

  // Une sauvegarde mensuelle, écrite une seule fois (jamais écrasée)
  const mensuelle = `sauvegardes/mensuelles/${jour.slice(0, 7)}.json.gz`;
  if (!(await env.ARCHIVES.head(mensuelle))) {
    await env.ARCHIVES.put(mensuelle, octets, options);
    cles.push(mensuelle);
  }
  console.log(`Sauvegarde : ${cles.join(", ")} (${octets.length} octets, ${donnees.tables.factures.length} factures)`);
  return cles;
}
