// Déclaration du schéma de la base de Vigie auprès de Matrix (contrat matrix.schema/1), portage typé du module de
// référence de Matrix (integration/declarer-schema.mjs ; docs/declaration-des-tables.md dans le dépôt Matrix).
//
// Appelée par src/db/index.ts juste après les migrations : lit le schéma réel (information_schema et pg_constraint,
// journal des migrations exclu) et l'envoie sur POST {MATRIX_URL}/api/declarations. Sans MATRIX_URL, rien n'est envoyé.
// Jamais bloquante : l'appel n'est pas attendu et toute erreur devient un avertissement dans la console.
// Réglages (MATRIX_URL, MATRIX_TOKEN, MATRIX_DECLARATIONS_DIR, APP_VERSION) lus et validés par src/lib/env.ts.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type MatrixColumn = { name: string; type: string; nullable: boolean; pk: boolean; default: string | null };
export type MatrixForeignKey = { columns: string[]; table: string; refColumns: string[]; onDelete: string | null; declared: true };
export type MatrixTable = { name: string; columns: MatrixColumn[]; pk: string[]; fks: MatrixForeignKey[]; uniques: string[][] };

/** Document matrix.schema/1 envoyé à Matrix. */
export type MatrixSchemaDocument = {
  schema: 'matrix.schema/1';
  app: string;
  version: string | null;
  declareLe: string;
  /** Empreinte des tables : Matrix ignore une déclaration inchangée. */
  empreinte: string;
  tables: MatrixTable[];
};

/** Réglages de la déclaration (VigieConfig.matrix). */
export type MatrixSettings = {
  /** Adresse de Matrix, identifiants HTTP compris le cas échéant ; null : rien n'est envoyé. */
  url: string | null;
  /** Jeton partagé, envoyé dans l'en-tête X-Matrix-Token. */
  token: string | null;
  /** Dossier où écrire aussi la déclaration (<app>.json), utile sans réseau. */
  declarationsDir: string | null;
  /** Version de l'application (APP_VERSION). */
  version: string | null;
};

/** Requête SQL brute renvoyant ses lignes (PGlite ou node-postgres). */
export type RowQuery = (sql: string) => Promise<Record<string, unknown>[]>;

type Log = Pick<Console, 'info' | 'warn'>;

const PG_TABLES = `
  select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = current_schema() and t.table_type = 'BASE TABLE'
    and c.table_name not in ('__drizzle_migrations', 'schema_migrations')
  order by c.table_name, c.ordinal_position`;

const PG_CONSTRAINTS = `
  select rel.relname as table_name, con.contype as kind,
    array(select a.attname from unnest(con.conkey) with ordinality k(n, o)
          join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o)::text[] as cols,
    ref.relname as ref_table,
    array(select a.attname from unnest(con.confkey) with ordinality k(n, o)
          join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o)::text[] as ref_cols,
    con.confdeltype as on_delete
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  left join pg_class ref on ref.oid = con.confrelid
  where n.nspname = current_schema() and con.contype in ('p', 'u', 'f')
  order by rel.relname, con.conname`;

const ON_DELETE: Record<string, string> = { a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' };

/** Tableau PostgreSQL : déjà décodé (PGlite, node-postgres) ou sous forme littérale « {a,b} ». */
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : String(v ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean);
const str = (v: unknown): string => String(v ?? '');

/** Lit le schéma courant d'une base PostgreSQL ou PGlite (schéma courant, tables seulement). */
export async function introspectPostgres(query: RowQuery): Promise<MatrixTable[]> {
  const tables = new Map<string, MatrixTable>();
  for (const r of await query(PG_TABLES)) {
    const name = str(r.table_name);
    let t = tables.get(name);
    if (!t) tables.set(name, (t = { name, columns: [], pk: [], fks: [], uniques: [] }));
    const dataType = str(r.data_type);
    const udt = str(r.udt_name);
    const type = dataType === 'USER-DEFINED' ? udt : dataType === 'ARRAY' ? `${udt.replace(/^_/, '')}[]` : dataType;
    t.columns.push({
      name: str(r.column_name), type, nullable: r.is_nullable === 'YES', pk: false,
      default: r.column_default == null ? null : str(r.column_default),
    });
  }
  for (const r of await query(PG_CONSTRAINTS)) {
    const t = tables.get(str(r.table_name));
    if (!t) continue;
    const cols = arr(r.cols);
    if (r.kind === 'p') {
      t.pk = cols;
      const col = cols.length === 1 ? t.columns.find((c) => c.name === cols[0]) : undefined;
      if (col) col.pk = true;
    } else if (r.kind === 'u') {
      t.uniques.push(cols);
    } else {
      t.fks.push({ columns: cols, table: str(r.ref_table), refColumns: arr(r.ref_cols), onDelete: ON_DELETE[str(r.on_delete)] ?? null, declared: true });
    }
  }
  return [...tables.values()];
}

/** Construit le document matrix.schema/1 (tables triées par nom, empreinte SHA-256 tronquée à 16 caractères). */
export function schemaDocument({ app, version = null, tables }: { app: string; version?: string | null; tables: MatrixTable[] }): MatrixSchemaDocument {
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name));
  const empreinte = createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
  return { schema: 'matrix.schema/1', app, version, declareLe: new Date().toISOString(), empreinte, tables: sorted };
}

/** Envoie la déclaration à Matrix et/ou l'écrit dans un dossier. Ne lève jamais d'erreur. */
export async function declareSchema({ app, tables, settings, log = console, fetchImpl = fetch }: {
  app: string;
  tables: MatrixTable[];
  settings: MatrixSettings;
  log?: Log;
  fetchImpl?: typeof fetch;
}): Promise<MatrixSchemaDocument> {
  const doc = schemaDocument({ app, version: settings.version, tables });
  try {
    if (settings.declarationsDir) {
      mkdirSync(settings.declarationsDir, { recursive: true });
      writeFileSync(join(settings.declarationsDir, `${app}.json`), JSON.stringify(doc, null, 1));
    }
    if (settings.url) {
      // MATRIX_URL peut contenir un identifiant et un mot de passe (https://user:mdp@matrix.exemple.fr) quand Matrix
      // est protégé par l'authentification HTTP de l'hébergeur : ils partent en Basic, le jeton dans X-Matrix-Token.
      const url = new URL('/api/declarations', settings.url);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (settings.token) headers['x-matrix-token'] = settings.token;
      if (url.username) {
        const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
        headers.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
        url.username = '';
        url.password = '';
      }
      const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(doc), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Matrix a répondu ${res.status} : ${await res.text()}`);
      const r = (await res.json()) as { nouvellesTables?: string[] };
      if (r.nouvellesTables?.length) log.info(`[matrix] nouvelles tables déclarées : ${r.nouvellesTables.join(', ')}`);
    }
  } catch (e) {
    log.warn(`[matrix] déclaration du schéma de ${app} non transmise : ${e instanceof Error ? e.message : String(e)}`);
  }
  return doc;
}

/** Lit le schéma puis le déclare, sans jamais lever d'erreur (appel non attendu depuis l'ouverture de la base). */
export async function declareDatabaseSchema(app: string, query: RowQuery, settings: MatrixSettings, log: Log = console): Promise<void> {
  if (!settings.url && !settings.declarationsDir) return;
  try {
    await declareSchema({ app, tables: await introspectPostgres(query), settings, log });
  } catch (e) {
    log.warn(`[matrix] lecture du schéma de ${app} impossible : ${e instanceof Error ? e.message : String(e)}`);
  }
}
