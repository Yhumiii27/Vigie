import '../next-mocks';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { getDb, schema as t } from '@/db';
import { FOREIGN_CONTRACTS, type ForeignSourceKey } from '@/db/foreign';
import { installForeignSubstitutes, substituteTable } from '@/db/foreign-substitutes';
import { SOURCES } from '@/lib/foreign/labels';
import { refreshSharedReferences } from '@/server/foreign-sync';

// Lot 0 de la convergence M-02 (docs/specs/convergence-m02.md § 2) et lots D14, D02, D04, D16 : substituts des vues des
// autres outils (même forme que les contrats publiés), garde-fou « seul src/lib/foreign lit un autre schéma »,
// rafraîchissement des caches (sites, affectations) et journal sync_runs (ok, indisponible, erreur), suivi d'un site de
// Matrix, choix d'un projet et d'un fournisseur contrôlés contre les vues.

freshDemoDatabase();

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => ((await (await getDb()).execute(q)) as unknown as { rows: Row[] }).rows;
const exec = async (q: string) => (await getDb()).execute(sql.raw(q));
const reinstall = async () => installForeignSubstitutes(await getDb(), { engine: 'pglite', demo: true });
const lastRun = async (key: ForeignSourceKey) =>
  (await (await getDb()).select().from(t.syncRuns).where(eq(t.syncRuns.source, SOURCES[key].view)).orderBy(sql`${t.syncRuns.id} desc`).limit(1))[0];

describe('contrats des vues lues et substituts de démonstration', () => {
  it('chaque substitut a les colonnes, types et ordre du contrat figé (test/fixtures/contracts)', async () => {
    for (const [key, c] of Object.entries(FOREIGN_CONTRACTS)) {
      const fixture = JSON.parse(readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'contracts', `${c.schema}.${c.view}.json`), 'utf8')) as { columns: [string, string][]; readers: string[] };
      expect(c.columns, key).toEqual(fixture.columns);
      expect(fixture.readers).toContain('vigie_app');
      const actual = await rows(sql`select a.attname as name, format_type(a.atttypid, a.atttypmod) as type
        from pg_attribute a join pg_class r on r.oid = a.attrelid join pg_namespace n on n.oid = r.relnamespace
        where n.nspname = ${c.schema} and r.relname = ${c.view} and a.attnum > 0 and not a.attisdropped order by a.attnum`);
      expect(actual.map((r) => [r.name, r.type]), `${c.schema}.${c.view}`).toEqual(fixture.columns);
    }
  });

  it('les substituts sont repérés et recréés ; un schéma qui n’en est pas un n’est jamais touché', async () => {
    await exec(`insert into keystone.${substituteTable('pub_fournisseurs')} (id, name, is_internal) values ('5f000000-0000-4000-8000-0000000000ff', 'Ajout de test', false)`);
    expect(await reinstall()).toEqual(['matrix', 'keystone', 'cursus']);
    expect(await rows(sql`select 1 from keystone.pub_fournisseurs where name = 'Ajout de test'`)).toEqual([]);
    await exec('create schema autre_outil');
    await exec("comment on schema autre_outil is 'Schéma d''un autre outil'");
    expect((await rows(sql`select obj_description('autre_outil'::regnamespace, 'pg_namespace') as c`))[0].c).toBe("Schéma d'un autre outil");
    await exec('drop schema autre_outil');
  });

  it('garde-fou : aucun autre fichier de Vigie ne nomme un schéma d’un autre outil (lecture par src/lib/foreign seulement)', () => {
    const allowed = new Set(['src/db/foreign.ts', 'src/db/foreign-substitutes.ts', 'src/db/seeds/foreign.ts', 'src/lib/foreign/labels.ts']);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|sql)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(path.relative(process.cwd(), full));
      }
    };
    walk(path.join(process.cwd(), 'src'));
    walk(path.join(process.cwd(), 'drizzle'));
    const offending = files.filter((f) => !allowed.has(f) && !f.startsWith('src/lib/foreign/')).filter((f) => {
      // Commentaires retirés (SQL « -- », COMMENT ON ; TS « // », « /* */ ») : seul le code compte.
      const text = readFileSync(path.join(process.cwd(), f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/--[^\n]*/g, ' ').replace(/COMMENT ON[^;]*;/gi, ' ');
      return /pgSchema\(|\b(?:matrix|keystone|cursus|codex)\."?pub_\w+|"(?:matrix|keystone|cursus|codex)"\./.test(text);
    });
    expect(offending).toEqual([]);
  });
});

