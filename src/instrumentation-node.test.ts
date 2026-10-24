import { afterEach, describe, expect, it, vi } from 'vitest';
import { logRequestError } from './instrumentation-node';
import { setLogSettings } from './lib/log';

afterEach(() => { setLogSettings(null); vi.restoreAllMocks(); });

describe('erreurs serveur journalisées (PRD-10, onRequestError)', () => {
  it('référence, route et chemin sans paramètres ; ni en-têtes ni cookies', () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setLogSettings({ level: 'info', format: 'json' });
    logRequestError(Object.assign(new Error('boum'), { digest: '1234567' }),
      { path: '/evenements?blessure=fracture', method: 'POST', headers: { cookie: 'vigie_session=secret', 'x-forwarded-for': '203.0.113.9' } },
      { routerKind: 'App Router', routePath: '/(app)/evenements', routeType: 'action', renderSource: 'react-server-components', revalidateReason: undefined, renderType: 'dynamic' } as never);
    const line = JSON.parse(String(err.mock.calls[0][0]));
    expect(line).toMatchObject({ level: 'error', event: 'request.error', digest: '1234567', method: 'POST', path: '/evenements', route: '/(app)/evenements', routeType: 'action', message: 'boum' });
    expect(JSON.stringify(line)).not.toMatch(/secret|fracture|203\.0/);
  });
});
