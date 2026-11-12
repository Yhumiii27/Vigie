import { describe, expect, it } from 'vitest';
import {
  assessmentStatus, clauseError, closeAssessmentError, compareClauses, fmtDelta, frozenAssessmentError, lineError, mainClause, previousAssessment,
  rateDelta, rateTone, synthesize,
} from './self-assessment';

// AUD-40 : grille d'auto-évaluation par référentiel — règles pures (synthèse calculée, jamais stockée).

describe('numéros d’articles', () => {
  it('format, article principal, ordre naturel', () => {
    expect(clauseError('6.1.2')).toBeNull();
    expect(clauseError('10')).toBeNull();
    expect(clauseError('6.a')).not.toBeNull();
    expect(clauseError('')).not.toBeNull();
    expect(mainClause('6.1.2')).toBe('6');
    expect(['10.2', '4.10', '4.9', '4', '6.1.2', '6.1'].sort(compareClauses)).toEqual(['4', '4.9', '4.10', '6.1', '6.1.2', '10.2']);
  });
});

describe('évaluation d’une exigence', () => {
  it('justification exigée pour « non applicable » et « non conforme »', () => {
    expect(lineError('non_applicable', ' ')).toMatch(/non-applicabilité/);
    expect(lineError('non_conforme', '')).toMatch(/non-conformité/);
    expect(lineError('non_conforme', 'Écart constaté')).toBeNull();
    expect(lineError('partiel', '')).toBeNull();
    expect(lineError(null, '')).toBeNull();
  });
  it('campagne figée une fois clôturée ou annulée ; clôture après évaluation de toutes les exigences', () => {
    expect(frozenAssessmentError({ status: 'brouillon', cancelledAt: null })).toBeNull();
    expect(frozenAssessmentError({ status: 'cloturee', cancelledAt: null })).toMatch(/figée/);
    expect(frozenAssessmentError({ status: 'brouillon', cancelledAt: new Date() })).toMatch(/annulée/);
    expect(assessmentStatus({ status: 'brouillon', cancelledAt: new Date() })).toBe('annulee');
    expect(closeAssessmentError([{ level: 'conforme' }, { level: null }, { level: null }])).toBe('2 exigences encore à évaluer avant la clôture.');
    expect(closeAssessmentError([{ level: 'conforme' }])).toBeNull();
    expect(closeAssessmentError([])).not.toBeNull();
  });
});

describe('synthèse', () => {
  const lines = [
    { clause: '4', heading: 'Contexte', level: 'conforme' },
    { clause: '4.1', heading: 'Enjeux', level: 'partiel' },
    { clause: '6', heading: 'Planification', level: 'non_conforme' },
    { clause: '6.1.2', heading: 'Dangers', level: 'non_applicable' },
    { clause: '6.2', heading: 'Objectifs', level: null },
    { clause: '10', heading: 'Amélioration', level: 'conforme' },
  ];
  it('taux par article principal (conforme 1, partiel ½, non conforme 0 ; N/A et non évaluées hors taux) et global', () => {
    const s = synthesize(lines);
    expect(s.clauses.map((c) => [c.clause, c.heading, c.rate])).toEqual([['4', 'Contexte', 75], ['6', 'Planification', 0], ['10', 'Amélioration', 100]]);
    expect(s.clauses[1].counts).toMatchObject({ non_conforme: 1, non_applicable: 1, pending: 1 });
    expect(s.overall.rate).toBe(63); // (1 + 0,5 + 0 + 1) / 4
    expect(synthesize([{ clause: '5', heading: 'Leadership', level: 'non_applicable' }]).overall.rate).toBeNull();
  });
  it('écart avec la campagne précédente et tons', () => {
    expect(rateDelta(72, 60)).toBe(12);
    expect(rateDelta(72, null)).toBeNull();
    expect(fmtDelta(12)).toBe('+12 pts');
    expect(fmtDelta(-1)).toBe('−1 pt');
    expect(fmtDelta(0)).toBe('=');
    expect(fmtDelta(null)).toBe('—');
    expect([rateTone(85), rateTone(60), rateTone(20), rateTone(null)]).toEqual(['ok', 'warn', 'danger', 'neutral']);
  });
});

describe('campagne précédente', () => {
  const at = (d: string) => new Date(`${d}T10:00:00Z`);
  const row = (id: string, o: Partial<{ standard: string; siteId: string | null; assessedOn: string; status: string; cancelledAt: Date | null }> = {}) => ({
    id, standard: 'iso45001', siteId: 'site_a', assessedOn: '2026-01-10', status: 'cloturee', cancelledAt: null, createdAt: at(o.assessedOn ?? '2026-01-10'), ...o,
  });
  it('même référentiel et même site, clôturée, antérieure ; la plus récente', () => {
    const all = [
      row('AE-1', { assessedOn: '2025-06-01' }), row('AE-2', { assessedOn: '2026-01-10' }), row('AE-3', { assessedOn: '2026-02-01', status: 'brouillon' }),
      row('AE-4', { assessedOn: '2025-12-01', siteId: 'site_b' }), row('AE-5', { assessedOn: '2025-12-15', standard: 'iso9001' }),
      row('AE-6', { assessedOn: '2025-12-20', cancelledAt: new Date() }), row('AE-7', { assessedOn: '2026-03-01' }),
    ];
    expect(previousAssessment(all, all[6])?.id).toBe('AE-2');
    expect(previousAssessment(all, all[1])?.id).toBe('AE-1');
    expect(previousAssessment(all, all[0])).toBeNull();
    expect(previousAssessment(all, all[3])).toBeNull();
  });
});
