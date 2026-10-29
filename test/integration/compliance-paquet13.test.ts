import '../next-mocks';
import { describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { getDb, schema as t } from '@/db';
import { config } from '@/lib/config';
import { loadPrevention } from '@/lib/data/prevention';
import { loadPreventionSignals } from '@/lib/data/prevention-signals';
import { loadZoneRisks } from '@/lib/data/report-posts';
import { loadReviewDossierPage } from '@/lib/data/review';
import { loadRiskSignals, loadRisks } from '@/lib/data/risks';
import { loadSkillMatrix } from '@/lib/data/skills';
import { loadVisibleTodo } from '@/lib/data/todo';
import { loadSafetyNotices, loadSafetyRegisterPrint, loadWatch, loadWatchSignals } from '@/lib/data/watch';
import { signReportToken } from '@/lib/report-token';
import { createReport } from '@/server/events';
import { cancelPlanMeeting, recordPlanMeeting, setPlanMeetingPeriod } from '@/server/prevention';
import { linkRiskMeasure, removeRiskMeasure, saveWorkUnit } from '@/server/risks';
import { evaluateTrainingEffectiveness } from '@/server/skills';
import { answerSafetyNotice, cancelSafetyNotice, recordControl, saveControl, saveRequirement, saveSafetyNotice } from '@/server/watch';

// Paquet 13, première moitié (conformité et fonctions métier, migration 0020) : interventions longues (PRV-17), vue
// d'ensemble du DUERP (DUE-17, règle pure : src/components/risks/overview.test.ts), mesures liées (DUE-19), unités reliées
// aux zones (DUE-20), efficacité des formations (HAB-13), indicateurs de compétences de la revue (HAB-18), indicateurs
// calculés de la veille (VEI-12), métrologie (VEI-14), registre de sécurité (VEI-15), périodicité de réévaluation (VEI-18).
// Server actions : droits par rôle et site, motif, journal ; échéances : visibilité par rôle et site.

freshDemoDatabase();

const db = () => getDb();
const DENIED = 'Votre rôle ne permet pas cette modification.';
const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const OTHER_SITE = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';
const REASON_REQUIRED = { fieldErrors: { reason: expect.any(String) } };

async function requirement(text: string) {
  const [r] = await (await db()).select().from(t.requirements).where(eq(t.requirements.text, text));
  if (!r) throw new Error(`exigence ${text} introuvable`);
  return r;
}
async function control(equipment: string) {
  const [c] = await (await db()).select().from(t.controls).where(eq(t.controls.equipment, equipment));
  if (!c) throw new Error(`contrôle ${equipment} introuvable`);
  return c;
}
const requirementForm = (r: Awaited<ReturnType<typeof requirement>>, over: Record<string, string> = {}) => form({
  id: String(r.id), text: r.text, domain: r.domain, summary: r.summary, dueOn: r.dueOn ?? '', dueNote: r.dueNote ?? '', evaluation: r.evaluation,
  evaluationNote: r.evaluationNote ?? '', pilotId: r.pilotId ?? '', impact: r.impact ?? '', linkedToField: '1', linkedTo: r.linkedTo ?? '',
  certificationId: r.certificationId ?? '', ...over,
});

describe('jeu de démonstration du paquet 13', () => {
  it('exigences, métrologie, registre de sécurité, séances, mesures liées, zones et évaluations', async () => {
    const d = await db();
    expect((await requirement('Directive ATEX 2014/34/UE')).reviewMonths).toBe(24);
    expect(await requirement('ISO 9001:2015')).toMatchObject({ linkedTo: 'certification', certificationId: 'iso9001' });
    expect(await control('Pied à coulisse numérique 0–150 mm — contrôle qualité')).toMatchObject({ category: 'metrologie', tolerance: '± 0,02 mm' });
    expect((await d.select().from(t.safetyNotices)).length).toBe(2);
    expect((await d.select().from(t.preventionPlanMeetings).where(eq(t.preventionPlanMeetings.planId, 'PP-2025-041'))).length).toBe(5);
    expect((await d.select().from(t.riskMeasureLinks)).length).toBe(5);
    expect((await d.select().from(t.mapZones).where(eq(t.mapZones.workUnitId, 'essais'))).length).toBe(2);
    const [accueil] = await d.select().from(t.trainingTitles).where(eq(t.trainingTitles.id, 'accueil'));
    expect(accueil.awareness).toBe(true);
  });
});

describe('VEI-18 : périodicité de réévaluation propre à chaque exigence', () => {
  it('saisie, journal et échéance de réévaluation selon la périodicité', async () => {
    actAs('Chef de service', 'ville-a');
    const r = await requirement('ISO 9001:2015');
    expect(await saveRequirement({}, requirementForm(r, { reviewMonths: '6' }))).toEqual({ ok: true, id: String(r.id) });
    expect(await lastLog('requirement', r.id)).toMatchObject({ action: 'update', details: expect.arrayContaining([{ field: 'Réévaluation tous les (mois)', from: '12 (par défaut)', to: '6' }]) });
    // Dernière évaluation le 20/06/2026 (rel(-111)) : réévaluation due 6 mois après, le 20/12/2026 (hors horizon) ; 3 mois : dépassée.
    expect(await saveRequirement({}, requirementForm(await requirement('ISO 9001:2015'), { reviewMonths: '3' }))).toMatchObject({ ok: true });
    const view = (await loadWatch()).requirements.find((x) => x.id === r.id)!;
    expect(view).toMatchObject({ reviewEvery: 3, nextReview: { on: '2026-09-20', tone: 'danger' } });
    const { todo } = await loadWatchSignals();
    expect(todo.find((x) => x.href === `/veille?exigence=${r.id}`)).toMatchObject({ title: expect.stringContaining('réévaluation (tous les 3 mois) en retard depuis le 20/09'), dueOn: '2026-09-20' });
    expect(await saveRequirement({}, requirementForm(await requirement('ISO 9001:2015'), { reviewMonths: '61' }))).toMatchObject({ fieldErrors: { reviewMonths: 'Maximum 60.' } });
    expect(await saveRequirement({}, requirementForm(await requirement('ISO 9001:2015'), { reviewMonths: '' }))).toMatchObject({ ok: true });
    expect((await requirement('ISO 9001:2015')).reviewMonths).toBeNull();
  });

  it('Salarié et Chef de projet : refusés', async () => {
    const r = await requirement('ISO 9001:2015');
    for (const role of ['Salarié', 'Chef de projet'] as const) {
      actAs(role, 'ville-a');
      expect(await saveRequirement({}, requirementForm(r, { reviewMonths: '6' }))).toEqual({ error: DENIED });
    }
  });
});

describe('VEI-12 : indicateurs calculés (déchets, certification)', () => {
  it('BSD manquants, mentions du registre et certification ISO 9001 dans la veille', async () => {
    actAs('Animateur QHSE', 'all');
    const { requirements } = await loadWatch();
    const bsd = requirements.find((r) => r.linkedTo === 'waste_bsd')!;
    expect(bsd.indicator).toMatchObject({ href: expect.stringContaining('/environnement') });
    expect(typeof bsd.indicator!.gap).toBe('boolean');
    const iso = requirements.find((r) => r.linkedTo === 'certification')!;
    expect(iso.indicator).toMatchObject({ label: expect.stringMatching(/^ISO 9001:2015 · /), href: '/audits', gap: false });
    // Certificat suspendu : écart suggéré.
    await (await db()).update(t.certifications).set({ suspendedOn: '2026-10-01', suspendReason: 'Écart majeur non levé' }).where(eq(t.certifications.id, 'iso9001'));
    const suspended = (await loadWatch()).requirements.find((r) => r.linkedTo === 'certification')!;
    expect(suspended.indicator).toMatchObject({ tone: 'danger', gap: true });
    expect(suspended.suggestGap).toBe(true);
    await (await db()).update(t.certifications).set({ suspendedOn: null, suspendReason: null }).where(eq(t.certifications.id, 'iso9001'));
  });

  it('indicateur « certification » : certification obligatoire, une exigence en vigueur par certification', async () => {
    actAs('Animateur QHSE', 'all');
    const atex = await requirement('Directive ATEX 2014/34/UE');
    expect(await saveRequirement({}, requirementForm(atex, { linkedTo: 'certification', certificationId: '' })))
      .toMatchObject({ fieldErrors: { certificationId: 'Choisissez la certification dont l’exigence reprend l’état.' } });
    expect(await saveRequirement({}, requirementForm(atex, { linkedTo: 'certification', certificationId: 'iso9001' })))
      .toMatchObject({ fieldErrors: { certificationId: expect.stringContaining('ISO 9001:2015') } });
    expect(await saveRequirement({}, requirementForm(atex, { linkedTo: 'certification', certificationId: 'inconnue' })))
      .toMatchObject({ fieldErrors: { certificationId: 'Certification inconnue.' } });
  });
});

describe('VEI-14 : métrologie, étalonnage hors tolérance', () => {
  const GAUGE = 'Pied à coulisse numérique 0–150 mm — contrôle qualité';
  const record = (id: number, over: Record<string, string> = {}) => form({ controlId: String(id), performedOn: '2026-10-08', organization: '[Laboratoire accrédité COFRAC]', result: 'hors_tolerance', notes: 'Écart de 0,05 mm au-delà de 100 mm.', ...over });

  it('nature et tolérance saisies et journalisées ; hors tolérance réservé à un étalonnage', async () => {
    actAs('Chef de service', 'ville-a');
    const pont = await control('Pont roulant 10 t — atelier montage');
    expect(await recordControl({}, record(pont.id))).toMatchObject({ fieldErrors: { result: expect.stringContaining('Réglementaire') } });
    const fd = form({
      id: String(pont.id), equipment: pont.equipment, controlType: pont.controlType, periodMonths: String(pont.periodMonths), organization: pont.organization,
      responsibleId: pont.responsibleId ?? '', siteId: pont.siteId ?? '', requirementId: pont.requirementId ? String(pont.requirementId) : '', nextOn: pont.nextOn,
      category: 'metrologie', tolerance: 'Charge d’épreuve ± 2 %',
    });
    expect(await saveControl({}, fd)).toEqual({ ok: true, id: String(pont.id) });
    expect(await lastLog('control', pont.id)).toMatchObject({ details: expect.arrayContaining([{ field: 'Nature', from: 'Réglementaire', to: 'Métrologie' }]) });
    fd.set('category', 'reglementaire');
    fd.set('tolerance', '');
    expect(await saveControl({}, fd)).toEqual({ ok: true, id: String(pont.id) });
  });

  it('étalonnage hors tolérance : non-conformité ouverte, rattachée à l’équipement et à l’enregistrement, journalisée', async () => {
    actAs('Chef de service', 'ville-a');
    const gauge = await control(GAUGE);
    const res = await recordControl({}, record(gauge.id));
    expect(res).toMatchObject({ ok: true, eventId: expect.stringMatching(/^EV-2026-\d+$/), notice: expect.stringContaining('non-conformité') });
    const [ev] = await (await db()).select().from(t.events).where(eq(t.events.id, res.eventId!));
    expect(ev).toMatchObject({ type: 'NC', step: 0, siteId: 'ville-a', controlId: gauge.id, declarantId: 'sbenali', occurredOn: '2026-10-08' });
    const [rec] = await (await db()).select().from(t.controlRecords).where(eq(t.controlRecords.id, Number(res.id)));
    expect(rec).toMatchObject({ result: 'hors_tolerance', eventId: ev.id });
    expect(await lastLog('event', ev.id)).toMatchObject({ action: 'create', byId: 'sbenali' });
    expect(await lastLog('control', gauge.id)).toMatchObject({ action: 'link', summary: expect.stringContaining(ev.id) });
    // Équipement signalé jusqu'à un nouvel étalonnage conforme.
    const view = (await loadWatch()).controls.find((c) => c.id === gauge.id)!;
    expect(view).toMatchObject({ tone: 'danger', status: expect.stringContaining('Hors tolérance') });
    expect(view.records[0]).toMatchObject({ eventId: ev.id });
  });

  it('équipement commun à tous les sites : pas de NC d’office, message ; Salarié refusé', async () => {
    actAs('Animateur QHSE', 'all');
    const gauge = await control(GAUGE);
    await (await db()).update(t.controls).set({ siteId: null }).where(eq(t.controls.id, gauge.id));
    const res = await recordControl({}, record(gauge.id, { performedOn: '2026-10-09' }));
    expect(res).toMatchObject({ ok: true, notice: expect.stringContaining('déclarez la non-conformité') });
    expect(res.eventId).toBeUndefined();
    await (await db()).update(t.controls).set({ siteId: 'ville-a' }).where(eq(t.controls.id, gauge.id));
    actAs('Salarié', 'ville-a');
    expect(await recordControl({}, record(gauge.id))).toEqual({ error: DENIED });
  });
});

describe('VEI-15 : registre de sécurité, observations et mises en demeure', () => {
  const noticeForm = (over: Record<string, string> = {}) => form({
    kind: 'mise_en_demeure', siteId: 'ville-b', receivedOn: '2026-10-05', authority: 'Inspection du travail', reference: 'MED-2026-04',
    text: 'Garde-corps de la plateforme PIRL à mettre en conformité.', dueOn: '2026-10-20', ...over,
  });

  it('inscription, modification, réponse : droits, site et journal', async () => {
    actAs('Chef de service', 'ville-a');
    expect(await saveSafetyNotice({}, noticeForm())).toMatchObject({ error: expect.stringContaining('autre site') });
    actAs('Salarié', 'ville-b');
    expect(await saveSafetyNotice({}, noticeForm())).toEqual({ error: DENIED });
    actAs('Chef de service', 'ville-b');
    expect(await saveSafetyNotice({}, noticeForm({ dueOn: '2026-10-01' }))).toMatchObject({ fieldErrors: { dueOn: 'Le délai de réponse suit la réception.' } });
    const created = await saveSafetyNotice({}, noticeForm());
    expect(created).toMatchObject({ ok: true });
    const id = Number(created.id);
    expect(await lastLog('safety_notice', id)).toMatchObject({ action: 'create', byId: 'sbenali', summary: 'Mise en demeure (Inspection du travail) inscrite au registre de sécurité' });
    expect(await saveSafetyNotice({}, noticeForm({ id: String(id), dueOn: '2026-10-25' }))).toMatchObject({ ok: true });
    expect(await lastLog('safety_notice', id)).toMatchObject({ action: 'update', details: [{ field: 'Délai de réponse', from: '20/10/2026', to: '25/10/2026' }] });
    actAs('Chef de service', 'ville-a');
    expect(await answerSafetyNotice({}, form({ id: String(id), answeredOn: '2026-10-09', answer: 'Garde-corps remplacé.' }))).toEqual({ error: OTHER_SITE });
    actAs('Chef de service', 'ville-b');
    expect(await answerSafetyNotice({}, form({ id: String(id), answeredOn: '2026-10-01', answer: 'Trop tôt.' }))).toMatchObject({ fieldErrors: { answeredOn: 'La réponse suit la réception.' } });
    expect(await answerSafetyNotice({}, form({ id: String(id), answeredOn: '2026-10-09', answer: 'Garde-corps remplacé, photo jointe au courrier.' }))).toEqual({ ok: true, id: String(id) });
    expect(await lastLog('safety_notice', id)).toMatchObject({ action: 'answer', summary: 'Réponse du 09/10/2026 enregistrée' });
    const { notices } = await loadSafetyNotices();
    expect(notices.find((n) => n.id === id)).toMatchObject({ state: { tone: 'ok' }, answer: 'Garde-corps remplacé, photo jointe au courrier.' });
  });

  it('annulation : motif obligatoire, service QHSE et direction seulement, jamais supprimée', async () => {
    actAs('Chef de service', 'ville-b');
    const created = await saveSafetyNotice({}, noticeForm({ kind: 'observation', text: 'Doublon.' }));
    const id = Number(created.id);
    expect(await cancelSafetyNotice({}, form({ id: String(id), reason: 'Doublon' }))).toEqual({ error: APPROVERS_ONLY });
    actAs('Animateur QHSE', 'ville-b');
    expect(await cancelSafetyNotice({}, form({ id: String(id), reason: '' }))).toMatchObject(REASON_REQUIRED);
    expect(await cancelSafetyNotice({}, form({ id: String(id), reason: 'Saisie en double de la mise en demeure' }))).toEqual({ ok: true, id: String(id) });
    expect(await lastLog('safety_notice', id)).toMatchObject({ action: 'cancel', reason: 'Saisie en double de la mise en demeure' });
    const [row] = await (await db()).select().from(t.safetyNotices).where(eq(t.safetyNotices.id, id));
    expect(row.cancelledAt).not.toBeNull();
    expect(await answerSafetyNotice({}, form({ id: String(id), answeredOn: '2026-10-09', answer: 'x' }))).toEqual({ error: 'Observation annulée : elle reste au registre en consultation seule.' });
  });

  it('échéance de réponse au responsable QHSE du site ; registre imprimable par site', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const { todo } = await loadWatchSignals();
    const pending = todo.find((x) => x.kind === 'Registre de sécurité' && x.siteId === 'ville-a');
    expect(pending).toMatchObject({ ownerIds: ['clefevre'], tone: 'warn', dueOn: '2026-10-19', key: expect.stringMatching(/^registre-securite\|\d+$/) });
    expect((await loadVisibleTodo()).some((x) => x.kind === 'Registre de sécurité')).toBe(true);
    // Salarié : écran de la veille fermé, aucune échéance du registre.
    actAs('Salarié', 'ville-a');
    expect((await loadVisibleTodo()).some((x) => x.kind === 'Registre de sécurité')).toBe(false);
    actAs('Animateur QHSE', 'ville-a');
    const { sites } = await loadSafetyRegisterPrint();
    expect(sites.map((s) => s.id)).toEqual(['ville-a']);
    expect(sites[0].notices.length).toBe(2);
    const pont = sites[0].controls.find((c) => c.equipment === 'Pont roulant 10 t — atelier montage')!;
    expect(pont.records.length).toBeGreaterThan(0);
  });
});

