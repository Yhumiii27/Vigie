import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieJar } from '../next-mocks';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { resetConfig } from '@/lib/env';
import type { Role } from '@/lib/domain';
import { freshDemoDatabase } from '../helpers';

// Listes de choix des formulaires limitées au périmètre (réserve SEC-02 / EVT-23 du lot 1) : options.sites contient
// exactement les sites qu'accepte requireInSite(…, { create: true }) (writableSites), événements et actions liables du
// site sélectionné et du périmètre ; loadLinkedAction ne nomme pas le site d'une action hors périmètre.
// Jeu de démonstration, puis session Entra ID (périmètre restreint) sur la même base.

const SECRET = 'secret-de-session-des-tests-perimetre-0123456789';
const ENTRA_ENV = {
  VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr', VIGIE_SESSION_SECRET: SECRET,
  ENTRA_TENANT_ID: 'tenant', ENTRA_CLIENT_ID: 'client', ENTRA_CLIENT_SECRET: 'secret',
};

freshDemoDatabase();
beforeAll(() => {
  delete process.env.VIGIE_DEMO;
  delete process.env.VIGIE_TODAY;
  Object.assign(process.env, ENTRA_ENV);
  resetConfig();
});
afterAll(() => {
  for (const k of Object.keys(ENTRA_ENV)) delete process.env[k];
  resetConfig();
});

/** Session Entra ID scellée (personne, rôle, sites accordés ou null = tous) et site sélectionné. */
async function actAsEntra(pid: string, role: Role, sites: string[] | null, site: string) {
  const { sealSession } = await import('@/lib/auth/cookie');
  const now = Math.floor(Date.now() / 1000);
  cookieJar.clear();
  cookieJar.set('__Host-vigie_session', await sealSession({ pid, role, sites, oid: `oid-${pid}`, auth: now, seen: now }, SECRET));
  cookieJar.set('vigie_site', site);
}

const ids = (opts: readonly (readonly [string, string])[]) => opts.map(([id]) => id);

async function siteOf(table: 'events' | 'actions', id: string) {
  const db = await getDb();
  const tbl = table === 'events' ? t.events : t.actions;
  const [row] = await db.select({ siteId: tbl.siteId }).from(tbl).where(eq(tbl.id, id));
  return row.siteId;
}

describe('listes de choix des formulaires et périmètre', () => {
  it('chef de service restreint à son site : son site seulement, pas de « Tous les sites », rien d’un autre site', async () => {
    await actAsEntra('sbenali', 'Chef de service', ['ville-a'], 'all');
    const { loadFormOptions } = await import('@/lib/data/options');
    const options = await loadFormOptions();
    expect(ids(options.sites)).toEqual(['ville-a']);
    expect(options.allSites).toBe(false);
    expect(options.events.length).toBeGreaterThan(0);
    expect(options.actions.length).toBeGreaterThan(0);
    for (const [id] of options.events) expect([null, 'ville-a']).toContain(await siteOf('events', id));
    for (const [id] of options.actions) expect([null, 'ville-a']).toContain(await siteOf('actions', id));
  });

  it('périmètre de deux sites : le site sélectionné seulement', async () => {
    await actAsEntra('sbenali', 'Chef de service', ['ville-a', 'ville-b'], 'ville-b');
    const { loadFormOptions } = await import('@/lib/data/options');
    const options = await loadFormOptions();
    expect(ids(options.sites)).toEqual(['ville-b']);
    expect(options.allSites).toBe(false);
    for (const [id] of options.events) expect([null, 'ville-b']).toContain(await siteOf('events', id));
  });

  it('direction : sites actifs sous « Tous les sites » (archivé exclu), « Tous les sites » admis ; site sélectionné sinon', async () => {
    await actAsEntra('hmarchand', 'Direction', null, 'all');
    const { loadFormOptions } = await import('@/lib/data/options');
    const all = await loadFormOptions();
    expect(ids(all.sites)).toEqual(['ville-a', 'ville-b']);
    expect(ids(all.sites)).not.toContain('ville-c');
    expect(all.allSites).toBe(true);
    const sites = new Set(await Promise.all(all.events.map(([id]) => siteOf('events', id))));
    expect(sites.has('ville-a') && sites.has('ville-b')).toBe(true);
    await actAsEntra('hmarchand', 'Direction', null, 'ville-a');
    const a = await loadFormOptions();
    expect(ids(a.sites)).toEqual(['ville-a']);
    expect(a.allSites).toBe(true);
  });

  it('writableSites et requireInSite(…, { create: true }) : mêmes sites admis', async () => {
    const { requireInSite, writableSites } = await import('@/lib/guard');
    const cases: [string, Role, string[] | null, string][] = [
      ['sbenali', 'Chef de service', ['ville-a'], 'all'],
      ['sbenali', 'Chef de service', ['ville-a'], 'ville-a'],
      ['sbenali', 'Chef de service', ['ville-a', 'ville-b'], 'ville-a'],
      ['sbenali', 'Chef de service', ['ville-a', 'ville-b'], 'ville-b'],
      ['hmarchand', 'Direction', null, 'all'],
      ['hmarchand', 'Direction', null, 'ville-b'],
      ['clefevre', 'Animateur QHSE', null, 'ville-a'],
    ];
    for (const [pid, role, sites, site] of cases) {
      await actAsEntra(pid, role, sites, site);
      const writable = await writableSites();
      for (const s of ['ville-a', 'ville-b', 'ville-c', 'inconnu']) {
        expect([pid, site, s, (await requireInSite(s, { create: true })) === null]).toEqual([pid, site, s, writable.sites.some((w) => w.id === s)]);
      }
      expect((await requireInSite(null, { create: true })) === null).toBe(writable.allSites);
    }
  });

  it('action liée : hors périmètre, introuvable sans nommer son site ; dans le périmètre, autre site nommé', async () => {
    const db = await getDb();
    const [other] = await db.select({ id: t.actions.id }).from(t.actions).where(eq(t.actions.siteId, 'ville-b')).limit(1);
    expect(other).toBeDefined();
    const { loadLinkedAction } = await import('@/lib/data/actions');
    await actAsEntra('sbenali', 'Chef de service', ['ville-a'], 'ville-a');
    expect(await loadLinkedAction(other.id)).toEqual({ action: null, elsewhere: null });
    await actAsEntra('hmarchand', 'Direction', null, 'ville-a');
    const [b] = await db.select({ label: t.sites.label }).from(t.sites).where(eq(t.sites.id, 'ville-b'));
    expect(await loadLinkedAction(other.id)).toEqual({ action: null, elsewhere: b.label });
    cookieJar.clear();
  });
});
