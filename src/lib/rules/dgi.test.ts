import { describe, expect, it } from 'vitest';
import { canHandleDgi, canReadDgi, canRecordDgi, canSignDgi, dgiState, needsMeasures, reportedAtError } from './dgi';

describe('registre des dangers graves et imminents (CNF-01)', () => {
  it('accès : animateur QHSE, direction et membres du CSE quel que soit leur rôle', () => {
    expect(canReadDgi({ role: 'Animateur QHSE', cse: false })).toBe(true);
    expect(canReadDgi({ role: 'Direction', cse: false })).toBe(true);
    expect(canReadDgi({ role: 'Salarié', cse: true })).toBe(true);
    expect(canReadDgi({ role: 'Salarié', cse: false })).toBe(false);
    expect(canReadDgi({ role: 'Chef de projet', cse: false })).toBe(false);
    expect(canRecordDgi({ role: 'Direction', cse: false })).toBe(false);
    expect(canRecordDgi({ role: 'Animateur QHSE', cse: false })).toBe(true);
    expect(canSignDgi({ role: 'Animateur QHSE', cse: false })).toBe(false);
    expect(canSignDgi({ role: 'Salarié', cse: true })).toBe(true);
    expect(canHandleDgi({ role: 'Direction', cse: true })).toBe(false);
    expect(canHandleDgi({ role: 'Animateur QHSE', cse: false })).toBe(true);
  });

  it('état calculé et échéance des mesures', () => {
    const n = { signedAt: null, measuresAt: null, closedAt: null, cancelledAt: null };
    expect(dgiState(n)).toBe('a_signer');
    expect(dgiState({ ...n, signedAt: 1 })).toBe('signale');
    expect(dgiState({ ...n, signedAt: 1, measuresAt: 1 })).toBe('mesures');
    expect(dgiState({ ...n, signedAt: 1, measuresAt: 1, closedAt: 1 })).toBe('clos');
    expect(dgiState({ ...n, cancelledAt: 1 })).toBe('annule');
    expect(needsMeasures(n)).toBe(true);
    expect(needsMeasures({ ...n, measuresAt: 1 })).toBe(false);
    expect(needsMeasures({ ...n, cancelledAt: 1 })).toBe(false);
  });

  it('date et heure de l’alerte : ni future ni de plus d’un an', () => {
    expect(reportedAtError('2026-10-09T09:00', '2026-10-09T10:00')).toBeNull();
    expect(reportedAtError('2026-10-09T11:00', '2026-10-09T10:00')).toMatch(/postérieures/);
    expect(reportedAtError('2025-10-01T11:00', '2026-10-09T10:00')).toMatch(/plus d’un an/);
    expect(reportedAtError('09/10/2026', '2026-10-09T10:00')).toMatch(/invalides/);
    expect(reportedAtError(null, '2026-10-09T10:00')).toMatch(/obligatoires/);
  });
});