describe('DUE-19 : mesures de maîtrise liées aux contrôles, documents et habilitations', () => {
  async function riskOf(unitId: string, hazard: string) {
    const [r] = await (await db()).select().from(t.risks).where(and(eq(t.risks.unitId, unitId), eq(t.risks.hazard, hazard)));
    return r;
  }

  it('fiche du risque : validité calculée ; échéance au responsable QHSE du site quand une mesure n’est plus valide', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const handling = await riskOf('montage', 'Manutention mécanique');
    const view = (await loadRisks()).risks.find((r) => r.id === handling.id)!;
    const pont = view.measures.find((m) => m.kind === 'control')!;
    expect(pont).toMatchObject({ valid: false, state: expect.stringContaining('Contrôle dépassé'), href: expect.stringContaining('/veille') });
    const electric = await riskOf('montage', 'Électricité');
    const procedure = (await loadRisks()).risks.find((r) => r.id === electric.id)!.measures.find((m) => m.kind === 'document');
    // Procédure en vigueur dont la revue périodique est dépassée : signalée sans invalider la mesure.
    expect(procedure).toMatchObject({ valid: true, tone: 'warn', targetId: 'PR-QHSE-005' });
    const { todo } = await loadRiskSignals();
    expect(todo.find((x) => x.key === `duerp-mesure|${handling.id}`)).toMatchObject({ siteId: 'ville-a', ownerIds: ['clefevre'], href: `/risques?risque=${handling.id}` });
    // Salarié : lecture du DUERP, sans lien vers l'écran de la veille ; pas d'échéance (non responsable).
    actAs('Salarié', 'ville-a');
    const mine = (await loadRisks()).risks.find((r) => r.id === handling.id)!;
    expect(mine.measures.find((m) => m.kind === 'control')).toMatchObject({ href: null, valid: false });
    expect((await loadRiskSignals()).todo.some((x) => x.key?.startsWith('duerp-mesure|'))).toBe(false);
  });

  it('lier et retirer : droits, site, doublon, motif et journal', async () => {
    const noise = await riskOf('montage', 'Bruit');
    const [title] = await (await db()).select().from(t.trainingTitles).where(eq(t.trainingTitles.id, 'hauteur'));
    const link = (over: Record<string, string> = {}) => form({ riskId: String(noise.id), kind: 'title', targetId: title.id, ...over });
    for (const role of ['Salarié', 'Chef de projet'] as const) {
      actAs(role, 'ville-a');
      expect(await linkRiskMeasure({}, link())).toEqual({ error: DENIED });
    }
    actAs('Chef de service', 'ville-b');
    expect(await linkRiskMeasure({}, link())).toEqual({ error: OTHER_SITE });
    actAs('Chef de service', 'ville-a');
    // Contrôle d'un autre site : refusé.
    const bench = await control("Banc d'essais BE-1 — matériel ATEX");
    expect(await linkRiskMeasure({}, link({ kind: 'control', targetId: String(bench.id) }))).toMatchObject({ fieldErrors: { targetId: expect.any(String) } });
    expect(await linkRiskMeasure({}, link())).toEqual({ ok: true, id: String(noise.id) });
    expect(await lastLog('risk', noise.id)).toMatchObject({ action: 'link', summary: 'Mesure de maîtrise liée (habilitation ou formation) : Travail en hauteur' });
    expect(await linkRiskMeasure({}, link())).toMatchObject({ fieldErrors: { targetId: 'Élément déjà lié à ce risque.' } });
    const [row] = await (await db()).select().from(t.riskMeasureLinks).where(and(eq(t.riskMeasureLinks.riskId, noise.id), isNull(t.riskMeasureLinks.removedAt)));
    expect(await removeRiskMeasure({}, form({ id: String(row.id), reason: '' }))).toMatchObject(REASON_REQUIRED);
    expect(await removeRiskMeasure({}, form({ id: String(row.id), reason: 'Mesure portée par le harnais, pas par l’habilitation' }))).toEqual({ ok: true, id: String(noise.id) });
    expect(await lastLog('risk', noise.id)).toMatchObject({ action: 'unlink', reason: 'Mesure portée par le harnais, pas par l’habilitation' });
    const [kept] = await (await db()).select().from(t.riskMeasureLinks).where(eq(t.riskMeasureLinks.id, row.id));
    expect(kept.removedAt).not.toBeNull();
    // Relier après un retrait : nouvelle liaison.
    expect(await linkRiskMeasure({}, link())).toEqual({ ok: true, id: String(noise.id) });
  });
});

