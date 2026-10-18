import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROLE_KEYS, SCREENS, canSee, homeOf } from '../domain';
import { HEALTH_PAGES, ROLE_ROUTES, demoRoleOf, routeDecision, screenOfPath } from './route-access';

// Redirections de rôle avant le rendu (SEC-14) : décision du proxy, et concordance de ROLE_ROUTES avec les gardes des
// pages (guard('<écran>')), qui font foi. Un nouvel écran, une page déplacée ou un droit modifié dans domain.ts doit
// être reporté dans ROLE_ROUTES (src/lib/auth/route-access.ts).

const APP_DIR = path.resolve(__dirname, '../../app');

/** Fichiers page.tsx et route.ts de src/app, avec leur URL (groupes « (x) » retirés, segment dynamique [x] → x). */
function appFiles(dir = APP_DIR): { file: string; url: string; kind: 'page' | 'route' }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return appFiles(full);
    const kind = e.name === 'page.tsx' ? 'page' : e.name === 'route.ts' ? 'route' : null;
    if (!kind) return [];
    const segments = path.relative(APP_DIR, dir).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s)).map((s) => s.replace(/^\[+\.*(.*?)\]+$/, '$1'));
    return [{ file: full, url: `/${segments.join('/')}`, kind }];
  });
}

describe('décision du proxy (SEC-14)', () => {
  it('écran fermé au rôle : vers son écran d’accueil ; écran ouvert : passe', () => {
    expect(routeDecision('/', 'Salarié', false)).toEqual({ kind: 'redirect', to: '/evenements' });
    expect(routeDecision('/veille', 'Chef de projet', false)).toEqual({ kind: 'redirect', to: '/' });
    expect(routeDecision('/veille/', 'Chef de projet', false)).toEqual({ kind: 'redirect', to: '/' });
    expect(routeDecision('/prevention/imprimer/permis/PF-1', 'Salarié', false)).toEqual({ kind: 'redirect', to: '/evenements' });
    expect(routeDecision('/revue-de-direction', 'Salarié', false)).toEqual({ kind: 'redirect', to: '/evenements' });
    expect(routeDecision('/audits', 'Salarié', true)).toEqual({ kind: 'redirect', to: '/evenements' });
    expect(routeDecision('/audits/contributions', 'Salarié', false)).toEqual({ kind: 'pass' });
    expect(routeDecision('/evenements', 'Salarié', false)).toEqual({ kind: 'pass' });
    expect(routeDecision('/a-faire', 'Salarié', false)).toEqual({ kind: 'pass' });
    expect(routeDecision('/risques', 'Salarié', false)).toEqual({ kind: 'pass' });
    for (const p of ['/', '/veille', '/audits', '/environnement', '/revue-de-direction', '/prevention/carte', '/signaler/postes']) {
      expect(routeDecision(p, 'Animateur QHSE', false)).toEqual({ kind: 'pass' });
      expect(routeDecision(p, 'Direction', false)).toEqual({ kind: 'pass' });
    }
  });

  it('aperçu mobile : introuvable hors démonstration ; QR codes des postes : encadrement seulement', () => {
    expect(routeDecision('/apercu-mobile', 'Animateur QHSE', false)).toEqual({ kind: 'notFound' });
    expect(routeDecision('/apercu-mobile/x', 'Salarié', false)).toEqual({ kind: 'notFound' });
    expect(routeDecision('/apercu-mobile', 'Salarié', true)).toEqual({ kind: 'pass' });
    expect(routeDecision('/signaler/postes', 'Salarié', false)).toEqual({ kind: 'redirect', to: '/signaler' });
    expect(routeDecision('/signaler/postes', 'Chef de projet', false)).toEqual({ kind: 'pass' });
    expect(routeDecision('/signaler', 'Salarié', false)).toEqual({ kind: 'pass' });
    expect(routeDecision('/signaler/mes-signalements', 'Salarié', false)).toEqual({ kind: 'pass' });
  });

  it('registre des accidents bénins (données de santé) : animateur QHSE et direction seulement', () => {
    for (const role of ['Salarié', 'Chef de service', 'Chef de projet'] as const) {
      expect(routeDecision('/evenements/registre-benin', role, false), role).toEqual({ kind: 'redirect', to: '/evenements' });
    }
    for (const role of ['Animateur QHSE', 'Direction'] as const) {
      expect(routeDecision('/evenements/registre-benin', role, false), role).toEqual({ kind: 'pass' });
    }
    expect(routeDecision('/evenements', 'Chef de projet', false)).toEqual({ kind: 'pass' });
  });

  it('synthèse de la DAT et bilan SSCT (paquet 5) : animateur QHSE et direction seulement', () => {
    for (const role of ['Salarié', 'Chef de service', 'Chef de projet'] as const) {
      expect(routeDecision('/evenements/imprimer/EV-2026-119', role, false), role).toEqual({ kind: 'redirect', to: '/evenements' });
      expect(routeDecision('/risques/bilan-ssct', role, false), role).toEqual({ kind: 'redirect', to: '/risques' });
    }
    for (const role of ['Animateur QHSE', 'Direction'] as const) {
      expect(routeDecision('/evenements/imprimer/EV-2026-119', role, false), role).toEqual({ kind: 'pass' });
      expect(routeDecision('/risques/bilan-ssct', role, false), role).toEqual({ kind: 'pass' });
    }
  });

  it('routes publiques et route handlers (403 eux-mêmes) : jamais redirigés', () => {
    for (const p of ['/risques/export', '/environnement/registre', '/fichiers/abc', '/api/sante', '/auth/acces', '/_introuvable']) {
      expect(screenOfPath(p), p).toBeNull();
      for (const role of ROLE_KEYS) expect(routeDecision(p, role, false), `${role} ${p}`).toEqual({ kind: 'pass' });
    }
    expect(screenOfPath('/risques/imprimer')).toBe('risks');
    expect(screenOfPath('/evenementsX')).toBeNull();
  });

  it('même règle que guard() : redirection vers l’accueil du rôle exactement quand canSee est faux', () => {
    for (const route of ROLE_ROUTES) {
      for (const role of ROLE_KEYS) {
        const expected = canSee(role, route.screen) ? { kind: 'pass' } : { kind: 'redirect', to: SCREENS[homeOf(role)].path };
        expect(routeDecision(route.path, role, false), `${role} ${route.path}`).toEqual(expected);
      }
    }
  });

  it('rôle de démonstration : cookie reconnu, sinon le rôle par défaut', () => {
    expect(demoRoleOf('Direction')).toBe('Direction');
    expect(demoRoleOf('Salarié')).toBe('Salarié');
    expect(demoRoleOf('x')).toBe('Animateur QHSE');
    expect(demoRoleOf(undefined)).toBe('Animateur QHSE');
  });
});

