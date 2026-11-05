import { describe, expect, it } from 'vitest';
import { EVENT_STEPS } from '../domain';
import { NC_STATUS_CODES, decideNcRequest, inboundSummary, ncStatusOfStep, type NcFacts } from './inbound';

// D13, décisions CV-07 et CV-08 : ce que Keystone peut demander sur une NC de projet de Vigie.

const nc = (step: number, more: Partial<NcFacts> = {}): NcFacts => ({ step, dismissed: false, activityCode: null, partRef: null, deliverableNumber: null, ...more });
const decide = (kind: Parameters<typeof decideNcRequest>[0], payload: unknown, facts: NcFacts | null) => decideNcRequest(kind, payload, facts, EVENT_STEPS, 'EV-2026-130');

describe('décision sur une demande de Keystone', () => {
  it('états de Keystone = étapes de Vigie (pub_non_conformites)', () => {
    expect(NC_STATUS_CODES).toHaveLength(EVENT_STEPS.length);
    expect(ncStatusOfStep(2)).toBe('root_cause');
    expect(ncStatusOfStep(9)).toBe('closed');
  });

  it('passage à l’étape suivante seulement, depuis l’étape vue par Keystone', () => {
    expect(decide('nc_step', { kind: 'step', fromStatus: 'root_cause', targetStatus: 'corrective_action' }, nc(2))).toEqual({ kind: 'advance', fromStep: 2, toStep: 3 });
    expect(decide('nc_step', { kind: 'step', fromStatus: 'containment', targetStatus: 'root_cause' }, nc(2))).toMatchObject({ kind: 'reject', code: 'stale' });
    expect(decide('nc_step', { kind: 'step', fromStatus: 'root_cause', targetStatus: 'verification' }, nc(2))).toMatchObject({ kind: 'reject', code: 'invalid' });
  });

  it('ni qualification ni clôture par un passage d’étape', () => {
    expect(decide('nc_step', { kind: 'step', fromStatus: 'open', targetStatus: 'containment' }, nc(0))).toMatchObject({ kind: 'reject', code: 'refused' });
    expect(decide('nc_step', { kind: 'step', fromStatus: 'verification', targetStatus: 'closed' }, nc(4))).toMatchObject({ kind: 'reject', code: 'refused' });
  });

  it('vérification : proposition au QHSE, à l’étape « Efficacité vérifiée » seulement', () => {
    expect(decide('nc_verification', { kind: 'verification', fromStatus: 'verification', decision: 'approved' }, nc(4))).toEqual({ kind: 'proposal', decision: 'approved' });
    expect(decide('nc_verification', { kind: 'verification', fromStatus: 'verification', decision: 'rejected' }, nc(4))).toEqual({ kind: 'proposal', decision: 'rejected' });
    expect(decide('nc_verification', { kind: 'verification', fromStatus: 'verification', decision: 'approved' }, nc(3))).toMatchObject({ kind: 'reject', code: 'stale' });
  });

  it('références : posées seulement si vides, refus si une autre valeur est déjà saisie', () => {
    expect(decide('nc_references', { kind: 'references', partRef: 'ART-1', activityCode: 'ACT-2' }, nc(1, { partRef: 'ART-1' }))).toEqual({ kind: 'references', set: { activityCode: 'ACT-2' } });
    expect(decide('nc_references', { kind: 'references', partRef: 'ART-9' }, nc(1, { partRef: 'ART-1' }))).toMatchObject({ kind: 'reject', code: 'refused' });
    expect(decide('nc_references', { kind: 'references' }, nc(1))).toMatchObject({ kind: 'reject', code: 'invalid' });
  });

  it('NC introuvable, classée ou clôturée ; contenu invalide ou de nature différente', () => {
    expect(decide('nc_step', { kind: 'step', fromStatus: 'root_cause', targetStatus: 'corrective_action' }, null)).toMatchObject({ kind: 'reject', code: 'not_found' });
    expect(decide('nc_step', { kind: 'step', fromStatus: 'root_cause', targetStatus: 'corrective_action' }, nc(2, { dismissed: true }))).toMatchObject({ kind: 'reject', code: 'refused' });
    expect(decide('nc_references', { kind: 'references', partRef: 'A' }, nc(5))).toMatchObject({ kind: 'reject', code: 'refused' });
    expect(decide('nc_step', { kind: 'verification', fromStatus: 'verification', decision: 'approved' }, nc(4))).toMatchObject({ kind: 'reject', code: 'invalid' });
    expect(decide('nc_step', { kind: 'step', fromStatus: 'nope' }, nc(2))).toMatchObject({ kind: 'reject', code: 'invalid' });
  });

  it('résumé lisible de la demande', () => {
    expect(inboundSummary('nc_step', { kind: 'step', fromStatus: 'root_cause', targetStatus: 'corrective_action' }, EVENT_STEPS)).toBe('Passage à l\'étape « Actions »');
    expect(inboundSummary('nc_references', { kind: 'references', partRef: 'ART-1' }, EVENT_STEPS)).toBe('Références : Article Keystone ART-1');
  });
});
