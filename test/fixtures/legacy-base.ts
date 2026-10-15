import { mkdirSync, readFileSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Query } from '@/db/migrations';
import { MIGRATIONS_DIR } from '@/db/migrations';
import * as schema from '@/db/schema';
import type { Db } from '@/db/types';
import { resetConfig } from '@/lib/env';

// Bases « anciennes » pour les tests de migration (ACT-19, migration 0005) : une base migrée jusqu'à la migration n
// (copie de drizzle/ au journal tronqué), remplie par un instantané de données (test/fixtures/demo-0004.json : base de
// démonstration de 22778e2, migrations 0000–0004, VIGIE_TODAY=2026-10-09), puis migrée jusqu'au bout.
//
// Moteur : PGlite dans un dossier temporaire ; PostgreSQL sur DATABASE_URL quand elle est posée (TEST_DATABASE_URL :
// une base vide par fichier, test/setup-postgres.ts — à appeler dans un beforeAll ou un test, jamais au chargement du
// fichier). Le chargement de l'instantané désactive les déclencheurs des clés étrangères (session_replication_role =
// replica, transaction unique) : les cycles people ↔ sites, actions ↔ contrôles… empêchent un ordre d'insertion ; sur
// PostgreSQL, cela demande un rôle superutilisateur (vérifié avant).
//
// Figé après la phase 1 du paquet 1 (comme test/helpers.ts) : un flux qui a besoin d'un autre outil l'écrit dans ses
// propres fichiers de test.

/** Instantané de données : lignes de chaque table du schéma public, telles que json_agg les donne. */
export type Fixture = { capturedFrom: string; tables: Record<string, Record<string, unknown>[]> };

const FIXTURE_FILE = path.join(process.cwd(), 'test', 'fixtures', 'demo-0004.json');
/** Nombre de migrations de l'instantané demo-0004.json (0000 à 0004). */
export const DEMO_0004_MIGRATIONS = 5;

let cached: Fixture | null = null;
/** Instantané de la base de démonstration 0004 (lu une fois ; jamais `import … from '*.json'`, que tsc typerait en entier). */
export function readDemo0004(): Fixture {
  cached ??= JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as Fixture;
  return cached;
}

export type LegacyBase = {
  engine: 'pglite' | 'postgres';
  /** Requête brute (un seul client : begin / commit possibles). */
  query: Query;
  /** Drizzle avec le schéma actuel (src/db/schema.ts) : à utiliser après migrateAll() seulement. */
  db: Db;
  /** Applique les n premières migrations du journal (copie de drizzle/ au journal tronqué). */
  migrateUpTo(n: number): Promise<void>;
  /** Applique toutes les migrations de drizzle/ (celles qui restent). */
  migrateAll(): Promise<void>;
  /** Charge un instantané de données dans une seule transaction (base migrée au même niveau, tables vides). */
  loadFixture(fixture?: Fixture): Promise<void>;
  close(): Promise<void>;
};

/** Dossier de migrations limité aux n premières entrées du journal (même procédé que migration-retry.test.ts). */
async function truncatedMigrations(n: number): Promise<{ dir: string; drop: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'vigie-legacy-migrations-'));
  const dir = path.join(root, 'drizzle');
  await cp(MIGRATIONS_DIR, dir, { recursive: true });
  const journalFile = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalFile, 'utf8')) as { entries: unknown[] };
  if (n > journal.entries.length) throw new Error(`migrateUpTo(${n}) : le journal n'a que ${journal.entries.length} migrations.`);
  journal.entries = journal.entries.slice(0, n);
  await writeFile(journalFile, JSON.stringify(journal));
  return { dir, drop: () => rm(root, { recursive: true, force: true }) };
}

/**
 * Ouvre une base vide : PostgreSQL sur DATABASE_URL quand elle est posée, sinon PGlite dans `dataDir` (dossier
 * temporaire créé et supprimé par close() quand il n'est pas fourni). `reset` (PostgreSQL) : vide d'abord la base du
 * fichier (schémas public et drizzle recréés) — pour enchaîner plusieurs bases anciennes dans un même fichier de test.
 */
export async function openLegacyBase(opts: { dataDir?: string; reset?: boolean } = {}): Promise<LegacyBase> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Client } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const client = new Client({ connectionString: url, application_name: 'vigie-tests' });
    await client.connect();
    const query: Query = (q, p) => client.query(q, p as unknown[]);
    if (opts.reset) {
      for (const sql of ['drop schema if exists drizzle cascade', 'drop schema if exists public cascade', 'create schema public']) await query(sql);
    }
    return base('postgres', query, drizzle(client, { schema }) as unknown as Db, (folder) => migrate(drizzle(client), { migrationsFolder: folder }).then(() => undefined), () => client.end());
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const own = !opts.dataDir;
  const dir = opts.dataDir ?? (await mkdtemp(path.join(tmpdir(), 'vigie-legacy-pglite-')));
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const query: Query = (q, p) => client.query(q, p as unknown[]) as Promise<{ rows: Record<string, unknown>[] }>;
  return base('pglite', query, drizzle(client, { schema }) as unknown as Db, (folder) => migrate(drizzle(client), { migrationsFolder: folder }), async () => {
    await client.close();
    if (own) await rm(dir, { recursive: true, force: true });
  });
}

