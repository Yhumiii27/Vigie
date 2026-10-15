// Outils d'exploitation de la base et des pièces jointes (PRD-02, PRD-06). Mêmes variables que le serveur
// (src/lib/env.ts, partie stockage seulement ; fichiers .env lus comme par Next.js).
//
//   npm run db:backup [-- --sans-pieces-jointes] [--clair] [--conserver <n>]
//                                                              sauvegarde (base + pièces jointes) dans VIGIE_BACKUP_DIR
//   npm run db:restore -- <sauvegarde> [--remplacer] [--forcer] [--accepter-clair]
//                                                              restauration (serveur arrêté)
//   npm run db:test-migrate -- <sauvegarde> [--base <url>] [--accepter-clair]
//                                                              migrations actuelles appliquées à une copie restaurée
//   npm run db:list                                            sauvegardes présentes
//   npm run db:check [-- --enregistrer]                        contrôle des migrations (empreintes, schéma, base vide)
//   npm run uploads:encrypt                                    chiffre les pièces jointes en clair (VIGIE_UPLOAD_KEY)
//   npm run db:reprise-liens [-- --appliquer] [--forcer]       reprise des liens d'origine des actions (ACT-01, après 0004)
//
// Restauration et essai de migration : archive contrôlée avant tout (empreintes de la base et des pièces jointes) ;
// avec VIGIE_UPLOAD_KEY, une archive en clair est refusée sauf --accepter-clair (sauvegarde --clair, ou faite avant
// l'activation du chiffrement). PGlite : la base remplacée est d'abord sauvegardée dans VIGIE_BACKUP_DIR, puis le
// dossier est vidé et rechargé sur place (point de montage Docker), et remis en état en cas d'échec.
//
// Image Docker : même outil, compilé dans /app/scripts/vigie-db.cjs (commande « vigie-db <commande> … »).

import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import type { PGlite } from '@electric-sql/pglite';
import type { Client } from 'pg';
import { createBackup, extractBackup, listBackups, listUploads, pgReplace, pgRestore, restoreUploads, type DbSource, type ExtractedBackup } from '../src/db/backup';
import { MIGRATIONS_DIR, compareChecksums, currentChecksums, migrationState, readChecksums, readJournal, recordNewChecksums, type Query } from '../src/db/migrations';
import * as schema from '../src/db/schema';
import { catalogueMismatches, readCatalogue, readDetailedCatalogue, shapeMismatches } from '../src/db/shape';
import type { Db } from '../src/db/types';
import { decryptBuffer, encryptBuffer, encryptedWith, fileKeys, isEncrypted } from '../src/lib/encryption';
import { ConfigError, isWithinDir, parseStorageConfig, type StorageConfig } from '../src/lib/env';
import { backfillActionLinks, formatBackfillReport } from '../src/lib/origin-links';

const USAGE = `Usage : vigie-db <commande> [options]
  backup [--sans-pieces-jointes] [--clair] [--conserver <n>]
                                             sauvegarde de la base et des pièces jointes ; --conserver : garde les
                                             n dernières sauvegardes manuelles (les autres sont supprimées)
  restore <fichier> [--remplacer] [--forcer] [--accepter-clair]
                                             restauration d'une sauvegarde (Vigie arrêté) ; --accepter-clair :
                                             archive en clair admise alors que VIGIE_UPLOAD_KEY est définie
  test-migrate <fichier> [--base <url>] [--accepter-clair]
                                             essai des migrations sur une copie restaurée
  list                                       sauvegardes de VIGIE_BACKUP_DIR
  check [--enregistrer]                      contrôle des migrations (développement, CI)
  encrypt-uploads                            chiffrement des pièces jointes existantes
  reprise-liens [--appliquer] [--forcer]     rattache les actions Prévention, Documents et Environnement existantes à
                                             leur fiche source d'après leur référence d'origine (ACT-01) ; sans
                                             --appliquer : essai, aucune écriture ; relançable (lien jamais remplacé)`;

class UsageError extends Error {}

const say = (msg: string) => console.log(msg);
const mo = (n: number) => (n < 1024 * 1024 ? `${Math.ceil(n / 1024)} Kio` : `${(n / 1024 / 1024).toFixed(1)} Mio`);
const stampNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');

// ─── Ouverture des bases ────────────────────────────────────────────────────

async function pgClient(url: string): Promise<Client> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: url, application_name: 'vigie-db' });
  await client.connect();
  return client;
}
const pgQuery = (c: Client): Query => (q, p) => c.query(q, p as unknown[]);
const pgliteQuery = (c: PGlite): Query => (q, p) => c.query(q, p as unknown[]) as Promise<{ rows: Record<string, unknown>[] }>;

