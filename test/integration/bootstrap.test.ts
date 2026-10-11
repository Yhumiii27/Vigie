import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { form } from '../next-mocks';
import { closeDb, getDb, schema as t } from '@/db';
import { resetConfig } from '@/lib/env';
import type { AuthState } from '@/lib/auth';

// Production sur base vide (PRD-04) : pas de jeu de démonstration, écran d'amorçage, premier site créé par l'animateur QHSE.

const auth = vi.hoisted(() => ({ state: { status: 'anonymous' } as AuthState }));
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), getAuthState: async () => auth.state }));

beforeAll(async () => {
  delete process.env.VIGIE_DEMO;
  delete process.env.VIGIE_TODAY;
  process.env.VIGIE_DATA_DIR = 'memory://';
  process.env.VIGIE_PUBLIC_URL = 'https://vigie.exemple.fr';
  resetConfig();
  await closeDb();
});
afterAll(async () => {
  await closeDb();
});

describe('base de production vide', () => {
  it('sans identité : redirection, jamais de rôle par défaut', async () => {
    const { getSession, getOptionalSession } = await import('@/lib/session');
    await expect(getSession()).rejects.toThrow('NEXT_REDIRECT:/auth/connexion');
    expect(await getOptionalSession()).toBeNull();
    const db = await getDb();
    expect(await db.select().from(t.sites)).toEqual([]);
    expect(await db.select().from(t.people)).toEqual([]);
  });

  it('amorçage : « Tous les sites » seul, puis premier site créé et rattaché', async () => {
    const db = await getDb();
    await db.insert(t.people).values({ id: 'p1', name: 'Camille Martin', email: 'c.martin@exemple.fr', lastRole: 'Animateur QHSE' });
    auth.state = { status: 'authenticated', identity: { personId: 'p1', role: 'Animateur QHSE', siteIds: null } };
    const { getSession } = await import('@/lib/session');
    const before = await getSession();
    expect(before).toMatchObject({ bootstrap: true, demo: false, siteOptions: [{ id: 'all' }] });
    const { loadTodo } = await import('@/lib/data/todo');
    expect(Array.isArray(await loadTodo())).toBe(true);

    const { saveSite } = await import('@/server/sites');
    const r = await saveSite({}, form({ id: '', label: 'Site de Lyon', qhseLeadId: 'p1' }));
    expect(r).toMatchObject({ ok: true, id: 'site-de-lyon' });
    const [site] = await db.select().from(t.sites);
    expect(site).toMatchObject({ id: 'site-de-lyon', qhseLeadId: 'p1' });
    const [p1] = await db.select().from(t.people);
    expect(p1.siteId).toBe('site-de-lyon');
    expect(await getSession()).toMatchObject({ bootstrap: false, site: { id: 'site-de-lyon' } });
  });

  it('Salarié sans site de rattachement ni site accordé actif : accès refusé', async () => {
    const db = await getDb();
    await db.insert(t.people).values({ id: 'p2', name: 'Alex Petit', email: 'a.petit@exemple.fr', lastRole: 'Salarié' });
    auth.state = { status: 'authenticated', identity: { personId: 'p2', role: 'Salarié', siteIds: ['autre-site'] } };
    const { getSession } = await import('@/lib/session');
    await expect(getSession()).rejects.toThrow('NEXT_REDIRECT:/auth/acces?motif=non-autorise');
  });

  it('le site de rattachement actuel fait toujours partie du périmètre', async () => {
    auth.state = { status: 'authenticated', identity: { personId: 'p1', role: 'Salarié', siteIds: ['autre-site'] } };
    const { getSession } = await import('@/lib/session');
    expect(await getSession()).toMatchObject({
      site: { id: 'site-de-lyon' }, siteOptions: [{ id: 'site-de-lyon' }], allowedSiteIds: ['autre-site', 'site-de-lyon'],
    });
  });
});
