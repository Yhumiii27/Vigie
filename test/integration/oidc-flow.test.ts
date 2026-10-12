import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieJar } from '../next-mocks';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { NextRequest, type NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema as t } from '@/db';
import { resetConfig } from '@/lib/env';

// Connexion Microsoft Entra ID de bout en bout (SEC-01, SEC-02, SEC-03), contre le fournisseur OIDC factice
// (scripts/oidc-mock.mjs, lancé par le test) : /auth/connexion → page d'autorisation → /auth/retour (code, PKCE, state,
// nonce) → cookie de session ; refus (aucun rôle, utilisateur non affecté, fiche sortie, code rejoué, connexion
// expirée) ; /auth/deconnexion (fin de session Microsoft, navigation venue d'un autre site sans effet).

const APP = 'http://localhost:3291';
const SECRET = 'secret-de-session-du-parcours-oidc-0123456789';
const ROOT = path.resolve(__dirname, '../..');

let mock: ChildProcess | null = null;
let issuer = '';

/** Port TCP libre sur 127.0.0.1. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  mock = spawn(process.execPath, [path.join(ROOT, 'scripts/oidc-mock.mjs'), '--port', String(port), '--redirect', APP], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fournisseur OIDC factice : pas de démarrage en 15 s')), 15_000);
    mock!.stdout!.on('data', (chunk: Buffer) => { if (chunk.toString().includes('émetteur')) { clearTimeout(timer); resolve(); } });
    mock!.once('exit', (code) => { clearTimeout(timer); reject(new Error(`fournisseur OIDC factice arrêté (code ${code})`)); });
  });
  issuer = `http://127.0.0.1:${port}/vigie-test/v2.0`;

  delete process.env.VIGIE_DEMO;
  delete process.env.VIGIE_TODAY;
  Object.assign(process.env, {
    VIGIE_DATA_DIR: 'memory://', VIGIE_PUBLIC_URL: APP, VIGIE_SESSION_SECRET: SECRET,
    ENTRA_TENANT_ID: 'vigie-test', ENTRA_CLIENT_ID: 'vigie', ENTRA_CLIENT_SECRET: 'secret-de-test', ENTRA_ISSUER: issuer,
    VIGIE_SITE_GROUPS: 'grp-ville-a:ville-a,grp-ville-b:ville-b', VIGIE_EMAIL_DOMAINS: 'epc2i.example',
  });
  resetConfig();
  await closeDb();
  const db = await getDb();
  await db.insert(t.sites).values([{ id: 'ville-a', label: 'Site A', sort: 1 }, { id: 'ville-b', label: 'Site B', sort: 2 }]);
  // Comptes du fournisseur factice : [T. Nguyen] (Salarié, groupe B), [C. Lefèvre] (animateur), [Y. Lambert] (sorti),
  // [M. Girard] (fiche visée par le compte « nonverifie », à l'adresse non vérifiée).
  await db.insert(t.people).values([
    { id: 'tnguyen', name: '[T. Nguyen]', email: 't.nguyen@epc2i.example', siteId: 'ville-a', sort: 0 },
    { id: 'clefevre', name: '[C. Lefèvre]', email: 'c.lefevre@epc2i.example', siteId: 'ville-a', sort: 1 },
    { id: 'ylambert', name: '[Y. Lambert]', email: 'y.lambert@epc2i.example', siteId: 'ville-a', leftOn: '2026-01-31', sort: 2 },
    { id: 'mgirard', name: '[M. Girard]', email: 'm.girard@epc2i.example', siteId: 'ville-a', sort: 3 },
  ]);
});

afterAll(async () => {
  mock?.kill();
  for (const k of ['VIGIE_PUBLIC_URL', 'VIGIE_SESSION_SECRET', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'ENTRA_ISSUER', 'VIGIE_SITE_GROUPS', 'VIGIE_EMAIL_DOMAINS']) delete process.env[k];
  resetConfig();
  cookieJar.clear();
  await closeDb();
});

const cookieHeader = (cookies: { name: string; value: string }[]) => cookies.map((c) => `${c.name}=${c.value}`).join('; ');

/** /auth/connexion : redirection vers la page d'autorisation, cookie de transaction. */
async function startLogin(retour = '/') {
  const { GET } = await import('@/app/auth/connexion/route');
  const res = await GET(new NextRequest(`${APP}/auth/connexion?retour=${encodeURIComponent(retour)}`));
  const tx = res.cookies.getAll().filter((c) => c.name.startsWith('vigie_oidc_'));
  return { res, authorize: new URL(res.headers.get('location')!), tx };
}

