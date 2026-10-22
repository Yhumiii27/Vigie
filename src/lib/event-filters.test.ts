import { describe, expect, it } from 'vitest';
import { eventFilterParams, hasEventFilters, matchesEventFilters, parseEventFilters, workforceAccident } from './event-filters';

// Filtres de la liste des événements (EVT-13) : paramètres d'URL, blessure réservée aux rôles habilités aux données de santé.

const NOW = '2026-10-09';
const ev = (over: Partial<Parameters<typeof matchesEventFilters>[0]> = {}) => ({
  type: 'AT', occurredOn: '2026-09-01', step: 1, severity: 3, pilotId: 'clefevre', injury: 'arret', victimKind: 'salarie', commute: false, ...over,
});

describe('parseEventFilters', () => {
  it('valeurs valides retenues, invalides ignorées', () => {
    expect(parseEventFilters({ etape: '2', gravite: '4', anciennete: '30', du: '2026-01-01', au: '2026-12-31', pilote: 'clefevre', effectif: '1' }, { health: true, pilots: new Set(['clefevre']) }))
      .toEqual({ etape: 2, gravite: 4, anciennete: 30, du: '2026-01-01', au: '2026-12-31', pilote: 'clefevre', effectif: true });
    expect(parseEventFilters({ etape: '9', gravite: '5', anciennete: '45', du: '01/01/2026', pilote: 'inconnu', effectif: 'oui' }, { health: true, pilots: new Set(['clefevre']) })).toEqual({});
    expect(parseEventFilters({ pilote: 'aucun' }, { health: false, pilots: new Set() })).toEqual({ pilote: 'aucun' });
  });
  it('blessure : ignorée pour un rôle non habilité aux données de santé', () => {
    expect(parseEventFilters({ blessure: 'arret' }, { health: true })).toEqual({ blessure: 'arret' });
    expect(parseEventFilters({ blessure: 'arret' }, { health: false })).toEqual({});
    expect(parseEventFilters({ blessure: 'grave' }, { health: true })).toEqual({});
  });
  it('paramètres d’URL et présence de filtres', () => {
    expect(eventFilterParams({ etape: 0, effectif: true })).toMatchObject({ etape: '0', effectif: '1', blessure: undefined });
    expect(hasEventFilters({})).toBe(false);
    expect(hasEventFilters({ etape: 0 })).toBe(true);
  });
});

describe('matchesEventFilters', () => {
  it('blessure : AT seulement ; sans blessure renseignée comptée « sans arrêt » (pyramide)', () => {
    expect(matchesEventFilters(ev(), { blessure: 'arret' }, NOW)).toBe(true);
    expect(matchesEventFilters(ev({ injury: null }), { blessure: 'sans_arret' }, NOW)).toBe(true);
    expect(matchesEventFilters(ev({ injury: 'soins' }), { blessure: 'arret' }, NOW)).toBe(false);
    expect(matchesEventFilters(ev({ type: 'PA', injury: null }), { blessure: 'sans_arret' }, NOW)).toBe(false);
  });
  it('effectif, étape, pilote, période, gravité, ancienneté', () => {
    expect(matchesEventFilters(ev({ victimKind: 'interimaire' }), { effectif: true }, NOW)).toBe(false);
    expect(matchesEventFilters(ev({ commute: true }), { effectif: true }, NOW)).toBe(false);
    expect(matchesEventFilters(ev(), { etape: 1 }, NOW)).toBe(true);
    expect(matchesEventFilters(ev(), { etape: 2 }, NOW)).toBe(false);
    expect(matchesEventFilters(ev({ pilotId: null }), { pilote: 'aucun' }, NOW)).toBe(true);
    expect(matchesEventFilters(ev(), { pilote: 'aucun' }, NOW)).toBe(false);
    expect(matchesEventFilters(ev(), { du: '2026-09-01', au: '2026-09-01' }, NOW)).toBe(true);
    expect(matchesEventFilters(ev(), { du: '2026-09-02' }, NOW)).toBe(false);
    expect(matchesEventFilters(ev(), { gravite: 2 }, NOW)).toBe(false);
    // 38 jours depuis les faits : plus de 30, pas plus de 60.
    expect(matchesEventFilters(ev(), { anciennete: 30 }, NOW)).toBe(true);
    expect(matchesEventFilters(ev(), { anciennete: 60 }, NOW)).toBe(false);
    expect(matchesEventFilters(ev({ occurredOn: '2026-09-09' }), { anciennete: 30 }, NOW)).toBe(false);
  });
  it('accident de l’effectif (TF1/TG)', () => {
    expect(workforceAccident(ev())).toBe(true);
    expect(workforceAccident(ev({ victimKind: 'externe' }))).toBe(false);
    expect(workforceAccident(ev({ type: 'PA' }))).toBe(false);
  });
});
