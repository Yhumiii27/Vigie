import { describe, expect, it, vi } from 'vitest';
import { cookieJar, form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { AuthState } from '@/lib/auth';
import { fmtEuro } from '@/lib/rules/risk-format';
import { loadEntityHistory, type HistoryEntity } from '@/server/history';
import { VACANT_QHSE_LEAD, isMine, type Role, type TodoItem } from '@/lib/domain';
import {
  loadDuerpAccessRegister, loadDuerpPrint, loadDuerpVersion, loadPreventionProgram, loadProgramSources, loadRiskSignals, loadRisks,
  programDefaultIds, riskLinkedActionIds,
} from '@/lib/data/risks';
import {
  addProgramAction, archiveRisk, cancelDuerpAccessRequest, createDuerpVersion, createPreventionProgram, freezePreventionProgram, moveRisk,
  removeProgramAction, reopenPreventionProgram, saveDuerpAccessRequest, saveProgramAction, saveRisk, saveWorkUnit,
  updateCurrentDuerpVersion, updatePreventionProgram,
} from '@/server/risks';

// DUERP du lot 2 : alertes des unités au responsable QHSE du site de l'unité (TDB-01), consultation par tous les rôles,
// impression et registre des mises à disposition (DUE-01), programme annuel de prévention (PAPRIPACT, DUE-02).
// Server actions : droits, site sélectionné et périmètre, motif, journal.

// Identité de la requête : démonstration (rôle choisi), ou identité imposée par un test (périmètre restreint).
const auth = vi.hoisted(() => ({ override: null as AuthState | null }));

/** Actions de l'historique d'une fiche, chargé à son ouverture (QUA-11) par la personne de la requête. */
async function historyActions(entity: HistoryEntity, id: string | number) {
  const r = await loadEntityHistory(entity, String(id));
  if ('error' in r) throw new Error(r.error);
  return r.entries.map((e) => e.action);
}

vi.mock('@/lib/auth', async (orig) => {
  const real = await orig<typeof import('@/lib/auth')>();
  return { ...real, getAuthState: async () => auth.override ?? real.getAuthState() };
});

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const OUTSIDE = 'Cet élément appartient à un site hors de votre périmètre.';
const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';
const FROZEN = 'Programme arrêté : rouvrez-le pour le modifier.';
/** Salariés sans lien avec [T. Nguyen] : leur nom ne doit pas parvenir à sa page (pilotes, événements, historique). */
const OTHER_PEOPLE = ['[M. Girard]', '[P. Roux]', '[A. Martin]', '[J. Petit]', '[R. Fontaine]', '[K. Bernard]', '[Y. Lambert]'];
const READERS: Role[] = ['Chef de projet', 'Salarié'];
const NON_APPROVERS: Role[] = ['Chef de service', 'Chef de projet', 'Salarié'];

/** Personne imposée avec un périmètre restreint au site B ([J. Petit], rattaché au site B). */
const restrictTo = (role: Role, site = 'ville-b') => {
  auth.override = { status: 'authenticated', identity: { personId: 'jpetit', role, siteIds: ['ville-b'] } };
  cookieJar.set('vigie_site', site);
};
const unrestrict = () => { auth.override = null; cookieJar.delete('vigie_site'); };

async function setLead(siteId: string, personId: string | null) {
  const db = await getDb();
  await db.update(t.sites).set({ qhseLeadId: personId }).where(eq(t.sites.id, siteId));
}
const unitAlerts = (todo: TodoItem[], unit: string) => todo.filter((x) => x.title.startsWith(`${unit} · `));

describe('TDB-01 : alertes des unités au responsable QHSE du site de l’unité', () => {
  it('deux sites, deux responsables ; poste vacant ; alertes du document unique', async () => {
    await setLead('ville-b', 'sbenali');
    actAs('Animateur QHSE', 'ville-b');
    expect(await saveRisk({}, form({
      unitId: 'essais', hazard: 'Bruit des bancs', situation: 'Essais moteurs prolongés sans encoffrement', gravity: '4', probability: '3',
      existingMeasures: 'Bouchons d’oreille', residualGravity: '4', residualProbability: '3',
    }))).toMatchObject({ ok: true });

    actAs('Animateur QHSE', 'all');
    let { todo } = await loadRiskSignals();
    const essais = unitAlerts(todo, "Zone d'essais");
    expect(essais.map((x) => x.title)).toContain("Zone d'essais · 1 risque ≥ 8 sans action de réduction");
    essais.forEach((x) => expect(x).toMatchObject({ ownerIds: ['sbenali'], who: '[S. Benali]', siteId: 'ville-b' }));
    const client = unitAlerts(todo, 'Mise en service chez le client');
    expect(client).toEqual([expect.objectContaining({ title: 'Mise en service chez le client · 2 risques ≥ 8 sans action de réduction', ownerIds: ['clefevre'], siteId: 'ville-a', count: 2 })]);

    // Poste vacant au site B : animateurs QHSE, « Responsable QHSE à désigner ».
    await setLead('ville-b', null);
    ({ todo } = await loadRiskSignals());
    unitAlerts(todo, "Zone d'essais").forEach((x) => expect(x).toMatchObject({ ownerIds: ['clefevre'], who: VACANT_QHSE_LEAD }));
    expect(unitAlerts(todo, 'Mise en service chez le client')[0]).toMatchObject({ ownerIds: ['clefevre'], who: '[C. Lefèvre]' });

    // Alerte du document unique (siteId null) : validateur de la version et responsables des deux sites.
    await setLead('ville-b', 'sbenali');
    expect(await updateCurrentDuerpVersion({}, form({ version: '2026.1', validatedById: 'hmarchand', cseConsultedOn: '' }))).toMatchObject({ ok: true });
    ({ todo } = await loadRiskSignals());
    const cse = todo.find((x) => x.title === 'Consultation du CSE à renseigner · DUERP 2026.1');
    expect(cse).toMatchObject({ siteId: null, who: '[H. Marchand]' });
    expect([...cse!.ownerIds!].sort()).toEqual(['clefevre', 'hmarchand', 'sbenali']);

    // Chef de service, responsable du site B : parmi les alertes d'unités, celles de la zone d'essais seulement.
    actAs('Chef de service', 'all');
    ({ todo } = await loadRiskSignals());
    const mine = todo.filter((x) => isMine(x, { id: 'sbenali', name: '[S. Benali]' }));
    const mineUnits = mine.filter((x) => x.siteId !== null);
    expect(mineUnits.length).toBe(essais.length);
    expect(mineUnits.every((x) => x.title.startsWith("Zone d'essais · "))).toBe(true);
    // Les alertes communes (document unique, PAPRIPACT) le visent aussi, comme responsable d'un site actif.
    expect(mine.filter((x) => x.siteId === null).map((x) => x.title).sort()).toEqual(['Consultation du CSE à renseigner · DUERP 2026.1', 'PAPRIPACT 2026 : consultation du CSE à renseigner']);

    actAs('Animateur QHSE', 'all');
    expect(await updateCurrentDuerpVersion({}, form({ version: '2026.1', validatedById: 'hmarchand', cseConsultedOn: '2026-03-20' }))).toMatchObject({ ok: true });
    await setLead('ville-b', 'clefevre');
  });
});

describe('DUE-01 : DUERP consultable par tous les rôles', () => {
  it('chef de projet et salarié : lecture seule, sans archives, actions à rattacher ni historique', async () => {
    actAs('Animateur QHSE', 'all');
    const [noise] = await (await getDb()).select({ id: t.risks.id }).from(t.risks).where(eq(t.risks.hazard, 'Bruit des bancs'));
    expect(await archiveRisk({}, form({ id: String(noise.id), reason: 'Saisi pour le test des destinataires' }))).toMatchObject({ ok: true });
    const full = await loadRisks();
    expect(full).toMatchObject({ readOnly: false, employee: false });
    expect(full.archivedRisks.length).toBeGreaterThan(0);
    expect(full.linkableActions.length).toBeGreaterThan(0);
    // Actions non closes seulement, libellé court (actionLabel).
    expect(full.linkableActions.map((a) => a.id)).not.toContain('A-176'); // Vérifiée
    expect(full.linkableActions.map((a) => a.id)).not.toContain('A-180'); // Abandonnée
    expect(full.linkableActions.find((a) => a.id === 'A-172')?.label).toMatch(/^A-172 · Arrimer les bouteilles/); // Terminée
    expect(full.actionsQhse).toBe(true);

    // Chef de service : saisit le DUERP, mais les actions QSE sont créées et rattachées par le service QHSE (ACT-22).
    actAs('Chef de service', 'all');
    const cs = await loadRisks();
    expect(cs).toMatchObject({ readOnly: false, actionsQhse: false, linkableActions: [] });
    // Historique chargé à l'ouverture de la fiche (QUA-11), pour qui modifie le DUERP.
    expect(full.archivedRisks.some((r) => r.id === noise.id)).toBe(true);
    expect(await historyActions('risk', noise.id)).toEqual(['archive', 'create']);

    actAs('Chef de projet', 'all');
    const cp = await loadRisks();
    expect(cp).toMatchObject({ readOnly: true, employee: false, archivedRisks: [], archivedUnits: [], linkableActions: [] });
    expect(cp.risks.length).toBe(full.risks.length);
    expect(await loadEntityHistory('risk', String(cp.risks[0].id))).toEqual({ error: 'Historique introuvable.' });
    expect(cp.risks.some((r) => r.events.length > 0)).toBe(true);
    expect(cp.risks.flatMap((r) => r.actions).some((a) => a.pilot)).toBe(true);

    actAs('Salarié', 'all');
    const emp = await loadRisks();
    expect(emp).toMatchObject({ readOnly: true, employee: true, archivedRisks: [], archivedUnits: [], linkableActions: [] });
    expect(emp.risks.length).toBe(full.risks.length);
    expect(emp.risks.every((r) => r.events.length === 0)).toBe(true);
    expect(await loadEntityHistory('risk', String(emp.risks[0].id))).toEqual({ error: 'Historique introuvable.' });
    const actions = emp.risks.flatMap((r) => r.actions);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a) => a.pilot === '' && !!a.title && !!a.dueOn)).toBe(true);
    const json = JSON.stringify(emp);
    OTHER_PEOPLE.forEach((name) => expect(json, name).not.toContain(name));
  });

  it('versions et version imprimable : consultables, sans pilote', async () => {
    for (const role of READERS) {
      actAs(role, 'all');
      expect(await loadDuerpVersion('2025.1')).toMatchObject({ version: '2025.1', current: false, snapshot: {} });
      const print = await loadDuerpPrint();
      expect(print.version).toMatchObject({ version: '2026.1', validatedBy: '[H. Marchand]', cseConsultedOn: '2026-03-20' });
      expect(print.risks.length).toBeGreaterThan(0);
      expect(print.risks.some((r) => r.hazard === 'Bruit des bancs')).toBe(false); // archivé
      expect(print.actionInfo['A-214']).toEqual({ title: expect.stringContaining('élingues'), dueOn: '2026-10-17', status: '40 %' });
      expect(print.actionInfo['A-203']).toMatchObject({ status: 'En retard' });
      const json = JSON.stringify(print);
      OTHER_PEOPLE.forEach((name) => expect(json, name).not.toContain(name));
    }
    actAs('Salarié', 'ville-b');
    const siteB = await loadDuerpPrint();
    expect(siteB.siteLabel).toContain('Ville B');
    expect(siteB.units.every((u) => u.siteId === 'ville-b' || u.siteId === null)).toBe(true);
  });

  it('saisie refusée au chef de projet et au salarié', async () => {
    const risk = { id: '1', unitId: 'montage', hazard: 'Manutention mécanique', situation: 'Levage', gravity: '4', probability: '2', existingMeasures: '', residualGravity: '4', residualProbability: '1' };
    for (const role of READERS) {
      actAs(role, 'ville-a');
      expect(await saveRisk({}, form(risk)), role).toEqual({ error: DENIED });
      expect(await saveWorkUnit({}, form({ label: 'Nouvelle unité', siteId: 'ville-a' })), role).toEqual({ error: DENIED });
      expect(await archiveRisk({}, form({ id: '1', reason: 'Test' })), role).toEqual({ error: DENIED });
      expect(await moveRisk(1, 'down'), role).toEqual({ error: DENIED });
      expect(await createDuerpVersion({}, form({ version: '2026.2', validatedById: 'hmarchand' })), role).toEqual({ error: APPROVERS_ONLY });
    }
  });

  it('chef de projet : ses propres alertes du DUERP seulement (consultation)', async () => {
    actAs('Chef de projet', 'all');
    expect((await loadRiskSignals()).todo).toEqual([]);
    await setLead('ville-a', 'edubois');
    const { todo, badge } = await loadRiskSignals();
    expect(todo.length).toBeGreaterThan(0);
    expect(todo.every((x) => x.ownerIds?.includes('edubois'))).toBe(true);
    expect(todo.some((x) => x.siteId === 'ville-a')).toBe(true);
    expect(todo.filter((x) => x.siteId !== null).every((x) => x.siteId === 'ville-a')).toBe(true);
    expect(badge).toBe(todo.reduce((n, x) => n + (x.count ?? 1), 0));
    await setLead('ville-a', 'clefevre');
  });
});

