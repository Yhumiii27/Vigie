import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, readJournal, type Query } from './migrations';
import {
  catalogueMismatches, readCatalogue, readDetailedCatalogue, shapeMismatches, type DbCatalogue, type DetailedCatalogue, type ShapeSnapshot,
} from './shape';

// Étape 5b de npm run db:check (forme de la base = instantané) : règles pures sur des catalogues construits à la main,
// puis sur des bases réelles (migrations 0000–0004 contre 0004_snapshot.json, toutes les migrations contre le dernier
// instantané ; catalogue détaillé contre une base construite depuis l'instantané) — aucune fausse alerte sur les
// migrations publiées, et les retouches à la main fautives de 0005 sont signalées.

const snapshot: ShapeSnapshot = {
  tables: {
    'public.actions': {
      name: 'actions', schema: '',
      columns: { id: { name: 'id', notNull: true }, opened_on: { name: 'opened_on', notNull: true }, note: { name: 'note', notNull: false } },
      indexes: { actions_pilot_idx: { name: 'actions_pilot_idx' } },
      foreignKeys: { actions_pilot_id_people_id_fk: { name: 'actions_pilot_id_people_id_fk' } },
      compositePrimaryKeys: {}, uniqueConstraints: {},
      checkConstraints: { actions_status_check: { name: 'actions_status_check' } },
    },
    'public.risk_actions': {
      name: 'risk_actions', schema: '',
      columns: { risk_id: { name: 'risk_id', notNull: true }, action_id: { name: 'action_id', notNull: true } },
      indexes: {}, foreignKeys: {},
      compositePrimaryKeys: { risk_actions_risk_id_action_id_pk: { name: 'risk_actions_risk_id_action_id_pk' } },
      uniqueConstraints: {}, checkConstraints: {},
    },
  },
};

const catalogue = (): DbCatalogue => ({
  columns: [
    { table: 'actions', column: 'id', nullable: false },
    { table: 'actions', column: 'opened_on', nullable: false },
    { table: 'actions', column: 'note', nullable: true },
    { table: 'risk_actions', column: 'risk_id', nullable: false },
    { table: 'risk_actions', column: 'action_id', nullable: false },
  ],
  constraints: [
    { table: 'actions', name: 'actions_pkey', type: 'p' },
    { table: 'actions', name: 'actions_pilot_id_people_id_fk', type: 'f' },
    { table: 'actions', name: 'actions_status_check', type: 'c' },
    { table: 'actions', name: 'actions_id_not_null', type: 'n' }, // PostgreSQL 18 : NOT NULL stockés comme contraintes
    { table: 'risk_actions', name: 'risk_actions_risk_id_action_id_pk', type: 'p' },
  ],
  indexes: [
    { table: 'actions', name: 'actions_pkey' },
    { table: 'actions', name: 'actions_pilot_idx' },
    { table: 'risk_actions', name: 'risk_actions_risk_id_action_id_pk' },
  ],
});

describe('shapeMismatches (catalogues construits)', () => {
  it('base conforme : aucun écart (clé primaire composée et index « _pkey » admis)', () => {
    expect(shapeMismatches(snapshot, catalogue())).toEqual([]);
  });

  it('NOT NULL différent, dans les deux sens', () => {
    const db = catalogue();
    db.columns[1].nullable = true;
    db.columns[2].nullable = false;
    expect(shapeMismatches(snapshot, db)).toEqual([
      'actions.opened_on nullable dans la base, NOT NULL dans le schéma',
      'actions.note NOT NULL dans la base, nullable dans le schéma',
    ]);
  });

  it('colonne manquante ou en trop', () => {
    const db = catalogue();
    db.columns = db.columns.filter((c) => c.column !== 'note');
    db.columns.push({ table: 'actions', column: 'title', nullable: false });
    expect(shapeMismatches(snapshot, db)).toEqual([
      'colonne actions.note absente de la base',
      'colonne actions.title présente dans la base, absente du schéma',
    ]);
  });

  it('CHECK, clé étrangère ou clé primaire composée manquante', () => {
    const db = catalogue();
    db.constraints = db.constraints.filter((c) => c.type === 'n' || c.name === 'actions_pkey');
    expect(shapeMismatches(snapshot, db)).toEqual([
      'contrainte CHECK actions_status_check (table actions) absente de la base',
      'contrainte clé étrangère actions_pilot_id_people_id_fk (table actions) absente de la base',
      'contrainte clé primaire risk_actions_risk_id_action_id_pk (table risk_actions) absente de la base',
    ]);
  });

  it('contrainte de la base absente de l\'instantané : non signalée (un seul sens)', () => {
    const db = catalogue();
    db.constraints.push({ table: 'actions', name: 'actions_extra_check', type: 'c' });
    expect(shapeMismatches(snapshot, db)).toEqual([]);
  });

  it('index manquant ou inconnu de l\'instantané', () => {
    const db = catalogue();
    db.indexes = db.indexes.filter((i) => i.name !== 'actions_pilot_idx');
    db.indexes.push({ table: 'actions', name: 'actions_old_idx' });
    expect(shapeMismatches(snapshot, db)).toEqual([
      'index actions_pilot_idx (table actions) absent de la base',
      'index actions_old_idx (table actions) présent dans la base, absent du schéma',
    ]);
  });

  it('table manquante ou en trop', () => {
    const db = catalogue();
    db.columns = db.columns.filter((c) => c.table !== 'risk_actions');
    db.columns.push({ table: 'legacy', column: 'id', nullable: false });
    expect(shapeMismatches(snapshot, db)).toEqual(['table legacy présente dans la base, absente du schéma', 'table risk_actions absente de la base']);
  });

  it('noms de plus de 63 octets comparés tronqués, comme PostgreSQL', () => {
    const long = `actions_${'x'.repeat(70)}_fk`;
    const snap: ShapeSnapshot = { tables: { a: { ...snapshot.tables['public.actions'], foreignKeys: { [long]: { name: long } } } } };
    const db = catalogue();
    db.columns = db.columns.filter((c) => c.table === 'actions');
    db.constraints.push({ table: 'actions', name: long.slice(0, 63), type: 'f' });
    expect(shapeMismatches(snap, db)).toEqual([]);
  });
});