/** Parcours complet pour un compte du fournisseur factice : réponse de /auth/retour. */
async function login(user: string, retour = '/'): Promise<{ res: NextResponse; callback: string; tx: string }> {
  const { authorize, tx } = await startLogin(retour);
  authorize.searchParams.set('login_hint', user);
  const back = await fetch(authorize, { redirect: 'manual' });
  expect(back.status).toBe(302);
  const callback = back.headers.get('location')!;
  const { GET } = await import('@/app/auth/retour/route');
  const res = await GET(new NextRequest(callback, { headers: { cookie: cookieHeader(tx) } }));
  return { res, callback, tx: cookieHeader(tx) };
}

async function sessionOf(res: NextResponse) {
  const { openSession } = await import('@/lib/auth/cookie');
  return openSession(res.cookies.get('vigie_session')?.value, SECRET);
}

describe('connexion Entra ID (fournisseur factice)', () => {
  it('/auth/connexion : code + PKCE S256, state et nonce, URI de retour tirée de VIGIE_PUBLIC_URL', async () => {
    const { res, authorize, tx } = await startLogin('/evenements?sel=EV-1');
    expect(res.status).toBe(303);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(issuer.replace('/v2.0', '/oauth2/v2.0/authorize'));
    const p = authorize.searchParams;
    expect([p.get('client_id'), p.get('response_type'), p.get('response_mode'), p.get('code_challenge_method')]).toEqual(['vigie', 'code', 'query', 'S256']);
    expect(p.get('redirect_uri')).toBe(`${APP}/auth/retour`);
    expect(p.get('scope')?.split(' ')).toEqual(['openid', 'profile', 'email']);
    expect(p.get('state')).toBeTruthy();
    expect(p.get('nonce')).toBeTruthy();
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 600 });
  });

  it('Salarié : fiche rapprochée par e-mail, périmètre = rattachement + groupe, retour à la page demandée', async () => {
    const { res } = await login('salarie', '/evenements?sel=EV-1');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${APP}/evenements?sel=EV-1`);
    const s = await sessionOf(res);
    expect(s).toMatchObject({ pid: 'tnguyen', role: 'Salarié', hint: 'hint-salarie' });
    expect([...s!.sites!].sort()).toEqual(['ville-a', 'ville-b']);
    expect(res.cookies.get('vigie_session')).toMatchObject({ httpOnly: true, secure: false, sameSite: 'lax', path: '/' });
    expect(res.cookies.getAll().filter((c) => c.name.startsWith('vigie_oidc_')).every((c) => c.value === '')).toBe(true);
    const [p] = await (await getDb()).select().from(t.people).where(eq(t.people.id, 'tnguyen'));
    expect(p.entraObjectId).toMatch(/^[0-9a-f-]{36}$/);
    expect(p).toMatchObject({ lastRole: 'Salarié' });

    // La session ouvre getSession() : rôle Entra, site de rattachement par défaut, pas de « Tous les sites ».
    cookieJar.clear();
    cookieJar.set('vigie_session', res.cookies.get('vigie_session')!.value);
    const { getSession } = await import('@/lib/session');
    const session = await getSession();
    expect(session).toMatchObject({ role: 'Salarié', demo: false, site: { id: 'ville-a' } });
    expect(session.siteOptions.map((o) => o.id)).toEqual(['ville-a', 'ville-b']);
    cookieJar.clear();
  });

  it('retour demandé hors de Vigie (« /.//hote » normalisé en « //hote ») : retour à l’accueil', async () => {
    for (const retour of ['/.//attaquant.example/phish', '/a/..//attaquant.example', '/%2e//attaquant.example']) {
      const { res } = await login('salarie', retour);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(`${APP}/`);
    }
  });

  it('animateur QHSE : tous les sites ; nouvel utilisateur : fiche créée sur le premier site accordé', async () => {
    expect(await sessionOf((await login('animateur')).res)).toMatchObject({ pid: 'clefevre', role: 'Animateur QHSE', sites: null });
    const created = await sessionOf((await login('nouveau')).res);
    expect(created).toMatchObject({ role: 'Salarié', sites: ['ville-b'] });
    const [p] = await (await getDb()).select().from(t.people).where(eq(t.people.id, created!.pid));
    expect(p).toMatchObject({ name: 'Nina Rousseau', email: 'n.rousseau@epc2i.example', siteId: 'ville-b', lastRole: 'Salarié' });
  });

  it('refus : aucun rôle Vigie, utilisateur non affecté (AADSTS50105), fiche sortie de l’effectif', async () => {
    for (const user of ['sansrole', 'parti']) {
      const { res } = await login(user);
      expect(res.headers.get('location')).toBe(`${APP}/auth/acces?motif=non-autorise`);
      expect(res.cookies.get('vigie_session')).toBeUndefined();
    }
    const { authorize, tx } = await startLogin();
    authorize.searchParams.set('login_hint', 'nonaffecte');
    const back = new URL((await fetch(authorize, { redirect: 'manual' })).headers.get('location')!);
    expect(back.searchParams.get('error')).toBe('access_denied');
    const { GET } = await import('@/app/auth/retour/route');
    const res = await GET(new NextRequest(back, { headers: { cookie: cookieHeader(tx) } }));
    expect(res.headers.get('location')).toBe(`${APP}/auth/acces?motif=non-autorise`);
  });

  it('première connexion sans adresse vérifiée de l’entreprise : « Compte Microsoft non rattaché », aucune fiche associée ni créée', async () => {
    const db = await getDb();
    const before = (await db.select({ id: t.people.id }).from(t.people)).length;
    // Compte à adresse non vérifiée (xms_edov faux) : la fiche [M. Girard] qui porte cette adresse n'est pas associée.
    // Domaine hors entreprise (adresse vérifiée de prestataire.example) : aucune fiche créée.
    for (const user of ['nonverifie', 'horsdomaine']) {
      const { res } = await login(user);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(`${APP}/auth/acces?motif=adresse`);
      expect(res.cookies.get('vigie_session')).toBeUndefined();
    }
    const [mg] = await db.select().from(t.people).where(eq(t.people.id, 'mgirard'));
    expect(mg).toMatchObject({ entraObjectId: null, lastLoginAt: null });
    expect((await db.select({ id: t.people.id }).from(t.people)).length).toBe(before);
    expect(await db.select().from(t.people).where(eq(t.people.name, 'P. Durand (prestataire)'))).toEqual([]);
  });

  it('échec : code rejoué, cookie de transaction absent ou d’une autre connexion', async () => {
    const { GET } = await import('@/app/auth/retour/route');
    const first = await login('salarie');
    expect(first.res.headers.get('location')).toBe(`${APP}/`);
    const replay = await GET(new NextRequest(first.callback, { headers: { cookie: first.tx } }));
    expect(replay.headers.get('location')).toBe(`${APP}/auth/acces?motif=echec`);

    const { authorize, tx } = await startLogin();
    authorize.searchParams.set('login_hint', 'salarie');
    const callback = (await fetch(authorize, { redirect: 'manual' })).headers.get('location')!;
    expect((await GET(new NextRequest(callback))).headers.get('location')).toBe(`${APP}/auth/acces?motif=echec`);
    const other = await startLogin();
    expect((await GET(new NextRequest(callback, { headers: { cookie: cookieHeader(other.tx) } }))).headers.get('location')).toBe(`${APP}/auth/acces?motif=echec`);
    // La transaction d'origine reste utilisable une fois (le code n'a pas été consommé par les refus ci-dessus).
    expect((await GET(new NextRequest(callback, { headers: { cookie: cookieHeader(tx) } }))).headers.get('location')).toBe(`${APP}/`);
  });
});

describe('déconnexion', () => {
  it('session effacée puis fin de session Microsoft (logout_hint), retour sur /auth/deconnecte', async () => {
    const session = (await login('salarie')).res.cookies.get('vigie_session')!.value;
    const { GET } = await import('@/app/auth/deconnexion/route');
    const res = await GET(new NextRequest(`${APP}/auth/deconnexion`, { headers: { cookie: `vigie_session=${session}`, 'sec-fetch-site': 'same-origin' } }));
    expect(res.status).toBe(303);
    const end = new URL(res.headers.get('location')!);
    expect(`${end.origin}${end.pathname}`).toBe(issuer.replace('/v2.0', '/oauth2/v2.0/logout'));
    expect(end.searchParams.get('logout_hint')).toBe('hint-salarie');
    expect(end.searchParams.get('post_logout_redirect_uri')).toBe(`${APP}/auth/deconnecte`);
    expect(res.cookies.get('vigie_session')).toMatchObject({ value: '', maxAge: 0 });
  });

  it('navigation venue d’un autre site : sans effet, retour à l’accueil', async () => {
    const session = (await login('salarie')).res.cookies.get('vigie_session')!.value;
    const { GET } = await import('@/app/auth/deconnexion/route');
    for (const site of ['cross-site', 'same-site']) {
      const res = await GET(new NextRequest(`${APP}/auth/deconnexion`, { headers: { cookie: `vigie_session=${session}`, 'sec-fetch-site': site } }));
      expect(res.headers.get('location')).toBe(`${APP}/`);
      expect(res.cookies.get('vigie_session')).toBeUndefined();
    }
  });
});
