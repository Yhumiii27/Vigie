import { describe, expect, it, vi, beforeAll, afterEach } from 'vitest';
import { cookieJar } from '../next-mocks';
import { actAs, freshDemoDatabase } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { AuthState } from '@/lib/auth';
import type { Role } from '@/lib/domain';
import { loadCounters } from '@/lib/data/counters';
import { loadTodoPage } from '@/lib/data/dashboard';
import { loadNotifications } from '@/lib/data/notifications';
import { loadVisibleTodo } from '@/lib/data/todo';
import { openTodo } from '@/server/notifications';

// TDB-05 : échéances de la personne consolidées sur tous les sites de son périmètre (cloche, À faire, « Mes échéances »),
// badges d'écran limités au site sélectionné, ouverture d'une échéance d'un autre site (openTodo).

// Identité de la requête : démonstration (sélecteur de rôle), sauf périmètre restreint imposé par un test.
const auth = vi.hoisted(() => ({ state: null as AuthState | null }));
vi.mock('@/lib/auth', async (orig) => {
  const mod = await orig<typeof import('@/lib/auth')>();
  return { ...mod, getAuthState: async () => auth.state ?? mod.getAuthState() };
});

freshDemoDatabase();

const ID = 'A-T05';
const HREF = `/actions?action=${ID}`;
const find = async (id = ID) => (await loadVisibleTodo()).find((x) => x.title.startsWith(`${id} ·`));
/** Badge d'écran attendu : échéances du site sélectionné, avec lien, de cet écran. */
const screenCount = async (screen: string) =>
  (await loadVisibleTodo()).filter((x) => x.source === screen && !x.elsewhere && x.href).reduce((n, x) => n + (x.count ?? 1), 0);
const restricted = (personId: string, role: Role, siteIds: string[]) => {
  auth.state = { status: 'authenticated', identity: { personId, role, siteIds } };
};
const reads = async (personId: string) => {
  const db = await getDb();
  return db.select().from(t.notificationReads).where(eq(t.notificationReads.personId, personId));
};
const changeLogCount = async () => (await (await getDb()).select({ id: t.changeLog.id }).from(t.changeLog)).length;

beforeAll(async () => {
  const db = await getDb();
  const row = { openedOn: '2026-10-01', status: 'a_faire' as const, source: 'evenement' as const, originRef: 'EV-2026-128', pilotId: 'sbenali',
    priority: 'moyen_terme' as const, domain: 'securite' as const, problem: 'Zone de test non balisée.', verifyDueOn: '2026-11-30' };
  await db.insert(t.actions).values([
    { ...row, id: ID, detail: 'Baliser la zone de test hydraulique', siteId: 'ville-b', dueOn: '2026-10-12', initialDueOn: '2026-10-12' },
    // Site archivé (ville-c) : échéance du périmètre dont le site ne peut plus être sélectionné.
    { ...row, id: 'A-T06', detail: 'Remettre les clés du dépôt fermé', siteId: 'ville-c', dueOn: '2026-10-13', initialDueOn: '2026-10-13' },
  ]);
});

afterEach(() => { auth.state = null; });

