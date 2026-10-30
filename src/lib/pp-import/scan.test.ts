import { describe, expect, it } from 'vitest';
import { scanPrompt } from './scan';

describe('consigne de lecture d’un scan (INT-14)', () => {
  it('une image ou un PDF : consigne inchangée ; plusieurs pages : ordre des images rappelé', () => {
    expect(scanPrompt([])).toMatch(/^Relève tous les éléments/);
    expect(scanPrompt([], 1)).toBe(scanPrompt([]));
    const three = scanPrompt([], 3);
    expect(three).toMatch(/^Ce formulaire est fourni en 3 images : les pages 1 à 3/);
    expect(three).toContain('Relève tous les éléments');
  });
});
