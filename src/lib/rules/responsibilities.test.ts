import { describe, expect, it } from 'vitest';
import { reassignTargetError, responsibilitySummary, responsibilityTotal } from './responsibilities';

describe('responsabilités d’une personne sortie (HAB-05)', () => {
  const c = { actions: 2, events: 0, plans: 0, audits: 0, controls: 1, requirements: 0 };
  it('décompte et résumé', () => {
    expect(responsibilityTotal(c)).toBe(3);
    expect(responsibilitySummary(c)).toBe('2 actions QSE ouvertes (responsable), 1 contrôle périodique (responsable)');
  });
  it('personne reprenant les responsabilités : connue, présente, autre', () => {
    expect(reassignTargetError('a', undefined)).toMatch(/inconnue/);
    expect(reassignTargetError('a', { id: 'a', left: false })).toMatch(/autre personne/);
    expect(reassignTargetError('a', { id: 'b', left: true })).toMatch(/sortie/);
    expect(reassignTargetError('a', { id: 'b', left: false })).toBeNull();
  });
});
