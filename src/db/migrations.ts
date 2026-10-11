// Migrations de drizzle/ (PRD-06) : journal, état d'une base (migrations appliquées, en attente) et empreintes des
// migrations publiées (drizzle/checksums.json, contrôlées par npm run db:check). Module sans 'server-only' :
// utilisé par src/db/index.ts (sauvegarde avant migration) et par scripts/vigie-db.ts.
//
// Règle : une migration publiée ne se modifie jamais ; tout changement de schéma passe par une nouvelle migration
// (npm run db:generate). Le migrator de Drizzle n'applique que les migrations plus récentes (« when ») que la dernière
// appliquée : une migration publiée modifiée ne serait jamais rejouée sur les bases existantes.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Dossier des migrations (drizzle/), à côté du serveur (copié avec la sortie standalone et dans l'image Docker). */
export const MIGRATIONS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), 'drizzle');

export type JournalEntry = { idx: number; when: number; tag: string };

/** Requête SQL brute, commune à node-postgres (PoolClient.query) et à PGlite (query). */
export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export function readJournal(dir = MIGRATIONS_DIR): JournalEntry[] {
  const journal = JSON.parse(readFileSync(path.join(/*turbopackIgnore: true*/ dir, 'meta', '_journal.json'), 'utf8')) as { entries: JournalEntry[] };
  return journal.entries.map(({ idx, when, tag }) => ({ idx, when, tag }));
}

export type MigrationState = {
  /** Migrations appliquées (table drizzle.__drizzle_migrations). */
  applied: number;
  /** Dernière migration appliquée (tag du journal, ou null si inconnue de ce code : base plus récente). */
  last: string | null;
  lastWhen: number | null;
  /** Migrations du journal que le migrator appliquera (plus récentes que la dernière appliquée). */
  pending: JournalEntry[];
  /** La base a été migrée par une version plus récente de Vigie (migration inconnue du journal). */
  newer: boolean;
};

/** État des migrations d'une base, selon la règle du migrator de Drizzle (comparaison des dates « when »). */
export async function migrationState(query: Query, dir = MIGRATIONS_DIR): Promise<MigrationState> {
  const journal = readJournal(dir);
  const [{ t }] = (await query("select to_regclass('drizzle.__drizzle_migrations')::text as t")).rows as { t: string | null }[];
  if (!t) return { applied: 0, last: null, lastWhen: null, pending: journal, newer: false };
  const [row] = (await query('select count(*)::int as n, max(created_at)::text as last from drizzle.__drizzle_migrations')).rows as { n: number; last: string | null }[];
  const lastWhen = row.last === null ? null : Number(row.last);
  const pending = journal.filter((e) => lastWhen === null || lastWhen < e.when);
  const known = journal.find((e) => e.when === lastWhen);
  return {
    applied: Number(row.n), last: known?.tag ?? null, lastWhen, pending,
    newer: lastWhen !== null && !known && lastWhen > Math.max(0, ...journal.map((e) => e.when)),
  };
}

// ─── Empreintes des migrations publiées (drizzle/checksums.json) ────────────

export type MigrationChecksum = { when: number; sql: string; snapshot: string | null };
export type ChecksumFile = { regle: string; migrations: Record<string, MigrationChecksum> };

export const CHECKSUMS_FILE = 'checksums.json';
const RULE = 'Migrations publiées : ne jamais modifier une migration listée ici (SQL, instantané, date du journal). '
  + 'Tout changement de schéma passe par une nouvelle migration (npm run db:generate), enregistrée ici par npm run db:check -- --enregistrer.';

/** Empreinte du contenu, fins de ligne normalisées (extraction Git sous Windows). */
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

/** Empreintes actuelles des migrations du journal (SQL, instantané meta/NNNN_snapshot.json, date « when »). */
export function currentChecksums(dir = MIGRATIONS_DIR): Record<string, MigrationChecksum> {
  return Object.fromEntries(readJournal(dir).map((e) => {
    const snapshot = path.join(/*turbopackIgnore: true*/ dir, 'meta', `${e.tag.split('_')[0]}_snapshot.json`);
    return [e.tag, { when: e.when, sql: sha256(path.join(/*turbopackIgnore: true*/ dir, `${e.tag}.sql`)), snapshot: existsSync(snapshot) ? sha256(snapshot) : null }];
  }));
}

export function readChecksums(dir = MIGRATIONS_DIR): ChecksumFile | null {
  const file = path.join(/*turbopackIgnore: true*/ dir, CHECKSUMS_FILE);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ChecksumFile) : null;
}

export type ChecksumReport = {
  /** Migrations publiées modifiées (SQL, instantané ou date). */
  changed: { tag: string; parts: string[] }[];
  /** Migrations publiées absentes du journal ou du dossier. */
  missing: string[];
  /** Migrations du journal pas encore enregistrées (nouvelles). */
  unrecorded: string[];
};

export function compareChecksums(recorded: ChecksumFile | null, current: Record<string, MigrationChecksum>): ChecksumReport {
  const published = recorded?.migrations ?? {};
  const changed = Object.entries(published).flatMap(([tag, r]) => {
    const c = current[tag];
    if (!c) return [];
    const parts = [r.sql !== c.sql && 'SQL', r.snapshot !== c.snapshot && 'instantané', r.when !== c.when && 'date du journal'].filter((p): p is string => !!p);
    return parts.length ? [{ tag, parts }] : [];
  });
  return {
    changed,
    missing: Object.keys(published).filter((tag) => !current[tag]),
    unrecorded: Object.keys(current).filter((tag) => !published[tag]),
  };
}

/** Ajoute les nouvelles migrations à drizzle/checksums.json (les migrations publiées n'y sont jamais réécrites). */
export function recordNewChecksums(dir = MIGRATIONS_DIR): string[] {
  const recorded = readChecksums(dir);
  const current = currentChecksums(dir);
  const added = Object.keys(current).filter((tag) => !recorded?.migrations[tag]);
  const file: ChecksumFile = { regle: RULE, migrations: { ...recorded?.migrations } };
  for (const tag of added) file.migrations[tag] = current[tag];
  writeFileSync(path.join(/*turbopackIgnore: true*/ dir, CHECKSUMS_FILE), `${JSON.stringify(file, null, 2)}\n`);
  return added;
}
