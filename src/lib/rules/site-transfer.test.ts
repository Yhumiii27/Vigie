import { describe, expect, it } from 'vitest';
import { emptyOpenCounts, openItemsSummary, openTotal, transferTargetError } from './site-transfer';

describe('transfert des éléments ouverts d’un site archivé (TDB-08)', () => {
  it('résume les éléments ouverts', () => {
    const c = { ...emptyOpenCounts(), events: 3, actions: 1 };
    expect(openTotal(c)).toBe(4);
    expect(openItemsSummary(c)).toBe('3 événements non clôturés, 1 action QSE ouverte');
    expect(openItemsSummary(emptyOpenCounts())).toBe('');
  });
  it('site de destination actif et différent', () => {
    expect(transferTargetError('site_a', 'site_a', ['site_a', 'site_b'])).toMatch(/autre site/);
    expect(transferTargetError('site_a', 'site_c', ['site_a', 'site_b'])).toMatch(/archivé ou inconnu/);
    expect(transferTargetError('site_a', 'site_b', ['site_a', 'site_b'])).toBeNull();
  });
});
