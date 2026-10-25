import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieJar } from '../next-mocks';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema as t } from '@/db';
import { resetConfig } from '@/lib/env';
import type { EntraProfile } from '@/lib/auth/claims';
import type { Role } from '@/lib/domain';
import { REFUSAL_CSP } from '@/lib/security';

// Hors démonstration, Entra ID (SEC-01, SEC-02, SEC-03) : fiche rapprochée ou créée à la connexion, session chiffrée
// lue par getSession(), périmètre de sites, contrôles du proxy (hôte, origine, connexion requise, CSP, HSTS).

const SECRET = 'secret-de-session-des-tests-integration-0123456789';
const TODAY = '2026-10-09';

beforeAll(async () => {
  delete process.env.VIGIE_DEMO;
  delete process.env.VIGIE_TODAY;
  process.env.VIGIE_DATA_DIR = 'memory://';
  Object.assign(process.env, {
    VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr', VIGIE_SESSION_SECRET: SECRET,
    ENTRA_TENANT_ID: 'tenant', ENTRA_CLIENT_ID: 'client', ENTRA_CLIENT_SECRET: 'secret', VIGIE_SITE_GROUPS: 'g-b:ville-b',
    VIGIE_EMAIL_DOMAINS: 'exemple.fr',
  });
  resetConfig();
  await closeDb();
  const db = await getDb();
  await db.insert(t.sites).values([
    { id: 'ville-a', label: 'Site A', sort: 1 }, { id: 'ville-b', label: 'Site B', sort: 2 },
    { id: 'ville-c', label: 'Site C', sort: 0, archivedAt: new Date('2026-01-01T00:00:00Z'), archiveReason: 'Site fermé' },
  ]);
  await db.insert(t.people).values([
    { id: 'pa', name: 'A. Dupont', email: 'a.dupont@exemple.fr', siteId: 'ville-a', sort: 0 },
    { id: 'pb', name: 'B. Durand', email: 'b.durand@exemple.fr', siteId: 'ville-b', entraObjectId: 'oid-autre', sort: 1 },
    { id: 'pl', name: 'L. Parti', email: 'l.parti@exemple.fr', siteId: 'ville-a', leftOn: '2026-09-30', sort: 2 },
  ]);
});
afterAll(async () => {
  for (const k of ['VIGIE_PUBLIC_URL', 'VIGIE_SESSION_SECRET', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'VIGIE_SITE_GROUPS', 'VIGIE_EMAIL_DOMAINS']) delete process.env[k];
  resetConfig();
  await closeDb();
});

const profile = (over: Partial<EntraProfile>): EntraProfile =>
  ({ oid: 'oid-x', name: 'X', email: null, emailVerified: true, roles: [], groups: [], groupsOverage: false, ...over });
const DOMAINS = ['exemple.fr'];

