import { beforeAll, describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { toParisLocal } from '@/lib/dates';
import { loadNotifications } from '@/lib/data/notifications';
import { loadSkillData } from '@/lib/data/skills';
import { loadTodo } from '@/lib/data/todo';
import { loadWatch, loadWatchSignals } from '@/lib/data/watch';
import { todoKey } from '@/lib/domain';
import { saveAnalysis, setAnalysisMethod } from '@/server/events';
import { markNotificationsRead } from '@/server/notifications';
import { abandonAction } from '@/server/plan-ui';
import { savePermit, savePlan } from '@/server/prevention';
import { restoreWorkUnit, saveWorkUnit } from '@/server/risks';
import { saveActivity } from '@/server/sitemap';

// Paquet 4 — cohérence des données : analyse des causes après « Actions » (EVT-11), plan, permis et activités de la carte
// (PRV-11), unités d'un site archivé (DUE-05), anciens recyclages (HAB-04), échéance et périmètre des exigences de veille
// (VEI-03, VEI-06), état lu des échéances avec gravité et date (TDB-07). Server actions : droits, site, motif, journal.

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';
const db = () => getDb();

describe('EVT-11 : analyse des causes après l’étape « Actions »', () => {
  const ID = 'EV-2026-131'; // méthode « Arbre des causes », quatre méthodes renseignées ; amené à l'étape « Actions »
  const emptyTree = () => form({ eventId: ID, method: 'tree' });
  beforeAll(async () => { await (await getDb()).update(t.events).set({ step: 3 }).where(eq(t.events.id, ID)); });

  it('droits et site avant tout contrôle', async () => {
    actAs('Salarié', 'ville-a');
    expect(await saveAnalysis({}, emptyTree())).toEqual({ error: DENIED });
    expect(await setAnalysisMethod(ID, '5m')).toEqual({ error: DENIED });
    actAs('Animateur QHSE', 'ville-b');
    expect(await saveAnalysis({}, emptyTree())).toEqual({ error: OTHER_SITE });
  });

  it('l’analyse retenue ne se vide plus ; une autre méthode reste libre', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const before = (await changeLog('event', ID)).length;
    expect(await saveAnalysis({}, emptyTree())).toEqual({
      error: "Événement à l'étape « Actions » : l'analyse des causes ne peut plus être vidée (modifiez-la plutôt).",
    });
    expect(await changeLog('event', ID)).toHaveLength(before);
    const [tree] = await (await db()).select().from(t.eventAnalyses).where(and(eq(t.eventAnalyses.eventId, ID), eq(t.eventAnalyses.method, 'tree')));
    expect(tree).toBeDefined();
    // Méthode non retenue (5 pourquoi) : vidée, journalisée.
    expect(await saveAnalysis({}, form({ eventId: ID, method: 'why' }))).toEqual({ ok: true, id: ID });
    expect(await lastLog('event', ID)).toMatchObject({ summary: 'Analyse des causes (5 pourquoi) vidée', byId: 'clefevre' });
  });

  it('la méthode ne change que pour une méthode renseignée (journal)', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const refused = await setAnalysisMethod(ID, 'why');
    expect(refused.error).toMatch(/^Événement à l'étape « Actions » : la méthode d'analyse ne change que pour une méthode déjà renseignée/);
    expect((await (await db()).select().from(t.events).where(eq(t.events.id, ID)))[0].analysisMethod).toBe('tree');
    expect(await setAnalysisMethod(ID, '5m')).toEqual({});
    expect(await lastLog('event', ID)).toMatchObject({ details: [{ field: "Méthode d'analyse", from: 'Arbre des causes', to: '5M' }] });
  });
});

