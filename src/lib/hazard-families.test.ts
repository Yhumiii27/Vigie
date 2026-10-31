import { describe, expect, it } from 'vitest';
import { HAZARD_FAMILIES, hazardSuggestions } from './hazard-families';

// DUE-18 : suggestions de familles de dangers (liste INRS de référence), jamais imposées.

describe('familles de dangers (DUE-18)', () => {
  it('liste de référence sans doublon, libellés courts (champ Danger : 120 caractères)', () => {
    expect(new Set(HAZARD_FAMILIES).size).toBe(HAZARD_FAMILIES.length);
    expect(HAZARD_FAMILIES.every((h) => h.length <= 120)).toBe(true);
    expect(HAZARD_FAMILIES).toContain('Chute de hauteur');
    expect(HAZARD_FAMILIES).toContain('Risques psychosociaux');
  });

  it('libellés déjà employés ajoutés après la référence, sans doublon (accents et casse ignorés)', () => {
    const s = hazardSuggestions(['chute de hauteur', 'Pyrotechnie', ' pyrotechnie ', 'Bruit', 'Atelier — projection', '']);
    expect(s.slice(0, HAZARD_FAMILIES.length)).toEqual([...HAZARD_FAMILIES]);
    expect(s.slice(HAZARD_FAMILIES.length)).toEqual(['Atelier — projection', 'Pyrotechnie']);
  });
});
