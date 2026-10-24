import { describe, expect, it } from 'vitest';
import { FILE_CSP, attachmentHeaders } from './file-serving';

describe('service des pièces jointes (SEC-08)', () => {
  const row = (mimeType: string, extra: Partial<{ fileName: string; health: boolean }> = {}) => ({ mimeType, fileName: 'pièce.bin', health: false, ...extra });
  it('images et PDF affichés, le reste téléchargé', () => {
    expect(attachmentHeaders(row('image/png'), 3)['Content-Disposition']).toMatch(/^inline;/);
    expect(attachmentHeaders(row('application/pdf'), 3)['Content-Disposition']).toMatch(/^inline;/);
    expect(attachmentHeaders(row('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 3)['Content-Disposition']).toMatch(/^attachment;/);
    expect(attachmentHeaders(row('text/plain'), 3)['Content-Disposition']).toMatch(/^attachment;/);
  });
  it('texte jamais interprété ; type inconnu servi en octets', () => {
    expect(attachmentHeaders(row('text/plain'), 3)['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(attachmentHeaders(row('text/html'), 3)['Content-Type']).toBe('application/octet-stream');
    expect(attachmentHeaders(row('image/svg+xml'), 3)['Content-Type']).toBe('application/octet-stream');
  });
  it('nosniff, bac à sable sans script (sauf PDF), cache de la pièce médicale, nom nettoyé', () => {
    const h = attachmentHeaders(row('image/jpeg', { fileName: '../photo "1".jpg', health: true }), 3);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Content-Security-Policy']).toBe(FILE_CSP);
    expect(h['Cache-Control']).toBe('private, no-store');
    expect(h['Content-Disposition']).toBe(`inline; filename="photo 1.jpg"; filename*=UTF-8''photo%201.jpg`);
    expect(attachmentHeaders(row('application/pdf'), 3)['Content-Security-Policy']).toBeUndefined();
    expect(attachmentHeaders(row('image/png'), 3)['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });
});
