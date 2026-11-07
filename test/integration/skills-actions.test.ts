import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, lastLog, freshDemoDatabase } from '../helpers';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { installForeignSubstitutes, substituteTable } from '@/db/foreign-substitutes';
import {
  archiveTitle, followTitle, moveTitle, reinstatePerson, restoreTitle, savePerson, saveTitle, setPersonLeft, setRequirement,
} from '@/server/skills';
import { loadSkillData, loadSkillMatrix, loadSkillSignals, loadTitleChoices } from '@/lib/data/skills';
import { refreshSharedReferences } from '@/server/foreign-sync';

// Habilitations et formations après la décision CV-01 du 04/11/2026 (lot 2 de M-02, D08 et D09) : Vigie consulte les
// titres détenus dans cursus.pub_titres_detenus (substitut de démonstration) et suit des titres du catalogue de Cursus
// (cursus.pub_titres). Restent saisis dans Vigie : exigences par salarié, personnel, suivi des titres (suivre, attributs
// propres au QHSE, ordre, ne plus suivre). Une action de recyclage d'une base reprise (A-907) est simulée : jamais modifiée
// par l'écran, elle protège le rattachement de l'exigence tant qu'elle n'est pas close. Jeu de démonstration au 09/10/2026.

freshDemoDatabase();

const db = () => getDb();
const exec = async (q: string) => (await db()).execute(sql.raw(q));
const HELD = `cursus.${substituteTable('pub_titres_detenus')}`;
const reinstall = async () => installForeignSubstitutes(await db(), { engine: 'pglite', demo: true });

async function legacyRenewal(id: string, personId: string, titleId: string, status: 'a_faire' | 'terminee' | 'verifiee' = 'a_faire') {
  const db_ = await db();
  await db_.insert(t.actions).values({
    id, openedOn: '2026-09-01', pilotId: 'clefevre', status, dueOn: '2026-10-20', initialDueOn: '2026-10-20', source: null,
    originRef: `Habilitations · ${personId}`, detail: `Recyclage ${titleId} — ${personId}`, siteId: 'site_a', legacyOrigin: 'skills',
    doneOn: status === 'a_faire' ? null : '2026-10-01', closedOn: status === 'verifiee' ? '2026-10-05' : null,
    qualificationPersonId: personId, qualificationTitleId: titleId,
  });
  await db_.insert(t.qualificationRequirements).values({ personId, titleId }).onConflictDoNothing();
}
const requirement = async (personId: string, titleId: string) =>
  (await (await db()).select().from(t.qualificationRequirements)
    .where(and(eq(t.qualificationRequirements.personId, personId), eq(t.qualificationRequirements.titleId, titleId))))[0];
const person = async (id: string) => (await (await db()).select().from(t.people).where(eq(t.people.id, id)))[0];
const cellOf = async (personId: string, titleId: string) =>
  (await loadSkillData()).rows.find((x) => x.person.id === personId)?.cells.find((c) => c.title.id === titleId);

const DENIED = 'Votre rôle ne permet pas cette modification.';

