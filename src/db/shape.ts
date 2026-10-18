// Forme d'une base comparée au dernier instantané de drizzle-kit (npm run db:check, étape 5b). Module sans
// 'server-only' : utilisé par scripts/vigie-db.ts et par src/db/shape.test.ts.
//
// Pourquoi : une migration retouchée à la main (reprise de données, NOT NULL posé après coup, CHECK, DROP COLUMN — cf.
// drizzle/0005_actions_qse.sql) peut s'écarter de l'instantané drizzle/meta/<n>_snapshot.json sans que drizzle-kit le
// voie (il compare schema.ts à l'instantané, jamais au SQL). L'étape 5b applique les migrations à une base vide, lit
// son catalogue et le compare à l'instantané :
//   - colonnes : même ensemble dans les deux sens, NOT NULL identique (information_schema.columns.is_nullable) ;
//   - contraintes CHECK, clés étrangères, contraintes d'unicité et clés primaires composées de l'instantané : présentes
//     dans la base (pg_constraint) ; index de l'instantané : présents (pg_indexes) ;
//   - index de la base : connus de l'instantané (index, contraintes d'unicité, clés primaires composées) ou index de
//     clé primaire « <table>_pkey ».
// Les contraintes de la base absentes de l'instantané (NOT NULL stockés comme contraintes, par exemple) ne sont pas
// signalées : seul le sens instantané ⊆ base est vérifié pour elles.
//
// Seconde comparaison (catalogueMismatches) : une base de référence est construite directement depuis l'instantané (SQL
// d'une installation neuve généré par drizzle-kit/api : generateMigration de l'instantané vide vers le dernier), sur le
// même moteur ; son catalogue détaillé est comparé à celui de la base migrée, dans les deux sens — type (avec précision),
// NOT NULL et valeur par défaut de chaque colonne, définition de chaque contrainte (pg_get_constraintdef : contenu d'un
// CHECK, cible et actions d'une clé étrangère) et de chaque index (pg_get_indexdef). Elle voit ce que les noms seuls ne
// montrent pas : CHECK au contenu faux, DEFAULT oublié, type ou précision changés (aucune fausse alerte sur 0000–0005).

import type { Query } from './migrations';

type Named = { name: string };
/** Table d'un instantané drizzle-kit (version 7), réduite à ce que la comparaison lit. */
export type SnapshotTable = {
  name: string;
  schema?: string;
  columns: Record<string, Named & { notNull?: boolean }>;
  indexes?: Record<string, Named>;
  foreignKeys?: Record<string, Named>;
  compositePrimaryKeys?: Record<string, Named>;
  uniqueConstraints?: Record<string, Named>;
  checkConstraints?: Record<string, Named>;
};
export type ShapeSnapshot = { tables: Record<string, SnapshotTable> };

/** Catalogue du schéma public d'une base (trois requêtes de readCatalogue). */
export type DbCatalogue = {
  columns: { table: string; column: string; nullable: boolean }[];
  constraints: { table: string; name: string; type: string }[];
  indexes: { table: string; name: string }[];
};

/** PostgreSQL tronque les identifiants à 63 octets (NAMEDATALEN − 1) : les noms longs de l'instantané le sont aussi. */
const pgName = (name: string) => {
  const bytes = Buffer.from(name, 'utf8');
  return bytes.length <= 63 ? name : bytes.subarray(0, 63).toString('utf8');
};
const names = (rec: Record<string, Named> | undefined) => Object.values(rec ?? {}).map((x) => pgName(x.name));

const CONSTRAINT_KINDS = [
  ['checkConstraints', 'CHECK'],
  ['foreignKeys', 'clé étrangère'],
  ['uniqueConstraints', 'unicité'],
  ['compositePrimaryKeys', 'clé primaire'],
] as const;

/**
 * Écarts entre la base et l'instantané, une ligne par écart (vide : forme conforme). Règle pure : le catalogue est lu
 * par readCatalogue (ou construit à la main dans les tests).
 */
