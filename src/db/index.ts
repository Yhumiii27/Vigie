import 'server-only';
import { mkdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { config } from '@/lib/config';
import { nextRuntime, type StorageConfig } from '@/lib/env';
import { declareDatabaseSchema, type RowQuery } from '@/lib/matrix';
import { startMaintenance } from './maintenance';
import { scheduledTasks, startScheduler } from './scheduler';
import { MIGRATION_LOCK_SQL, MIGRATION_UNLOCK_SQL, MIGRATIONS_DIR, SERVER_SCHEMA, hasLegacyServerLayout, migrateServer, refuseNewerDatabase, type Query } from './migrations';
import * as schema from './schema';
import { withTransactionFiles } from './pending-files';
import type { Db, DbEngine, Tx } from './types';
import { log } from '@/lib/log';

export type { Db, DbEngine, DbOrTx } from './types';

// Moteur choisi par la configuration (PRD-05) : DATABASE_URL → PostgreSQL (node-postgres, pool de connexions) ;
// sinon PGlite dans VIGIE_DATA_DIR (démonstration, application Mac, tests ; « memory:// » pour une base en mémoire).
// Les migrations de drizzle/ sont appliquées à l'ouverture par le migrator du moteur ; le jeu de démonstration
// n'est chargé qu'en démonstration (VIGIE_DEMO=1), dans une base vide (PRD-04).

// Avant toute migration en attente sur une base existante : sauvegarde automatique (src/db/backup.ts, PRD-02).
// Base migrée par une version plus récente de Vigie : refusée (NewerDatabaseError), rien n'est migré, sauvegardé ni
// chargé ; comme pour un échec de migration, la base reste indisponible (pages en erreur, /api/sante 503) et l'ouverture
// est retentée à la requête suivante.

export { MIGRATIONS_DIR };

/** Messages de la déclaration à Matrix, dans le journal du serveur (PRD-10). */
const MATRIX_LOG = { info: (m: string) => log.info('matrix.declare', m), warn: (m: string) => log.warn('matrix.declare', m) };

type Opened = { db: Db; engine: DbEngine; close: () => Promise<void>; query: RowQuery };

// Une seule ouverture par processus (survit au rechargement à chaud).
const g = globalThis as unknown as { __vigieDb?: Promise<Opened> };

/** Verrou d'écriture de Vigie sur le serveur (clé dérivée du schéma, comme celle des migrations). */
const WRITE_LOCK = sql`select pg_advisory_xact_lock(hashtext(${`${SERVER_SCHEMA}.ecritures`}))`;

/**
 * Serveur PostgreSQL (commun EPC2I, rôle vigie_app ; ou base dédiée) : tables et journal dans le schéma vigie.
 *
 * Ordre à l'ouverture, sous le verrou de session des migrations (clé hashtext('vigie.migrations'), pris avant toute
 * lecture du journal : deux instances qui démarrent ensemble appliquent chaque migration une seule fois) : base d'une
 * version antérieure (tables dans public) refusée, schéma vigie présent, base plus récente refusée, sauvegarde avant
 * migration, migrations (migrateServer : "public". réécrit en "vigie."). Aucun CREATE SCHEMA sur le serveur commun : le
 * schéma y est créé par le socle ; il n'est créé ici que sur une base dédiée où le rôle a le droit CREATE (docker-compose.yml).
 *
 * Écritures (§ 4.5 du plan de Matrix) : chaque db.transaction() prend d'abord le verrou d'écriture de Vigie, et les
 * transactions d'écriture passent l'une après l'autre, comme dans PGlite ; les lectures hors transaction restent
 * parallèles. Les numéros et références (nextActionNumber, nextEntityReference) sont déjà calculés dans la transaction
 * de l'écriture, sur un compteur ; le verrou couvre en plus les contrôles « lire puis écrire » (unicité vérifiée avant
 * l'insertion, remplissage de démonstration, mises à niveau) que PGlite sérialisait de fait.
 */
async function openPostgres(url: string, storage: StorageConfig): Promise<Opened> {
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  // application_name : db:restore repère les connexions d'un serveur Vigie encore ouvert sur la base.
  // search_path : noms non qualifiés et requêtes Drizzle (pgTable, sans schéma) résolus dans vigie (aussi posé sur le
  // rôle vigie_app par le socle).
  const pool = new Pool({ connectionString: url, max: 10, application_name: 'vigie', options: `-c search_path=${SERVER_SCHEMA}` });
  // Connexion inactive coupée par le serveur : le pool la remplace, sans arrêter le processus.
  pool.on('error', (err) => log.error('db.pool', 'PostgreSQL : connexion du pool en erreur', { error: err }));
  const client = await pool.connect();
  const query: Query = (q, p) => client.query(q, p);
  try {
    await client.query(MIGRATION_LOCK_SQL);
    try {
      if (await hasLegacyServerLayout(query)) {
        throw new Error(`Base PostgreSQL d'une version antérieure de Vigie (tables dans le schéma public, journal drizzle.__drizzle_migrations) : `
          + `Vigie utilise désormais le schéma ${SERVER_SCHEMA} et ne reprend pas ces données (décision du 18/10/2026). `
          + `Donner à DATABASE_URL une base où le schéma ${SERVER_SCHEMA} est vide (serveur commun EPC2I : rôle vigie_app), `
          + 'ou garder la version précédente de Vigie pour cette base.');
      }
      await ensureServerSchema(query);
      // Base migrée par une version plus récente : refusée avant toute sauvegarde ou migration (PRD-06).
      await refuseNewerDatabase(query, 'postgres');
      const { backupBeforeMigrate } = await import('./backup');
      await backupBeforeMigrate(storage, { engine: 'postgres', url, query });
      await migrateServer(query);
    } finally {
      await client.query(MIGRATION_UNLOCK_SQL);
    }
  } catch (err) {
    client.release();
    await pool.end();
    throw err;
  }
  client.release();
  const db: Db = drizzle(pool, { schema });
  wrapTransactions(db, (tx) => tx.execute(WRITE_LOCK));
  return { db, engine: 'postgres', close: () => pool.end(), query: (q) => pool.query(q).then((r) => r.rows) };
}

/**
 * Chaque db.transaction() : verrou d'écriture du serveur (`before`), et fichiers de pièces jointes écrits pendant la
 * transaction effacés si elle est annulée (PRD-13, src/db/pending-files.ts).
 */
function wrapTransactions(db: Db, before?: (tx: Tx) => Promise<unknown>) {
  const transaction = db.transaction.bind(db);
  db.transaction = ((fn, config) => withTransactionFiles(() => transaction(async (tx) => {
    if (before) await before(tx);
    return fn(tx);
  }, config))) as Db['transaction'];
}

/**
 * Schéma vigie présent (serveur commun : créé par le socle). Absent : créé seulement si le rôle a le droit CREATE sur
 * la base (base dédiée, docker-compose.yml) ; sinon erreur qui nomme le remède, sans rien tenter.
 */
async function ensureServerSchema(query: Query) {
  const [{ present, creatable }] = (await query(`select exists (select from pg_namespace where nspname = $1) as present,
    has_database_privilege(current_database(), 'CREATE') as creatable`, [SERVER_SCHEMA])).rows as { present: boolean; creatable: boolean }[];
  if (present) return;
  if (!creatable) {
    throw new Error(`Schéma ${SERVER_SCHEMA} absent de la base, et le rôle de DATABASE_URL ne peut pas le créer : `
      + 'serveur commun EPC2I, jouer le socle (Matrix, infra/postgres/init/01 à 03) ; base dédiée, donner le droit CREATE au rôle.');
  }
  await query(`create schema ${SERVER_SCHEMA}`);
}

async function openPglite(dir: string, storage: StorageConfig): Promise<Opened> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (!dir.startsWith('memory://')) mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  wrapTransactions(db as unknown as Db);
  try {
    await refuseNewerDatabase((q, p) => client.query(q, p));
    const { backupBeforeMigrate } = await import('./backup');
    await backupBeforeMigrate(storage, { engine: 'pglite', query: (q, p) => client.query(q, p), dump: () => client.dumpDataDir('gzip') });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } catch (err) {
    await client.close();
    throw err;
  }
  return { db, engine: 'pglite', close: () => client.close(), query: (q) => client.query<Record<string, unknown>>(q).then((r) => r.rows) };
}

