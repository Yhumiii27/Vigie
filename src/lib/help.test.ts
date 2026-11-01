import { describe, expect, it } from 'vitest';
import { GLOSSARY, SCREEN_HELP, helpScreenOf } from './help';
import { NAV } from './domain';

// UX-16 : aide en ligne — contenu statique par écran et glossaire.

describe('aide en ligne (UX-16)', () => {
  it('chaque écran de la navigation a son aide', () => {
    for (const key of NAV.flatMap((s) => s.items)) {
      expect(SCREEN_HELP[key]?.intro, key).toBeTruthy();
      expect(SCREEN_HELP[key]!.tips.length, key).toBeGreaterThan(0);
    }
  });

  it('glossaire : TF1 et TG définis, termes uniques', () => {
    const terms = GLOSSARY.map((g) => g.term);
    expect(new Set(terms).size).toBe(terms.length);
    expect(GLOSSARY.find((g) => g.term === 'TF1')?.definition).toMatch(/1 000 000/);
    expect(GLOSSARY.find((g) => g.term === 'TG')?.definition).toMatch(/1 000/);
  });

  it('écran d’une page : chemin le plus long, sous-pages comprises', () => {
    expect(helpScreenOf('/')).toBe('dashboard');
    expect(helpScreenOf('/evenements')).toBe('events');
    expect(helpScreenOf('/prevention/carte')).toBe('prevention');
    expect(helpScreenOf('/audits/contributions')).toBe('contributions');
    expect(helpScreenOf('/revue-de-direction')).toBe('audits');
    expect(helpScreenOf('/veille/')).toBe('watch');
    expect(helpScreenOf('/inconnu')).toBeNull();
  });
});