export function shapeMismatches(snapshot: ShapeSnapshot, db: DbCatalogue): string[] {
  const out: string[] = [];
  const tables = Object.values(snapshot.tables).filter((t) => !t.schema || t.schema === 'public');
  const snapTables = new Set(tables.map((t) => t.name));
  const dbTables = new Set(db.columns.map((c) => c.table));
  for (const t of [...dbTables].sort()) if (!snapTables.has(t)) out.push(`table ${t} présente dans la base, absente du schéma`);

  for (const t of [...tables].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!dbTables.has(t.name)) {
      out.push(`table ${t.name} absente de la base`);
      continue;
    }
    // Colonnes : dans les deux sens, et NOT NULL.
    const dbCols = new Map(db.columns.filter((c) => c.table === t.name).map((c) => [c.column, c]));
    const snapCols = Object.values(t.columns);
    for (const c of snapCols) {
      const got = dbCols.get(c.name);
      if (!got) out.push(`colonne ${t.name}.${c.name} absente de la base`);
      else if (got.nullable && c.notNull) out.push(`${t.name}.${c.name} nullable dans la base, NOT NULL dans le schéma`);
      else if (!got.nullable && !c.notNull) out.push(`${t.name}.${c.name} NOT NULL dans la base, nullable dans le schéma`);
    }
    const snapColNames = new Set(snapCols.map((c) => c.name));
    for (const c of dbCols.keys()) if (!snapColNames.has(c)) out.push(`colonne ${t.name}.${c} présente dans la base, absente du schéma`);

    // Contraintes de l'instantané : présentes dans la base (un seul sens).
    const dbCons = new Set(db.constraints.filter((c) => c.table === t.name).map((c) => c.name));
    for (const [key, label] of CONSTRAINT_KINDS) {
      for (const n of names(t[key])) if (!dbCons.has(n)) out.push(`contrainte ${label} ${n} (table ${t.name}) absente de la base`);
    }

    // Index : ceux de l'instantané présents ; ceux de la base connus de l'instantané (ou index de clé primaire).
    const dbIdx = new Set(db.indexes.filter((i) => i.table === t.name).map((i) => i.name));
    const snapIdx = names(t.indexes);
    for (const n of snapIdx) if (!dbIdx.has(n)) out.push(`index ${n} (table ${t.name}) absent de la base`);
    const known = new Set([...snapIdx, ...names(t.uniqueConstraints), ...names(t.compositePrimaryKeys), pgName(`${t.name}_pkey`)]);
    for (const n of [...dbIdx].sort()) if (!known.has(n)) out.push(`index ${n} (table ${t.name}) présent dans la base, absent du schéma`);
  }
  return out;
}

/**
 * Lit le catalogue d'un schéma (public par défaut ; vigie sur le serveur) : colonnes des tables (les vues pub_ de la
 * migration de partage, absentes des instantanés, et le journal des migrations, dans vigie sur le serveur, sont
 * écartés), contraintes, index ; même requête sur PostgreSQL et PGlite.
 */
export async function readCatalogue(query: Query, schema = 'public'): Promise<DbCatalogue> {
  const col = await query(`select c.table_name, c.column_name, c.is_nullable from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = $1 and c.table_name <> '__drizzle_migrations' order by 1, 2`, [schema]);
  const con = await query(`select c.relname as table_name, k.conname as name, k.contype::text as type
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 order by 1, 2`, [schema]);
  const idx = await query('select tablename, indexname from pg_indexes where schemaname = $1 order by 1, 2', [schema]);
  return {
    columns: col.rows.map((r) => ({ table: String(r.table_name), column: String(r.column_name), nullable: r.is_nullable === 'YES' })),
    constraints: con.rows.map((r) => ({ table: String(r.table_name), name: String(r.name), type: String(r.type) })),
    indexes: idx.rows.map((r) => ({ table: String(r.tablename), name: String(r.indexname) })),
  };
}

// ─── Catalogue détaillé : base migrée contre base construite depuis l'instantané ───

/** Catalogue détaillé du schéma public (readDetailedCatalogue). */
export type DetailedCatalogue = {
  columns: { table: string; column: string; type: string; notNull: boolean; default: string | null }[];
  constraints: { table: string; name: string; definition: string }[];
  indexes: { table: string; name: string; definition: string }[];
};

