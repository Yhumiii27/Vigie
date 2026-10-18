// Migrations de drizzle/ (PRD-06) : journal, état d'une base (migrations appliquées, en attente) et empreintes des
// migrations publiées (drizzle/checksums.json, contrôlées par npm run db:check). Module sans 'server-only' :
// utilisé par src/db/index.ts (sauvegarde avant migration) et par scripts/vigie-db.ts.
//
// Règle : une migration publiée ne se modifie jamais ; tout changement de schéma passe par une nouvelle migration
// (npm run db:generate). Le migrator de Drizzle n'applique que les migrations plus récentes (« when ») que la dernière
// appliquée : une migration publiée modifiée ne serait jamais rejouée sur les bases existantes.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { DbEngine } from './types';

/** Dossier des migrations (drizzle/), à côté du serveur (copié avec la sortie standalone et dans l'image Docker). */
export const MIGRATIONS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), 'drizzle');

export type JournalEntry = { idx: number; when: number; tag: string };

/** Requête SQL brute, commune à node-postgres (PoolClient.query) et à PGlite (query). */
export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export function readJournal(dir = MIGRATIONS_DIR): JournalEntry[] {
  const journal = JSON.parse(readFileSync(path.join(/*turbopackIgnore: true*/ dir, 'meta', '_journal.json'), 'utf8')) as { entries: JournalEntry[] };
  return journal.entries.map(({ idx, when, tag }) => ({ idx, when, tag }));
}

// ─── Disposition de la base selon le moteur ─────────────────────────────────
//
// PGlite (démonstration, application Mac, tests) : tables dans public, journal drizzle.__drizzle_migrations, migrations
// appliquées par migrate() de Drizzle — inchangé, les bases existantes s'ouvrent toujours.
// PostgreSQL (serveur commun EPC2I, décision M-01 ; rôle vigie_app) : tables, vues et journal dans le schéma vigie,
// créé par le socle (Matrix, infra/postgres/init/02-schemas.sql). Les migrations publiées restent intactes (décision du
// 18/10/2026) : migrateServer() remplace, au moment de les appliquer, l'identifiant qualifié "public". par "vigie." ;
// le reste (noms non qualifiés, requêtes Drizzle) résout dans vigie par le search_path du pool (src/db/index.ts).

/** Schéma PostgreSQL de Vigie sur le serveur : tables, vues pub_ et journal des migrations. */
export const SERVER_SCHEMA = 'vigie';

/** Schéma des tables et journal des migrations (schéma.table) par moteur. */
export const DB_LAYOUT: Record<DbEngine, { tables: string; journal: string }> = {
  pglite: { tables: 'public', journal: 'drizzle.__drizzle_migrations' },
  postgres: { tables: SERVER_SCHEMA, journal: `${SERVER_SCHEMA}.__drizzle_migrations` },
};

/**
 * Verrou consultatif des migrations sur le serveur (clé dérivée du nom du schéma : les clés sont communes à toute la
 * base epc2i, chaque outil dérive les siennes de son schéma). Pris avant de lire ou de créer le journal.
 */
export const MIGRATION_LOCK_SQL = `select pg_advisory_lock(hashtext('${SERVER_SCHEMA}.migrations'))`;
export const MIGRATION_UNLOCK_SQL = `select pg_advisory_unlock(hashtext('${SERVER_SCHEMA}.migrations'))`;

/** Seul motif réécrit : l'identifiant qualifié "public". que drizzle-kit écrit (REFERENCES "public"."sites"…). */
export const toServerSchema = (statement: string) => statement.replaceAll('"public".', `"${SERVER_SCHEMA}".`);

/**
 * Applique à une base PostgreSQL (schéma vigie, search_path vigie) les migrations absentes du journal, dans une seule
 * transaction, avec la règle du migrator de Drizzle (dates « when » postérieures à la dernière appliquée). Même journal
 * que migrate() de Drizzle (id, hash, created_at), dans vigie.__drizzle_migrations, sans son CREATE SCHEMA : vigie_app
 * n'a pas le droit CREATE sur la base epc2i (« permission denied for database epc2i »). Le verrou de transaction
 * reprend la clé du verrou de session de src/db/index.ts (réentrant) : appelée seule (essai de migration, tests), la
 * fonction reste sûre face à une autre instance. `query` : un seul client (begin / commit). Rend le nombre de migrations
 * appliquées.
 */
