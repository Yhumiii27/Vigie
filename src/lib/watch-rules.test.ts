import { describe, expect, it } from 'vitest';
import { currentEvaluation, equipmentCodeError, normalizeEquipmentCode } from './watch-rules';

describe('code commun d’équipement (pub_controles, demande de Crucible)', () => {
  it('mis en forme : bords, majuscules ; vide = null', () => {
    expect(normalizeEquipmentCode('  pde-pil ')).toBe('PDE-PIL');
    expect(normalizeEquipmentCode('   ')).toBeNull();
    expect(normalizeEquipmentCode(null)).toBeNull();
  });

  it('admis : codes de Crucible et codes composés, 2 à 32 caractères', () => {
    for (const code of [null, 'PDE', 'LAB67', 'PDE-PIL', 'LAB67-ETUVE-2', 'A1', 'A'.repeat(32)]) expect(equipmentCodeError(code), String(code)).toBeNull();
  });

  it('refusé : trop court ou trop long, caractères hors format, tiret au bord', () => {
    expect(equipmentCodeError('A')).toMatch(/2 à 32/);
    expect(equipmentCodeError('A'.repeat(33))).toMatch(/2 à 32/);
    for (const code of ['PDE PIL', 'PDE_PIL', 'PDÉ', '-PDE', 'PDE-', 'pde-pil']) expect(equipmentCodeError(code), code).toMatch(/majuscules/);
  });
});

describe('évaluation courante après une annulation (VEI-16)', () => {
  const e = (id: number, evaluatedOn: string, evaluation: string, cancelled = false, note: string | null = null) => ({ id, evaluatedOn, evaluation, note, cancelled });
  it('la plus récente non annulée : date, puis saisie la plus récente', () => {
    expect(currentEvaluation([e(1, '2026-01-10', 'ecart'), e(2, '2026-03-01', 'conforme', false, 'ok'), e(3, '2026-03-01', 'analyse', true)]))
      .toEqual({ evaluation: 'conforme', evaluationNote: 'ok', lastEvaluatedOn: '2026-03-01' });
    expect(currentEvaluation([e(4, '2026-03-01', 'ecart'), e(5, '2026-03-01', 'conforme')]).evaluation).toBe('conforme');
  });
  it('aucune évaluation restante : à évaluer, sans date', () => {
    expect(currentEvaluation([e(1, '2026-01-10', 'ecart', true)])).toEqual({ evaluation: 'a_evaluer', evaluationNote: null, lastEvaluatedOn: null });
    expect(currentEvaluation([])).toEqual({ evaluation: 'a_evaluer', evaluationNote: null, lastEvaluatedOn: null });
  });
});