describe('fiche à la connexion', () => {
  it('première connexion avec une adresse non vérifiée : refus « adresse », fiche ni associée ni créée, rien au journal', async () => {
    const { signInPerson } = await import('@/lib/auth/person');
    const db = await getDb();
    const r = await signInPerson(db, { profile: profile({ oid: 'oid-a', email: 'a.dupont@exemple.fr', emailVerified: false }), role: 'Chef de projet', groupSites: [], today: TODAY, emailDomains: DOMAINS });
    expect(r).toMatchObject({ ok: false, motif: 'adresse' });
    expect(!r.ok && r.reason).toMatch(/première connexion de oid-a \(a\.dupont@exemple\.fr\) : adresse non vérifiée/);
    const [pa] = await db.select().from(t.people).where(eq(t.people.id, 'pa'));
    expect(pa).toMatchObject({ entraObjectId: null, lastRole: null, lastLoginAt: null });
    expect(await db.select().from(t.changeLog).where(eq(t.changeLog.entityId, 'pa'))).toEqual([]);
    // VIGIE_EMAIL_DOMAINS absente : aucune première connexion admise, même vérifiée.
    expect(await signInPerson(db, { profile: profile({ oid: 'oid-a', email: 'a.dupont@exemple.fr' }), role: 'Chef de projet', groupSites: [], today: TODAY, emailDomains: [] }))
      .toMatchObject({ ok: false, motif: 'adresse', reason: expect.stringMatching(/VIGIE_EMAIL_DOMAINS/) });
  });

  it('rapprochement par adresse vérifiée (casse ignorée) : objectId, dernier rôle et connexion enregistrés, liaison journalisée', async () => {
    const { signInPerson } = await import('@/lib/auth/person');
    const db = await getDb();
    const r = await signInPerson(db, { profile: profile({ oid: 'oid-a', email: 'A.Dupont@Exemple.FR' }), role: 'Chef de projet', groupSites: [], today: TODAY, emailDomains: DOMAINS });
    expect(r).toEqual({ ok: true, personId: 'pa', created: false, siteIds: ['ville-a'] });
    const [pa] = await db.select().from(t.people).where(eq(t.people.id, 'pa'));
    expect(pa).toMatchObject({ entraObjectId: 'oid-a', lastRole: 'Chef de projet', email: 'a.dupont@exemple.fr' });
    expect(pa.lastLoginAt).toBeInstanceOf(Date);
    const log = await db.select().from(t.changeLog).where(eq(t.changeLog.entityId, 'pa'));
    expect(log.map((l) => [l.action, l.byId])).toEqual([['link', 'pa']]);
  });

  it('connexion suivante par objectId : adresse vérifiée reprise, adresse non vérifiée ignorée ; sites accordés par groupe', async () => {
    const { signInPerson } = await import('@/lib/auth/person');
    const db = await getDb();
    const r = await signInPerson(db, { profile: profile({ oid: 'oid-a', email: 'anne.dupont@exemple.fr' }), role: 'Salarié', groupSites: ['ville-b', 'inconnu'], today: TODAY, emailDomains: DOMAINS });
    expect(r).toEqual({ ok: true, personId: 'pa', created: false, siteIds: ['ville-b', 'ville-a'] });
    const [pa] = await db.select().from(t.people).where(eq(t.people.id, 'pa'));
    expect(pa).toMatchObject({ email: 'anne.dupont@exemple.fr', lastRole: 'Salarié' });
    // Adresse non vérifiée, ou hors des domaines de l'entreprise : la connexion passe (objectId), la fiche garde son adresse.
    for (const over of [{ email: 'anne.d@exemple.fr', emailVerified: false }, { email: 'anne@attaquant.example' }]) {
      expect(await signInPerson(db, { profile: profile({ oid: 'oid-a', ...over }), role: 'Salarié', groupSites: [], today: TODAY, emailDomains: DOMAINS }))
        .toMatchObject({ ok: true, personId: 'pa' });
      expect((await db.select().from(t.people).where(eq(t.people.id, 'pa')))[0].email).toBe('anne.dupont@exemple.fr');
    }
  });

  it('refus : fiche déjà associée à un autre compte, fiche sortie de l’effectif', async () => {
    const { signInPerson } = await import('@/lib/auth/person');
    const db = await getDb();
    expect(await signInPerson(db, { profile: profile({ oid: 'oid-b', email: 'B.Durand@exemple.fr' }), role: 'Salarié', groupSites: [], today: TODAY, emailDomains: DOMAINS }))
      .toMatchObject({ ok: false, motif: 'non-autorise' });
    expect(await signInPerson(db, { profile: profile({ oid: 'oid-l', email: 'l.parti@exemple.fr' }), role: 'Salarié', groupSites: [], today: TODAY, emailDomains: DOMAINS }))
      .toMatchObject({ ok: false, motif: 'non-autorise' });
    const [pl] = await db.select().from(t.people).where(eq(t.people.id, 'pl'));
    expect(pl.entraObjectId).toBeNull();
  });

  it('première connexion sans adresse de confiance (hors domaine, sans adresse) : refus, aucune fiche créée', async () => {
    const { signInPerson } = await import('@/lib/auth/person');
    const db = await getDb();
    const count = async () => (await db.select({ id: t.people.id }).from(t.people)).length;
    const before = await count();
    expect(await signInPerson(db, { profile: profile({ oid: 'oid-h', name: 'P. Durand', email: 'p.durand@prestataire.example' }), role: 'Chef de projet', groupSites: ['ville-b'], today: TODAY, emailDomains: DOMAINS }))
      .toMatchObject({ ok: false, motif: 'adresse', reason: expect.stringMatching(/domaine hors de VIGIE_EMAIL_DOMAINS/) });
    expect(await signInPerson(db, { profile: profile({ oid: 'oid-s', name: 'Sous Domaine', email: 's.d@filiale.exemple.fr' }), role: 'Salarié', groupSites: ['ville-b'], today: TODAY, emailDomains: DOMAINS }))
      .toMatchObject({ ok: false, motif: 'adresse' });
    // Direction sans adresse : refusée aussi (une adresse non vérifiée ne devient jamais la clé d'une fiche).
    expect(await signInPerson(db, { profile: profile({ oid: 'oid-d0', name: 'D. Sans', email: null }), role: 'Direction', groupSites: [], today: TODAY, emailDomains: DOMAINS }))
      .toMatchObject({ ok: false, motif: 'adresse', reason: expect.stringMatching(/sans adresse/) });
    expect(await count()).toBe(before);
    expect(await db.select().from(t.people).where(eq(t.people.entraObjectId, 'oid-h'))).toEqual([]);
  });

  it('création : identifiant généré, adresse vérifiée, site = premier site autorisé actif ; homonyme distinct', async () => {
    const { signInPerson } = await import('@/lib/auth/person');
    const db = await getDb();
    const sal = await signInPerson(db, { profile: profile({ oid: 'oid-n', name: 'A. Dupont', email: 'Nouveau@exemple.fr' }), role: 'Salarié', groupSites: ['ville-b'], today: TODAY, emailDomains: DOMAINS });
    expect(sal).toMatchObject({ ok: true, created: true, siteIds: ['ville-b'] });
    const dir = await signInPerson(db, { profile: profile({ oid: 'oid-d', name: 'D. Martin', email: 'd.martin@exemple.fr' }), role: 'Direction', groupSites: [], today: TODAY, emailDomains: DOMAINS });
    expect(dir).toMatchObject({ ok: true, created: true, siteIds: null });
    const rows = await db.select().from(t.people).where(eq(t.people.name, 'A. Dupont'));
    expect(rows).toHaveLength(2);
    const created = rows.find((p) => p.entraObjectId === 'oid-n')!;
    expect(created).toMatchObject({ siteId: 'ville-b', email: 'nouveau@exemple.fr', lastRole: 'Salarié', sort: 3 });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    const [d] = await db.select().from(t.people).where(eq(t.people.entraObjectId, 'oid-d'));
    expect(d).toMatchObject({ siteId: 'ville-a', email: 'd.martin@exemple.fr' });
  });
});