async function open(): Promise<Opened> {
  const c = config();
  // `next build` pré-rend des pages qui lisent la base : jamais le serveur PostgreSQL pendant la construction (DATABASE_URL
  // n'est pas censée y être disponible ; si elle l'est, la construction reste sur PGlite).
  const building = nextRuntime().phase === 'phase-production-build';
  const url = building ? null : c.databaseUrl;
  const opened = url ? await openPostgres(url, c) : await openPglite(c.dataDir, c);
  // Schéma migré déclaré à Matrix (src/lib/matrix.ts) : appel non attendu, jamais bloquant (échec : avertissement) ;
  // rien sans MATRIX_URL ni MATRIX_DECLARATIONS_DIR, ni pendant la construction (next build). current_schema() : vigie
  // sur le serveur (search_path du pool), public en PGlite.
  if (!building) void declareDatabaseSchema('vigie', opened.query, c.matrix, MATRIX_LOG);
  if (c.demo) {
    const { seed } = await import('./seed');
    await seed(opened.db, { files: true });
  }
  // Maintenance périodique (purge des compteurs du signalement sans compte, src/db/maintenance.ts), arrêtée à la fermeture.
  // Pièces jointes orphelines (PRD-13) : serveur avec tâches planifiées et base persistante seulement (jamais les tests).
  const sweepUploads = c.scheduler && !building && !(opened.engine === 'pglite' && c.dataDir.startsWith('memory://'));
  const stop = startMaintenance(opened.db, { uploadDir: sweepUploads ? c.uploadDir : null });
  // Tâches planifiées (PRD-12, src/db/scheduler.ts) : registre de la configuration (rappel du mercredi par e-mail quand un
  // transport existe) ; aucune avec VIGIE_SCHEDULER=0, un registre vide, ni pendant la construction (next build).
  // Démarrage à l'ouverture de la base, donc à la première requête ou sonde de santé : pas de rattrapage (D13).
  const tasks = c.scheduler && !building ? scheduledTasks(c) : [];
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
