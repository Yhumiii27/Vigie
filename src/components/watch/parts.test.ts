import { describe, expect, it } from 'vitest';
import { pickedFilesError } from './parts';

// Contrôle des fichiers choisis avant l'envoi (HAB-01) : mêmes limites que le serveur (10 fichiers, 10 Mo par fichier et par envoi).

const MB = 1024 * 1024;
const files = (n: number, size: number) => Array.from({ length: n }, (_, i) => ({ name: `attestation-${i + 1}.pdf`, size }));

describe('pickedFilesError', () => {
  it('fichier trop lourd : nommé dans le message', () => {
    expect(pickedFilesError([{ name: 'petit.pdf', size: 1000 }, { name: 'scan-complet.pdf', size: 11 * MB }])).toBe('« scan-complet.pdf » dépasse 10 Mo.');
  });

  it('plus de 10 fichiers', () => {
    expect(pickedFilesError(files(11, 1000))).toBe('10 fichiers au maximum par envoi.');
    expect(pickedFilesError(files(10, 1000))).toBeNull();
  });

  it('volume total au-delà de 10 Mo', () => {
    expect(pickedFilesError(files(2, 6 * MB))).toBe('Ces fichiers dépassent 10 Mo au total : envoyez-les en plusieurs fois.');
  });

  it('choix admis : rien, ou quelques petits fichiers', () => {
    expect(pickedFilesError([])).toBeNull();
    expect(pickedFilesError(files(2, 200 * 1024))).toBeNull();
  });
});
