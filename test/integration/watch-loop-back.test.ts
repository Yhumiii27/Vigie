import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase } from '../helpers';
import { asc, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadVisibleTodo } from '@/lib/data/todo';
import { loadWatch, loadWatchSignals } from '@/lib/data/watch';
import { evaluateRequirement, recordControl } from '@/server/watch';

// VEI-05 : écart ou réserves restés ouverts alors que l'action liée est close — relance pour boucler (« Réévaluer »,
// « Enregistrer le contrôle »), au responsable désigné, sinon au responsable QHSE du site ; rien n'est modifié d'office.

freshDemoDatabase();

const crane = async () => (await (await getDb()).select().from(t.controls).orderBy(asc(t.controls.sort))).find((c) => c.equipment.startsWith('Pont roulant 10 t'))!;
const firstRequirement = async () => (await (await getDb()).select().from(t.requirements).where(isNull(t.requirements.archivedAt)).orderBy(asc(t.requirements.sort)))[0];
const setStatus = async (id: string, status: 'verifiee' | 'abandonnee') => (await getDb()).update(t.actions).set({ status, effective: status === 'verifiee' ? true : null }).where(eq(t.actions.id, id));

describe('VEI-05 : réserves dont l’action de levée est close', () => {
  it('aucune relance tant que l’action de levée est ouverte', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const c = await crane();
    expect(c.actionId).toBe('A-217');
    const { todo } = await loadWatchSignals();
    expect(todo.some((i) => i.key?.startsWith('veille-boucle|controle|'))).toBe(false);
    const view = (await loadWatch()).controls.find((x) => x.id === c.id)!;
    expect(view.loopBack).toBeNull();
    // Vérifiée « Non efficace » : l'action de suite prend le relais, pas de relance.
    await (await getDb()).update(t.actions).set({ status: 'verifiee', effective: false }).where(eq(t.actions.id, 'A-217'));
    expect((await loadWatchSignals()).todo.some((i) => i.key?.startsWith('veille-boucle|controle|'))).toBe(false);
  });

  it('action vérifiée, réserves inscrites : relance au responsable de l’équipement, clé stable, fiche « Enregistrer le contrôle »', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const c = await crane();
    await setStatus('A-217', 'verifiee');
    const { todo } = await loadWatchSignals();
    const item = todo.find((i) => i.key === `veille-boucle|controle|${c.id}|A-217`);
    expect(item).toMatchObject({
      kind: 'Contrôle', tone: 'warn', siteId: 'ville-a', ownerIds: [c.responsibleId], href: `/veille?onglet=controles&controle=${c.id}`,
      title: 'VGP levage · pont roulant 10 t — action A-217 vérifiée : réserves « 1 · fin de course à régler » à lever',
    });
    expect(item!.dueOn).toBeUndefined();
    const view = (await loadWatch()).controls.find((x) => x.id === c.id)!;
    expect(view.loopBack).toEqual({ actionId: 'A-217', abandoned: false });
    // Échéance visible du responsable (encadrement) et de l'animateur QHSE du site.
    expect((await loadVisibleTodo()).some((i) => i.key.startsWith(item!.key!))).toBe(true);
  });

  it('contrôle de levée sans réserve : la boucle est fermée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const c = await crane();
    expect(await recordControl({}, form({ controlId: String(c.id), performedOn: '2026-10-08', organization: '[Apave]', result: 'favorable' }))).toMatchObject({ ok: true });
    const { todo } = await loadWatchSignals();
    expect(todo.some((i) => i.key?.startsWith(`veille-boucle|controle|${c.id}|`))).toBe(false);
  });
});

describe('VEI-05 : exigence en écart dont l’action est close', () => {
  it('action abandonnée, exigence en écart : « à réévaluer » au pilote ; sans pilote : au responsable QHSE', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    const r = await firstRequirement();
    expect(r.actionId).toBe('A-196');
    await db.update(t.requirements).set({ evaluation: 'ecart' }).where(eq(t.requirements.id, r.id));
    await setStatus('A-196', 'abandonnee');
    let item = (await loadWatchSignals()).todo.find((i) => i.key === `veille-boucle|exigence|${r.id}|A-196`);
    expect(item).toMatchObject({ kind: 'Veille', tone: 'warn', ownerIds: [r.pilotId], href: `/veille?exigence=${r.id}` });
    expect(item!.title).toBe(`${r.text} — action A-196 abandonnée : écart à réévaluer`);
    // Une seule échéance par exigence : pas d'« écart sans action » en plus.
    expect((await loadWatchSignals()).todo.filter((i) => i.href === `/veille?exigence=${r.id}`)).toHaveLength(1);
    expect((await loadWatch()).requirements.find((x) => x.id === r.id)!.loopBack).toEqual({ actionId: 'A-196', abandoned: true });

    await db.update(t.requirements).set({ pilotId: null }).where(eq(t.requirements.id, r.id));
    item = (await loadWatchSignals()).todo.find((i) => i.key === `veille-boucle|exigence|${r.id}|A-196`);
    expect(item!.ownerIds?.length).toBeGreaterThan(0);
    expect(item!.who).not.toBe('');
    await db.update(t.requirements).set({ pilotId: r.pilotId }).where(eq(t.requirements.id, r.id));
  });

  it('réévaluation conforme : la boucle est fermée, l’action reste rattachée', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const r = await firstRequirement();
    expect(await evaluateRequirement({}, form({ id: String(r.id), evaluation: 'conforme' }))).toMatchObject({ ok: true });
    expect((await loadWatchSignals()).todo.some((i) => i.key?.startsWith(`veille-boucle|exigence|${r.id}|`))).toBe(false);
    expect((await firstRequirement()).actionId).toBe('A-196');
  });
});
