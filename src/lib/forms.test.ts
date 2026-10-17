import { describe, expect, it } from 'vitest';
import { fmtDecimal, formReader, maxRefNumber, nextRef } from './forms';

// Lecture et validation des formulaires des server actions (QUA-03).

const fd = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => (Array.isArray(v) ? v : [v]).forEach((x) => f.append(k, x)));
  return f;
};

describe('formReader', () => {
  it('texte : nettoyé, obligatoire, longueur maximale', () => {
    const f = formReader(fd({ a: '  x  ', b: ' ', c: 'abcdef' }));
    expect(f.str('a', { required: true })).toBe('x');
    expect(f.str('b', { required: true })).toBe('');
    expect(f.str('c', { max: 3 })).toBe('abcdef');
    expect(f.opt('b')).toBeNull();
    expect(f.ok).toBe(false);
    expect(f.state()).toEqual({ error: 'Certains champs sont à corriger.', fieldErrors: { b: 'Champ obligatoire.', c: '3 caractères au maximum.' } });
  });
  it('nombres : virgule décimale, espaces de milliers, bornes', () => {
    const f = formReader(fd({ n: '12', d: '1,5', e: 'x', big: '1 200,5', low: '-1' }));
    expect(f.int('n', { min: 0, max: 10 })).toBe(12);
    expect(f.int('d')).toBeNull();
    expect(f.num('big')).toBe(1200.5);
    expect(f.num('e')).toBeNull();
    expect(f.num('low', { min: 0 })).toBe(-1);
    expect(f.int('absent', { required: true })).toBeNull();
    expect(f.fieldErrors).toEqual({ n: 'Maximum 10.', d: 'Nombre entier attendu.', e: 'Nombre attendu.', low: 'Minimum 0.', absent: 'Champ obligatoire.' });
  });
  it('dates, booléens, listes et choix', () => {
    const f = formReader(fd({ d: '2026-10-09', bad: '09/10/2026', on: 'on', no: 'off', many: [' a ', '', 'b'], c: 'x' }));
    expect(f.date('d')).toBe('2026-10-09');
    expect(f.date('bad')).toBeNull();
    expect(f.date('vide', { required: true })).toBeNull();
    expect([f.bool('on'), f.bool('no'), f.bool('absent')]).toEqual([true, false, false]);
    expect(f.list('many')).toEqual(['a', 'b']);
    expect(f.oneOf('c', ['x', 'y'] as const)).toBe('x');
    expect(f.oneOf('d', ['x', 'y'] as const)).toBeNull();
    expect(f.fieldErrors).toEqual({ bad: 'Date invalide.', vide: 'Date obligatoire.', d: 'Valeur non autorisée.' });
  });
  it('motif obligatoire (annulation, archivage, classement sans suite) borné à 1000 caractères', () => {
    expect(formReader(fd({ reason: ' Erreur de saisie ' })).reason()).toBe('Erreur de saisie');
    const empty = formReader(fd({ reason: '   ' }));
    empty.reason();
    expect(empty.fieldErrors).toEqual({ reason: 'Motif obligatoire.' });
    const long = formReader(fd({ reason: 'x'.repeat(1001) }));
    long.reason();
    expect(long.fieldErrors).toEqual({ reason: '1000 caractères au maximum.' });
  });
  it('fichiers : les champs vides sont ignorés', () => {
    const f = new FormData();
    f.append('files', new File([], 'vide.pdf'));
    f.append('files', new File(['x'], 'plein.pdf', { type: 'application/pdf' }));
    expect(formReader(f).files('files').map((x) => x.name)).toEqual(['plein.pdf']);
  });
});

