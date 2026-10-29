import { describe, expect, it } from 'vitest';
import { measureState } from './risk-measures';

// DUE-19 : une mesure de maîtrise liée (contrôle, document, habilitation) est signalée quand elle n'est plus valide.

const now = '2026-10-09';

describe('measureState', () => {
  it('contrôle périodique : réformé, résultat bloquant, dépassé, à jour', () => {
    expect(measureState({ kind: 'control', archived: true, nextOn: '2027-01-01', lastResult: 'favorable' }, now)).toMatchObject({ valid: false, label: 'Équipement réformé' });
    expect(measureState({ kind: 'control', archived: false, nextOn: '2027-01-01', lastResult: 'hors_tolerance' }, now)).toMatchObject({ valid: false, label: 'Dernier contrôle : hors tolérance' });
    expect(measureState({ kind: 'control', archived: false, nextOn: '2027-01-01', lastResult: 'defavorable' }, now).valid).toBe(false);
    expect(measureState({ kind: 'control', archived: false, nextOn: '2026-10-08', lastResult: null }, now)).toMatchObject({ valid: false, label: 'Contrôle dépassé depuis le 08/10/2026' });
    expect(measureState({ kind: 'control', archived: false, nextOn: '2026-10-09', lastResult: 'reserves' }, now)).toMatchObject({ valid: true, tone: 'ok' });
  });

  it('document : sans version en vigueur, revue dépassée (signalée sans invalider), en vigueur', () => {
    expect(measureState({ kind: 'document', inForce: false, nextReviewOn: null }, now)).toMatchObject({ valid: false });
    expect(measureState({ kind: 'document', inForce: true, nextReviewOn: '2026-01-01' }, now)).toMatchObject({ valid: true, tone: 'warn' });
    expect(measureState({ kind: 'document', inForce: true, nextReviewOn: '2027-01-01' }, now)).toMatchObject({ valid: true, tone: 'ok' });
  });

  it('habilitation : titre archivé, salariés sans titre valide, aucun salarié, à jour', () => {
    expect(measureState({ kind: 'title', archived: true, required: 3, lapsed: 0 }, now).valid).toBe(false);
    expect(measureState({ kind: 'title', archived: false, required: 3, lapsed: 2 }, now)).toMatchObject({ valid: false, label: '2 salariés du site sans titre valide' });
    expect(measureState({ kind: 'title', archived: false, required: 0, lapsed: 0 }, now)).toMatchObject({ valid: true, tone: 'warn' });
    expect(measureState({ kind: 'title', archived: false, required: 1, lapsed: 0 }, now)).toMatchObject({ valid: true, label: '1 salarié du site à jour' });
  });
});