export async function migrateServer(query: Query, dir = MIGRATIONS_DIR): Promise<number> {
  const journal = DB_LAYOUT.postgres.journal.split('.').map((p) => `"${p}"`).join('.');
  const migrations = readMigrationFiles({ migrationsFolder: dir });
  await query('begin');
  try {
    await query(`select pg_advisory_xact_lock(hashtext('${SERVER_SCHEMA}.migrations'))`);
    await query(`create table if not exists ${journal} (id serial primary key, hash text not null, created_at bigint)`);
    const { rows } = await query(`select created_at::text as created_at from ${journal} order by created_at desc limit 1`);
    const last = rows[0] ? Number(rows[0].created_at) : -1;
    let applied = 0;
    for (const m of migrations) {
      if (m.folderMillis <= last) continue;
      for (const statement of m.sql) if (statement.trim()) await query(toServerSchema(statement));
      await query(`insert into ${journal} (hash, created_at) values ($1, $2)`, [m.hash, m.folderMillis]);
      applied++;
    }
    await query('commit');
    return applied;
  } catch (err) {
    await query('rollback').catch(() => {});
    throw err;
  }
}

/**
 * Base PostgreSQL d'une version antérieure de Vigie : tables dans public et journal drizzle.__drizzle_migrations, sans
 * journal dans vigie. Lue dans pg_catalog (lisible par tous les rôles, même sans droit sur ces schémas).
 */
export async function hasLegacyServerLayout(query: Query): Promise<boolean> {
  const { rows } = await query(`select
      exists (select from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'drizzle' and c.relname = '__drizzle_migrations') as legacy,
      exists (select from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = '__drizzle_migrations') as current`, [SERVER_SCHEMA]);
  return !!rows[0].legacy && !rows[0].current;
}

export type MigrationState = {
  /** Migrations appliquées (journal du moteur : DB_LAYOUT). */
  applied: number;
  /** Dernière migration appliquée (tag du journal, ou null si inconnue de ce code : base plus récente). */
  last: string | null;
  lastWhen: number | null;
  /** Migrations du journal que le migrator appliquera (plus récentes que la dernière appliquée). */
  pending: JournalEntry[];
  /** La base a été migrée par une version plus récente de Vigie (migration inconnue du journal). */
  newer: boolean;
};

/** État des migrations d'une base, selon la règle du migrator de Drizzle (comparaison des dates « when »). */
export async function migrationState(query: Query, engine: DbEngine = 'pglite', dir = MIGRATIONS_DIR): Promise<MigrationState> {
  const journal = readJournal(dir);
  const table = DB_LAYOUT[engine].journal;
  const [{ t }] = (await query(`select to_regclass('${table}')::text as t`)).rows as { t: string | null }[];
  if (!t) return { applied: 0, last: null, lastWhen: null, pending: journal, newer: false };
  const [row] = (await query(`select count(*)::int as n, max(created_at)::text as last from ${table}`)).rows as { n: number; last: string | null }[];
  const lastWhen = row.last === null ? null : Number(row.last);
  const pending = journal.filter((e) => lastWhen === null || lastWhen < e.when);
  const known = journal.find((e) => e.when === lastWhen);
  return {
    applied: Number(row.n), last: known?.tag ?? null, lastWhen, pending,
    newer: lastWhen !== null && !known && lastWhen > Math.max(0, ...journal.map((e) => e.when)),
  };
}

/** Base migrée par une version plus récente de Vigie : refusée à l'ouverture (réserve PRD-06 du lot 1). */
export class NewerDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NewerDatabaseError';
  }
}

/**
 * Refuse d'ouvrir une base dont la dernière migration appliquée est inconnue de cette version et postérieure à sa
 * dernière migration (version plus récente de Vigie, puis retour à une version antérieure) : le migrator ne ferait rien,
 * et le code lirait un schéma qu'il ne connaît pas. Appelée avant la sauvegarde automatique et les migrations.
 */