/** La base PGlite est ouverte par un serveur Vigie (postmaster.pid présent tant qu'elle est ouverte). */
const pgliteInUse = (dir: string) => existsSync(path.join(dir, 'postmaster.pid'));

async function openPgliteDir(dir: string, force: boolean): Promise<PGlite> {
  if (!existsSync(path.join(dir, 'PG_VERSION'))) throw new Error(`Aucune base PGlite dans ${dir} (VIGIE_DATA_DIR).`);
  if (pgliteInUse(dir) && !force) {
    throw new Error(`La base PGlite ${dir} est ouverte par un serveur Vigie : l'arrêter d'abord (une base PGlite ne s'ouvre que dans un processus). `
      + 'Après un arrêt brutal du serveur (fichier postmaster.pid resté en place) : --forcer.');
  }
  const { PGlite } = await import('@electric-sql/pglite');
  return new PGlite(dir);
}

async function withSource<T>(storage: StorageConfig, force: boolean, fn: (source: DbSource) => Promise<T>): Promise<T> {
  if (storage.databaseUrl) {
    const client = await pgClient(storage.databaseUrl);
    try {
      return await fn({ engine: 'postgres', url: storage.databaseUrl, query: pgQuery(client) });
    } finally {
      await client.end();
    }
  }
  const client = await openPgliteDir(storage.dataDir, force);
  try {
    return await fn({ engine: 'pglite', query: pgliteQuery(client), dump: () => client.dumpDataDir('gzip') });
  } finally {
    await client.close();
  }
}

// ─── backup, list ───────────────────────────────────────────────────────────

async function backup(storage: StorageConfig, flags: Set<string>, keep: number | undefined) {
  const { file, manifest } = await withSource(storage, flags.has('--forcer'), (source) => createBackup(storage, source, {
    reason: 'manuelle', uploads: !flags.has('--sans-pieces-jointes'), encrypt: flags.has('--clair') ? false : undefined,
  }));
  const size = (await stat(file)).size;
  say(`Sauvegarde créée : ${file} (${mo(size)})`);
  say(`  base ${manifest.engine}, ${manifest.migrations.applied} migrations appliquées (dernière : ${manifest.migrations.last ?? '—'})`);
  say(`  pièces jointes : ${manifest.uploads.included ? `${manifest.uploads.count} fichiers (${mo(manifest.uploads.bytes)})` : 'non incluses'}`);
  say(`  archive ${manifest.encrypted ? 'chiffrée (VIGIE_UPLOAD_KEY : à conserver à part, sans elle la sauvegarde est illisible)' : 'en clair'}`);
  if (keep !== undefined) {
    // Rotation : seules les sauvegardes manuelles sont concernées (jamais celles faites avant une migration ou une restauration).
    const old = (await listBackups(storage.backupDir)).filter((b) => /-manuelle(-\d+)?\.tar(\.enc)?$/.test(b.name)).slice(keep);
    for (const b of old) await rm(b.file);
    if (old.length) say(`Sauvegardes manuelles supprimées (au-delà des ${keep} dernières) : ${old.map((b) => b.name).join(', ')}`);
  }
}

async function list(storage: StorageConfig) {
  const backups = await listBackups(storage.backupDir);
  if (!backups.length) return say(`Aucune sauvegarde dans ${storage.backupDir}.`);
  say(`Sauvegardes de ${storage.backupDir} (plus récente d'abord) :`);
  for (const b of backups) say(`  ${b.name}  ${mo(b.size)}`);
}

// ─── restore ────────────────────────────────────────────────────────────────

const engineOf = (storage: StorageConfig) => (storage.databaseUrl ? 'postgres' : 'pglite');

/** Extraction contrôlée (restore, test-migrate) : --accepter-clair, avertissements affichés. */
async function extractChecked(file: string, storage: StorageConfig, work: string, flags: Set<string>): Promise<ExtractedBackup> {
  const extracted = await extractBackup(path.resolve(file), storage, work, { allowPlaintext: flags.has('--accepter-clair') });
  if (!extracted.encrypted && storage.uploadKey) say('Avertissement : archive en clair acceptée (--accepter-clair).');
  for (const w of extracted.warnings) say(`Avertissement : ${w}`);
  return extracted;
}