describe('session Entra ID', () => {
  it('cookie chiffré → session : rôle, fiche, périmètre (rattachement + groupes), pas de « Tous les sites »', async () => {
    const { sealSession } = await import('@/lib/auth/cookie');
    const { getSession } = await import('@/lib/session');
    const now = Math.floor(Date.now() / 1000);
    cookieJar.set('__Host-vigie_session', await sealSession({ pid: 'pa', role: 'Salarié', sites: ['ville-b'], oid: 'oid-a', auth: now, seen: now }, SECRET));
    const s = await getSession();
    expect(s).toMatchObject({ role: 'Salarié', demo: false, site: { id: 'ville-a' }, allowedSiteIds: ['ville-b', 'ville-a'] });
    expect(s.user.id).toBe('pa');
    expect(s.siteOptions.map((o) => o.id)).toEqual(['ville-a', 'ville-b']);
    cookieJar.set('vigie_site', 'all');
    expect((await getSession()).site.id).toBe('ville-a');
    cookieJar.set('vigie_site', 'ville-b');
    expect((await getSession()).site.id).toBe('ville-b');
    const { requireInSite } = await import('@/lib/guard');
    expect(await requireInSite('ville-c')).toMatch(/périmètre/);
    expect(await requireInSite('ville-b')).toBeNull();
    // Cookie de rôle de démonstration : sans effet hors démonstration.
    cookieJar.set('vigie_role', 'Direction');
    expect((await getSession()).role).toBe('Salarié');
    cookieJar.clear();
  });

  it('sélecteur de rôle de démonstration (setRole) : sans effet hors démonstration', async () => {
    const { setRole } = await import('@/app/actions');
    cookieJar.clear();
    await expect(setRole('Direction')).resolves.toBeUndefined();
    expect(cookieJar.has('vigie_role')).toBe(false);
  });

  it('sans cookie, cookie falsifié ou fiche supprimée : connexion requise ou accès refusé', async () => {
    const { getSession } = await import('@/lib/session');
    const { sealSession } = await import('@/lib/auth/cookie');
    await expect(getSession()).rejects.toThrow('NEXT_REDIRECT:/auth/connexion');
    cookieJar.set('__Host-vigie_session', 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..AAAA.BBBB.CCCC');
    await expect(getSession()).rejects.toThrow('NEXT_REDIRECT:/auth/connexion');
    const now = Math.floor(Date.now() / 1000);
    cookieJar.set('__Host-vigie_session', await sealSession({ pid: 'disparu', role: 'Salarié', sites: [], oid: 'o', auth: now, seen: now }, SECRET));
    await expect(getSession()).rejects.toThrow('NEXT_REDIRECT:/auth/acces?motif=non-autorise');
    cookieJar.set('__Host-vigie_session', await sealSession({ pid: 'pl', role: 'Salarié', sites: [], oid: 'o', auth: now, seen: now }, SECRET));
    await expect(getSession()).rejects.toThrow('NEXT_REDIRECT:/auth/acces?motif=non-autorise');
    cookieJar.clear();
  });
});

describe('proxy', () => {
  const req = (path: string, init: { host?: string; method?: string; headers?: Record<string, string>; cookie?: string } = {}) =>
    new NextRequest(`https://vigie.exemple.fr${path}`, {
      method: init.method ?? 'GET',
      headers: { host: init.host ?? 'vigie.exemple.fr', ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
    });

  it('hôte ou origine inconnus refusés', async () => {
    const { proxy } = await import('@/proxy');
    expect((await proxy(req('/', { host: 'attaquant.example' }))).status).toBe(400);
    expect((await proxy(req('/', { headers: { 'x-forwarded-host': 'attaquant.example' } }))).status).toBe(400);
    expect((await proxy(req('/', { host: 'localhost:3200' }))).status).toBe(400);
    expect((await proxy(req('/api/sante', { host: 'localhost:3000' }))).status).not.toBe(400);
    expect((await proxy(req('/', { method: 'POST', headers: { origin: 'https://attaquant.example' } }))).status).toBe(403);
  });

  it('sans session : connexion (pages), 401 (server actions) ; routes publiques ouvertes', async () => {
    const { proxy } = await import('@/proxy');
    const r = await proxy(req('/evenements?x=1&_rsc=abc'));
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe('https://vigie.exemple.fr/auth/connexion?retour=%2Fevenements%3Fx%3D1');
    expect((await proxy(req('/', { method: 'POST', headers: { origin: 'https://vigie.exemple.fr' } }))).status).toBe(401);
    for (const open of ['/auth/acces?motif=echec', '/auth/retour?code=x', '/signaler?jeton=jeton-de-poste-0123456789']) {
      expect((await proxy(req(open))).headers.get('x-middleware-next')).toBe('1');
    }
    expect((await proxy(req('/signaler'))).status).toBe(307);
  });

  it('session valide : CSP à nonce, HSTS, renouvellement après 5 min', async () => {
    const { proxy } = await import('@/proxy');
    const { sealSession } = await import('@/lib/auth/cookie');
    const now = Math.floor(Date.now() / 1000);
    const fresh = await sealSession({ pid: 'pa', role: 'Salarié', sites: [], oid: 'o', auth: now - 60, seen: now - 60 }, SECRET);
    const r = await proxy(req('/evenements', { cookie: `__Host-vigie_session=${fresh}` }));
    expect(r.headers.get('x-middleware-next')).toBe('1');
    expect(r.headers.get('content-security-policy')).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(r.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(r.cookies.get('__Host-vigie_session')).toBeUndefined();
    const idle = await sealSession({ pid: 'pa', role: 'Salarié', sites: [], oid: 'o', auth: now - 3600, seen: now - 600 }, SECRET);
    const renewed = (await proxy(req('/evenements', { cookie: `__Host-vigie_session=${idle}` }))).cookies.get('__Host-vigie_session');
    expect(renewed).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect(renewed?.value).not.toBe(idle);
    // Redirection de rôle (SEC-14) : la session y est renouvelée aussi.
    const redirected = await proxy(req('/', { cookie: `__Host-vigie_session=${idle}` }));
    expect(redirected.status).toBe(307);
    expect(redirected.cookies.get('__Host-vigie_session')?.value).toBeTruthy();
  });

  it('rôle de la session (SEC-14) : écran fermé → accueil du rôle avant le rendu ; aperçu mobile introuvable (404)', async () => {
    const { proxy } = await import('@/proxy');
    const { sealSession } = await import('@/lib/auth/cookie');
    const now = Math.floor(Date.now() / 1000);
    const as = async (role: Role, pid = 'pa') => `__Host-vigie_session=${await sealSession({ pid, role, sites: [], oid: 'o', auth: now - 60, seen: now - 60 }, SECRET)}`;
    const salarie = await as('Salarié');

    const home = await proxy(req('/', { cookie: salarie }));
    expect(home.status).toBe(307);
    expect(home.headers.get('location')).toBe('https://vigie.exemple.fr/evenements');
    expect(home.headers.get('content-security-policy')).toBe(REFUSAL_CSP);
    expect(home.headers.get('strict-transport-security')).toBe('max-age=31536000');
    expect(home.headers.get('cache-control')).toBe('no-store');

    const mobile = await proxy(req('/apercu-mobile', { cookie: salarie }));
    expect(mobile.headers.get('x-middleware-rewrite')).toMatch(/\/_introuvable$/);
    expect(mobile.headers.get('content-security-policy')).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(mobile.headers.get('x-middleware-request-x-nonce')).toBeTruthy();

    const posts = await proxy(req('/signaler/postes', { cookie: salarie }));
    expect([posts.status, posts.headers.get('location')]).toEqual([307, 'https://vigie.exemple.fr/signaler']);
    // Server action : jamais redirigée par le proxy (contrôles de la server action).
    expect((await proxy(req('/', { method: 'POST', cookie: salarie, headers: { origin: 'https://vigie.exemple.fr' } }))).headers.get('x-middleware-next')).toBe('1');

    const chef = await as('Chef de service');
    // Chemin normalisé avant la décision (« /veille/../habilitations » → /habilitations, ouvert au chef de service).
    expect((await proxy(req('/veille/../habilitations', { cookie: chef }))).headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(req('/audits', { cookie: chef }))).headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(req('/environnement', { cookie: chef }))).headers.get('location')).toBe('https://vigie.exemple.fr/');
    expect((await proxy(req('/environnement/registre', { cookie: chef }))).headers.get('x-middleware-next')).toBe('1');

    const animateur = await as('Animateur QHSE');
    for (const p of ['/', '/veille', '/audits', '/environnement', '/signaler/postes']) {
      expect((await proxy(req(p, { cookie: animateur }))).headers.get('x-middleware-next'), p).toBe('1');
    }
    expect((await proxy(req('/apercu-mobile', { cookie: animateur }))).headers.get('x-middleware-rewrite')).toMatch(/\/_introuvable$/);
  });
});
