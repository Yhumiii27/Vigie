// Sauvegarde et restauration (PRD-02). Module sans 'server-only' : utilisé par src/db/index.ts (sauvegarde automatique
// avant migration) et par scripts/vigie-db.ts (npm run db:backup, db:restore, db:test-migrate).
//
// Une sauvegarde est un fichier unique dans VIGIE_BACKUP_DIR : archive tar (manifest.json, base, pièces jointes),
// chiffrée (AES-256-GCM, clé dérivée de VIGIE_UPLOAD_KEY) quand la clé est définie : vigie-<date>-<moteur>-<motif>.tar[.enc].
// - PostgreSQL : pg_dump au format personnalisé (base.pgdump), restauré par pg_restore ;
// - PGlite : copie du dossier de données (dumpDataDir, base-pglite.tar.gz), rechargée par loadDataDir.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { childProcessEnv, type StorageConfig } from '../lib/env';
import { decryptFileStream, encryptStream, fileKeys } from '../lib/encryption';
import { readTar, tarStream, type TarEntry } from './archive';
import { migrationState, type Query } from './migrations';
import type { DbEngine } from './types';

export type BackupReason = 'manuelle' | 'avant-migration' | 'avant-restauration';

export type Manifest = {
  format: 'vigie-sauvegarde';
  version: 1;
  createdAt: string;
  reason: BackupReason;
  engine: DbEngine;
  /** Archive chiffrée (clé dérivée de VIGIE_UPLOAD_KEY). */
  encrypted: boolean;
  migrations: { applied: number; last: string | null; lastWhen: number | null; pending: string[] };
  database: { file: string; size: number; sha256: string };
  /** Pièces jointes copiées telles quelles (chiffrées au repos ou non) ; absentes des sauvegardes avant migration. */
  uploads: { included: boolean; count: number; bytes: number };
};

/** Base à sauvegarder : requête SQL (état des migrations) et moyen de copie propre au moteur. */
export type DbSource =
  | { engine: 'postgres'; url: string; query: Query }
  | { engine: 'pglite'; query: Query; dump: () => Promise<Blob> };

const MANIFEST = 'manifest.json';
const UPLOADS_PREFIX = 'pieces-jointes/';
const DB_FILE: Record<DbEngine, string> = { postgres: 'base.pgdump', pglite: 'base-pglite.tar.gz' };
/** Nom d'une pièce jointe stockée (identifiant aléatoire) : rien d'autre n'est copié ni restauré. */
const UPLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// ─── Outils PostgreSQL (pg_dump, pg_restore) ────────────────────────────────

/** Connexion pour les outils PostgreSQL : le mot de passe passe par PGPASSWORD, jamais par la ligne de commande. */
function pgConnection(url: string) {
  const u = new URL(url);
  const password = decodeURIComponent(u.password);
  u.password = '';
  const env: Record<string, string> = password ? { PGPASSWORD: password } : {};
  return { dbname: u.toString(), env };
}

function run(cmd: string, args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: childProcessEnv(env), stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    child.on('error', (err: NodeJS.ErrnoException) => reject(err.code === 'ENOENT'
      ? new Error(`${cmd} introuvable : installer le client PostgreSQL (même version majeure que le serveur) et le placer dans le PATH.`)
      : err));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} a échoué (code ${code}) : ${stderr.trim() || 'sans message'}`))));
  });
}

/** Copie d'une base PostgreSQL au format personnalisé de pg_dump (compressé, restaurable par pg_restore). */
export async function pgDump(url: string, file: string) {
  const c = pgConnection(url);
  await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--file=${file}`, `--dbname=${c.dbname}`], c.env);
}

/**
 * Restaure une copie pg_dump dans une base **vide**, en une transaction (en cas d'erreur, la base reste vide).
 * Base non vide : pgReplace.
 */
export async function pgRestore(url: string, file: string) {
  const c = pgConnection(url);
  await run('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction', `--dbname=${c.dbname}`, file], c.env);
}

/**
 * Remplace le contenu d'une base (schémas drizzle et public) par une copie pg_dump, en une seule transaction : en cas
 * d'erreur, la base est inchangée. pg_restore écrit d'abord le script SQL de la copie dans `work` (copie illisible,
 * format ou version non pris en charge : erreur avant toute modification), puis psql exécute la suppression des
 * schémas et ce script dans la même transaction (--single-transaction, arrêt et annulation à la première erreur).
 * Les copies de Vigie ne contiennent pas d'objets larges, seul cas où pg_restore écrirait ses propres BEGIN/COMMIT.
 */
