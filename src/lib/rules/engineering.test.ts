import { describe, expect, it } from 'vitest';
import {
  canDecideApproval, dispositionError, documentLinesText, ecoLocked, ecoOutcome, ecoStepBlocker, ecrSubjectError, engineeringHref, engineeringKind,
  invalidRefs, matriculeOrNull, parseDocumentLines, parseRefList, proposeEffectivity,
} from './engineering';

// D12 (lot 5 de M-02) : règles pures des demandes et ordres de modification.

const ok = (k: 'englead' | 'quality' | 'pm') => ({ approvalKey: k, decision: 'ok' as const });
const pending = (k: 'englead' | 'quality' | 'pm') => ({ approvalKey: k, decision: 'pending' as const });

describe('parcours d’un ordre', () => {
  it('étape suivante seulement ; interchangeabilité exigée avant l’approbation ; libération jamais demandée', () => {
    expect(ecoStepBlocker({ status: 'draft', interchangeability: null }, 'impact_analysis')).toBeNull();
    expect(ecoStepBlocker({ status: 'draft', interchangeability: null }, 'in_approval')).toMatch(/Seule l’étape suivante/);
    expect(ecoStepBlocker({ status: 'impact_analysis', interchangeability: null }, 'in_approval')).toMatch(/Interchangeabilité/);
    expect(ecoStepBlocker({ status: 'impact_analysis', interchangeability: 'no' }, 'in_approval')).toBeNull();
    expect(ecoStepBlocker({ status: 'in_approval', interchangeability: 'yes' }, 'released')).toMatch(/libéré d’office/);
    expect(ecoStepBlocker({ status: 'released', interchangeability: 'yes' }, 'draft')).toMatch(/ne change plus/);
  });

  it('issue : rejet dès un refus ; libération quand trois clés, interchangeabilité et dispositions sont acquises ; verrouillage', () => {
    const e = { status: 'in_approval' as const, interchangeability: 'yes' };
    const all = [ok('englead'), ok('quality'), ok('pm')];
    expect(ecoOutcome(e, [ok('englead'), { approvalKey: 'pm', decision: 'rejected' }], [])).toBe('rejected');
    expect(ecoOutcome(e, all, [{ disposition: 'update' }])).toBe('released');
    expect(ecoOutcome(e, all, [{ disposition: null }])).toBeNull();
    expect(ecoOutcome(e, [ok('englead'), ok('quality'), pending('pm')], [])).toBeNull();
    expect(ecoOutcome({ ...e, interchangeability: null }, all, [])).toBeNull();
    expect(ecoOutcome({ status: 'impact_analysis', interchangeability: 'yes' }, all, [])).toBeNull();
    expect(ecoLocked(e, all, [{ disposition: null }])).toBe(true);
    expect(ecoLocked(e, all, [{ disposition: 'na' }])).toBe(false);
    expect(ecoLocked({ status: 'draft', interchangeability: null }, all, [])).toBe(false);
  });

  it('droit de décider une clé : QHSE, ou approbateur désigné pour la sienne', () => {
    expect(canDecideApproval({ qhse: true, userId: 'a', approverId: null })).toBe(true);
    expect(canDecideApproval({ qhse: false, userId: 'a', approverId: 'a' })).toBe(true);
    expect(canDecideApproval({ qhse: false, userId: 'a', approverId: 'b' })).toBe(false);
    expect(canDecideApproval({ qhse: false, userId: 'a', approverId: null })).toBe(false);
  });

  it('disposition : rétrofit réservé aux machines', () => {
    expect(dispositionError('project', 'retrofit')).toMatch(/machine/);
    expect(dispositionError('machine', 'retrofit')).toBeNull();
    expect(dispositionError('project', null)).toBeNull();
  });
});

describe('effectivité proposée d’après Keystone', () => {
  it('projets déclarés et employeurs de l’article, machines qui le portent ou livrées par un projet visé', () => {
    const targets = proposeEffectivity({
      parts: ['ARB-MAL-045'], projects: ['K-2025-077'],
      bom: [{ projectCode: 'K-2025-042', partRef: 'ARB-MAL-045' }, { projectCode: 'K-2025-077', partRef: 'ARB-MAL-045' }, { projectCode: 'K-2024-097', partRef: 'VER-HYD-300' }],
      fleet: [
        { number: 'MCH-031', name: 'Malaxeur', projectCode: 'K-2025-042', partRef: 'RED-RD5-010', fittedRevision: 'B' },
        { number: 'MCH-031', name: 'Malaxeur', projectCode: 'K-2025-042', partRef: 'ARB-MAL-045', fittedRevision: 'A' },
        { number: 'MCH-022', name: 'Presse', projectCode: 'K-2024-097', partRef: 'VER-HYD-300', fittedRevision: 'C' },
        { number: 'MCH-040', name: 'Sans configuration', projectCode: 'K-2025-077', partRef: null, fittedRevision: null },
      ],
      projectLabel: (c) => `${c} · client`,
    });
    expect(targets.map((g) => [g.targetType, g.targetRef, g.isAutomatic, g.fittedPartRef, g.fittedRevision])).toEqual([
      ['project', 'K-2025-042', true, null, null], ['project', 'K-2025-077', false, null, null],
      ['machine', 'MCH-031', true, 'ARB-MAL-045', 'A'], ['machine', 'MCH-040', true, null, null],
    ]);
    expect(targets[0].label).toBe('K-2025-042 · client');
  });
});

describe('saisie', () => {
  it('listes de références, documents « libellé | identifiant », matricule, objet d’une demande', () => {
    expect(parseRefList('A-1, B-2\nA-1;C-3\n')).toEqual(['A-1', 'B-2', 'C-3']);
    expect(invalidRefs(['A-1', 'x'.repeat(65)])).toHaveLength(1);
    const docs = parseDocumentLines('Plan B\nContrôle | PRO-QUA-0006\n| PRO-HSE-0001');
    expect(docs).toEqual([{ refLabel: 'Plan B', codexDocId: null }, { refLabel: 'Contrôle', codexDocId: 'PRO-QUA-0006' }, { refLabel: 'PRO-HSE-0001', codexDocId: 'PRO-HSE-0001' }]);
    expect(documentLinesText(docs)).toBe('Plan B\nContrôle | PRO-QUA-0006\nPRO-HSE-0001');
    expect(matriculeOrNull('EMP-9001')).toBe('EMP-9001');
    expect(matriculeOrNull('9001')).toBeNull();
    expect(ecrSubjectError('document', { codexDocId: null, partRef: 'X', projectCode: null, eventId: null })).toMatchObject({ field: 'codexDocId' });
    expect(ecrSubjectError('part', { codexDocId: null, partRef: 'X', projectCode: null, eventId: null })).toBeNull();
  });

  it('numéros et liens profonds', () => {
    expect(engineeringKind('ECO-2026-015')).toBe('eco');
    expect(engineeringKind('ECR-2026-004')).toBe('ecr');
    expect(engineeringKind('ECO-26-1')).toBeNull();
    expect(engineeringHref('ECO-2026-015')).toBe('/modifications-techniques?sel=ECO-2026-015');
    expect(engineeringHref('ECR-2026-004')).toBe('/modifications-techniques?onglet=demandes&sel=ECR-2026-004');
  });
});
