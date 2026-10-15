import { describe, expect, it } from 'vitest';
import {
  PLAN_CONTENT, START_GAP_LABEL,
  addHoursLocal, firstFullSignatureOn, fmtLocalRange, fmtPeriod, fromParisLocal, fullSignatureOn, inGapWindow, isInProgress, isMandatory, lacksSignedPlan,
  lcfirst, legalReason, mandatoryReason, missingPlanContent, missingPresets, parseChecklist, permitDays, permitLacksSignedPlan, permitNeedsSignedPlan,
  permitPlanCheck, permitState, planContentStats, planEndIssue, planPhase, planSignIssue, planStatus, ruleBasis, sevesoLabel, signedBeforeStart, startGap,
  toParisLocal, validityOver, type PlanContent, type SiteRule,
} from './model';

// Règles des plans de prévention et des permis (QUA-03) : R. 4512-6 à R. 4512-12, règle « dès la première minute ».

const NOW = '2026-10-09';
const SEVESO: SiteRule = { seveso: 'seuil_haut', ppFromFirstMinute: true };
const INTERNAL: SiteRule = { seveso: null, ppFromFirstMinute: true };
const LEGAL: SiteRule = { seveso: null, ppFromFirstMinute: false };

const plan = (over: Partial<Parameters<typeof planStatus>[0]> = {}) => ({
  status: 'brouillon', startOn: '2026-10-05', endOn: '2026-10-16', estimatedHours: 90, dangerousWork: false,
  inspectionOn: null as string | null, signedEuOn: null as string | null, signedEeOn: null as string | null, firstSignedOn: null as string | null, ...over,
});
/** Instant à l'heure de Paris (heure d'été jusqu'au 25/10/2026). */
const paris = (local: string) => fromParisLocal(local)!;
const ms = (local: string) => paris(local).getTime();

describe('plan de prévention : obligation et statut', () => {
  it('obligation légale (≥ 400 h sur 12 mois ou travaux dangereux), sinon règle du site', () => {
    expect(isMandatory(plan({ estimatedHours: 399 }), LEGAL)).toBe(false);
    expect(isMandatory(plan({ estimatedHours: 400 }), LEGAL)).toBe(true);
    expect(isMandatory(plan({ dangerousWork: true }), null)).toBe(true);
    expect(isMandatory(plan({ estimatedHours: 6 }), SEVESO)).toBe(true);
    expect(legalReason(plan({ estimatedHours: 520, dangerousWork: true }))).toBe('520 h sur 12 mois et travaux dangereux');
    expect(mandatoryReason(plan(), SEVESO)).toBe("Établissement Seveso seuil haut : plan écrit et signé dès la première minute d'intervention");
    expect(mandatoryReason(plan({ dangerousWork: true }), LEGAL)).toBe('travaux dangereux');
  });
  it('fondement de la règle du site', () => {
    expect(ruleBasis(SEVESO)).toBe('Établissement Seveso seuil haut');
    expect(ruleBasis(INTERNAL)).toBe('Règle interne du site');
    expect(sevesoLabel('seuil_bas')).toBe('Établissement Seveso seuil bas');
    expect(sevesoLabel(null)).toBe('Établissement non classé Seveso');
    expect(lcfirst('Établissement Seveso seuil haut')).toBe('établissement Seveso seuil haut');
    expect(lcfirst('R. 4512-7')).toBe('R. 4512-7');
  });
  it('statut dérivé : brouillon → à signer (inspection commune faite) → signé ; clos et annulé conservés', () => {
    expect(planStatus(plan(), NOW)).toBe('brouillon');
    expect(planStatus(plan({ inspectionOn: '2026-10-15' }), NOW)).toBe('brouillon'); // inspection prévue
    expect(planStatus(plan({ inspectionOn: NOW }), NOW)).toBe('a_signer');
    expect(planStatus(plan({ inspectionOn: '2026-10-02', signedEuOn: '2026-10-02' }), NOW)).toBe('a_signer');
    expect(planStatus(plan({ inspectionOn: '2026-10-02', signedEuOn: '2026-10-02', signedEeOn: '2026-10-03' }), NOW)).toBe('signe');
    expect(planStatus(plan({ status: 'clos', signedEuOn: 'x', signedEeOn: 'x' }), NOW)).toBe('clos');
    expect(planStatus(plan({ status: 'annule' }), NOW)).toBe('annule');
  });
  it('phase des filtres : à venir, en cours, à clore, clos, annulé', () => {
    expect(planPhase(plan({ startOn: '2026-10-10' }), NOW)).toBe('a_venir');
    expect(planPhase(plan({ endOn: NOW }), NOW)).toBe('en_cours');
    expect(planPhase(plan({ endOn: '2026-10-08' }), NOW)).toBe('a_clore');
    expect(planPhase(plan({ status: 'clos' }), NOW)).toBe('clos');
    expect(planPhase(plan({ status: 'annule', startOn: '2027-01-01' }), NOW)).toBe('annule');
  });
  it('écart R. 4512-6 : intervention en cours sans plan obligatoire signé', () => {
    expect(isInProgress(plan(), NOW)).toBe(true);
    expect(lacksSignedPlan(plan({ dangerousWork: true }), NOW, LEGAL)).toBe(true);
    expect(lacksSignedPlan(plan(), NOW, LEGAL)).toBe(false); // non obligatoire
    expect(lacksSignedPlan(plan(), NOW, SEVESO)).toBe(true);
    expect(lacksSignedPlan(plan({ signedEuOn: '2026-10-02', signedEeOn: '2026-10-02' }), NOW, SEVESO)).toBe(false);
    expect(lacksSignedPlan(plan({ startOn: '2026-10-12' }), NOW, SEVESO)).toBe(false); // pas encore commencée
    expect(lacksSignedPlan(plan({ status: 'clos' }), NOW, SEVESO)).toBe(false);
  });
});

