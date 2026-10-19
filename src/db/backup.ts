// Sauvegarde et restauration (PRD-02). Module sans 'server-only' : utilisé par src/db/index.ts (sauvegarde automatique
// avant migration) et par scripts/vigie-db.ts (npm run db:backup, db:restore, db:test-migrate).
//
// Une sauvegarde est un fichier unique dans VIGIE_BACKUP_DIR : archive tar (manifest.json, base, pièces jointes),
// chiffrée (AES-256-GCM, clé dérivée de VIGIE_UPLOAD_KEY) quand la clé est définie : vigie-<date>-<moteur>-<motif>.tar[.enc].
// - PostgreSQL : pg_dump au format personnalisé (base.pgdump) du seul schéma vigie (serveur commun EPC2I : les autres
//   schémas appartiennent aux autres outils), restauré par pg_restore dans ce schéma, sans le recréer ;
// - PGlite : copie du dossier de données (dumpDataDir, base-pglite.tar.gz), rechargée par loadDataDir.
// Le manifeste porte l'empreinte (SHA-256) de la base et de chaque pièce jointe, contrôlées à l'extraction. Quand
// VIGIE_UPLOAD_KEY est définie, une archive en clair est refusée sauf demande explicite (--accepter-clair).
// Compteurs du signalement sans compte (report_rate_limits : empreintes d'adresses IP, 24 h) : exclus des copies
// PostgreSQL ; une copie PGlite (dossier entier) les contient encore, purgés à l'ouverture suivante (src/db/maintenance.ts).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { childProcessEnv, type StorageConfig } from '../lib/env';
import { decryptFileStream, encryptStream, fileIsEncrypted, fileKeys } from '../lib/encryption';
import { readTar, tarStream, type TarEntry } from './archive';
import { DB_LAYOUT, SERVER_SCHEMA, migrationState, type Query } from './migrations';
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
  /**
   * PostgreSQL : schéma sauvegardé (vigie). Absent : sauvegarde PostgreSQL d'une version antérieure (schémas public et
   * drizzle), que cette version ne restaure pas (pas de reprise, décision du 18/10/2026). Champ facultatif : le
   * manifeste reste en version 1.
   */
  schema?: string;
  database: { file: string; size: number; sha256: string };
  /**
   * Pièces jointes copiées telles quelles (chiffrées au repos ou non) ; absentes des sauvegardes avant migration.
   * `files` : nom de stockage → SHA-256 (hexadécimal) de chaque pièce ; absent des sauvegardes d'une version antérieure
   * (champ facultatif : le manifeste reste en version 1, lisible par ces versions qui l'ignorent).
   */
  uploads: { included: boolean; count: number; bytes: number; files?: Record<string, string> };
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

/**
 * Copie du schéma vigie d'une base PostgreSQL au format personnalisé de pg_dump (compressé, restaurable par pg_restore),
 * sans les compteurs du signalement sans compte (empreintes d'adresses IP conservées 24 h : la table est restaurée vide).
 * Le rôle de Vigie (vigie_app) est propriétaire de tout ce qu'il copie ; les autres schémas ne sont jamais lus.
 */
export async function pgDump(url: string, file: string) {
  const c = pgConnection(url);
  await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', `--schema=${SERVER_SCHEMA}`,
    `--exclude-table-data=${SERVER_SCHEMA}.report_rate_limits`, `--file=${file}`, `--dbname=${c.dbname}`], c.env);
}

/**
 * Restaure une copie pg_dump dans le schéma vigie **vide**, en une transaction (en cas d'erreur, il reste vide). Avec
 * --schema, pg_restore ne recrée pas le schéma, ce que vigie_app n'a pas le droit de faire sur le serveur commun.
 * Schéma non vide : pgReplace.
 */
export async function pgRestore(url: string, file: string) {
  const c = pgConnection(url);
  await run('pg_restore', ['--no-owner', '--no-privileges', `--schema=${SERVER_SCHEMA}`, '--exit-on-error', '--single-transaction', `--dbname=${c.dbname}`, file], c.env);
}

/**
 * Vide le schéma vigie sans le supprimer (vigie_app ne pourrait pas le recréer) : vues, tables (index, contraintes et
 * séquences liées comprises), séquences, fonctions et types restants. Les objets d'autres schémas qui en dépendent
 * (matrix.journal_unifie, qui lit vigie.pub_journal) partent avec CASCADE : reposer le partage après une restauration
 * (Matrix, infra/postgres/README.md, « Restaurer le schéma d'un outil »).
 */
