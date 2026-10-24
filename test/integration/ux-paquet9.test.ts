import { describe, expect, it, vi } from 'vitest';
import { cookieJar } from '../next-mocks';
import { actAs, freshDemoDatabase } from '../helpers';
import { setRole, setSite } from '@/app/actions';
import type { AuthState } from '@/lib/auth';
import { loadAudits } from '@/lib/data/audits';
import { loadDashboard } from '@/lib/data/dashboard';
import { loadDocuments } from '@/lib/data/documents';
import { loadMyContributions } from '@/lib/data/review';
import { canonicalHref } from '@/lib/url-state';

// Paquet 9 — UX et accessibilité : retours d'état du choix du site et du rôle (UX-14), liens du tableau de bord à la
// convention d'URL (UX-12), liens profonds inconnus signalés sans rien révéler hors du périmètre (UX-13).

const auth = vi.hoisted(() => ({ override: null as AuthState | null }));
vi.mock('@/lib/auth', async (orig) => {
  const real = await orig<typeof import('@/lib/auth')>();
  return { ...real, getAuthState: async () => auth.override ?? real.getAuthState() };
});

freshDemoDatabase();

describe('choix du site et du rôle (UX-14)', () => {
  it('setSite : site du périmètre accepté, autre site refusé avec un message, sans rien changer', async () => {
    actAs('Animateur QHSE', 'ville-a');
    cookieJar.delete('vigie_site');
    expect(await setSite('ville-b')).toEqual({ ok: true });
    expect(cookieJar.get('vigie_site')).toBe('ville-b');
    expect(await setSite('site-inconnu')).toEqual({ error: expect.stringMatching(/hors de votre périmètre/) });
    expect(cookieJar.get('vigie_site')).toBe('ville-b');
  });

  it('setSite : hors du périmètre d’une personne rattachée à un site', async () => {
    auth.override = { status: 'authenticated', identity: { personId: 'jpetit', role: 'Chef de service', siteIds: ['ville-b'] } };
    cookieJar.delete('vigie_site');
    expect(await setSite('ville-a')).toMatchObject({ error: expect.any(String) });
    expect(cookieJar.get('vigie_site')).toBeUndefined();
    auth.override = null;
  });

  it('setRole (démonstration) : rôle inconnu refusé avec un message, rôle connu redirigé vers son accueil', async () => {
    expect(await setRole('Pirate')).toEqual({ error: 'Rôle inconnu.' });
    await expect(setRole('Direction')).rejects.toThrow(/NEXT_REDIRECT/);
  });
});

describe('convention d’URL (UX-12)', () => {
  it('liens du tableau de bord déjà canoniques (aucun ancien paramètre à réécrire)', async () => {
    actAs('Animateur QHSE', 'all');
    const d = await loadDashboard();
    const hrefs = [
      ...d.kpis.flatMap((k) => [k.href, k.subHref]),
      ...Object.values(d).flatMap((v) => (Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' && 'href' in x ? (x as { href: unknown }).href : null)) : [])),
    ].filter((h): h is string => typeof h === 'string' && h.startsWith('/'));
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      const url = new URL(href, 'http://vigie.local');
      expect(canonicalHref(url.pathname, Object.fromEntries(url.searchParams)), href).toBeNull();
    }
  });
});

describe('élément introuvable (UX-13)', () => {
  it('audits : élément et constat inconnus signalés, éléments existants ouverts', async () => {
    actAs('Animateur QHSE', 'all');
    const known = await loadAudits({});
    expect(known).toMatchObject({ missingElement: false, missingFinding: false });
    const element = known.plan[0];
    expect(await loadAudits({ element: String(element.id) })).toMatchObject({ openElement: element.id, missingElement: false });
    expect(await loadAudits({ element: '999999' })).toMatchObject({ openElement: undefined, missingElement: true });
    expect(await loadAudits({ element: 'abc' })).toMatchObject({ missingElement: true });
    expect(await loadAudits({ constat: '999999' })).toMatchObject({ openFinding: undefined, missingFinding: true });
  });

  it('contributions : revue inconnue ou qui ne concerne pas la personne → aucune revue mise en avant', async () => {
    actAs('Salarié', 'all');
    const data = await loadMyContributions({ revue: '999999' });
    expect(data.focus).toBeNull();
  });

  it('documents : un document d’un site hors du périmètre n’est ni nommé ni expliqué (bandeau « introuvable »)', async () => {
    // Démonstration (tous les sites), site Ville-B sélectionné : un document de Ville-A est expliqué (« sélectionnez ce site »).
    actAs('Animateur QHSE', 'ville-b');
    expect((await loadDocuments()).elsewhere).toHaveProperty('IT-MON-012');
    // Personne rattachée à Ville-B seulement : le document de Ville-A est inconnu, son site n'est jamais nommé.
    auth.override = { status: 'authenticated', identity: { personId: 'jpetit', role: 'Chef de service', siteIds: ['ville-b'] } };
    cookieJar.set('vigie_site', 'ville-b');
    const restricted = await loadDocuments();
    expect(restricted.elsewhere).not.toHaveProperty('IT-MON-012');
    expect(restricted.rows.some((r) => r.id === 'IT-MON-012')).toBe(false);
    // Consultation seule (vue des documents en vigueur) : aucune raison donnée pour un document hors périmètre.
    const reader = await loadDocuments({ readOnly: true });
    expect(Object.keys(reader.elsewhere)).not.toContain('IT-MON-012');
    expect(Object.keys(reader.unavailable).filter((id) => id.startsWith('IT-MON-'))).toEqual([]);
    auth.override = null;
  });
});
