import { describe, expect, it } from 'vitest';
import { isLoopbackHost } from './env';
import { contentSecurityPolicy, isAllowedHost, originHost, requestHosts } from './security';

describe('hôtes admis (SEC-04)', () => {
  it('liste exacte (port compris), localhost seulement si permis', () => {
    const allowed = ['vigie.exemple.fr', 'vigie.interne:8443'];
    expect(isAllowedHost('Vigie.Exemple.fr', allowed)).toBe(true);
    expect(isAllowedHost('vigie.exemple.fr:8080', allowed)).toBe(false);
    expect(isAllowedHost('vigie.interne:8443', allowed)).toBe(true);
    expect(isAllowedHost('vigie.exemple.fr.attaquant.example', allowed)).toBe(false);
    expect(isAllowedHost(null, allowed, 'local')).toBe(false);
    expect(isAllowedHost('localhost:3200', allowed)).toBe(false);
    expect(isAllowedHost('localhost:3200', [], 'loopback')).toBe(true);
    expect(isAllowedHost('192.168.1.20:3200', [], 'loopback')).toBe(false);
    expect(isAllowedHost('vigie.exemple.fr, autre.example', allowed)).toBe(true);
  });

  it('démonstration : localhost, adresse IP, nom .local ; jamais un autre nom de domaine', () => {
    for (const h of ['localhost:3200', '192.168.1.20:3200', '[fe80::1]:3200', 'macbook-de-claire.local:3200']) expect(isAllowedHost(h, [], 'local')).toBe(true);
    for (const h of ['attaquant.example', 'rebind.attaquant.example:3200', '192.168.1.20.nip.io', 'x.local.attaquant.example']) expect(isAllowedHost(h, [], 'local')).toBe(false);
  });

  it('bouclage : localhost, 127.x, [::1]', () => {
    for (const h of ['localhost', 'LOCALHOST:3200', '127.0.0.1', '127.1.2.3:80', '[::1]', '[::1]:3200']) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ['localhost.attaquant.example', '127.0.0.1.nip.io', '10.0.0.1', '[::2]:3200', '0.0.0.0']) expect(isLoopbackHost(h)).toBe(false);
  });

  it('Host et X-Forwarded-Host contrôlés, Origin réduite à son hôte', () => {
    expect(requestHosts(new Headers({ host: 'a', 'x-forwarded-host': 'b' }))).toEqual(['a', 'b']);
    expect(requestHosts(new Headers({ host: 'a' }))).toEqual(['a']);
    expect(originHost('https://Vigie.exemple.fr:8443')).toBe('vigie.exemple.fr:8443');
    expect(originHost('null')).toBeNull();
    expect(originHost('pas une url')).toBeNull();
  });
});

describe('Content-Security-Policy (SEC-05)', () => {
  it('nonce, strict-dynamic, sans unsafe-eval en production', () => {
    const csp = contentSecurityPolicy('abc', { dev: false, https: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
  });
  it('développement : unsafe-eval et websocket ; HTTP : pas de upgrade-insecure-requests', () => {
    const csp = contentSecurityPolicy('abc', { dev: true, https: false });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});
