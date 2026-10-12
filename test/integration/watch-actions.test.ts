import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase, lastLog } from '../helpers';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadCounters } from '@/lib/data/counters';
import { loadWatchSignals } from '@/lib/data/watch';
import { linkAction } from '@/server/links';
import { saveControl, saveRequirement } from '@/server/watch';

// Veille et contrôles : pilote, responsable ou site conservés tant qu'ils ne sont pas remplacés (VEI-01) ; réserves sans
// action de levée dans les échéances (VEI-02).

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const LEFT_PILOT = "Pilote sorti de l'effectif : choisissez une personne présente.";
const LEFT_RESPONSIBLE = "Responsable sorti de l'effectif : choisissez une personne présente.";
const ARCHIVED_SITE = 'Site archivé ou inconnu : choisissez un site actif.';

const controlByEquipment = async (prefix: string) => {
  const rows = await (await getDb()).select().from(t.controls).orderBy(asc(t.controls.sort));
  return rows.find((c) => c.equipment.startsWith(prefix))!;
};
const requirements = async () => (await getDb()).select().from(t.requirements).where(isNull(t.requirements.archivedAt)).orderBy(asc(t.requirements.sort));

/** Formulaire de la fiche contrôle tel qu'envoyé, valeurs enregistrées éventuellement modifiées. */
async function controlForm(id: number, changes: Record<string, string> = {}) {
  const [c] = await (await getDb()).select().from(t.controls).where(eq(t.controls.id, id));
  return form({
    id: String(c.id), equipment: c.equipment, controlType: c.controlType, periodMonths: String(c.periodMonths), organization: c.organization,
    responsibleId: c.responsibleId ?? '', siteId: c.siteId ?? '', requirementId: c.requirementId != null ? String(c.requirementId) : '',
    lastOn: c.lastOn, nextOn: c.nextOn, reserves: c.reserves ?? '', ...changes,
  });
}

/** Formulaire de la fiche exigence tel qu'envoyé. */
async function requirementForm(id: number, changes: Record<string, string> = {}) {
  const [r] = await (await getDb()).select().from(t.requirements).where(eq(t.requirements.id, id));
  return form({
    id: String(r.id), text: r.text, domain: r.domain, summary: r.summary, dueOn: r.dueOn ?? '', dueNote: r.dueNote ?? '', evaluation: r.evaluation,
    evaluationNote: r.evaluationNote ?? '', pilotId: r.pilotId ?? '', impact: r.impact ?? '', affectsProjects: r.affectsProjects ? 'on' : '',
    keystoneProjects: r.keystoneProjects != null ? String(r.keystoneProjects) : '', featured: r.featured ? 'on' : '', ...changes,
  });
}

describe('réserves sans action de levée (VEI-02)', () => {
  it('échéance en retard par contrôle à réserves sans action, sauf réserve portée par une action', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const electrical = await controlByEquipment('Installations électriques');
    const crane = await controlByEquipment('Pont roulant 10 t');
    const atex = await controlByEquipment("Banc d'essais BE-1");
    const { todo } = await loadWatchSignals();
    const reserves = todo.filter((i) => i.title.includes('sans action de levée'));
    expect(reserves.find((i) => i.href === `/veille?onglet=controles&controle=${electrical.id}`)).toMatchObject({
      tone: 'danger', overdue: true, siteId: 'ville-a', title: 'Vérification périodique · installations électriques — réserves « 3 · 2 levées » sans action de levée',
    });
    expect(reserves.find((i) => i.href === `/veille?onglet=controles&controle=${atex.id}`)).toMatchObject({ tone: 'danger', siteId: 'ville-b' });
    // Pont roulant : réserve levée par A-217, seul le dépassement reste signalé.
    expect(todo.filter((i) => i.href === `/veille?onglet=controles&controle=${crane.id}`).map((i) => i.title)).toEqual([
      expect.stringContaining('dépassé depuis le'),
    ]);
    expect(crane.actionId).toBe('A-217');
  });

  it('badge de la veille : compte l’échéance ; rattacher une action la retire', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const electrical = await controlByEquipment('Installations électriques');
    const before = (await loadCounters()).badges.watch ?? 0;
    const db = await getDb();
    const [open] = await db.select({ id: t.actions.id }).from(t.actions)
      .where(and(eq(t.actions.siteId, 'ville-a'), inArray(t.actions.status, ['todo', 'doing']))).orderBy(asc(t.actions.id));
    expect(await linkAction(`control:${electrical.id}`, open.id)).toEqual({});
    expect((await loadCounters()).badges.watch).toBe(before - 1);
    const { todo } = await loadWatchSignals();
    expect(todo.some((i) => i.href === `/veille?onglet=controles&controle=${electrical.id}` && i.title.includes('sans action de levée'))).toBe(false);
  });

  it('contrôle archivé à réserves : aucune échéance', async () => {
    const db = await getDb();
    const atex = await controlByEquipment("Banc d'essais BE-1");
    await db.update(t.controls).set({ archivedAt: new Date(), archivedById: 'clefevre', archiveReason: 'Test' }).where(eq(t.controls.id, atex.id));
    actAs('Animateur QHSE', 'ville-b');
    const { todo } = await loadWatchSignals();
    expect(todo.some((i) => i.href === `/veille?onglet=controles&controle=${atex.id}`)).toBe(false);
    await db.update(t.controls).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.controls.id, atex.id));
  });
});