describe('échéances de la personne sur les autres sites (TDB-05)', () => {
  it('Chef de service sur le site A : son action du site B est visible, signalée et ouvrable', async () => {
    actAs('Chef de service', 'ville-a');
    const item = await find();
    expect(item).toMatchObject({ elsewhere: true, siteId: 'ville-b', siteLabel: 'Site de [Ville B]', href: HREF, source: 'actions' });
    expect((await loadNotifications()).find((n) => n.key === item!.key)).toMatchObject({ elsewhere: true, siteLabel: 'Site de [Ville B]' });
    const page = await loadTodoPage({ mine: true });
    expect(page.items.some((x) => x.key === item!.key)).toBe(true);
    expect(page.counts.mine).toBe(page.items.length);
    expect(page.counts.elsewhere).toBeGreaterThan(0);
    // « Mes échéances » ⊂ « Toutes ».
    const all = await loadTodoPage({ mine: false });
    expect(all.counts.all).toBeGreaterThanOrEqual(all.counts.mine);
    expect(page.items.every((x) => all.items.some((y) => y.key === x.key))).toBe(true);
  });

  it('badge d\'écran : site sélectionné seulement ; badge À faire : toutes les échéances', async () => {
    actAs('Chef de service', 'ville-a');
    const onA = await loadCounters();
    expect(onA.badges.actions).toBe(await screenCount('actions'));
    expect(onA.badges.todo).toBe((await loadVisibleTodo()).length);
    actAs('Chef de service', 'ville-b');
    expect((await find())).toMatchObject({ elsewhere: false });
    expect((await loadCounters()).badges.actions).toBe(await screenCount('actions'));
    expect((await loadVisibleTodo()).some((x) => x.title.startsWith(`${ID} ·`) && x.source === 'actions' && !x.elsewhere)).toBe(true);
  });

  it('encadrement en lecture seule du plan (ACT-22, D3) : plus les échéances d\'action des autres sur son site, toujours les siennes', async () => {
    // A-201 : en retard, site A, responsable [R. Fontaine].
    actAs('Animateur QHSE', 'ville-a');
    expect(await find('A-201')).toMatchObject({ kind: 'Action en retard', elsewhere: false });
    actAs('Chef de service', 'ville-a');
    expect(await find('A-201')).toBeUndefined();
    expect((await loadVisibleTodo()).filter((x) => x.source === 'actions').every((x) => x.ownerIds?.includes('sbenali'))).toBe(true);
    expect(await find('A-214')).toMatchObject({ elsewhere: false }); // la sienne, site A
    expect(await find()).toMatchObject({ elsewhere: true }); // la sienne, site B
    actAs('Chef de projet', 'ville-a');
    expect(await find('A-201')).toBeUndefined();
  });

  it('Animateur QHSE : l\'action d\'un autre (site B) n\'apparaît que sur le site B', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await find()).toBeUndefined();
    actAs('Animateur QHSE', 'ville-b');
    expect(await find()).toMatchObject({ elsewhere: false, href: HREF });
    actAs('Animateur QHSE', 'all');
    expect(await find()).toMatchObject({ elsewhere: false });
  });

  it('périmètre restreint : hors périmètre, l\'échéance n\'existe pas ; site accordé : visible', async () => {
    cookieJar.set('vigie_site', 'ville-a');
    restricted('sbenali', 'Chef de service', []);
    expect(await find()).toBeUndefined();
    restricted('sbenali', 'Chef de service', ['ville-b']);
    expect(await find()).toMatchObject({ elsewhere: true, href: HREF, siteLabel: 'Site de [Ville B]' });
  });

  it('site archivé hors « Tous les sites » : échéance visible, sans lien', async () => {
    cookieJar.set('vigie_site', 'ville-a');
    restricted('sbenali', 'Chef de service', ['ville-c']);
    const item = await find('A-T06');
    expect(item).toMatchObject({ elsewhere: true, siteLabel: 'Site de [Ville C]' });
    expect(item!.href).toBeUndefined();
    await expect(openTodo(item!.key)).resolves.toBeUndefined();
    expect(cookieJar.get('vigie_site')).toBe('ville-a');
    // Périmètre complet : « Tous les sites » est proposé, l'échéance s'ouvre sous ce choix.
    auth.state = null;
    actAs('Chef de service', 'ville-a');
    const full = await find('A-T06');
    expect(full).toMatchObject({ elsewhere: true, href: '/actions?action=A-T06' });
    await expect(openTodo(full!.key)).rejects.toThrow('NEXT_REDIRECT:/actions?action=A-T06');
    expect(cookieJar.get('vigie_site')).toBe('all');
  });
});

describe('openTodo : ouverture d\'une échéance visible', () => {
  it('autre site : sélectionne le site, marque comme lue, redirige ; sans journal', async () => {
    actAs('Chef de service', 'ville-a');
    const item = (await find())!;
    const logs = await changeLogCount();
    await expect(openTodo(item.key, { markRead: true })).rejects.toThrow(`NEXT_REDIRECT:${HREF}`);
    expect(cookieJar.get('vigie_site')).toBe('ville-b');
    expect((await reads('sbenali')).map((r) => r.itemKey)).toContain(item.key);
    expect(await changeLogCount()).toBe(logs);
  });

  it('sans markRead : pas d\'état lu', async () => {
    const db = await getDb();
    await db.delete(t.notificationReads).where(eq(t.notificationReads.personId, 'sbenali'));
    actAs('Chef de service', 'ville-a');
    const item = (await find())!;
    await expect(openTodo(item.key)).rejects.toThrow(`NEXT_REDIRECT:${HREF}`);
    expect(await reads('sbenali')).toEqual([]);
  });

  it('clé inconnue, invalide ou échéance invisible : rien', async () => {
    actAs('Chef de service', 'ville-a');
    const key = (await find())!.key;
    actAs('Animateur QHSE', 'ville-a');
    const logs = await changeLogCount();
    await expect(openTodo(key, { markRead: true })).resolves.toBeUndefined();
    await expect(openTodo('Action|/actions?action=A-000|inconnue', { markRead: true })).resolves.toBeUndefined();
    await expect(openTodo('x'.repeat(401), { markRead: true })).resolves.toBeUndefined();
    await expect(openTodo(42 as unknown as string)).resolves.toBeUndefined();
    expect(cookieJar.get('vigie_site')).toBe('ville-a');
    expect(await reads('clefevre')).toEqual([]);
    expect(await changeLogCount()).toBe(logs);
  });

  it('Salarié : ses échéances s\'ouvrent, celles des autres non', async () => {
    actAs('Chef de service', 'ville-a');
    const other = (await find())!.key;
    actAs('Salarié', 'all');
    const own = (await loadVisibleTodo()).find((x) => x.href);
    expect(own).toBeDefined();
    await expect(openTodo(own!.key)).rejects.toThrow(`NEXT_REDIRECT:${own!.href}`);
    await expect(openTodo(other, { markRead: true })).resolves.toBeUndefined();
    expect(await reads('tnguyen')).toEqual([]);
    expect(cookieJar.get('vigie_site')).toBe('all');
  });
});
