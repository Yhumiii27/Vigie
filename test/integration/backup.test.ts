import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tarStream, type TarEntry } from '@/db/archive';
import { backupBeforeMigrate, createBackup, extractBackup, restoreUploads, type DbSource, type Manifest } from '@/db/backup';
import { MIGRATIONS_DIR, migrationState, readJournal, type Query } from '@/db/migrations';
import { deriveKey, encryptBuffer, isEncrypted } from '@/lib/encryption';
import { parseStorageConfig, type StorageConfig } from '@/lib/env';

// Sauvegarde et restauration (PRD-02) sur PGlite : archive chiffrée, contrôle à l'extraction, pièces jointes,
// sauvegarde automatique avant une migration en attente. (PostgreSQL : pg_dump/pg_restore, vérifiés par l'exploitation.)

let dir: string;
const query = (c: PGlite): Query => (q, p) => c.query(q, p) as Promise<{ rows: Record<string, unknown>[] }>;
const source = (c: PGlite): DbSource => ({ engine: 'pglite', query: query(c), dump: () => c.dumpDataDir('gzip') });
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
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
    // Empreinte de chaque pièce jointe dans le manifeste (fichier temporaire « .restauration-tmp » ignoré).
    expect(manifest.uploads.files).toEqual({
      '11111111-1111-4111-8111-111111111111': sha256(plain), '22222222-2222-4222-8222-222222222222': sha256(sealed),
    });
    expect(isEncrypted(await readFile(file))).toBe(true);

    // Sans la clé, ou avec une autre : illisible.
    await expect(extractBackup(file, storage(), await mkdtemp(path.join(dir, 'x-')))).rejects.toThrow(/VIGIE_UPLOAD_KEY est absente/);
    await expect(extractBackup(file, storage({ VIGIE_UPLOAD_KEY: randomBytes(32).toString('hex') }), await mkdtemp(path.join(dir, 'x-')))).rejects.toThrow(/autre clé/);
    // Ancienne clé encore déclarée pendant une rotation : lisible.
    const rotated = storage({ VIGIE_UPLOAD_KEY: randomBytes(32).toString('hex'), VIGIE_UPLOAD_KEY_PREVIOUS: key });

    const extracted = await extractBackup(file, rotated, await mkdtemp(path.join(dir, 'restauration-')));
    expect(extracted).toMatchObject({ encrypted: true, warnings: [] });
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

  it('clé définie : archive en clair refusée, sauf demande explicite (allowPlaintext)', async () => {
    const s = storage({ VIGIE_UPLOAD_KEY: randomBytes(32).toString('base64'), VIGIE_UPLOAD_DIR: path.join(dir, 'uploads-clair') });
    const db = new PGlite('memory://');
    await migrate(drizzle(db), { migrationsFolder: MIGRATIONS_DIR });
    const { file, manifest } = await createBackup(s, source(db), { reason: 'manuelle', uploads: true, encrypt: false });
    await db.close();
    expect(manifest.encrypted).toBe(false);
    await expect(extractBackup(file, s, await mkdtemp(path.join(dir, 'x-')))).rejects.toThrow(/Sauvegarde en clair refusée[\s\S]*--accepter-clair/);
    const extracted = await extractBackup(file, s, await mkdtemp(path.join(dir, 'x-')), { allowPlaintext: true });
    expect(extracted.encrypted).toBe(false);
    // Sans clé : archive en clair lue normalement.
    expect((await extractBackup(file, storage(), await mkdtemp(path.join(dir, 'x-')))).encrypted).toBe(false);
  });

  describe('archive en clair contrôlée par le manifeste', () => {
    const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const contentA = Buffer.from('pièce jointe A : contenu à protéger');
    const contentB = Buffer.from('pièce jointe B');
    let good: { file: string; manifest: Manifest; db: Buffer };

    beforeAll(async () => {
      const s = storage({ VIGIE_UPLOAD_DIR: path.join(dir, 'uploads-controle'), VIGIE_BACKUP_DIR: path.join(dir, 'backups-controle') });
      await mkdir(s.uploadDir, { recursive: true });
      await writeFile(path.join(s.uploadDir, A), contentA);
      await writeFile(path.join(s.uploadDir, B), contentB);
      const db = new PGlite('memory://');
      await migrate(drizzle(db), { migrationsFolder: MIGRATIONS_DIR });
      const { file, manifest } = await createBackup(s, source(db), { reason: 'manuelle', uploads: true });
      await db.close();
      const extracted = await extractBackup(file, s, await mkdtemp(path.join(dir, 'x-')));
      good = { file, manifest, db: await readFile(extracted.dbFile) };
    });

    /** Archive construite à la main : manifeste (modifié) et entrées. */
    async function forge(manifest: Manifest, uploads: [string, Buffer][]) {
      const json = Buffer.from(JSON.stringify(manifest));
      const entries: TarEntry[] = [
        { name: 'manifest.json', size: json.length, body: () => json },
        { name: manifest.database.file, size: good.db.length, body: () => good.db },
        ...uploads.map(([name, data]) => ({ name: `pieces-jointes/${name}`, size: data.length, body: () => data })),
      ];
      const file = path.join(await mkdtemp(path.join(dir, 'forge-')), 'archive.tar');
      await pipeline(Readable.from(tarStream(entries)), createWriteStream(file));
      return file;
    }
    const extract = async (file: string) => extractBackup(file, storage(), await mkdtemp(path.join(dir, 'x-')));

    it('archive intacte : empreintes vérifiées', async () => {
      expect(good.manifest.uploads.files).toEqual({ [A]: sha256(contentA), [B]: sha256(contentB) });
      const r = await extract(good.file);
      expect([r.uploads.sort(), r.warnings]).toEqual([[A, B], []]);
    });

    it('pièce jointe modifiée (même taille) : refusée', async () => {
      const buf = await readFile(good.file);
      const at = buf.indexOf(contentA);
      expect(at).toBeGreaterThan(0);
      buf[at + 5] ^= 0x01;
      const tampered = path.join(dir, 'piece-modifiee.tar');
      await writeFile(tampered, buf);
      await expect(extract(tampered)).rejects.toThrow(`Sauvegarde altérée : la pièce jointe ${A} ne correspond pas au manifeste.`);
    });

    it('manifeste qui annonce une archive chiffrée : refusée', async () => {
      const file = await forge({ ...good.manifest, encrypted: true }, [[A, contentA], [B, contentB]]);
      await expect(extract(file)).rejects.toThrow(/Sauvegarde altérée : le manifeste annonce une archive chiffrée, le fichier est en clair/);
    });

    it('pièce déclarée absente, pièce non déclarée, pièce en double, pièces dans une archive déclarée sans : refusées', async () => {
      await expect(extract(await forge(good.manifest, [[A, contentA]]))).rejects.toThrow(`Sauvegarde altérée : pièces jointes manquantes (${B}).`);
      const onlyA = { ...good.manifest, uploads: { ...good.manifest.uploads, count: 1, files: { [A]: sha256(contentA) } } };
      await expect(extract(await forge(onlyA, [[A, contentA], [B, contentB]]))).rejects.toThrow(`Sauvegarde altérée : pièces jointes non déclarées (${B}).`);
      await expect(extract(await forge(good.manifest, [[A, contentA], [A, contentA], [B, contentB]]))).rejects.toThrow(/pièce jointe en double/);
      const none = { ...good.manifest, uploads: { included: false, count: 0, bytes: 0, files: {} } };
      await expect(extract(await forge(none, [[A, contentA]]))).rejects.toThrow(/déclare sans pièces jointes/);
    });

    it('manifeste d’une version antérieure (sans empreintes) : accepté avec un avertissement, nombre contrôlé', async () => {
      const old: Manifest = { ...good.manifest, uploads: { ...good.manifest.uploads, files: undefined } };
      const r = await extract(await forge(old, [[A, contentA], [B, contentB]]));
      expect(r.uploads.sort()).toEqual([A, B]);
      expect(r.warnings).toEqual([expect.stringMatching(/sans empreintes des pièces jointes/)]);
      await expect(extract(await forge(old, [[A, contentA]]))).rejects.toThrow(/Sauvegarde incomplète : 1 pièces jointes sur 2/);
    });
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
