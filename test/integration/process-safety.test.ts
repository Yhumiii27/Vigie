import '../next-mocks';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { NEW_ACTION, actionRow } from './actions-helpers';
import { getDb, schema as t } from '@/db';
import { ORIGIN_LOCKED, loadActionSources } from '@/lib/action-links';
import { QHSE_ONLY_CREATE_MESSAGE } from '@/lib/action-rules';
import { loadActionDetail } from '@/lib/data/actions';
import { loadProcessSafetySignals, loadProcessSafetyStudies } from '@/lib/data/process-safety';
import { loadSiteAdmin } from '@/lib/data/sites';
import { loadVisibleTodo } from '@/lib/data/todo';
import { loadEntityHistory } from '@/server/history';
import { linkAction } from '@/server/links';
import { saveAction } from '@/server/plan';
import {
  cancelProcessSafetyStudy, liftStudyReserve, markStudyReserve, reopenProcessSafetyStudy, saveProcessSafetyStudy, validateProcessSafetyStudy,
} from '@/server/process-safety';
import { saveSite } from '@/server/sites';
import { STALE_EDIT } from '@/server/versions';

// Études de sécurité des procédés (VG-01 à VG-05, demande d'Arche du 01/11/2026) : droits par rôle et site, motif, journal,
// recommandations (actions QSE rattachées, réserve bloquante), décomptes, échéance, lien profond, code commun du site.

freshDemoDatabase();

const db = () => getDb();
const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';
const REASON_REQUIRED = { fieldErrors: { reason: expect.any(String) } };

const STUDY = {
  siteId: 'ville-a', capexCode: 'CPX-APM-2026-02', keystoneProjectCode: '', milestone: 'HS3', type: 'amdec', status: 'planifiee', sessionOn: '2026-10-20',
  facilitatorId: 'clefevre', facilitatorExternal: '', reportRef: '', scope: 'Extension de l’entrepôt : convoyeurs.',
};
const study = async (id: string) => (await loadProcessSafetyStudies()).studies.concat((await loadProcessSafetyStudies()).cancelled).find((s) => s.id === id);
const version = async (id: string) => (await loadProcessSafetyStudies()).versions[id];

describe('jeu de démonstration (Arche CPX-APM-2026-01)', () => {
  it('trois études ; HazOp : 3 recommandations, 2 ouvertes, 1 en retard, 1 réserve bloquante ; jalons', async () => {
    actAs('Animateur QHSE');
    const { studies, cancelled } = await loadProcessSafetyStudies();
    expect(cancelled).toEqual([]);
    expect(studies.map((s) => [s.id, s.type, s.milestone, s.status, s.conclusion, s.clears])).toEqual([
      ['ES-001', 'hazid', 'HS2', 'validee', 'favorable', true],
      ['ES-002', 'hazop', 'HS3', 'validee', 'reserves', false],
      ['ES-003', 'pssr', 'PSSR', 'planifiee', null, false],
    ]);
    const hazop = studies.find((s) => s.id === 'ES-002')!;
    expect(hazop).toMatchObject({ capexCode: 'CPX-APM-2026-01', facilitator: '[Bureau d’études procédés]', counts: { total: 3, open: 2, late: 1, blocking: 1 } });
    expect(hazop.recommendations.map((r) => [r.id, r.blocking, r.late, r.closed, r.readable])).toEqual([
      ['A-191', true, false, false, true], ['A-192', false, true, false, true], ['A-193', false, false, true, true],
    ]);
    // Aucune échéance d'étude dans le jeu (PSSR à venir).
    expect((await loadProcessSafetySignals()).todo).toEqual([]);
    // Changement de site refusé dès que l'étude porte des recommandations (comme DUE-14).
    const v = await version('ES-002');
    const row = (await db()).select().from(t.processSafetyStudies).where(eq(t.processSafetyStudies.id, 'ES-002'));
    const [es2] = await row;
    actAs('Animateur QHSE', 'all');
    expect(await saveProcessSafetyStudy({}, form({
      ...STUDY, id: 'ES-002', version: v, siteId: 'ville-b', capexCode: es2.capexCode ?? '', milestone: es2.milestone, type: es2.type,
      status: 'realisee', sessionOn: es2.sessionOn, facilitatorId: es2.facilitatorId ?? '', facilitatorExternal: es2.facilitatorExternal ?? '',
    }))).toMatchObject({ fieldErrors: { siteId: 'L’étude porte des recommandations : elle ne change plus de site.' } });
    // Site B : aucune étude.
    actAs('Animateur QHSE', 'ville-b');
    expect((await loadProcessSafetyStudies()).studies).toEqual([]);
  });

  it('fiche action : l’étude d’origine, lien profond ; Salarié : vue fermée, historique refusé', async () => {
    actAs('Chef de projet');
    const src = (await loadActionSources('A-191')).find((s) => s.kind === 'safetystudy')!;
    expect(src).toMatchObject({ label: 'ES-002 · HazOp · CPX-APM-2026-01', href: '/risques?vue=etudes&etude=ES-002', link: 'safetystudy:ES-002:bloquante' });
    const detail = await loadActionDetail('A-191');
    expect(detail.payload?.detail.sources.find((s) => s.kind === 'safetystudy')).toMatchObject({ href: '/risques?vue=etudes&etude=ES-002' });
    expect(await loadProcessSafetyStudies()).toMatchObject({ studies: expect.arrayContaining([expect.objectContaining({ id: 'ES-002' })]) });
    expect(await loadEntityHistory('process_safety_study', 'ES-002')).toMatchObject({ entries: expect.any(Array) });
    actAs('Salarié', 'all');
    expect(await loadProcessSafetyStudies()).toMatchObject({ studies: [], cancelled: [] });
    expect(await loadEntityHistory('process_safety_study', 'ES-002')).toEqual({ error: expect.any(String) });
    expect((await loadProcessSafetySignals()).todo).toEqual([]);
  });
});