describe('rafraîchissement des caches (sync_runs)', () => {
  it('à l’ouverture : une ligne « ok » par source, état des sites lu dans Matrix, affectation de [T. Nguyen] en cache', async () => {
    for (const key of Object.keys(FOREIGN_CONTRACTS) as ForeignSourceKey[]) expect(await lastRun(key), key).toMatchObject({ status: 'ok' });
    const db = await getDb();
    const states = await db.select({ id: t.sites.id, matrixState: t.sites.matrixState }).from(t.sites).orderBy(t.sites.id);
    expect(states).toEqual([{ id: 'site_a', matrixState: 'actif' }, { id: 'site_b', matrixState: 'actif' }, { id: 'site_c', matrixState: 'ferme' }]);
    const assignments = await db.select().from(t.keystoneAssignments);
    // La rotation finie il y a plus d'un an n'est pas reprise.
    expect(assignments).toEqual([expect.objectContaining({
      personId: 'tnguyen', project: 'K-2025-042 · [Client A]', activity: 'Mise en service', source: 'planning', projectCode: 'K-2025-042',
      affectationId: 'af000000-0000-4000-8000-000000000001',
    })]);
    // Premier état « actif » lu : rien au journal du site ; aucun signal de site fermé (site_c est archivé).
    expect((await changeLog('site', 'site_a')).filter((l) => l.action === 'sync')).toEqual([]);
  });

  it('libellé, ordre et fermeture repris de Matrix, journalisés sans auteur ; signal « fermé dans Matrix » au QHSE', async () => {
    await exec(`update matrix.${substituteTable('pub_sites')} set libelle = 'Site de [Ville B] — essais et logistique', ordre = 5, actif = false where code = 'site_b'`);
    const results = await refreshSharedReferences(await getDb());
    expect(results.find((r) => r.source === 'sites')).toMatchObject({ status: 'ok', read: 4, updated: 1 });
    const [b] = await (await getDb()).select().from(t.sites).where(eq(t.sites.id, 'site_b'));
    expect(b).toMatchObject({ label: 'Site de [Ville B] — essais et logistique', sort: 5, matrixState: 'ferme', archivedAt: null });
    expect(await lastLog('site', 'site_b')).toMatchObject({
      action: 'sync', byId: null, details: expect.arrayContaining([
        { field: 'Libellé', from: "Site de [Ville B] — zone d'essais", to: 'Site de [Ville B] — essais et logistique' },
        { field: 'État dans Matrix', from: 'Actif dans Matrix', to: 'Fermé dans Matrix' },
      ]),
    });
    actAs('Animateur QHSE', 'all');
    const { loadSiteSignals } = await import('@/lib/data/sites');
    const { todo } = await loadSiteSignals();
    expect(todo.find((x) => x.key === 'site-matrix|site_b|ferme')).toMatchObject({ siteId: 'site_b', ownerIds: ['clefevre', 'hmarchand'] });
    // Retiré de la liste de Matrix : jamais supprimé ni archivé d'office.
    await exec(`delete from matrix.${substituteTable('pub_sites')} where code = 'site_b'`);
    expect((await refreshSharedReferences(await getDb())).find((r) => r.source === 'sites')).toMatchObject({ updated: 1, removed: 1 });
    expect((await (await getDb()).select().from(t.sites).where(eq(t.sites.id, 'site_b')))[0]).toMatchObject({ matrixState: 'absent', archivedAt: null });
    await reinstall();
    await refreshSharedReferences(await getDb());
    expect((await (await getDb()).select().from(t.sites).where(eq(t.sites.id, 'site_b')))[0]).toMatchObject({ label: "Site de [Ville B] — zone d'essais", sort: 2, matrixState: 'actif' });
  });

  it('affectations : ajout, mise à jour et retrait d’après la vue ; salarié sans matricule connu ignoré', async () => {
    const table = `keystone.${substituteTable('pub_affectations')}`;
    await exec(`insert into ${table} (source, affectation_id, matricule, projet_code, client, activite, du, au) values
      ('rotation', 'af000000-0000-4000-8000-0000000000a1', 'EMP-9002', 'K-2026-012', '[Client B]', 'Montage', '2026-10-20', '2026-10-24'),
      ('rotation', 'af000000-0000-4000-8000-0000000000a2', 'EMP-0000', 'K-2026-012', '[Client B]', 'Montage', '2026-10-20', '2026-10-24')`);
    await exec(`update ${table} set activite = 'Mise en service et formation' where affectation_id = 'af000000-0000-4000-8000-000000000001'`);
    expect((await refreshSharedReferences(await getDb())).find((r) => r.source === 'assignments')).toMatchObject({ status: 'ok', added: 1, updated: 1, removed: 0 });
    const db = await getDb();
    expect((await db.select().from(t.keystoneAssignments).where(eq(t.keystoneAssignments.personId, 'mgirard')))[0])
      .toMatchObject({ project: 'K-2026-012 · [Client B]', activity: 'Montage', startOn: '2026-10-20', source: 'rotation' });
    await exec(`delete from ${table} where affectation_id = 'af000000-0000-4000-8000-0000000000a1'`);
    expect((await refreshSharedReferences(db)).find((r) => r.source === 'assignments')).toMatchObject({ removed: 1 });
    expect(await db.select().from(t.keystoneAssignments).where(eq(t.keystoneAssignments.personId, 'mgirard'))).toEqual([]);
    await reinstall();
    await refreshSharedReferences(db);
  });

  it('source indisponible (vue absente) : passage « unavailable », cache gardé ; erreur de lecture : passage « error »', async () => {
    const db = await getDb();
    const before = await db.select().from(t.keystoneAssignments);
    await exec('drop view keystone.pub_affectations');
    const results = await refreshSharedReferences(db);
    expect(results.find((r) => r.source === 'assignments')).toMatchObject({ status: 'unavailable', message: expect.stringContaining('absente') });
    expect(results.find((r) => r.source === 'sites')).toMatchObject({ status: 'ok' });
    expect(await lastRun('assignments')).toMatchObject({ status: 'unavailable', read: 0 });
    expect(await db.select().from(t.keystoneAssignments)).toEqual(before);
    // Lecture en erreur (division par zéro dans la vue) : jamais d'exception, passage « error ».
    await exec(`create or replace view keystone.pub_fournisseurs as select id, name, x3_code, is_internal from keystone.${substituteTable('pub_fournisseurs')} where 1 / (select count(*) - count(*) from keystone.${substituteTable('pub_fournisseurs')}) = 1`);
    expect((await refreshSharedReferences(db)).find((r) => r.source === 'suppliers')).toMatchObject({ status: 'error' });
    // Onglet « Connecteurs » : dernier passage et dernière lecture réussie.
    actAs('Animateur QHSE', 'site_a');
    const { loadConnectors } = await import('@/lib/data/connectors');
    const connectors = await loadConnectors();
    expect(connectors.find((c) => c.key === 'assignments')).toMatchObject({ last: { status: 'unavailable' }, lastOkAt: expect.any(String) });
    await reinstall();
  });

  it('« Actualiser » : animateur QHSE et direction seulement', async () => {
    const { refreshConnectors } = await import('@/server/connectors');
    actAs('Chef de service', 'site_a');
    expect(await refreshConnectors()).toMatchObject({ error: expect.any(String) });
    actAs('Direction', 'site_a');
    expect(await refreshConnectors()).toEqual({ ok: true, message: 'Sources actualisées.' });
  });
});

