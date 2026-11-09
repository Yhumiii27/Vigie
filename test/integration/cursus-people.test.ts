import '../next-mocks';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
// PRV-25 : liste du poste de garde d'après cursus.pub_presences_prevues. Lot 14 de Cursus : matricule de site (« I… »,
// « E… ») en fin de pub_salaries et de pub_presences_prevues, présence rapprochée par matricule Cursus ou de site.

freshDemoDatabase();

const db = () => getDb();
const exec = async (q: string) => (await db()).execute(sql.raw(q));
const SALARIES = `cursus.${substituteTable('pub_salaries')}`;
const PRESENCES = `cursus.${substituteTable('pub_presences_prevues')}`;
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
    const garnier = await byMatricule('EMP-9101');
    expect(garnier).toMatchObject({ name: '[D. Garnier]', siteMatricule: 'I00101', category: 'interimaire', company: '[Agence Intérim Ouest]', siteId: 'site_a', cursusState: 'actif', inSkillsMatrix: false });
    expect(await changeLog('person', garnier.id)).toMatchObject([{ action: 'create', byId: null, summary: 'Fiche reprise de Cursus (référentiel du personnel)' }]);
    expect(await byMatricule('EMP-9001')).toMatchObject({ id: 'tnguyen', category: 'salarie', cursusEmail: 't.nguyen@epc2i.example', cursusState: 'actif', siteMatricule: null });
    expect(await byMatricule('EMP-9202')).toMatchObject({ name: '[B. Morel]', siteMatricule: 'E00202', category: 'exterieur' });
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
    await exec(`update ${SALARIES} set poste = 'Cariste confirmé', categorie = null, entreprise = null, matricule_site = null where matricule = 'EMP-9101'`);
    const r = (await refreshSharedReferences(await db())).find((x) => x.source === 'people');
    expect(r).toMatchObject({ status: 'ok', updated: 1 });
    expect(await byMatricule('EMP-9101')).toMatchObject({ job: 'Cariste confirmé', category: 'interimaire', company: '[Agence Intérim Ouest]', siteMatricule: 'I00101' });
    await reinstall();
    await refreshSharedReferences(await db());
  });

  it('vue au contrat v2 sans matricule_site : source lue, matricule de site de Vigie gardé', async () => {
    await exec('drop view cursus.pub_salaries');
    await exec(`create view cursus.pub_salaries as select matricule, nom, poste, unite_code, site_code, entree, sortie, actif, categorie, entreprise, email from ${SALARIES}`);
    await exec(`update ${SALARIES} set matricule_site = null, poste = 'Soudeur TIG' where matricule = 'EMP-9202'`);
    expect((await refreshSharedReferences(await db())).find((x) => x.source === 'people')).toMatchObject({ status: 'ok', updated: 1 });
    expect(await byMatricule('EMP-9202')).toMatchObject({ job: 'Soudeur TIG', siteMatricule: 'E00202', category: 'exterieur' });
    await reinstall();
    await refreshSharedReferences(await db());
  });

  it('matricule de site : posé, modifié (journal « Matricule de site »), jamais effacé, jamais pris à une autre fiche', async () => {
    const morel = await byMatricule('EMP-9202');
    await exec(`update ${SALARIES} set matricule_site = 'E00999' where matricule = 'EMP-9202'`);
    expect((await refreshSharedReferences(await db())).find((x) => x.source === 'people')).toMatchObject({ status: 'ok', updated: 1, message: null });
    expect(await person(morel.id)).toMatchObject({ siteMatricule: 'E00999' });
    expect(await lastLog('person', morel.id)).toMatchObject({ action: 'sync', byId: null, details: [{ field: 'Matricule de site', from: 'E00202', to: 'E00999' }] });
    // Publié vide ou hors format : valeur gardée.
    await exec(`update ${SALARIES} set matricule_site = 'X-1' where matricule = 'EMP-9202'`);
    expect((await refreshSharedReferences(await db())).find((x) => x.source === 'people')).toMatchObject({ updated: 0 });
    expect(await person(morel.id)).toMatchObject({ siteMatricule: 'E00999' });
    // Publication erronée : matricule de site d'une autre fiche, non repris, message du passage sans donnée personnelle.
    await exec(`update ${SALARIES} set matricule_site = 'I00101' where matricule = 'EMP-9202'`);
    expect((await refreshSharedReferences(await db())).find((x) => x.source === 'people')).toMatchObject({ status: 'ok', message: expect.stringContaining('1 matricule(s) de site') });
    expect(await person(morel.id)).toMatchObject({ siteMatricule: 'E00999' });
    expect(await byMatricule('EMP-9101')).toMatchObject({ siteMatricule: 'I00101' });
    await reinstall();
    await refreshSharedReferences(await db());
    expect(await person(morel.id)).toMatchObject({ siteMatricule: 'E00202' });
    // Contrainte de format en base.
    await expect(exec(`update people set site_matricule = 'EMP-1' where id = '${morel.id}'`)).rejects.toThrow();
  });

  it('migration 0031 : anciens matricules du jeu (« I-9101 »…) réécrits, aucun doublon au rafraîchissement suivant', async () => {
    const garnier = await byMatricule('EMP-9101');
    const fabre = await byMatricule('EMP-9203');
    await exec(`update people set matricule = 'I-9101', site_matricule = null where id = '${garnier.id}'`);
    await exec(`update people set matricule = 'E-9203', site_matricule = null where id = '${fabre.id}'`);
    const migration = readFileSync(path.join(process.cwd(), 'drizzle', '0031_cursus_site_matricule.sql'), 'utf8');
    const recode = migration.split('--> statement-breakpoint').map((x) => x.trim()).find((x) => x.includes('UPDATE "people"'))!;
    await exec(recode.split('\n').filter((l) => !l.startsWith('--')).join('\n'));
    expect(await person(garnier.id)).toMatchObject({ matricule: 'EMP-9101', siteMatricule: 'I00101' });
    expect(await person(fabre.id)).toMatchObject({ matricule: 'EMP-9203', siteMatricule: 'E00203' });
    const before = (await (await db()).select({ id: t.people.id }).from(t.people)).length;
    expect((await refreshSharedReferences(await db())).find((x) => x.source === 'people')).toMatchObject({ status: 'ok', added: 0, removed: 0 });
    expect((await (await db()).select({ id: t.people.id }).from(t.people)).length).toBe(before);
    expect(await person(garnier.id)).toMatchObject({ cursusState: 'actif' });
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
    expect(g.list.arrivals.map((r) => r.matricule)).toEqual(['EMP-9101', 'EMP-9204']);
    expect(g.list.arrivals.map((r) => r.siteMatricule)).toEqual(['I00101', 'E00204']);
    expect(g.list.departures.map((r) => r.matricule)).toEqual(['EMP-9204', 'EMP-9202']);
    expect(g.list.departures.find((r) => r.matricule === 'EMP-9202')).toMatchObject({ name: '[B. Morel]', siteMatricule: 'E00202', plans: ['PP-2026-015'] });
    expect(g.list.arrivals.find((r) => r.matricule === 'EMP-9204')).toMatchObject({ plans: ['PP-2026-017'] });
    expect(g.list.arrivals.find((r) => r.matricule === 'EMP-9101')).toMatchObject({ plans: [], permits: [] });
    expect(g.list.cancelled).toEqual([]);
    expect((await loadGateHouse(14))!.list.arrivals.map((r) => r.matricule)).toEqual(['EMP-9101', 'EMP-9204', 'EMP-9203']);
    actAs('Chef de service', 'site_b');
    expect((await loadGateHouse(7))!.list.arrivals.map((r) => r.matricule)).toEqual(['EMP-9299']);
    actAs('Animateur QHSE', 'all');
    const all = (await loadGateHouse(7))!;
    expect(all.list.cancelled.map((r) => r.matricule)).toEqual(['EMP-9102']);
    expect(all.list.arrivals.find((r) => r.matricule === 'EMP-9299')).toMatchObject({ name: null, siteMatricule: 'E00299', siteId: 'site_b' });
    // Aucune donnée de santé ni e-mail dans la liste.
    expect(JSON.stringify(all)).not.toMatch(/@|injury|blessure/i);
  });

  it('vue sans matricule_site (contrat actuel de Matrix) : personne rapprochée par le matricule Cursus', async () => {
    const { loadGateHouse } = await import('@/lib/data/gate-house');
    await exec('drop view cursus.pub_presences_prevues');
    await exec(`create view cursus.pub_presences_prevues as select declaration_ref, matricule, site_code, entreprise, du, au, objet, statut, maj_le from ${PRESENCES}`);
    actAs('Chef de service', 'site_a');
    const g = (await loadGateHouse(7))!;
    expect(g.message).toBeNull();
    expect(g.list.arrivals.map((r) => [r.name, r.matricule, r.siteMatricule])).toEqual([['[D. Garnier]', 'EMP-9101', 'I00101'], ['[P. Henry]', 'EMP-9204', 'E00204']]);
    await reinstall();
  });

  it('variante du lot 14 : la présence porte le matricule de site (« I… », « E… ») ; personne rapprochée par people.site_matricule', async () => {
    const { loadGateHouse } = await import('@/lib/data/gate-house');
    await exec(`update ${PRESENCES} set matricule = matricule_site`);
    await exec('drop view cursus.pub_presences_prevues');
    await exec(`create view cursus.pub_presences_prevues as select declaration_ref, matricule, site_code, entreprise, du, au, objet, statut, maj_le from ${PRESENCES}`);
    actAs('Chef de service', 'site_a');
    const g = (await loadGateHouse(7))!;
    expect(g.list.arrivals.map((r) => [r.name, r.matricule, r.siteMatricule])).toEqual([['[D. Garnier]', 'EMP-9101', 'I00101'], ['[P. Henry]', 'EMP-9204', 'E00204']]);
    expect(g.list.departures.find((r) => r.siteMatricule === 'E00202')).toMatchObject({ name: '[B. Morel]', matricule: 'EMP-9202', plans: ['PP-2026-015'] });
    actAs('Chef de service', 'site_b');
    // Personne inconnue de Vigie : matricule de site seul.
    expect((await loadGateHouse(7))!.list.arrivals.map((r) => [r.name, r.matricule, r.siteMatricule])).toEqual([[null, null, 'E00299']]);
    await reinstall();
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
