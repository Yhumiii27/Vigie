import { describe, expect, it } from 'vitest';
import { controlLoopBack, currentEvaluation, equipmentCodeError, normalizeEquipmentCode, requirementLoopBack } from './watch-rules';

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

describe('VEI-05 : boucle à fermer (action close, écart ou réserves ouverts)', () => {
  const verified = { status: 'verifiee', effective: true };
  it('exigence en écart ou en analyse dont l’action est vérifiée ou abandonnée', () => {
    expect(requirementLoopBack({ evaluation: 'ecart', actionId: 'A-1', archived: false }, verified)).toEqual({ actionId: 'A-1', abandoned: false });
    expect(requirementLoopBack({ evaluation: 'analyse', actionId: 'A-1', archived: false }, { status: 'abandonnee' })).toEqual({ actionId: 'A-1', abandoned: true });
  });
  it('vérifiée non efficace (ou sans résultat) : l’action de suite prend le relais, pas de relance', () => {
    expect(requirementLoopBack({ evaluation: 'ecart', actionId: 'A-1', archived: false }, { status: 'verifiee', effective: false })).toBeNull();
    expect(controlLoopBack({ reserves: 'Garde-corps', actionId: 'A-2', archived: false }, { status: 'verifiee', effective: null })).toBeNull();
  });
  it('rien tant que l’action est ouverte, sans action, après une réévaluation conforme, ou pour une exigence archivée', () => {
    expect(requirementLoopBack({ evaluation: 'ecart', actionId: 'A-1', archived: false }, { status: 'terminee' })).toBeNull();
    expect(requirementLoopBack({ evaluation: 'ecart', actionId: null, archived: false }, verified)).toBeNull();
    expect(requirementLoopBack({ evaluation: 'conforme', actionId: 'A-1', archived: false }, verified)).toBeNull();
    expect(requirementLoopBack({ evaluation: 'ecart', actionId: 'A-1', archived: true }, verified)).toBeNull();
    expect(requirementLoopBack({ evaluation: 'ecart', actionId: 'A-1', archived: false }, undefined)).toBeNull();
  });
  it('réserves inscrites dont l’action de levée est close ; rien sans réserve ni pour un équipement réformé', () => {
    expect(controlLoopBack({ reserves: 'Garde-corps', actionId: 'A-2', archived: false }, verified)).toEqual({ actionId: 'A-2', abandoned: false });
    expect(controlLoopBack({ reserves: null, actionId: 'A-2', archived: false }, verified)).toBeNull();
    expect(controlLoopBack({ reserves: 'Garde-corps', actionId: 'A-2', archived: true }, verified)).toBeNull();
    expect(controlLoopBack({ reserves: 'Garde-corps', actionId: 'A-2', archived: false }, { status: 'a_faire' })).toBeNull();
  });
});