describe('PRV-11 : plan, permis et activités de la carte', () => {
  const activity = (over: Record<string, string>) => form({
    siteId: 'ville-a', title: 'Découpe de reprise', team: 'interne', ownerId: 'sbenali', startOn: '2026-10-05', endOn: '2026-10-05', ...over,
  });

  it('activité : permis annulé ou hors période refusé ; permis en vigueur accepté et journalisé', async () => {
    actAs('Salarié', 'ville-a');
    expect(await saveActivity({}, activity({ permitId: 'PF-2026-030' }))).toEqual({ error: DENIED });
    actAs('Chef de service', 'ville-a');
    expect(await saveActivity({}, activity({ permitId: 'PF-2026-028' })))
      .toMatchObject({ fieldErrors: { permitId: 'Le permis PF-2026-028 est annulé : demandez un nouveau permis.' } });
    expect(await saveActivity({}, activity({ permitId: 'PF-2026-030', startOn: '2026-10-12', endOn: '2026-10-13' })))
      .toMatchObject({ fieldErrors: { permitId: "Le permis PF-2026-030 est valable du 05/10 au 05/10/2026 : il ne couvre aucun jour de l'activité." } });
    const ok = await saveActivity({}, activity({ permitId: 'PF-2026-030' }));
    expect(ok).toMatchObject({ ok: true });
    expect(await lastLog('site_activity', Number(ok.id))).toMatchObject({ action: 'create', byId: 'sbenali' });
  });

  it('plan : sa période ne se réduit pas en deçà des activités rattachées', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const [p] = await (await db()).select().from(t.preventionPlans).where(eq(t.preventionPlans.id, 'PP-2026-015'));
    const before = (await changeLog('prevention_plan', p.id)).length;
    const r = await savePlan({}, form({
      id: p.id, contractorId: p.contractorId, siteId: p.siteId, title: p.title, location: p.location, startOn: p.startOn, endOn: '2026-10-12',
      estimatedHours: String(p.estimatedHours), dangerousWork: p.dangerousWork ? 'on' : '', keystoneProject: p.keystoneProject ?? '',
      inspectionOn: p.inspectionOn ?? '', interferenceRisks: p.interferenceRisks, measures: p.measures, ownerId: p.ownerId ?? '',
      eeHeadcount: p.eeHeadcount == null ? '' : String(p.eeHeadcount), eeSupervisor: p.eeSupervisor, subcontracting: p.subcontracting,
      dangerousPhases: p.dangerousPhases, equipment: p.equipment, workerInstructions: p.workerInstructions,
      emergencyOrganisation: p.emergencyOrganisation, coordination: p.coordination, sirPosts: p.sirPosts,
    }));
    expect(r.fieldErrors?.endOn).toBe("Activités de la carte rattachées après cette date (« Renforcement de la charpente de la mezzanine (soudage de platines) ») : modifiez leurs dates avant de réduire la période.");
    expect(await changeLog('prevention_plan', p.id)).toHaveLength(before);
  });

  it('permis demandé : sa validité recoupe toujours les activités rattachées', async () => {
    actAs('Chef de service', 'ville-b');
    const created = await saveActivity({}, form({
      siteId: 'ville-b', title: 'Essais BE-2', team: 'externe', contractorId: 'EE-005', ownerId: 'jpetit', startOn: '2026-10-12', endOn: '2026-10-12', permitId: 'PE-2026-009',
    }));
    expect(created).toMatchObject({ ok: true });
    const [p] = await (await db()).select().from(t.permits).where(eq(t.permits.id, 'PE-2026-009'));
    const permitForm = (over: Record<string, string>) => form({
      id: p.id, type: p.type, siteId: p.siteId, location: p.location, description: p.description, contractorId: p.contractorId ?? '', performer: p.performer,
      preventionPlanId: p.preventionPlanId ?? '', keystoneProject: p.keystoneProject ?? '', validFrom: toParisLocal(p.validFrom).slice(0, 16),
      validTo: toParisLocal(p.validTo).slice(0, 16), checklist: JSON.stringify(p.checklist), ...over,
    });
    const before = (await changeLog('permit', p.id)).length;
    const moved = await savePermit({}, permitForm({ validFrom: '2026-10-20T08:00', validTo: '2026-10-20T12:00' }));
    expect(moved.fieldErrors?.validTo).toBe('Activités de la carte rattachées hors de cette validité (« Essais BE-2 ») : modifiez leurs dates ou leur permis.');
    expect(await changeLog('permit', p.id)).toHaveLength(before);
    expect(await savePermit({}, permitForm({ validTo: '2026-10-12T16:00' }))).toEqual({ ok: true, id: p.id });
    expect(await lastLog('permit', p.id)).toMatchObject({ summary: 'Demande modifiée (validité)', byId: 'sbenali' });
  });
});