/** Contrôles communs à restore et test-migrate : moteur, version de Vigie. */
function checkCompatible(extracted: ExtractedBackup, engine: 'postgres' | 'pglite' | null, force: boolean) {
  const m = extracted.manifest;
  if (engine && m.engine !== engine) {
    throw new Error(`Sauvegarde ${m.engine === 'postgres' ? 'PostgreSQL' : 'PGlite'}, base configurée ${engine === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : 'PGlite (DATABASE_URL absente)'} : `
      + 'une sauvegarde se restaure sur le même moteur.');
  }
  const latest = Math.max(0, ...readJournal().map((e) => e.when));
  if (m.migrations.lastWhen !== null && m.migrations.lastWhen > latest && !force) {
    throw new Error('Sauvegarde faite par une version plus récente de Vigie (migration inconnue de cette version) : mettre Vigie à jour avant de restaurer, ou --forcer.');
  }
}

async function restorePostgres(storage: StorageConfig, extracted: ExtractedBackup, flags: Set<string>, work: string) {
  const url = storage.databaseUrl!;
  const client = await pgClient(url);
  let replaced: string | null = null;
  try {
    const [{ n: others }] = (await client.query("select count(*)::int as n from pg_stat_activity where datname = current_database() and application_name = 'vigie' and pid <> pg_backend_pid()")).rows;
    if (others > 0 && !flags.has('--forcer')) throw new Error(`Vigie est encore connecté à la base (${others} connexion${others > 1 ? 's' : ''}) : arrêter le serveur avant la restauration (ou --forcer).`);
    const [{ n: tables }] = (await client.query("select count(*)::int as n from pg_tables where schemaname in ('public', 'drizzle')")).rows;
    if (tables > 0) {
      if (!flags.has('--remplacer')) throw new Error(`La base contient déjà ${tables} tables : --remplacer pour la remplacer (une sauvegarde « avant-restauration » est faite d'abord).`);
      const { file } = await createBackup(storage, { engine: 'postgres', url, query: pgQuery(client) }, { reason: 'avant-restauration', uploads: false });
      say(`Base actuelle sauvegardée : ${file}`);
      replaced = file;
    }
  } finally {
    await client.end();
  }
  if (!replaced) return pgRestore(url, extracted.dbFile);
  // Suppression des schémas et restauration en une transaction : en cas d'échec, la base actuelle reste en place.
  try {
    await pgReplace(url, extracted.dbFile, work);
  } catch (err) {
    throw new Error(`${(err as Error).message}\nRestauration annulée : la base actuelle est inchangée (copie : ${replaced}).`);
  }
}

/** Entrées d'un dossier de données PGlite (« lost+found » d'un volume ext4 ignoré : il n'appartient pas à la base). */
const dataEntries = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).filter((n) => n !== 'lost+found');

/** Entrée d'un dossier de données PostgreSQL (PG_VERSION, base, global, pg_*, fichiers de configuration, postmaster.*). */
const PG_ENTRY = /^(PG_VERSION|base|global|pg_[a-z_]+(\.conf)?|postgresql(\.auto)?\.conf|postmaster\.(pid|opts))$/;

/**
 * Vide le dossier sur place, entrées PostgreSQL seulement (le dossier lui-même, éventuel point de montage Docker,
 * n'est ni supprimé ni renommé ; restorePglite a refusé auparavant un dossier qui contient autre chose).
 */
async function emptyDir(dir: string) {
  for (const name of await dataEntries(dir)) if (PG_ENTRY.test(name)) await rm(path.join(dir, name), { recursive: true, force: true });
}

/** Chemin réel (liens symboliques résolus) ; dossier encore absent : chemin réel du parent existant le plus proche. */
async function realDir(dir: string): Promise<string> {
  const real = await realpath(dir).catch(() => null);
  if (real) return real;
  const parent = path.dirname(dir);
  return parent === dir ? dir : path.join(await realDir(parent), path.basename(dir));
}

/** Charge une copie PGlite (dumpDataDir) dans `dir` et vérifie qu'elle s'ouvre. */
async function loadPglite(dir: string, copy: Blob) {
  const { PGlite } = await import('@electric-sql/pglite');
  const client = new PGlite(dir, { loadDataDir: copy });
  try {
    await client.query('select 1');
  } finally {
    await client.close();
  }
}

