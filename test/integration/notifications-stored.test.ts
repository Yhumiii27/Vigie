import { cookieJar } from '../next-mocks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadNotifications } from '@/lib/data/notifications';
import type { Role } from '@/lib/domain';
import { resetConfig } from '@/lib/env';
import type { VisibleTodo } from '@/lib/data/todo';
import { markAllRead, markNotificationsRead, openTodo } from '@/server/notifications';
import { notify } from '@/server/notify';
import { actAs, freshDemoDatabase } from '../helpers';

// Cloche (ACT-30, ACT-31) : notifications stockées de la personne connectée, état lu dans la ligne (read_at), ordre,
// ouverture (openTodo), « Tout marquer comme lu ». Les échéances calculées (loadVisibleTodo, flux C et écrans) sont
// remplacées par une liste maîtrisée : ce fichier ne teste que la cloche.

const todo = vi.hoisted(() => ({ items: [] as VisibleTodo[] }));
vi.mock('@/lib/data/todo', async () => {
  const { getDb: db, schema } = await import('@/db');
  const { asc: byOrder } = await import('drizzle-orm');
  return {
    loadVisibleTodo: async () => todo.items,
    loadTodo: async () => todo.items,
    loadSiteDirectory: async () => (await db()).select({ id: schema.sites.id, label: schema.sites.label, archivedAt: schema.sites.archivedAt }).from(schema.sites).orderBy(byOrder(schema.sites.sort)),
    shortSiteLabel: (label: string) => label.split(' — ')[0],
  };
});
vi.mock('@/lib/data/dashboard', () => ({ loadTodoPage: async () => ({ items: todo.items }) }));

freshDemoDatabase();

const due = (key: string, date: string, extra: Partial<VisibleTodo> = {}): VisibleTodo => ({
  key, date, kind: 'Échéance', tone: 'neutral', title: `Échéance ${key}`, who: '', siteId: 'ville-a', href: '/veille', source: 'watch', elsewhere: false, ...extra,
});

async function stored(personId: string) {
  const db = await getDb();
  return db.select().from(t.notifications).where(eq(t.notifications.personId, personId)).orderBy(asc(t.notifications.id));
}

/** Notification « Action confiée » écrite par notify() (contrat de la fondation), comme le ferait une server action. */
async function confiee(personId: string, actionId: string, byId = 'hmarchand') {
  const db = await getDb();
  const id = await db.transaction((tx) => notify(tx, {
    personId, type: 'action_confiee', entityType: 'action', entityId: actionId, title: `Action ${actionId} confiée par [H. Marchand] : essai`,
    href: `/actions?action=${actionId}`, byId,
  }));
  return id!;
}

async function redirectOf(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    const m = /^NEXT_REDIRECT:(.*)$/.exec((e as Error).message);
    if (!m) throw e;
    return m[1];
  }
}

