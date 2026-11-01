import { describe, expect, it } from 'vitest';
import { nextSort } from './sort-order';

describe('nextSort (QUA-25)', () => {
  it('0 pour une liste vide, sinon le plus grand rang + 1 (trous et désordre tolérés)', () => {
    expect(nextSort([])).toBe(0);
    expect(nextSort([{ sort: 0 }])).toBe(1);
    expect(nextSort([{ sort: 4 }, { sort: 1 }, { sort: 2 }])).toBe(5);
  });
});
