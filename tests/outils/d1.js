/* ==========================================================================
   Base D1 de test : SQLite intégré à Node (même moteur que D1), avec les
   vraies migrations du dossier migrations/ (tables, contraintes, triggers).
   Reproduit l'API D1 utilisée par le Worker : prepare, bind, first, all,
   run, batch (transaction : tout ou rien).
   ========================================================================== */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOSSIER_MIGRATIONS = fileURLToPath(new URL("../../migrations/", import.meta.url));

export function migrations() {
  return readdirSync(DOSSIER_MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(DOSSIER_MIGRATIONS + f, "utf8"));
}

function verifierParametres(parametres) {
  for (const p of parametres) {
    // D1 refuse undefined : le test doit échouer aussi
    if (p === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
    if (typeof p === "boolean") throw new Error("Valeur booléenne : utiliser 0 ou 1");
  }
}

const enObjet = (ligne) => (ligne ? { ...ligne } : null);

/**
 * D1 accepte les paramètres numérotés (?1, ?2…), pas le SQLite de Node 22 :
 * on les réécrit en « ? » anonymes, dans l'ordre d'apparition, en suivant la
 * règle de SQLite (un « ? » seul prend le numéro le plus élevé vu + 1).
 * Les chaînes entre apostrophes sont recopiées telles quelles.
 */
function parametresAnonymes(sql, parametres) {
  let resultat = "";
  const valeurs = [];
  let plusGrand = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      const fin = sql.indexOf("'", i + 1);
      resultat += sql.slice(i, fin + 1);
      i = fin;
      continue;
    }
    if (c !== "?") {
      resultat += c;
      continue;
    }
    const chiffres = /^\d+/.exec(sql.slice(i + 1))?.[0];
    const numero = chiffres ? Number(chiffres) : plusGrand + 1;
    plusGrand = Math.max(plusGrand, numero);
    valeurs.push(parametres[numero - 1]);
    resultat += "?";
    i += chiffres ? chiffres.length : 0;
  }
  return { sql: resultat, valeurs };
}

class Instruction {
  constructor(sqlite, sql, parametres = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.parametres = parametres;
  }

  bind(...parametres) {
    return new Instruction(this.sqlite, this.sql, parametres);
  }

  executer() {
    verifierParametres(this.parametres);
    const { sql, valeurs } = parametresAnonymes(this.sql, this.parametres);
    const instruction = this.sqlite.prepare(sql);
    const renvoieDesLignes = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
    if (renvoieDesLignes) {
      const results = instruction.all(...valeurs).map(enObjet);
      return { success: true, results, meta: { changes: /^\s*SELECT/i.test(sql) ? 0 : results.length } };
    }
    const { changes, lastInsertRowid } = instruction.run(...valeurs);
    return { success: true, results: [], meta: { changes: Number(changes), last_row_id: Number(lastInsertRowid) } };
  }

  async all() {
    return this.executer();
  }

  async run() {
    return this.executer();
  }

  async first(colonne) {
    const ligne = this.executer().results[0] ?? null;
    if (!ligne) return null;
    return colonne ? ligne[colonne] : ligne;
  }
}

export function creerD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const sql of migrations()) sqlite.exec(sql);
  return {
    sqlite,
    prepare(sql) {
      return new Instruction(sqlite, sql);
    },
    async batch(instructions) {
      sqlite.exec("BEGIN");
      try {
        const resultats = instructions.map((i) => i.executer());
        sqlite.exec("COMMIT");
        return resultats;
      } catch (erreur) {
        sqlite.exec("ROLLBACK");
        throw erreur;
      }
    },
    async exec(sql) {
      sqlite.exec(sql);
    },
  };
}

/** Bucket R2 en mémoire (put, get, head, list) */
export function creerR2() {
  const objets = new Map();
  return {
    objets,
    async put(cle, octets, options = {}) {
      objets.set(cle, { octets: new Uint8Array(octets), customMetadata: options.customMetadata || {} });
    },
    async head(cle) {
      const o = objets.get(cle);
      return o ? { key: cle, customMetadata: o.customMetadata } : null;
    },
    async get(cle) {
      const o = objets.get(cle);
      return o ? { key: cle, customMetadata: o.customMetadata, arrayBuffer: async () => o.octets.slice().buffer } : null;
    },
    async delete(cle) {
      objets.delete(cle);
    },
  };
}
