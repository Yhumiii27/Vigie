import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieJar, form } from '../next-mocks';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema as t } from '@/db';
import { resetConfig } from '@/lib/env';

// Données de santé d'un AT (SEC-06) : blessure, jours perdus et déclaration CPAM visibles et modifiables par
// l'animateur QHSE et la direction seulement ; retirées des chargements et refusées par les server actions des autres rôles.

const AT = 'EV-2026-119'; // accident avec arrêt (3 jours), déclaré à la CPAM le 09/09 (jeu de démonstration)

beforeAll(async () => {
  process.env.VIGIE_DEMO = '1';
  process.env.VIGIE_DATA_DIR = 'memory://';
  process.env.VIGIE_TODAY = '2026-10-09';
  resetConfig();
  await closeDb();
});
afterAll(async () => {
  cookieJar.clear();
  await closeDb();
});

async function as(role: string) {
  const db = await getDb();
  const [ev] = await db.select({ siteId: t.events.siteId }).from(t.events).where(eq(t.events.id, AT));
  cookieJar.set('vigie_role', role);
  cookieJar.set('vigie_site', ev.siteId);
}

/** Formulaire « Modifier » de l'AT, d'après la fiche enregistrée (sans champ de santé). */
async function editForm(over: Record<string, string> = {}) {
  const db = await getDb();
  const [e] = await db.select().from(t.events).where(eq(t.events.id, AT));
  const s = (v: string | number | null) => (v == null ? '' : String(v));
  return form({
    id: e.id, type: e.type, title: e.title, occurredOn: e.occurredOn, location: e.location, equipment: s(e.equipment),
    keystoneProject: s(e.keystoneProject), pilotId: s(e.pilotId), severity: s(e.severity), siteId: e.siteId,
    description: e.description, immediateMeasures: e.immediateMeasures, controlId: s(e.controlId), riskId: s(e.riskId),
    documentId: s(e.documentId), preventionPlanId: s(e.preventionPlanId), permitId: s(e.permitId), ...over,
  });
}

async function stored() {
  const db = await getDb();
  const [e] = await db.select({ title: t.events.title, type: t.events.type, injury: t.events.injury, lostDays: t.events.lostDays, cpamDeclaredOn: t.events.cpamDeclaredOn })
    .from(t.events).where(eq(t.events.id, AT));
  return e;
}

describe('données de santé des accidents du travail', () => {
  it('fiche : transmises à l\'animateur QHSE et à la direction, retirées pour les autres rôles', async () => {
    const { loadEventDetail } = await import('@/lib/data/events');
    for (const role of ['Animateur QHSE', 'Direction']) {
      await as(role);
      const d = await loadEventDetail(AT);
      expect(d).toMatchObject({ health: true, event: { injury: 'arret', lostDays: 3, cpamDeclaredOn: '2026-09-09' }, cpam: { declaredOn: '2026-09-09' } });
    }
    for (const role of ['Chef de service', 'Chef de projet']) {
      await as(role);
      const d = await loadEventDetail(AT);
      expect(d).toMatchObject({ health: false, event: { injury: null, lostDays: null, cpamDeclaredOn: null }, cpam: null });
      expect(JSON.stringify(d)).not.toMatch(/arr[eê]t|"lostDays":\d|"cpamDeclaredOn":"|déclar[ée]+ le/i);
    }
  });

  it('modification : refusée avec une donnée de santé, conservée sinon ; un AT garde son type', async () => {
    const { saveEvent } = await import('@/server/events');
    await as('Chef de service');
    for (const field of ['injury', 'lostDays', 'cpamDeclaredOn']) {
      const r = await saveEvent({}, await editForm({ [field]: field === 'injury' ? 'soins' : field === 'lostDays' ? '0' : '2026-09-10' }));
      expect(r.error).toMatch(/données de santé/);
    }
    expect(await saveEvent({}, await editForm({ type: 'PA' }))).toMatchObject({ fieldErrors: { type: expect.any(String) } });
    expect(await saveEvent({}, await editForm({ title: 'Entorse sur la plateforme PIRL' }))).toMatchObject({ ok: true });
    expect(await stored()).toEqual({ title: 'Entorse sur la plateforme PIRL', type: 'AT', injury: 'arret', lostDays: 3, cpamDeclaredOn: '2026-09-09' });

    await as('Animateur QHSE');
    expect(await saveEvent({}, await editForm({ injury: 'arret', lostDays: '4', cpamDeclaredOn: '2026-09-09' }))).toMatchObject({ ok: true });
    expect(await stored()).toMatchObject({ injury: 'arret', lostDays: 4 });
  });

  it('journal : les modifications des données de santé ne sont visibles que des rôles habilités', async () => {
    const { loadEventChangeLog } = await import('@/lib/data/events');
    await as('Animateur QHSE');
    const full = await loadEventChangeLog(AT);
    expect(full.flatMap((e) => e.details.map((d) => d.field))).toEqual(expect.arrayContaining(['Intitulé', 'Jours perdus']));
    await as('Chef de projet');
    const restricted = await loadEventChangeLog(AT);
    expect(restricted.length).toBe(full.length - 1);
    expect(JSON.stringify(restricted)).not.toMatch(/Jours perdus|Blessure|CPAM/);
    expect(restricted.flatMap((e) => e.details.map((d) => d.field))).toContain('Intitulé');
  });

  it('création et échéance CPAM : AT saisi sans données de santé, échéance réservée aux rôles habilités', async () => {
    const { createEvent } = await import('@/server/events');
    const { loadVisibleTodo } = await import('@/lib/data/todo');
    await as('Chef de service');
    const db = await getDb();
    const [{ siteId }] = await db.select({ siteId: t.events.siteId }).from(t.events).where(eq(t.events.id, AT));
    const base = { type: 'AT', title: 'Chute de plain-pied', occurredOn: '2026-10-08', location: 'Atelier', severity: '2', siteId, declarantId: 'sbenali', pilotId: 'sbenali' };
    expect((await createEvent({}, form({ ...base, injury: 'arret' }))).error).toMatch(/données de santé/);
    const created = await createEvent({}, form(base));
    expect(created).toMatchObject({ ok: true });
    const [row] = await db.select().from(t.events).where(eq(t.events.id, created.id!));
    expect(row).toMatchObject({ type: 'AT', injury: null, lostDays: null, cpamDeclaredOn: null });

    const cpam = (todo: { kind: string; title: string }[]) => todo.find((x) => x.kind === 'Déclaration AT à la CPAM' && x.title.startsWith(created.id!));
    expect(cpam(await loadVisibleTodo())).toBeUndefined();
    await as('Chef de projet');
    expect(cpam(await loadVisibleTodo())).toBeUndefined();
    await as('Animateur QHSE');
    // Pilote chef de service (non habilité) : l'échéance va au responsable QHSE du site.
    expect(cpam(await loadVisibleTodo())).toMatchObject({ health: true, who: '[C. Lefèvre]', ownerIds: ['clefevre'] });
    await as('Direction');
    expect(cpam(await loadVisibleTodo())).toBeDefined();
  });
});
