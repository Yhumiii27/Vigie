import { describe, expect, it } from 'vitest';
import { csvCell, csvResponse, fileSlug, toCsv } from './csv';

describe('CSV commun (IMP-04)', () => {
  it('cellules : nombres à virgule, guillemets, séparateur et sauts de ligne', () => {
    expect(csvCell(1.5)).toBe('1,5');
    expect(csvCell(12)).toBe('12');
    expect(csvCell(null)).toBe('');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell('ligne 1\nligne 2')).toBe('"ligne 1\nligne 2"');
  });
  it('injection de formules neutralisée', () => {
    for (const v of ['=HYPERLINK("http://x")', '+33 6', '@SUM(A1)', '-2+3', '\tcache', '  =1+1']) expect(csvCell(v).replace(/^"/, '')).toMatch(/^'/);
    expect(csvCell('- puce')).toBe('- puce');
    expect(csvCell('a=b')).toBe('a=b');
  });
  it('document : BOM, « ; », CRLF', () => {
    expect(toCsv([['Unité', 'G'], ['Atelier', 3]])).toBe('﻿Unité;G\r\nAtelier;3\r\n');
  });
  it('noms de fichiers et réponse HTTP', async () => {
    expect(fileSlug('Ville A — Atelier', 'x')).toBe('ville-a-atelier');
    expect(fileSlug('v3.2 Été', 'duerp', { dots: true })).toBe('v3.2-ete');
    expect(fileSlug('!!!', 'tous-sites')).toBe('tous-sites');
    const res = csvResponse('x', 'registre-déchets.csv');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="registre-d_chets.csv"; filename*=UTF-8''registre-d%C3%A9chets.csv`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('x');
  });
});
