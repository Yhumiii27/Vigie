import { describe, expect, it } from 'vitest';
import {
  addHoursLocal, fmtLocalRange, fmtPeriod, fromParisLocal, isInProgress, isMandatory, lacksSignedPlan, lcfirst, legalReason, mandatoryReason,
  missingPresets, parseChecklist, permitDays, permitLacksSignedPlan, permitNeedsSignedPlan, permitPlanCheck, permitState, planEndIssue,
  planPhase, planStatus, ruleBasis, sevesoLabel, toParisLocal, validityOver, type SiteRule,
} from './model';

// Règles des plans de prévention et des permis (QUA-03) : R. 4512-6 à R. 4512-12, règle « dès la première minute ».

const NOW = '2026-10-09';
const SEVESO: SiteRule = { seveso: 'seuil_haut', ppFromFirstMinute: true };
const INTERNAL: SiteRule = { seveso: null, ppFromFirstMinute: true };
const LEGAL: SiteRule = { seveso: null, ppFromFirstMinute: false };

const plan = (over: Partial<Parameters<typeof planStatus>[0]> = {}) => ({
  status: 'brouillon', startOn: '2026-10-05', endOn: '2026-10-16', estimatedHours: 90, dangerousWork: false,
  inspectionOn: null as string | null, signedEuOn: null as string | null, signedEeOn: null as string | null, ...over,
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
  const opts = { mandatory: true, now: NOW, openPermitIds: [] as string[], actionCount: 0 };
  it('jamais pendant une intervention sans le plan obligatoire signé', () => {
    expect(planEndIssue(plan(), { ...opts, verb: 'clore' })).toBe(
      'Intervention en cours avec un plan obligatoire non signé : enregistrez les signatures des deux entreprises avant de clore le plan.',
    );
    expect(planEndIssue(plan(), { ...opts, actionCount: 1, verb: 'annuler' })).toMatch(/^Intervention en cours .* avant d'annuler le plan\.$/);
  });
  it('intervention réalisée sans plan signé : écart tracé par une action d’abord', () => {
    const past = plan({ startOn: '2026-09-01', endOn: '2026-09-05' });
    expect(planEndIssue(past, { ...opts, verb: 'clore' })).toBe("Intervention réalisée sans plan signé : créez l'action qui trace l'écart avant de clore le plan.");
    expect(planEndIssue(past, { ...opts, actionCount: 1, verb: 'clore' })).toBeNull();
  });
  it('intervention à venir ou plan non obligatoire : seuls les permis actifs bloquent', () => {
    expect(planEndIssue(plan({ startOn: '2026-11-01', endOn: '2026-11-02' }), { ...opts, verb: 'annuler' })).toBeNull();
    expect(planEndIssue(plan(), { ...opts, mandatory: false, verb: 'clore' })).toBeNull();
    expect(planEndIssue(plan(), { ...opts, mandatory: false, openPermitIds: ['PF-1', 'PE-2'], verb: 'clore' })).toBe(
      'Permis rattachés encore actifs (PF-1, PE-2) : clôturez-les ou annulez-les avant de clore le plan.',
    );
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