describe('planEndIssue : clore ou annuler un plan', () => {
  const opts = { mandatory: true, now: NOW, openPermitIds: [] as string[] };
  it('jamais pendant une intervention sans le plan obligatoire signé', () => {
    expect(planEndIssue(plan(), { ...opts, verb: 'clore' })).toBe(
      'Intervention en cours avec un plan obligatoire non signé : enregistrez les signatures des deux entreprises avant de clore le plan.',
    );
    expect(planEndIssue(plan(), { ...opts, verb: 'annuler' })).toMatch(/^Intervention en cours .* avant d'annuler le plan\.$/);
  });
  it('intervention réalisée sans plan signé : clôture permise sans action QSE (actions immédiates, 15/10/2026)', () => {
    const past = plan({ startOn: '2026-09-01', endOn: '2026-09-05' });
    expect(planEndIssue(past, { ...opts, verb: 'clore' })).toBeNull();
    expect(planEndIssue(past, { ...opts, verb: 'annuler' })).toBeNull();
    // L'écart reste un indicateur.
    expect(startGap(past, NOW, SEVESO)).toBe('non_signe');
  });
  it('intervention à venir ou plan non obligatoire : seuls les permis actifs bloquent', () => {
    expect(planEndIssue(plan({ startOn: '2026-11-01', endOn: '2026-11-02' }), { ...opts, verb: 'annuler' })).toBeNull();
    expect(planEndIssue(plan(), { ...opts, mandatory: false, verb: 'clore' })).toBeNull();
    expect(planEndIssue(plan(), { ...opts, mandatory: false, openPermitIds: ['PF-1', 'PE-2'], verb: 'clore' })).toBe(
      'Permis rattachés encore actifs (PF-1, PE-2) : clôturez-les ou annulez-les avant de clore le plan.',
    );
  });
});

describe('écarts R. 4512-6 au démarrage (PRV-01) : plan signé après le début, intervention sans plan signé', () => {
  const signed = (on: string, over: Partial<Parameters<typeof planStatus>[0]> = {}) =>
    plan({ status: 'signe', inspectionOn: '2026-10-02', signedEuOn: '2026-10-02', signedEeOn: on, ...over });
  it('première signature complète : la plus tardive des deux, conservée quand les signatures sont effacées', () => {
    expect(fullSignatureOn(signed('2026-10-03'))).toBe('2026-10-03');
    expect(fullSignatureOn(plan({ signedEuOn: '2026-10-04' }))).toBeNull();
    expect(firstFullSignatureOn(plan({ firstSignedOn: '2026-10-01' }))).toBe('2026-10-01');
    expect(firstFullSignatureOn(signed('2026-10-03', { firstSignedOn: '2026-10-01' }))).toBe('2026-10-01');
    expect(signedBeforeStart(signed('2026-10-05'))).toBe(true); // le jour même
    expect(signedBeforeStart(signed('2026-10-06'))).toBe(false);
  });
  it('plan obligatoire signé après le début de l’intervention : écart, même une fois signé', () => {
    expect(startGap(signed('2026-10-06'), NOW, SEVESO)).toBe('signe_apres');
    expect(startGap(signed('2026-10-06', { status: 'clos', startOn: '2026-10-05', endOn: '2026-10-06' }), NOW, SEVESO)).toBe('signe_apres');
    expect(START_GAP_LABEL.signe_apres).toBe("plan signé après le début de l'intervention");
  });
  it('signé le jour du début : pas d’écart', () => {
    expect(startGap(signed('2026-10-05'), NOW, SEVESO)).toBeNull();
  });
  it('signatures effacées par une modification : la première signature complète fait foi', () => {
    expect(startGap(plan({ firstSignedOn: '2026-10-03' }), NOW, SEVESO)).toBeNull();
    expect(startGap(plan({ firstSignedOn: '2026-10-07' }), NOW, SEVESO)).toBe('signe_apres');
    expect(startGap(signed('2026-10-08', { firstSignedOn: '2026-10-04' }), NOW, SEVESO)).toBeNull(); // signé à nouveau après le début
  });
  it('intervention terminée (ou en cours) sans plan signé : écart « non signé »', () => {
    expect(startGap(plan({ startOn: '2026-09-01', endOn: '2026-09-05' }), NOW, SEVESO)).toBe('non_signe');
    expect(startGap(plan({ startOn: '2026-09-01', endOn: '2026-09-05', signedEuOn: '2026-09-01' }), NOW, LEGAL)).toBeNull(); // non obligatoire
    expect(startGap(plan(), NOW, SEVESO)).toBe('non_signe'); // en cours : écart courant (lacksSignedPlan)
  });
  it('ni plan non obligatoire, ni plan annulé, ni intervention à venir', () => {
    expect(startGap(plan({ startOn: '2026-09-01', endOn: '2026-09-05' }), NOW, LEGAL)).toBeNull();
    expect(startGap(plan({ status: 'annule', startOn: '2026-09-01', endOn: '2026-09-05' }), NOW, SEVESO)).toBeNull();
    expect(startGap(plan({ startOn: '2026-10-12', endOn: '2026-10-14' }), NOW, SEVESO)).toBeNull();
    expect(startGap(plan({ startOn: NOW }), NOW, SEVESO)).toBe('non_signe'); // commencée aujourd'hui
  });
  it('fenêtre des indicateurs : interventions commencées dans les 12 derniers mois', () => {
    expect(inGapWindow({ startOn: '2025-10-09' }, NOW)).toBe(false);
    expect(inGapWindow({ startOn: '2025-10-10' }, NOW)).toBe(true);
    expect(inGapWindow({ startOn: NOW }, NOW)).toBe(true);
    expect(inGapWindow({ startOn: '2026-10-10' }, NOW)).toBe(false);
  });
  it('clore ou annuler un plan signé après le début : permis actifs seulement (aucune action QSE exigée)', () => {
    const opts = { mandatory: true, now: NOW, openPermitIds: [] as string[] };
    const late = signed('2026-10-06');
    expect(planEndIssue(late, { ...opts, verb: 'clore' })).toBeNull();
    expect(planEndIssue(late, { ...opts, verb: 'annuler' })).toBeNull();
    expect(planEndIssue(late, { ...opts, openPermitIds: ['PF-1'], verb: 'clore' })).toMatch(/^Permis rattachés encore actifs \(PF-1\)/);
    expect(planEndIssue(late, { ...opts, mandatory: false, verb: 'clore' })).toBeNull();
    expect(planEndIssue(signed('2026-10-05'), { ...opts, verb: 'clore' })).toBeNull();
  });
});

describe('contenu réglementaire du plan (PRV-02) : R. 4511-10, R. 4512-8, R. 4512-9', () => {
  const FULL: PlanContent = {
    eeHeadcount: 3, eeSupervisor: '[M. Lebrun]', subcontracting: 'Aucun', dangerousPhases: 'Nacelle', equipment: 'Nacelle de l’EE',
    workerInstructions: 'Accueil sécurité', emergencyOrganisation: 'SST, évacuation', coordination: 'Point quotidien', sirPosts: 'Aucun poste',
  };
  const ready = (over: Partial<PlanContent> & { measures?: string; inspectionOn?: string | null } = {}) =>
    ({ ...FULL, measures: 'Pont consigné.', inspectionOn: '2026-10-02', ...over });
  it('sections exigées pour signer : R. 4512-8 1° à 5° et R. 4512-9 ; R. 4511-10 jamais bloquant', () => {
    expect(PLAN_CONTENT.filter((c) => c.requiredToSign).map((c) => c.key))
      .toEqual(['dangerousPhases', 'equipment', 'workerInstructions', 'emergencyOrganisation', 'coordination', 'sirPosts']);
    expect(missingPlanContent(FULL)).toEqual([]);
    expect(missingPlanContent({ ...FULL, eeSupervisor: '', subcontracting: '', emergencyOrganisation: ' ', coordination: '' }))
      .toEqual(['premiers secours et évacuation', 'coordination et commandement']);
    expect(planContentStats(FULL)).toEqual({ filled: 9, total: 9 });
    expect(planContentStats({ ...FULL, eeHeadcount: null, sirPosts: '' })).toEqual({ filled: 7, total: 9 });
  });
  it('signature refusée : inspection commune, mesures, puis contenu d’un plan obligatoire (messages exacts)', () => {
    const sign = { now: NOW, mandatory: true, verb: 'signer' as const };
    const collect = { now: NOW, mandatory: true, verb: 'recueillir' as const };
    expect(planSignIssue(ready({ inspectionOn: null }), sign)).toBe("Réalisez l'inspection commune préalable avant de signer le plan.");
    expect(planSignIssue(ready({ inspectionOn: '2026-10-15' }), collect)).toBe("Réalisez l'inspection commune préalable avant de recueillir les signatures.");
    expect(planSignIssue(ready({ measures: ' ' }), sign)).toBe('Complétez les mesures de prévention avant de signer le plan.');
    expect(planSignIssue(ready({ measures: '' }), collect)).toBe('Complétez les mesures de prévention avant de recueillir les signatures.');
    expect(planSignIssue(ready({ emergencyOrganisation: '', coordination: '' }), sign))
      .toBe('Complétez le contenu du plan (R. 4512-8 et R. 4512-9) avant de signer le plan : premiers secours et évacuation, coordination et commandement.');
    expect(planSignIssue(ready({ sirPosts: '' }), collect))
      .toBe('Complétez le contenu du plan (R. 4512-8 et R. 4512-9) avant de recueillir les signatures : suivi individuel renforcé.');
    expect(planSignIssue(ready({ eeSupervisor: '', subcontracting: '', eeHeadcount: null }), sign)).toBeNull();
  });
  it('plan non obligatoire : seules l’inspection commune et les mesures sont exigées', () => {
    const empty = ready({ dangerousPhases: '', equipment: '', workerInstructions: '', emergencyOrganisation: '', coordination: '', sirPosts: '' });
    expect(planSignIssue(empty, { now: NOW, mandatory: false, verb: 'signer' })).toBeNull();
    expect(planSignIssue({ ...empty, measures: '' }, { now: NOW, mandatory: false, verb: 'signer' })).toBe('Complétez les mesures de prévention avant de signer le plan.');
    expect(planSignIssue({ ...empty, inspectionOn: null }, { now: NOW, mandatory: false, verb: 'recueillir' }))
      .toBe("Réalisez l'inspection commune préalable avant de recueillir les signatures.");
  });
});

describe('permis : statut calculé', () => {
  const permit = (over: Partial<Parameters<typeof permitState>[0]> = {}) => ({
    status: 'delivre', validFrom: paris('2026-10-08T07:30'), validTo: paris('2026-10-08T17:00'), watchUntil: paris('2026-10-08T19:00') as Date | null, ...over,
  });
  it('délivré : à venir, en cours pendant la validité et la surveillance, expiré au-delà', () => {
    expect(permitState(permit(), ms('2026-10-08T07:00'))).toBe('delivre');
    expect(permitState(permit(), ms('2026-10-08T07:30'))).toBe('en_cours');
    expect(permitState(permit(), ms('2026-10-08T18:30'))).toBe('en_cours'); // surveillance après travaux
    expect(permitState(permit(), ms('2026-10-08T19:01'))).toBe('expire');
    expect(permitState(permit({ watchUntil: null }), ms('2026-10-08T17:01'))).toBe('expire');
  });
  it('demande : expirée dès la fin de validité ; clos et annulé conservés', () => {
    expect(permitState(permit({ status: 'demande' }), ms('2026-10-08T16:59'))).toBe('demande');
    expect(permitState(permit({ status: 'demande' }), ms('2026-10-08T17:00'))).toBe('expire');
    expect(validityOver(permit(), ms('2026-10-08T17:00'))).toBe(true);
    expect(permitState(permit({ status: 'clos' }), ms('2026-10-20T00:00'))).toBe('clos');
    expect(permitState(permit({ status: 'annule' }), ms('2026-10-01T00:00'))).toBe('annule');
  });
  it('check-list : lecture tolérante, points obligatoires manquants', () => {
    expect(parseChecklist(null)).toEqual([]);
    expect(parseChecklist([{ label: ' Extincteur adapté à proximité ', checked: true }, { label: '' }, { checked: true }, 'x', { label: 'Autre', checked: 'oui' }]))
      .toEqual([{ label: 'Extincteur adapté à proximité', checked: true }, { label: 'Autre', checked: false }]);
    expect(missingPresets('feu', [{ label: 'Extincteur adapté à proximité', checked: true }])).toHaveLength(5);
    expect(missingPresets('essai', [])).toContain("Arrêt d'urgence testé");
  });
});

describe('permis et plan de prévention', () => {
  const linked = (over: Partial<ReturnType<typeof plan> & { id: string }> = {}) =>
    ({ id: 'PP-2026-015', ...plan({ inspectionOn: '2026-10-02', signedEuOn: '2026-10-02', signedEeOn: '2026-10-02' }), ...over });
  const permit = (over: Record<string, unknown> = {}) => ({
    type: 'feu', contractorId: 'EE-004' as string | null, preventionPlanId: 'PP-2026-015' as string | null,
    validFrom: paris('2026-10-08T07:30'), validTo: paris('2026-10-08T17:00'), ...over,
  });

  it('plan signé exigé : entreprise extérieure sur un site « dès la première minute », ou permis de feu d’une entreprise extérieure', () => {
    expect(permitNeedsSignedPlan(permit({ type: 'essai' }), SEVESO)).toBe(true);
    expect(permitNeedsSignedPlan(permit({ type: 'essai' }), LEGAL)).toBe(false);
    expect(permitNeedsSignedPlan(permit(), LEGAL)).toBe(true);
    expect(permitNeedsSignedPlan(permit({ contractorId: null }), SEVESO)).toBe(false);
  });
  it('jours de validité à l’heure de Paris', () => {
    expect(permitDays({ validFrom: new Date('2026-10-07T22:30:00Z'), validTo: new Date('2026-10-08T15:00:00Z') })).toEqual({ from: '2026-10-08', to: '2026-10-08' });
  });
  it('défauts : introuvable, absent, clos, période, signature', () => {
    expect(permitPlanCheck(permit(), null, SEVESO)).toEqual({ kind: 'missing', message: 'Le plan de prévention PP-2026-015 est introuvable.' });
    expect(permitPlanCheck(permit({ preventionPlanId: null }), null, LEGAL)?.message).toMatch(/^Aucun plan de prévention n'est rattaché au permis de feu/);
    expect(permitPlanCheck(permit({ preventionPlanId: null, type: 'essai' }), null, SEVESO)?.message).toBe("Aucun plan de prévention n'est rattaché à l'intervention de l'entreprise extérieure.");
    expect(permitPlanCheck(permit({ preventionPlanId: null, contractorId: null }), null, SEVESO)).toBeNull();
    expect(permitPlanCheck(permit(), linked({ status: 'annule' }), SEVESO)).toEqual({ kind: 'closed', message: 'Le plan de prévention PP-2026-015 est annulé.' });
    expect(permitPlanCheck(permit(), linked({ startOn: '2026-10-09' }), SEVESO)?.kind).toBe('dates');
    expect(permitPlanCheck(permit(), linked({ signedEeOn: null }), SEVESO)).toEqual({ kind: 'unsigned', message: "Le plan de prévention PP-2026-015 n'est pas signé par les deux entreprises." });
    // Permis de feu hors règle du site, sur un plan non obligatoire par ailleurs : motif précisé.
    expect(permitPlanCheck(permit(), linked({ signedEeOn: null }), LEGAL)?.message).toBe(
      "Le plan de prévention PP-2026-015 n'est pas signé par les deux entreprises (permis de feu : travaux dangereux, plan écrit obligatoire).",
    );
    expect(permitPlanCheck(permit(), linked(), SEVESO)).toBeNull();
    // Permis interne rattaché à un plan non obligatoire et non signé : en règle.
    expect(permitPlanCheck(permit({ type: 'essai', contractorId: null }), linked({ signedEeOn: null, signedEuOn: null }), LEGAL)).toBeNull();
  });
  it('écart « dès la première minute » : permis actif d’une entreprise extérieure sans plan signé', () => {
    const active = (over: Record<string, unknown> = {}) => ({ ...permit(over), status: 'demande', watchUntil: null, ...over });
    const at = ms('2026-10-08T08:00');
    expect(permitLacksSignedPlan(active(), linked({ signedEeOn: null }), SEVESO, at)).toBe(true);
    expect(permitLacksSignedPlan(active(), linked(), SEVESO, at)).toBe(false);
    expect(permitLacksSignedPlan(active(), linked({ signedEeOn: null }), LEGAL, at)).toBe(false); // règle du site inactive
    expect(permitLacksSignedPlan(active({ status: 'clos' }), linked({ signedEeOn: null }), SEVESO, at)).toBe(false);
    expect(permitLacksSignedPlan(active(), linked({ signedEeOn: null }), SEVESO, ms('2026-10-08T17:00'))).toBe(false); // demande expirée
  });
});

describe('dates et heures (Europe/Paris)', () => {
  it('heure locale ↔ instant, heures d’été et d’hiver', () => {
    expect(toParisLocal(new Date('2026-10-07T06:00:00Z'))).toBe('2026-10-07T08:00');
    expect(toParisLocal(new Date('2026-12-01T07:00:00Z'))).toBe('2026-12-01T08:00');
    expect(toParisLocal(new Date('2026-10-07T22:30:00Z'))).toBe('2026-10-08T00:30');
    expect(paris('2026-10-07T08:00').toISOString()).toBe('2026-10-07T06:00:00.000Z');
    expect(paris('2026-12-01T08:00').toISOString()).toBe('2026-12-01T07:00:00.000Z');
    expect(paris('2026-10-25T12:00').toISOString()).toBe('2026-10-25T11:00:00.000Z'); // jour du passage à l'heure d'hiver
    expect(paris('2026-03-29T12:00').toISOString()).toBe('2026-03-29T10:00:00.000Z'); // jour du passage à l'heure d'été
    expect(fromParisLocal('2026-10-07')).toBeNull();
    expect(fromParisLocal('2026-10-07 08:00')).toBeNull();
  });
  it('horloge murale et mises en forme', () => {
    expect(addHoursLocal('2026-10-07T23:00', 2)).toBe('2026-10-08T01:00');
    expect(addHoursLocal('invalide', 2)).toBe('invalide');
    expect(fmtLocalRange('2026-10-07T07:30', '2026-10-07T18:00')).toBe('07/10 07:30 → 18:00');
    expect(fmtLocalRange('2026-10-06T08:00', '2026-10-09T18:00')).toBe('06/10 08:00 → 09/10 18:00');
    expect(fmtPeriod('2026-10-05', '2026-10-09')).toBe('du 05/10 au 09/10/2026');
    expect(fmtPeriod('2025-12-29', '2026-01-02')).toBe('du 29/12/2025 au 02/01/2026');
  });
});
