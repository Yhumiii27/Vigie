import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema as t } from '@/db';
import type { AuthState } from '@/lib/auth';
import { resetConfig } from '@/lib/env';

// Signalement terrain hors démonstration (EVT-07) : formulaire sans compte ouvert par le jeton signé du QR code de poste
// (anonyme ou nom + entreprise déclarés, champ piège, limite de débit, photos contrôlées), révocation par « Régénérer
// le QR », signalement en son nom d'une personne connectée.

// En-têtes et cookies de la requête simulée (adresse du client modifiable par test).
const req = vi.hoisted(() => ({ headers: new Headers({ host: 'vigie.exemple.fr', 'x-forwarded-for': '203.0.113.9' }), cookies: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  headers: async () => req.headers,
  cookies: async () => ({
    get: (name: string) => (req.cookies.has(name) ? { name, value: req.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => { req.cookies.set(name, value); },
    delete: (name: string) => { req.cookies.delete(name); },
    has: (name: string) => req.cookies.has(name),
    getAll: () => [...req.cookies].map(([name, value]) => ({ name, value })),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {}, refresh: () => {} }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
const auth = vi.hoisted(() => ({ state: { status: 'anonymous' } as AuthState }));
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), getAuthState: async () => auth.state }));

const REPORT_SECRET = 'secret-des-qr-codes-des-tests-0123456789';
const uploads = mkdtempSync(path.join(tmpdir(), 'vigie-field-'));
let zoneA = 0, zoneB = 0;

const fd = (fields: Record<string, string>, photos: File[] = []) => {
  const f = new FormData();
  Object.entries(fields).forEach(([k, v]) => f.append(k, v));
  photos.forEach((p) => f.append('photos', p, p.name));
  return f;
};
const jpeg = (name = 'photo.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])], name, { type: 'image/jpeg' });
/** Jeton actuel du QR code d'une zone (celui de la planche imprimée). */
const tokenOf = async (zoneId: number) => {
  const { signReportToken } = await import('@/lib/report-token');
  const [z] = await (await getDb()).select().from(t.mapZones).where(eq(t.mapZones.id, zoneId));
  return signReportToken(REPORT_SECRET, { siteId: z.siteId, zoneId, version: z.qrVersion });
};

beforeAll(async () => {
  delete process.env.VIGIE_DEMO;
  delete process.env.VIGIE_TODAY;
  Object.assign(process.env, {
    VIGIE_DATA_DIR: 'memory://', VIGIE_UPLOAD_DIR: uploads, VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr', VIGIE_REPORT_SECRET: REPORT_SECRET,
  });
  resetConfig();
  await closeDb();
  const db = await getDb();
  await db.insert(t.sites).values([{ id: 'ville-a', label: 'Site A — atelier', sort: 1 }, { id: 'ville-b', label: 'Site B', sort: 2 }]);
  await db.insert(t.people).values([
    { id: 'qhse', name: 'C. Lefèvre', email: 'c.lefevre@exemple.fr', siteId: 'ville-a', sort: 0 },
    { id: 'sal', name: 'T. Nguyen', email: 't.nguyen@exemple.fr', siteId: 'ville-a', sort: 1 },
  ]);
  const zones = await db.insert(t.mapZones).values([
    { siteId: 'ville-a', name: 'Atelier montage', kind: 'atelier', polygon: [[0, 0], [1, 0], [1, 1]] },
    { siteId: 'ville-b', name: 'Zone d’essais', kind: 'essais', polygon: [[0, 0], [1, 0], [1, 1]] },
  ]).returning({ id: t.mapZones.id });
  [zoneA, zoneB] = zones.map((z) => z.id);
});
afterAll(async () => {
  for (const k of ['VIGIE_UPLOAD_DIR', 'VIGIE_PUBLIC_URL', 'VIGIE_REPORT_SECRET']) delete process.env[k];
  resetConfig();
  await closeDb();
  rmSync(uploads, { recursive: true, force: true });
});

describe('signalement sans compte (jeton de poste)', () => {
  it('QR codes : chemin avec jeton signé ; jeton vérifié (site, lieu)', async () => {
    const { loadReportPosts, resolveReportToken } = await import('@/lib/data/report-posts');
    auth.state = { status: 'authenticated', identity: { personId: 'qhse', role: 'Animateur QHSE', siteIds: null } };
    req.cookies.set('vigie_site', 'all');
    const posts = await loadReportPosts(null);
    req.cookies.delete('vigie_site');
    auth.state = { status: 'anonymous' };
    expect(posts.map((p) => p.path)).toEqual([`/signaler?jeton=${await tokenOf(zoneA)}`, `/signaler?jeton=${await tokenOf(zoneB)}`]);
    expect(posts.map((p) => [p.name, p.signed, p.version])).toEqual([['Atelier montage', true, 1], ['Zone d’essais', true, 1]]);
    expect(posts[0].path).toMatch(new RegExp(`^/signaler\\?jeton=${zoneA}\\.1\\.[A-Za-z0-9_-]{22}$`));
    expect(await resolveReportToken(await tokenOf(zoneA))).toEqual({
      status: 'ok', post: { zoneId: zoneA, name: 'Atelier montage', siteId: 'ville-a', siteLabel: 'Site A' },
    });
    // Origine des QR codes imprimés : VIGIE_PUBLIC_URL, jamais l'en-tête Host (PRD-07).
    const { publicOrigin } = await import('@/lib/public-url');
    req.headers = new Headers({ host: 'vigie.attaquant.example', 'x-forwarded-host': 'vigie.attaquant.example', 'x-forwarded-for': '203.0.113.9' });
    expect(await publicOrigin()).toBe('https://vigie.exemple.fr');
    expect(await resolveReportToken(`${zoneA}.1.AAAAAAAAAAAAAAAAAAAAAA`)).toEqual({ status: 'invalid' });
    expect(await resolveReportToken('999.1.AAAAAAAAAAAAAAAAAAAAAA')).toEqual({ status: 'invalid' });
  });

  it('nom et entreprise déclarés : événement « Déclaré » sur le site du poste, sans fiche', async () => {
    const { createReport } = await import('@/server/events');
    const jeton = await tokenOf(zoneA);
    const r = await createReport(fd({ type: 'SD', description: 'Carter de protection absent. Risque de happement.', jeton, declarant: 'Jean Martin', declarantCompany: 'Intérim Plus', gravity: 'Oui' }, [jpeg()]));
    expect(r).toMatchObject({ id: expect.stringMatching(/^EV-\d{4}-1$/) });
    const db = await getDb();
    const [ev] = await db.select().from(t.events).where(eq(t.events.id, r.id!));
    expect(ev).toMatchObject({
      siteId: 'ville-a', location: 'Atelier montage', declarant: 'Jean Martin', declarantCompany: 'Intérim Plus', declarantId: null,
      anonymous: false, reportedVia: 'poste', step: 0, severity: 3, title: 'Carter de protection absent.',
    });
    const files = await db.select().from(t.attachments).where(eq(t.attachments.entityId, r.id!));
    expect(files).toMatchObject([{ entityType: 'event', mimeType: 'image/jpeg', uploadedBy: null }]);
    const { eventView } = await import('@/lib/queries');
    expect(eventView(ev, new Map()).declarantLabel).toBe('Jean Martin (Intérim Plus) · déclaré sans compte');
  });

  it('anonyme : ni nom ni entreprise ; nom exigé sinon', async () => {
    const { createReport } = await import('@/server/events');
    const jeton = await tokenOf(zoneB);
    expect(await createReport(fd({ type: 'PA', description: 'Chute de charge évitée.', jeton }))).toEqual({ error: 'Indiquez votre nom, ou choisissez de rester anonyme.' });
    const r = await createReport(fd({ type: 'PA', description: 'Chute de charge évitée.', jeton, anonymous: '1', declarant: 'Ignoré', declarantCompany: 'Ignorée', location: 'Quai 2' }));
    const [ev] = await (await getDb()).select().from(t.events).where(eq(t.events.id, r.id!));
    expect(ev).toMatchObject({ siteId: 'ville-b', location: 'Quai 2', declarant: null, declarantCompany: null, declarantId: null, anonymous: true, reportedVia: 'poste' });
  });

  it('refus : sans jeton, jeton falsifié, champ piège, photo qui n’en est pas une, trop de photos', async () => {
    const { createReport } = await import('@/server/events');
    const db = await getDb();
    const before = (await db.select().from(t.events)).length;
    const base = { type: 'SD', description: 'Test.', anonymous: '1' };
    expect((await createReport(fd(base))).error).toMatch(/Scannez le QR code/);
    expect((await createReport(fd({ ...base, jeton: `${zoneA}.1.AAAAAAAAAAAAAAAAAAAAAA` }))).error).toMatch(/n'est pas reconnu/);
    expect(await createReport(fd({ ...base, jeton: await tokenOf(zoneA), site_web: 'http://spam.example' }))).toEqual({});
    const fake = new File(['<html><script>alert(1)</script>'], 'photo.jpg', { type: 'image/jpeg' });
    expect((await createReport(fd({ ...base, jeton: await tokenOf(zoneA) }, [fake]))).error).toBe("« photo.jpg » n'est pas une photo.");
    expect((await createReport(fd({ ...base, jeton: await tokenOf(zoneA) }, [jpeg('1.jpg'), jpeg('2.jpg'), jpeg('3.jpg')]))).error).toBe('2 photos au maximum.');
    expect((await db.select().from(t.events)).length).toBe(before);
  });

  it('« Régénérer le QR » : animateur seulement, motif obligatoire, ancien QR code révoqué', async () => {
    const { createReport, regenerateReportPost } = await import('@/server/events');
    const { resolveReportToken } = await import('@/lib/data/report-posts');
    const old = await tokenOf(zoneA);
    auth.state = { status: 'authenticated', identity: { personId: 'sal', role: 'Salarié', siteIds: [] } };
    expect(await regenerateReportPost({}, fd({ id: String(zoneA), reason: 'Étiquette arrachée' }))).toEqual({ error: 'Votre rôle ne permet pas cette modification.' });
    auth.state = { status: 'authenticated', identity: { personId: 'qhse', role: 'Animateur QHSE', siteIds: null } };
    expect(await regenerateReportPost({}, fd({ id: String(zoneA) }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await regenerateReportPost({}, fd({ id: String(zoneA), reason: 'Étiquette arrachée' }))).toEqual({ ok: true });
    const db = await getDb();
    const [log] = await db.select().from(t.changeLog).where(eq(t.changeLog.action, 'qr'));
    expect(log).toMatchObject({ entityType: 'site', entityId: 'ville-a', byId: 'qhse', reason: 'Étiquette arrachée' });
    expect(log.summary).toContain('« Atelier montage » régénéré (version 2)');

    auth.state = { status: 'anonymous' };
    expect(await resolveReportToken(old)).toEqual({ status: 'revoked' });
    expect((await createReport(fd({ type: 'SD', description: 'Test.', anonymous: '1', jeton: old }))).error).toMatch(/a été remplacé/);
    const fresh = await tokenOf(zoneA);
    expect(fresh).toMatch(new RegExp(`^${zoneA}\\.2\\.`));
    expect((await createReport(fd({ type: 'SD', description: 'Nouveau QR.', anonymous: '1', jeton: fresh }))).id).toBeTruthy();
  });

  it('limite de débit : une demande refusée ne consomme pas le quota du poste', async () => {
    const { createReport } = await import('@/server/events');
    const db = await getDb();
    const before = (await db.select().from(t.events)).length;
    const jeton = await tokenOf(zoneB);
    const counters = await db.select().from(t.reportRateLimits);
    // Fausses photos depuis une même adresse, bien au-delà des limites : refusées sans rien compter.
    req.headers = new Headers({ host: 'vigie.exemple.fr', 'x-forwarded-for': '198.51.100.20' });
    const fake = () => new File(['not an image'], 'p.jpg', { type: 'image/jpeg' });
    for (let i = 0; i < 25; i++) expect((await createReport(fd({ type: 'SD', description: 'Faux.', anonymous: '1', jeton }, [fake()]))).error).toMatch(/n'est pas une photo/);
    expect(await db.select().from(t.reportRateLimits)).toEqual(counters);
    req.headers = new Headers({ host: 'vigie.exemple.fr', 'x-forwarded-for': '192.0.2.10' });
    expect((await createReport(fd({ type: 'AT', description: 'Chute dans l’escalier.', anonymous: '1', jeton }))).id).toBeTruthy();
    expect((await db.select().from(t.events)).length).toBe(before + 1);
  });

  it('limite de débit : par poste et par client, puis plafond du poste (journalisé, signalé au responsable QHSE)', async () => {
    const { createReport } = await import('@/server/events');
    const { REPORT_LIMITS, hitReportLimit, postTotalValue, reportLimitKey } = await import('@/lib/report-guard');
    const { loadReportPostSignals } = await import('@/lib/data/report-posts');
    const db = await getDb();
    const count = async () => (await db.select().from(t.events)).length;
    const jeton = await tokenOf(zoneB);
    const send = (description: string) => createReport(fd({ type: 'SD', description, anonymous: '1', jeton }));
    // Un client (préfixe IPv6 /64) remplit son quota au poste B ; les adresses voisines du même /64 partagent le compteur.
    req.headers = new Headers({ host: 'vigie.exemple.fr', 'x-forwarded-for': '2001:db8:1:2::1' });
    for (let i = 1; i < REPORT_LIMITS.post.max; i++) expect((await send(`Rapport ${i}.`)).id).toBeTruthy();
    req.headers = new Headers({ host: 'vigie.exemple.fr', 'x-forwarded-for': '[2001:db8:1:2:abcd::9]:51234' });
    expect((await send('Dernier admis.')).id).toBeTruthy();
    const n = await count();
    expect((await send('Refusé.')).error).toMatch(/Trop de signalements/);
    expect(await count()).toBe(n);
    // Autre client, même poste : admis.
    req.headers = new Headers({ host: 'vigie.exemple.fr', 'x-forwarded-for': '192.0.2.11' });
    expect((await send('Autre client.')).id).toBeTruthy();

    // Plafond du poste (version actuelle du QR code), tous clients confondus : le dernier admis est journalisé, puis alerte.
    const [{ hits: used }] = await db.select().from(t.reportRateLimits)
      .where(eq(t.reportRateLimits.key, reportLimitKey('postTotal', postTotalValue(zoneB, 1), REPORT_SECRET)));
    expect(used).toBe(REPORT_LIMITS.post.max + 3);
    for (let i = used; i < REPORT_LIMITS.postTotal.max - 1; i++) await hitReportLimit('postTotal', postTotalValue(zoneB, 1), REPORT_SECRET);
    req.headers = new Headers({ host: 'vigie.exemple.fr', 'x-forwarded-for': '192.0.2.12' });
    expect((await send('Dernier sous le plafond.')).id).toBeTruthy();
    const [log] = await db.select().from(t.changeLog).where(eq(t.changeLog.action, 'report-limit'));
    expect(log).toMatchObject({ entityType: 'site', entityId: 'ville-b', byId: null });
    expect(log.summary).toContain('Poste « Zone d’essais » : plafond de 60 signalements');
    req.headers = new Headers({ host: 'vigie.exemple.fr', 'x-forwarded-for': '192.0.2.13' });
    const m = await count();
    expect((await send('Au-delà du plafond.')).error).toMatch(/Ce poste a reçu trop de signalements sans compte/);
    expect(await count()).toBe(m);
    expect((await createReport(fd({ type: 'SD', description: 'Autre poste.', anonymous: '1', jeton: await tokenOf(zoneA) }))).id).toBeTruthy();

    auth.state = { status: 'authenticated', identity: { personId: 'qhse', role: 'Animateur QHSE', siteIds: null } };
    req.cookies.set('vigie_site', 'all');
    const { todo } = await loadReportPostSignals();
    expect(todo).toMatchObject([{ kind: 'QR code de poste', tone: 'danger', href: '/signaler/postes?site=ville-b', key: `report-ceiling|${zoneB}|1` }]);
    expect(todo[0].title).toContain('Zone d’essais (Site B) — plafond de signalements sans compte atteint');
    // « Régénérer le QR » : nouvelle version, nouveau compteur, plus d'alerte.
    const { regenerateReportPost } = await import('@/server/events');
    expect(await regenerateReportPost({}, fd({ id: String(zoneB), reason: 'QR code diffusé hors du site' }))).toEqual({ ok: true });
    expect((await loadReportPostSignals()).todo).toEqual([]);
    req.cookies.delete('vigie_site');
    auth.state = { status: 'anonymous' };
    expect((await createReport(fd({ type: 'SD', description: 'Nouvelle étiquette.', anonymous: '1', jeton: await tokenOf(zoneB) }))).id).toBeTruthy();
  });

  it('limite de débit : par client (dernière entrée de X-Forwarded-For), adresses normalisées', async () => {
    const { createReport } = await import('@/server/events');
    const { REPORT_LIMITS, hitReportLimit } = await import('@/lib/report-guard');
    const db = await getDb();
    // La fenêtre de 198.51.100.1 se remplit ; sa forme IPv4 encapsulée ou avec un port partage le compteur.
    for (let i = 0; i < REPORT_LIMITS.ip.max; i++) await hitReportLimit('ip', '198.51.100.1', REPORT_SECRET);
    for (const xff of ['198.51.100.1', '::ffff:198.51.100.1', '198.51.100.1:51234', '192.0.2.44, 198.51.100.1']) {
      req.headers = new Headers({ host: 'vigie.exemple.fr', 'x-forwarded-for': xff });
      expect((await createReport(fd({ type: 'SD', description: 'Spam.', anonymous: '1', jeton: await tokenOf(zoneA) }))).error).toMatch(/Trop de signalements/);
    }
    // Une autre adresse (même premier saut falsifié) n'est pas bloquée.
    req.headers = new Headers({ host: 'vigie.exemple.fr', 'x-forwarded-for': '198.51.100.1, 192.0.2.44' });
    expect((await createReport(fd({ type: 'SD', description: 'Autre poste, autre adresse.', anonymous: '1', jeton: await tokenOf(zoneA) }))).id).toBeTruthy();
    // Aucune adresse en clair dans la base.
    const keys = (await db.select({ key: t.reportRateLimits.key }).from(t.reportRateLimits)).map((r) => r.key);
    expect(keys.every((k) => /^(ip|post|postTotal):[0-9a-f]{32}$/.test(k))).toBe(true);
  });
});

describe('signalement d’une personne connectée', () => {
  it('en son nom, sur le site du QR code (même hors périmètre), suivi dans « Mes signalements »', async () => {
    auth.state = { status: 'authenticated', identity: { personId: 'sal', role: 'Salarié', siteIds: [] } };
    const { createReport } = await import('@/server/events');
    const r = await createReport(fd({ type: 'RC', description: 'Fuite d’huile sous la presse.', jeton: await tokenOf(zoneB) }, [jpeg()]));
    const db = await getDb();
    const [ev] = await db.select().from(t.events).where(eq(t.events.id, r.id!));
    expect(ev).toMatchObject({ siteId: 'ville-b', location: 'Zone d’essais', declarant: 'T. Nguyen', declarantId: 'sal', declarantCompany: null, reportedVia: 'session' });
    const [file] = await db.select().from(t.attachments).where(eq(t.attachments.entityId, r.id!));
    expect(file.uploadedBy).toBe('sal');
    const { loadMyReports } = await import('@/lib/data/events');
    expect((await loadMyReports()).map((m) => m.id)).toContain(r.id);
    // Sans QR code : site de rattachement ; un ancien `siteId` hors périmètre est ignoré.
    const r2 = await createReport(fd({ type: 'SD', description: 'Sans QR code.', siteId: 'ville-b' }));
    const [ev2] = await db.select().from(t.events).where(eq(t.events.id, r2.id!));
    expect(ev2).toMatchObject({ siteId: 'ville-a', location: 'Lieu non précisé', reportedVia: 'session' });
    // Le champ piège ne concerne pas une personne connectée.
    expect((await createReport(fd({ type: 'SD', description: 'Avec piège.', site_web: 'x' }))).id).toBeTruthy();
  });
});