describe('D14 : suivre un site de Matrix (identifiant = code commun)', () => {
  it('choix parmi les sites actifs non suivis ; libellé et ordre de Matrix ; journal ; droits', async () => {
    const { saveSite, archiveSite } = await import('@/server/sites');
    const { loadMatrixSiteChoices } = await import('@/lib/data/sites');
    actAs('Animateur QHSE', 'all');
    expect(await loadMatrixSiteChoices()).toEqual({ choices: [['site_d', 'Site de [Ville D] — atelier de maintenance (site_d)']], message: null });
    actAs('Chef de service', 'site_a');
    expect(await saveSite({}, form({ id: '', code: 'site_d' }))).toMatchObject({ error: expect.any(String) });
    actAs('Animateur QHSE', 'all');
    expect(await saveSite({}, form({ id: '', code: 'site_c' }))).toMatchObject({ fieldErrors: { code: 'Site déjà suivi, archivé : réactivez-le.' } });
    expect(await saveSite({}, form({ id: '', code: 'all' }))).toMatchObject({ fieldErrors: { code: expect.any(String) } });
    expect(await saveSite({}, form({ id: '', code: 'site_d', qhseLeadId: 'clefevre', alsaceMoselleField: '1', alsaceMoselle: 'on' }))).toEqual({ ok: true, id: 'site_d' });
    const db = await getDb();
    expect((await db.select().from(t.sites).where(eq(t.sites.id, 'site_d')))[0]).toMatchObject({
      label: 'Site de [Ville D] — atelier de maintenance', sort: 4, qhseLeadId: 'clefevre', alsaceMoselle: true, matrixState: 'actif',
    });
    expect(await lastLog('site', 'site_d')).toMatchObject({ action: 'create', byId: 'clefevre', summary: expect.stringContaining('(Matrix : site_d)') });
    // Modification : libellé de Matrix inchangé même si le formulaire en envoie un.
    expect(await saveSite({}, form({ id: 'site_d', label: 'Autre libellé', qhseLeadId: '' }))).toEqual({ ok: true, id: 'site_d' });
    expect((await db.select().from(t.sites).where(eq(t.sites.id, 'site_d')))[0]).toMatchObject({ label: 'Site de [Ville D] — atelier de maintenance', qhseLeadId: null });
    // « Ne plus suivre » : motif obligatoire.
    expect(await archiveSite({}, form({ siteId: 'site_d', reason: '' }))).toMatchObject({ fieldErrors: { reason: expect.any(String) } });
    expect(await archiveSite({}, form({ siteId: 'site_d', reason: 'Atelier repris par une filiale' }))).toEqual({ ok: true, id: 'site_d' });
    expect(await loadMatrixSiteChoices()).toEqual({ choices: [], message: null });
  });

  it('sites de Matrix indisponibles : choix vide avec message, création refusée', async () => {
    const { saveSite } = await import('@/server/sites');
    const { loadMatrixSiteChoices } = await import('@/lib/data/sites');
    await exec(`insert into matrix.${substituteTable('pub_sites')} (code, libelle, pays_iso2, ordre, actif) values ('site_e', 'Site E', 'FR', 9, true)`);
    await exec('drop view matrix.pub_sites');
    actAs('Direction', 'all');
    expect(await loadMatrixSiteChoices()).toMatchObject({ choices: [], message: expect.stringContaining('Sites de Matrix indisponibles') });
    expect(await saveSite({}, form({ id: '', code: 'site_e' }))).toMatchObject({ error: expect.stringContaining('indisponibles') });
    await reinstall();
  });
});

