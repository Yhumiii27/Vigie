import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cookieJar } from '../next-mocks';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import { NextRequest, type NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDb, schema as t } from '@/db';
import { FOREIGN_CONTRACTS } from '@/db/foreign';
import { resetConfig } from '@/lib/env';
import { forgetClavisAccess } from '@/lib/auth/clavis-access';
import { refreshSharedReferences } from '@/server/foreign-sync';

// Connexion par Clavis, droits lus dans la base (décision du propriétaire du 23/11/2026 ; VIGIE_ACCESS_FROM_CLAVIS=on) :
// rôle de clavis.pub_acces à la connexion (les rôles du jeton ne sont pas lus), accès fermé ou absent refusé, rôle changé
// appliqué pendant la session après VIGIE_ACCESS_FROM_CLAVIS_SECONDS, accès fermé en cours de session = refus, vue illisible
// = refus ; contrôle du tid avec un émetteur remplacé ; variable absente = rôles du jeton, comme avant. Fournisseur OIDC
// factice (scripts/oidc-mock.mjs) à la place de Clavis (même forme : oid, tid, email, xms_edov) ; vue clavis.pub_acces
// créée par le test lui-même (installClavisView), de la forme du contrat, dans la base de test du fichier (PGlite en
// mémoire, ou base PostgreSQL créée pour ce fichier par test/setup-postgres.ts) — jamais par les substituts de
// src/db/foreign-substitutes.ts, qui ne s'installent pas sur PostgreSQL hors démonstration.

const APP = 'http://localhost:3292';
const SECRET = 'secret-de-session-de-la-connexion-par-clavis-0123';
const ROOT = path.resolve(__dirname, '../..');
const ENV = ['VIGIE_PUBLIC_URL', 'VIGIE_SESSION_SECRET', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'ENTRA_ISSUER',
  'VIGIE_SITE_GROUPS', 'VIGIE_EMAIL_DOMAINS', 'VIGIE_ACCESS_FROM_CLAVIS', 'VIGIE_ACCESS_FROM_CLAVIS_SECONDS'];

let mock: ChildProcess | null = null;
let issuer = '';

