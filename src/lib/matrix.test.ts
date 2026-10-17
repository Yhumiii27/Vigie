import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { declareSchema, introspectPostgres, schemaDocument, type MatrixSettings, type RowQuery } from './matrix';

const none: MatrixSettings = { url: null, token: null, declarationsDir: null, version: null };
const silent = () => ({ info: vi.fn(), warn: vi.fn() });

describe('introspectPostgres', () => {
  let pg: PGlite;
  let query: RowQuery;
  beforeAll(async () => {
    pg = new PGlite('memory://');
    await pg.exec(`
      create table "__drizzle_migrations" (id serial primary key, hash text);
      create type niveau as enum ('bas', 'haut');
      create table sites (id text primary key, code text not null unique, tags text[]);
      create table risques (
        id serial primary key, site_id text references sites(id) on delete cascade,
        niveau niveau not null default 'bas', unique (site_id, niveau));`);
    query = (sql) => pg.query<Record<string, unknown>>(sql).then((r) => r.rows);
  });
  afterAll(() => pg.close());

  it('tables, colonnes, clés, liens et unicités ; journal des migrations exclu', async () => {
    const tables = await introspectPostgres(query);
    expect(tables.map((t) => t.name).sort()).toEqual(['risques', 'sites']);
    const sites = tables.find((t) => t.name === 'sites')!;
    expect(sites.pk).toEqual(['id']);
    expect(sites.uniques).toEqual([['code']]);
    expect(sites.columns).toContainEqual({ name: 'tags', type: 'text[]', nullable: true, pk: false, default: null });
    const risques = tables.find((t) => t.name === 'risques')!;
    expect(risques.columns.find((c) => c.name === 'id')).toMatchObject({ pk: true, type: 'integer', nullable: false });
    expect(risques.columns.find((c) => c.name === 'niveau')).toMatchObject({ type: 'niveau', default: "'bas'::niveau" });
    expect(risques.fks).toEqual([{ columns: ['site_id'], table: 'sites', refColumns: ['id'], onDelete: 'cascade', declared: true }]);
    expect(risques.uniques).toEqual([['site_id', 'niveau']]);
  });
});

describe('declareSchema', () => {
  const tables = [{ name: 'b', columns: [], pk: [], fks: [], uniques: [] }, { name: 'a', columns: [], pk: [], fks: [], uniques: [] }];

  it('document matrix.schema/1 trié, empreinte stable', () => {
    const d1 = schemaDocument({ app: 'vigie', tables });
    const d2 = schemaDocument({ app: 'vigie', tables: [...tables].reverse() });
    expect(d1).toMatchObject({ schema: 'matrix.schema/1', app: 'vigie', version: null });
    expect(d1.tables.map((t) => t.name)).toEqual(['a', 'b']);
    expect(d1.empreinte).toMatch(/^[0-9a-f]{16}$/);
    expect(d2.empreinte).toBe(d1.empreinte);
  });

  it('sans MATRIX_URL : aucun envoi', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await declareSchema({ app: 'vigie', tables, settings: none, fetchImpl, log: silent() });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('jeton en X-Matrix-Token, identifiants de l’URL en Basic et retirés de l’adresse ; copie locale', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vigie-matrix-'));
    try {
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ nouvellesTables: ['a'] }));
      const log = silent();
      await declareSchema({
        app: 'vigie', tables, log, fetchImpl,
        settings: { url: 'https://moi:mot%20de%20passe@matrix.exemple.fr/', token: 'jeton', declarationsDir: dir, version: '1.2.3' },
      });
      const [url, init] = fetchImpl.mock.calls[0];
      expect(String(url)).toBe('https://matrix.exemple.fr/api/declarations');
      const headers = init!.headers as Record<string, string>;
      expect(headers['x-matrix-token']).toBe('jeton');
      expect(headers.authorization).toBe(`Basic ${Buffer.from('moi:mot de passe').toString('base64')}`);
      expect(JSON.parse(String(init!.body))).toMatchObject({ app: 'vigie', version: '1.2.3' });
      expect(log.info).toHaveBeenCalledWith('[matrix] nouvelles tables déclarées : a');
      expect(JSON.parse(readFileSync(join(dir, 'vigie.json'), 'utf8')).schema).toBe('matrix.schema/1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('échec (refus, réseau) : avertissement, jamais d’erreur', async () => {
    const log = silent();
    const settings = { ...none, url: 'http://localhost:1' };
    await declareSchema({ app: 'vigie', tables, settings, log, fetchImpl: async () => new Response('jeton invalide', { status: 401 }) });
    await declareSchema({ app: 'vigie', tables, settings, log, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    expect(log.warn).toHaveBeenNthCalledWith(1, '[matrix] déclaration du schéma de vigie non transmise : Matrix a répondu 401 : jeton invalide');
    expect(log.warn).toHaveBeenNthCalledWith(2, '[matrix] déclaration du schéma de vigie non transmise : ECONNREFUSED');
  });
});
