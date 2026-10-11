import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { resetConfig } from './lib/env';
import { REFUSAL_CSP } from './lib/security';
import { proxy } from './proxy';

// Proxy (SEC-04, SEC-05) en démonstration et hors démonstration sans Entra ID configuré ; le cas Entra configuré
// (session, renouvellement) est couvert par test/integration/entra.test.ts.

const ENV_KEYS = ['VIGIE_DEMO', 'VIGIE_PUBLIC_URL', 'VIGIE_SESSION_SECRET', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function useEnv(env: Record<string, string>) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  resetConfig();
}
afterEach(() => resetConfig());
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  resetConfig();
});

const req = (url: string, init: { host?: string; method?: string; headers?: Record<string, string> } = {}) => {
  const u = new URL(url);
  return new NextRequest(u, { method: init.method ?? 'GET', headers: { host: init.host ?? u.host, ...init.headers } });
};
const passes = (r: Response) => r.headers.get('x-middleware-next') === '1';

describe('démonstration (VIGIE_DEMO=1, application Mac)', () => {
  it('localhost, [::1], adresse IP et nom .local admis sans session ; CSP à nonce, pas de HSTS en HTTP', async () => {
    useEnv({ VIGIE_DEMO: '1' });
    for (const host of ['localhost:3200', '[::1]:3200', '192.168.1.20:3200', 'macbook-de-claire.local:3200']) {
      const r = await proxy(req(`http://${host}/evenements`));
      expect(passes(r)).toBe(true);
      expect(r.headers.get('content-security-policy')).toMatch(/'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
      expect(r.headers.get('strict-transport-security')).toBeNull();
    }
    expect(passes(await proxy(req('http://192.168.1.20:3200/', { method: 'POST', headers: { origin: 'http://192.168.1.20:3200' } })))).toBe(true);
  });

  it('autre nom de domaine (DNS rebinding) ou origine étrangère : refus en texte, sans cache, CSP fermée', async () => {
    useEnv({ VIGIE_DEMO: '1' });
    const host = await proxy(req('http://rebind.attaquant.example:3200/'));
    expect(host.status).toBe(400);
    expect(host.headers.get('content-security-policy')).toBe(REFUSAL_CSP);
    expect(host.headers.get('cache-control')).toBe('no-store');
    const origin = await proxy(req('http://localhost:3200/', { method: 'POST', headers: { origin: 'https://attaquant.example' } }));
    expect(origin.status).toBe(403);
    expect(origin.headers.get('content-security-policy')).toBe(REFUSAL_CSP);
  });

  it('pièces jointes : pas de CSP de page', async () => {
    useEnv({ VIGIE_DEMO: '1' });
    const r = await proxy(req('http://localhost:3200/fichiers/abc'));
    expect(passes(r)).toBe(true);
    expect(r.headers.get('content-security-policy')).toBeNull();
  });
});

describe('production sans Entra ID configuré', () => {
  const prod = { VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr' };

  it('pages : page « Configuration incomplète » ; server actions : 503 ; refus avec HSTS et CSP fermée', async () => {
    useEnv(prod);
    const page = await proxy(req('https://vigie.exemple.fr/actions'));
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toBe('https://vigie.exemple.fr/auth/acces?motif=configuration');
    expect(page.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(page.headers.get('content-security-policy')).toBe(REFUSAL_CSP);
    const action = await proxy(req('https://vigie.exemple.fr/actions', { method: 'POST', headers: { origin: 'https://vigie.exemple.fr' } }));
    expect(action.status).toBe(503);
    expect(action.headers.get('cache-control')).toBe('no-store');
  });

  it('routes publiques ouvertes ; localhost admis pour la route de santé seulement ; cookie de rôle de démonstration ignoré', async () => {
    useEnv(prod);
    expect(passes(await proxy(req('https://vigie.exemple.fr/auth/acces?motif=configuration')))).toBe(true);
    expect(passes(await proxy(req('http://localhost:3000/api/sante')))).toBe(true);
    expect((await proxy(req('http://localhost:3000/'))).status).toBe(400);
    const demoCookie = await proxy(req('https://vigie.exemple.fr/', { headers: { cookie: 'vigie_role=Direction' } }));
    expect(demoCookie.status).toBe(307);
  });
});
