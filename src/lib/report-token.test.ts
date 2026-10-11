import { describe, expect, it } from 'vitest';
import { looksLikeReportToken } from './auth/paths';
import { clientIp, sniffImage } from './report-guard';
import { readReportToken, reportTokenMatches, reportTokenPath, signReportToken } from './report-token';

// Jetons des QR codes de poste et protections du formulaire sans compte (EVT-07).

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
  it("adresse du client : dernière entrée de X-Forwarded-For (vue par le reverse proxy)", () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.7, 203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers({ 'x-real-ip': '192.0.2.1' }))).toBe('192.0.2.1');
    expect(clientIp(new Headers())).toBe('inconnue');
  });

  it('adresse du client normalisée : port, IPv4 encapsulée, préfixe IPv6 /64, valeur invalide', () => {
    const ip = (xff: string) => clientIp(new Headers({ 'x-forwarded-for': xff }));
    // Port ajouté par le proxy (IIS ARR « Include TCP port from client IP ») : une connexion ne donne pas un compteur neuf.
    expect(ip('203.0.113.9:51234')).toBe('203.0.113.9');
    expect(ip('198.51.100.7, 203.0.113.9:51235')).toBe('203.0.113.9');
    expect(ip('[2001:db8:1:2::1]:51234')).toBe('2001:db8:1:2::/64');
    expect(ip('[2001:db8:1:2::1]')).toBe('2001:db8:1:2::/64');
    // IPv4 encapsulée dans IPv6, en notation pointée ou hexadécimale.
    expect(ip('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(ip('::FFFF:203.0.113.9')).toBe('203.0.113.9');
    expect(ip('[::ffff:203.0.113.9]:443')).toBe('203.0.113.9');
    expect(ip('::ffff:cb00:7109')).toBe('203.0.113.9');
    // IPv6 : tout le /64 d'un abonné partage un compteur, quelle que soit la notation.
    const prefixes = new Set(Array.from({ length: 100 }, (_, i) => ip(`2001:db8:1:2::${i.toString(16)}`)));
    expect([...prefixes]).toEqual(['2001:db8:1:2::/64']);
    expect(ip('2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(ip('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
    expect(ip('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ip('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    // Tout ce qui n'est pas une adresse : un seul compteur partagé.
    for (const bad of ['unknown', 'abc', '203.0.113.9:', '203.0.113.256', '2001:db8::1::2', '[2001:db8::1', 'for=192.0.2.1', '01.2.3.4']) expect(ip(bad)).toBe('inconnue');
    expect(clientIp(new Headers({ 'x-real-ip': ' [2001:db8:1:2::1]:80 ' }))).toBe('2001:db8:1:2::/64');
  });

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
