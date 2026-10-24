import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorFields, formatEntry, log, pathOnly, sanitize, scrubUrls, setLogSettings } from './log';

afterEach(() => { setLogSettings(null); vi.restoreAllMocks(); });

describe('journal du serveur (PRD-10)', () => {
  it('JSON : une ligne, horodatage, niveau, événement, champs', () => {
    const line = formatEntry('info', 'auth.login', 'Connexion', { personId: 'p1', role: 'Salarié' }, 'json', new Date('2026-10-24T08:00:00Z'));
    expect(JSON.parse(line)).toEqual({ time: '2026-10-24T08:00:00.000Z', level: 'info', app: 'vigie', event: 'auth.login', msg: 'Connexion', personId: 'p1', role: 'Salarié' });
    expect(line).not.toContain('\n');
  });
  it('secrets, données de santé, saisie libre et adresse IP jamais écrits', () => {
    const s = sanitize({
      token: 'abc', VIGIE_SESSION_SECRET: 'x', cookie: 'vigie=1', authorization: 'Bearer y', description: 'chute, fracture du poignet',
      lesionNature: 'fracture', blessure: 'arrêt', health: true, ip: '203.0.113.9', 'user-agent': 'iPhone', nested: { password: 'p', ok: 1 },
    }) as Record<string, unknown>;
    expect(JSON.stringify(s)).not.toMatch(/abc|vigie=1|Bearer|fracture|203\.0|iPhone|"p"/);
    expect((s.nested as Record<string, unknown>).ok).toBe(1);
  });
  it('adresses : identifiants et paramètres retirés ; chemin sans paramètres', () => {
    expect(scrubUrls('échec https://user:pw@matrix.exemple.fr/api?jeton=abc')).toBe('échec https://…@matrix.exemple.fr/api?…');
    expect(pathOnly('/evenements?blessure=fracture&sel=EV-1')).toBe('/evenements');
    expect(sanitize({ path: '/signaler?jeton=secret' })).toEqual({ path: '/signaler' });
  });
  it('erreurs : nom, code, message et pile tronqués', () => {
    const e = Object.assign(new Error('x'.repeat(900)), { code: '23505', digest: 'ref-1' });
    const f = errorFields(e);
    expect(f).toMatchObject({ name: 'Error', code: '23505', digest: 'ref-1' });
    expect(String(f.message).length).toBeLessThan(510);
  });
  it('niveau minimal et sorties : info sur stdout, avertissement et erreur sur stderr', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setLogSettings({ level: 'warn', format: 'json' });
    log.info('a', 'masqué');
    log.warn('b', 'visible');
    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
    setLogSettings({ level: 'debug', format: 'texte' });
    log.debug('c', 'détail', { n: 2 });
    expect(String(out.mock.calls[0][0])).toBe('[vigie] DEBUG c : détail (n=2)\n');
  });
});