describe('notifications stockées dans la cloche', () => {
  it('jeu de démonstration : non lues et lues des 7 derniers jours, type, auteur, clé « notification:<id> »', async () => {
    actAs('Animateur QHSE', 'ville-a');
    todo.items = [];
    const rows = await stored('clefevre');
    const list = await loadNotifications();
    const unread = rows.filter((r) => !r.readAt);
    expect(unread.length).toBeGreaterThan(0);
    for (const r of unread) expect(list.map((n) => n.key)).toContain(`notification:${r.id}`);
    const a215 = list.find((n) => n.key === `notification:${unread[0].id}`)!;
    expect(a215).toMatchObject({
      kind: 'Commentaire du responsable', family: 'action_commentaire', info: true, read: false, who: '[T. Nguyen]', tone: 'accent',
      href: '/actions?action=A-215', source: 'actions', urgent: false,
    });
    // Lues : seulement celles lues depuis le 02/10 (VIGIE_TODAY 09/10 − 7 j).
    const shownRead = list.filter((n) => n.info && n.read && n.family !== 'rappel');
    const recent = rows.filter((r) => r.readAt && r.readAt >= new Date('2026-10-01T22:00:00Z'));
    expect(shownRead.map((n) => n.key).sort()).toEqual(recent.map((r) => `notification:${r.id}`).sort());
    expect(rows.some((r) => r.readAt && r.readAt < new Date('2026-10-01T22:00:00Z'))).toBe(true); // lues plus anciennes : masquées
    // Aucune notification d'une autre personne.
    const others = (await getDb()).select({ id: t.notifications.id }).from(t.notifications);
    const mine = new Set(rows.map((r) => `notification:${r.id}`));
    expect(list.filter((n) => n.key.startsWith('notification:')).every((n) => mine.has(n.key))).toBe(true);
    expect((await others).length).toBeGreaterThan(rows.length);
  });

  it('notification écrite par notify() : listée non lue ; action d’un autre site : libellé du site, ouverture sur ce site', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const [b] = await (await getDb()).select({ id: t.actions.id }).from(t.actions).where(eq(t.actions.siteId, 'ville-b')).limit(1);
    const id = await confiee('clefevre', b.id);
    const item = (await loadNotifications()).find((n) => n.key === `notification:${id}`);
    expect(item).toMatchObject({ read: false, elsewhere: true, siteLabel: 'Site de [Ville B]', siteId: 'ville-b', kind: 'Action confiée', family: 'action_confiee' });
    actAs('Animateur QHSE', 'all');
    expect((await loadNotifications()).find((n) => n.key === `notification:${id}`)).toMatchObject({ elsewhere: false, siteLabel: undefined });

    actAs('Animateur QHSE', 'ville-a');
    expect(await redirectOf(openTodo(`notification:${id}`, { markRead: true }))).toBe(`/actions?action=${b.id}`);
    expect(cookieJar.get('vigie_site')).toBe('ville-b');
    expect((await stored('clefevre')).find((r) => r.id === id)!.readAt).toBeInstanceOf(Date);
    expect((await loadNotifications()).find((n) => n.key === `notification:${id}`)).toMatchObject({ read: true });
  });

  it('markNotificationsRead : seulement les notifications de la personne connectée ; date de lecture jamais déplacée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const mine = await confiee('clefevre', 'A-215');
    const theirs = await confiee('tnguyen', 'A-215');
    await markNotificationsRead([`notification:${mine}`, `notification:${theirs}`, 'notification:abc', 'notification:99999999999']);
    const readAt = (await stored('clefevre')).find((r) => r.id === mine)!.readAt;
    expect(readAt).toBeInstanceOf(Date);
    expect((await stored('tnguyen')).find((r) => r.id === theirs)!.readAt).toBeNull();
    // Rien dans notification_reads pour ces clés (support : la ligne elle-même).
    const reads = await (await getDb()).select().from(t.notificationReads).where(eq(t.notificationReads.personId, 'clefevre'));
    expect(reads.some((r) => r.itemKey.startsWith('notification:'))).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    await markNotificationsRead([`notification:${mine}`]);
    expect((await stored('clefevre')).find((r) => r.id === mine)!.readAt).toEqual(readAt);
  });

  it('openTodo : notification d’une autre personne ou clé inconnue → rien', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const theirs = await confiee('tnguyen', 'A-215');
    expect(await redirectOf(openTodo(`notification:${theirs}`, { markRead: true }))).toBeNull();
    expect(await redirectOf(openTodo('notification:0'))).toBeNull();
    expect((await stored('tnguyen')).find((r) => r.id === theirs)!.readAt).toBeNull();
    // Le responsable, lui, l'ouvre.
    actAs('Salarié', 'ville-a');
    expect(await redirectOf(openTodo(`notification:${theirs}`, { markRead: true }))).toBe('/actions?action=A-215');
    expect((await stored('tnguyen')).find((r) => r.id === theirs)!.readAt).toBeInstanceOf(Date);
  });

  it('openTodo : une échéance calculée reste ouverte et marquée lue dans notification_reads', async () => {
    actAs('Animateur QHSE', 'ville-a');
    todo.items = [due('veille|x', '2026-10-12')];
    expect(await redirectOf(openTodo('veille|x', { markRead: true }))).toBe('/veille');
    const reads = await (await getDb()).select().from(t.notificationReads)
      .where(and(eq(t.notificationReads.personId, 'clefevre'), eq(t.notificationReads.itemKey, 'veille|x')));
    expect(reads).toHaveLength(1);
    expect((await loadNotifications()).find((n) => n.key === 'veille|x')).toMatchObject({ read: true, family: 'todo', info: false });
    todo.items = [];
  });

  it('ordre : échéances urgentes, puis informations (plus récentes d’abord), puis autres échéances par date', async () => {
    actAs('Chef de service', 'ville-a');
    todo.items = [
      due('b', '2026-10-15'), due('a', '2026-10-10'), due('urgent', '2026-10-01', { overdue: true, tone: 'danger' }),
      due('loin', '2026-10-30'), // hors des 7 jours : absente
    ];
    const first = await confiee('sbenali', 'A-221');
    const second = await confiee('sbenali', 'A-221');
    const list = await loadNotifications();
    const keys = list.map((n) => n.key);
    expect(keys[0]).toBe('urgent');
    expect(keys.slice(-2)).toEqual(['a', 'b']);
    expect(keys).not.toContain('loin');
    const infos = list.filter((n) => n.info);
    expect(list.slice(1, 1 + infos.length).every((n) => n.info)).toBe(true);
    expect(keys.indexOf(`notification:${second}`)).toBeLessThan(keys.indexOf(`notification:${first}`));
    expect(infos.map((n) => n.date)).toEqual([...infos.map((n) => n.date)].sort().reverse());
    todo.items = [];
  });

  it('« Tout marquer comme lu » : notifications stockées (au-delà des 50 affichées), échéances et rappel', async () => {
    actAs('Chef de service', 'ville-a');
    const db = await getDb();
    for (let i = 0; i < 55; i++) await confiee('sbenali', 'A-221');
    todo.items = [due('veille|y', '2026-10-12')];
    const before = await loadNotifications();
    expect(before.filter((n) => n.key.startsWith('notification:') && !n.read)).toHaveLength(50);
    const reminder = before.find((n) => n.family === 'rappel');
    expect(reminder).toMatchObject({ key: 'rappel-actions|2026-W41', date: '2026-10-07', read: false });
    await markAllRead('notifications');
    expect(await db.select().from(t.notifications).where(and(eq(t.notifications.personId, 'sbenali'), isNull(t.notifications.readAt)))).toHaveLength(0);
    const after = await loadNotifications();
    expect(after.every((n) => n.read)).toBe(true);
    expect(after.find((n) => n.key === 'veille|y')).toMatchObject({ read: true });
    expect(after.some((n) => n.key === reminder!.key)).toBe(false);
    // Les notifications des autres personnes ne bougent pas.
    expect(await db.select().from(t.notifications).where(and(eq(t.notifications.personId, 'tnguyen'), isNull(t.notifications.readAt)))).not.toHaveLength(0);
    todo.items = [];
  });
});