export async function pgReplace(url: string, file: string, work: string) {
  const c = pgConnection(url);
  const script = path.join(/*turbopackIgnore: true*/ work, 'restauration.sql');
  await run('pg_restore', ['--no-owner', '--no-privileges', `--file=${script}`, file], c.env);
  try {
    await run('psql', ['--no-psqlrc', '--quiet', '--single-transaction', '--set=ON_ERROR_STOP=1', `--dbname=${c.dbname}`,
      '--command=set client_min_messages = warning; drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;',
      `--file=${script}`], c.env);
  } finally {
    await rm(script, { force: true });
  }
}

// ─── Création ───────────────────────────────────────────────────────────────

const sha256File = async (file: string) => {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
};

/** Pièces jointes stockées (fichiers ordinaires du dossier, hors fichiers temporaires). */
export async function listUploads(dir: string): Promise<{ name: string; size: number; mtime: Date }[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  const files = entries.filter((e) => e.isFile() && UPLOAD_NAME.test(e.name));
  return Promise.all(files.map(async (e) => {
    const s = await stat(path.join(/*turbopackIgnore: true*/ dir, e.name));
    return { name: e.name, size: s.size, mtime: s.mtime };
  }));
}

const exists = (file: string) => stat(file).then(() => true, () => false);

/** Nom libre : vigie-<AAAAMMJJ-HHMMSSZ>-<moteur>-<motif>[-n].tar[.enc]. */
async function backupFile(dir: string, engine: DbEngine, reason: BackupReason, encrypted: boolean, at: Date) {
  const stamp = at.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-');
  const base = `vigie-${stamp}-${engine}-${reason}`;
  const ext = encrypted ? '.tar.enc' : '.tar';
  let file = path.join(/*turbopackIgnore: true*/ dir, base + ext);
  for (let i = 2; await exists(file); i++) file = path.join(/*turbopackIgnore: true*/ dir, `${base}-${i}${ext}`);
  return file;
}

/** Sauvegardes présentes dans le dossier, de la plus récente à la plus ancienne. */
export async function listBackups(dir: string) {
  const entries = await readdir(dir).catch(() => [] as string[]);
  const files = await Promise.all(entries.filter((n) => /^vigie-.*\.tar(\.enc)?$/.test(n)).map(async (name) => {
    const file = path.join(/*turbopackIgnore: true*/ dir, name);
    const s = await stat(file);
    return { name, file, size: s.size, mtime: s.mtime };
  }));
  return files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime() || b.name.localeCompare(a.name));
}

export type BackupOptions = {
  reason: BackupReason;
  /** Copier aussi les pièces jointes (sauvegarde complète). */
  uploads: boolean;
  /** Chiffrer l'archive ; par défaut : oui dès que VIGIE_UPLOAD_KEY est définie. */
  encrypt?: boolean;
};