describe('formReader.decimal (heures et coûts, ACT-26)', () => {
  it('virgule ou point, espaces de milliers, champ vide', () => {
    const f = formReader(fd({ a: '12,5', b: '1 234,56', c: '7', d: ' ', e: '0.25', f: '1\u00a0000', g: '1\u202f000,1', h: ',5' }));
    expect(f.decimal('a')).toBe(12.5);
    expect(f.decimal('b')).toBe(1234.56);
    expect(f.decimal('c')).toBe(7);
    expect(f.decimal('d')).toBeNull();
    expect(f.decimal('e')).toBe(0.25);
    expect(f.decimal('f')).toBe(1000);
    expect(f.decimal('g')).toBe(1000.1);
    expect(f.decimal('h')).toBe(0.5);
    expect(f.ok).toBe(true);
  });
  it('obligatoire, plus de 2 décimales refusé, texte refusé', () => {
    const f = formReader(fd({ a: '', b: '1,234', c: 'abc', d: '1,2,3', e: '12.' }));
    expect(f.decimal('a', { required: true })).toBeNull();
    expect(f.decimal('b')).toBeNull();
    expect(f.decimal('c')).toBeNull();
    expect(f.decimal('d')).toBeNull();
    expect(f.decimal('e')).toBe(12);
    expect(f.fieldErrors).toEqual({ a: 'Champ obligatoire.', b: '2 décimales au maximum.', c: 'Nombre attendu.', d: 'Nombre attendu.' });
  });
  it('échelle choisie', () => {
    const f = formReader(fd({ a: '1,23', b: '1,2', c: '1,5' }));
    expect(f.decimal('a', { scale: 1 })).toBeNull();
    expect(f.decimal('b', { scale: 1 })).toBe(1.2);
    expect(f.decimal('c', { scale: 0 })).toBeNull();
    expect(f.fieldErrors).toEqual({ a: '1 décimale au maximum.', c: 'Nombre entier attendu.' });
  });
  it('bornes min et max incluses', () => {
    const f = formReader(fd({ h: '99 999,99', h2: '100 000', c: '9 999 999 999,99', c2: '10 000 000 000', n: '-0,01', z: '0' }));
    expect(f.decimal('h', { min: 0, max: 99_999.99 })).toBe(99_999.99);
    expect(f.decimal('h2', { min: 0, max: 99_999.99 })).toBe(100_000);
    expect(f.decimal('c', { min: 0, max: 9_999_999_999.99 })).toBe(9_999_999_999.99);
    expect(f.decimal('c2', { min: 0, max: 9_999_999_999.99 })).toBe(10_000_000_000);
    expect(f.decimal('n', { min: 0 })).toBe(-0.01);
    expect(f.decimal('z', { min: 0 })).toBe(0);
    expect(f.fieldErrors).toEqual({ h2: 'Maximum 99\u00a0999,99.', c2: 'Maximum 9\u00a0999\u00a0999\u00a0999,99.', n: 'Minimum 0.' });
  });
  it('fmtDecimal : milliers séparés par une espace insécable, virgule décimale', () => {
    expect(fmtDecimal(9_999_999_999.99)).toBe('9\u00a0999\u00a0999\u00a0999,99');
    expect(fmtDecimal(999)).toBe('999');
    expect(fmtDecimal(1000.5)).toBe('1\u00a0000,5');
    expect(fmtDecimal(-1234)).toBe('-1\u00a0234');
  });
});

describe('nextRef', () => {
  it('référence suivante, préfixe et remplissage', () => {
    expect(nextRef(['A-214', 'A-9', 'B-500'], 'A-')).toBe('A-215');
    expect(nextRef([], 'PP-2026-', 3)).toBe('PP-2026-001');
    expect(nextRef(['PP-2026-015', 'PP-2025-041'], 'PP-2026-', 3)).toBe('PP-2026-016');
  });
});

describe('maxRefNumber (PRD-08)', () => {
  it('plus grand numéro du préfixe ; suite non numérique ou trop longue ignorée', () => {
    expect(maxRefNumber(['EE-001', 'EE-007', 'EE-01x', 'PP-2026-099'], 'EE-')).toBe(7);
    expect(maxRefNumber([], 'EE-')).toBe(0);
    expect(maxRefNumber(['cert-3', 'cert-12', 'cert-'], 'cert-')).toBe(12);
    expect(maxRefNumber(['EV-2026-12345678901'], 'EV-2026-')).toBe(0);
  });
});
