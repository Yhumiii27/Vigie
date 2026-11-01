import { PGlite } from '@electric-sql/pglite';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DB_LAYOUT, MIGRATIONS_DIR, SERVER_SCHEMA, hasLegacyServerLayout, migrateServer, migrationState, readJournal, refuseNewerDatabase, toServerSchema, type Query,
} from '@/db/migrations';
import * as schema from '@/db/schema';
import { HEALTH_FIELDS } from '@/lib/rules/events';
import { HEALTH_EVENT_TYPES } from '@/lib/domain';
import { closeDb, getDb } from '@/db';
import { resetConfig } from '@/lib/env';
import { introspectPostgres } from '@/lib/matrix';

// Disposition du serveur commun EPC2I (décision du 18/10/2026) : migrations publiées intactes, réécrites au moment de les
// appliquer ("public". → "vigie.") par migrateServer, journal vigie.__drizzle_migrations, search_path vigie. Essayé ici
// sur PGlite (schéma vigie créé à la main, comme le socle du serveur) ; sur PostgreSQL : test/setup-postgres.ts et
// l'ouverture de la base (src/db/index.ts) dans tous les fichiers de test/integration avec TEST_DATABASE_URL.

const journal = readJournal();
/** Tables déclarées dans src/db/schema.ts. */
const TABLES = (Object.values(schema) as unknown[]).filter((x): x is PgTable => is(x, PgTable)).map((t) => getTableConfig(t).name).sort();
let pg: PGlite;
const query = (): Query => (q, p) => pg.query(q, p) as Promise<{ rows: Record<string, unknown>[] }>;

beforeAll(async () => {
  pg = new PGlite('memory://');
  await pg.exec(`create schema ${SERVER_SCHEMA}; set search_path to ${SERVER_SCHEMA}`);
});
afterAll(async () => {
  await pg.close();
});

describe('réécriture des migrations pour le serveur', () => {
  it('seul l’identifiant qualifié "public". est remplacé', () => {
    expect(toServerSchema('ALTER TABLE "a" ADD CONSTRAINT "f" FOREIGN KEY ("s") REFERENCES "public"."sites"("id")'))
      .toBe('ALTER TABLE "a" ADD CONSTRAINT "f" FOREIGN KEY ("s") REFERENCES "vigie"."sites"("id")');
    // Texte, nom de colonne ou de schéma sans point : inchangés.
    expect(toServerSchema(`COMMENT ON TABLE "x" IS 'public'; SELECT "public" FROM t; SELECT 'x."public".y'`))
      .toBe(`COMMENT ON TABLE "x" IS 'public'; SELECT "public" FROM t; SELECT 'x."vigie".y'`);
  });

  it('migrations appliquées dans vigie, journal dans vigie, rien dans public ; deuxième passage sans effet', async () => {
    expect(await migrateServer(query())).toBe(journal.length);
    expect(await migrateServer(query())).toBe(0);
    const state = await migrationState(query(), 'postgres');
    expect(state).toMatchObject({ applied: journal.length, pending: [], newer: false, last: journal.at(-1)!.tag });
    await expect(refuseNewerDatabase(query(), 'postgres')).resolves.toBeUndefined();
    const tables = (await pg.query<{ schemaname: string; n: number }>('select schemaname, count(*)::int as n from pg_tables where schemaname in ($1, $2, $3) group by 1 order by 1',
      ['public', 'drizzle', SERVER_SCHEMA])).rows;
    expect(tables).toEqual([{ schemaname: SERVER_SCHEMA, n: TABLES.length + 1 }]);
    expect((await pg.query(`select to_regclass('${DB_LAYOUT.postgres.journal}') is not null as t`)).rows).toEqual([{ t: true }]);
    // Clés étrangères : aucune vers un autre schéma.
    const cross = await pg.query(`select k.conname from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class r on r.oid = k.confrelid
      where c.relnamespace <> r.relnamespace`);
    expect(cross.rows).toEqual([]);
  });

  it('déclaration à Matrix : tables du schéma courant (vigie), sans le journal ni les vues', async () => {
    const tables = await introspectPostgres((q) => pg.query<Record<string, unknown>>(q).then((r) => r.rows));
    expect(tables.map((t) => t.name).sort()).toEqual(TABLES);
  });

  it('vues pub_ : dans vigie, jamais une donnée de santé', async () => {
    const views = (await pg.query<{ v: string }>('select table_name as v from information_schema.views where table_schema = $1 order by 1', [SERVER_SCHEMA])).rows.map((r) => r.v);
    // pub_controles : contrôles périodiques publiés pour Crucible (migration 0014, contrat Crucible v1).
    expect(views).toEqual(['pub_controles', 'pub_hse_projet', 'pub_journal', 'pub_non_conformites']);
    const used = (await pg.query<{ view_name: string; table_name: string; column_name: string }>(`select view_name, table_name, column_name
      from information_schema.view_column_usage where view_schema = $1 and view_name like 'pub\\_%'`, [SERVER_SCHEMA])).rows;
    const health = new Set(HEALTH_FIELDS.map((f) => schema.events[f].name));
    expect(health.has('injury') && health.has('lost_days')).toBe(true);
    expect(used.filter((u) => u.table_name === 'events' && health.has(u.column_name))).toEqual([]);
    // Ni registre des accidents bénins, ni journal des consultations, ni pièces jointes ; du journal, ni motif ni détail.
    expect(used.filter((u) => ['benign_accidents', 'access_log', 'attachments'].includes(u.table_name))).toEqual([]);
    expect(used.filter((u) => u.table_name === 'change_log' && ['reason', 'details'].includes(u.column_name))).toEqual([]);
    // Journal : ni accident du travail ni événement réservé aux données de santé (maladie professionnelle, 0010).
    const journalDef = (await pg.query<{ d: string }>(`select pg_get_viewdef('${SERVER_SCHEMA}.pub_journal'::regclass) as d`)).rows[0].d;
    for (const type of ['AT', ...HEALTH_EVENT_TYPES]) expect(journalDef).toContain(`'${type}'`);
    // Registre HSE de projet : un AT ou une MP ne fait pas apparaître un projet (É13, migration 0013).
    const hseDef = (await pg.query<{ d: string }>(`select pg_get_viewdef('${SERVER_SCHEMA}.pub_hse_projet'::regclass) as d`)).rows[0].d;
    for (const type of ['AT', ...HEALTH_EVENT_TYPES]) expect(hseDef).toContain(`'${type}'`);
    // Vues créées par le propriétaire du schéma, avec security_barrier.
    const opts = (await pg.query<{ relname: string; reloptions: string[] }>(`select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = $1 and c.relkind = 'v' order by 1`, [SERVER_SCHEMA])).rows;
    for (const o of opts) expect(o.reloptions).toContain('security_barrier=true');
  });
});

