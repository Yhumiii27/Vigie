import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tarStream } from '@/db/archive';
import { extractBackup } from '@/db/backup';
import { SERVER_SCHEMA, migrateServer } from '@/db/migrations';
import { parseStorageConfig } from '@/lib/env';

// `vigie-db restore --remplacer` sur PostgreSQL (PRD-02) : la base actuelle n'est remplacée qu'en une transaction ;
// une copie que pg_restore ne sait pas lire (ex. faite par un pg_dump plus récent) laisse la base intacte ; les
// compteurs du signalement sans compte (report_rate_limits) ne sont pas sauvegardés.
// Seulement en mode PostgreSQL (TEST_DATABASE_URL, base du fichier : test/setup-postgres.ts) avec le client PostgreSQL.

const ROOT = path.resolve(__dirname, '../..');
const TSX = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');
const hasClient = ['pg_dump', 'pg_restore', 'psql'].every((cmd) => spawnSync(cmd, ['--version']).status === 0);

let dir: string;
let env: NodeJS.ProcessEnv;

function vigieDb(...args: string[]) {
  const r = spawnSync(process.execPath, [TSX, '--conditions=react-server', 'scripts/vigie-db.ts', ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

async function sql<T = Record<string, unknown>>(q: string): Promise<T[]> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: env.DATABASE_URL, application_name: 'vigie-tests', options: `-c search_path=${SERVER_SCHEMA}` });
  await client.connect();
  try {
    return (await client.query(q)).rows as T[];
  } finally {
    await client.end();
  }
}
const siteIds = async () => (await sql<{ id: string }>('select id from sites order by sort')).map((r) => r.id);

describe.skipIf(!process.env.TEST_DATABASE_URL || !hasClient)('vigie-db restore (PostgreSQL)', () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'vigie-db-pg-'));
    env = { ...process.env, VIGIE_BACKUP_DIR: path.join(dir, 'backups'), VIGIE_UPLOAD_DIR: path.join(dir, 'uploads') };
    const { Client } = await import('pg');
    const client = new Client({ connectionString: env.DATABASE_URL, application_name: 'vigie-tests', options: `-c search_path=${SERVER_SCHEMA}` });
    await client.connect();
    await migrateServer((q, p) => client.query(q, p));
    await client.query("insert into sites (id, label, sort) values ('ville-a', 'Site A', 1), ('ville-b', 'Site B', 2)");
    // Compteurs du signalement sans compte (empreintes d'adresses IP) : jamais copiés dans une sauvegarde PostgreSQL.
    await client.query("insert into report_rate_limits (key, window_start, hits) values ('ip:empreinte', now(), 3)");
    await client.end();
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('copie illisible par pg_restore : refusée, base actuelle inchangée ; copie valide : base remplacée', async () => {
    expect(vigieDb('backup', '--clair').code).toBe(0);
    const [good] = (await readdir(path.join(dir, 'backups'))).filter((n) => n.endsWith('-manuelle.tar'));

    // Même sauvegarde, copie de la base marquée d'une version de format inconnue (pg_dump plus récent).
    const storage = parseStorageConfig({ DATABASE_URL: env.DATABASE_URL, VIGIE_BACKUP_DIR: env.VIGIE_BACKUP_DIR, VIGIE_UPLOAD_DIR: env.VIGIE_UPLOAD_DIR });
    const extracted = await extractBackup(path.join(dir, 'backups', good), storage, await mkdtemp(path.join(dir, 'x-')));
    const dump = await readFile(extracted.dbFile);
    dump[6] = 99;
    const manifest = Buffer.from(JSON.stringify({ ...extracted.manifest, database: { ...extracted.manifest.database, size: dump.length, sha256: createHash('sha256').update(dump).digest('hex') } }));
    const bad = path.join(dir, 'illisible.tar');
    await pipeline(Readable.from(tarStream([
      { name: 'manifest.json', size: manifest.length, body: () => manifest },
      { name: extracted.manifest.database.file, size: dump.length, body: () => dump },
    ])), createWriteStream(bad));

    await sql("delete from sites where id = 'ville-b'");
    const tables = (await sql<{ n: number }>(`select count(*)::int as n from pg_tables where schemaname = '${SERVER_SCHEMA}'`))[0].n;
    const refused = vigieDb('restore', bad, '--remplacer');
    expect(refused.code).toBe(1);
    expect(refused.out).toMatch(/unsupported version|version/);
    expect(refused.out).toMatch(/base actuelle est inchangée/);
    expect((await sql<{ n: number }>(`select count(*)::int as n from pg_tables where schemaname = '${SERVER_SCHEMA}'`))[0].n).toBe(tables);
    expect(await siteIds()).toEqual(['ville-a']);

    const restored = vigieDb('restore', path.join(dir, 'backups', good), '--remplacer');
    expect(restored.out).toMatch(/Base restaurée/);
    expect(restored.code).toBe(0);
    expect(await siteIds()).toEqual(['ville-a', 'ville-b']);
    expect(await sql('select key from report_rate_limits')).toEqual([]);
    // Schéma vigie seulement (serveur commun EPC2I) : vues pub_ restaurées, rien dans public ni drizzle.
    expect((await sql<{ v: string }>(`select table_name as v from information_schema.views where table_schema = '${SERVER_SCHEMA}' order by 1`)).map((r) => r.v))
      .toEqual(['pub_hse_projet', 'pub_journal', 'pub_non_conformites']);
    expect(await sql("select tablename from pg_tables where schemaname in ('public', 'drizzle')")).toEqual([]);
  });
});
