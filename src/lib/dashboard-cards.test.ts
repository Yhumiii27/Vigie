import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_LAYOUT, CARD_IDS, DASHBOARD_CARDS, MAX_CARDS, cardAllowed, canEditRoleLayout, effectiveLayout, isDashboardRole, layoutSummary, parseLayout,
  periodMonths, periodRange,
} from './dashboard-cards';

// TDB-19 : tableaux de bord configurables — catalogue fermé, lecture d'une disposition, périodes.

describe('rôles', () => {
  it('animateur QHSE et direction seulement ; disposition par défaut d’un rôle tenue par l’animateur QHSE', () => {
    expect(isDashboardRole('Animateur QHSE')).toBe(true);
    expect(isDashboardRole('Direction')).toBe(true);
    expect(isDashboardRole('Chef de service')).toBe(false);
    expect(canEditRoleLayout('Direction')).toBe(false);
    expect(canEditRoleLayout('Animateur QHSE')).toBe(true);
  });
});

describe('disposition', () => {
  it('cartes du catalogue, sans doublon, options admises (sinon par défaut), au plus 16', () => {
    expect(parseLayout([{ id: 'tf1', period: 'trimestre', scope: 'perimetre' }, { id: 'carte_sites', period: 'mois', scope: 'site' }, { id: 'controles', period: 'annee' }]))
      .toEqual({ cards: [{ id: 'tf1', period: 'trimestre', scope: 'perimetre' }, { id: 'carte_sites', period: null, scope: null }, { id: 'controles', period: null, scope: 'site' }], error: null });
    expect(parseLayout([{ id: 'tf1', period: 'decennie', scope: 'monde' }]).cards).toEqual([{ id: 'tf1', period: 'annee', scope: 'site' }]);
    expect(parseLayout([{ id: 'inconnue' }]).error).toMatch(/catalogue/);
    expect(parseLayout([{ id: 'tf1' }, { id: 'tf1' }]).error).toMatch(/double/);
    expect(parseLayout('x').error).not.toBeNull();
    expect(parseLayout(Array.from({ length: MAX_CARDS + 1 }, () => ({ id: 'tf1' }))).error).toMatch(/16/);
    expect(parseLayout(CARD_IDS.map((id) => ({ id }))).error).toBeNull();
  });
  it('personne, sinon rôle, sinon Vigie ; cartes non permises retirées', () => {
    const viewer = { health: true, dgi: false };
    expect(effectiveLayout(null, null, viewer)).toEqual({ cards: [...BUILT_IN_LAYOUT], origin: 'vigie' });
    expect(effectiveLayout(null, [{ id: 'veille' }], viewer)).toEqual({ cards: [{ id: 'veille', period: null, scope: 'site' }], origin: 'role' });
    expect(effectiveLayout([{ id: 'dgi_ouverts' }, { id: 'tf1' }], [{ id: 'veille' }], viewer)).toEqual({ cards: [{ id: 'tf1', period: 'annee', scope: 'site' }], origin: 'personne' });
    expect(effectiveLayout([], [{ id: 'veille' }], viewer).cards).toEqual([]);
    expect(cardAllowed('dgi_ouverts', { health: false, dgi: true })).toBe(true);
    // Aucune carte ne révèle de donnée de santé (agrégats seulement).
    expect(CARD_IDS.filter((id) => DASHBOARD_CARDS[id].health)).toEqual([]);
  });
  it('libellé au journal', () => {
    expect(layoutSummary([{ id: 'tf1', period: 'trimestre', scope: 'perimetre' }, { id: 'carte_sites', period: null, scope: null }]))
      .toBe('TF1 et TG (3 derniers mois complets, tous les sites de mon périmètre) · Carte des sites');
    expect(layoutSummary([])).toBe('aucune carte');
  });
});

describe('périodes', () => {
  it('derniers mois complets', () => {
    expect(periodMonths('2026-10-09', 'mois')).toEqual(['2026-09']);
    expect(periodMonths('2026-01-15', 'trimestre')).toEqual(['2025-10', '2025-11', '2025-12']);
    expect(periodMonths('2026-10-09', 'annee')).toHaveLength(12);
    expect(periodRange('2026-10-09', 'trimestre')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(periodRange('2026-03-02', 'mois')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});