describe('DUE-01 : registre des mises à disposition', () => {
  const request = { requestedOn: '2026-10-01', requesterKind: 'cse', requesterName: 'CSE — réunion extraordinaire', siteId: 'ville-a', version: '2026.1', communicatedOn: '', channel: '', note: '' };

  it('droits : animateur QHSE et direction seulement, en lecture comme en saisie', async () => {
    for (const role of NON_APPROVERS) {
      actAs(role, 'ville-a');
      expect(await saveDuerpAccessRequest({}, form(request)), role).toEqual({ error: APPROVERS_ONLY });
      expect(await cancelDuerpAccessRequest({}, form({ id: '3', reason: 'Test' })), role).toEqual({ error: APPROVERS_ONLY });
      expect(await loadDuerpAccessRegister(), role).toEqual({ requests: [], versions: [], pending: 0 });
    }
    actAs('Direction', 'all');
    const reg = await loadDuerpAccessRegister();
    expect(reg.pending).toBe(1);
    expect(reg.requests.map((r) => r.requestedOn)).toEqual(['2026-10-05', '2026-04-02', '2026-03-20']);
    expect(reg.versions[0]).toEqual(['2026.1', '2026.1 (en vigueur)']);
    expect(reg.requests[0]).toMatchObject({ requesterKindLabel: 'Ancien salarié', version: '2024.1', pending: true, cancelled: null });
  });

  it('validation : version inconnue, dates, modalité', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await saveDuerpAccessRequest({}, form({ ...request, version: '1999.1' }))).toMatchObject({ fieldErrors: { version: 'Version inconnue.' } });
    expect(await saveDuerpAccessRequest({}, form({ ...request, communicatedOn: '2026-09-30', channel: 'papier' }))).toMatchObject({ fieldErrors: { communicatedOn: 'Antérieure à la demande.' } });
    expect(await saveDuerpAccessRequest({}, form({ ...request, requestedOn: '2026-10-10' }))).toMatchObject({ fieldErrors: { requestedOn: "Date postérieure à aujourd'hui." } });
    expect(await saveDuerpAccessRequest({}, form({ ...request, communicatedOn: '2026-10-02' }))).toMatchObject({ fieldErrors: { channel: 'Modalité obligatoire une fois le DUERP communiqué.' } });
    expect(await saveDuerpAccessRequest({}, form({ ...request, requesterKind: 'voisin' }))).toMatchObject({ fieldErrors: { requesterKind: 'Valeur non autorisée.' } });
    expect(await saveDuerpAccessRequest({}, form({ ...request, siteId: 'inconnu' }))).toMatchObject({ fieldErrors: { siteId: 'Site inconnu.' } });
  });

  it('site sélectionné et périmètre', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await saveDuerpAccessRequest({}, form({ ...request, siteId: 'ville-b' }))).toMatchObject({ error: OTHER_SITE });

    // Animateur QHSE au périmètre restreint au site B : ni lecture ni annulation d'une demande du site A.
    restrictTo('Animateur QHSE');
    const reg = await loadDuerpAccessRegister();
    expect(reg.requests.length).toBeGreaterThan(0);
    expect(reg.requests.every((r) => r.siteId === null)).toBe(true);
    expect(reg.pending).toBe(0);
    expect(await cancelDuerpAccessRequest({}, form({ id: '3', reason: 'Hors périmètre' }))).toEqual({ error: OUTSIDE });
    expect(await saveDuerpAccessRequest({}, form({ ...request, id: '3', requesterKind: 'ancien_salarie', version: '2024.1' }))).toEqual({ error: OUTSIDE });
    unrestrict();
  });

  it('journal : création, modification détaillée, annulation motivée ; demande annulée figée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const created = await saveDuerpAccessRequest({}, form(request));
    expect(created).toMatchObject({ ok: true });
    const id = created.id!;
    expect(await lastLog('duerp_access_request', id)).toMatchObject({ action: 'create', byId: 'clefevre', summary: "Demande d'accès enregistrée · CSE · DUERP 2026.1" });

    expect(await saveDuerpAccessRequest({}, form({ ...request, id, communicatedOn: '2026-10-02', channel: 'papier' }))).toEqual({ ok: true, id });
    expect(await lastLog('duerp_access_request', id)).toMatchObject({
      action: 'update', summary: 'DUERP 2026.1 communiqué le 02/10/2026',
      details: [{ field: 'Communiquée le', from: null, to: '02/10/2026' }, { field: 'Modalité', from: null, to: 'Copie papier remise' }],
    });
    expect(await saveDuerpAccessRequest({}, form({ ...request, id, communicatedOn: '2026-10-02', channel: 'papier', siteId: '', requesterKind: 'inspection' }))).toEqual({ ok: true, id });
    expect((await lastLog('duerp_access_request', id))!.details).toEqual([
      { field: 'Demandeur', from: 'CSE', to: 'Inspection du travail' },
      { field: 'Site', from: 'Site de [Ville A] — siège et ateliers', to: 'Tous les sites' },
    ]);

    expect(await cancelDuerpAccessRequest({}, form({ id, reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await cancelDuerpAccessRequest({}, form({ id, reason: 'Saisie en double' }))).toEqual({ ok: true, id });
    expect(await lastLog('duerp_access_request', id)).toMatchObject({ action: 'cancel', reason: 'Saisie en double', byId: 'clefevre' });
    expect(await saveDuerpAccessRequest({}, form({ ...request, id, note: 'Complément' }))).toEqual({ error: 'Demande annulée : elle ne peut plus être modifiée.' });
    expect(await cancelDuerpAccessRequest({}, form({ id, reason: 'Encore' }))).toEqual({ error: 'Demande déjà annulée.' });
    expect((await changeLog('duerp_access_request', id)).map((e) => e.action)).toEqual(['create', 'update', 'update', 'cancel']);

    const row = (await loadDuerpAccessRegister()).requests.find((r) => r.id === Number(id));
    expect(row).toMatchObject({ pending: false, cancelled: { by: '[C. Lefèvre]', reason: 'Saisie en double' } });
    expect(await historyActions('duerp_access_request', id)).toEqual(['cancel', 'update', 'update', 'create']);
  });

  it('échéance : demande en attente pour l’animateur QHSE et la direction, sans le nom du demandeur', async () => {
    actAs('Animateur QHSE', 'all');
    const access = (await loadRiskSignals()).todo.filter((x) => x.key?.startsWith('duerp-access|'));
    expect(access).toEqual([expect.objectContaining({
      title: "Demande d'accès au DUERP à traiter · Ancien salarié", href: '/risques?registre=1', key: 'duerp-access|3',
      siteId: 'ville-a', tone: 'warn', date: '2026-10-05', ownerIds: ['clefevre'],
    })]);
    expect(JSON.stringify(access)).not.toContain('Vasseur');
    for (const role of NON_APPROVERS) {
      actAs(role, 'all');
      expect((await loadRiskSignals()).todo.some((x) => x.key?.startsWith('duerp-access|')), role).toBe(false);
    }
  });
});