/** Props de la cloche dans l'élément rendu par PageHeader (charge envoyée au navigateur). */
function bellItems(node: unknown): Record<string, unknown>[] | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) { const found = bellItems(child); if (found) return found; }
    return null;
  }
  const props = (node as { props?: { items?: Record<string, unknown>[]; children?: unknown } }).props;
  if (props?.items && Array.isArray(props.items)) return props.items;
  return bellItems(props?.children);
}

describe('Salarié : sa cloche seulement, sans responsables ni site dans la charge', () => {
  it('notifications de tnguyen seulement ; projection de PageHeader limitée aux champs affichés', async () => {
    actAs('Salarié', 'ville-a');
    todo.items = [due('evenement|z', '2026-10-12', { ownerIds: ['tnguyen'] })];
    const mine = new Set((await stored('tnguyen')).map((r) => `notification:${r.id}`));
    const list = await loadNotifications();
    expect(list.filter((n) => n.key.startsWith('notification:')).every((n) => mine.has(n.key))).toBe(true);
    expect(list.some((n) => n.family === 'action_confiee')).toBe(true);
    const { PageHeader } = await import('@/components/PageHeader');
    const items = bellItems(await PageHeader({ title: 'Essai', sub: '' }))!;
    expect(items.length).toBe(list.length);
    const allowed = ['key', 'date', 'kind', 'tone', 'title', 'who', 'href', 'urgent', 'read', 'elsewhere', 'siteLabel', 'family'];
    for (const item of items) for (const k of Object.keys(item)) expect(allowed, k).toContain(k);
    expect(JSON.stringify(items)).not.toMatch(/ownerIds|"siteId"/);
    todo.items = [];
  });
});

