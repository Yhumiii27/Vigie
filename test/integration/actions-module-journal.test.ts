import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { actionRow } from './actions-helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { toParisLocal } from '@/lib/dates';
import { saveEvent } from '@/server/events';
import { addProgramAction, removeProgramAction } from '@/server/risks';
import { cancelControlRecord, recordControl } from '@/server/watch';

// ACT-03 : changements d'une action faits par les autres modules, tracés dans son historique, dans la transaction de
// l'écriture — site d'un événement qui entraîne ses actions, nouvelles réserves d'un contrôle qui détachent l'action de
// levée (et annulation de l'enregistrement), inscription et retrait au programme de prévention (PAPRIPACT).

freshDemoDatabase();

/** Formulaire « Modifier » d'un événement d'après la fiche enregistrée (rubriques non médicales). */
async function eventForm(id: string, over: Record<string, string> = {}) {
  const [e] = await (await getDb()).select().from(t.events).where(eq(t.events.id, id));
  const s = (v: string | number | null) => (v == null ? '' : String(v));
  return form({
    id: e.id, type: e.type, title: e.title, occurredOn: e.occurredOn, occurredTime: s(e.occurredTime), location: e.location, equipment: s(e.equipment),
    keystoneProject: s(e.keystoneProject), pilotId: s(e.pilotId), severity: s(e.severity), siteId: e.siteId, description: e.description,
    immediateMeasures: e.immediateMeasures, ncOrigin: s(e.ncOrigin), controlId: s(e.controlId), riskId: s(e.riskId), documentId: s(e.documentId),
    preventionPlanId: s(e.preventionPlanId), permitId: s(e.permitId),
    victimKind: s(e.victimKind), victimId: s(e.victimId), victimName: s(e.victimName), victimCompany: s(e.victimCompany), workSchedule: s(e.workSchedule),
    knownAt: e.knownAt ? toParisLocal(e.knownAt) : '', activity: s(e.activity), circumstances: s(e.circumstances), witnesses: s(e.witnesses), thirdParty: s(e.thirdParty),
    customer: s(e.customer), customerRef: s(e.customerRef), envAspect: s(e.envAspect), envMedium: s(e.envMedium),
    ...over,
  });
}

describe('site d’un événement : ses actions le suivent et le tracent', () => {
  it('changement de site : chaque action du même site déplacée, une entrée « Site » dans son historique', async () => {
    actAs('Chef de service', 'all');
    // EV-2026-131 (site A) porte A-214 et A-215 ; ses rattachements facultatifs (risque…) sont retirés pour le site B.
    const r = await saveEvent({}, await eventForm('EV-2026-131', { siteId: 'ville-b', riskId: '', controlId: '', documentId: '', preventionPlanId: '', permitId: '' }));
    expect(r, JSON.stringify(r)).toEqual({ ok: true, id: 'EV-2026-131' });
    for (const id of ['A-214', 'A-215']) {
      expect((await actionRow(id)).siteId).toBe('ville-b');
      const log = await lastLog('action', id);
      expect(log).toMatchObject({ action: 'update', summary: "Site modifié avec l'événement EV-2026-131", byId: 'sbenali' });
      expect(log!.details).toEqual([{ field: 'Site', from: expect.stringContaining('[Ville A]'), to: expect.stringContaining('[Ville B]') }]);
    }
  });

  it('sans changement de site : rien dans l’historique des actions', async () => {
    actAs('Chef de service', 'all');
    const before = (await changeLog('action', 'A-214')).length;
    expect(await saveEvent({}, await eventForm('EV-2026-131', { title: 'Chute de charge (intitulé corrigé)' }))).toEqual({ ok: true, id: 'EV-2026-131' });
    expect((await changeLog('action', 'A-214')).length).toBe(before);
  });
});

describe('réserves d’un contrôle : l’action de levée détachée et tracée', () => {
  it('nouvelles réserves : action détachée du contrôle (journal de l’action) ; annulation de l’enregistrement : idem si elle était revenue', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    // Contrôle 1 (A-217 lève « 1 · fin de course à régler »).
    const r = await recordControl({}, form({ controlId: '1', performedOn: '2026-10-05', organization: 'Apave', reserves: '2 · garde-corps à reprendre', result: 'reserves' }));
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    expect((await db.select().from(t.controls).where(eq(t.controls.id, 1)))[0].actionId).toBeNull();
    expect(await lastLog('action', 'A-217')).toMatchObject({
      action: 'unlink', byId: 'clefevre', summary: expect.stringMatching(/^Détachée de .* \(nouvelles réserves au contrôle du 05\/10\/2026\)/),
    });
    // L'action de levée rattachée aux nouvelles réserves, puis l'enregistrement annulé : réserves précédentes rétablies.
    await db.update(t.controls).set({ actionId: 'A-217' }).where(eq(t.controls.id, 1));
    const last = (await db.select().from(t.controlRecords).where(eq(t.controlRecords.controlId, 1))).sort((a, b) => b.id - a.id)[0];
    expect(await cancelControlRecord({}, form({ id: String(last.id), reason: 'Saisi sur le mauvais équipement' }))).toMatchObject({ ok: true });
    expect(await lastLog('action', 'A-217')).toMatchObject({
      action: 'unlink', reason: 'Saisi sur le mauvais équipement', summary: expect.stringContaining("réserves rétablies par l'annulation"),
    });
  });

  it('mêmes réserves : action conservée, rien dans son historique', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    await db.update(t.controls).set({ actionId: 'A-217' }).where(eq(t.controls.id, 1));
    const [c] = await db.select().from(t.controls).where(eq(t.controls.id, 1));
    const before = (await changeLog('action', 'A-217')).length;
    expect(await recordControl({}, form({ controlId: '1', performedOn: '2026-10-06', organization: 'Apave', reserves: c.reserves ?? '', result: c.reserves ? 'reserves' : 'favorable' }))).toMatchObject({ ok: true });
    expect((await db.select().from(t.controls).where(eq(t.controls.id, 1)))[0].actionId).toBe('A-217');
    expect((await changeLog('action', 'A-217')).length).toBe(before);
  });
});

describe('programme de prévention (PAPRIPACT) : inscription et retrait tracés sur l’action', () => {
  it('ajout et retrait d’une ligne : entrée « link » / « unlink » de l’action, auteur', async () => {
    actAs('Animateur QHSE', 'all');
    expect(await addProgramAction({}, form({ year: '2026', actionId: 'A-215' }))).toEqual({ ok: true, id: 'A-215' });
    expect(await lastLog('action', 'A-215')).toMatchObject({ action: 'link', summary: 'Inscrite au programme de prévention 2026 (PAPRIPACT)', byId: 'clefevre' });
    expect(await removeProgramAction({}, form({ year: '2026', actionId: 'A-215' }))).toEqual({ ok: true, id: 'A-215' });
    expect(await lastLog('action', 'A-215')).toMatchObject({ action: 'unlink', summary: 'Retirée du programme de prévention 2026 (PAPRIPACT)' });
  });

  it('refus (action déjà au programme) : rien dans l’historique de l’action', async () => {
    actAs('Animateur QHSE', 'all');
    const before = (await changeLog('action', 'A-214')).length;
    expect(await addProgramAction({}, form({ year: '2026', actionId: 'A-214' }))).toEqual({ error: 'Action déjà au programme.' });
    expect((await changeLog('action', 'A-214')).length).toBe(before);
  });
});