describe('saisie d’une étude (VG-01)', () => {
  it('encadrement et Salarié refusés ; site sélectionné ; contrôles des champs', async () => {
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as const) {
      actAs(role);
      expect(await saveProcessSafetyStudy({}, form(STUDY)), role).toEqual({ error: APPROVERS_ONLY });
    }
    actAs('Animateur QHSE', 'ville-b');
    expect(await saveProcessSafetyStudy({}, form(STUDY))).toMatchObject({ error: OTHER_SITE });
    actAs('Animateur QHSE');
    expect(await saveProcessSafetyStudy({}, form({ ...STUDY, capexCode: '' }))).toMatchObject({ fieldErrors: { capexCode: expect.stringContaining('au moins un') } });
    expect(await saveProcessSafetyStudy({}, form({ ...STUDY, capexCode: 'APM-2026-02' }))).toMatchObject({ fieldErrors: { capexCode: expect.stringContaining('CPX-APM-2026-01') } });
    expect(await saveProcessSafetyStudy({}, form({ ...STUDY, type: 'hazid' }))).toMatchObject({ fieldErrors: { type: 'Une étude HazID relève du jalon HS 2.' } });
    expect(await saveProcessSafetyStudy({}, form({ ...STUDY, facilitatorExternal: '[Prestataire]' }))).toMatchObject({ fieldErrors: { facilitatorExternal: expect.any(String) } });
    expect(await saveProcessSafetyStudy({}, form({ ...STUDY, facilitatorId: 'ylambert' }))).toMatchObject({ fieldErrors: { facilitatorId: expect.stringContaining('sortie') } });
    expect(await saveProcessSafetyStudy({}, form({ ...STUDY, status: 'realisee' }))).toMatchObject({ fieldErrors: { sessionOn: 'Séance à venir : l’étude reste planifiée.' } });
    expect(await saveProcessSafetyStudy({}, form({ ...STUDY, status: 'validee' }))).toMatchObject({ fieldErrors: { status: 'Valeur non autorisée.' } });
  });

  it('création « ES-004 », modification avec version (QUA-12), validation, réouverture motivée, journal', async () => {
    actAs('Direction');
    const r = await saveProcessSafetyStudy({}, form({ ...STUDY, capexCode: 'cpx-apm-2026-02', keystoneProjectCode: 'k-2025-042' }));
    expect(r).toEqual({ ok: true, id: 'ES-004' });
    expect(await study('ES-004')).toMatchObject({ capexCode: 'CPX-APM-2026-02', projectCode: 'K-2025-042', status: 'planifiee', facilitator: '[C. Lefèvre]' });
    expect(await lastLog('process_safety_study', 'ES-004')).toMatchObject({ action: 'create', byId: 'hmarchand', summary: 'Étude AMDEC (jalon HS 3) planifiée le 20/10/2026' });
    const v = await version('ES-004');
    const edit = { ...STUDY, id: 'ES-004', version: v, capexCode: 'CPX-APM-2026-02', status: 'realisee', sessionOn: '2026-10-07', reportRef: 'NOT-CPX-APM-2026-02-001' };
    expect(await saveProcessSafetyStudy({}, form(edit))).toEqual({ ok: true, id: 'ES-004' });
    expect(await saveProcessSafetyStudy({}, form({ ...edit, scope: 'Autre' }))).toEqual({ error: STALE_EDIT });
    expect(await lastLog('process_safety_study', 'ES-004')).toMatchObject({ action: 'update', details: expect.arrayContaining([
      { field: 'Statut', from: 'Planifiée', to: 'Réalisée' }, { field: 'Séance', from: '20/10/2026', to: '07/10/2026' }, { field: 'Rapport (Codex)', from: null, to: 'NOT-CPX-APM-2026-02-001' },
    ]) });
    // Validation : approbateurs, dates et conclusion contrôlées.
    actAs('Chef de service');
    expect(await validateProcessSafetyStudy({}, form({ id: 'ES-004', validatedOn: '2026-10-08', conclusion: 'favorable' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE');
    const v2 = await version('ES-004');
    expect(await validateProcessSafetyStudy({}, form({ id: 'ES-004', version: v2, validatedOn: '2026-10-06', conclusion: 'favorable' }))).toMatchObject({ fieldErrors: { validatedOn: 'Validation antérieure à la séance.' } });
    expect(await validateProcessSafetyStudy({}, form({ id: 'ES-004', version: v2, validatedOn: '2026-10-08' }))).toMatchObject({ fieldErrors: { conclusion: 'Choix obligatoire.' } });
    expect(await validateProcessSafetyStudy({}, form({ id: 'ES-004', version: v2, validatedOn: '2026-10-08', conclusion: 'defavorable' }))).toEqual({ ok: true, id: 'ES-004' });
    expect(await study('ES-004')).toMatchObject({ status: 'validee', validatedOn: '2026-10-08', conclusion: 'defavorable', clears: false });
    expect(await validateProcessSafetyStudy({}, form({ id: 'ES-004', validatedOn: '2026-10-08', conclusion: 'favorable' }))).toMatchObject({ error: expect.stringContaining('déjà validée') });
    // Modification d'une étude validée : statut et conclusion gardés.
    const v3 = await version('ES-004');
    expect(await saveProcessSafetyStudy({}, form({ ...edit, version: v3, status: 'planifiee', scope: 'Convoyeurs et quais.' }))).toEqual({ ok: true, id: 'ES-004' });
    expect(await study('ES-004')).toMatchObject({ status: 'validee', conclusion: 'defavorable', scope: 'Convoyeurs et quais.' });
    // Réouverture : motif obligatoire.
    expect(await reopenProcessSafetyStudy({}, form({ id: 'ES-004' }))).toMatchObject(REASON_REQUIRED);
    expect(await reopenProcessSafetyStudy({}, form({ id: 'ES-004', reason: 'Conclusion à revoir avec la SSE groupe' }))).toEqual({ ok: true, id: 'ES-004' });
    expect(await study('ES-004')).toMatchObject({ status: 'realisee', validatedOn: null, conclusion: null });
    expect(await reopenProcessSafetyStudy({}, form({ id: 'ES-004', reason: 'x' }))).toEqual({ error: 'Seule une étude validée se rouvre.' });
    expect((await changeLog('process_safety_study', 'ES-004')).map((e) => e.action)).toEqual(['create', 'update', 'validate', 'update', 'reopen']);
    expect(await lastLog('process_safety_study', 'ES-004')).toMatchObject({ reason: 'Conclusion à revoir avec la SSE groupe' });
  });
});

describe('recommandations (VG-02)', () => {
  it('création depuis l’étude : QHSE, source HAZOP imposée, réserve bloquante, journal de l’étude et de l’action', async () => {
    const rec = { ...NEW_ACTION, source: 'hazop', originRef: '', link: 'safetystudy:ES-004' };
    actAs('Chef de service');
    expect(await saveAction({}, form(rec))).toEqual({ error: QHSE_ONLY_CREATE_MESSAGE });
    actAs('Animateur QHSE');
    expect(await saveAction({}, form({ ...rec, source: 'comex' }))).toMatchObject({ fieldErrors: { source: expect.any(String) } });
    expect(await saveAction({}, form({ ...rec, siteId: 'ville-b' }))).toMatchObject({ fieldErrors: { siteId: expect.any(String) } });
    const blocking = await saveAction({}, form({ ...rec, safetyBlocking: 'on' }));
    expect(blocking).toEqual({ ok: true, id: 'A-223' });
    expect(await actionRow('A-223')).toMatchObject({ source: 'hazop', safetyStudyId: 'ES-004', safetyStudyBlocking: true, originRef: 'ES-004 · AMDEC · CPX-APM-2026-02' });
    expect(await lastLog('action', 'A-223')).toMatchObject({ details: expect.arrayContaining([{ field: 'Réserve bloquante', from: null, to: 'oui' }]) });
    expect(await lastLog('process_safety_study', 'ES-004')).toMatchObject({ action: 'link', summary: 'Action A-223 créée et rattachée (réserve bloquante)' });
    expect(await saveAction({}, form({ ...rec, dueOn: '2026-10-10' }))).toMatchObject({ ok: true, id: 'A-224' });
    expect(await actionRow('A-224')).toMatchObject({ safetyStudyBlocking: false });
    expect((await study('ES-004'))!.counts).toEqual({ total: 2, open: 2, late: 0, blocking: 1 });
    // Origine fixée à la création : jamais rattachée ensuite (ORIGIN_LOCKED).
    expect(await linkAction('safetystudy:ES-001', 'A-224')).toEqual({ error: ORIGIN_LOCKED });
    // Le registre ne propose une étude qu'à la création : un autre élément ne peut pas y rattacher l'action.
    expect((await loadActionSources('A-224')).map((s) => s.link)).toEqual(['safetystudy:ES-004']);
  });

  it('réserve bloquante posée ou levée (motif) par le QHSE, journal sur l’étude et l’action ; action close refusée', async () => {
    actAs('Chef de service');
    expect(await markStudyReserve({}, form({ actionId: 'A-224' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE', 'ville-b');
    expect(await markStudyReserve({}, form({ actionId: 'A-224' }))).toEqual({ error: OTHER_SITE });
    actAs('Animateur QHSE');
    expect(await markStudyReserve({}, form({ actionId: 'A-224' }))).toEqual({ ok: true, id: 'ES-004' });
    expect(await markStudyReserve({}, form({ actionId: 'A-224' }))).toEqual({ error: 'Réserve déjà bloquante.' });
    expect(await lastLog('process_safety_study', 'ES-004')).toMatchObject({ action: 'blocking', summary: 'Recommandation A-224 marquée réserve bloquante' });
    expect(await lastLog('action', 'A-224')).toMatchObject({ action: 'update', details: [{ field: 'Réserve bloquante', from: 'non', to: 'oui' }] });
    expect(await liftStudyReserve({}, form({ actionId: 'A-224' }))).toMatchObject(REASON_REQUIRED);
    expect(await liftStudyReserve({}, form({ actionId: 'A-224', reason: 'Mesure compensatoire validée par la SSE groupe' }))).toEqual({ ok: true, id: 'ES-004' });
    expect(await lastLog('action', 'A-224')).toMatchObject({ reason: 'Mesure compensatoire validée par la SSE groupe', details: [{ field: 'Réserve bloquante', from: 'oui', to: 'non' }] });
    expect(await lastLog('process_safety_study', 'ES-004')).toMatchObject({ action: 'lift', reason: 'Mesure compensatoire validée par la SSE groupe' });
    // A-193 (démonstration) : vérifiée, ne bloque plus.
    expect(await markStudyReserve({}, form({ actionId: 'A-193' }))).toMatchObject({ error: expect.stringContaining('vérifiée ou abandonnée') });
    expect(await markStudyReserve({}, form({ actionId: 'A-214' }))).toEqual({ error: 'Recommandation introuvable.' });
    // Retard d'une recommandation : règle du plan (A-192, date cible passée au 09/10/2026).
    expect((await study('ES-002'))!.counts.late).toBe(1);
  });
});

describe('échéance, annulation (VG-01)', () => {
  it('séance passée d’une étude encore planifiée : animateur, sinon responsable QHSE du site ; QHSE et direction seulement', async () => {
    actAs('Animateur QHSE');
    expect(await saveProcessSafetyStudy({}, form({ ...STUDY, milestone: 'HS4', type: 'controle_chantier', sessionOn: '2026-10-01', facilitatorId: 'sbenali' }))).toEqual({ ok: true, id: 'ES-005' });
    const sig = (await loadProcessSafetySignals()).todo.find((x) => x.key === 'etude-securite|ES-005')!;
    expect(sig).toMatchObject({ dueOn: '2026-10-01', overdue: true, siteId: 'ville-a', ownerIds: ['sbenali'], who: '[S. Benali]', href: '/risques?vue=etudes&etude=ES-005', kind: 'Étude de sécurité' });
    expect((await loadVisibleTodo()).some((x) => x.href === '/risques?vue=etudes&etude=ES-005')).toBe(true);
    // Animateur (Chef de service de démonstration) : sa propre échéance ; Chef de projet : rien.
    actAs('Chef de service');
    expect((await loadProcessSafetySignals()).todo.map((x) => x.key)).toEqual(['etude-securite|ES-005']);
    actAs('Chef de projet');
    expect((await loadProcessSafetySignals()).todo).toEqual([]);
    // Sans animateur : responsable QHSE du site ; étude tenue : plus d'échéance.
    actAs('Animateur QHSE');
    const v = await version('ES-005');
    const base = { ...STUDY, id: 'ES-005', milestone: 'HS4', type: 'controle_chantier', sessionOn: '2026-10-01' };
    expect(await saveProcessSafetyStudy({}, form({ ...base, version: v, facilitatorId: '' }))).toEqual({ ok: true, id: 'ES-005' });
    expect((await loadProcessSafetySignals()).todo.find((x) => x.key === 'etude-securite|ES-005')).toMatchObject({ ownerIds: ['clefevre'] });
    expect(await saveProcessSafetyStudy({}, form({ ...base, version: await version('ES-005'), facilitatorId: '', status: 'realisee' }))).toEqual({ ok: true, id: 'ES-005' });
    expect((await loadProcessSafetySignals()).todo).toEqual([]);
  });

  it('annulation motivée : étude gardée, statut « annulée », plus d’écriture ni de nouvelle recommandation', async () => {
    actAs('Chef de service');
    expect(await cancelProcessSafetyStudy({}, form({ id: 'ES-005', reason: 'x' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE');
    expect(await cancelProcessSafetyStudy({}, form({ id: 'ES-005' }))).toMatchObject(REASON_REQUIRED);
    expect(await cancelProcessSafetyStudy({}, form({ id: 'ES-005', reason: 'Saisie en double' }))).toEqual({ ok: true, id: 'ES-005' });
    const { studies, cancelled } = await loadProcessSafetyStudies();
    expect(studies.some((s) => s.id === 'ES-005')).toBe(false);
    expect(cancelled.find((s) => s.id === 'ES-005')).toMatchObject({ status: 'annulee', statusLabel: 'Annulée', cancelled: { by: '[C. Lefèvre]', reason: 'Saisie en double' } });
    expect(await cancelProcessSafetyStudy({}, form({ id: 'ES-005', reason: 'x' }))).toEqual({ error: 'Étude annulée : elle reste consultable avec son historique.' });
    expect(await saveAction({}, form({ ...NEW_ACTION, source: 'hazop', originRef: '', link: 'safetystudy:ES-005' }))).toMatchObject({ error: expect.stringContaining('annulée') });
    expect(await lastLog('process_safety_study', 'ES-005')).toMatchObject({ action: 'cancel', reason: 'Saisie en double' });
    const [row] = await (await db()).select().from(t.processSafetyStudies).where(eq(t.processSafetyStudies.id, 'ES-005'));
    expect(row).toMatchObject({ status: 'realisee', cancelReason: 'Saisie en double' });
  });
});

describe('code commun du site (VG-05, matrix.sites.code)', () => {
  it('format de Matrix, unique, journalisé ; absent du formulaire : inchangé', async () => {
    actAs('Chef de service');
    expect(await saveSite({}, form({ id: 'ville-a', label: 'Site de [Ville A]', code: 'kenitra' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Direction', 'all');
    const label = (await loadSiteAdmin()).find((s) => s.id === 'ville-a')!.label;
    expect(await saveSite({}, form({ id: 'ville-a', label, code: 'ville-a' }))).toMatchObject({ fieldErrors: { code: expect.stringContaining('minuscules') } });
    expect(await saveSite({}, form({ id: 'ville-a', label, code: 'all' }))).toMatchObject({ fieldErrors: { code: expect.stringContaining('réservé') } });
    expect(await saveSite({}, form({ id: 'ville-a', label, code: 'Kenitra' }))).toEqual({ ok: true, id: 'ville-a' });
    expect((await loadSiteAdmin()).find((s) => s.id === 'ville-a')).toMatchObject({ code: 'kenitra' });
    expect(await lastLog('site', 'ville-a')).toMatchObject({ details: expect.arrayContaining([{ field: 'Code commun (Matrix)', from: null, to: 'kenitra' }]) });
    const labelB = (await loadSiteAdmin()).find((s) => s.id === 'ville-b')!.label;
    expect(await saveSite({}, form({ id: 'ville-b', label: labelB, code: 'kenitra' }))).toMatchObject({ fieldErrors: { code: 'Un autre site porte déjà ce code.' } });
    // Formulaire sans le champ (amorçage, ancien formulaire) : code conservé.
    expect(await saveSite({}, form({ id: 'ville-a', label }))).toEqual({ ok: true, id: 'ville-a' });
    expect((await loadSiteAdmin()).find((s) => s.id === 'ville-a')).toMatchObject({ code: 'kenitra' });
  });
});