export async function refuseNewerDatabase(query: Query, engine: DbEngine = 'pglite', dir = MIGRATIONS_DIR): Promise<void> {
  const state = await migrationState(query, engine, dir);
  if (!state.newer) return;
  const last = readJournal(dir).at(-1)?.tag ?? '—';
  throw new NewerDatabaseError(`Base migrée par une version plus récente de Vigie (dernière migration appliquée datée du ${new Date(state.lastWhen!).toISOString()}, `
    + `inconnue de cette version, dont la dernière migration est ${last}) : Vigie refuse de l'ouvrir pour ne pas l'altérer. `
    + 'Installer la version qui l\'a migrée (ou une plus récente), ou restaurer une sauvegarde faite par cette version (vigie-db restore …).');
}

// ─── Empreintes des migrations publiées (drizzle/checksums.json) ────────────

export type MigrationChecksum = { when: number; sql: string; snapshot: string | null };
export type ChecksumFile = { regle: string; migrations: Record<string, MigrationChecksum> };

export const CHECKSUMS_FILE = 'checksums.json';
const RULE = 'Migrations publiées : ne jamais modifier une migration listée ici (SQL, instantané, date du journal). '
  + 'Tout changement de schéma passe par une nouvelle migration (npm run db:generate), enregistrée ici par npm run db:check -- --enregistrer.';

/** Empreinte du contenu, fins de ligne normalisées (extraction Git sous Windows). */
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

/** Empreintes actuelles des migrations du journal (SQL, instantané meta/NNNN_snapshot.json, date « when »). */
export function currentChecksums(dir = MIGRATIONS_DIR): Record<string, MigrationChecksum> {
  return Object.fromEntries(readJournal(dir).map((e) => {
    const snapshot = path.join(/*turbopackIgnore: true*/ dir, 'meta', `${e.tag.split('_')[0]}_snapshot.json`);
    return [e.tag, { when: e.when, sql: sha256(path.join(/*turbopackIgnore: true*/ dir, `${e.tag}.sql`)), snapshot: existsSync(snapshot) ? sha256(snapshot) : null }];
  }));
}

export function readChecksums(dir = MIGRATIONS_DIR): ChecksumFile | null {
  const file = path.join(/*turbopackIgnore: true*/ dir, CHECKSUMS_FILE);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ChecksumFile) : null;
}

export type ChecksumReport = {
  /** Migrations publiées modifiées (SQL, instantané ou date). */
  changed: { tag: string; parts: string[] }[];
  /** Migrations publiées absentes du journal ou du dossier. */
  missing: string[];
  /** Migrations du journal pas encore enregistrées (nouvelles). */
  unrecorded: string[];
};

export function compareChecksums(recorded: ChecksumFile | null, current: Record<string, MigrationChecksum>): ChecksumReport {
  const published = recorded?.migrations ?? {};
  const changed = Object.entries(published).flatMap(([tag, r]) => {
    const c = current[tag];
    if (!c) return [];
    const parts = [r.sql !== c.sql && 'SQL', r.snapshot !== c.snapshot && 'instantané', r.when !== c.when && 'date du journal'].filter((p): p is string => !!p);
    return parts.length ? [{ tag, parts }] : [];
  });
  return {
    changed,
    missing: Object.keys(published).filter((tag) => !current[tag]),
    unrecorded: Object.keys(current).filter((tag) => !published[tag]),
  };
}

/** Ajoute les nouvelles migrations à drizzle/checksums.json (les migrations publiées n'y sont jamais réécrites). */
export function recordNewChecksums(dir = MIGRATIONS_DIR): string[] {
  const recorded = readChecksums(dir);
  const current = currentChecksums(dir);
  const added = Object.keys(current).filter((tag) => !recorded?.migrations[tag]);
  const file: ChecksumFile = { regle: RULE, migrations: { ...recorded?.migrations } };
  for (const tag of added) file.migrations[tag] = current[tag];
  writeFileSync(path.join(/*turbopackIgnore: true*/ dir, CHECKSUMS_FILE), `${JSON.stringify(file, null, 2)}\n`);
  return added;
}
