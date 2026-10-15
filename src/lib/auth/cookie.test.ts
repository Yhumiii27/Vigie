import { describe, expect, it } from 'vitest';
import {
  SESSION_ABSOLUTE_SECONDS, SESSION_IDLE_SECONDS, oidcCookieName, openSession, openTransaction, sealSession, sealTransaction,
  sessionCookieName, sessionMaxAge, sessionNeedsRenewal, type SessionClaims,
} from './cookie';

const SECRET = 'un-secret-de-session-de-test-assez-long';
const NOW = 1_800_000_000;
const claims = (over: Partial<SessionClaims> = {}): SessionClaims =>
  ({ pid: 'p1', role: 'Salarié', sites: ['ville-a'], oid: 'oid-1', auth: NOW - 60, seen: NOW - 60, ...over });

describe('cookie de session', () => {
  it('chiffré, authentifié, lié au secret', async () => {
    const token = await sealSession(claims({ hint: 'h' }), SECRET);
    expect(token.split('.')).toHaveLength(5);
    expect(token).not.toContain('oid-1');
    expect(await openSession(token, SECRET, NOW)).toEqual(claims({ hint: 'h' }));
    expect(await openSession(token, `${SECRET}-autre`, NOW)).toBeNull();
    const [h, k, iv, ct, tag] = token.split('.');
    expect(await openSession([h, k, iv, ct.slice(0, -2) + (ct.endsWith('AA') ? 'BB' : 'AA'), tag].join('.'), SECRET, NOW)).toBeNull();
    expect(await openSession(undefined, SECRET, NOW)).toBeNull();
    expect(await openSession('pas-un-jeton', SECRET, NOW)).toBeNull();
  });

  it('expiration glissante (8 h) et absolue (12 h)', async () => {
    const idle = claims({ auth: NOW - 9 * 3600, seen: NOW - SESSION_IDLE_SECONDS - 1 });
    expect(await openSession(await sealSession({ ...idle, seen: NOW - 7 * 3600 }, SECRET), SECRET, NOW)).not.toBeNull();
    expect(await openSession(await sealSession(idle, SECRET), SECRET, NOW)).toBeNull();
    const old = claims({ auth: NOW - SESSION_ABSOLUTE_SECONDS - 1, seen: NOW - 10 });
    expect(await openSession(await sealSession(old, SECRET), SECRET, NOW)).toBeNull();
    // Session « du futur » (horloge) refusée.
    expect(await openSession(await sealSession(claims({ auth: NOW + 3600, seen: NOW + 3600 }), SECRET), SECRET, NOW)).toBeNull();
    // max-age : la plus proche des deux échéances.
    expect(sessionMaxAge(claims({ auth: NOW - 11 * 3600, seen: NOW }), NOW)).toBe(3600);
    expect(sessionMaxAge(claims({ auth: NOW, seen: NOW }), NOW)).toBe(SESSION_IDLE_SECONDS);
  });

  it('renouvelé après 5 min d’activité seulement', () => {
    expect(sessionNeedsRenewal(claims({ seen: NOW - 60 }), NOW)).toBe(false);
    expect(sessionNeedsRenewal(claims({ seen: NOW - 301 }), NOW)).toBe(true);
  });

  it('transaction OIDC : aller-retour, clé distincte de la session', async () => {
    const tx = { state: 's', nonce: 'n', verifier: 'v', retour: '/audits' };
    const token = await sealTransaction(tx, SECRET);
    expect(await openTransaction(token, SECRET)).toEqual(tx);
    expect(await openSession(token, SECRET)).toBeNull();
    expect(await openTransaction(await sealSession(claims(), SECRET), SECRET)).toBeNull();
  });

  it('noms : préfixe __Host- en HTTPS, transaction nommée d’après le state', () => {
    expect(sessionCookieName(true)).toBe('__Host-vigie_session');
    expect(sessionCookieName(false)).toBe('vigie_session');
    expect(oidcCookieName(true, 'abc/DEF+ghi_jkl-mnopqrstu')).toBe('__Host-vigie_oidc_abcDEFghi_jkl-mn');
  });
});