describe('D02 et D16 : projet et fournisseur choisis dans les vues de Keystone', () => {
  it('événement : code contrôlé contre keystone.pub_projets, affiché « code · client », journalisé', async () => {
    const { createEvent, saveEvent } = await import('@/server/events');
    actAs('Chef de service', 'site_a');
    const base = { type: 'NC', title: 'Défaut de soudure', occurredOn: '2026-10-08', location: 'Atelier', severity: '2', siteId: 'site_a', declarantId: 'sbenali' };
    expect(await createEvent({}, form({ ...base, keystoneProjectCode: 'K-1999-001' }))).toMatchObject({ fieldErrors: { keystoneProjectCode: 'Projet Keystone inconnu.' } });
    const r = await createEvent({}, form({ ...base, keystoneProjectCode: 'K-2026-007' }));
    expect(r).toMatchObject({ ok: true });
    const db = await getDb();
    const [ev] = await db.select().from(t.events).where(eq(t.events.id, r.id!));
    expect(ev).toMatchObject({ keystoneProjectCode: 'K-2026-007', keystoneProject: null });
    const { loadVisibleEvents } = await import('@/lib/data/events');
    expect((await loadVisibleEvents()).find((e) => e.id === r.id)?.keystoneProject).toBe('K-2026-007 · [Client D]');
    // Source indisponible : un nouveau projet est refusé avec un message, le projet enregistré reste admis et affiché par son code.
    await exec('drop view keystone.pub_projets');
    const { loadFormOptions } = await import('@/lib/data/options');
    expect(await loadFormOptions()).toMatchObject({ projects: [], projectsMessage: expect.stringContaining('Projets de Keystone indisponibles') });
    const edit = (code: string) => form({ ...base, id: r.id!, pilotId: 'sbenali', keystoneProjectCode: code });
    expect(await saveEvent({}, edit('K-2026-012'))).toMatchObject({ fieldErrors: { keystoneProjectCode: expect.stringContaining('indisponibles') } });
    expect(await saveEvent({}, edit('K-2026-007'))).toEqual({ ok: true, id: r.id });
    await reinstall();
    expect(await saveEvent({}, edit('K-2026-012'))).toEqual({ ok: true, id: r.id });
    expect(await lastLog('event', r.id!)).toMatchObject({ details: expect.arrayContaining([{ field: 'Projet Keystone', from: 'K-2026-007', to: 'K-2026-012' }]) });
  });

  it('entreprise extérieure : fournisseur Keystone (pas un atelier interne), journalisé par son nom', async () => {
    const { saveContractor } = await import('@/server/contractors');
    actAs('Chef de service', 'site_a');
    const db = await getDb();
    const [ee2] = await db.select().from(t.contractors).where(eq(t.contractors.id, 'EE-002'));
    const fields = { id: 'EE-002', name: ee2.name, trade: ee2.trade, contactName: ee2.contactName ?? '', contactPhone: ee2.contactPhone ?? '', contactEmail: ee2.contactEmail ?? '' };
    const edit = (supplierId: string) => form({ ...fields, supplierId });
    expect(await saveContractor({}, edit('5f000000-0000-4000-8000-000000000009'))).toMatchObject({ fieldErrors: { supplierId: 'Atelier interne : pas une entreprise extérieure.' } });
    expect(await saveContractor({}, edit('5f000000-0000-4000-8000-0000000000aa'))).toMatchObject({ fieldErrors: { supplierId: 'Fournisseur Keystone inconnu.' } });
    expect(await saveContractor({}, edit('5f000000-0000-4000-8000-000000000002'))).toMatchObject({ ok: true });
    expect((await db.select().from(t.contractors).where(eq(t.contractors.id, 'EE-002')))[0].supplierId).toBe('5f000000-0000-4000-8000-000000000002');
    expect(await lastLog('contractor', 'EE-002')).toMatchObject({ details: [{ field: 'Fournisseur Keystone', from: null, to: '[Entreprise Élec Industrie]' }] });
    // Champ absent du formulaire : fournisseur inchangé.
    expect(await saveContractor({}, form(fields))).toMatchObject({ ok: true });
    expect((await db.select({ s: t.contractors.supplierId }).from(t.contractors).where(and(eq(t.contractors.id, 'EE-002'))))[0].s).toBe('5f000000-0000-4000-8000-000000000002');
  });
});
