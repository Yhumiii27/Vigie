import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupBeforeMigrate, createBackup, extractBackup, restoreUploads, type DbSource } from '@/db/backup';
import { MIGRATIONS_DIR, migrationState, readJournal, type Query } from '@/db/migrations';
import { deriveKey, encryptBuffer, isEncrypted } from '@/lib/encryption';
import { parseStorageConfig, type StorageConfig } from '@/lib/env';

// Sauvegarde et restauration (PRD-02) sur PGlite : archive chiffrée, contrôle à l'extraction, pièces jointes,
// sauvegarde automatique avant une migration en attente. (PostgreSQL : pg_dump/pg_restore, vérifiés par l'exploitation.)

let dir: string;
const query = (c: PGlite): Query => (q, p) => c.query(q, p) as Promise<{ rows: Record<string, unknown>[] }>;
const source = (c: PGlite): DbSource => ({ engine: 'pglite', query: query(c), dump: () => c.dumpDataDir('gzip') });
const storage = (extra: Record<string, string> = {}): StorageConfig => parseStorageConfig({
  VIGIE_DATA_DIR: path.join(dir, 'pglite'), VIGIE_UPLOAD_DIR: path.join(dir, 'uploads'), VIGIE_BACKUP_DIR: path.join(dir, 'backups'), ...extra,
});

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vigie-backup-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('sauvegarde et restauration (PGlite)', () => {
  it('archive chiffrée : base et pièces jointes restaurées à l\'identique', async () => {
    const key = randomBytes(32).toString('base64');
    const s = storage({ VIGIE_UPLOAD_KEY: key });
    await mkdir(s.uploadDir, { recursive: true });
    const plain = Buffer.from('fichier en clair, enregistré avant le chiffrement');
    const sealed = encryptBuffer(randomBytes(40_000), deriveKey(s.uploadKey!, 'pieces-jointes'));
    await writeFile(path.join(s.uploadDir, '11111111-1111-4111-8111-111111111111'), plain);
    await writeFile(path.join(s.uploadDir, '22222222-2222-4222-8222-222222222222'), sealed);
    await writeFile(path.join(s.uploadDir, '.restauration-tmp'), 'ignoré');

    const db = new PGlite('memory://');
    await migrate(drizzle(db), { migrationsFolder: MIGRATIONS_DIR });
    await db.query("insert into sites (id, label) values ('lyon', 'Site de Lyon')");
    const { file, manifest } = await createBackup(s, source(db), { reason: 'manuelle', uploads: true });
    await db.close();
    expect(path.basename(file)).toMatch(/^vigie-\d{8}-\d{6}Z-pglite-manuelle\.tar\.enc$/);
    expect(manifest).toMatchObject({ engine: 'pglite', encrypted: true, uploads: { included: true, count: 2 }, migrations: { pending: [] } });
    expect(isEncrypted(await readFile(file))).toBe(true);

    // Sans la clé, ou avec une autre : illisible.
    await expect(extractBackup(file, storage(), await mkdtemp(path.join(dir, 'x-')))).rejects.toThrow(/VIGIE_UPLOAD_KEY est absente/);
    await expect(extractBackup(file, storage({ VIGIE_UPLOAD_KEY: randomBytes(32).toString('hex') }), await mkdtemp(path.join(dir, 'x-')))).rejects.toThrow(/autre clé/);
    // Ancienne clé encore déclarée pendant une rotation : lisible.
    const rotated = storage({ VIGIE_UPLOAD_KEY: randomBytes(32).toString('hex'), VIGIE_UPLOAD_KEY_PREVIOUS: key });

    const extracted = await extractBackup(file, rotated, await mkdtemp(path.join(dir, 'restauration-')));
    expect(extracted.uploads.sort()).toEqual(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']);
    const restored = new PGlite('memory://', { loadDataDir: new Blob([new Uint8Array(await readFile(extracted.dbFile))]) });
    expect((await restored.query('select label from sites')).rows).toEqual([{ label: 'Site de Lyon' }]);
    expect((await migrationState(query(restored))).pending).toEqual([]);
    await restored.close();

    const target = path.join(dir, 'uploads-restaurees');
    expect(await restoreUploads(extracted, target)).toBe(2);
    expect(await readFile(path.join(target, '11111111-1111-4111-8111-111111111111'))).toEqual(plain);
    expect(await readFile(path.join(target, '22222222-2222-4222-8222-222222222222'))).toEqual(sealed);
  });

  it('archive altérée : refusée avant toute restauration', async () => {
    const s = storage();
    const db = new PGlite('memory://');
    await migrate(drizzle(db), { migrationsFolder: MIGRATIONS_DIR });
    const { file } = await createBackup(s, source(db), { reason: 'manuelle', uploads: false });
    await db.close();
    const buf = await readFile(file);
    buf[buf.length >> 1] ^= 0xff;
    await writeFile(file, buf);
    await expect(extractBackup(file, s, await mkdtemp(path.join(dir, 'x-')))).rejects.toThrow(/altérée|Archive|ne correspond pas/);
  });

  it('sauvegarde automatique avant une migration en attente, seulement pour une base déjà migrée', async () => {
    // Base créée par la version précédente : toutes les migrations sauf la dernière.
    const old = path.join(dir, 'drizzle-precedent');
    await cp(MIGRATIONS_DIR, old, { recursive: true });
    const journal = JSON.parse(await readFile(path.join(old, 'meta', '_journal.json'), 'utf8'));
    journal.entries = journal.entries.slice(0, -1);
    await writeFile(path.join(old, 'meta', '_journal.json'), JSON.stringify(journal));
    const s = storage({ VIGIE_BACKUP_DIR: path.join(dir, 'avant-migration') });

    const fresh = new PGlite('memory://');
    expect(await backupBeforeMigrate(s, source(fresh))).toBeNull(); // base neuve : rien à sauvegarder
    await fresh.close();

    const db = new PGlite('memory://');
    await migrate(drizzle(db), { migrationsFolder: old });
    const last = readJournal().at(-1)!.tag;
    expect((await migrationState(query(db))).pending.map((m) => m.tag)).toEqual([last]);
    expect(await backupBeforeMigrate({ ...s, backupBeforeMigrate: false }, source(db))).toBeNull();
    expect(await backupBeforeMigrate({ ...s, dataDir: 'memory://' }, source(db))).toBeNull();
    const file = await backupBeforeMigrate(s, source(db));
    expect(path.basename(file!)).toMatch(/-pglite-avant-migration\.tar$/);
    // Nouvel essai dans le même état (migration en échec, retentée à la requête suivante) : pas de deuxième sauvegarde.
    expect(await backupBeforeMigrate(s, source(db))).toBe(file);
    const extracted = await extractBackup(file!, s, await mkdtemp(path.join(dir, 'x-')));
    expect(extracted.manifest).toMatchObject({ reason: 'avant-migration', uploads: { included: false }, migrations: { pending: [last] } });

    await migrate(drizzle(db), { migrationsFolder: MIGRATIONS_DIR });
    expect(await backupBeforeMigrate(s, source(db))).toBeNull(); // plus rien en attente
    await db.close();
    expect((await readdir(s.backupDir)).filter((n) => n.endsWith('.tar'))).toHaveLength(1);
  });
});
