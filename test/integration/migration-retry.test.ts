import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/db';
import { MIGRATIONS_DIR } from '@/db/migrations';
import { resetConfig } from '@/lib/env';

// Migration en échec (PRD-02) : l'ouverture de la base est retentée à chaque requête (src/db/index.ts), mais la base,
// restée dans le même état, n'est sauvegardée qu'une fois avant migration (src/db/backup.ts). Base PGlite sur disque,
// même en mode PostgreSQL (DATABASE_URL retirée).

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vigie-migration-retry-'));
  // Base créée par une version antérieure (0000 à 0002), avec une table qui fait échouer 0003_production.
  const old = path.join(dir, 'drizzle-0002');
  await cp(MIGRATIONS_DIR, old, { recursive: true });
  const journal = JSON.parse(await readFile(path.join(old, 'meta', '_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, 3);
  await writeFile(path.join(old, 'meta', '_journal.json'), JSON.stringify(journal));
  const client = new PGlite(path.join(dir, 'pglite'));
  await migrate(drizzle(client), { migrationsFolder: old });
  await client.query('create table report_rate_limits (x int)');
  await client.close();
  delete process.env.DATABASE_URL;
  Object.assign(process.env, {
    VIGIE_DEMO: '1', VIGIE_DATA_DIR: path.join(dir, 'pglite'), VIGIE_BACKUP_DIR: path.join(dir, 'backups'), VIGIE_UPLOAD_DIR: path.join(dir, 'uploads'),
  });
  resetConfig();
  await closeDb();
});
afterAll(async () => {
  await closeDb();
  await rm(dir, { recursive: true, force: true });
});

describe('migration en échec', () => {
  it('ouverture retentée à chaque appel, une seule sauvegarde avant migration', async () => {
    for (let i = 0; i < 3; i++) await expect(getDb()).rejects.toThrow(/report_rate_limits/);
    const backups = (await readdir(path.join(dir, 'backups'))).filter((n) => /-avant-migration(-\d+)?\.tar$/.test(n));
    expect(backups).toHaveLength(1);
  });
});
