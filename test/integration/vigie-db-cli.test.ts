import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tarStream } from '@/db/archive';
import { extractBackup } from '@/db/backup';
import { MIGRATIONS_DIR } from '@/db/migrations';
import { parseStorageConfig } from '@/lib/env';

// Outil d'exploitation `vigie-db` (scripts/vigie-db.ts, npm run db:backup / db:list / db:restore — PRD-02), exécuté
// comme en production (processus séparé, variables d'environnement) sur une base PGlite et des pièces jointes chiffrées.

const ROOT = path.resolve(__dirname, '../..');
const TSX = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');
const UPLOAD = '33333333-3333-4333-8333-333333333333';

let dir: string;
let env: NodeJS.ProcessEnv;

/** vigie-db <args…> : code de sortie et sorties. DATABASE_URL retirée : base PGlite du test (même en mode PostgreSQL). */
const vigieDb = (...args: string[]) => vigieDbWith({}, ...args);

/** vigie-db avec d'autres dossiers de stockage (VIGIE_DATA_DIR, VIGIE_UPLOAD_DIR, VIGIE_BACKUP_DIR…). */
function vigieDbWith(extra: Record<string, string>, ...args: string[]) {
  const r = spawnSync(process.execPath, [TSX, '--conditions=react-server', 'scripts/vigie-db.ts', ...args], { cwd: ROOT, env: { ...env, ...extra }, encoding: 'utf8', timeout: 120_000 });
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
/** Inode du dossier de données : jamais renommé ni recréé par la restauration (point de montage Docker). */
const dataInode = async () => (await stat(path.join(dir, 'pglite'))).ino;
const backups = async (pattern: RegExp) => (await readdir(path.join(dir, 'backups'))).filter((f) => pattern.test(f));

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

    const inode = await dataInode();
    const restored = vigieDb('restore', path.join(dir, 'backups', file), '--remplacer');
    expect(restored.out).toMatch(/Base restaurée/);
    expect(restored.code).toBe(0);
    expect(await siteLabels()).toEqual(['Site A', 'Site B']);
    // Pièce jointe restaurée (chiffrée au repos avec VIGIE_UPLOAD_KEY, ou telle qu'elle était sauvegardée).
    expect(existsSync(path.join(dir, 'uploads', UPLOAD))).toBe(true);
    // Base remplacée sauvegardée dans VIGIE_BACKUP_DIR (chiffrée) ; dossier de données vidé et rechargé sur place.
    expect(restored.out).toMatch(/Base actuelle sauvegardée : .*-pglite-avant-restauration\.tar\.enc/);
    expect(await backups(/-pglite-avant-restauration\.tar\.enc$/)).toHaveLength(1);
    expect(await dataInode()).toBe(inode);
    expect((await readdir(dir)).some((f) => f.startsWith('pglite.'))).toBe(false);
  });

  it('copie de la base illisible : refusée avant toute modification, base et dossier intacts', async () => {
    const [file] = await backups(/-manuelle\.tar\.enc$/);
    const storage = parseStorageConfig({ VIGIE_UPLOAD_KEY: env.VIGIE_UPLOAD_KEY, VIGIE_BACKUP_DIR: env.VIGIE_BACKUP_DIR });
    const { manifest } = await extractBackup(path.join(dir, 'backups', file), storage, await mkdtemp(path.join(dir, 'x-')));
    // Archive en clair, cohérente (empreintes justes), dont la copie PGlite n'est pas une base.
    const copy = Buffer.from('ceci n’est pas une copie PGlite');
    const forged = Buffer.from(JSON.stringify({
      ...manifest, encrypted: false, database: { ...manifest.database, size: copy.length, sha256: createHash('sha256').update(copy).digest('hex') },
      uploads: { included: false, count: 0, bytes: 0, files: {} },
    }));
    const bad = path.join(dir, 'illisible.tar');
    await pipeline(Readable.from(tarStream([
      { name: 'manifest.json', size: forged.length, body: () => forged },
      { name: manifest.database.file, size: copy.length, body: () => copy },
    ])), createWriteStream(bad));
    const before = await siteLabels();
    const inode = await dataInode();
    const count = (await backups(/avant-restauration/)).length;
    const r = vigieDb('restore', bad, '--remplacer', '--accepter-clair');
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/Copie PGlite illisible/);
    expect(await siteLabels()).toEqual(before);
    expect(await dataInode()).toBe(inode);
    expect(await backups(/avant-restauration/)).toHaveLength(count);
  });

  it('VIGIE_UPLOAD_KEY définie : archive en clair refusée, sauf --accepter-clair', async () => {
    const clear = vigieDb('backup', '--clair', '--sans-pieces-jointes');
    expect(clear.code).toBe(0);
    const [file] = await backups(/-manuelle(-\d+)?\.tar$/);
    await withDb((db) => db.query("delete from sites where id = 'ville-b'"));
    const refused = vigieDb('restore', path.join(dir, 'backups', file), '--remplacer');
    expect(refused.code).not.toBe(0);
    expect(refused.out).toMatch(/Sauvegarde en clair refusée/);
    expect(refused.out).toMatch(/--accepter-clair/);
    expect(await siteLabels()).toEqual(['Site A']);
    expect(vigieDb('test-migrate', path.join(dir, 'backups', file)).code).not.toBe(0);
    const accepted = vigieDb('restore', path.join(dir, 'backups', file), '--remplacer', '--accepter-clair');
    expect(accepted.out).toMatch(/Avertissement : archive en clair acceptée/);
    expect(accepted.code).toBe(0);
    expect(await siteLabels()).toEqual(['Site A', 'Site B']);
    const essai = vigieDb('test-migrate', path.join(dir, 'backups', file), '--accepter-clair');
    expect(essai.out).toMatch(/Essai réussi/);
    expect(essai.code).toBe(0);
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

  it('pièces jointes ou sauvegardes dans VIGIE_DATA_DIR : restauration refusée, rien n’est supprimé', async () => {
    const [file] = await backups(/-manuelle\.tar\.enc$/);
    // Disposition imbriquée (VIGIE_DATA_DIR=/data, pièces jointes et sauvegardes dans /data/uploads et /data/backups).
    const data = path.join(dir, 'imbrique');
    await cp(path.join(dir, 'pglite'), data, { recursive: true });
    await mkdir(path.join(data, 'uploads'));
    await writeFile(path.join(data, 'uploads', UPLOAD), 'pièce jointe à conserver');
    await mkdir(path.join(data, 'backups'));
    await cp(path.join(dir, 'backups', file), path.join(data, 'backups', 'a-restaurer.tar.enc'));
    await writeFile(path.join(data, 'backups', 'ancienne.tar'), 'sauvegarde plus ancienne');
    const snapshot = async () => ({
      data: (await readdir(data)).sort(), uploads: await readdir(path.join(data, 'uploads')), backups: (await readdir(path.join(data, 'backups'))).sort(),
      upload: await readFile(path.join(data, 'uploads', UPLOAD), 'utf8'),
    });
    const before = await snapshot();
    const archive = path.join(data, 'backups', 'a-restaurer.tar.enc');

    // 1. Configuration refusée (VIGIE_UPLOAD_DIR et VIGIE_BACKUP_DIR sous VIGIE_DATA_DIR).
    const nested = vigieDbWith({ VIGIE_DATA_DIR: data, VIGIE_UPLOAD_DIR: path.join(data, 'uploads'), VIGIE_BACKUP_DIR: path.join(data, 'backups') }, 'restore', archive, '--remplacer');
    expect(nested.code).toBe(1);
    expect(nested.out).toMatch(/VIGIE_UPLOAD_DIR : à placer hors de VIGIE_DATA_DIR/);
    expect(nested.out).toMatch(/VIGIE_BACKUP_DIR : à placer hors de VIGIE_DATA_DIR/);
    expect(nested.out).not.toMatch(/Base actuelle sauvegardée|Base restaurée/);
    expect(await snapshot()).toEqual(before);

    // 2. Même disposition par liens symboliques (chemins distincts pour la configuration) : refusée par vigie-db.
    await symlink(path.join(data, 'uploads'), path.join(dir, 'lien-uploads'));
    await symlink(path.join(data, 'backups'), path.join(dir, 'lien-backups'));
    const linked = vigieDbWith({ VIGIE_DATA_DIR: data, VIGIE_UPLOAD_DIR: path.join(dir, 'lien-uploads'), VIGIE_BACKUP_DIR: path.join(dir, 'lien-backups') },
      'restore', path.join(dir, 'lien-backups', 'a-restaurer.tar.enc'), '--remplacer');
    expect(linked.code).toBe(1);
    expect(linked.out).toMatch(/VIGIE_UPLOAD_DIR \(.*\) est dans VIGIE_DATA_DIR .* rien n'est modifié/);
    expect(linked.out).not.toMatch(/Base actuelle sauvegardée|Base restaurée/);
    expect(await snapshot()).toEqual(before);

    // 3. Autre fichier dans le dossier de données : refus avant toute modification (seule une base PGlite est vidée).
    const other = path.join(dir, 'autre-fichier');
    await cp(path.join(dir, 'pglite'), other, { recursive: true });
    await writeFile(path.join(other, 'notes.txt'), 'à conserver');
    const entries = (await readdir(other)).sort();
    const count = (await backups(/avant-restauration/)).length;
    const foreign = vigieDbWith({ VIGIE_DATA_DIR: other }, 'restore', path.join(dir, 'backups', file), '--remplacer');
    expect(foreign.code).toBe(1);
    expect(foreign.out).toMatch(/contient d'autres fichiers qu'une base PGlite \(notes\.txt\) : rien n'est modifié/);
    expect((await readdir(other)).sort()).toEqual(entries);
    expect(await backups(/avant-restauration/)).toHaveLength(count);
  });

  it('commande inconnue : usage affiché, code 2', () => {
    const r = vigieDb('inconnue');
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/Usage : vigie-db/);
  });
});
