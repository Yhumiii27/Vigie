import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/db';
import { MIGRATIONS_DIR, NewerDatabaseError, readJournal, refuseNewerDatabase, type Query } from '@/db/migrations';
import { resetConfig } from '@/lib/env';

// Base migrée par une version plus récente de Vigie (réserve PRD-06 du lot 1) : refusée à l'ouverture, à chaque essai,
// sans sauvegarde, migration ni jeu de démonstration. Base PGlite sur disque (même en mode PostgreSQL, DATABASE_URL
// retirée) ; en mode PostgreSQL (TEST_DATABASE_URL), le même refus sur la base PostgreSQL du fichier.

let dir: string;
let pgUrl: string | undefined;
const latest = readJournal().at(-1)!;
const FUTURE = latest.when + 86_400_000;
const query = (c: PGlite): Query => (q, p) => c.query(q, p) as Promise<{ rows: Record<string, unknown>[] }>;

async function inspect(c: PGlite) {
  const tables = (await c.query<{ name: string }>("select schemaname || '.' || tablename as name from pg_tables where schemaname in ('public', 'drizzle') order by 1")).rows.map((r) => r.name);
  const [{ migrations }] = (await c.query<{ migrations: number }>('select count(*)::int as migrations from drizzle.__drizzle_migrations')).rows;
  const [{ people }] = (await c.query<{ people: number }>('select count(*)::int as people from people')).rows;
  return { tables, migrations, people };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vigie-newer-db-'));
  const client = new PGlite(path.join(dir, 'pglite'));
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
  await client.query('insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)', ['futur', FUTURE]);
  await client.close();
  pgUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  Object.assign(process.env, {
    VIGIE_DEMO: '1', VIGIE_DATA_DIR: path.join(dir, 'pglite'), VIGIE_BACKUP_DIR: path.join(dir, 'backups'), VIGIE_UPLOAD_DIR: path.join(dir, 'uploads'),
  });
  resetConfig();
  await closeDb();
});
afterAll(async () => {
  await closeDb();
  if (pgUrl) process.env.DATABASE_URL = pgUrl;
  for (const k of ['VIGIE_DATA_DIR', 'VIGIE_BACKUP_DIR', 'VIGIE_UPLOAD_DIR']) delete process.env[k];
  resetConfig();
  await rm(dir, { recursive: true, force: true });
});

describe('base migrée par une version plus récente', () => {
  it('PGlite : ouverture refusée à chaque essai ; ni sauvegarde, ni migration, ni jeu de démonstration', async () => {
    const before = await (async () => {
      const c = new PGlite(path.join(dir, 'pglite'));
      try {
        return await inspect(c);
      } finally {
        await c.close();
      }
    })();
    for (let i = 0; i < 2; i++) {
      const err = await getDb().then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(NewerDatabaseError);
      expect((err as Error).message).toMatch(/Base migrée par une version plus récente de Vigie/);
      expect((err as Error).message).toContain(new Date(FUTURE).toISOString());
      expect((err as Error).message).toContain(latest.tag);
      expect((err as Error).message).toMatch(/vigie-db restore/);
    }
    expect(await readdir(path.join(dir, 'backups')).catch(() => [])).toEqual([]);
    const c = new PGlite(path.join(dir, 'pglite'));
    try {
      expect(await inspect(c)).toEqual(before);
      expect(before.people).toBe(0);
    } finally {
      await c.close();
    }
  });

  it('base à jour, base vide, base en retard : acceptées', async () => {
    const empty = new PGlite('memory://');
    await expect(refuseNewerDatabase(query(empty))).resolves.toBeUndefined();
    await migrate(drizzle(empty), { migrationsFolder: MIGRATIONS_DIR });
    await expect(refuseNewerDatabase(query(empty))).resolves.toBeUndefined();
    // Dernière migration du journal retirée de la base : migration en attente, pas une base plus récente.
    await empty.query('delete from drizzle.__drizzle_migrations where created_at = $1', [latest.when]);
    await expect(refuseNewerDatabase(query(empty))).resolves.toBeUndefined();
    await empty.close();
  });

  it.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL : ouverture refusée, aucune migration ni sauvegarde', async () => {
    const { Client } = await import('pg');
    const { drizzle: pgDrizzle } = await import('drizzle-orm/node-postgres');
    const { migrate: pgMigrate } = await import('drizzle-orm/node-postgres/migrator');
    const client = new Client({ connectionString: pgUrl, application_name: 'vigie-tests' });
    await client.connect();
    try {
      await pgMigrate(pgDrizzle(client), { migrationsFolder: MIGRATIONS_DIR });
      await client.query('insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)', ['futur', FUTURE]);
      process.env.DATABASE_URL = pgUrl;
      process.env.VIGIE_BACKUP_DIR = path.join(dir, 'backups-pg');
      resetConfig();
      await closeDb();
      await expect(getDb()).rejects.toThrow(/plus récente/);
      await expect(getDb()).rejects.toThrow(/plus récente/);
      expect(await readdir(path.join(dir, 'backups-pg')).catch(() => [])).toEqual([]);
      expect((await client.query('select count(*)::int as n from people')).rows[0].n).toBe(0);
      // Verrou consultatif des migrations relâché malgré le refus.
      expect((await client.query("select count(*)::int as n from pg_locks where locktype = 'advisory' and granted and database = (select oid from pg_database where datname = current_database())")).rows[0].n).toBe(0);
    } finally {
      delete process.env.DATABASE_URL;
      resetConfig();
      await client.end();
    }
  });
});