describe('saveControl / saveRequirement (VEI-01)', () => {
  it('droits : Salarié et Chef de projet refusés, Chef de service admis', async () => {
    const control = await controlByEquipment('Chariot élévateur');
    const [req] = await requirements();
    for (const role of ['Salarié', 'Chef de projet'] as const) {
      actAs(role);
      expect(await saveControl({}, await controlForm(control.id))).toEqual({ error: DENIED });
      expect(await saveRequirement({}, await requirementForm(req.id))).toEqual({ error: DENIED });
    }
    actAs('Chef de service', 'ville-a');
    expect(await saveControl({}, await controlForm(control.id))).toEqual({ ok: true, id: String(control.id) });
  });

  it('site : contrôle d’un autre site que celui sélectionné refusé', async () => {
    const control = await controlByEquipment('Chariot élévateur');
    actAs('Chef de service', 'ville-b');
    expect(await saveControl({}, await controlForm(control.id, { organization: '[Autre organisme]' }))).toEqual({ error: expect.stringContaining('autre site') });
  });

  it('pilote sorti de l’effectif : conservé tel quel, refusé comme nouveau choix', async () => {
    const db = await getDb();
    const [first, second] = (await requirements()).filter((r) => r.pilotId && !r.featured);
    await db.update(t.requirements).set({ pilotId: 'ylambert' }).where(eq(t.requirements.id, first.id));
    actAs('Animateur QHSE', 'ville-a');
    expect(await saveRequirement({}, await requirementForm(first.id, { impact: 'Impact précisé' }))).toEqual({ ok: true, id: String(first.id) });
    const log = await lastLog('requirement', first.id);
    expect(log?.details).toEqual([{ field: 'Impact', from: first.impact, to: 'Impact précisé' }]);
    expect((await db.select().from(t.requirements).where(eq(t.requirements.id, first.id)))[0].pilotId).toBe('ylambert');

    const refused = await saveRequirement({}, await requirementForm(second.id, { pilotId: 'ylambert' }));
    expect(refused.fieldErrors?.pilotId).toBe(LEFT_PILOT);
    expect((await db.select().from(t.requirements).where(eq(t.requirements.id, second.id)))[0].pilotId).toBe(second.pilotId);
  });

  it('responsable sorti de l’effectif et site archivé : conservés tels quels, refusés comme nouveau choix', async () => {
    const db = await getDb();
    const extinguishers = await controlByEquipment('Extincteurs');
    const doors = await controlByEquipment('Portes et portails');
    const epi = await controlByEquipment('EPI antichute');
    await db.update(t.controls).set({ responsibleId: 'ylambert' }).where(eq(t.controls.id, extinguishers.id));
    actAs('Animateur QHSE', 'ville-a');
    expect(await saveControl({}, await controlForm(extinguishers.id, { organization: '[Prestataire incendie B]' }))).toEqual({ ok: true, id: String(extinguishers.id) });
    expect((await db.select().from(t.controls).where(eq(t.controls.id, extinguishers.id)))[0].responsibleId).toBe('ylambert');
    expect(await saveControl({}, await controlForm(doors.id, { responsibleId: 'ylambert' })))
      .toEqual({ error: 'Certains champs sont à corriger.', fieldErrors: { responsibleId: LEFT_RESPONSIBLE } });

    await db.update(t.controls).set({ siteId: 'ville-c' }).where(eq(t.controls.id, epi.id));
    actAs('Animateur QHSE', 'all');
    expect(await saveControl({}, await controlForm(epi.id, { organization: 'Interne — QHSE (archives)' }))).toEqual({ ok: true, id: String(epi.id) });
    expect((await db.select().from(t.controls).where(eq(t.controls.id, epi.id)))[0].siteId).toBe('ville-c');
    expect(await saveControl({}, await controlForm(doors.id, { siteId: 'ville-c' }))).toMatchObject({ error: ARCHIVED_SITE });
    expect((await db.select().from(t.controls).where(eq(t.controls.id, doors.id)))[0].siteId).toBe('ville-a');
  });

  it('journal : changement de responsable tracé', async () => {
    const doors = await controlByEquipment('Portes et portails');
    actAs('Animateur QHSE', 'ville-a');
    expect(await saveControl({}, await controlForm(doors.id, { responsibleId: 'rfontaine' }))).toEqual({ ok: true, id: String(doors.id) });
    expect((await lastLog('control', doors.id))?.details).toContainEqual({ field: 'Responsable', from: null, to: '[R. Fontaine]' });
  });
});
