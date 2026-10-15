import '../next-mocks';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { actAs, freshDemoDatabase } from '../helpers';
import { getDb, schema as t } from '@/db';
import { actionLabel } from '@/lib/action-rules';
import type { TodoItem } from '@/lib/domain';
import { CLOSED_EVENT_KIND, TO_COMPLETE_HREF, TO_COMPLETE_KIND, loadActionSignals } from '@/lib/data/actions';

// Échéances du plan d'actions (spec § 15.3, D6, D8) calculées sur tout le périmètre : retards et échéances proches au
// responsable de l'action ; vérifications d'efficacité au responsable QHSE du site (pas au responsable de l'action) ;
// actions à compléter groupées par site ; action de suite d'un événement qui n'accepte plus d'action (§ 22.12) : décision
// de réouverture au responsable QHSE du site de l'événement. Reportée et Abandonnée : rien.

freshDemoDatabase();

const base = {
  openedOn: '2026-09-01', initialDueOn: '2026-10-01', dueOn: '2026-10-01', verifyDueOn: '2026-11-30', priority: 'moyen_terme' as const,
  domain: 'securite' as const, problem: 'Problème de test.', source: 'causerie' as const, originRef: 'Causerie du 01/09', siteId: 'ville-a', pilotId: 'edubois',
};

beforeAll(async () => {
  const db = await getDb();
  await db.insert(t.actions).values([
    { ...base, id: 'A-970', detail: 'Action reportée en retard', status: 'reportee' },
    // À compléter sur le site A (priorité manquante, reprise).
    { ...base, id: 'A-971', detail: 'Action reprise sans priorité', status: 'a_faire', priority: null, dueOn: '2026-12-01', initialDueOn: '2026-12-01' },
  ]);
});

const signals = async () => { actAs('Animateur QHSE', 'all'); return (await loadActionSignals()).todo; };
const forAction = (todo: TodoItem[], id: string) => todo.filter((x) => x.title.startsWith(`${id} ·`));

describe('échéances du plan (§ 15.3)', () => {
  it('action en retard : responsable, danger, dépassée ; libellé court', async () => {
    const db = await getDb();
    const [a203] = await db.select().from(t.actions).where(eq(t.actions.id, 'A-203'));
    const [item] = forAction(await signals(), 'A-203');
    expect(item).toMatchObject({
      kind: 'Action en retard', tone: 'danger', overdue: true, ownerIds: ['clefevre'], siteId: 'ville-b', href: '/actions?action=A-203',
      title: `A-203 · ${actionLabel(a203.detail)} — échéance dépassée depuis le 15/09`,
    });
  });

  it('échéance sous 15 jours : responsable, accent ; actions du programme d’audit exclues', async () => {
    const todo = await signals();
    expect(forAction(todo, 'A-214')).toEqual([expect.objectContaining({ kind: 'Action', tone: 'accent', ownerIds: ['sbenali'], date: '2026-10-17', siteId: 'ville-a' })]);
    expect(forAction(todo, 'A-181')).toEqual([]); // portée par le programme d'audit
    expect(forAction(todo, 'A-196')).toEqual([]); // au-delà de 15 jours
  });

  it('vérification d’efficacité : responsable QHSE du site, à venir (accent) et dépassée (danger)', async () => {
    const todo = await signals();
    expect(forAction(todo, 'A-190')).toEqual([expect.objectContaining({ kind: "Vérification d'efficacité", tone: 'accent', ownerIds: ['clefevre'], date: '2026-10-20' })]);
    expect(forAction(todo, 'A-178')).toEqual([expect.objectContaining({ kind: "Vérification d'efficacité", tone: 'danger', overdue: true, ownerIds: ['clefevre'] })]);
    expect(todo.filter((x) => x.kind === "Vérification d'efficacité").every((x) => !x.ownerIds?.includes('lmoreau') && !x.ownerIds?.includes('rfontaine'))).toBe(true);
  });

  it('Reportée, Abandonnée, Vérifiée : aucune échéance', async () => {
    const todo = await signals();
    for (const id of ['A-970', 'A-174', 'A-180', 'A-176']) expect(forAction(todo, id), id).toEqual([]);
  });

  it('actions à compléter : une échéance par site, au responsable QHSE, clé portant le nombre', async () => {
    const todo = (await signals()).filter((x) => x.kind === TO_COMPLETE_KIND);
    expect(todo).toHaveLength(2);
    const bySite = new Map(todo.map((x) => [x.siteId, x]));
    expect(bySite.get(null)).toMatchObject({ count: 1, href: TO_COMPLETE_HREF, tone: 'warn', ownerIds: ['clefevre'], key: `${TO_COMPLETE_KIND}|sans-site|1` }); // A-150
    expect(bySite.get('ville-a')).toMatchObject({ count: 1, ownerIds: ['clefevre'], title: "Plan d'actions · 1 action à compléter (champs obligatoires manquants)" });
    const db = await getDb();
    await db.update(t.actions).set({ priority: null }).where(eq(t.actions.id, 'A-196'));
    const two = (await signals()).find((x) => x.kind === TO_COMPLETE_KIND && x.siteId === 'ville-a');
    expect(two).toMatchObject({ count: 2, key: `${TO_COMPLETE_KIND}|ville-a|2`, title: "Plan d'actions · 2 actions à compléter (champs obligatoires manquants)" });
    await db.update(t.actions).set({ priority: 'moyen_terme' }).where(eq(t.actions.id, 'A-196'));
  });
});

