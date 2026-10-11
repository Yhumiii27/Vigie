import { describe, expect, it } from 'vitest';
import { looksLikeReportToken, safeReturnPath } from './paths';

describe('chemin de retour après connexion', () => {
  it('chemins locaux conservés, le reste ramené à « / »', () => {
    expect(safeReturnPath('/evenements?onglet=1')).toBe('/evenements?onglet=1');
    expect(safeReturnPath('/risques/export?portee=tout')).toBe('/risques/export?portee=tout');
    for (const bad of [null, '', 'evenements', 'https://attaquant.example/', '//attaquant.example', '/\\attaquant.example',
      '/auth/connexion', '/auth/retour?code=x', `/x${String.fromCharCode(10)}y`, `/${'a'.repeat(2001)}`,
      // Segments « . » / « .. » résolus après le contrôle : « //hote » une fois normalisé.
      '/.//attaquant.example/phish', '/a/..//attaquant.example', '/%2e//attaquant.example', '/%2E%2E//attaquant.example']) {
      expect(safeReturnPath(bad)).toBe('/');
    }
  });

  it('jeton de poste : contrôle de forme seulement', () => {
    expect(looksLikeReportToken('v1.ville-a.12.1.Zx9_-abcdefghijklmnop')).toBe(true);
    expect(looksLikeReportToken('court')).toBe(false);
    expect(looksLikeReportToken('<script>alert(1)</script>xxxxxxxx')).toBe(false);
    expect(looksLikeReportToken(null)).toBe(false);
  });
});
