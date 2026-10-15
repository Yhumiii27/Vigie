import { describe, expect, it } from 'vitest';
import { formReader, nextRef } from './forms';

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

describe('nextRef', () => {
  it('référence suivante, préfixe et remplissage', () => {
    expect(nextRef(['A-214', 'A-9', 'B-500'], 'A-')).toBe('A-215');
    expect(nextRef([], 'PP-2026-', 3)).toBe('PP-2026-001');
    expect(nextRef(['PP-2026-015', 'PP-2025-041'], 'PP-2026-', 3)).toBe('PP-2026-016');
  });
});