describe('DUE-05 : unités de travail d’un site archivé', () => {
  it('modifiée : garde son site archivé ; restauration refusée tant que le site est archivé (droits, motif, journal)', async () => {
    const d = await db();
    await d.insert(t.workUnits).values([
      { id: 'depot-c', label: 'Dépôt C', siteId: 'ville-c', sort: 90 },
      { id: 'quai-c', label: 'Quai C', siteId: 'ville-c', sort: 91, archivedAt: new Date('2026-03-31T16:00:00Z'), archivedById: 'clefevre', archiveReason: 'Dépôt fermé' },
    ]);
    actAs('Animateur QHSE', 'all');
    expect(await saveWorkUnit({}, form({ id: 'depot-c', label: 'Dépôt C (fermé)', siteId: 'ville-c' }))).toEqual({ ok: true, id: 'depot-c' });
    expect((await d.select().from(t.workUnits).where(eq(t.workUnits.id, 'depot-c')))[0]).toMatchObject({ label: 'Dépôt C (fermé)', siteId: 'ville-c' });
    expect(await lastLog('work_unit', 'depot-c')).toMatchObject({ action: 'update', details: [{ field: 'Libellé', from: 'Dépôt C', to: 'Dépôt C (fermé)' }] });

    actAs('Chef de service', 'all');
    expect(await restoreWorkUnit({}, form({ id: 'quai-c', reason: 'Réouverture' }))).toEqual({ error: "Réservé à l'animateur QHSE et à la direction." });
    actAs('Animateur QHSE', 'all');
    expect(await restoreWorkUnit({}, form({ id: 'quai-c' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await restoreWorkUnit({}, form({ id: 'quai-c', reason: 'Réouverture' })))
      .toEqual({ error: "Le site « Site de [Ville C] — ancien dépôt logistique » est archivé : restaurez-le avant de restaurer l'unité." });
    expect(await changeLog('work_unit', 'quai-c')).toEqual([]);
    // Site actif : restauration permise et journalisée.
    await d.update(t.workUnits).set({ siteId: 'ville-a' }).where(eq(t.workUnits.id, 'quai-c'));
    expect(await restoreWorkUnit({}, form({ id: 'quai-c', reason: 'Réouverture' }))).toEqual({ ok: true, id: 'quai-c' });
    expect(await lastLog('work_unit', 'quai-c')).toMatchObject({ action: 'restore', reason: 'Réouverture', byId: 'clefevre' });
  });
});

describe('HAB-04 : un recyclage repris garde son lien vers l’habilitation', () => {
  it('abandonné : toujours rattaché à la case, listé parmi les recyclages précédents', async () => {
    const d = await db();
    await d.insert(t.actions).values({
      id: 'A-930', openedOn: '2026-09-01', pilotId: 'clefevre', status: 'a_faire', dueOn: '2026-10-20', initialDueOn: '2026-10-20', source: null,
      originRef: 'Habilitations · mgirard', detail: 'Recyclage elec — mgirard', siteId: 'ville-a', legacyOrigin: 'skills',
      qualificationPersonId: 'mgirard', qualificationTitleId: 'elec',
    });
    await d.insert(t.qualificationRequirements).values({ personId: 'mgirard', titleId: 'elec' }).onConflictDoNothing();
    actAs('Animateur QHSE', 'ville-a');
    const cell = async () => (await loadSkillData()).rows.find((x) => x.person.id === 'mgirard')?.cells.find((c) => c.title.id === 'elec');
    expect((await cell())?.renewal).toMatchObject({ id: 'A-930', planned: true });
    expect(await abandonAction({}, form({ id: 'A-930', from: 'a_faire', reason: 'Recyclage géré par le service RH' }))).toMatchObject({ ok: true });
    expect((await d.select().from(t.actions).where(eq(t.actions.id, 'A-930')))[0]).toMatchObject({
      status: 'abandonnee', qualificationPersonId: 'mgirard', qualificationTitleId: 'elec',
    });
    expect(await cell()).toMatchObject({ renewal: null, pastRenewals: [expect.objectContaining({ id: 'A-930', readable: true, planned: false })] });
  });
});

describe('VEI-03 et VEI-06 : exigence suivie par des contrôles, jugée sur toute l’entreprise', () => {
  it('contrôles rattachés de tous les sites du périmètre ; échéance du prochain contrôle', async () => {
    actAs('Animateur QHSE', 'ville-b');
    const { requirements, controls } = await loadWatch();
    const lifting = requirements.find((r) => r.domain === 'Appareils de levage')!;
    expect(controls.some((c) => c.equipment.startsWith('Pont roulant'))).toBe(false); // onglet « Contrôles » : site sélectionné
    expect(lifting.controls.map((c) => [c.equipment.split(' — ')[0], c.siteLabel.split(' — ')[0]])).toEqual([
      ['Pont roulant 10 t', 'Site de [Ville A]'], ['Chariot élévateur R489', 'Site de [Ville A]'],
    ]);
    expect(lifting.due).toBe('02/10/2026 · prochain contrôle (VGP levage, pont roulant 10 t)');
    expect(lifting.dueFromControl).toBe(true);
    expect(lifting.suggestReason === null || lifting.suggestReason === 'Contrôle rattaché dépassé').toBe(true);
  });

  it('la date d’application saisie (figée) ne déclenche plus d’échéance', async () => {
    const d = await db();
    const [req] = await d.select().from(t.requirements).where(eq(t.requirements.domain, 'Appareils de levage'));
    await d.update(t.requirements).set({ evaluation: 'analyse', actionId: 'A-217' }).where(eq(t.requirements.id, req.id));
    actAs('Animateur QHSE', 'ville-a');
    const titles = (await loadWatchSignals()).todo.filter((x) => x.href === `/veille?exigence=${req.id}`).map((x) => x.title);
    expect(titles.some((x) => x.includes("date d'application"))).toBe(false);
  });
});

describe('TDB-07 : état lu avec gravité et date d’échéance, retards par ancienneté', () => {
  it('retards triés par date d’échéance réelle', async () => {
    actAs('Animateur QHSE', 'all');
    const overdue = (await loadTodo()).filter((x) => x.overdue && x.dueOn);
    expect(overdue.length).toBeGreaterThan(2);
    const dates = overdue.map((x) => x.dueOn!);
    expect(dates).toEqual([...dates].sort());
  });

  it('échéance lue, puis aggravée (dépassée) : de nouveau non lue ; ancien état lu sans gravité ni date ignoré', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const find = async () => (await loadNotifications()).find((n) => n.kind === 'Contrôle' && n.title.startsWith('VGP · chariot élévateur R489'));
    const upcoming = await find();
    expect(upcoming).toMatchObject({ tone: 'warn', dueOn: '2026-10-15', read: false });
    // État lu enregistré avant le paquet 4 (clé type|lien|intitulé) : ne correspond plus, l'échéance reste non lue.
    const legacy = ['Contrôle', upcoming!.href, upcoming!.title].join('|');
    await markNotificationsRead([legacy]);
    expect((await find())?.read).toBe(false);
    await markNotificationsRead([upcoming!.key]);
    expect((await find())?.read).toBe(true);
    // Contrôle décalé avant aujourd'hui : échéance dépassée, autre gravité et autre date → non lue.
    await (await db()).update(t.controls).set({ nextOn: '2026-10-05' }).where(eq(t.controls.equipment, 'Chariot élévateur R489'));
    const late = await find();
    expect(late).toMatchObject({ tone: 'danger', overdue: true, dueOn: '2026-10-05', read: false });
    expect(late!.key).not.toBe(upcoming!.key);
    expect(late!.key).toBe(todoKey({ ...late!, key: undefined }));
  });
});