/** Lit le catalogue détaillé d'un schéma (public par défaut ; tables ordinaires), même requête sur PostgreSQL et PGlite. */
export async function readDetailedCatalogue(query: Query, schema = 'public'): Promise<DetailedCatalogue> {
  const col = await query(`select c.relname as table_name, a.attname as column_name, format_type(a.atttypid, a.atttypmod) as type,
      a.attnotnull as not_null, pg_get_expr(d.adbin, d.adrelid) as default_value
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = $1 and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped order by 1, 2`, [schema]);
  const con = await query(`select c.relname as table_name, k.conname as name, pg_get_constraintdef(k.oid) as definition
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = $1 order by 1, 2`, [schema]);
  const idx = await query('select tablename, indexname, indexdef from pg_indexes where schemaname = $1 order by 1, 2', [schema]);
  return {
    columns: col.rows.map((r) => ({
      table: String(r.table_name), column: String(r.column_name), type: String(r.type), notNull: r.not_null === true || r.not_null === 't',
      default: r.default_value == null ? null : String(r.default_value),
    })),
    constraints: con.rows.map((r) => ({ table: String(r.table_name), name: String(r.name), definition: String(r.definition) })),
    indexes: idx.rows.map((r) => ({ table: String(r.tablename), name: String(r.indexname), definition: String(r.indexdef) })),
  };
}

/** Définition longue ramenée à 160 caractères dans un message. */
const clip = (s: string | null) => (s === null ? '(aucune)' : s.length > 160 ? `${s.slice(0, 159)}…` : s);
/** Deux définitions qui diffèrent : chacune montrée autour de sa première différence (40 caractères avant, 120 en tout). */
const around = (a: string, b: string): [string, string] => {
  if (a.length <= 160 && b.length <= 160) return [a, b];
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const start = Math.max(0, i - 40);
  const cut = (s: string) => `${start ? '…' : ''}${s.slice(start, start + 120)}${s.length > start + 120 ? '…' : ''}`;
  return [cut(a), cut(b)];
};

/**
 * Écarts entre la base migrée et la base de référence construite depuis l'instantané (même moteur), une ligne par écart
 * (vide : conformes). Colonnes (type, NOT NULL, valeur par défaut), contraintes et index (définitions), dans les deux
 * sens. Règle pure : les deux catalogues sont lus par readDetailedCatalogue (ou construits à la main dans les tests).
 */
export function catalogueMismatches(reference: DetailedCatalogue, migrated: DetailedCatalogue): string[] {
  const out: string[] = [];
  const byKey = <T extends { table: string }>(rows: T[], key: (r: T) => string) => new Map(rows.map((r) => [`${r.table}.${key(r)}`, r]));

  const refCols = byKey(reference.columns, (c) => c.column);
  const dbCols = byKey(migrated.columns, (c) => c.column);
  for (const [k, ref] of [...refCols].sort(([a], [b]) => a.localeCompare(b))) {
    const got = dbCols.get(k);
    if (!got) {
      out.push(`colonne ${k} absente de la base`);
      continue;
    }
    if (got.type !== ref.type) out.push(`${k} : type ${got.type} dans la base, ${ref.type} dans le schéma`);
    if (got.notNull !== ref.notNull) out.push(`${k} : ${got.notNull ? 'NOT NULL' : 'nullable'} dans la base, ${ref.notNull ? 'NOT NULL' : 'nullable'} dans le schéma`);
    if (got.default !== ref.default) out.push(`${k} : valeur par défaut ${clip(got.default)} dans la base, ${clip(ref.default)} dans le schéma`);
  }
  for (const k of [...dbCols.keys()].sort()) if (!refCols.has(k)) out.push(`colonne ${k} présente dans la base, absente du schéma`);

  for (const [label, e, refRows, dbRows] of [
    ['contrainte', 'e', reference.constraints, migrated.constraints],
    ['index', '', reference.indexes, migrated.indexes],
  ] as const) {
    const ref = byKey<{ table: string; name: string; definition: string }>([...refRows], (r) => r.name);
    const got = byKey<{ table: string; name: string; definition: string }>([...dbRows], (r) => r.name);
    for (const [k, r] of [...ref].sort(([a], [b]) => a.localeCompare(b))) {
      const g = got.get(k);
      if (!g) out.push(`${label} ${r.name} (table ${r.table}) absent${e} de la base`);
      else if (g.definition !== r.definition) {
        const [inDb, inSchema] = around(g.definition, r.definition);
        out.push(`${label} ${r.name} (table ${r.table}) : ${inDb} dans la base, ${inSchema} dans le schéma`);
      }
    }
    for (const [k, g] of [...got].sort(([a], [b]) => a.localeCompare(b))) {
      if (!ref.has(k)) out.push(`${label} ${g.name} (table ${g.table}) présent${e} dans la base, absent${e} du schéma`);
    }
  }
  return out;
}
