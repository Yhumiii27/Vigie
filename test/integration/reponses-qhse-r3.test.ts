import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freezeClock, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadTodo } from '@/lib/data/todo';
import { loadSearch } from '@/lib/data/search';
import { loadPrevention } from '@/lib/data/prevention';
import { loadSimops } from '@/lib/data/simops';
import { latestAssessments, loadAssessmentCatalogue, loadSelfAssessments } from '@/lib/data/self-assessment';
import { loadDashboardCards } from '@/lib/data/dashboard-cards';
import { QHSE_ONLY } from '@/lib/edit-rights';
import { NEW_ACTION } from './actions-helpers';
import { saveAction } from '@/server/plan';
import {
  addSelfAssessmentComment, archiveAssessmentRequirement, cancelSelfAssessment, closeSelfAssessment, restoreAssessmentRequirement, saveAssessmentLine,
  saveAssessmentRequirement, saveSelfAssessment,
} from '@/server/self-assessment';
import { applyLockout, cancelLockout, removeLockout, saveLockout, verifyLockout } from '@/server/lockouts';
import { closePermit, deliverPermit, setPermitCheck } from '@/server/permits';
import { resetDashboardLayout, saveDashboardLayout } from '@/server/dashboard-layouts';
import { loadEntityHistory } from '@/server/history';

// Réponses du service QHSE du 09/11/2026, paquet R3 : auto-évaluation par référentiel (AUD-40), consignations et opérations
// simultanées (PRV-22), tableaux de bord configurables (TDB-19). Règles pures : src/lib/rules/{self-assessment,lockouts,
// simops}.test.ts, src/lib/dashboard-cards.test.ts.

freshDemoDatabase();
freezeClock('2026-10-09T10:00:00Z');

const db = () => getDb();
const lineOf = async (assessmentId: string, clause: string) => (await (await db()).select().from(t.selfAssessmentLines)
  .where(and(eq(t.selfAssessmentLines.assessmentId, assessmentId), eq(t.selfAssessmentLines.clause, clause))))[0];