function base(
  engine: LegacyBase['engine'], query: Query, db: Db, migrateFolder: (folder: string) => Promise<void>, close: () => Promise<void>,
): LegacyBase {
  return {
    engine, query, db, close,
    async migrateUpTo(n) {
      const m = await truncatedMigrations(n);
      try {
        await migrateFolder(m.dir);
      } finally {
        await m.drop();
      }
    },
    migrateAll: () => migrateFolder(MIGRATIONS_DIR),
    loadFixture: (fixture = readDemo0004()) => loadFixture(engine, query, fixture),
  };
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function loadFixture(engine: LegacyBase['engine'], query: Query, fixture: Fixture) {
  if (engine === 'postgres') {
    const [{ rolsuper }] = (await query('select rolsuper from pg_roles where rolname = current_user')).rows as { rolsuper: boolean }[];
    if (!rolsuper) throw new Error('TEST_DATABASE_URL : un rôle superutilisateur est requis pour charger la base 0004 (session_replication_role).');
  }
  const tables = new Set(
    ((await query("select tablename from pg_tables where schemaname = 'public'")).rows as { tablename: string }[]).map((r) => r.tablename),
  );
  for (const name of Object.keys(fixture.tables)) {
    if (!tables.has(name)) throw new Error(`Instantané : table ${name} absente de la base (niveau de migration différent ?).`);
  }
  await query('begin');
  try {
    await query('set local session_replication_role = replica');
    for (const [name, rows] of Object.entries(fixture.tables)) {
      if (!rows.length) continue;
      await query(`insert into ${ident(name)} select * from json_populate_recordset(null::${ident(name)}, $1::json)`, [JSON.stringify(rows)]);
    }
    // Séquences des colonnes serial : reprises après le plus grand identifiant chargé (table vide : prochain = 1).
    const serials = (await query(`select table_name, column_name from information_schema.columns
      where table_schema = 'public' and column_default like 'nextval(%' order by 1, 2`)).rows as { table_name: string; column_name: string }[];
    for (const { table_name: table, column_name: column } of serials) {
      await query(`select setval(pg_get_serial_sequence($1, $2), coalesce(max(${ident(column)}), 1), max(${ident(column)}) is not null) from ${ident(table)}`, [
        ident(table), column,
      ]);
    }
    await query('commit');
  } catch (err) {
    await query('rollback');
    throw err;
  }
}

/** Variables d'environnement posées par prepareDemo0004, rétablies par son `cleanup`. */
const PREPARED_ENV = ['VIGIE_DATA_DIR', 'VIGIE_BACKUP_DIR', 'VIGIE_UPLOAD_DIR'] as const;

/**
 * Prépare une base de démonstration 0004 (instantané demo-0004.json) là où le prochain getDb() l'ouvrira : PGlite dans
 * un VIGIE_DATA_DIR temporaire posé ici (DATABASE_URL absente), ou la base PostgreSQL du fichier (DATABASE_URL), vidée
 * d'abord (schémas public et drizzle recréés : le fichier a pu ouvrir sa base avant). Ferme la base ouverte (closeDb).
 * Pose aussi un VIGIE_BACKUP_DIR temporaire (sauvegarde automatique avant migration) et, s'il n'est pas déjà posé, un
 * VIGIE_UPLOAD_DIR temporaire : rien n'est écrit dans .data/. L'appelant pose VIGIE_DEMO / VIGIE_TODAY puis appelle
 * getDb() : migration 0005, puis mise à niveau de démonstration (upgradeDemo). `cleanup` (après closeDb()) supprime les
 * dossiers temporaires et rétablit les trois variables telles qu'avant l'appel.
 */
export async function prepareDemo0004(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const saved = Object.fromEntries(PREPARED_ENV.map((k) => [k, process.env[k]]));
  const root = await mkdtemp(path.join(tmpdir(), 'vigie-demo0004-'));
  const dataDir = path.join(root, 'db');
  if (!process.env.DATABASE_URL) process.env.VIGIE_DATA_DIR = dataDir;
  process.env.VIGIE_BACKUP_DIR = path.join(root, 'backups');
  process.env.VIGIE_UPLOAD_DIR ??= path.join(root, 'uploads');
  resetConfig();
  const { closeDb } = await import('@/db');
  await closeDb();
  const legacy = await openLegacyBase({ dataDir, reset: !!process.env.DATABASE_URL });
  try {
    await legacy.migrateUpTo(DEMO_0004_MIGRATIONS);
    await legacy.loadFixture();
  } finally {
    await legacy.close();
  }
  return {
    root,
    cleanup: async () => {
      for (const k of PREPARED_ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      resetConfig();
      await rm(root, { recursive: true, force: true });
    },
  };
}
