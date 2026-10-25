import { describe, expect, it } from 'vitest';
import { ARCHIVED_SITE_SUFFIX, LEFT_SUFFIX, offeredOr, withCurrent, type Option } from './form-options';

describe('withCurrent : valeur enregistrée absente des listes de choix', () => {
  const options: Option[] = [['a', 'A'], ['b', 'B']];
  it('ajoute la valeur absente (libellé fourni, sinon la valeur)', () => {
    expect(withCurrent(options, 'c', `C${LEFT_SUFFIX}`)).toEqual([...options, ['c', "C — sorti de l'effectif"]]);
    expect(withCurrent(options, 'd', undefined)).toEqual([...options, ['d', 'd']]);
    expect(withCurrent(options, 'x', `X${ARCHIVED_SITE_SUFFIX}`).at(-1)).toEqual(['x', 'X (archivé)']);
  });
  it('liste inchangée si la valeur y figure ou est vide', () => {
    expect(withCurrent(options, 'a', 'autre')).toBe(options);
    expect(withCurrent(options, null, 'x')).toBe(options);
    expect(withCurrent(options, '', 'x')).toBe(options);
  });
});

describe('offeredOr : valeur par défaut d’un nouveau choix (DUE-15)', () => {
  const options: Option[] = [['a', 'A'], ['b', 'B']];
  it('valeur encore proposée gardée, sinon la valeur de repli', () => {
    expect(offeredOr(options, 'b', 'a')).toBe('b');
    expect(offeredOr(options, 'sorti', 'a')).toBe('a');
    expect(offeredOr(options, null, 'a')).toBe('a');
    expect(offeredOr(options, undefined, null)).toBeNull();
  });
});
