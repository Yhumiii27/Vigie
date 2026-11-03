// Substituts des vues des autres outils (lot 0 de M-02, docs/specs/convergence-m02.md § 2.3). Vigie tourne seul en
// démonstration, dans l'application Mac et dans les tests : les schémas matrix, keystone… n'y existent pas. Pour que le code
// de lecture soit le même partout, l'ouverture de la base crée, pour chaque schéma absent, une table de démonstration et
// une vue `pub_…` de mêmes colonnes, types et ordre que le contrat publié (src/db/foreign.ts), remplies par
// src/db/seeds/foreign.ts.
//
// Créés seulement quand le moteur est PGlite ou que la démonstration est active, et que le rôle peut créer un schéma :
// jamais sur le serveur commun EPC2I (schémas des outils présents ; vigie_app n'y a pas le droit CREATE sur la base),
// jamais dans drizzle/. Base PostgreSQL dédiée hors démonstration : aucun substitut, les sources sont « indisponibles ».
// Un schéma créé ici porte un commentaire repère : il est recréé à chaque ouverture (contrat à jour), jamais un schéma
// qui ne le porte pas (vraie publication d'un outil).

import { sql } from 'drizzle-orm';
import { FOREIGN_CONTRACTS, type ForeignSourceKey } from './foreign';
import { demoForeignRows } from './seeds/foreign';
import type { Db, DbEngine } from './types';
import { log } from '../lib/log';

/** Commentaire repère d'un schéma de substitution (créé par Vigie, recréé à chaque ouverture). */
export const SUBSTITUTE_MARK = 'Substitut de démonstration de Vigie (src/db/foreign-substitutes.ts) : jamais sur le serveur commun.';

/** Table de démonstration derrière la vue `pub_x` de substitution. */
export const substituteTable = (view: string) => `substitut_${view.replace(/^pub_/, '')}`;

type Row = Record<string, string | number | boolean | null>;

const literal = (v: Row[string] | undefined) =>
  v == null ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;

async function rows<T>(db: Db, q: ReturnType<typeof sql>) {
  return ((await db.execute(q)) as unknown as { rows: T[] }).rows;
}

/**
 * Crée (ou recrée) les substituts manquants. Renvoie les schémas créés. Sans effet sur un schéma qui n'est pas un
 * substitut de Vigie. Jamais bloquant : une erreur est journalisée et la source restera « indisponible ».
 */
export async function installForeignSubstitutes(db: Db, opts: { engine: DbEngine; demo: boolean }): Promise<string[]> {
  if (opts.engine !== 'pglite' && !opts.demo) return [];
  const bySchema = new Map<string, ForeignSourceKey[]>();
  for (const [key, c] of Object.entries(FOREIGN_CONTRACTS) as [ForeignSourceKey, (typeof FOREIGN_CONTRACTS)[ForeignSourceKey]][]) {
    bySchema.set(c.schema, [...(bySchema.get(c.schema) ?? []), key]);
  }
  const data = demoForeignRows();
  const created: string[] = [];
  try {
    const [{ creatable }] = await rows<{ creatable: boolean }>(db, sql`select has_database_privilege(current_database(), 'CREATE') as creatable`);
    for (const [schema, keys] of bySchema) {
      const [state] = await rows<{ present: boolean; mark: string | null }>(db, sql`select exists (select from pg_namespace where nspname = ${schema}) as present,
        obj_description((select oid from pg_namespace where nspname = ${schema}), 'pg_namespace') as mark`);
      if (state.present && state.mark !== SUBSTITUTE_MARK) continue; // vraie publication de l'outil
      if (!creatable) {
        log.warn('foreign.substitute', `Substitut du schéma ${schema} non créé : le rôle ne peut pas créer de schéma`, { schema });
        continue;
      }
      const statements = [`drop schema if exists "${schema}" cascade`, `create schema "${schema}"`, `comment on schema "${schema}" is '${SUBSTITUTE_MARK.replaceAll("'", "''")}'`];
      for (const key of keys) {
        const c = FOREIGN_CONTRACTS[key];
        const table = `"${schema}"."${substituteTable(c.view)}"`;
        statements.push(`create table ${table} (${c.columns.map(([n, type]) => `"${n}" ${type}`).join(', ')})`);
        const list = data[key];
        if (list.length) {
          statements.push(`insert into ${table} (${c.columns.map(([n]) => `"${n}"`).join(', ')}) values ${list
            .map((r) => `(${c.columns.map(([n]) => literal(r[n])).join(', ')})`).join(', ')}`);
        }
        statements.push(`create view "${schema}"."${c.view}" as select ${c.columns.map(([n]) => `"${n}"`).join(', ')} from ${table}`);
      }
      await db.transaction(async (tx) => {
        for (const s of statements) await tx.execute(sql.raw(s));
      });
      created.push(schema);
    }
  } catch (err) {
    log.error('foreign.substitute', 'Substituts des vues des autres outils non créés', { error: err });
  }
  return created;
}