export const EMPTY_SERVER_SCHEMA_SQL = `do $vigie$
declare r record;
begin
  for r in select c.relkind, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = '${SERVER_SCHEMA}' and c.relkind in ('v', 'm', 'r', 'p', 'f') order by c.relkind desc loop
    execute format('drop %s if exists %I.%I cascade',
      case r.relkind when 'v' then 'view' when 'm' then 'materialized view' when 'f' then 'foreign table' else 'table' end, '${SERVER_SCHEMA}', r.relname);
  end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = '${SERVER_SCHEMA}' and c.relkind = 'S' loop
    execute format('drop sequence if exists %I.%I cascade', '${SERVER_SCHEMA}', r.relname);
  end loop;
  for r in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = '${SERVER_SCHEMA}' loop
    execute format('drop routine if exists %s cascade', r.sig);
  end loop;
  for r in select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
           where n.nspname = '${SERVER_SCHEMA}' and t.typtype in ('e', 'd', 'c', 'r') and (t.typrelid = 0 or (select relkind from pg_class where oid = t.typrelid) = 'c') loop
    execute format('drop type if exists %I.%I cascade', '${SERVER_SCHEMA}', r.typname);
  end loop;
end
$vigie$;`;

/**
 * Remplace le contenu du schéma vigie par une copie pg_dump, en une seule transaction : en cas d'erreur, la base est
 * inchangée. pg_restore écrit d'abord le script SQL de la copie dans `work` (copie illisible, format ou version non pris
 * en charge : erreur avant toute modification), puis psql exécute le vidage du schéma (EMPTY_SERVER_SCHEMA_SQL) et ce
 * script dans la même transaction (--single-transaction, arrêt et annulation à la première erreur). Les copies de Vigie
 * ne contiennent pas d'objets larges, seul cas où pg_restore écrirait ses propres BEGIN/COMMIT.
 */