describe('DUE-20 : unités de travail reliées aux zones du plan de site', () => {
  async function zone(siteId: string, name: string) {
    const [z] = await (await db()).select().from(t.mapZones).where(and(eq(t.mapZones.siteId, siteId), eq(t.mapZones.name, name)));
    return z;
  }
  const unitForm = (over: Record<string, string>, zones: number[]) => {
    const fd = form({ id: 'bureaux', label: 'Bureaux', siteId: 'ville-a', zonesField: '1', ...over });
    zones.forEach((z) => fd.append('zoneIds', String(z)));
    return fd;
  };

  it('zones du site de l’unité seulement ; une zone passe d’une unité à l’autre ; journal de l’unité et de la carte', async () => {
    actAs('Chef de service', 'ville-a');
    const offices = await zone('ville-a', 'Bureaux');
    const be = await zone('ville-a', "Bureau d'études");
    const hall = await zone('ville-b', "Hall d'essais");
    expect(await saveWorkUnit({}, unitForm({}, [hall.id]))).toMatchObject({ fieldErrors: { zoneIds: expect.stringContaining("autre site") } });
    expect(await saveWorkUnit({}, unitForm({}, [offices.id, be.id]))).toEqual({ ok: true, id: 'bureaux' });
    expect(await lastLog('work_unit', 'bureaux')).toMatchObject({ summary: expect.stringContaining('Zones du plan rattachées : ') });
    expect((await changeLog('site_map', 'ville-a')).at(-1)).toMatchObject({ summary: expect.stringContaining("rattachée à l'unité de travail « Bureaux »") });
    // Le bureau d'études passe à l'unité « Bureau d'études » : retiré des bureaux.
    const fd = form({ id: 'be', label: "Bureau d'études", siteId: 'ville-a', zonesField: '1' });
    fd.append('zoneIds', String(be.id));
    expect(await saveWorkUnit({}, fd)).toEqual({ ok: true, id: 'be' });
    expect((await zone('ville-a', "Bureau d'études")).workUnitId).toBe('be');
    const units = (await loadRisks()).units;
    expect(units.find((u) => u.id === 'bureaux')!.zones.map((z) => z.name)).toEqual(['Bureaux']);
    // Aucune zone cochée : zones détachées.
    expect(await saveWorkUnit({}, unitForm({}, []))).toEqual({ ok: true, id: 'bureaux' });
    expect((await zone('ville-a', 'Bureaux')).workUnitId).toBeNull();
  });

  it('signalement par le QR code du poste : risques de l’unité proposés, risque d’une autre zone ignoré', async () => {
    const montage = await zone('ville-a', 'Atelier montage');
    const magasin = await zone('ville-a', 'Magasin');
    const risks = await loadZoneRisks([montage.id, magasin.id]);
    expect(risks[String(montage.id)].length).toBeGreaterThan(2);
    const chosen = risks[String(montage.id)][0];
    const jeton = signReportToken(config().reportSecret!, { siteId: montage.siteId, zoneId: montage.id, version: montage.qrVersion });
    actAs('Salarié', 'ville-a');
    const ok = await createReport(form({ type: 'SD', description: 'Élingue effilochée au poste M3.', jeton, riskId: String(chosen.id) }));
    const [ev] = await (await db()).select().from(t.events).where(eq(t.events.id, ok.id!));
    expect(ev).toMatchObject({ zoneId: montage.id, riskId: chosen.id });
    const other = risks[String(magasin.id)][0];
    const ignored = await createReport(form({ type: 'SD', description: 'Test.', jeton, riskId: String(other.id) }));
    const [ev2] = await (await db()).select().from(t.events).where(eq(t.events.id, ignored.id!));
    expect(ev2.riskId).toBeNull();
  });
});

