import { describe, expect, it } from 'vitest';
import { MAX_BATCH_BYTES } from './attachments';
import { isCameraPhoto, photosToShrink } from './photo-shrink';

// UX-05 : allègement des photos d'une pièce jointe — l'original est envoyé tel quel tant que l'envoi respecte les limites.

const MB = 1024 * 1024;
const f = (name: string, type: string, mb: number) => ({ name, type, size: Math.round(mb * MB) });

describe('photosToShrink', () => {
  it('envoi dans les limites : aucun original remplacé', () => {
    expect(photosToShrink([f('a.jpg', 'image/jpeg', 4), f('b.jpg', 'image/jpeg', 4)])).toEqual([]);
  });

  it('envoi trop lourd : photos d’appareil de plus de 512 Ko, les plus lourdes d’abord ; PDF, PNG et petites photos gardés', () => {
    const files = [f('pv.pdf', 'application/pdf', 1), f('a.jpg', 'image/jpeg', 3), f('plan.png', 'image/png', 3), f('b.heic', 'image/heic', 5), f('c.jpg', 'image/jpeg', 0.2)];
    expect(files.reduce((n, x) => n + x.size, 0)).toBeGreaterThan(MAX_BATCH_BYTES);
    expect(photosToShrink(files)).toEqual([3, 1]);
  });

  it('photo seule au-delà de la taille par fichier : réduite', () => {
    expect(photosToShrink([f('grosse.jpg', 'image/jpeg', 12)])).toEqual([0]);
  });

  it('type absent : reconnu par l’extension', () => {
    expect(isCameraPhoto({ name: 'IMG_1.HEIC', type: '' })).toBe(true);
    expect(isCameraPhoto({ name: 'schema.png', type: 'image/png' })).toBe(false);
  });
});