describe('matrice lue dans Cursus (D09)', () => {
  it('états du jeu : valide, à renouveler, expiré, suspendu (prérequis manquant), jamais suivi', async () => {
    actAs('Animateur QHSE', 'site_a');
    expect(await cellOf('tnguyen', 'habilitation.hauteur')).toMatchObject({ state: 'x', expiresOn: '2026-09-28', obtainedOn: '2023-09-28', cursusRef: expect.stringMatching(/^hab_titre\./) });
    expect(await cellOf('tnguyen', 'formation.sst')).toMatchObject({ state: 's', expiresOn: '2026-11-20', provider: 'Formation interne' });
    expect(await cellOf('mgirard', 'habilitation.he')).toMatchObject({ state: 's', provider: '[Apave]' });
    expect(await cellOf('kbernard', 'habilitation.ac489')).toMatchObject({ state: 'p', prerequisiteMissing: true, titleExpiresOn: expect.any(String) });
    expect(await cellOf('kbernard', 'formation.accueil')).toMatchObject({ state: 'r', cursusRef: null });
    expect(await cellOf('sbenali', 'habilitation.atex')).toMatchObject({ state: 'v' });
    const { todo } = await loadSkillSignals();
    expect(todo.find((x) => x.href === '/habilitations?salarie=kbernard&titre=habilitation.ac489'))
      .toMatchObject({ tone: 'danger', title: '[K. Bernard] · autorisation de conduite suspendu, prérequis manquant (Cursus)' });
  });

  it('suspension ou retrait d’une habilitation dans Cursus : suspendu dès le jour de la mesure ; salarié sans matricule : aucun titre lu', async () => {
    await exec(`update ${HELD} set mesure = 'suspension', mesure_le = '2026-10-05', utilisable_jusqu_au = '2026-10-04' where matricule = 'EMP-9009' and titre_id = 'habilitation.atex'`);
    actAs('Animateur QHSE', 'site_a');
    expect(await cellOf('sbenali', 'habilitation.atex')).toMatchObject({ state: 'p', measure: { kind: 'suspension', on: '2026-10-05' } });
    const { todo } = await loadSkillSignals();
    expect(todo.find((x) => x.href === '/habilitations?salarie=sbenali&titre=habilitation.atex')?.title).toBe('[S. Benali] · ATEX suspendu depuis le 05/10 (Cursus)');
    await (await db()).update(t.people).set({ matricule: null }).where(eq(t.people.id, 'sbenali'));
    expect(await cellOf('sbenali', 'formation.sst')).toMatchObject({ state: 'r', cursusRef: null });
    await (await db()).update(t.people).set({ matricule: 'EMP-9009' }).where(eq(t.people.id, 'sbenali'));
    await reinstall();
  });

  it('source indisponible : cases requises « u », aucune alerte par case, un signal commun au QHSE ; exigences toujours modifiables', async () => {
    await exec('drop view cursus.pub_titres_detenus');
    actAs('Animateur QHSE', 'site_a');
    const data = await loadSkillData();
    expect(data.source).toMatchObject({ ok: false, message: expect.stringContaining('Titres détenus de Cursus indisponibles') });
    expect(data.rows.find((r) => r.person.id === 'tnguyen')?.cells.find((c) => c.title.id === 'habilitation.hauteur')).toMatchObject({ state: 'u', cursusRef: null });
    expect(data.rows.flatMap((r) => r.cells).some((c) => c.state === 'r' || c.state === 'x')).toBe(false);
    expect(data.lapses).toEqual([]);
    const { todo } = await loadSkillSignals();
    expect(todo).toEqual([expect.objectContaining({ key: 'habilitations-cursus-indisponible', tone: 'warn', siteId: null, ownerIds: expect.arrayContaining(['clefevre']) })]);
    expect(await setRequirement('kbernard', 'formation.caces484', true)).toEqual({});
    expect(await setRequirement('kbernard', 'formation.caces484', false)).toEqual({});
    // Registre des accidents bénins : secouriste de l'effectif refusé avec le message de la source.
    const { readFirstAiders } = await import('@/lib/data/events');
    expect(await readFirstAiders('site_a', '2026-10-09')).toEqual({ aiders: [], message: expect.stringContaining('indisponibles') });
    await reinstall();
    expect((await loadSkillData()).source.ok).toBe(true);
  });
});