describe('AUD-40 : catalogue des exigences', () => {
  it('données de référence posées par la migration : numéros et intitulés courts des trois référentiels', async () => {
    actAs('Chef de service', 'site_a');
    const cat = (await loadAssessmentCatalogue())!;
    const std = (s: string) => cat.filter((r) => r.standard === s).map((r) => r.clause);
    expect(std('iso45001')).toEqual(expect.arrayContaining(['4', '4.1', '5.4', '6.1.2', '8.1.3', '8.2', '9.2', '9.3', '10.2', '10.3']));
    expect(std('iso14001')).toEqual(expect.arrayContaining(['6.1.2', '6.1.3', '9.1.2']));
    expect(std('iso9001')).toEqual(expect.arrayContaining(['7.1.5', '8.3', '8.7', '9.1.2']));
    expect(cat.find((r) => r.standard === 'iso45001' && r.clause === '6.1.2')?.heading).toBe('Identification des dangers et évaluation des risques');
    expect(cat.every((r) => r.heading.length <= 80)).toBe(true);
  });

  it('modification, ajout, archivage et restauration motivés : animateur QHSE seulement, journal', async () => {
    const [req] = await (await db()).select().from(t.assessmentRequirements).where(and(eq(t.assessmentRequirements.standard, 'iso9001'), eq(t.assessmentRequirements.clause, '7.1.6')));
    actAs('Direction', 'site_a');
    expect(await saveAssessmentRequirement({}, form({ id: String(req.id), heading: 'Savoir-faire de l’organisme' }))).toEqual({ error: QHSE_ONLY });
    actAs('Chef de service', 'site_a');
    expect((await saveAssessmentRequirement({}, form({ id: String(req.id), heading: 'x' }))).error).toBeTruthy();
    actAs('Animateur QHSE', 'site_a');
    expect(await saveAssessmentRequirement({}, form({ id: String(req.id), heading: 'Savoir-faire de l’organisme', version: '0' }))).toMatchObject({ ok: true });
    expect(await lastLog('assessment_requirement', req.id)).toMatchObject({ action: 'update', byId: 'clefevre' });
    // Version périmée (QUA-12).
    expect((await saveAssessmentRequirement({}, form({ id: String(req.id), heading: 'Autre intitulé', version: '0' }))).error).toMatch(/modifiée entre-temps/);
    expect(await saveAssessmentRequirement({}, form({ standard: 'iso9001', clause: '7.1.4', heading: 'Environnement de travail' }))).toMatchObject({ ok: true });
    expect(await saveAssessmentRequirement({}, form({ standard: 'iso9001', clause: '7.1.4', heading: 'Doublon' }))).toMatchObject({ fieldErrors: { clause: 'Article déjà au catalogue.' } });
    expect(await saveAssessmentRequirement({}, form({ standard: 'iso9001', clause: '7-1', heading: 'Format' }))).toMatchObject({ fieldErrors: { clause: expect.stringMatching(/Numéro d’article/) } });
    const [added] = await (await db()).select().from(t.assessmentRequirements).where(and(eq(t.assessmentRequirements.standard, 'iso9001'), eq(t.assessmentRequirements.clause, '7.1.4')));
    expect(await archiveAssessmentRequirement({}, form({ id: String(added.id), reason: ' ' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await archiveAssessmentRequirement({}, form({ id: String(added.id), reason: 'Ajout de test' }))).toMatchObject({ ok: true });
    expect(await restoreAssessmentRequirement({}, form({ id: String(added.id), reason: 'Finalement évaluée' }))).toMatchObject({ ok: true });
    expect((await changeLog('assessment_requirement', added.id)).map((e) => e.action)).toEqual(['create', 'archive', 'restore']);
  });
});

describe('AUD-40 : campagnes d’auto-évaluation', () => {
  it('jeu : AE-002 en cours comparée à AE-001 ; synthèse calculée ; hors site sélectionné : introuvable', async () => {
    actAs('Chef de service', 'site_a');
    const data = (await loadSelfAssessments({ open: 'AE-002' }))!;
    expect(data.canEdit).toBe(false);
    expect(data.summaries.map((s) => [s.id, s.status])).toEqual([['AE-002', 'brouillon'], ['AE-001', 'cloturee']]);
    const d = data.detail!;
    expect(d.previous?.id).toBe('AE-001');
    expect(d.synthesis.overall.counts.pending).toBeGreaterThan(0);
    expect(d.delta).toBeGreaterThan(0);
    expect(d.lines.find((l) => l.clause === '8.1.4')).toMatchObject({ level: 'partiel', previousLevel: 'non_conforme' });
    actAs('Chef de service', 'site_b');
    expect((await loadSelfAssessments({ open: 'AE-002' }))?.missing).toBe(true);
    actAs('Salarié', 'site_a');
    expect(await loadSelfAssessments()).toBeNull();
  });

  it('ouverture : lignes recopiées du catalogue en vigueur ; droits de l’écran Audits et site', async () => {
    actAs('Chef de projet', 'site_a');
    expect((await saveSelfAssessment({}, form({ standard: 'iso14001', siteId: 'site_a', assessedOn: '2026-10-08', assessorId: 'clefevre' }))).error).toBeTruthy();
    actAs('Direction', 'site_a');
    expect((await saveSelfAssessment({}, form({ standard: 'iso14001', siteId: 'site_b', assessedOn: '2026-10-08', assessorId: 'clefevre' }))).error).toMatch(/autre site/);
    expect(await saveSelfAssessment({}, form({ standard: 'iso14001', siteId: 'site_a', assessedOn: '2026-10-12', assessorId: 'clefevre' }))).toMatchObject({ fieldErrors: { assessedOn: expect.any(String) } });
    const r = await saveSelfAssessment({}, form({ standard: 'iso14001', siteId: 'site_a', assessedOn: '2026-10-08', assessorId: 'hmarchand', scope: 'Site A' }));
    expect(r).toMatchObject({ ok: true, id: 'AE-003' });
    const lines = await (await db()).select().from(t.selfAssessmentLines).where(eq(t.selfAssessmentLines.assessmentId, 'AE-003'));
    const reqs = await (await db()).select().from(t.assessmentRequirements).where(and(eq(t.assessmentRequirements.standard, 'iso14001'), isNull(t.assessmentRequirements.archivedAt)));
    expect(lines).toHaveLength(reqs.length);
    expect(lines.every((l) => l.level === null)).toBe(true);
    expect(await lastLog('self_assessment', 'AE-003')).toMatchObject({ action: 'create', byId: 'hmarchand' });
  });

  it('évaluation : justification exigée, version de la ligne, journal ; clôture quand tout est évalué ; campagne figée', async () => {
    actAs('Animateur QHSE', 'site_a');
    const l = await lineOf('AE-003', '6.1.3');
    expect(await saveAssessmentLine({}, form({ lineId: String(l.id), level: 'non_conforme', justification: '' }))).toMatchObject({ fieldErrors: { justification: expect.stringMatching(/non-conformité/) } });
    expect(await saveAssessmentLine({}, form({ lineId: String(l.id), level: 'non_conforme', justification: 'Registre des obligations incomplet', finding: 'ICPE non listée', version: '0' }))).toMatchObject({ ok: true });
    expect((await saveAssessmentLine({}, form({ lineId: String(l.id), level: 'conforme', version: '0' }))).error).toMatch(/modifiée entre-temps/);
    expect(await lastLog('self_assessment_line', l.id)).toMatchObject({ action: 'update', byId: 'clefevre' });
    expect((await closeSelfAssessment({}, form({ id: 'AE-003' }))).error).toMatch(/encore à évaluer/);
    const all = await (await db()).select().from(t.selfAssessmentLines).where(and(eq(t.selfAssessmentLines.assessmentId, 'AE-003'), isNull(t.selfAssessmentLines.level)));
    for (const x of all) expect(await saveAssessmentLine({}, form({ lineId: String(x.id), level: 'conforme' }))).toMatchObject({ ok: true });
    expect(await closeSelfAssessment({}, form({ id: 'AE-003' }))).toMatchObject({ ok: true });
    expect((await saveAssessmentLine({}, form({ lineId: String(l.id), level: 'conforme' }))).error).toMatch(/figée/);
    expect((await cancelSelfAssessment({}, form({ id: 'AE-003', reason: 'Erreur' }))).error).toMatch(/figée/);
    // Après la clôture : commentaires admis.
    expect(await addSelfAssessmentComment({}, form({ id: 'AE-003', body: 'Présentée en CODIR' }))).toMatchObject({ ok: true });
    const history = await loadEntityHistory('self_assessment', 'AE-003');
    expect('entries' in history && history.entries.map((e) => e.action)).toEqual(expect.arrayContaining(['create', 'update', 'status', 'comment']));
    const data = (await loadSelfAssessments({ open: 'AE-003' }))!;
    expect(data.detail?.synthesis.overall.rate).toBe(Math.round(((all.length) / (all.length + 1)) * 100));
    expect(data.detail?.previous).toBeNull();
  });

  it('action QSE d’une ligne : animateur QHSE seulement, source « Audit interne ISO » imposée, lien posé à la création', async () => {
    const l = await lineOf('AE-002', '9.2');
    const fields = {
      ...NEW_ACTION, source: 'audit_interne', link: `selfassessment:${l.id}`, originRef: 'AE-002 · ISO 45001 9.2', siteId: 'site_a',
      problem: 'Programme d’audit interne non réalisé', detail: 'Planifier les audits SST du semestre',
    };
    actAs('Direction', 'site_a');
    expect((await saveAction({}, form(fields))).error).toBeTruthy();
    actAs('Animateur QHSE', 'site_a');
    expect((await saveAction({}, form({ ...fields, source: 'audit_terrain' }))).fieldErrors?.source).toBeTruthy();
    const r = await saveAction({}, form(fields));
    expect(r).toMatchObject({ ok: true });
    const [link] = await (await db()).select().from(t.selfAssessmentLineActions).where(eq(t.selfAssessmentLineActions.lineId, l.id));
    expect(link.actionId).toBe(r.id);
    const d = (await loadSelfAssessments({ open: 'AE-002' }))!.detail!;
    expect(d.lines.find((x) => x.id === l.id)?.actions.map((a) => a.id)).toEqual([r.id]);
    expect((await changeLog('self_assessment_line', l.id)).at(-1)).toMatchObject({ action: 'link' });
  });

  it('dossier de revue et recherche : dernière campagne clôturée par référentiel', async () => {
    actAs('Direction', 'site_a');
    const latest = await latestAssessments({ site: 'site_a', allowed: null, asOf: '2026-10-09' });
    expect(latest.map((a) => [a.id, a.standard])).toEqual([['AE-003', 'ISO 14001'], ['AE-001', 'ISO 45001']]);
    expect((await loadSearch('AE-001')).find((g) => g.key === 'audits')?.items[0]).toMatchObject({ ref: 'AE-001', href: '/audits?vue=auto-evaluation&campagne=AE-001' });
  });
});

describe('PRV-22 : consignations des permis', () => {
  it('jeu : consignations sur la fiche du permis ; échéances « non vérifiée » et « non levée »', async () => {
    actAs('Animateur QHSE', 'site_b');
    const permit = (await loadPrevention()).permits.find((p) => p.id === 'PE-2026-008')!;
    expect(permit.lockouts.map((l) => [l.id, l.status])).toEqual([['CSG-001', 'verifiee'], ['CSG-003', 'posee']]);
    expect(permit.lockoutCloseBlock).toMatch(/CSG-001, CSG-003 non levées/);
    const todo = await loadTodo();
    expect(todo.find((x) => x.key === 'consignation-verification|CSG-003')).toMatchObject({ ownerIds: ['jpetit'], siteId: 'site_b', overdue: true });
    expect(todo.find((x) => x.key === 'consignation-levee|CSG-002')).toMatchObject({ ownerIds: ['sbenali'], siteId: 'site_a' });
  });

  it('saisie par l’encadrement : poseur ≠ vérificateur, personnes présentes ; Salarié refusé', async () => {
    const fields = { permitId: 'PE-2026-009', energy: 'electrique', equipment: 'Banc BE-2', points: 'Sectionneur BE-2 ; cadenas 120\nArrêt d’urgence AU1', applierId: 'amartin', verifierId: 'amartin' };
    actAs('Salarié', 'site_b');
    expect((await saveLockout({}, form(fields))).error).toBeTruthy();
    actAs('Chef de service', 'site_a');
    expect((await saveLockout({}, form({ ...fields, verifierId: 'jpetit' }))).error).toMatch(/autre site/);
    actAs('Chef de service', 'site_b');
    expect(await saveLockout({}, form(fields))).toMatchObject({ fieldErrors: { verifierId: 'Le vérificateur doit être une autre personne que le poseur.' } });
    expect(await saveLockout({}, form({ ...fields, verifierId: 'ylambert' }))).toMatchObject({ fieldErrors: { verifierId: 'Personne inconnue ou sortie de l’effectif.' } });
    expect(await saveLockout({}, form({ ...fields, points: '' }))).toMatchObject({ fieldErrors: { points: expect.stringMatching(/au moins un point/) } });
    const r = await saveLockout({}, form({ ...fields, verifierId: 'jpetit' }));
    expect(r).toMatchObject({ ok: true, id: 'CSG-004' });
    const [row] = await (await db()).select().from(t.lockouts).where(eq(t.lockouts.id, 'CSG-004'));
    expect(row).toMatchObject({ status: 'preparee', siteId: 'site_b', preventionPlanId: 'PP-2026-014', points: [{ label: 'Sectionneur BE-2', device: 'cadenas 120' }, { label: 'Arrêt d’urgence AU1', device: '' }] });
    expect((await changeLog('permit', 'PE-2026-009')).at(-1)).toMatchObject({ action: 'create', summary: expect.stringMatching(/^Consignation CSG-004 : préparée/) });
  });

  it('délivrance bloquée tant que la consignation n’est pas vérifiée ; vérification par le vérificateur désigné ou le QHSE', async () => {
    actAs('Animateur QHSE', 'site_b');
    expect(await setPermitCheck('PE-2026-009', 4, true)).toEqual({});
    expect(await setPermitCheck('PE-2026-009', 5, true)).toEqual({});
    expect((await deliverPermit('PE-2026-009')).error).toMatch(/^Consignation CSG-004 non vérifiée/);
    actAs('Chef de service', 'site_b');
    expect((await verifyLockout({}, form({ id: 'CSG-004' }))).error).toMatch(/posée avant/);
    expect(await applyLockout({}, form({ id: 'CSG-004' }))).toMatchObject({ ok: true });
    // Chef de service (sbenali) : ni vérificateur désigné, ni QHSE.
    expect((await verifyLockout({}, form({ id: 'CSG-004' }))).error).toMatch(/vérificateur désigné/);
    expect((await cancelLockout({}, form({ id: 'CSG-004', reason: 'Erreur' }))).error).toMatch(/levez-la/);
    actAs('Animateur QHSE', 'site_b');
    expect(await verifyLockout({}, form({ id: 'CSG-004' }))).toMatchObject({ ok: true });
    const [row] = await (await db()).select().from(t.lockouts).where(eq(t.lockouts.id, 'CSG-004'));
    expect(row).toMatchObject({ status: 'verifiee', verifiedById: 'clefevre' });
    expect(await deliverPermit('PE-2026-009')).toEqual({});
  });

  it('clôture bloquée tant qu’une consignation n’est pas levée ; levée tracée ; annulation motivée d’une consignation préparée', async () => {
    actAs('Animateur QHSE', 'site_b');
    expect((await closePermit('PE-2026-008')).error).toMatch(/CSG-001, CSG-003 non levées/);
    expect(await removeLockout({}, form({ id: 'CSG-001', removedById: 'ylambert' }))).toMatchObject({ fieldErrors: { removedById: expect.any(String) } });
    expect(await removeLockout({}, form({ id: 'CSG-001', removedById: 'jpetit' }))).toMatchObject({ ok: true });
    expect(await removeLockout({}, form({ id: 'CSG-003', removedById: 'amartin' }))).toMatchObject({ ok: true });
    expect(await closePermit('PE-2026-008')).toEqual({});
    expect((await removeLockout({}, form({ id: 'CSG-003', removedById: 'amartin' }))).error).toMatch(/déjà levée/);
    // Consignation préparée annulée (motif), jamais supprimée.
    actAs('Chef de service', 'site_b');
    const r = await saveLockout({}, form({ permitId: 'PE-2026-009', energy: 'thermique', equipment: 'Étuve', points: 'Disjoncteur Q9', applierId: 'amartin', verifierId: 'jpetit' }));
    expect(await cancelLockout({}, form({ id: r.id!, reason: ' ' }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await cancelLockout({}, form({ id: r.id!, reason: 'Étuve déjà hors tension' }))).toMatchObject({ ok: true });
    expect(await lastLog('lockout', r.id!)).toMatchObject({ action: 'cancel', reason: 'Étuve déjà hors tension' });
  });

  it('opérations simultanées : permis et activités du jour par zone, heures de recouvrement, consignations', async () => {
    actAs('Chef de projet', 'site_a');
    const s = await loadSimops('2026-10-06');
    const montage = s.zones.find((z) => z.ops.some((o) => o.ref === 'PF-2026-031'));
    expect(montage?.overlaps).toBeTruthy();
    expect(montage?.ops.find((o) => o.ref === 'PF-2026-031')?.with.length).toBeGreaterThan(0);
    actAs('Animateur QHSE', 'site_a');
    const d = await loadSimops('2026-10-05');
    expect(d.zones.flatMap((z) => z.ops).find((o) => o.ref === 'PF-2026-030')?.lockouts.map((l) => l.id)).toEqual(['CSG-002']);
  });
});

describe('TDB-19 : tableaux de bord configurables', () => {
  it('fixe pour l’encadrement ; disposition de Vigie par défaut pour le QHSE et la direction', async () => {
    actAs('Chef de service', 'site_a');
    expect(await loadDashboardCards()).toBeNull();
    expect((await saveDashboardLayout({}, form({ cards: '[]' }))).error).toMatch(/animateur QHSE et la direction/);
    actAs('Direction', 'site_a');
    const d = (await loadDashboardCards())!;
    expect(d.origin).toBe('vigie');
    expect(d.cards.map((c) => c.id)).toEqual(['jours_sans_at', 'tf1', 'evenements_ouverts', 'actions_retard', 'controles', 'nc_ouvertes']);
    expect(d.showSitesMap).toBe(true);
    expect(d.roleLayouts).toBeNull();
  });

  it('disposition personnelle : catalogue fermé, ordre, période et périmètre ; indicateurs calculés ; journal ; retour au défaut', async () => {
    actAs('Direction', 'site_a');
    expect((await saveDashboardLayout({}, form({ cards: JSON.stringify([{ id: 'inconnue' }]) }))).error).toMatch(/catalogue/);
    expect((await saveDashboardLayout({}, form({ target: 'Direction', cards: '[]' }))).error).toMatch(/animateur QHSE/);
    const cards = [{ id: 'veille', scope: 'perimetre' }, { id: 'tf1', period: 'trimestre', scope: 'site' }, { id: 'causeries', period: 'mois', scope: 'site' }, { id: 'auto_evaluation', scope: 'site' }, { id: 'dgi_ouverts', scope: 'site' }];
    expect(await saveDashboardLayout({}, form({ cards: JSON.stringify(cards) }))).toMatchObject({ ok: true });
    const d = (await loadDashboardCards())!;
    expect(d.origin).toBe('personne');
    expect(d.cards.map((c) => c.id)).toEqual(['veille', 'tf1', 'causeries', 'auto_evaluation', 'dgi_ouverts']);
    expect(d.cards[1].options).toBe('3 derniers mois complets · Site sélectionné');
    expect(d.cards[3].value).toMatch(/%$/);
    expect(d.cards[4].value).toBe('1');
    expect(d.showSitesMap).toBe(false);
    expect(await lastLog('dashboard_layout', 'hmarchand')).toMatchObject({ action: 'create', byId: 'hmarchand' });
    // Rien d'indicateur n'est stocké : seulement la disposition.
    const [row] = await (await db()).select().from(t.dashboardLayouts).where(eq(t.dashboardLayouts.personId, 'hmarchand'));
    expect(Object.keys((row.cards as object[])[0]).sort()).toEqual(['id', 'period', 'scope']);
    expect(await resetDashboardLayout({}, form({}))).toMatchObject({ ok: true, message: 'Disposition par défaut rétablie.' });
    expect((await loadDashboardCards())!.origin).toBe('vigie');
  });

  it('disposition par défaut d’un rôle tenue par l’animateur QHSE, appliquée à qui n’a pas la sienne', async () => {
    actAs('Animateur QHSE', 'site_a');
    expect(await saveDashboardLayout({}, form({ target: 'Direction', cards: JSON.stringify([{ id: 'nc_ouvertes' }, { id: 'actions_soldees', period: 'annee', scope: 'perimetre' }]) }))).toMatchObject({ ok: true });
    expect((await loadDashboardCards())!.roleLayouts?.Direction?.map((c) => c.id)).toEqual(['nc_ouvertes', 'actions_soldees']);
    expect((await loadDashboardCards())!.origin).toBe('vigie');
    actAs('Direction', 'site_a');
    const d = (await loadDashboardCards())!;
    expect(d.origin).toBe('role');
    expect(d.cards.map((c) => c.id)).toEqual(['nc_ouvertes', 'actions_soldees']);
    expect(await lastLog('dashboard_layout', 'role:Direction')).toMatchObject({ action: 'create', byId: 'clefevre' });
  });
});