async function restorePglite(storage: StorageConfig, extracted: ExtractedBackup, flags: Set<string>) {
  const dir = storage.dataDir;
  if (dir.startsWith('memory://')) throw new Error('VIGIE_DATA_DIR désigne une base en mémoire : rien à restaurer.');
  // Le dossier est vidé avant le chargement : refus, avant toute modification, s'il contient autre chose que la base.
  const real = await realDir(dir);
  for (const [name, other] of [['VIGIE_UPLOAD_DIR', storage.uploadDir], ['VIGIE_BACKUP_DIR', storage.backupDir]] as const) {
    if (isWithinDir(real, await realDir(other))) throw new Error(`${name} (${other}) est dans VIGIE_DATA_DIR (${dir}), vidé par la restauration : rien n'est modifié. Placer pièces jointes et sauvegardes hors de ce dossier.`);
  }
  const entries = await dataEntries(dir);
  const foreign = entries.filter((n) => !PG_ENTRY.test(n));
  if (foreign.length) {
    throw new Error(`${dir} contient d'autres fichiers qu'une base PGlite (${foreign.slice(0, 5).join(', ')}${foreign.length > 5 ? '…' : ''}) : rien n'est modifié. `
      + 'VIGIE_DATA_DIR doit désigner un dossier réservé à la base.');
  }
  const occupied = entries.length > 0;
  if (occupied) {
    if (pgliteInUse(dir) && !flags.has('--forcer')) throw new Error(`La base PGlite ${dir} est ouverte par un serveur Vigie : l'arrêter avant la restauration (ou --forcer après un arrêt brutal).`);
    if (!flags.has('--remplacer')) throw new Error(`${dir} contient déjà une base : --remplacer pour la remplacer (une sauvegarde « avant-restauration » est faite d'abord).`);
  }
  // 1. Copie lisible, contrôlée en mémoire avant toute modification du dossier.
  const copy = new Blob([new Uint8Array(await readFile(extracted.dbFile))]);
  try {
    await loadPglite('memory://', copy);
  } catch (err) {
    throw new Error(`Copie PGlite illisible (${(err as Error).message}) : base actuelle inchangée.`);
  }
  // 2. Base actuelle : sauvegardée dans VIGIE_BACKUP_DIR (comme pour PostgreSQL), puis dossier vidé sur place
  //    (jamais renommé : /data/db est un point de montage dans l'image Docker).
  let previous: Blob | null = null;
  let previousFile: string | null = null;
  if (occupied) {
    const client = await openPgliteDir(dir, true);
    try {
      const { file } = await createBackup(storage, {
        engine: 'pglite', query: pgliteQuery(client), dump: async () => (previous = await client.dumpDataDir('gzip')),
      }, { reason: 'avant-restauration', uploads: false });
      previousFile = file;
      say(`Base actuelle sauvegardée : ${file}`);
    } finally {
      await client.close();
    }
    await emptyDir(dir);
  }
  // 3. Copie chargée dans le dossier ; 4. en cas d'échec, base précédente remise en place.
  await mkdir(dir, { recursive: true });
  try {
    await loadPglite(dir, copy);
  } catch (err) {
    await emptyDir(dir);
    if (!previous) throw err;
    await loadPglite(dir, previous);
    throw new Error(`${(err as Error).message}\nRestauration annulée : base précédente remise en place (copie : ${previousFile}).`);
  }
}