/** objectId du compte factice (même dérivation que scripts/oidc-mock.mjs) = personne_id de Clavis. */
const oidOf = (key: string) => {
  const h = createHash('sha256').update(`oid:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

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

const exec = async (q: string) => (await getDb()).execute(sql.raw(q));
const ACCESS = 'clavis.essai_acces';

/** Schéma clavis de l'essai : table et vue pub_acces aux colonnes, types et ordre du contrat (FOREIGN_CONTRACTS.access). */
async function installClavisView() {
  const cols = FOREIGN_CONTRACTS.access.columns;
  await exec('drop schema if exists clavis cascade');
  await exec('create schema clavis');
  await exec(`create table ${ACCESS} (${cols.map(([n, type]) => `"${n}" ${type}`).join(', ')})`);
  await exec(`create view clavis.pub_acces as select ${cols.map(([n]) => `"${n}"`).join(', ')} from ${ACCESS}`);
}

/** Ligne de clavis.pub_acces pour Vigie (remplace celle de la personne). */
async function grant(key: string, role: string | null, ouvert = true) {
  await exec(`delete from ${ACCESS} where personne_id = '${oidOf(key)}'`);
  await exec(`insert into ${ACCESS} (personne_id, application, autorise, niveau, domaine, role, ouvert, maj_le)
    values ('${oidOf(key)}', 'vigie', ${ouvert}, 'contributor', null, ${role ? `'${role}'` : 'null'}, ${ouvert}, now())`);
}

function useEnv(extra: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  resetConfig();
  forgetClavisAccess();
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
  // Émetteur remplacé (comme Clavis) sans ENTRA_TENANT_ID : configuration complète.
  Object.assign(process.env, {
    VIGIE_DATA_DIR: 'memory://', VIGIE_PUBLIC_URL: APP, VIGIE_SESSION_SECRET: SECRET,
    ENTRA_CLIENT_ID: 'vigie', ENTRA_CLIENT_SECRET: 'secret-de-test', ENTRA_ISSUER: issuer,
    VIGIE_SITE_GROUPS: 'grp-site_a:site_a,grp-site_b:site_b', VIGIE_EMAIL_DOMAINS: 'epc2i.example',
    VIGIE_ACCESS_FROM_CLAVIS: 'on',
  });
  delete process.env.ENTRA_TENANT_ID;
  resetConfig();
  await closeDb();
  const db = await getDb();
  await db.insert(t.sites).values([{ id: 'site_a', label: 'Site A', sort: 1 }, { id: 'site_b', label: 'Site B', sort: 2 }]);
  await db.insert(t.people).values([
    { id: 'tnguyen', name: '[T. Nguyen]', email: 't.nguyen@epc2i.example', siteId: 'site_a', sort: 0 },
    { id: 'clefevre', name: '[C. Lefèvre]', email: 'c.lefevre@epc2i.example', siteId: 'site_a', sort: 1 },
    { id: 'hmarchand', name: '[H. Marchand]', email: 'h.marchand@epc2i.example', siteId: 'site_a', sort: 2 },
  ]);
  await installClavisView();
});

afterAll(async () => {
  mock?.kill();
  vi.restoreAllMocks();
  for (const k of ENV) delete process.env[k];
  resetConfig();
  forgetClavisAccess();
  cookieJar.clear();
  await closeDb();
});

const cookieHeader = (cookies: { name: string; value: string }[]) => cookies.map((c) => `${c.name}=${c.value}`).join('; ');

/** Parcours complet pour un compte du fournisseur factice : réponse de /auth/retour. */
async function login(user: string): Promise<NextResponse> {
  const { GET: start } = await import('@/app/auth/connexion/route');
  const res = await start(new NextRequest(`${APP}/auth/connexion?retour=%2F`));
  const tx = res.cookies.getAll().filter((c) => c.name.startsWith('vigie_oidc_'));
  const authorize = new URL(res.headers.get('location')!);
  authorize.searchParams.set('login_hint', user);
  const back = await fetch(authorize, { redirect: 'manual' });
  expect(back.status).toBe(302);
  const { GET } = await import('@/app/auth/retour/route');
  return GET(new NextRequest(back.headers.get('location')!, { headers: { cookie: cookieHeader(tx) } }));
}

async function sessionOf(res: NextResponse) {
  const { openSession } = await import('@/lib/auth/cookie');
  return openSession(res.cookies.get('vigie_session')?.value, SECRET);
}

/** Session de Vigie pour le cookie de `res` : getSession(), ou l'adresse de refus. */
async function pageSession(res: NextResponse) {
  cookieJar.clear();
  cookieJar.set('vigie_session', res.cookies.get('vigie_session')!.value);
  const { getSession } = await import('@/lib/session');
  try {
    return await getSession();
  } catch (err) {
    return { denied: (err as Error).message.replace('NEXT_REDIRECT:', '') };
  }
}

describe('connexion par Clavis (VIGIE_ACCESS_FROM_CLAVIS=on)', () => {
  it('rôle lu dans clavis.pub_acces, pas dans le jeton : Salarié du jeton devenu animateur QHSE (tous les sites)', async () => {
    await grant('salarie', 'Vigie.AnimateurQHSE');
    const res = await login('salarie');
    expect(res.headers.get('location')).toBe(`${APP}/`);
    expect(await sessionOf(res)).toMatchObject({ pid: 'tnguyen', role: 'Animateur QHSE', sites: null });
    const [p] = await (await getDb()).select().from(t.people).where(eq(t.people.id, 'tnguyen'));
    expect(p.lastRole).toBe('Animateur QHSE');
    // Compte sans aucun rôle applicatif dans le jeton : ouvert par Clavis (fiche créée à la première connexion).
    await grant('sansrole', 'Vigie.ChefProjet');
    expect(await sessionOf(await login('sansrole'))).toMatchObject({ role: 'Chef de projet' });
  });

  it('accès fermé, rôle absent ou inconnu, aucune ligne : « Accès non autorisé », aucune session', async () => {
    await grant('animateur', 'Vigie.AnimateurQHSE', false);
    await grant('chefservice', null);
    await grant('essais', 'Keystone.admin');
    for (const user of ['animateur', 'chefservice', 'essais', 'direction']) {
      const res = await login(user);
      expect(res.headers.get('location'), user).toBe(`${APP}/auth/acces?motif=non-autorise`);
      expect(res.cookies.get('vigie_session'), user).toBeUndefined();
    }
  });

  it('pendant la session : rôle changé appliqué après le délai, accès fermé = refus à la page suivante', async () => {
    await grant('salarie', 'Vigie.Salarie');
    const res = await login('salarie');
    expect(await sessionOf(res)).toMatchObject({ role: 'Salarié', sites: ['site_b', 'site_a'] });
    expect(await pageSession(res)).toMatchObject({ role: 'Salarié', allowedSiteIds: ['site_b', 'site_a'] });

    await grant('salarie', 'Vigie.Direction');
    // Dans le délai (60 s) : la lecture de la connexion sert encore.
    expect(await pageSession(res)).toMatchObject({ role: 'Salarié' });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    try {
      // Rôle changé : la session prend le rôle de Clavis et son périmètre (direction : tous les sites).
      expect(await pageSession(res)).toMatchObject({ role: 'Direction', allowedSiteIds: null });
      expect((await pageSession(res) as { siteOptions: { id: string }[] }).siteOptions.map((o) => o.id)).toContain('all');

      // Retour à un rôle d'un site : le site de rattachement et les sites accordés à la connexion.
      await grant('salarie', 'Vigie.ChefService');
      clock.mockReturnValue(now + 122_000);
      expect(await pageSession(res)).toMatchObject({ role: 'Chef de service', allowedSiteIds: ['site_b', 'site_a'] });

      // Accès fermé dans Clavis : refus à la page suivante (après le délai).
      await grant('salarie', 'Vigie.Salarie', false);
      clock.mockReturnValue(now + 183_000);
      expect(await pageSession(res)).toEqual({ denied: '/auth/acces?motif=non-autorise' });
      await exec(`delete from ${ACCESS} where personne_id = '${oidOf('salarie')}'`);
      clock.mockReturnValue(now + 244_000);
      expect(await pageSession(res)).toEqual({ denied: '/auth/acces?motif=non-autorise' });
    } finally {
      clock.mockRestore();
    }
  });

  it('proxy : la redirection selon le rôle du cookie est laissée à la page (rôle peut-être changé dans Clavis)', async () => {
    await grant('salarie', 'Vigie.Salarie');
    const res = await login('salarie');
    const { proxy } = await import('@/proxy');
    const cookie = `vigie_session=${res.cookies.get('vigie_session')!.value}`;
    const r = await proxy(new NextRequest(`${APP}/veille`, { headers: { host: 'localhost:3292', cookie } }));
    expect(r.headers.get('x-middleware-next')).toBe('1');
    // Variable absente : redirection avant le rendu, comme avant.
    useEnv({ VIGIE_ACCESS_FROM_CLAVIS: undefined });
    try {
      const closed = await proxy(new NextRequest(`${APP}/veille`, { headers: { host: 'localhost:3292', cookie } }));
      expect(closed.status).toBe(307);
    } finally {
      useEnv({ VIGIE_ACCESS_FROM_CLAVIS: 'on' });
    }
  });

  it('ENTRA_TENANT_ID renseignée avec un émetteur remplacé : tid du jeton contrôlé', async () => {
    await grant('salarie', 'Vigie.Salarie');
    useEnv({ ENTRA_TENANT_ID: 'autre-annuaire' });
    try {
      expect((await login('salarie')).headers.get('location')).toBe(`${APP}/auth/acces?motif=echec`);
      useEnv({ ENTRA_TENANT_ID: 'VIGIE-TEST' });
      expect(await sessionOf(await login('salarie'))).toMatchObject({ role: 'Salarié' });
    } finally {
      useEnv({ ENTRA_TENANT_ID: undefined });
    }
  });

  it('variable absente : rôles du jeton, Clavis jamais lu (accès fermé dans Clavis sans effet)', async () => {
    await grant('animateur', 'Vigie.Salarie', false);
    useEnv({ VIGIE_ACCESS_FROM_CLAVIS: undefined });
    try {
      const res = await login('animateur');
      expect(await sessionOf(res)).toMatchObject({ pid: 'clefevre', role: 'Animateur QHSE', sites: null });
      expect(await pageSession(res)).toMatchObject({ role: 'Animateur QHSE' });
      expect((await login('sansrole')).headers.get('location')).toBe(`${APP}/auth/acces?motif=non-autorise`);
    } finally {
      useEnv({ VIGIE_ACCESS_FROM_CLAVIS: 'on' });
    }
  });

  it('vue illisible : connexion refusée et session refusée ; l’onglet « Connecteurs » la signale', async () => {
    await grant('salarie', 'Vigie.Salarie');
    const res = await login('salarie');
    expect(await sessionOf(res)).toMatchObject({ role: 'Salarié' });
    expect((await refreshSharedReferences(await getDb(), { only: ['access'] }))[0]).toMatchObject({ source: 'access', status: 'ok', read: 5 });

    await exec('drop view clavis.pub_acces');
    forgetClavisAccess();
    expect((await login('salarie')).headers.get('location')).toBe(`${APP}/auth/acces?motif=echec`);
    expect(await pageSession(res)).toEqual({ denied: '/auth/acces?motif=echec' });
    expect((await refreshSharedReferences(await getDb(), { only: ['access'] }))[0]).toMatchObject({ source: 'access', status: 'unavailable' });

    // Vue revenue : un échec n'est jamais gardé, l'accès se rouvre à la requête suivante.
    await installClavisView();
    await grant('salarie', 'Vigie.Salarie');
    expect(await pageSession(res)).toMatchObject({ role: 'Salarié' });
  });
});