/**
 * Base PGlite en mémoire migrée jusqu'à la migration n (journal tronqué, comme test/fixtures/legacy-base.ts) ; `edit`
 * retouche le SQL d'une migration de la copie (oubli simulé d'une retouche à la main).
 */
async function migratedTo(n: number, edit?: { tag: string; sql: (text: string) => string }): Promise<{ query: Query; close: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'vigie-shape-'));
  const copy = path.join(dir, 'drizzle');
  await cp(MIGRATIONS_DIR, copy, { recursive: true });
  const journalFile = path.join(copy, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalFile, 'utf8'));
  journal.entries = journal.entries.slice(0, n);
  await writeFile(journalFile, JSON.stringify(journal));
  if (edit) {
    const file = path.join(copy, `${edit.tag}.sql`);
    await writeFile(file, edit.sql(await readFile(file, 'utf8')));
  }
  const client = new PGlite('memory://');
  await migrate(drizzle(client), { migrationsFolder: copy });
  return {
    query: (q, p) => client.query(q, p as unknown[]) as Promise<{ rows: Record<string, unknown>[] }>,
    close: async () => { await client.close(); await rm(dir, { recursive: true, force: true }); },
  };
}

const readSnapshot = async (tag: string) => JSON.parse(await readFile(path.join(MIGRATIONS_DIR, 'meta', `${tag.split('_')[0]}_snapshot.json`), 'utf8')) as ShapeSnapshot;

describe('shapeMismatches (bases réelles)', () => {
  it('migrations 0000–0004 : conformes à 0004_snapshot.json (aucune fausse alerte)', async () => {
    const base = await migratedTo(5);
    try {
      expect(shapeMismatches(await readSnapshot('0004_compliance'), await readCatalogue(base.query))).toEqual([]);
    } finally {
      await base.close();
    }
  });

  it('0005 : un SET NOT NULL ou un DROP COLUMN oublié dans les retouches à la main est signalé', async () => {
    const tag = '0005_actions_qse';
    const drop = (sql: string, statement: string) => {
      const chunks = sql.split('--> statement-breakpoint');
      const kept = chunks.filter((c) => !c.includes(statement));
      expect(kept).toHaveLength(chunks.length - 1);
      return kept.join('--> statement-breakpoint');
    };
    const index = readJournal().findIndex((e) => e.tag === tag);
    expect(index).toBe(5);
    const base = await migratedTo(index + 1, {
      tag,
      sql: (sql) => drop(drop(sql, 'ALTER COLUMN "detail" SET NOT NULL'), 'DROP COLUMN "kind"'),
    });
    try {
      expect(shapeMismatches(await readSnapshot(tag), await readCatalogue(base.query))).toEqual([
        'actions.detail nullable dans la base, NOT NULL dans le schéma',
        'colonne actions.kind présente dans la base, absente du schéma',
      ]);
    } finally {
      await base.close();
    }
  });

  it('toutes les migrations : conformes au dernier instantané', async () => {
    const journal = readJournal();
    const base = await migratedTo(journal.length);
    try {
      expect(shapeMismatches(await readSnapshot(journal.at(-1)!.tag), await readCatalogue(base.query))).toEqual([]);
    } finally {
      await base.close();
    }
  });
});

// ─── Catalogue détaillé : base migrée contre base construite depuis l'instantané ───

const detailed = (): DetailedCatalogue => ({
  columns: [
    { table: 'actions', column: 'id', type: 'text', notNull: true, default: null },
    { table: 'actions', column: 'status', type: 'text', notNull: true, default: "'a_faire'::text" },
    { table: 'actions', column: 'hours', type: 'numeric(7,2)', notNull: false, default: null },
  ],
  constraints: [
    { table: 'actions', name: 'actions_pkey', definition: 'PRIMARY KEY (id)' },
    { table: 'actions', name: 'actions_status_check', definition: "CHECK ((status = ANY (ARRAY['a_faire'::text, 'terminee'::text])))" },
  ],
  indexes: [{ table: 'actions', name: 'actions_pkey', definition: 'CREATE UNIQUE INDEX actions_pkey ON public.actions USING btree (id)' }],
});