describe('HAB-13 : efficacité des formations (évaluation à froid) et sensibilisation', () => {
  async function training(personId: string, titleId: string) {
    const [q] = await (await db()).select().from(t.qualifications)
      .where(and(eq(t.qualifications.personId, personId), eq(t.qualifications.titleId, titleId), isNull(t.qualifications.cancelledAt)));
    return q;
  }
  const evalForm = (id: number, over: Record<string, string> = {}) => form({ id: String(id), effectiveness: 'non_efficace', effectivenessOn: '2026-10-09', effectivenessNote: 'Consignation non maîtrisée au poste.', ...over });

  it('droits, site, constat obligatoire, date et journal de la formation', async () => {
    const q = await training('tnguyen', 'hauteur');
    for (const role of ['Salarié', 'Chef de projet'] as const) {
      actAs(role, 'ville-a');
      expect(await evaluateTrainingEffectiveness({}, evalForm(q.id))).toEqual({ error: DENIED });
    }
    actAs('Chef de service', 'ville-b');
    expect(await evaluateTrainingEffectiveness({}, evalForm(q.id))).toEqual({ error: OTHER_SITE });
    actAs('Chef de service', 'ville-a');
    expect(await evaluateTrainingEffectiveness({}, evalForm(q.id, { effectivenessNote: '' }))).toMatchObject({ fieldErrors: { effectivenessNote: expect.any(String) } });
    expect(await evaluateTrainingEffectiveness({}, evalForm(q.id, { effectivenessOn: '2000-01-01' }))).toMatchObject({ fieldErrors: { effectivenessOn: "L'évaluation suit l'obtention de la formation." } });
    expect(await evaluateTrainingEffectiveness({}, evalForm(q.id))).toEqual({ ok: true, id: String(q.id) });
    expect(await lastLog('qualification', q.id)).toMatchObject({ action: 'evaluate', byId: 'sbenali', summary: expect.stringContaining('Non efficace') });
    expect(await evaluateTrainingEffectiveness({}, evalForm(q.id, { effectiveness: 'efficace', effectivenessNote: '' }))).toMatchObject({ ok: true });
    expect(await lastLog('qualification', q.id)).toMatchObject({ details: expect.arrayContaining([{ field: 'Efficacité', from: 'Non efficace', to: 'Efficace' }]) });
    // Le salarié lit l'évaluation de sa formation.
    actAs('Salarié', 'ville-a');
    const cell = (await loadSkillMatrix()).rows[0].cells.find((c) => c.title.id === 'hauteur')!;
    expect(cell.history.find((e) => e.id === q.id)!.effectiveness).toMatchObject({ key: 'efficace', on: '2026-10-09' });
  });

  it('formation annulée : évaluation refusée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const q = await training('tnguyen', 'hauteur');
    await (await db()).update(t.qualifications).set({ cancelledAt: new Date(), cancelledById: 'clefevre', cancelReason: 'Test' }).where(eq(t.qualifications.id, q.id));
    expect(await evaluateTrainingEffectiveness({}, evalForm(q.id))).toEqual({ error: 'Formation annulée : elle ne peut plus être évaluée.' });
    await (await db()).update(t.qualifications).set({ cancelledAt: null, cancelledById: null, cancelReason: null }).where(eq(t.qualifications.id, q.id));
  });
});

