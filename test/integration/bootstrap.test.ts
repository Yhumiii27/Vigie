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

    // D14 (CV-09) : le premier site se choisit dans matrix.pub_sites. Sur une base PostgreSQL hors démonstration, aucun
    // substitut : la source est indisponible et la création refusée avec un message ; substituts posés ensuite pour la suite.
    const { saveSite } = await import('@/server/sites');
    const { installForeignSubstitutes } = await import('@/db/foreign-substitutes');
    if (process.env.DATABASE_URL) {
      expect(await saveSite({}, form({ id: '', code: 'site_a', qhseLeadId: 'p1' }))).toMatchObject({ error: expect.stringMatching(/Sites de Matrix indisponibles/) });
      await installForeignSubstitutes(db, { engine: 'pglite', demo: false });
    }
    expect(await saveSite({}, form({ id: '', label: 'Site de Lyon' }))).toMatchObject({ fieldErrors: { code: expect.any(String) } });
    expect(await saveSite({}, form({ id: '', code: 'lyon' }))).toMatchObject({ fieldErrors: { code: 'Site inconnu de Matrix.' } });
    expect(await saveSite({}, form({ id: '', code: 'site_c' }))).toMatchObject({ fieldErrors: { code: 'Site fermé dans Matrix.' } });
    const r = await saveSite({}, form({ id: '', code: 'site_a', qhseLeadId: 'p1' }));
    expect(r).toMatchObject({ ok: true, id: 'site_a' });
    const [site] = await db.select().from(t.sites);
    expect(site).toMatchObject({ id: 'site_a', label: 'Site de [Ville A] — siège et ateliers', sort: 1, qhseLeadId: 'p1', matrixState: 'actif' });
    const [p1] = await db.select().from(t.people);
    expect(p1.siteId).toBe('site_a');
    expect(await getSession()).toMatchObject({ bootstrap: false, site: { id: 'site_a' } });
    expect(await saveSite({}, form({ id: '', code: 'site_a' }))).toMatchObject({ fieldErrors: { code: 'Site déjà suivi par Vigie.' } });
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
      site: { id: 'site_a' }, siteOptions: [{ id: 'site_a' }], allowedSiteIds: ['autre-site', 'site_a'],
    });
  });
});