/** Crée une sauvegarde dans VIGIE_BACKUP_DIR (écrite à part, puis renommée : jamais de fichier partiel sous son nom). */
export async function createBackup(storage: StorageConfig, source: DbSource, opts: BackupOptions): Promise<{ file: string; manifest: Manifest }> {
  const [key] = fileKeys([storage.uploadKey], 'sauvegardes');
  const encrypt = opts.encrypt ?? !!key;
  if (encrypt && !key) throw new Error('Chiffrement de la sauvegarde demandé sans VIGIE_UPLOAD_KEY.');
  await mkdir(storage.backupDir, { recursive: true, mode: 0o700 });
  const work = await mkdtemp(path.join(/*turbopackIgnore: true*/ storage.backupDir, '.en-cours-'));
  try {
    const dbName = DB_FILE[source.engine];
    const dbFile = path.join(/*turbopackIgnore: true*/ work, dbName);
    const state = await migrationState(source.query);
    if (source.engine === 'postgres') await pgDump(source.url, dbFile);
    else await writeFile(dbFile, Buffer.from(await (await source.dump()).arrayBuffer()), { mode: 0o600 });
    const dbSize = (await stat(dbFile)).size;
    const uploads = opts.uploads ? await listUploads(storage.uploadDir) : [];
    const now = new Date();
    const manifest: Manifest = {
      format: 'vigie-sauvegarde', version: 1, createdAt: now.toISOString(), reason: opts.reason, engine: source.engine, encrypted: encrypt,
      migrations: { applied: state.applied, last: state.last, lastWhen: state.lastWhen, pending: state.pending.map((m) => m.tag) },
      database: { file: dbName, size: dbSize, sha256: await sha256File(dbFile) },
      uploads: { included: opts.uploads, count: uploads.length, bytes: uploads.reduce((n, u) => n + u.size, 0) },
    };
    const manifestJson = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    const entries: TarEntry[] = [
      { name: MANIFEST, size: manifestJson.length, mtime: now, body: () => manifestJson },
      { name: dbName, size: dbSize, mtime: now, body: () => createReadStream(dbFile) },
      ...uploads.map((u) => ({ name: `${UPLOADS_PREFIX}${u.name}`, size: u.size, mtime: u.mtime, body: () => createReadStream(path.join(/*turbopackIgnore: true*/ storage.uploadDir, u.name)) })),
    ];
    const tmp = path.join(/*turbopackIgnore: true*/ work, 'archive');
    await pipeline([Readable.from(tarStream(entries)), ...(encrypt ? [encryptStream(key)] : []), createWriteStream(tmp, { mode: 0o600 })]);
    const final = await backupFile(storage.backupDir, source.engine, opts.reason, encrypt, now);
    await rename(tmp, final);
    return { file: final, manifest };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// ─── Lecture ────────────────────────────────────────────────────────────────

export type ExtractedBackup = {
  manifest: Manifest;
  /** Copie de la base, extraite et contrôlée (empreinte du manifeste). */
  dbFile: string;
  /** Dossier des pièces jointes extraites (noms de stockage). */
  uploadsDir: string;
  uploads: string[];
};

function collect(onDone: (data: Buffer) => void): Writable {
  const parts: Buffer[] = [];
  return new Writable({
    write(chunk: Buffer, _enc, done) {
      parts.push(chunk);
      done();
    },
    final(done) {
      onDone(Buffer.concat(parts));
      done();
    },
  });
}

function checkManifest(m: Partial<Manifest>): Manifest {
  if (m.format !== 'vigie-sauvegarde' || m.version !== 1) throw new Error('Fichier non reconnu : ce n\'est pas une sauvegarde de Vigie (format ou version de manifeste inconnus).');
  if (m.engine !== 'postgres' && m.engine !== 'pglite') throw new Error('Sauvegarde invalide : moteur de base inconnu.');
  if (m.database?.file !== DB_FILE[m.engine]) throw new Error('Sauvegarde invalide : copie de la base absente du manifeste.');
  return m as Manifest;
}

/**
 * Extrait une sauvegarde dans `work` (dossier vide) et la contrôle : déchiffrement authentifié jusqu'au dernier octet,
 * empreinte de la base, noms des pièces jointes. Rien n'est appliqué ici : la restauration ne commence qu'après.
 */
export async function extractBackup(file: string, storage: StorageConfig, work: string): Promise<ExtractedBackup> {
  const input = await decryptFileStream(file, fileKeys([storage.uploadKey, storage.uploadKeyPrevious], 'sauvegardes'));
  const uploadsDir = path.join(/*turbopackIgnore: true*/ work, 'pieces-jointes');
  await mkdir(uploadsDir, { recursive: true, mode: 0o700 });
  let manifest: Manifest | null = null;
  const uploads: string[] = [];
  try {
    await readTar(input, (name) => {
      if (name === MANIFEST) return collect((data) => {
        manifest = checkManifest(JSON.parse(data.toString('utf8')) as Partial<Manifest>);
      });
      if (!manifest) throw new Error('Fichier non reconnu : ce n\'est pas une sauvegarde de Vigie (manifeste absent en tête d\'archive).');
      if (name === manifest.database.file) return createWriteStream(path.join(/*turbopackIgnore: true*/ work, name), { mode: 0o600 });
      if (name.startsWith(UPLOADS_PREFIX)) {
        const base = name.slice(UPLOADS_PREFIX.length);
        if (!UPLOAD_NAME.test(base)) throw new Error(`Sauvegarde invalide : nom de pièce jointe refusé (${name}).`);
        uploads.push(base);
        return createWriteStream(path.join(/*turbopackIgnore: true*/ uploadsDir, base), { mode: 0o600 });
      }
      return null;
    });
  } catch (err) {
    if (/unsupported state or unable to authenticate/i.test((err as Error).message)) throw new Error('Sauvegarde chiffrée altérée ou clé incorrecte.');
    throw err;
  } finally {
    input.destroy();
  }
  const m = manifest as Manifest | null;
  if (!m) throw new Error('Fichier non reconnu : ce n\'est pas une sauvegarde de Vigie (manifeste absent).');
  const dbFile = path.join(/*turbopackIgnore: true*/ work, m.database.file);
  const ok = await stat(dbFile).then((st) => st.size === m.database.size, () => false);
  if (!ok || (await sha256File(dbFile)) !== m.database.sha256) throw new Error('Sauvegarde altérée : la copie de la base ne correspond pas au manifeste.');
  if (m.uploads.included && uploads.length !== m.uploads.count) throw new Error(`Sauvegarde incomplète : ${uploads.length} pièces jointes sur ${m.uploads.count}.`);
  return { manifest: m, dbFile, uploadsDir, uploads };
}

/** Copie les pièces jointes extraites dans le dossier des pièces jointes (même nom : remplacé ; les autres restent). */
export async function restoreUploads(extracted: ExtractedBackup, uploadDir: string): Promise<number> {
  await mkdir(uploadDir, { recursive: true });
  for (const name of extracted.uploads) {
    const from = path.join(/*turbopackIgnore: true*/ extracted.uploadsDir, name);
    const to = path.join(/*turbopackIgnore: true*/ uploadDir, name);
    const tmp = path.join(/*turbopackIgnore: true*/ uploadDir, `.restauration-${name}`);
    try {
      await rename(from, to);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      // Autre volume (Docker : sauvegardes et pièces jointes séparées) : copie, puis remplacement atomique.
      await copyFile(from, tmp);
      await rename(tmp, to);
      await unlink(from);
    }
  }
  return extracted.uploads.length;
}

// ─── Sauvegarde automatique avant migration (src/db/index.ts) ───────────────

/**
 * Sauvegardes avant migration déjà faites par ce processus, par base et état des migrations. Une migration en échec
 * est retentée à chaque ouverture de la base (chaque requête, sonde de santé comprise : src/db/index.ts) : la base,
 * restée dans le même état (migrations annulées ensemble), n'est sauvegardée qu'une fois.
 */
const g = globalThis as unknown as { __vigieMigrationBackups?: Map<string, string> };
const doneBackups = () => (g.__vigieMigrationBackups ??= new Map());

/**
 * Avant d'appliquer des migrations en attente à une base qui en a déjà reçu : sauvegarde de la base (sans les pièces
 * jointes, que les migrations ne touchent pas), une seule fois par état des migrations. Échec de la sauvegarde : les
 * migrations ne sont pas appliquées, la base reste indisponible (pages et route de santé en erreur) et l'ouverture
 * est retentée à la requête suivante. Désactivable (VIGIE_BACKUP_BEFORE_MIGRATE=0) ; sans objet pour une base neuve
 * ou en mémoire.
 */
export async function backupBeforeMigrate(storage: StorageConfig, source: DbSource): Promise<string | null> {
  if (!storage.backupBeforeMigrate) return null;
  if (source.engine === 'pglite' && storage.dataDir.startsWith('memory://')) return null;
  const state = await migrationState(source.query);
  if (state.applied === 0 || state.pending.length === 0) return null;
  const tags = state.pending.map((m) => m.tag).join(', ');
  const key = JSON.stringify([source.engine === 'postgres' ? source.url : storage.dataDir, state.lastWhen, state.pending.map((m) => m.tag)]);
  const previous = doneBackups().get(key);
  if (previous && (await exists(previous))) return previous;
  try {
    const { file } = await createBackup(storage, source, { reason: 'avant-migration', uploads: false });
    console.log(`[vigie] Sauvegarde avant migration (${tags}) : ${file}`);
    doneBackups().set(key, file);
    return file;
  } catch (err) {
    throw new Error(`Sauvegarde avant migration impossible (${tags}) : ${(err as Error).message}\n`
      + 'Les migrations n\'ont pas été appliquées. Corriger la cause (client PostgreSQL, VIGIE_BACKUP_DIR), ou démarrer '
      + 'avec VIGIE_BACKUP_BEFORE_MIGRATE=0 après une sauvegarde manuelle (npm run db:backup).');
  }
}
