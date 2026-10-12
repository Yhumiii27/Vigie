import { describe, expect, it } from 'vitest';
import { anonymousPhoto, clientIpFrom } from './report-guard';

// Protections du formulaire sans compte (EVT-07, réserves EVT-07 / SEC-09 du lot 1) : adresse du client derrière
// VIGIE_TRUSTED_PROXIES reverse proxys, photos d'un signalement anonyme sans leur nom d'origine.

const xff = (value: string, proxies = 1) => clientIpFrom(new Headers({ 'x-forwarded-for': value }), proxies);

describe('adresse du client', () => {
  it('un proxy de confiance (défaut) : dernière entrée de X-Forwarded-For ; sinon X-Real-IP', () => {
    expect(xff('198.51.100.7, 203.0.113.9')).toBe('203.0.113.9');
    expect(xff('203.0.113.9')).toBe('203.0.113.9');
    expect(clientIpFrom(new Headers({ 'x-real-ip': '192.0.2.1' }), 1)).toBe('192.0.2.1');
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': ' , ', 'x-real-ip': '192.0.2.1' }), 1)).toBe('192.0.2.1');
    expect(clientIpFrom(new Headers(), 1)).toBe('inconnue');
  });

  it('N proxys de confiance : N-ième entrée en partant de la fin, la plus à gauche s’il y en a moins', () => {
    const chain = '192.0.2.1, 198.51.100.7, 203.0.113.9';
    expect(xff(chain, 1)).toBe('203.0.113.9');
    expect(xff(chain, 2)).toBe('198.51.100.7');
    expect(xff(chain, 3)).toBe('192.0.2.1');
    expect(xff(chain, 5)).toBe('192.0.2.1');
    // Entrée ajoutée par le client devant la chaîne : ignorée tant qu'elle est au-delà des N proxys.
    expect(xff('6.6.6.6, 198.51.100.7, 203.0.113.9', 2)).toBe('198.51.100.7');
  });

  it('adresse normalisée : port, IPv4 encapsulée, préfixe IPv6 /64, valeur invalide', () => {
    const ip = (value: string) => xff(value);
    // Port ajouté par le proxy (IIS ARR « Include TCP port from client IP ») : une connexion ne donne pas un compteur neuf.
    expect(ip('203.0.113.9:51234')).toBe('203.0.113.9');
    expect(ip('198.51.100.7, 203.0.113.9:51235')).toBe('203.0.113.9');
    expect(xff('198.51.100.7:4431, 203.0.113.9:51235', 2)).toBe('198.51.100.7');
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
    expect(clientIpFrom(new Headers({ 'x-real-ip': ' [2001:db8:1:2::1]:80 ' }), 1)).toBe('2001:db8:1:2::/64');
  });
});

describe('photo d’un signalement anonyme', () => {
  it('nom d’origine retiré, type et contenu conservés', async () => {
    const original = new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], 'IMG_2026-10-12_Dupont-Jean.jpeg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 });
    const photo = anonymousPhoto(original, 0);
    expect(photo.name).toBe('photo-1.jpg');
    expect(photo.type).toBe('image/jpeg');
    expect(photo.lastModified).not.toBe(original.lastModified);
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(new Uint8Array(await original.arrayBuffer()));
    expect(anonymousPhoto(new File(['x'], 'scan.HEIC', { type: 'image/heic' }), 2).name).toBe('photo-3.heic');
    expect(anonymousPhoto(new File(['x'], 'a', { type: 'application/octet-stream' }), 0).name).toBe('photo-1.bin');
  });
});
