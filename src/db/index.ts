import 'server-only';
import { mkdirSync } from 'node:fs';
import { config } from '@/lib/config';
import { nextRuntime, type StorageConfig } from '@/lib/env';
import { startMaintenance } from './maintenance';
import { scheduledTasks, startScheduler } from './scheduler';
import { MIGRATIONS_DIR, refuseNewerDatabase } from './migrations';
import * as schema from './schema';
import type { Db, DbEngine } from './types';

export type { Db, DbEngine, DbOrTx, Tx } from './types';

// Moteur choisi par la configuration (PRD-05) : DATABASE_URL → PostgreSQL (node-postgres, pool de connexions) ;
// sinon PGlite dans VIGIE_DATA_DIR (démonstration, application Mac, tests ; « memory:// » pour une base en mémoire).
// Les migrations de drizzle/ sont appliquées à l'ouverture par le migrator du moteur ; le jeu de démonstration
// n'est chargé qu'en démonstration (VIGIE_DEMO=1), dans une base vide (PRD-04).

// Avant toute migration en attente sur une base existante : sauvegarde automatique (src/db/backup.ts, PRD-02).
// Base migrée par une version plus récente de Vigie : refusée (NewerDatabaseError), rien n'est migré, sauvegardé ni
// chargé ; comme pour un échec de migration, la base reste indisponible (pages en erreur, /api/sante 503) et l'ouverture
// est retentée à la requête suivante.

export { MIGRATIONS_DIR };
/** Verrou consultatif PostgreSQL des migrations : un seul serveur les applique à la fois. */
const MIGRATION_LOCK = 7_302_026;

type Opened = { db: Db; engine: DbEngine; close: () => Promise<void> };

// Une seule ouverture par processus (survit au rechargement à chaud).
const g = globalThis as unknown as { __vigieDb?: Promise<Opened> };

async function openPostgres(url: string, storage: StorageConfig): Promise<Opened> {
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  // application_name : db:restore repère les connexions d'un serveur Vigie encore ouvert sur la base.
  const pool = new Pool({ connectionString: url, max: 10, application_name: 'vigie' });
  // Connexion inactive coupée par le serveur : le pool la remplace, sans arrêter le processus.
  pool.on('error', (err) => console.error('[vigie] PostgreSQL :', err.message));
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1::bigint)', [MIGRATION_LOCK]);
    try {
      // Base migrée par une version plus récente : refusée avant toute sauvegarde ou migration (PRD-06).
      await refuseNewerDatabase((q, p) => client.query(q, p));
      const { backupBeforeMigrate } = await import('./backup');
      await backupBeforeMigrate(storage, { engine: 'postgres', url, query: (q, p) => client.query(q, p) });
      await migrate(drizzle(client, { schema }), { migrationsFolder: MIGRATIONS_DIR });
    } finally {
      await client.query('select pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK]);
    }
  } catch (err) {
    client.release();
    await pool.end();
    throw err;
  }
  client.release();
  return { db: drizzle(pool, { schema }), engine: 'postgres', close: () => pool.end() };
}

async function openPglite(dir: string, storage: StorageConfig): Promise<Opened> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (!dir.startsWith('memory://')) mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  try {
    await refuseNewerDatabase((q, p) => client.query(q, p));
    const { backupBeforeMigrate } = await import('./backup');
    await backupBeforeMigrate(storage, { engine: 'pglite', query: (q, p) => client.query(q, p), dump: () => client.dumpDataDir('gzip') });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } catch (err) {
    await client.close();
    throw err;
  }
  return { db, engine: 'pglite', close: () => client.close() };
}

async function open(): Promise<Opened> {
  const c = config();
  const opened = c.databaseUrl ? await openPostgres(c.databaseUrl, c) : await openPglite(c.dataDir, c);
  if (c.demo) {
    const { seed } = await import('./seed');
    await seed(opened.db, { files: true });
  }
  // Maintenance périodique (purge des compteurs du signalement sans compte, src/db/maintenance.ts), arrêtée à la fermeture.
  const stop = startMaintenance(opened.db);
  // Tâches planifiées (PRD-12, src/db/scheduler.ts) : registre de la configuration (rappel du mercredi par e-mail quand un
  // transport existe) ; aucune avec VIGIE_SCHEDULER=0, un registre vide, ni pendant la construction (next build).
  // Démarrage à l'ouverture de la base, donc à la première requête ou sonde de santé : pas de rattrapage (D13).
  const tasks = c.scheduler && nextRuntime().phase !== 'phase-production-build' ? scheduledTasks(c) : [];
  const stopTasks = tasks.length ? startScheduler(opened.db, tasks) : async () => {};
  return { ...opened, close: async () => { await stopTasks(); await stop(); await opened.close(); } };
}

/**
 * Base ouverte à la première requête (route de santé comprise). Échec (base injoignable, migration en erreur) : la base
 * reste indisponible et l'ouverture est retentée à l'appel suivant (sauvegarde avant migration faite une seule fois).
 */
function opened(): Promise<Opened> {
  g.__vigieDb ??= open().catch((err) => {
    g.__vigieDb = undefined;
    throw err;
  });
  return g.__vigieDb;
}

export async function getDb(): Promise<Db> {
  return (await opened()).db;
}

/** Moteur de la base ouverte (route de santé, sauvegarde). */
export async function getDbEngine(): Promise<DbEngine> {
  return (await opened()).engine;
}

/** Ferme la base (scripts, tests) ; le prochain getDb() la rouvre. */
export async function closeDb(): Promise<void> {
  const current = g.__vigieDb;
  g.__vigieDb = undefined;
  if (current) await (await current.catch(() => null))?.close();
}

export { schema };
