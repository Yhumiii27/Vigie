import '../next-mocks';
import { describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { lateDays } from '@/lib/action-rules';
import { loadNotifications } from '@/lib/data/notifications';
import { resetConfig } from '@/lib/env';
import { markNotificationsRead } from '@/server/notifications';
import { actAs, freshDemoDatabase } from '../helpers';

// Rappel du mercredi dans la cloche (ACT-32, D12 ; contenu révisé le 15/10/2026 : ouvertes + Terminées, Reportées exclues) :
// élément calculé, daté du mercredi, une clé par semaine ISO, visible jusqu'à sa lecture ou jusqu'au mercredi suivant.
// Les échéances calculées (flux C et écrans) sont remplacées par une liste vide : ce fichier ne teste que le rappel.

vi.mock('@/lib/data/todo', async () => {
  const { getDb: db, schema } = await import('@/db');
  return {
    loadVisibleTodo: async () => [],
    loadTodo: async () => [],
    loadSiteDirectory: async () => (await db()).select({ id: schema.sites.id, label: schema.sites.label, archivedAt: schema.sites.archivedAt }).from(schema.sites),
    shortSiteLabel: (label: string) => label.split(' — ')[0],
  };
});
vi.mock('@/lib/data/dashboard', () => ({ loadTodoPage: async () => ({ items: [] }) }));

freshDemoDatabase({ today: '2026-10-14' });

/** Change la date du jour Vigie (VIGIE_TODAY) sans rouvrir la base. */
function setToday(iso: string) {
  process.env.VIGIE_TODAY = iso;
  resetConfig();
}

const IN_REMINDER = ['a_faire', 'initiee', 'p20', 'p40', 'p60', 'p80', 'terminee'] as const;
const OPEN = IN_REMINDER.slice(0, 6) as readonly string[];

/** Nombre attendu (ouvertes + Terminées, tous sites) et retards (ouvertes seulement) d'un responsable. */
async function expected(personId: string, todayIso: string) {
  const db = await getDb();
  const rows = await db.select({ id: t.actions.id, status: t.actions.status, dueOn: t.actions.dueOn, siteId: t.actions.siteId }).from(t.actions)
    .where(and(eq(t.actions.pilotId, personId), inArray(t.actions.status, [...IN_REMINDER])));
  return { n: rows.length, m: rows.filter((a) => OPEN.includes(a.status) && lateDays(a, todayIso) > 0).length, rows };
}

const reminderOf = async () => (await loadNotifications()).find((n) => n.family === 'rappel');

describe('rappel du mercredi dans la cloche', () => {
  it('mercredi 14/10 : clé de la semaine, lien, date, nombres (QHSE : ses propres actions seulement, tous sites)', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const { n, m, rows } = await expected('clefevre', '2026-10-14');
    expect(n).toBeGreaterThan(0);
    expect(m).toBeGreaterThan(0);
    const r = await reminderOf();
    expect(r).toMatchObject({
      key: 'rappel-actions|2026-W42', href: '/actions?mes=1', date: '2026-10-14', kind: 'Rappel du mercredi', tone: 'warn',
      title: `Vos actions QSE en cours : ${n}, dont ${m} en retard`, read: false, info: true, urgent: false, elsewhere: false, siteId: null,
    });
    // Pas de synthèse : le total du plan est bien supérieur.
    const all = await (await getDb()).select({ id: t.actions.id }).from(t.actions).where(inArray(t.actions.status, [...IN_REMINDER]));
    expect(all.length).toBeGreaterThan(rows.length);
  });

  it('Terminées comprises, Reportées exclues (Chef de service)', async () => {
    actAs('Chef de service', 'ville-a');
    const { n, m, rows } = await expected('sbenali', '2026-10-14');
    expect(rows.some((a) => a.status === 'terminee')).toBe(true);
    const reported = await (await getDb()).select({ id: t.actions.id }).from(t.actions).where(and(eq(t.actions.pilotId, 'sbenali'), eq(t.actions.status, 'reportee')));
    expect(reported.length).toBeGreaterThan(0);
    expect((await reminderOf())?.title).toBe(`Vos actions QSE en cours : ${n}, dont ${m} en retard`);
  });

  it('actions sur un autre site que le site sélectionné ni du périmètre : comptées (D19)', async () => {
    actAs('Chef de service', 'ville-b');
    const { n } = await expected('sbenali', '2026-10-14');
    expect((await reminderOf())?.title).toMatch(new RegExp(`^Vos actions QSE en cours : ${n},`));
  });

  it('Salarié : son rappel', async () => {
    actAs('Salarié', 'ville-a');
    const { n, m } = await expected('tnguyen', '2026-10-14');
    expect(n).toBeGreaterThan(0);
    expect(await reminderOf()).toMatchObject({ key: 'rappel-actions|2026-W42', title: `Vos actions QSE en cours : ${n}, dont ${m} en retard`, tone: m ? 'warn' : 'accent' });
  });

  it('aucune action ouverte ni Terminée (Vérifiées, Reportées, Abandonnées seulement) : aucun rappel', async () => {
    actAs('Direction', 'ville-a');
    expect((await expected('hmarchand', '2026-10-14')).n).toBe(0);
    expect(await reminderOf()).toBeUndefined();
    // Une action reportée seulement : toujours rien.
    const db = await getDb();
    const [a] = await db.select({ id: t.actions.id }).from(t.actions).where(eq(t.actions.status, 'reportee')).limit(1);
    const [before] = await db.select({ pilotId: t.actions.pilotId }).from(t.actions).where(eq(t.actions.id, a.id));
    await db.update(t.actions).set({ pilotId: 'hmarchand' }).where(eq(t.actions.id, a.id));
    expect(await reminderOf()).toBeUndefined();
    await db.update(t.actions).set({ pilotId: before.pilotId }).where(eq(t.actions.id, a.id));
  });

  it('visible vendredi 16/10 et mardi 20/10 (même clé, daté du 14/10) tant qu’il n’est pas lu ; lu → masqué ; mercredi 21/10 → W43', async () => {
    actAs('Animateur QHSE', 'ville-a');
    for (const day of ['2026-10-16', '2026-10-20']) {
      setToday(day);
      expect(await reminderOf(), day).toMatchObject({ key: 'rappel-actions|2026-W42', date: '2026-10-14' });
    }
    await markNotificationsRead(['rappel-actions|2026-W42']);
    expect(await reminderOf()).toBeUndefined();
    setToday('2026-10-21');
    const { n, m } = await expected('clefevre', '2026-10-21');
    expect(await reminderOf()).toMatchObject({ key: 'rappel-actions|2026-W43', date: '2026-10-21', read: false, title: `Vos actions QSE en cours : ${n}, dont ${m} en retard` });
    setToday('2026-10-14');
  });
});
