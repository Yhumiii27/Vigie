import '../next-mocks';
import { describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { getDb, schema as t } from '@/db';
import { installForeignSubstitutes, substituteTable } from '@/db/foreign-substitutes';
import { SOURCES } from '@/lib/foreign/labels';
import { refreshSharedReferences } from '@/server/foreign-sync';

// D01 de Matrix (décision CV-10 du 03/11/2026) : personnes lues dans cursus.pub_salaries (cache people), contrat v1 ou v2,
// fiche absente jamais supprimée, aucune création dans Vigie, rattachement d'une fiche ancienne, échéances du QHSE ;
// PRV-25 : liste du poste de garde d'après cursus.pub_presences_prevues.

freshDemoDatabase();

const db = () => getDb();
const exec = async (q: string) => (await db()).execute(sql.raw(q));
const SALARIES = `cursus.${substituteTable('pub_salaries')}`;
const reinstall = async () => installForeignSubstitutes(await db(), { engine: 'pglite', demo: true });
const byMatricule = async (m: string) => (await (await db()).select().from(t.people).where(eq(t.people.matricule, m)))[0];
const person = async (id: string) => (await (await db()).select().from(t.people).where(eq(t.people.id, id)))[0];
const peopleRun = async () => (await (await db()).select().from(t.syncRuns).where(eq(t.syncRuns.source, SOURCES.people.view)).orderBy(sql`${t.syncRuns.id} desc`).limit(1))[0];
const todoKeys = async () => {
  const { loadTodo } = await import('@/lib/data/todo');
  return (await loadTodo()).map((x) => x.key ?? '');
};

describe('rafraîchissement des personnes (cache de cursus.pub_salaries)', () => {
  it('jeu de démonstration : intérimaires et extérieurs repris de Cursus, journal sans auteur, sync_runs sans donnée personnelle', async () => {
    const garnier = await byMatricule('I-9101');
    expect(garnier).toMatchObject({ name: '[D. Garnier]', category: 'interimaire', company: '[Agence Intérim Ouest]', siteId: 'site_a', cursusState: 'actif', inSkillsMatrix: false });
    expect(await changeLog('person', garnier.id)).toMatchObject([{ action: 'create', byId: null, summary: 'Fiche reprise de Cursus (référentiel du personnel)' }]);
    expect(await byMatricule('EMP-9001')).toMatchObject({ id: 'tnguyen', category: 'salarie', cursusEmail: 't.nguyen@epc2i.example', cursusState: 'actif' });
    const run = await peopleRun();
    expect(run).toMatchObject({ status: 'ok', message: null });
    const runs = await (await db()).select().from(t.syncRuns);
    expect(JSON.stringify(runs)).not.toMatch(/@epc2i/);
  });

  it('nom, poste, site, e-mail et sortie repris ; journal « Cursus » sans auteur, e-mail jamais en clair', async () => {
    await exec(`update ${SALARIES} set nom = '[T. Nguyen-Durand]', poste = 'Chef d''équipe montage', site_code = 'site_b', email = 'tnd@epc2i.example' where matricule = 'EMP-9001'`);
    const r = (await refreshSharedReferences(await db())).find((x) => x.source === 'people');
    expect(r).toMatchObject({ status: 'ok', updated: 1, added: 0, removed: 0 });
    expect(await person('tnguyen')).toMatchObject({ name: '[T. Nguyen-Durand]', job: "Chef d'équipe montage", siteId: 'site_b', cursusEmail: 'tnd@epc2i.example' });
    const log = await lastLog('person', 'tnguyen');
    expect(log).toMatchObject({ action: 'sync', byId: null, summary: 'Fiche mise à jour depuis Cursus (référentiel du personnel)' });
    expect(JSON.stringify(log)).not.toContain('@');
    await reinstall();
    await refreshSharedReferences(await db());
    expect(await person('tnguyen')).toMatchObject({ name: '[T. Nguyen]', siteId: 'site_a' });
  });

  it('personne retirée de la vue : fiche gardée, état « absent », échéance au responsable QHSE du site ; de retour : « publiée »', async () => {
    await exec(`delete from ${SALARIES} where matricule = 'EMP-9006'`);
    const r = (await refreshSharedReferences(await db())).find((x) => x.source === 'people');
    expect(r).toMatchObject({ status: 'ok', updated: 1, removed: 1 });
    expect(await person('rfontaine')).toMatchObject({ cursusState: 'absent', leftOn: null, name: '[R. Fontaine]' });
    actAs('Animateur QHSE', 'site_a');
    const { loadTodo } = await import('@/lib/data/todo');
    expect((await loadTodo()).find((x) => x.key === 'cursus-personne-absente|rfontaine')).toMatchObject({ ownerIds: ['clefevre'], siteId: 'site_a', href: '/habilitations?vue=personnel' });
    await reinstall();
    await refreshSharedReferences(await db());
    expect(await person('rfontaine')).toMatchObject({ cursusState: 'actif' });
    expect(await lastLog('person', 'rfontaine')).toMatchObject({ action: 'sync', details: [{ field: 'État dans Cursus', from: 'Absente de Cursus', to: 'Publiée par Cursus' }] });
  });

  it('vue au contrat v1 (sans categorie, entreprise, email) : source lue, valeurs de Vigie gardées', async () => {
    await exec('drop view cursus.pub_salaries');
    await exec(`create view cursus.pub_salaries as select matricule, nom, poste, unite_code, site_code, entree, sortie, actif from ${SALARIES}`);
    await exec(`update ${SALARIES} set poste = 'Cariste confirmé', categorie = null, entreprise = null where matricule = 'I-9101'`);
    const r = (await refreshSharedReferences(await db())).find((x) => x.source === 'people');
    expect(r).toMatchObject({ status: 'ok', updated: 1 });
    expect(await byMatricule('I-9101')).toMatchObject({ job: 'Cariste confirmé', category: 'interimaire', company: '[Agence Intérim Ouest]' });
    await reinstall();
    await refreshSharedReferences(await db());
  });

  it('source indisponible : passage « unavailable », fiches inchangées, une seule échéance commune', async () => {
    const before = await (await db()).select().from(t.people);
    await exec('drop view cursus.pub_salaries');
    expect((await refreshSharedReferences(await db())).find((x) => x.source === 'people')).toMatchObject({ status: 'unavailable', message: expect.stringContaining('absente') });
    expect(await (await db()).select().from(t.people)).toEqual(before);
    actAs('Animateur QHSE', 'site_a');
    expect((await todoKeys()).filter((k) => k === 'cursus-personnes-indisponible')).toHaveLength(1);
    await reinstall();
    await refreshSharedReferences(await db());
  });
});

describe('aucune création dans Vigie ; fiches tenues par Cursus', () => {
  it('création refusée ; nom, poste et site d’une fiche tenue par Cursus jamais modifiés par le formulaire', async () => {
    const { savePerson } = await import('@/server/skills');
    actAs('Animateur QHSE', 'site_a');
    expect(await savePerson({}, form({ name: 'Nouveau', siteId: 'site_a' }))).toEqual({ error: expect.stringContaining('se créent dans Cursus') });
    const p = await person('proux');
    expect(await savePerson({}, form({ id: 'proux', name: 'Autre nom', job: 'Autre poste', siteId: 'site_b', service: 'Usinage 2', inSkillsMatrix: 'on' }))).toMatchObject({ ok: true });
    expect(await person('proux')).toMatchObject({ name: p.name, job: p.job, siteId: p.siteId, service: 'Usinage 2' });
  });
});

describe('rattachement d’une fiche ancienne (sans matricule) à un salarié de Cursus', () => {
  it('échéance « à rattacher » au responsable QHSE du site ; QHSE et direction seulement', async () => {
    actAs('Animateur QHSE', 'site_a');
    const { loadTodo } = await import('@/lib/data/todo');
    expect((await loadTodo()).find((x) => x.key === 'personne-a-rattacher|nlegrand')).toMatchObject({ ownerIds: ['clefevre'], siteId: 'site_a', href: '/habilitations?vue=personnel' });
    const { loadPeopleAdmin } = await import('@/lib/data/people');
    const admin = await loadPeopleAdmin();
    expect(admin?.toAttach.map((p) => p.id)).toEqual(['nlegrand']);
    // Matricule porté par la fiche que le rafraîchissement a créée : proposé ; celui d'un salarié du jeu (historique) : non.
    expect(admin?.choices.map(([v]) => v)).toContain('EMP-9014');
    expect(admin?.choices.map(([v]) => v)).not.toContain('EMP-9001');
    actAs('Chef de service', 'site_a');
    expect(await loadPeopleAdmin()).toBeNull();
    expect((await todoKeys()).some((k) => k.startsWith('personne-a-rattacher|'))).toBe(false);
  });

  it('droits, site, motif, matricule inconnu ou déjà rattaché refusés', async () => {
    const { attachPerson } = await import('@/server/people');
    actAs('Chef de service', 'site_a');
    expect(await attachPerson({}, form({ id: 'nlegrand', matricule: 'EMP-9014', reason: 'Même personne' }))).toMatchObject({ error: expect.any(String) });
    actAs('Animateur QHSE', 'site_b');
    expect((await attachPerson({}, form({ id: 'nlegrand', matricule: 'EMP-9014', reason: 'Même personne' }))).error).toMatch(/autre site/);
    actAs('Animateur QHSE', 'site_a');
    expect(await attachPerson({}, form({ id: 'nlegrand', matricule: 'EMP-9014', reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await attachPerson({}, form({ id: 'nlegrand', matricule: 'EMP-0000', reason: 'Même personne' }))).toEqual({ fieldErrors: { matricule: 'Matricule absent de Cursus.' } });
    expect(await attachPerson({}, form({ id: 'nlegrand', matricule: 'EMP-9001', reason: 'Même personne' }))).toEqual({
      fieldErrors: { matricule: 'Matricule déjà rattaché à une autre fiche de Vigie ([T. Nguyen]), qui a son propre historique.' },
    });
    expect(await attachPerson({}, form({ id: 'tnguyen', matricule: 'EMP-9014', reason: 'Même personne' }))).toEqual({ error: 'Fiche déjà rattachée à Cursus.' });
  });

  it('rattachement : matricule et données de Cursus posés ; fiche créée par le rafraîchissement remplacée, jamais supprimée ; journal des deux fiches', async () => {
    const { attachPerson } = await import('@/server/people');
    actAs('Direction', 'site_a');
    const holder = await byMatricule('EMP-9014');
    expect(holder.id).not.toBe('nlegrand');
    expect(await attachPerson({}, form({ id: 'nlegrand', matricule: 'EMP-9014', reason: 'Compte Microsoft créé avant la reprise de Cursus' }))).toMatchObject({ ok: true, id: 'nlegrand' });
    expect(await person('nlegrand')).toMatchObject({ matricule: 'EMP-9014', cursusState: 'actif', category: 'salarie', cursusEmail: 'n.legrand@epc2i.example', replacedById: null });
    expect(await person(holder.id)).toMatchObject({ matricule: null, replacedById: 'nlegrand', leftOn: '2026-10-09' });
    expect(await lastLog('person', 'nlegrand')).toMatchObject({ action: 'link', byId: 'hmarchand', reason: 'Compte Microsoft créé avant la reprise de Cursus', summary: 'Fiche rattachée à Cursus (matricule EMP-9014)' });
    expect(await lastLog('person', holder.id)).toMatchObject({ action: 'archive', byId: 'hmarchand' });
    // Le rafraîchissement suivant ne recrée rien et ne touche pas la fiche remplacée.
    const r = (await refreshSharedReferences(await db())).find((x) => x.source === 'people');
    expect(r).toMatchObject({ added: 0 });
    expect(await (await db()).select({ id: t.people.id }).from(t.people).where(and(eq(t.people.name, '[N. Legrand]')))).toHaveLength(2);
    actAs('Animateur QHSE', 'site_a');
    expect((await todoKeys()).some((k) => k.startsWith('personne-a-rattacher|'))).toBe(false);
    const { loadPersonalData } = await import('@/lib/data/personal-data');
    expect((await loadPersonalData('nlegrand'))?.identity).toMatchObject({ fromCursus: true, matricule: 'EMP-9014', category: 'salarie' });
  });

  it('« Actualiser depuis Cursus » : QHSE et direction seulement', async () => {
    const { refreshFromCursus } = await import('@/server/people');
    actAs('Chef de service', 'site_a');
    expect(await refreshFromCursus()).toMatchObject({ error: expect.any(String) });
    actAs('Animateur QHSE', 'site_a');
    expect(await refreshFromCursus()).toMatchObject({ ok: true, message: expect.stringContaining('Cursus actualisé') });
  });
});

describe('PRV-25 : liste du poste de garde', () => {
  it('lecteurs : QHSE, direction et encadrement ; jamais le Salarié', async () => {
    const { loadGateHouse } = await import('@/lib/data/gate-house');
    actAs('Salarié', 'site_a');
    expect(await loadGateHouse(7)).toBeNull();
    actAs('Chef de projet', 'site_a');
    expect(await loadGateHouse(7)).not.toBeNull();
  });

  it('site sélectionné, 7 jours : arrivées, départs, plan rapproché ; 14 jours ; tous les sites : annulées et matricule inconnu', async () => {
    const { loadGateHouse } = await import('@/lib/data/gate-house');
    actAs('Chef de service', 'site_a');
    const g = (await loadGateHouse(7))!;
    expect(g.message).toBeNull();
    expect(g.list.arrivals.map((r) => r.matricule)).toEqual(['I-9101', 'E-9204']);
    expect(g.list.departures.map((r) => r.matricule)).toEqual(['E-9204', 'E-9202']);
    expect(g.list.departures.find((r) => r.matricule === 'E-9202')).toMatchObject({ name: '[B. Morel]', plans: ['PP-2026-015'] });
    expect(g.list.arrivals.find((r) => r.matricule === 'E-9204')).toMatchObject({ plans: ['PP-2026-017'] });
    expect(g.list.arrivals.find((r) => r.matricule === 'I-9101')).toMatchObject({ plans: [], permits: [] });
    expect(g.list.cancelled).toEqual([]);
    expect((await loadGateHouse(14))!.list.arrivals.map((r) => r.matricule)).toEqual(['I-9101', 'E-9204', 'E-9203']);
    actAs('Chef de service', 'site_b');
    expect((await loadGateHouse(7))!.list.arrivals.map((r) => r.matricule)).toEqual(['E-9299']);
    actAs('Animateur QHSE', 'all');
    const all = (await loadGateHouse(7))!;
    expect(all.list.cancelled.map((r) => r.matricule)).toEqual(['I-9102']);
    expect(all.list.arrivals.find((r) => r.matricule === 'E-9299')).toMatchObject({ name: null, siteId: 'site_b' });
    // Aucune donnée de santé ni e-mail dans la liste.
    expect(JSON.stringify(all)).not.toMatch(/@|injury|blessure/i);
  });

  it('source indisponible : bandeau, liste vide, jamais d’erreur', async () => {
    const { loadGateHouse } = await import('@/lib/data/gate-house');
    await exec('drop view cursus.pub_presences_prevues');
    actAs('Animateur QHSE', 'site_a');
    const g = (await loadGateHouse(7))!;
    expect(g.message).toContain('Présences prévues de Cursus indisponibles');
    expect(g.list).toMatchObject({ arrivals: [], departures: [], cancelled: [] });
    expect((await refreshSharedReferences(await db())).find((x) => x.source === 'presences')).toMatchObject({ status: 'unavailable' });
    await reinstall();
  });
});
