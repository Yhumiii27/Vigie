import { describe, expect, it } from 'vitest';
import { looksLikeReportToken } from './auth/paths';
import { sniffImage } from './report-guard';
import { readReportToken, reportPostStatus, reportTokenMatches, reportTokenPath, signReportToken } from './report-token';

// Jetons des QR codes de poste et protections du formulaire sans compte (EVT-07) ; adresse du client et photos
// anonymes : src/lib/report-guard.test.ts.

const SECRET = 'secret-des-qr-codes-de-test-0123456789';
const ref = { siteId: 'ville-a', zoneId: 12, version: 1 };

describe('jeton de poste', () => {
  it('signé, lisible, accepté par le contrôle de forme du proxy', () => {
    const token = signReportToken(SECRET, ref);
    expect(token).toMatch(/^12\.1\.[A-Za-z0-9_-]{22}$/);
    expect(readReportToken(token)).toEqual({ zoneId: 12, version: 1 });
    expect(reportTokenMatches(SECRET, token, ref)).toBe(true);
    expect(looksLikeReportToken(token)).toBe(true);
    expect(reportTokenPath(token)).toBe(`/signaler?jeton=${token}`);
  });

  it('refusé pour un autre secret, site, poste ou version', () => {
    const token = signReportToken(SECRET, ref);
    expect(reportTokenMatches('autre-secret-des-qr-codes-0123456789', token, ref)).toBe(false);
    expect(reportTokenMatches(SECRET, token, { ...ref, siteId: 'ville-b' })).toBe(false);
    expect(reportTokenMatches(SECRET, token, { ...ref, zoneId: 13 })).toBe(false);
    expect(reportTokenMatches(SECRET, token, { ...ref, version: 2 })).toBe(false);
    // Signature recopiée sur un autre poste ou une autre version.
    const sig = token.split('.')[2];
    expect(reportTokenMatches(SECRET, `13.1.${sig}`, { ...ref, zoneId: 13 })).toBe(false);
    expect(reportTokenMatches(SECRET, `12.2.${sig}`, { ...ref, version: 2 })).toBe(false);
    // Signature altérée d'un caractère.
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    expect(reportTokenMatches(SECRET, `${token.slice(0, -1)}${last}`, ref)).toBe(false);
  });

  it('jetons mal formés', () => {
    for (const bad of ['', '12.1', '12.1.court', '0.1.AAAAAAAAAAAAAAAAAAAAAA', '12.0.AAAAAAAAAAAAAAAAAAAAAA', 'x.1.AAAAAAAAAAAAAAAAAAAAAA', '12.1.AAAAAAAAAAAAAAAAAAAAA=']) {
      expect(readReportToken(bad)).toBeNull();
    }
    expect(readReportToken(null)).toBeNull();
  });
});

describe('formulaire sans compte', () => {
  it("photos : type d'après le contenu", () => {
    const bytes = (...b: (number | string)[]) => new Uint8Array(b.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe('image/jpeg');
    expect(sniffImage(bytes(0x89, 'PNG\r\n', 0x1a, '\n', 0, 0))).toBe('image/png');
    expect(sniffImage(bytes('GIF89a', 1, 0))).toBe('image/gif');
    expect(sniffImage(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(bytes(0, 0, 0, 0x18, 'ftypheic', 0, 0, 0, 0))).toBe('image/heic');
    expect(sniffImage(bytes('<html><script>'))).toBeNull();
    expect(sniffImage(bytes('%PDF-1.7'))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe('état du QR code d’un poste (EVT-19)', () => {
  const zone = { qrVersion: 2, archived: false, siteArchived: false };
  const valid = { version: 2, signatureValid: true };
  it('valide, remplacé, zone archivée, inconnu', () => {
    expect(reportPostStatus(zone, valid)).toBe('ok');
    expect(reportPostStatus(zone, { ...valid, version: 1 })).toBe('revoked');
    expect(reportPostStatus({ ...zone, archived: true }, valid)).toBe('archived');
    // Étiquette déjà remplacée avant l'archivage : « remplacée », pas « archivée ».
    expect(reportPostStatus({ ...zone, archived: true }, { ...valid, version: 1 })).toBe('revoked');
    expect(reportPostStatus(null, valid)).toBe('invalid');
    expect(reportPostStatus({ ...zone, siteArchived: true }, valid)).toBe('invalid');
  });
  it('signature fausse : rien n’est révélé de la zone (archivée ou non)', () => {
    expect(reportPostStatus({ ...zone, archived: true }, { ...valid, signatureValid: false })).toBe('invalid');
    expect(reportPostStatus(zone, { version: 1, signatureValid: false })).toBe('invalid');
  });
});