async function restore(storage: StorageConfig, file: string, flags: Set<string>) {
  await mkdirBackup(storage);
  const work = await mkdtemp(path.join(storage.backupDir, '.restauration-'));
  try {
    const extracted = await extractChecked(file, storage, work, flags);
    const m = extracted.manifest;
    say(`Sauvegarde du ${new Date(m.createdAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} (${m.reason}) contrôlée : base ${m.engine}, `
      + `${m.migrations.applied} migrations, ${m.uploads.included ? `${m.uploads.count} pièces jointes` : 'sans pièces jointes'}.`);
    checkCompatible(extracted, engineOf(storage), flags.has('--forcer'));
    if (m.engine === 'postgres') await restorePostgres(storage, extracted, flags, work);
    else await restorePglite(storage, extracted, flags);
    say('Base restaurée.');
    if (m.uploads.included) say(`Pièces jointes restaurées : ${await restoreUploads(extracted, storage.uploadDir)} (dans ${storage.uploadDir}).`);
    else say('Pièces jointes non incluses dans cette sauvegarde : dossier des pièces jointes inchangé.');
    const pending = readJournal().filter((e) => m.migrations.lastWhen === null || m.migrations.lastWhen < e.when);
    if (pending.length) say(`Au prochain démarrage, Vigie appliquera ${pending.length} migration(s) (${pending.map((e) => e.tag).join(', ')}), après une sauvegarde automatique.`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const mkdirBackup = (storage: StorageConfig) => mkdir(storage.backupDir, { recursive: true, mode: 0o700 });

// ─── test-migrate ───────────────────────────────────────────────────────────

type Shape = { columns: string[]; constraints: string[]; indexes: string[] };

/** Forme du schéma public (colonnes, contraintes, index), comparable d'un moteur à l'autre. */
async function schemaShape(query: Query): Promise<Shape> {
  const col = await query("select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' order by 1, 2");
  const con = await query("select table_name, constraint_name, constraint_type from information_schema.table_constraints where table_schema = 'public' and constraint_type <> 'CHECK' order by 1, 2");
  const idx = await query("select tablename, indexname from pg_indexes where schemaname = 'public' order by 1, 2");
  return {
    columns: col.rows.map((r) => `${r.table_name}.${r.column_name} ${r.data_type}${r.is_nullable === 'NO' ? ' not null' : ''}`),
    constraints: con.rows.map((r) => `${r.table_name} ${r.constraint_type} ${r.constraint_name}`),
    indexes: idx.rows.map((r) => `${r.tablename} ${r.indexname}`),
  };
}

async function rowCounts(query: Query): Promise<Record<string, number>> {
  const tables = (await query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => String(r.tablename));
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number((await query(`select count(*)::int as n from "${t.replace(/"/g, '""')}"`)).rows[0].n);
  return out;
}

/** Schéma de référence : toutes les migrations appliquées à une base PGlite vide. */
async function freshShape(): Promise<Shape> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite('memory://');
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
    return await schemaShape(pgliteQuery(client));
  } finally {
    await client.close();
  }
}

function diffList(label: string, a: string[], b: string[]) {
  const sa = new Set(a);
  const sb = new Set(b);
  return [...a.filter((x) => !sb.has(x)).map((x) => `${label} en trop : ${x}`), ...b.filter((x) => !sa.has(x)).map((x) => `${label} manquant(e) : ${x}`)];
}

async function migrateAndCompare(query: Query, runMigrate: () => Promise<void>) {
  const before = await migrationState(query);
  const countsBefore = await rowCounts(query);
  say(`Copie restaurée : ${before.applied} migrations appliquées (dernière : ${before.last ?? '—'}), ${before.pending.length} en attente${before.pending.length ? ` : ${before.pending.map((m) => m.tag).join(', ')}` : ''}.`);
  const t0 = Date.now();
  await runMigrate();
  const after = await migrationState(query);
  say(`Migrations appliquées en ${((Date.now() - t0) / 1000).toFixed(1)} s ; en attente après : ${after.pending.length}.`);
  const countsAfter = await rowCounts(query);
  const changed = Object.keys({ ...countsBefore, ...countsAfter }).filter((t) => countsBefore[t] !== countsAfter[t]);
  for (const t of changed) say(`  lignes ${t} : ${countsBefore[t] ?? '(nouvelle table)'} → ${countsAfter[t] ?? '(table supprimée)'}`);
  const [got, want] = [await schemaShape(query), await freshShape()];
  const problems = [
    ...(after.pending.length ? [`migrations encore en attente : ${after.pending.map((m) => m.tag).join(', ')}`] : []),
    ...diffList('colonne', got.columns, want.columns), ...diffList('contrainte', got.constraints, want.constraints), ...diffList('index', got.indexes, want.indexes),
  ];
  if (problems.length) {
    for (const p of problems) say(`  ✗ ${p}`);
    throw new Error('Après migration, le schéma de la copie diffère de celui d\'une installation neuve.');
  }
  say(`Schéma identique à celui d'une installation neuve (${got.columns.length} colonnes, ${got.indexes.length} index).`);
}

async function testMigrate(storage: StorageConfig, file: string, flags: Set<string>, base: string | undefined) {
  await mkdirBackup(storage);
  const work = await mkdtemp(path.join(storage.backupDir, '.essai-migration-'));
  try {
    const extracted = await extractChecked(file, storage, work, flags);
    checkCompatible(extracted, null, flags.has('--forcer'));
    if (extracted.manifest.engine === 'pglite') {
      const { PGlite } = await import('@electric-sql/pglite');
      const { drizzle } = await import('drizzle-orm/pglite');
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      const client = new PGlite('memory://', { loadDataDir: new Blob([new Uint8Array(await readFile(extracted.dbFile))]) });
      try {
        await migrateAndCompare(pgliteQuery(client), () => migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR }));
      } finally {
        await client.close();
      }
    } else {
      await testMigratePostgres(storage, extracted, base);
    }
    say('Essai réussi : les migrations de cette version s\'appliquent à la sauvegarde.');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Base d'essai PostgreSQL : --base (base vide fournie), sinon base temporaire créée sur le serveur de DATABASE_URL. */
async function testMigratePostgres(storage: StorageConfig, extracted: ExtractedBackup, base: string | undefined) {
  let target = base;
  let drop: (() => Promise<void>) | null = null;
  if (target && storage.databaseUrl && new URL(target).pathname === new URL(storage.databaseUrl).pathname && new URL(target).host === new URL(storage.databaseUrl).host) {
    throw new Error('--base désigne la base de production (DATABASE_URL) : donner une base vide dédiée à l\'essai.');
  }
  if (!target) {
    if (!storage.databaseUrl) throw new UsageError('Sauvegarde PostgreSQL : --base <url d\'une base vide> ou DATABASE_URL (une base temporaire y est créée) requis.');
    const name = `${new URL(storage.databaseUrl).pathname.slice(1) || 'vigie'}_essai_${stampNow().toLowerCase()}`;
    const admin = await pgClient(storage.databaseUrl);
    try {
      await admin.query(`create database "${name}"`);
    } catch (err) {
      await admin.end();
      throw new Error(`Création de la base d'essai impossible (${(err as Error).message}) : droit CREATEDB requis, ou --base <url d'une base vide>.`);
    }
    const u = new URL(storage.databaseUrl);
    u.pathname = `/${name}`;
    target = u.toString();
    say(`Base d'essai temporaire : ${name}`);
    drop = async () => {
      await admin.query(`drop database if exists "${name}" with (force)`).catch((err: Error) => say(`Base d'essai ${name} non supprimée : ${err.message}`));
      await admin.end();
    };
  }
  try {
    const client = await pgClient(target);
    try {
      const [{ n }] = (await client.query("select count(*)::int as n from pg_tables where schemaname in ('public', 'drizzle')")).rows;
      if (n > 0) throw new Error('La base d\'essai n\'est pas vide.');
    } finally {
      await client.end();
    }
    await pgRestore(target, extracted.dbFile);
    const client2 = await pgClient(target);
    try {
      const { drizzle } = await import('drizzle-orm/node-postgres');
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrateAndCompare(pgQuery(client2), () => migrate(drizzle(client2), { migrationsFolder: MIGRATIONS_DIR }));
    } finally {
      await client2.end();
    }
  } finally {
    await drop?.();
  }
}

// ─── check (PRD-06) ─────────────────────────────────────────────────────────

async function check(flags: Set<string>) {
  // Contrôle du dépôt source (développement, CI) : drizzle-kit n'est pas dans l'image Docker.
  const api = await import('drizzle-kit/api').catch(() => null);
  if (!api) throw new Error('check : commande du dépôt source (développement, CI), indisponible ici (drizzle-kit absent). Lancer npm run db:check dans le dépôt.');
  const problems: string[] = [];
  const ok = (msg: string) => say(`✓ ${msg}`);

  // 1. Empreintes des migrations publiées.
  if (flags.has('--enregistrer')) {
    const added = recordNewChecksums();
    say(added.length ? `Migrations enregistrées dans drizzle/checksums.json : ${added.join(', ')}` : 'Aucune nouvelle migration à enregistrer.');
  }
  const report = compareChecksums(readChecksums(), currentChecksums());
  for (const c of report.changed) problems.push(`migration publiée modifiée : ${c.tag} (${c.parts.join(', ')}) — ne jamais modifier une migration publiée : restaurer le fichier et créer une nouvelle migration`);
  for (const tag of report.missing) problems.push(`migration publiée supprimée du journal ou du dossier drizzle/ : ${tag}`);
  for (const tag of report.unrecorded) problems.push(`nouvelle migration non enregistrée : ${tag} — npm run db:check -- --enregistrer (une fois la migration définitive)`);
  if (!report.changed.length && !report.missing.length && !report.unrecorded.length) ok('migrations publiées inchangées (drizzle/checksums.json)');

  // 2. Journal : ordre et dates croissantes (le migrator compare les dates « when »).
  const journal = readJournal();
  journal.forEach((e, i) => {
    if (e.idx !== i) problems.push(`journal : index ${e.idx} à la position ${i}`);
    if (i > 0 && e.when <= journal[i - 1].when) problems.push(`journal : ${e.tag} n'est pas daté après ${journal[i - 1].tag} (elle ne serait jamais appliquée aux bases existantes)`);
  });

  // 3. Cohérence des instantanés (drizzle-kit check).
  const kit = spawnSync(process.execPath, [path.join('node_modules', 'drizzle-kit', 'bin.cjs'), 'check'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (kit.status === 0) ok('drizzle-kit check');
  else problems.push(`drizzle-kit check : ${(kit.stdout + kit.stderr).trim().split('\n').slice(-5).join(' / ')}`);

  // 4. Schéma (src/db/schema.ts) et dernière migration : aucune différence (sinon npm run db:generate).
  const schema = await import('../src/db/schema');
  const last = journal.at(-1)!;
  const snapshot = JSON.parse(await readFile(path.join(MIGRATIONS_DIR, 'meta', `${last.tag.split('_')[0]}_snapshot.json`), 'utf8'));
  const diff = await api.generateMigration(snapshot, api.generateDrizzleJson(schema as Record<string, unknown>, snapshot.id));
  if (diff.length) problems.push(`schéma modifié sans migration (${diff.length} instruction(s), ex. ${diff[0].split('\n')[0]}) — npm run db:generate`);
  else ok('schéma identique à la dernière migration');

  // 5. Base vide : toutes les migrations, puis le jeu de démonstration.
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite('memory://');
  try {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    ok(`${journal.length} migrations appliquées à une base vide`);
    // 5b. Forme de la base = dernier instantané (src/db/shape.ts) : une retouche à la main du SQL d'une migration
    // (NOT NULL oublié, CHECK mal nommé ou au contenu faux, DEFAULT oublié, type changé, DROP COLUMN manquant) que
    // drizzle-kit, qui ne lit que schema.ts, ne voit pas. Noms et NOT NULL contre l'instantané, puis catalogue détaillé
    // contre une base de référence construite directement depuis l'instantané (SQL d'installation neuve de drizzle-kit).
    const shape = shapeMismatches(snapshot, await readCatalogue(pgliteQuery(client)));
    const reference = new PGlite('memory://');
    try {
      for (const statement of await api.generateMigration(await api.generateDrizzleJson({}), snapshot)) await reference.exec(statement);
      shape.push(...catalogueMismatches(await readDetailedCatalogue(pgliteQuery(reference)), await readDetailedCatalogue(pgliteQuery(client))));
    } finally {
      await reference.close();
    }
    for (const m of shape) problems.push(`forme de la base : ${m}`);
    if (!shape.length) ok(`forme de la base identique à l'instantané ${last.tag} (noms, types, valeurs par défaut, contraintes, index)`);
    const { seed } = await import('../src/db/seed');
    await seed(db);
    const [{ n }] = (await client.query<{ n: number }>('select count(*)::int as n from people')).rows;
    ok(`jeu de démonstration chargé (${n} personnes)`);
  } catch (err) {
    problems.push(`base vide : ${(err as Error).message.split('\n')[0].slice(0, 300)}`);
  } finally {
    await client.close();
  }

  if (problems.length) {
    for (const p of problems) say(`✗ ${p}`);
    throw new Error(`${problems.length} problème(s) de migration.`);
  }
  say('Migrations conformes.');
}

// ─── encrypt-uploads ────────────────────────────────────────────────────────

async function encryptUploads(storage: StorageConfig) {
  if (!storage.uploadKey) throw new Error('VIGIE_UPLOAD_KEY absente : rien à chiffrer (définir la clé, puis relancer).');
  const keys = fileKeys([storage.uploadKey, storage.uploadKeyPrevious], 'pieces-jointes');
  const [current] = keys;
  const files = await listUploads(storage.uploadDir);
  const n = { chiffres: 0, rechiffres: 0, aJour: 0, inconnus: 0, erreurs: 0 };
  for (const f of files) {
    const file = path.join(storage.uploadDir, f.name);
    const data = await readFile(file);
    if (encryptedWith(data, current)) {
      n.aJour++;
      continue;
    }
    if (isEncrypted(data) && !keys.some((k) => encryptedWith(data, k))) {
      // Clé ancienne non renseignée, ou fichier en clair commençant par l'en-tête de Vigie (déposé avant que
      // saveUpload ne les refuse) : à examiner, pas une erreur de chiffrement.
      n.inconnus++;
      say(`✗ ${f.name} : en-tête de chiffrement de Vigie sans clé connue`);
      continue;
    }
    try {
      const plain = decryptBuffer(data, keys);
      // Écriture à part puis remplacement atomique : le serveur peut rester démarré (il lit les deux formes).
      const tmp = path.join(storage.uploadDir, `.chiffrement-${f.name}`);
      await writeFile(tmp, encryptBuffer(plain, current), { mode: 0o600 });
      await rename(tmp, file);
      if (isEncrypted(data)) n.rechiffres++;
      else n.chiffres++;
    } catch (err) {
      n.erreurs++;
      say(`✗ ${f.name} : ${(err as Error).message}`);
    }
  }
  say(`Pièces jointes de ${storage.uploadDir} : ${files.length} fichiers — ${n.chiffres} chiffrés, ${n.rechiffres} rechiffrés avec la nouvelle clé, ${n.aJour} déjà à jour, `
    + `${n.inconnus} avec en-tête de Vigie sans clé connue, ${n.erreurs} en erreur.`);
  const problems = [
    ...(n.inconnus ? [`${n.inconnus} fichier(s) avec en-tête de Vigie sans clé connue : chiffrés avec une clé absente de VIGIE_UPLOAD_KEY et VIGIE_UPLOAD_KEY_PREVIOUS, ou fichiers en clair qui commencent par cet en-tête`] : []),
    ...(n.erreurs ? [`${n.erreurs} fichier(s) illisibles (altérés ?)`] : []),
  ];
  if (problems.length) throw new Error(`Certains fichiers n'ont pas pu être chiffrés : ${problems.join(' ; ')}.`);
}

// ─── reprise-liens ──────────────────────────────────────────────────────────

/**
 * Reprise des liens d'origine des actions (ACT-01, src/lib/origin-links.ts) sur une base déjà migrée par Vigie (migration
 * 0004 appliquée au démarrage), de préférence après une sauvegarde : essai par défaut, --appliquer pour écrire (une entrée
 * « Origine rattachée » au journal de chaque action). Une base de démonstration est reprise d'office à son ouverture.
 */
async function repriseLiens(storage: StorageConfig, flags: Set<string>) {
  const unknown = [...flags].filter((f) => f !== '--appliquer' && f !== '--forcer');
  if (unknown.length) throw new UsageError(`Option inconnue : ${unknown.join(' ')}`);
  const run = async (db: Db, query: Query) => {
    const state = await migrationState(query);
    if (state.newer) throw new Error('Base migrée par une version plus récente de Vigie : lancer la reprise avec cette version.');
    if (state.pending.length) {
      throw new Error(`Migrations en attente (${state.pending.map((m) => m.tag).join(', ')}) : démarrer Vigie une fois, qui les applique, avant la reprise.`);
    }
    const report = await backfillActionLinks(db, { apply: flags.has('--appliquer') });
    formatBackfillReport(report).forEach((line) => say(line));
  };
  if (storage.databaseUrl) {
    const client = await pgClient(storage.databaseUrl);
    try {
      const { drizzle } = await import('drizzle-orm/node-postgres');
      return await run(drizzle(client, { schema }), pgQuery(client));
    } finally {
      await client.end();
    }
  }
  if (storage.dataDir.startsWith('memory://')) throw new Error(`Aucune base PGlite dans ${storage.dataDir} (VIGIE_DATA_DIR).`);
  const client = await openPgliteDir(storage.dataDir, flags.has('--forcer'));
  try {
    const { drizzle } = await import('drizzle-orm/pglite');
    return await run(drizzle(client, { schema }), pgliteQuery(client));
  } finally {
    await client.close();
  }
}

// ─── Entrée ─────────────────────────────────────────────────────────────────

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  // Options à valeur : --base <url>, --conserver <n>.
  const valued = ['--base', '--conserver'].map((o) => rest.indexOf(o)).filter((i) => i >= 0);
  const value = (o: string) => (rest.includes(o) ? rest[rest.indexOf(o) + 1] : undefined);
  const args = rest.filter((a, i) => !a.startsWith('--') && !valued.includes(i - 1));
  const base = value('--base');
  const keepRaw = value('--conserver');
  const keep = keepRaw === undefined ? undefined : Number(keepRaw);
  if (keep !== undefined && !(Number.isInteger(keep) && keep >= 1)) throw new UsageError('--conserver : nombre de sauvegardes à garder attendu (1 ou plus).');
  if (!command || command === 'help' || flags.has('--help')) return say(USAGE);

  loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });
  const storage = parseStorageConfig(process.env);
  const needFile = () => {
    if (!args[0]) throw new UsageError(`${command} : fichier de sauvegarde attendu (npm run db:list pour les lister).`);
    return args[0];
  };
  switch (command) {
    case 'backup': return backup(storage, flags, keep);
    case 'restore': return restore(storage, needFile(), flags);
    case 'test-migrate': return testMigrate(storage, needFile(), flags, base);
    case 'list': return list(storage);
    case 'check': return check(flags);
    case 'encrypt-uploads': return encryptUploads(storage);
    case 'reprise-liens': return repriseLiens(storage, flags);
    default: throw new UsageError(`Commande inconnue : ${command}`);
  }
}

main().then(() => process.exit(0), (err: unknown) => {
  if (err instanceof UsageError) {
    console.error(`${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  console.error(err instanceof ConfigError ? err.message : `Erreur : ${(err as Error).message}`);
  process.exit(1);
});