export async function pgReplace(url: string, file: string, work: string) {
  const c = pgConnection(url);
  const script = path.join(/*turbopackIgnore: true*/ work, 'restauration.sql');
  await run('pg_restore', ['--no-owner', '--no-privileges', `--schema=${SERVER_SCHEMA}`, `--file=${script}`, file], c.env);
  try {
    await run('psql', ['--no-psqlrc', '--quiet', '--single-transaction', '--set=ON_ERROR_STOP=1', `--dbname=${c.dbname}`,
      `--command=set client_min_messages = warning; ${EMPTY_SERVER_SCHEMA_SQL}`, `--file=${script}`], c.env);
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
    const state = await migrationState(source.query, source.engine);
    if (source.engine === 'postgres') await pgDump(source.url, dbFile);
    else await writeFile(dbFile, Buffer.from(await (await source.dump()).arrayBuffer()), { mode: 0o600 });
    const dbSize = (await stat(dbFile)).size;
    const uploads = opts.uploads ? await listUploads(storage.uploadDir) : [];
    // Empreinte de chaque pièce jointe, lue avant l'écriture de l'archive (le manifeste reste en tête).
    const files: Record<string, string> = {};
    for (const u of uploads) files[u.name] = await sha256File(path.join(/*turbopackIgnore: true*/ storage.uploadDir, u.name));
    const now = new Date();
    const manifest: Manifest = {
      format: 'vigie-sauvegarde', version: 1, createdAt: now.toISOString(), reason: opts.reason, engine: source.engine, encrypted: encrypt,
      migrations: { applied: state.applied, last: state.last, lastWhen: state.lastWhen, pending: state.pending.map((m) => m.tag) },
      ...(source.engine === 'postgres' ? { schema: DB_LAYOUT.postgres.tables } : {}),
      database: { file: dbName, size: dbSize, sha256: await sha256File(dbFile) },
      uploads: { included: opts.uploads, count: uploads.length, bytes: uploads.reduce((n, u) => n + u.size, 0), files },
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
  /** Archive chiffrée (en-tête de chiffrement de Vigie). */
  encrypted: boolean;
  /** Avertissements à afficher (sauvegarde d'une version antérieure, sans empreintes des pièces jointes…). */
  warnings: string[];
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

export type ExtractOptions = {
  /**
   * Accepter une archive en clair alors que VIGIE_UPLOAD_KEY est définie (vigie-db --accepter-clair) : sauvegarde
   * --clair, ou faite avant l'activation du chiffrement, dont la provenance est connue.
   */
  allowPlaintext?: boolean;
};

const altered = (detail: string) => new Error(`Sauvegarde altérée : ${detail}`);

/**
 * Extrait une sauvegarde dans `work` (dossier vide) et la contrôle : archive chiffrée exigée quand une clé est définie
 * (sauf `allowPlaintext`), déchiffrement authentifié jusqu'au dernier octet, manifeste cohérent avec l'archive,
 * empreinte de la base, noms (uniques) et empreintes des pièces jointes. Rien n'est appliqué ici : la restauration ne
 * commence qu'après.
 */
export async function extractBackup(file: string, storage: StorageConfig, work: string, opts: ExtractOptions = {}): Promise<ExtractedBackup> {
  const encrypted = await fileIsEncrypted(file);
  // Avec une clé, Vigie chiffre ses sauvegardes : une archive en clair a pu être substituée (pièces jointes, base).
  if (!encrypted && storage.uploadKey && !opts.allowPlaintext) {
    throw new Error('Sauvegarde en clair refusée : VIGIE_UPLOAD_KEY est définie, et Vigie chiffre alors ses sauvegardes ; une archive en clair a pu être substituée. '
      + 'Si elle vient bien de ce serveur (sauvegarde --clair, ou faite avant l\'activation du chiffrement) : relancer avec --accepter-clair.');
  }
  const input = await decryptFileStream(file, fileKeys([storage.uploadKey, storage.uploadKeyPrevious], 'sauvegardes'));
  const uploadsDir = path.join(/*turbopackIgnore: true*/ work, 'pieces-jointes');
  await mkdir(uploadsDir, { recursive: true, mode: 0o700 });
  let manifest: Manifest | null = null;
  const uploads: string[] = [];
  const checkEncryption = (m: Manifest) => {
    if (m.encrypted !== encrypted) {
      throw altered(`le manifeste annonce une archive ${m.encrypted ? 'chiffrée' : 'en clair'}, le fichier est ${encrypted ? 'chiffré' : 'en clair'}.`);
    }
  };
  try {
    await readTar(input, (name) => {
      if (name === MANIFEST) {
        if (manifest) throw altered('manifeste en double.');
        return collect((data) => {
          manifest = checkManifest(JSON.parse(data.toString('utf8')) as Partial<Manifest>);
        });
      }
      if (!manifest) throw new Error('Fichier non reconnu : ce n\'est pas une sauvegarde de Vigie (manifeste absent en tête d\'archive).');
      checkEncryption(manifest);
      if (name === manifest.database.file) return createWriteStream(path.join(/*turbopackIgnore: true*/ work, name), { mode: 0o600 });
      if (name.startsWith(UPLOADS_PREFIX)) {
        const base = name.slice(UPLOADS_PREFIX.length);
        if (!UPLOAD_NAME.test(base)) throw new Error(`Sauvegarde invalide : nom de pièce jointe refusé (${name}).`);
        if (uploads.includes(base)) throw altered(`pièce jointe en double (${base}).`);
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
  checkEncryption(m);
  const dbFile = path.join(/*turbopackIgnore: true*/ work, m.database.file);
  const ok = await stat(dbFile).then((st) => st.size === m.database.size, () => false);
  if (!ok || (await sha256File(dbFile)) !== m.database.sha256) throw new Error('Sauvegarde altérée : la copie de la base ne correspond pas au manifeste.');
  const warnings = await checkUploads(m, uploads, uploadsDir);
  return { manifest: m, encrypted, warnings, dbFile, uploadsDir, uploads };
}

/** Pièces jointes extraites et manifeste : mêmes noms, mêmes empreintes (ou, sans empreintes, même nombre). */
async function checkUploads(m: Manifest, uploads: string[], dir: string): Promise<string[]> {
  if (!m.uploads.included) {
    if (uploads.length) throw altered(`${uploads.length} pièce(s) jointe(s) dans une archive que le manifeste déclare sans pièces jointes.`);
    return [];
  }
  const files = m.uploads.files;
  if (!files) {
    // Sauvegarde d'une version antérieure de Vigie : contrôle par le nombre seulement.
    if (uploads.length !== m.uploads.count) throw new Error(`Sauvegarde incomplète : ${uploads.length} pièces jointes sur ${m.uploads.count}.`);
    return uploads.length
      ? ['manifeste sans empreintes des pièces jointes (sauvegarde d\'une version antérieure de Vigie) : pièces jointes contrôlées par leur nombre seulement.']
      : [];
  }
  const declared = Object.keys(files);
  if (declared.length !== m.uploads.count) throw altered(`le manifeste annonce ${m.uploads.count} pièces jointes et en décrit ${declared.length}.`);
  const missing = declared.filter((n) => !uploads.includes(n));
  if (missing.length) throw altered(`pièces jointes manquantes (${listNames(missing)}).`);
  const undeclared = uploads.filter((n) => !Object.hasOwn(files, n));
  if (undeclared.length) throw altered(`pièces jointes non déclarées (${listNames(undeclared)}).`);
  for (const name of uploads) {
    if ((await sha256File(path.join(/*turbopackIgnore: true*/ dir, name))) !== files[name]) throw altered(`la pièce jointe ${name} ne correspond pas au manifeste.`);
  }
  return [];
}

const listNames = (names: string[]) => (names.length > 5 ? `${names.slice(0, 5).join(', ')}… : ${names.length} au total` : names.join(', '));

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
  const state = await migrationState(source.query, source.engine);
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
