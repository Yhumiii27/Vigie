import { describe, expect, it } from 'vitest';
import { equipmentCodeError, normalizeEquipmentCode } from './watch-rules';

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
