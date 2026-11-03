import '../next-mocks';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { freshDemoDatabase } from '../helpers';
import { getDb } from '@/db';

// Décision M-18 de Matrix (01/11/2026, `docs/architecture-postgres.md` § 8 septies du dépôt Matrix) : Matrix définit et
// possède les vues `pub_` du schéma vigie ; Vigie n'en crée plus dans ses migrations et tient les colonnes qu'elles
// publient. Sur le serveur commun, une migration qui change le type d'une colonne lue par une vue `pub_`, la supprime ou
// la renomme (ou supprime ou renomme sa table) échoue (dépendance de la vue) — alors qu'elle passe en CI, où les vues de
// Matrix n'existent pas. Ce garde-fou le détecte avant : colonnes publiées = colonnes lues par les vues `pub_` des
// migrations publiées et par les requêtes de référence des publications demandées à Matrix (docs/specs).

freshDemoDatabase();

/** Dernière migration qui a encore créé des vues `pub_` (avant M-18) ; toute migration suivante n'en crée plus. */
const LAST_MIGRATION_WITH_VIEWS = 23;

/** Requêtes de référence des publications définies par Matrix sur les tables de Vigie (bloc entre les marqueurs). */
const REFERENCE_QUERIES: { view: string; doc: string }[] = [
  { view: 'pub_etudes_securite', doc: 'docs/specs/etudes-securite.md' },
];

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => ((await (await getDb()).execute(q)) as unknown as { rows: Row[] }).rows;

const journal = (JSON.parse(readFileSync(path.join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8')) as {
  entries: { idx: number; tag: string }[];
}).entries;
const migrationSql = (tag: string) => readFileSync(path.join(process.cwd(), 'drizzle', `${tag}.sql`), 'utf8');

function referenceQuery(doc: string) {
  const text = readFileSync(path.join(process.cwd(), doc), 'utf8');
  const block = /<!-- requete-reference:debut -->\s*```sql\n([\s\S]*?)```\s*<!-- requete-reference:fin -->/.exec(text);
  if (!block) throw new Error(`Requête de référence introuvable dans ${doc}`);
  return block[1].trim();
}

type Change = { table: string; column: string | null; what: string };

/**
 * Changements d'une migration qui cassent une vue dépendante : colonne supprimée, renommée ou de type changé ; table
 * supprimée ou renommée (column = null). Forme des migrations de drizzle-kit (noms entre guillemets, `"public".` facultatif).
 */
function breakingChanges(text: string): Change[] {
  const out: Change[] = [];
  const name = String.raw`(?:"public"\.)?"([^"]+)"`;
  for (const raw of text.split(/--> statement-breakpoint|;\s*\n/)) {
    const st = raw.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
    let m = new RegExp(String.raw`^ALTER TABLE ${name} (.*)$`, 'i').exec(st);
    if (m) {
      const [, table, rest] = m;
      for (const [re, what] of [
        [/DROP COLUMN (?:IF EXISTS )?"([^"]+)"/gi, 'colonne supprimée'],
        [/ALTER COLUMN "([^"]+)" (?:SET DATA )?TYPE/gi, 'type de colonne changé'],
        [/RENAME COLUMN "([^"]+)"/gi, 'colonne renommée'],
      ] as const) {
        for (const c of rest.matchAll(re)) out.push({ table, column: c[1], what });
      }
      if (/^RENAME TO /i.test(rest)) out.push({ table, column: null, what: 'table renommée' });
      continue;
    }
    m = new RegExp(String.raw`^DROP TABLE (?:IF EXISTS )?${name}`, 'i').exec(st);
    if (m) out.push({ table: m[1], column: null, what: 'table supprimée' });
  }
  return out;
}

describe('décision M-18 : vues pub_ définies par Matrix', () => {
  it('le repérage des changements cassants reconnaît les formes de drizzle-kit', () => {
    expect(breakingChanges([
      'ALTER TABLE "actions" DROP COLUMN "due_on";--> statement-breakpoint',
      'ALTER TABLE "public"."events" ALTER COLUMN "title" SET DATA TYPE varchar(200);--> statement-breakpoint',
      'ALTER TABLE "sites" RENAME COLUMN "label" TO "name";--> statement-breakpoint',
      'ALTER TABLE "controls" RENAME TO "checks";--> statement-breakpoint',
      'DROP TABLE "change_log" CASCADE;--> statement-breakpoint',
      'ALTER TABLE "actions" ADD COLUMN "x" text;--> statement-breakpoint',
      'ALTER TABLE "actions" ALTER COLUMN "x" SET DEFAULT 1;',
    ].join('\n'))).toEqual([
      { table: 'actions', column: 'due_on', what: 'colonne supprimée' },
      { table: 'events', column: 'title', what: 'type de colonne changé' },
      { table: 'sites', column: 'label', what: 'colonne renommée' },
      { table: 'controls', column: null, what: 'table renommée' },
      { table: 'change_log', column: null, what: 'table supprimée' },
    ]);
  });

  it(`aucune migration après la ${String(LAST_MIGRATION_WITH_VIEWS).padStart(4, '0')} ne crée, remplace ni supprime de vue pub_`, () => {
    const later = journal.filter((e) => e.idx > LAST_MIGRATION_WITH_VIEWS);
    const offending = later.filter((e) => /\bVIEW\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?pub_/i.test(migrationSql(e.tag)));
    expect(offending.map((e) => e.tag), 'vue pub_ dans une migration : à demander à Matrix (écran « Publications »)').toEqual([]);
  });

  it('aucune migration après la décision ne casse une colonne publiée (vues pub_ et requêtes de référence)', async () => {
    const db = await getDb();
    // Requêtes de référence : vues temporaires de la session, le temps de lire leurs dépendances.
    for (const { view, doc } of REFERENCE_QUERIES) await db.execute(sql.raw(`create temporary view ${view} as ${referenceQuery(doc)}`));
    try {
      // Vues du schéma de Vigie seulement (substituts de démonstration des vues des autres outils exclus, lot 0 de M-02).
      const used = await rows(sql`select distinct u.view_name, u.table_name, u.column_name from information_schema.view_column_usage u
        where u.view_name like 'pub\_%' and u.view_schema in (current_schema(), pg_my_temp_schema()::regnamespace::text) order by 1, 2, 3`);
      const published = new Set(used.map((r) => `${r.table_name}.${r.column_name}`));
      const tables = new Set(used.map((r) => String(r.table_name)));
      // Les vues des migrations et la requête des études sont bien vues (sinon le garde-fou ne garderait rien).
      expect([...new Set(used.map((r) => String(r.view_name)))].sort()).toEqual(
        ['pub_controles', 'pub_etudes_securite', 'pub_hse_projet', 'pub_journal', 'pub_non_conformites'],
      );
      expect(published.has('process_safety_studies.capex_code')).toBe(true);
      expect(published.has('actions.safety_study_blocking')).toBe(true);
      const problems = journal.filter((e) => e.idx > LAST_MIGRATION_WITH_VIEWS).flatMap((e) =>
        breakingChanges(migrationSql(e.tag))
          .filter((c) => (c.column ? published.has(`${c.table}.${c.column}`) : tables.has(c.table)))
          .map((c) => `${e.tag} : ${c.what} ${c.column ? `${c.table}.${c.column}` : c.table}`));
      expect(problems, 'colonne lue par une vue pub_ : demander d’abord à Matrix de faire évoluer la publication').toEqual([]);
    } finally {
      for (const { view } of REFERENCE_QUERIES) await db.execute(sql.raw(`drop view if exists ${view}`));
    }
  });
});