describe('lien d’une notification stockée : seulement vers une action que la personne peut lire', () => {
  it('ancien responsable (réaffectation) : la notification reste, sans lien ; openTodo → rien', async () => {
    actAs('Salarié', 'ville-a');
    const db = await getDb();
    const id = await confiee('tnguyen', 'A-215');
    expect((await loadNotifications()).find((n) => n.key === `notification:${id}`)).toMatchObject({ href: '/actions?action=A-215' });
    const [before] = await db.select({ pilotId: t.actions.pilotId }).from(t.actions).where(eq(t.actions.id, 'A-215'));
    await db.update(t.actions).set({ pilotId: 'sbenali' }).where(eq(t.actions.id, 'A-215'));
    try {
      const item = (await loadNotifications()).find((n) => n.key === `notification:${id}`);
      expect(item).toMatchObject({ read: false, title: expect.stringContaining('A-215') });
      expect(item!.href).toBeUndefined();
      expect(await redirectOf(openTodo(`notification:${id}`, { markRead: true }))).toBeNull();
      // Le QHSE garde le lien (plan de son périmètre).
      actAs('Animateur QHSE', 'ville-a');
      const qhse = await confiee('clefevre', 'A-215', 'tnguyen');
      expect((await loadNotifications()).find((n) => n.key === `notification:${qhse}`)).toMatchObject({ href: '/actions?action=A-215' });
    } finally {
      await db.update(t.actions).set({ pilotId: before.pilotId }).where(eq(t.actions.id, 'A-215'));
    }
  });
});

describe('session Entra ID de périmètre restreint', () => {
  const SECRET = 'secret-de-session-des-tests-cloche-0123456789';
  const ENTRA_ENV = {
    VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr', VIGIE_SESSION_SECRET: SECRET,
    ENTRA_TENANT_ID: 'tenant', ENTRA_CLIENT_ID: 'client', ENTRA_CLIENT_SECRET: 'secret',
  };
  const saved = { demo: process.env.VIGIE_DEMO, today: process.env.VIGIE_TODAY };
  beforeAll(() => {
    saved.demo = process.env.VIGIE_DEMO;
    saved.today = process.env.VIGIE_TODAY;
    delete process.env.VIGIE_DEMO;
    delete process.env.VIGIE_TODAY;
    Object.assign(process.env, ENTRA_ENV);
    resetConfig();
  });
  afterAll(() => {
    for (const k of Object.keys(ENTRA_ENV)) delete process.env[k];
    if (saved.demo !== undefined) process.env.VIGIE_DEMO = saved.demo;
    if (saved.today !== undefined) process.env.VIGIE_TODAY = saved.today;
    resetConfig();
  });

  async function actAsEntra(pid: string, role: Role, sites: string[] | null, site: string) {
    const { sealSession } = await import('@/lib/auth/cookie');
    const now = Math.floor(Date.now() / 1000);
    cookieJar.clear();
    cookieJar.set('__Host-vigie_session', await sealSession({ pid, role, sites, oid: `oid-${pid}`, auth: now, seen: now }, SECRET));
    cookieJar.set('vigie_site', site);
  }

  it('action dont il est responsable hors de son périmètre : lien gardé (D19), ouverte sans changer de site ; action d’autrui hors périmètre : sans lien', async () => {
    const db = await getDb();
    const [own] = await db.select({ id: t.actions.id, pilotId: t.actions.pilotId }).from(t.actions).where(eq(t.actions.siteId, 'ville-b')).limit(1);
    const [other] = await db.select({ id: t.actions.id }).from(t.actions)
      .where(and(eq(t.actions.siteId, 'ville-b'), eq(t.actions.pilotId, 'clefevre'))).limit(1);
    expect(other).toBeDefined();
    await db.update(t.actions).set({ pilotId: 'sbenali' }).where(eq(t.actions.id, own.id));
    try {
      await actAsEntra('sbenali', 'Chef de service', ['ville-a'], 'ville-a');
      const mine = await confiee('sbenali', own.id);
      const theirs = await confiee('sbenali', other.id);
      todo.items = [];
      const list = await loadNotifications();
      expect(list.find((n) => n.key === `notification:${mine}`)).toMatchObject({ elsewhere: true, siteId: 'ville-b', href: `/actions?action=${own.id}` });
      expect(list.find((n) => n.key === `notification:${theirs}`)!.href).toBeUndefined();
      // Site hors des choix : ouverte sans sélectionner ce site (setSite le refuserait).
      expect(await redirectOf(openTodo(`notification:${mine}`, { markRead: true }))).toBe(`/actions?action=${own.id}`);
      expect(cookieJar.get('vigie_site')).toBe('ville-a');
      expect((await stored('sbenali')).find((r) => r.id === mine)!.readAt).toBeInstanceOf(Date);
      expect(await redirectOf(openTodo(`notification:${theirs}`, { markRead: true }))).toBeNull();
      expect((await stored('sbenali')).find((r) => r.id === theirs)!.readAt).toBeNull();
    } finally {
      await db.update(t.actions).set({ pilotId: own.pilotId }).where(eq(t.actions.id, own.id));
    }
  });
});