describe('droits : écran « Habilitations et formations » modifiable', () => {
  it('Salarié et Chef de projet (écran fermé) ne modifient rien ; Chef de service oui', async () => {
    for (const role of ['Salarié', 'Chef de projet'] as const) {
      actAs(role);
      expect(await setRequirement('kbernard', 'formation.caces484', true)).toEqual({ error: DENIED });
      expect(await savePerson({}, form({ name: 'X', siteId: 'site_a' }))).toEqual({ error: DENIED });
      expect(await followTitle({}, form({ titleId: 'formation.aipr' }))).toEqual({ error: DENIED });
      expect(await archiveTitle({}, form({ id: 'formation.sst', reason: 'Test' }))).toEqual({ error: DENIED });
      expect(await reinstatePerson({}, form({ id: 'ylambert', reason: 'Retour' }))).toEqual({ error: DENIED });
    }
    expect(await requirement('kbernard', 'formation.caces484')).toBeUndefined();
    actAs('Chef de service');
    expect(await setRequirement('kbernard', 'formation.caces484', true)).toEqual({});
    expect(await requirement('kbernard', 'formation.caces484')).toMatchObject({ personId: 'kbernard', titleId: 'formation.caces484' });
    expect(await lastLog('qualification_requirement', 'kbernard|formation.caces484')).toMatchObject({ action: 'create', byId: 'sbenali' });
    expect(await setRequirement('kbernard', 'formation.caces484', false)).toEqual({});
    expect(await requirement('kbernard', 'formation.caces484')).toBeUndefined();
    // Titres suivis : service QHSE et direction seulement (HAB-12).
    expect(await followTitle({}, form({ titleId: 'formation.aipr' }))).toEqual({ error: "Titres suivis communs à tous les sites : réservés à l'animateur QHSE et à la direction." });
  });

  it('salarié d’un autre site que celui sélectionné : refusé', async () => {
    actAs('Chef de service', 'site_b');
    expect(await setRequirement('tnguyen', 'formation.caces484', true)).toEqual({ error: 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.' });
  });
});

describe('action de recyclage reprise : lisible selon canReadAction (Integration, 15/10/2026)', () => {
  it('Salarié : numéro seul pour l’action d’un autre responsable ; décrite quand il en est responsable', async () => {
    actAs('Animateur QHSE');
    await legacyRenewal('A-909', 'tnguyen', 'habilitation.he');
    actAs('Salarié');
    const mine = async () => (await loadSkillMatrix()).rows.find((x) => x.person.id === 'tnguyen')?.cells.find((c) => c.title.id === 'habilitation.he');
    expect((await mine())?.renewal).toEqual({
      id: 'A-909', label: '', dueOn: '', status: '', statusLabel: 'Action QSE reprise', tone: 'neutral', pilot: '', planned: true, readable: false,
    });
    await (await db()).update(t.actions).set({ pilotId: 'tnguyen' }).where(eq(t.actions.id, 'A-909'));
    expect((await mine())?.renewal).toMatchObject({ id: 'A-909', label: 'Recyclage habilitation.he — tnguyen', statusLabel: 'À faire', readable: true });
    actAs('Animateur QHSE');
    expect((await cellOf('tnguyen', 'habilitation.he'))?.renewal).toMatchObject({ id: 'A-909', readable: true });
    await (await db()).update(t.actions).set({ status: 'abandonnee' }).where(eq(t.actions.id, 'A-909'));
  });
});

describe('setRequirement : titre requis pour un salarié', () => {
  it('retrait refusé tant que le recyclage repris n’est pas clos (Terminée comprise) ; titre qui n’est plus suivi, salarié sorti', async () => {
    actAs('Animateur QHSE');
    await legacyRenewal('A-907', 'mgirard', 'habilitation.he');
    const refused = "L'action A-907 (recyclage) n'est pas close : le service QHSE doit la clôturer ou l'abandonner avant le retrait de l'exigence.";
    expect(await setRequirement('mgirard', 'habilitation.he', false)).toEqual({ error: refused });
    await (await db()).update(t.actions).set({ status: 'terminee', doneOn: '2026-10-06' }).where(eq(t.actions.id, 'A-907'));
    expect(await setRequirement('mgirard', 'habilitation.he', false)).toEqual({ error: refused });
    expect((await cellOf('mgirard', 'habilitation.he'))?.renewal).toMatchObject({ id: 'A-907', planned: false });
    await legacyRenewal('A-908', 'kbernard', 'formation.sst', 'verifiee');
    expect(await setRequirement('kbernard', 'formation.sst', false)).toEqual({});
    expect(await requirement('kbernard', 'formation.sst')).toBeUndefined();
    expect(await cellOf('kbernard', 'formation.sst')).toMatchObject({ required: false, renewal: null, pastRenewals: [expect.objectContaining({ id: 'A-908', planned: false })] });
    expect(await setRequirement('tnguyen', 'formation.pontier', true)).toEqual({ error: "Titre qui n'est plus suivi : suivez-le à nouveau pour modifier ses exigences." });
    expect(await setRequirement('ylambert', 'formation.sst', true)).toEqual({ error: "Salarié sorti de l'effectif." });
    expect(await setRequirement('inconnu', 'formation.sst', true)).toEqual({ error: 'Salarié ou titre introuvable.' });
  });
});

describe('personnel : sortie de l’effectif et réintégration', () => {
  const CURSUS_EXIT = 'Fiche tenue par Cursus : la sortie de l’effectif se déclare dans Cursus (RH), Vigie la reprend au rafraîchissement.';
  it('fiche tenue par Cursus (matricule) : sortie et réintégration refusées (D01, CV-10)', async () => {
    actAs('Animateur QHSE');
    expect(await setPersonLeft({}, form({ id: 'mgirard', leftOn: '2026-10-09', leftReason: 'Démission' }))).toEqual({ error: CURSUS_EXIT });
    expect(await reinstatePerson({}, form({ id: 'ylambert', reason: 'Retour' }))).toEqual({ error: CURSUS_EXIT });
  });
  it('fiche ancienne sans matricule : sortie refusée tant qu’un recyclage est ouvert ; date et motif obligatoires', async () => {
    actAs('Animateur QHSE');
    // Fiche du jeu rendue « ancienne » le temps du test (recyclage A-907 rattaché à ses exigences).
    await exec(`update people set matricule = null where id = 'mgirard'`);
    expect(await setPersonLeft({}, form({ id: 'mgirard', leftOn: '2026-10-09', leftReason: 'Démission' }))).toEqual({
      error: 'Recyclage encore ouvert (A-907) : le service QHSE doit clôturer ou abandonner ces actions avant la déclaration de sortie.',
    });
    await exec(`update people set matricule = 'EMP-9002' where id = 'mgirard'`);
    expect(await setPersonLeft({}, form({ id: 'nlegrand', leftOn: '', leftReason: '' }))).toMatchObject({ fieldErrors: { leftOn: 'Date obligatoire.', leftReason: 'Motif obligatoire.' } });
  });
  it('fiche ancienne : sortie puis réintégration, journalisées', async () => {
    actAs('Animateur QHSE');
    expect(await setPersonLeft({}, form({ id: 'nlegrand', leftOn: '2026-10-09', leftReason: 'Mutation dans une autre filiale' }))).toEqual({ ok: true, id: 'nlegrand' });
    expect(await lastLog('person', 'nlegrand')).toMatchObject({ action: 'archive', reason: 'Mutation dans une autre filiale', byId: 'clefevre' });
    expect(await reinstatePerson({}, form({ id: 'nlegrand', reason: 'Sortie annulée' }))).toEqual({ ok: true, id: 'nlegrand' });
    expect(await person('nlegrand')).toMatchObject({ leftOn: null, leftReason: null });
  });
  it('salarié sorti d’après Cursus : titres conservés en consultation, exigences figées', async () => {
    actAs('Animateur QHSE');
    await exec(`update cursus.${substituteTable('pub_salaries')} set sortie = '2026-10-09', actif = false where matricule = 'EMP-9008'`);
    await refreshSharedReferences(await db());
    expect(await person('lmoreau')).toMatchObject({ leftOn: '2026-10-09', leftReason: 'Sortie enregistrée dans Cursus' });
    expect(await lastLog('person', 'lmoreau')).toMatchObject({ action: 'archive', byId: null, summary: 'Sortie enregistrée dans Cursus (le 09/10/2026)' });
    const { archive } = await loadSkillData();
    expect(archive.filter((r) => r.person.id === 'lmoreau').map((r) => r.title.id)).toEqual(expect.arrayContaining(['formation.accueil', 'formation.sst', 'formation.auditeur_interne']));
    expect(await setRequirement('lmoreau', 'formation.sst', false)).toEqual({ error: "Salarié sorti de l'effectif." });
    await reinstall();
    await refreshSharedReferences(await db());
    expect(await person('lmoreau')).toMatchObject({ leftOn: null, leftReason: null });
    expect(await lastLog('person', 'lmoreau')).toMatchObject({ action: 'restore', byId: null, summary: 'Sortie annulée dans Cursus' });
  });
});

describe('titres suivis (D08) : catalogue de Cursus', () => {
  it('suivre un titre du catalogue : intitulé et validité de Cursus, attributs propres, journal ; doublons et titre inconnu refusés', async () => {
    actAs('Animateur QHSE');
    const { choices } = await loadTitleChoices();
    expect(choices.map(([id]) => id)).toEqual(['formation.aipr', 'habilitation.ac484', 'formation.elec']);
    expect(await followTitle({}, form({ titleId: '' }))).toMatchObject({ fieldErrors: { titleId: expect.any(String) } });
    expect(await followTitle({}, form({ titleId: 'formation.sst' }))).toMatchObject({ fieldErrors: { titleId: 'Ce titre est déjà suivi.' } });
    expect(await followTitle({}, form({ titleId: 'formation.pontier' }))).toMatchObject({ fieldErrors: { titleId: 'Titre qui n’est plus suivi : suivez-le à nouveau.' } });
    expect(await followTitle({}, form({ titleId: 'formation.inconnu' }))).toMatchObject({ fieldErrors: { titleId: 'Titre absent du catalogue de Cursus.' } });
    expect(await followTitle({}, form({ titleId: 'formation.aipr', awareness: 'on' }))).toEqual({ ok: true, id: 'formation.aipr' });
    const [ti] = await (await db()).select().from(t.trainingTitles).where(eq(t.trainingTitles.id, 'formation.aipr'));
    expect(ti).toMatchObject({ label: 'AIPR', validityMonths: 60, awareness: true, firstAid: false, cursusState: 'actif', sort: 10 });
    expect(await lastLog('training_title', 'formation.aipr')).toMatchObject({ action: 'create', byId: 'clefevre', summary: 'Titre « AIPR » suivi (catalogue de Cursus : formation.aipr) — sensibilisation' });
    expect((await loadSkillData()).titles.at(-1)?.id).toBe('formation.aipr');
  });

  it('attributs propres au QHSE modifiés (journal) ; intitulé jamais saisi ; ordre (HAB-15)', async () => {
    actAs('Direction');
    expect(await saveTitle({}, form({ id: 'formation.aipr', label: 'Autre', firstAidField: '1', awarenessField: '1', internalAuditorField: '1', internalAuditor: 'on' }))).toEqual({ ok: true, id: 'formation.aipr' });
    const [ti] = await (await db()).select().from(t.trainingTitles).where(eq(t.trainingTitles.id, 'formation.aipr'));
    expect(ti).toMatchObject({ label: 'AIPR', awareness: false, internalAuditor: true });
    expect(await lastLog('training_title', 'formation.aipr')).toMatchObject({ action: 'update', details: [
      { field: 'Sensibilisation', from: 'oui', to: 'non' }, { field: 'Auditeur interne', from: 'non', to: 'oui' },
    ] });
    expect(await moveTitle('formation.aipr', 'up')).toEqual({});
    expect(await lastLog('training_title', 'formation.aipr')).toMatchObject({ action: 'move' });
  });

  it('catalogue rafraîchi depuis Cursus : intitulé, validité et absence journalisés sans auteur', async () => {
    await exec(`update cursus.${substituteTable('pub_titres')} set libelle_court = 'AIPR opérateur', validite_mois = null where titre_id = 'formation.aipr'`);
    await exec(`delete from cursus.${substituteTable('pub_titres')} where titre_id = 'habilitation.atex'`);
    const results = await refreshSharedReferences(await db());
    expect(results.find((r) => r.source === 'titles')).toMatchObject({ status: 'ok', updated: 2, removed: 1 });
    expect(results.find((r) => r.source === 'heldTitles')).toMatchObject({ status: 'ok' });
    const titles = await (await db()).select().from(t.trainingTitles);
    expect(titles.find((x) => x.id === 'formation.aipr')).toMatchObject({ label: 'AIPR opérateur', validityMonths: 0, cursusState: 'actif' });
    expect(titles.find((x) => x.id === 'habilitation.atex')).toMatchObject({ cursusState: 'absent', archivedAt: null });
    expect(await lastLog('training_title', 'formation.aipr')).toMatchObject({ action: 'sync', byId: null, details: [
      { field: 'Intitulé', from: 'AIPR', to: 'AIPR opérateur' }, { field: 'Validité', from: '60 mois', to: 'sans échéance' },
    ] });
    await reinstall();
    await refreshSharedReferences(await db());
  });

  it('ne plus suivre : motif obligatoire, refusé avec un recyclage ouvert ; suivre à nouveau', async () => {
    actAs('Animateur QHSE');
    expect(await archiveTitle({}, form({ id: 'habilitation.he', reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await archiveTitle({}, form({ id: 'habilitation.he', reason: 'Plus suivi' }))).toEqual({
      error: 'Recyclage encore ouvert (A-907) : le service QHSE doit clôturer ou abandonner ces actions avant de ne plus suivre le titre.',
    });
    expect(await archiveTitle({}, form({ id: 'formation.aipr', reason: 'Plus de travaux à proximité des réseaux' }))).toEqual({ ok: true, id: 'formation.aipr' });
    expect(await archiveTitle({}, form({ id: 'formation.aipr', reason: 'Encore' }))).toEqual({ error: "Ce titre n'est déjà plus suivi." });
    expect(await saveTitle({}, form({ id: 'formation.aipr', firstAidField: '1' }))).toEqual({ error: "Titre qui n'est plus suivi : suivez-le à nouveau pour le modifier." });
    expect(await restoreTitle({}, form({ id: 'formation.aipr', reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await restoreTitle({}, form({ id: 'formation.aipr', reason: 'Chantier de terrassement' }))).toEqual({ ok: true, id: 'formation.aipr' });
    expect((await changeLog('training_title', 'formation.aipr')).map((l) => l.action)).toEqual(['create', 'update', 'move', 'sync', 'sync', 'archive', 'restore']);
  });

  it('catalogue de Cursus indisponible : aucun choix, suivi refusé avec le message de la source', async () => {
    await exec('drop view cursus.pub_titres');
    actAs('Animateur QHSE');
    expect(await loadTitleChoices()).toEqual({ choices: [], message: expect.stringContaining('Titres de Cursus indisponibles') });
    expect(await followTitle({}, form({ titleId: 'formation.elec' }))).toEqual({ error: expect.stringContaining('Titres de Cursus indisponibles') });
    await reinstall();
  });
});
