import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '@/db/migrations';

// Outil d'exploitation `vigie-db` (scripts/vigie-db.ts, npm run db:backup / db:list / db:restore — PRD-02), exécuté
// comme en production (processus séparé, variables d'environnement) sur une base PGlite et des pièces jointes chiffrées.

const ROOT = path.resolve(__dirname, '../..');
const TSX = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');
const UPLOAD = '33333333-3333-4333-8333-333333333333';

let dir: string;
let env: NodeJS.ProcessEnv;

/** vigie-db <args…> : code de sortie et sorties. DATABASE_URL retirée : base PGlite du test (même en mode PostgreSQL). */
function vigieDb(...args: string[]) {
  const r = spawnSync(process.execPath, [TSX, '--conditions=react-server', 'scripts/vigie-db.ts', ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

async function withDb<T>(fn: (db: PGlite) => Promise<T>): Promise<T> {
  const db = new PGlite(path.join(dir, 'pglite'));
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}
const siteLabels = () => withDb(async (db) => (await db.query<{ label: string }>('select label from sites order by sort')).rows.map((r) => r.label));

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vigie-db-cli-'));
  env = { ...process.env };
  delete env.DATABASE_URL;
  Object.assign(env, {
    VIGIE_DATA_DIR: path.join(dir, 'pglite'), VIGIE_UPLOAD_DIR: path.join(dir, 'uploads'), VIGIE_BACKUP_DIR: path.join(dir, 'backups'),
    VIGIE_UPLOAD_KEY: randomBytes(32).toString('base64'),
  });
  await withDb(async (db) => {
    await migrate(drizzle(db), { migrationsFolder: MIGRATIONS_DIR });
    await db.query("insert into sites (id, label, sort) values ('ville-a', 'Site A', 1), ('ville-b', 'Site B', 2)");
  });
  await mkdir(path.join(dir, 'uploads'));
  await writeFile(path.join(dir, 'uploads', UPLOAD), 'pièce jointe en clair (fichier ancien)');
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('vigie-db (sauvegarde, liste, restauration)', () => {
  it('sauvegarde chiffrée de la base et des pièces jointes, puis restauration à l’identique', async () => {
    const backup = vigieDb('backup');
    expect(backup.out).toMatch(/Sauvegarde créée : .*-manuelle\.tar\.enc/);
    expect(backup.out).toMatch(/pièces jointes : 1 fichiers/);
    expect(backup.code).toBe(0);
    const [file] = (await readdir(path.join(dir, 'backups'))).filter((f) => f.endsWith('.tar.enc'));
    expect(vigieDb('list').out).toContain(file);

    // Données perdues après la sauvegarde.
    await withDb((db) => db.query("delete from sites where id = 'ville-b'"));
    await rm(path.join(dir, 'uploads', UPLOAD));
    expect(await siteLabels()).toEqual(['Site A']);

    const refused = vigieDb('restore', path.join(dir, 'backups', file));
    expect(refused.code).not.toBe(0);
    expect(refused.out).toMatch(/--remplacer/);

    const restored = vigieDb('restore', path.join(dir, 'backups', file), '--remplacer');
    expect(restored.out).toMatch(/Base restaurée/);
    expect(restored.code).toBe(0);
    expect(await siteLabels()).toEqual(['Site A', 'Site B']);
    // Pièce jointe restaurée (chiffrée au repos avec VIGIE_UPLOAD_KEY, ou telle qu'elle était sauvegardée).
    expect(existsSync(path.join(dir, 'uploads', UPLOAD))).toBe(true);
    // Base remplacée conservée à côté.
    expect((await readdir(dir)).some((f) => f.startsWith('pglite.avant-restauration-'))).toBe(true);
  });

  it('archive illisible sans la bonne clé, ou altérée : refusée sans rien restaurer', async () => {
    const [file] = (await readdir(path.join(dir, 'backups'))).filter((f) => f.endsWith('-manuelle.tar.enc'));
    const archive = path.join(dir, 'backups', file);
    const before = await siteLabels();
    const saved = env.VIGIE_UPLOAD_KEY;
    env.VIGIE_UPLOAD_KEY = randomBytes(32).toString('base64');
    const wrongKey = vigieDb('restore', archive, '--remplacer');
    env.VIGIE_UPLOAD_KEY = saved;
    expect(wrongKey.code).not.toBe(0);

    const bytes = await readFile(archive);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    const tampered = path.join(dir, 'backups', 'alteree.tar.enc');
    await writeFile(tampered, bytes);
    const r = vigieDb('restore', tampered, '--remplacer');
    expect(r.code).not.toBe(0);
    expect(await siteLabels()).toEqual(before);
  });

  it('commande inconnue : usage affiché, code 2', () => {
    const r = vigieDb('inconnue');
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/Usage : vigie-db/);
  });
});