describe('action de suite d’un événement clos (§ 22.12, D6)', () => {
  const closedEvent = async () => (await signals()).filter((x) => x.kind === CLOSED_EVENT_KIND);

  it('A-221 (EV-2026-124 à « Efficacité vérifiée ») : décision au responsable QHSE du site de l’événement', async () => {
    expect(await closedEvent()).toEqual([expect.objectContaining({
      siteId: 'ville-a', ownerIds: ['clefevre'], href: '/evenements?sel=EV-2026-124', tone: 'warn',
      title: "EV-2026-124 · action de suite A-221 — décider d'une réouverture",
    })]);
    // A-222 : suite rattachée à son propre événement (EV-2026-126, étape « Actions ») : rien.
    expect((await closedEvent()).some((x) => x.title.includes('A-222'))).toBe(false);
  });

  it('absente une fois l’action de suite vérifiée, abandonnée ou reportée', async () => {
    const db = await getDb();
    for (const status of ['verifiee', 'abandonnee', 'reportee'] as const) {
      await db.update(t.actions).set({ status }).where(eq(t.actions.id, 'A-221'));
      expect(await closedEvent(), status).toEqual([]);
    }
    await db.update(t.actions).set({ status: 'a_faire' }).where(eq(t.actions.id, 'A-221'));
    expect(await closedEvent()).toHaveLength(1);
  });

  it('événement de nouveau ouvert aux actions : rien', async () => {
    const db = await getDb();
    const [ev] = await db.select({ step: t.events.step }).from(t.events).where(eq(t.events.id, 'EV-2026-124'));
    await db.update(t.events).set({ step: 2 }).where(eq(t.events.id, 'EV-2026-124'));
    expect(await closedEvent()).toEqual([]);
    await db.update(t.events).set({ step: ev.step }).where(eq(t.events.id, 'EV-2026-124'));
  });
});

describe('périmètre', () => {
  it('Salarié : les échéances portent les responsables ; aucune donnée de santé dans les intitulés', async () => {
    actAs('Salarié', 'all');
    const todo = (await loadActionSignals()).todo;
    expect(todo.some((x) => x.health)).toBe(false);
    expect(todo.every((x) => x.ownerIds && x.ownerIds.length > 0)).toBe(true);
  });
});
