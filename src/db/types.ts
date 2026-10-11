import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

// Type commun aux deux moteurs (PostgreSQL via node-postgres en production, PGlite en démonstration et en test) :
// tout le code, jeux de données compris, n'utilise que l'API Drizzle commune (pas de `execute(...).rows`).

/** Base Drizzle, quel que soit le moteur. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
/** Transaction Drizzle (db.transaction(async (tx) => …)). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Base ou transaction : pour les helpers appelables dans les deux cas (logChange, rattachements d'actions). */
export type DbOrTx = Db | Tx;
/** Moteur de la base ouverte. */
export type DbEngine = 'postgres' | 'pglite';