describe('DUE-02 : programme annuel de prévention (PAPRIPACT)', () => {
  const line = (year: number, actionId: string, extra: Record<string, string> = {}) => form({ year: String(year), actionId, ...extra });

  it('création : droits, bornes, doublon, reprise des actions du DUERP, journal', async () => {
    for (const role of NON_APPROVERS) {
      actAs(role, 'all');
      expect(await createPreventionProgram({}, form({ year: '2027' })), role).toEqual({ error: APPROVERS_ONLY });
    }
    actAs('Animateur QHSE', 'all');
    expect(await createPreventionProgram({}, form({ year: '2024' }))).toMatchObject({ fieldErrors: { year: 'Minimum 2025.' } });
    expect(await createPreventionProgram({}, form({ year: '2028' }))).toMatchObject({ fieldErrors: { year: 'Maximum 2027.' } });
    expect(await createPreventionProgram({}, form({ year: '2026' }))).toMatchObject({ fieldErrors: { year: 'Un programme existe déjà pour cette année.' } });
    const db = await getDb();
    const sources = await loadProgramSources(db);
    const expected = programDefaultIds(sources.actions, riskLinkedActionIds(sources), 2027);
    // Actions non closes à date cible 2026 (report : Terminée A-172 comprise, Vérifiées A-170/A-176 exclues), par date cible
    // puis numéro ; A-222 = suite de A-176, rattachée au même risque (D21).
    expect(expected).toEqual(['A-203', 'A-198', 'A-201', 'A-172', 'A-205', 'A-209', 'A-214', 'A-222', 'A-215']);
    const before = await loadPreventionProgram(2027);
    expect(before).toMatchObject({ program: null, creatable: true, prefillCount: expected.length, currentVersion: '2026.1' });
    expect(await createPreventionProgram({}, form({ year: '2027', comment: 'Report des actions ouvertes' }))).toEqual({ ok: true, id: '2027' });
    const rows = await db.select().from(t.preventionProgramActions).where(eq(t.preventionProgramActions.year, 2027));
    expect(rows.map((r) => r.actionId).sort()).toEqual([...expected].sort());
    expect(await lastLog('prevention_program', '2027')).toMatchObject({ action: 'create', byId: 'clefevre', summary: 'Programme 2027 créé · 9 actions reprises du DUERP 2026.1' });
    expect((await db.select().from(t.preventionPrograms).where(eq(t.preventionPrograms.year, 2027)))[0]).toMatchObject({ duerpVersion: '2026.1', comment: 'Report des actions ouvertes', frozenAt: null });
    expect(await createPreventionProgram({}, form({ year: '2027' }))).toMatchObject({ fieldErrors: { year: 'Un programme existe déjà pour cette année.' } });

    // Objet du programme, journal détaillé.
    expect(await updatePreventionProgram({}, form({ year: '2027', comment: 'Report des actions ouvertes de 2026' }))).toEqual({ ok: true, id: '2027' });
    expect(await lastLog('prevention_program', '2027')).toMatchObject({
      action: 'update', details: [{ field: 'Objet', from: 'Report des actions ouvertes', to: 'Report des actions ouvertes de 2026' }],
    });
  });

  it('lignes : action non rattachée ou abandonnée refusée, site de l’action, journal détaillé', async () => {
    actAs('Chef de service', 'all');
    expect(await addProgramAction({}, line(2026, 'A-215'))).toEqual({ error: APPROVERS_ONLY });
    expect(await saveProgramAction({}, line(2026, 'A-205'))).toEqual({ error: APPROVERS_ONLY });
    expect(await removeProgramAction({}, line(2026, 'A-205'))).toEqual({ error: APPROVERS_ONLY });

    actAs('Animateur QHSE', 'all');
    expect(await addProgramAction({}, line(2026, 'A-212'))).toEqual({ error: "Action sans risque du DUERP en vigueur : rattachez-la d'abord à un risque." });
    expect(await addProgramAction({}, line(2026, 'A-180'))).toEqual({ error: 'Action abandonnée : elle ne peut pas entrer au programme.' });
    expect(await addProgramAction({}, line(2026, 'A-999'))).toEqual({ error: 'Action introuvable.' });
    expect(await addProgramAction({}, line(2031, 'A-215'))).toEqual({ error: 'Programme introuvable.' });
    expect(await addProgramAction({}, line(2026, 'A-215', { estimatedCost: '20000000' }))).toMatchObject({ fieldErrors: { estimatedCost: 'Montant trop élevé.' } });
    expect(await addProgramAction({}, line(2026, 'A-215', { estimatedCost: '-5' }))).toMatchObject({ fieldErrors: { estimatedCost: 'Minimum 0.' } });
    expect(await saveProgramAction({}, line(2026, 'A-215'))).toEqual({ error: 'Action absente du programme.' });

    // A-203 (site B) : refusée avec le site A sélectionné, admise sur « Tous les sites ».
    actAs('Animateur QHSE', 'ville-a');
    expect(await removeProgramAction({}, line(2026, 'A-203'))).toEqual({ error: OTHER_SITE });
    actAs('Animateur QHSE', 'all');
    expect(await removeProgramAction({}, line(2026, 'A-203'))).toEqual({ ok: true, id: 'A-203' });
    expect(await lastLog('prevention_program', '2026')).toMatchObject({
      action: 'remove', summary: 'Action A-203 retirée du programme',
      details: [
        { field: 'Coût estimé', from: fmtEuro(12000), to: null },
        { field: 'Ressources', from: 'Électricien ATEX externe', to: null },
        { field: 'Indicateur', from: 'Vérification ATEX sans écart', to: null },
      ],
    });
    // Ligne ajoutée : le coût estimé de l'action est proposé (DUE-02, spec § 11), seulement pour les actions proposées.
    const draft = await loadPreventionProgram(2026);
    expect(draft.candidates.map(([id]) => id)).toContain('A-203');
    expect(draft.candidateCosts['A-203']).toBe(12000);
    expect(Object.hasOwn(draft.candidateCosts, 'A-215')).toBe(false); // sans coût estimé
    expect(Object.keys(draft.candidateCosts).every((id) => draft.candidates.some(([c]) => c === id))).toBe(true);
    actAs('Animateur QHSE', 'ville-a');
    expect(await addProgramAction({}, line(2026, 'A-203', { estimatedCost: '12000' }))).toEqual({ error: OTHER_SITE });
    actAs('Animateur QHSE', 'all');
    expect(await addProgramAction({}, line(2026, 'A-203', { estimatedCost: '12000', resources: 'Électricien ATEX externe' }))).toEqual({ ok: true, id: 'A-203' });
    expect(await lastLog('prevention_program', '2026')).toMatchObject({
      action: 'add', summary: 'Action A-203 ajoutée au programme',
      details: [{ field: 'Coût estimé', from: null, to: fmtEuro(12000) }, { field: 'Ressources', from: null, to: 'Électricien ATEX externe' }],
    });
    expect(await addProgramAction({}, line(2026, 'A-203'))).toEqual({ error: 'Action déjà au programme.' });
    expect(await saveProgramAction({}, line(2026, 'A-203', { estimatedCost: '12 500,5', resources: 'Électricien ATEX externe', indicator: 'Vérification sans écart' }))).toEqual({ ok: true, id: 'A-203' });
    expect(await lastLog('prevention_program', '2026')).toMatchObject({
      action: 'update', details: [{ field: 'Coût estimé', from: fmtEuro(12000), to: fmtEuro(12500.5) }, { field: 'Indicateur', from: null, to: 'Vérification sans écart' }],
    });
    const program = await loadPreventionProgram(2026);
    expect(program.lines.find((l) => l.actionId === 'A-203')).toMatchObject({ estimatedCost: 12500.5, site: expect.stringContaining('Ville B'), frozenStatus: null });
    expect(program.totals).toMatchObject({ count: 4, costed: 4, cost: 2400 + 1800 + 12500.5 + 950 });
    expect(program.candidates.map(([id]) => id)).not.toContain('A-203');
    expect(program.candidates.map(([id]) => id)).toContain('A-215');
  });

  it('arrêt : consultation du CSE obligatoire, programme vide refusé, instantané, modifications refusées', async () => {
    actAs('Chef de service', 'all');
    expect(await freezePreventionProgram({}, form({ year: '2026', cseConsultedOn: '2026-10-08' }))).toEqual({ error: APPROVERS_ONLY });

    actAs('Animateur QHSE', 'all');
    expect(await freezePreventionProgram({}, form({ year: '2026', cseConsultedOn: '' }))).toMatchObject({ fieldErrors: { cseConsultedOn: 'Date obligatoire.' } });
    expect(await freezePreventionProgram({}, form({ year: '2026', cseConsultedOn: '2026-10-10' }))).toMatchObject({ fieldErrors: { cseConsultedOn: "Date postérieure à aujourd'hui." } });
    expect(await freezePreventionProgram({}, form({ year: '2026', cseConsultedOn: '2024-12-15' }))).toMatchObject({ fieldErrors: { cseConsultedOn: expect.stringContaining('trop ancienne') } });
    // Programme 2025 : aucune action à reprendre, arrêt impossible.
    expect(await createPreventionProgram({}, form({ year: '2025' }))).toEqual({ ok: true, id: '2025' });
    expect(await lastLog('prevention_program', '2025')).toMatchObject({ summary: 'Programme 2025 créé · 0 action reprise du DUERP 2026.1' });
    expect(await freezePreventionProgram({}, form({ year: '2025', cseConsultedOn: '2026-10-08' }))).toEqual({ error: 'Programme vide : ajoutez au moins une action.' });

    expect(await freezePreventionProgram({}, form({ year: '2026', cseConsultedOn: '2026-10-08' }))).toEqual({ ok: true, id: '2026' });
    const db = await getDb();
    const [row] = await db.select().from(t.preventionPrograms).where(eq(t.preventionPrograms.year, 2026));
    expect(row).toMatchObject({ cseConsultedOn: '2026-10-08', frozenById: 'clefevre' });
    expect(row.frozenAt).toBeInstanceOf(Date);
    expect(row.snapshot).toMatchObject({ takenOn: '2026-10-09', takenBy: '[C. Lefèvre]', duerpVersion: '2026.1', cseConsultedOn: '2026-10-08' });
    const snapshot = row.snapshot as { lines: { actionId: string; siteId: string | null; pilot: string; estimatedCost: number | null; risks: unknown[] }[] };
    expect(snapshot.lines.map((l) => l.actionId).sort()).toEqual(['A-201', 'A-203', 'A-205', 'A-214']);
    expect(snapshot.lines.find((l) => l.actionId === 'A-203')).toMatchObject({ siteId: 'ville-b', pilot: '[C. Lefèvre]', estimatedCost: 12500.5 });
    expect(snapshot.lines.every((l) => l.risks.length > 0)).toBe(true);
    expect(await lastLog('prevention_program', '2026')).toMatchObject({ action: 'freeze', summary: 'Programme 2026 arrêté · CSE consulté le 08/10/2026 · 4 actions' });

    expect(await addProgramAction({}, line(2026, 'A-215'))).toEqual({ error: FROZEN });
    expect(await saveProgramAction({}, line(2026, 'A-203'))).toEqual({ error: FROZEN });
    expect(await removeProgramAction({}, line(2026, 'A-203'))).toEqual({ error: FROZEN });
    expect(await updatePreventionProgram({}, form({ year: '2026', comment: 'Modifié' }))).toEqual({ error: FROZEN });
    expect(await freezePreventionProgram({}, form({ year: '2026', cseConsultedOn: '2026-10-08' }))).toEqual({ error: 'Programme déjà arrêté.' });
    // Programme arrêté : plus d'alerte « consultation du CSE à renseigner ».
    expect((await loadRiskSignals()).todo.some((x) => x.key === 'papripact|2026|cse')).toBe(false);
  });

  it('périmètre et rôles : lignes du site B (et communes) pour un périmètre restreint, sans pilote pour le salarié', async () => {
    restrictTo('Chef de service');
    const b = await loadPreventionProgram(2026);
    expect(b.program).toMatchObject({ state: 'frozen', cseConsultedOn: '2026-10-08', frozenBy: '[C. Lefèvre]' });
    expect(b.lines.map((l) => l.actionId)).toEqual(['A-203']);
    expect(b.lines.every((l) => l.siteId === 'ville-b' || l.siteId === null)).toBe(true);
    expect(b.hiddenCount).toBe(3);
    expect(b.lines[0]).toMatchObject({ pilot: '[C. Lefèvre]', status: 'En retard', frozenStatus: 'En retard' });
    expect(b.candidates).toEqual([]);
    expect(b.history.length).toBeGreaterThan(0);
    unrestrict();

    actAs('Salarié', 'all');
    const emp = await loadPreventionProgram(2026);
    expect(emp.lines).toHaveLength(4);
    expect(emp.lines.every((l) => l.pilot === '')).toBe(true);
    expect(emp).toMatchObject({ history: [], candidates: [], creatable: false });
    const json = JSON.stringify(emp);
    OTHER_PEOPLE.forEach((name) => expect(json, name).not.toContain(name));
    expect(emp.years).toEqual([2025, 2026, 2027]);
  });

  it('réouverture : motif obligatoire, instantané effacé, journal ; alerte du CSE de nouveau', async () => {
    actAs('Chef de service', 'all');
    expect(await reopenPreventionProgram({}, form({ year: '2026', reason: 'Test' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE', 'all');
    expect(await reopenPreventionProgram({}, form({ year: '2026', reason: '' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await reopenPreventionProgram({}, form({ year: '2026', reason: 'Action ajoutée à la demande du CSE' }))).toEqual({ ok: true, id: '2026' });
    const db = await getDb();
    expect((await db.select().from(t.preventionPrograms).where(eq(t.preventionPrograms.year, 2026)))[0])
      .toMatchObject({ snapshot: null, frozenAt: null, frozenById: null, cseConsultedOn: null });
    expect(await lastLog('prevention_program', '2026')).toMatchObject({
      action: 'reopen', reason: 'Action ajoutée à la demande du CSE', summary: 'Programme 2026 rouvert',
      details: [{ field: 'Consultation du CSE', from: '08/10/2026', to: null }],
    });
    expect(await reopenPreventionProgram({}, form({ year: '2026', reason: 'Encore' }))).toEqual({ error: 'Programme en préparation : rien à rouvrir.' });
    // Lignes conservées, de nouveau modifiables.
    expect(await addProgramAction({}, line(2026, 'A-215'))).toEqual({ ok: true, id: 'A-215' });
    expect((await db.select().from(t.preventionProgramActions).where(and(eq(t.preventionProgramActions.year, 2026)))).length).toBe(5);

    const { todo } = await loadRiskSignals();
    expect(todo.find((x) => x.key === 'papripact|2026|cse')).toMatchObject({
      title: 'PAPRIPACT 2026 : consultation du CSE à renseigner', href: '/risques?programme=2026', siteId: null, tone: 'warn',
    });
    expect(todo.some((x) => x.key?.startsWith('papripact|2026|missing'))).toBe(false);
  });
});
