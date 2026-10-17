import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase } from '../helpers';
import { notificationsOf } from './actions-helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadNotifications } from '@/lib/data/notifications';
import { advanceEvent, createEvent, dismissEvent } from '@/server/events';
import { myReportHref, reportOutcomeTitle } from '@/server/notify';

// TDB-06 : information du déclarant quand son signalement est qualifié, classé sans suite ou clôturé (notifications
// stockées, cloche seulement) ; jamais pour un signalement anonyme ni quand le déclarant est l'auteur du changement.
// [T. Nguyen] : Salarié ; [S. Benali] : Chef de service ; [C. Lefèvre] : animatrice QHSE.

freshDemoDatabase();

async function created(fields: Record<string, string> = {}) {
  actAs('Chef de service', 'ville-a');
  const r = await createEvent({}, form({
    type: 'PA', title: 'Charge mal arrimée', occurredOn: '2026-10-08', location: 'Atelier montage', severity: '2', siteId: 'ville-a',
    declarantId: 'tnguyen', pilotId: 'sbenali', ...fields,
  }));
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  return r.id!;
}
const suites = async (personId: string) => (await notificationsOf(personId)).filter((n) => n.type === 'signalement_suite');

describe('suite d’un signalement (TDB-06)', () => {
  it('qualifié : notification au déclarant, lien vers « Mes signalements », visible dans sa cloche', async () => {
    const id = await created();
    const before = (await suites('tnguyen')).length;
    actAs('Chef de service', 'ville-a');
    expect(await advanceEvent(id)).toEqual({});
    const mine = await suites('tnguyen');
    expect(mine).toHaveLength(before + 1);
    expect(mine.at(-1)).toMatchObject({
      entityType: 'event', entityId: id, byId: 'sbenali', href: myReportHref(id), readAt: null,
      title: expect.stringMatching(new RegExp(`^Votre signalement ${id} a été qualifié par .+ : Charge mal arrimée$`)),
    });
    actAs('Salarié', 'ville-b');
    const bell = await loadNotifications();
    expect(bell.find((n) => n.key === `notification:${mine.at(-1)!.id}`)).toMatchObject({
      kind: 'Suite de votre signalement', family: 'signalement_suite', href: myReportHref(id), info: true, siteId: null,
    });
  });

  it('classé sans suite : notification au déclarant ; refus : rien', async () => {
    const id = await created();
    const before = (await suites('tnguyen')).length;
    actAs('Chef de service', 'ville-a');
    expect(await dismissEvent({}, form({ id, reason: 'Doublon' }))).toMatchObject({ error: expect.any(String) });
    expect(await suites('tnguyen')).toHaveLength(before);
    actAs('Animateur QHSE', 'ville-a');
    expect(await dismissEvent({}, form({ id, reason: 'Doublon de EV-2026-123' }))).toEqual({ ok: true, id });
    expect((await suites('tnguyen')).at(-1)).toMatchObject({ entityId: id, byId: 'clefevre', title: expect.stringContaining('a été classé sans suite par') });
  });

  it('signalement anonyme, déclarant auteur du changement, étape sans suite à signaler : aucune notification', async () => {
    const anonymous = await created();
    await (await getDb()).update(t.events).set({ anonymous: true, declarantId: null }).where(eq(t.events.id, anonymous));
    const own = await created({ declarantId: 'sbenali' });
    const beforeT = (await suites('tnguyen')).length;
    const beforeS = (await suites('sbenali')).length;
    actAs('Chef de service', 'ville-a');
    expect(await advanceEvent(anonymous)).toEqual({});
    expect(await advanceEvent(own)).toEqual({});
    expect(await suites('tnguyen')).toHaveLength(beforeT);
    expect(await suites('sbenali')).toHaveLength(beforeS);
  });

  it('autre personne : la notification d’un déclarant n’a pas de lien pour elle (et n’est jamais dans sa cloche)', async () => {
    actAs('Chef de service', 'ville-a');
    const bell = await loadNotifications();
    expect(bell.some((n) => n.family === 'signalement_suite')).toBe(false);
  });

  it('titre : intitulé seul, ramené à 80 caractères', () => {
    expect(reportOutcomeTitle('EV-2026-140', 'cloture', '[C. Lefèvre]', 'x'.repeat(120))).toMatch(/^Votre signalement EV-2026-140 a été clôturé par \[C\. Lefèvre\] : x{79}…$/);
  });
});
