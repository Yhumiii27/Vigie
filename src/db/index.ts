import 'server-only';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';
import { seed } from './seed';

export type Db = PgliteDatabase<typeof schema>;

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