describe('HAB-18 : indicateurs de compétences dans la revue', () => {
  it('taux de conformité, formations sur 12 mois et recyclages en retard au dossier de la revue', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const [review] = await (await db()).select().from(t.reviews).where(eq(t.reviews.status, 'planifiee'));
    const page = await loadReviewDossierPage({ revue: String(review.id) });
    if (!page || !('dossier' in page) || !page.dossier) throw new Error('dossier introuvable');
    expect(page.dossier.skills.indicators).toMatchObject({ required: expect.any(Number), rate: expect.any(Number), trainings12: expect.any(Number), lateRenewals: expect.any(Number) });
  });
});

describe('PRV-17 : inspections et réunions périodiques des interventions longues', () => {
  it('jeu de démonstration : prochaine réunion due au responsable du plan', async () => {
    actAs('Chef de service', 'ville-a');
    const plan = (await loadPrevention()).plans.find((p) => p.id === 'PP-2025-041')!;
    expect(plan).toMatchObject({ meetingPeriodDays: 30, nextMeeting: { dueOn: '2026-10-19', late: false } });
    const { todo } = await loadPreventionSignals();
    expect(todo.find((x) => x.key === 'pp-reunion|PP-2025-041')).toMatchObject({ ownerIds: ['sbenali'], dueOn: '2026-10-19', siteId: 'ville-a' });
  });

  it('séance, périodicité et annulation : droits, site, motif et journal', async () => {
    const meeting = (over: Record<string, string> = {}) => form({ planId: 'PP-2025-041', kind: 'reunion', heldOn: '2026-10-08', participants: '[S. Benali], chef d’équipe', notes: 'Point mensuel.', ...over });
    actAs('Salarié', 'ville-a');
    expect(await recordPlanMeeting({}, meeting())).toEqual({ error: DENIED });
    actAs('Chef de projet', 'ville-b');
    expect(await recordPlanMeeting({}, meeting())).toEqual({ error: OTHER_SITE });
    actAs('Chef de projet', 'ville-a');
    expect(await recordPlanMeeting({}, meeting({ heldOn: '2025-01-01' }))).toMatchObject({ fieldErrors: { heldOn: expect.stringContaining("début de l'intervention") } });
    const saved = await recordPlanMeeting({}, meeting());
    expect(saved).toMatchObject({ ok: true });
    expect(await lastLog('prevention_plan', 'PP-2025-041')).toMatchObject({ action: 'meeting', byId: 'edubois', summary: 'Réunion périodique de coordination du 08/10/2026 enregistrée' });
    expect((await loadPrevention()).plans.find((p) => p.id === 'PP-2025-041')!.nextMeeting).toEqual({ dueOn: '2026-11-07', late: false });
    expect(await setPlanMeetingPeriod({}, form({ id: 'PP-2025-041', meetingPeriodDays: '14' }))).toEqual({ ok: true, id: 'PP-2025-041' });
    expect(await lastLog('prevention_plan', 'PP-2025-041')).toMatchObject({ details: [{ field: 'Périodicité des inspections et réunions', from: '30 j', to: '14 j' }] });
    expect(await cancelPlanMeeting({}, form({ id: saved.id!, reason: '' }))).toMatchObject(REASON_REQUIRED);
    expect(await cancelPlanMeeting({}, form({ id: saved.id!, reason: 'Séance saisie deux fois' }))).toEqual({ ok: true, id: 'PP-2025-041' });
    expect(await lastLog('prevention_plan', 'PP-2025-041')).toMatchObject({ action: 'cancel_meeting', reason: 'Séance saisie deux fois' });
    // Dernière séance tenue : 19/09 (rel(-20)) + 14 jours → en retard.
    expect((await loadPrevention()).plans.find((p) => p.id === 'PP-2025-041')!.nextMeeting).toEqual({ dueOn: '2026-10-03', late: true });
    // Plan clos : plus de séance.
    expect(await recordPlanMeeting({}, meeting({ planId: 'PP-2026-008' }))).toEqual({ error: 'Ce plan est clos.' });
  });
});