describe('base PostgreSQL d’une version antérieure (tables dans public)', () => {
  it('reconnue : journal drizzle.__drizzle_migrations sans journal vigie', async () => {
    const old = new PGlite('memory://');
    try {
      const q: Query = (s, p) => old.query(s, p) as Promise<{ rows: Record<string, unknown>[] }>;
      expect(await hasLegacyServerLayout(q)).toBe(false);
      await migrate(drizzle(old), { migrationsFolder: MIGRATIONS_DIR });
      expect(await hasLegacyServerLayout(q)).toBe(true);
      // Même base migrée ensuite dans vigie (essai, PGlite) : plus considérée comme ancienne.
      await old.exec(`create schema ${SERVER_SCHEMA}; set search_path to ${SERVER_SCHEMA}`);
      await migrateServer(q);
      expect(await hasLegacyServerLayout(q)).toBe(false);
    } finally {
      await old.close();
    }
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('ouverture sur PostgreSQL', () => {
  it('base d’une version antérieure (public, journal drizzle) : refusée, rien n’est créé dans vigie', async () => {
    const { Client } = await import('pg');
    const { drizzle: pgDrizzle } = await import('drizzle-orm/node-postgres');
    const { migrate: pgMigrate } = await import('drizzle-orm/node-postgres/migrator');
    const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'vigie-tests' });
    await client.connect();
    const demo = process.env.VIGIE_DEMO;
    try {
      // Disposition d'avant (migrate() de Drizzle dans public). Le search_path par défaut ("$user", public) viserait le
      // schéma vigie quand le rôle s'appelle vigie (service PostgreSQL de la CI) : public est donc fixé explicitement.
      await client.query('set search_path to public');
      await pgMigrate(pgDrizzle(client), { migrationsFolder: MIGRATIONS_DIR });
      process.env.VIGIE_DEMO = '1';
      resetConfig();
      await closeDb();
      await expect(getDb()).rejects.toThrow(/version antérieure de Vigie.*schéma vigie/);
      expect((await client.query('select count(*)::int as n from pg_tables where schemaname = $1', [SERVER_SCHEMA])).rows[0].n).toBe(0);
      // Verrous de cette base seulement : les autres fichiers de test, en parallèle sur leur propre base, en prennent aussi.
      expect((await client.query(`select count(*)::int as n from pg_locks where locktype = 'advisory' and granted
        and database = (select oid from pg_database where datname = current_database())`)).rows[0].n).toBe(0);
    } finally {
      if (demo === undefined) delete process.env.VIGIE_DEMO;
      else process.env.VIGIE_DEMO = demo;
      resetConfig();
      await client.end();
    }
  });
});