describe('ROLE_ROUTES et gardes des pages (src/app)', () => {
  const files = appFiles();

  it('chaque page d’un écran de ROLE_ROUTES appelle guard() de cet écran, et réciproquement', () => {
    const pages = files.filter((f) => f.kind === 'page');
    expect(pages.length).toBeGreaterThan(20);
    for (const { file, url } of pages) {
      const source = readFileSync(file, 'utf8');
      const guarded = [...source.matchAll(/\bguard\('([a-z]+)'\)/g)].map((m) => m[1]);
      const screen = screenOfPath(url);
      if (screen) expect(guarded, `${url} (${path.relative(APP_DIR, file)}) : guard('${screen}') attendu`).toContain(screen);
      for (const g of guarded) expect(screen, `${url} appelle guard('${g}') : à ajouter à ROLE_ROUTES`).toBe(g);
    }
  });

  it('route handlers hors de ROLE_ROUTES (ils répondent eux-mêmes 401 / 403 / 404)', () => {
    const routes = files.filter((f) => f.kind === 'route');
    expect(routes.map((r) => r.url)).toContain('/risques/export');
    for (const { url } of routes) expect(screenOfPath(url), url).toBeNull();
  });

  it('aperçu mobile, QR codes des postes, pages de santé : contrôle dans la page aussi', () => {
    // Page du chemin, ou première page sous ce chemin (synthèse DAT : /evenements/imprimer/[id]).
    const source = (url: string) => readFileSync(files.find((f) => f.kind === 'page' && (f.url === url || f.url.startsWith(`${url}/`)))!.file, 'utf8');
    expect(source(SCREENS.mobile.path)).toMatch(/if \(!isDemo\(\)\) notFound\(\)/);
    expect(source('/signaler/postes')).toMatch(/!canManage\(role\)/);
    for (const h of HEALTH_PAGES) expect(source(h.path), h.path).toMatch(/!canSeeHealth\(session\.role\)\) redirect\(/);
  });
});
