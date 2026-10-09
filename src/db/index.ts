import 'server-only';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';
import { seed } from './seed';

export type Db = PgliteDatabase<typeof schema>;
/** Transaction Drizzle (db.transaction(async (tx) => …)). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Base ou transaction : pour les helpers appelables dans les deux cas (logChange, rattachements d'actions). */
export type DbOrTx = Db | Tx;

// Une seule instance PGlite par processus (survit au rechargement à chaud).
const g = globalThis as unknown as { __vigieDb?: Promise<Db> };

async function open(): Promise<Db> {
  const dir = process.env.VIGIE_DATA_DIR ?? path.join(process.cwd(), '.data', 'vigie');
  mkdirSync(dir, { recursive: true });
  const db = drizzle(new PGlite(dir), { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  await seed(db);
  return db;
}

export function getDb(): Promise<Db> {
  g.__vigieDb ??= open().catch((err) => {
    g.__vigieDb = undefined;
    throw err;
  });
  return g.__vigieDb;
}

export { schema };