describe('catalogueMismatches (catalogues construits)', () => {
  it('catalogues identiques : aucun écart', () => {
    expect(catalogueMismatches(detailed(), detailed())).toEqual([]);
  });

  it('type, NOT NULL et valeur par défaut d\'une colonne', () => {
    const db = detailed();
    db.columns[1] = { ...db.columns[1], default: null, notNull: false };
    db.columns[2] = { ...db.columns[2], type: 'numeric(9,4)' };
    expect(catalogueMismatches(detailed(), db)).toEqual([
      'actions.hours : type numeric(9,4) dans la base, numeric(7,2) dans le schéma',
      'actions.status : nullable dans la base, NOT NULL dans le schéma',
      "actions.status : valeur par défaut (aucune) dans la base, 'a_faire'::text dans le schéma",
    ]);
  });

  it('contenu d\'un CHECK, index différent, éléments en trop ou manquants (les deux sens)', () => {
    const db = detailed();
    db.constraints[1] = { ...db.constraints[1], definition: "CHECK ((status = ANY (ARRAY['a_faire'::text])))" };
    db.columns.push({ table: 'actions', column: 'kind', type: 'text', notNull: false, default: null });
    db.indexes.push({ table: 'actions', name: 'actions_old_idx', definition: 'CREATE INDEX actions_old_idx ON public.actions USING btree (kind)' });
    const ref = detailed();
    ref.constraints.push({ table: 'actions', name: 'actions_hours_check', definition: 'CHECK ((hours >= (0)::numeric))' });
    expect(catalogueMismatches(ref, db)).toEqual([
      'colonne actions.kind présente dans la base, absente du schéma',
      'contrainte actions_hours_check (table actions) absente de la base',
      "contrainte actions_status_check (table actions) : CHECK ((status = ANY (ARRAY['a_faire'::text]))) dans la base, CHECK ((status = ANY (ARRAY['a_faire'::text, 'terminee'::text]))) dans le schéma",
      'index actions_old_idx (table actions) présent dans la base, absent du schéma',
    ]);
  });
});

/** Base de référence : SQL d'une installation neuve généré depuis l'instantané (drizzle-kit/api, comme db:check). */
async function referenceCatalogue(tag: string): Promise<DetailedCatalogue> {
  const api = await import('drizzle-kit/api');
  const statements = await api.generateMigration(await api.generateDrizzleJson({}), (await readSnapshot(tag)) as never);
  const client = new PGlite('memory://');
  try {
    for (const statement of statements) await client.exec(statement);
    return await readDetailedCatalogue((q, p) => client.query(q, p as unknown[]) as Promise<{ rows: Record<string, unknown>[] }>);
  } finally {
    await client.close();
  }
}

describe('catalogueMismatches (bases réelles)', () => {
  it('0000–0004 puis toutes les migrations : identiques à la base construite depuis l\'instantané', async () => {
    for (const n of [5, readJournal().length]) {
      const tag = readJournal()[n - 1].tag;
      const base = await migratedTo(n);
      try {
        expect(catalogueMismatches(await referenceCatalogue(tag), await readDetailedCatalogue(base.query))).toEqual([]);
      } finally {
        await base.close();
      }
    }
  });

  it('0005 retouchée à tort : CHECK des sources incomplet, DEFAULT oublié, précision changée — signalés', async () => {
    const tag = '0005_actions_qse';
    const index = readJournal().findIndex((e) => e.tag === tag);
    const replace = (sql: string, from: string, to: string) => {
      expect(sql.split(from)).toHaveLength(2);
      return sql.replace(from, to);
    };
    const base = await migratedTo(index + 1, {
      tag,
      sql: (sql) => {
        let out = replace(sql, "'audit_fournisseur', ", '');
        out = replace(out, "'dechets', ", '');
        out = replace(out, 'ALTER TABLE "actions" ALTER COLUMN "status" SET DEFAULT \'a_faire\';', 'SELECT 1;');
        return replace(out, '"hours" numeric(7, 2)', '"hours" numeric(9, 4)');
      },
    });
    try {
      // Les noms seuls (shapeMismatches) ne voient rien ; le catalogue détaillé voit les trois écarts.
      expect(shapeMismatches(await readSnapshot(tag), await readCatalogue(base.query))).toEqual([]);
      const drift = catalogueMismatches(await referenceCatalogue(tag), await readDetailedCatalogue(base.query));
      expect(drift).toHaveLength(3);
      expect(drift[0]).toBe('actions.hours : type numeric(9,4) dans la base, numeric(7,2) dans le schéma');
      expect(drift[1]).toBe("actions.status : valeur par défaut (aucune) dans la base, 'a_faire'::text dans le schéma");
      expect(drift[2]).toMatch(/^contrainte actions_source_check \(table actions\) : ….*'audit_interne'::text.* dans la base, ….*'audit_fournisseur'::text.* dans le schéma$/);
    } finally {
      await base.close();
    }
  });
});
