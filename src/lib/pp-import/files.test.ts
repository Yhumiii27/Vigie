import { describe, expect, it } from 'vitest';
import { HEIC_MESSAGE, MAX_SCAN_PAGES, PAGES_ONLY_IMAGES, importFilesError, importName, isHeic, pageBudget } from './files';

const f = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('fichiers d’un import de plan de prévention (INT-14)', () => {
  it('un fichier : formats admis, vide ou trop lourd refusés', () => {
    expect(importFilesError([f('plan.pdf', 'application/pdf')])).toBeNull();
    expect(importFilesError([f('plan.docx', '')])).toBeNull();
    expect(importFilesError([])).toMatch(/Choisissez/);
    expect(importFilesError([f('plan.txt', 'text/plain')])).toMatch(/Format non accepté/);
    expect(importFilesError([f('plan.pdf', 'application/pdf', 0)])).toMatch(/vide/);
    expect(importFilesError([f('plan.pdf', 'application/pdf', 11 * 1024 * 1024)])).toMatch(/dépasse 10 Mo/);
  });

  it('plusieurs pages : photos seulement, nombre et volume bornés', () => {
    expect(importFilesError([f('p1.jpg', 'image/jpeg'), f('p2.png', 'image/png'), f('p3.webp', 'image/webp')])).toBeNull();
    expect(importFilesError([f('p1.jpg', 'image/jpeg'), f('plan.pdf', 'application/pdf')])).toBe(PAGES_ONLY_IMAGES);
    expect(importFilesError(Array.from({ length: MAX_SCAN_PAGES + 1 }, (_, i) => f(`p${i}.jpg`, 'image/jpeg')))).toMatch(/8 pages au plus/);
    expect(importFilesError([f('p1.jpg', 'image/jpeg', 6 * 1024 * 1024), f('p2.jpg', 'image/jpeg', 6 * 1024 * 1024)])).toMatch(/trop lourdes/);
    expect(pageBudget(4) * 4).toBeLessThanOrEqual(10 * 1024 * 1024);
  });

  it('HEIC (iPhone) : reconnu par type ou extension, refusé avec la marche à suivre', () => {
    expect(isHeic(f('IMG_0001.HEIC', ''))).toBe(true);
    expect(isHeic(f('photo', 'image/heif'))).toBe(true);
    expect(isHeic(f('photo.jpg', 'image/jpeg'))).toBe(false);
    expect(importFilesError([f('IMG_0001.heic', 'image/heic')])).toBe(HEIC_MESSAGE);
  });

  it('nom de l’import', () => {
    expect(importName(['plan.pdf'])).toBe('plan.pdf');
    expect(importName(['p1.jpg', 'p2.jpg'])).toBe('p1.jpg (+ 1 page)');
    expect(importName(['p1.jpg', 'p2.jpg', 'p3.jpg'])).toBe('p1.jpg (+ 2 pages)');
  });
});
