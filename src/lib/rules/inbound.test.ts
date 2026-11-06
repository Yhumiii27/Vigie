import { describe, expect, it } from 'vitest';
import { EVENT_STEPS } from '../domain';
import { NC_STATUS_CODES, decideEcoRequest, decideEcrRequest, decideNcRequest, inboundSummary, ncStatusOfStep, type EcoFacts, type NcFacts } from './inbound';

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

// D12 (lot 5 de M-02) : création d'une demande par Codex, avancement d'un ordre par Keystone.
describe('demandes de D12', () => {
  const doc = { id: 'PRO-HSE-0001', title: 'Signalement', site: null, withdrawn: false };
  const payload = { kind: 'modification', documentId: 'PRO-HSE-0001', reason: 'Logigramme', requester: { name: '[J. Wagner]', ref: 'jwagner' } };

  it('création par Codex : demande créée, refusée d’office (document inconnu, retiré, déjà en cours) ou contenu invalide', () => {
    expect(decideEcrRequest(payload, { document: doc, openEcr: null }, 'ECR-2026-004')).toMatchObject({ kind: 'create', title: 'Modification de PRO-HSE-0001 · Signalement' });
    expect(decideEcrRequest(payload, { document: null, openEcr: null }, 'ECR-2026-004')).toMatchObject({ kind: 'reject_create', code: 'not_found' });
    expect(decideEcrRequest(payload, { document: { ...doc, withdrawn: true }, openEcr: null }, 'ECR-2026-004')).toMatchObject({ kind: 'reject_create', code: 'refused' });
    expect(decideEcrRequest(payload, { document: doc, openEcr: 'ECR-2026-001' }, 'ECR-2026-004')).toMatchObject({ kind: 'reject_create', code: 'refused', message: expect.stringContaining('ECR-2026-001') });
    expect(decideEcrRequest({ ...payload, reason: '' }, { document: doc, openEcr: null }, 'ECR-2026-004')).toMatchObject({ kind: 'reject', code: 'invalid' });
  });

  it('avancement d’un ordre par Keystone : étape suivante, clés ingénierie et projets, jamais la clé qualité ni un ordre clos', () => {
    const facts = (status: 'draft' | 'impact_analysis' | 'in_approval' | 'released', interchangeability: string | null = 'yes'): EcoFacts => ({
      status, interchangeability, approvals: [{ approvalKey: 'englead', decision: 'ok' }, { approvalKey: 'quality', decision: 'pending' }, { approvalKey: 'pm', decision: 'pending' }],
    });
    const step = (from: string, to: string) => ({ kind: 'step', fromStatus: from, targetStatus: to });
    expect(decideEcoRequest('eco_step', step('draft', 'impact_analysis'), facts('draft'), 'ECO-1')).toEqual({ kind: 'step', from: 'draft', to: 'impact_analysis' });
    expect(decideEcoRequest('eco_step', step('impact_analysis', 'in_approval'), facts('draft'), 'ECO-1')).toMatchObject({ code: 'stale' });
    expect(decideEcoRequest('eco_step', step('draft', 'in_approval'), facts('draft'), 'ECO-1')).toMatchObject({ code: 'invalid' });
    expect(decideEcoRequest('eco_step', step('impact_analysis', 'in_approval'), facts('impact_analysis', null), 'ECO-1')).toMatchObject({ code: 'refused' });
    expect(decideEcoRequest('eco_step', step('in_approval', 'released'), facts('in_approval'), 'ECO-1')).toMatchObject({ code: 'invalid' });
    const approve = (key: string, decision = 'ok') => ({ kind: 'approval', approvalKey: key, decision });
    expect(decideEcoRequest('eco_approval', approve('pm'), facts('in_approval'), 'ECO-1')).toEqual({ kind: 'approval', key: 'pm', decision: 'ok', unchanged: false });
    expect(decideEcoRequest('eco_approval', approve('englead'), facts('in_approval'), 'ECO-1')).toMatchObject({ unchanged: true });
    expect(decideEcoRequest('eco_approval', approve('englead', 'rejected'), facts('in_approval'), 'ECO-1')).toMatchObject({ code: 'refused' });
    expect(decideEcoRequest('eco_approval', approve('quality'), facts('in_approval'), 'ECO-1')).toMatchObject({ code: 'refused' });
    expect(decideEcoRequest('eco_approval', approve('pm'), facts('impact_analysis'), 'ECO-1')).toMatchObject({ code: 'stale' });
    expect(decideEcoRequest('eco_approval', approve('pm'), facts('released'), 'ECO-1')).toMatchObject({ code: 'refused' });
    expect(decideEcoRequest('eco_approval', approve('pm'), null, 'ECO-1')).toMatchObject({ code: 'not_found' });
    expect(decideEcoRequest('eco_step', approve('pm'), facts('in_approval'), 'ECO-1')).toMatchObject({ code: 'invalid' });
  });
});
