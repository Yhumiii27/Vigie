import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, freshDemoDatabase, lastLog } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { QHSE_ONLY_CREATE_MESSAGE } from '@/lib/action-rules';
import { loadAudits } from '@/lib/data/audits';
import { loadEventDetail, loadMyReport } from '@/lib/data/events';
import { advanceEvent, dismissEvent } from '@/server/events';
import { saveAction } from '@/server/plan';

// Événements et plan d'actions QSE (ACT-28, partie 1) : actions de l'événement (libellé, avancement, priorité), création par
// le service QHSE seulement (ACT-22) avec la source imposée par l'événement (D20), étape « Efficacité vérifiée » tant
// qu'une action n'est pas Vérifiée (EVT-15), classement sans suite refusé tant qu'une action n'est pas abandonnée,
// action reprise portant un événement et un constat (A-212, D22) lue des deux côtés, retour au déclarant.
// La création passe par saveAction (flux A) : vérifiée à l'Integration si le flux A n'est pas terminé.

freshDemoDatabase();

const newAction = (fields: Record<string, string>) => form({
  source: 'evenement', link: 'event:EV-2026-131', pilotId: 'sbenali', priority: 'urgent', dueOn: '2026-10-30', verifyDueOn: '2026-11-30',
  domain: 'securite', problem: "Chute de charge lors du retournement d'un bâti", detail: 'Former les monteurs au retournement des bâtis', siteId: 'ville-a',
  ...fields,
});

describe('actions de la fiche événement', () => {
  it('libellé court, avancement, priorité, responsable ; aucune donnée de l’ancien modèle', async () => {
    actAs('Chef de service', 'ville-a');
    const detail = (await loadEventDetail('EV-2026-131'))!;
    expect(detail.actions.map((a) => a.id)).toEqual(['A-214', 'A-215']);
    expect(detail.actions[0]).toMatchObject({
      id: 'A-214', label: 'Remplacer les élingues textiles par des élingues à œillets, étiquetage CMU', status: 'p40', avancement: '40 %',
      priority: 'urgent', pilot: expect.any(String), source: 'evenement',
    });
    expect(detail.actions[0]).not.toHaveProperty('title');
    expect(detail.actions[0]).not.toHaveProperty('origin');
    expect(detail.actions[0]).not.toHaveProperty('kind');
  });

  it('action reprise portant un événement et un constat (A-212) : listée sur l’événement et sur le constat', async () => {
    actAs('Animateur QHSE', 'all');
    const detail = (await loadEventDetail('EV-2026-130'))!;
    expect(detail.actions.map((a) => a.id)).toContain('A-212');
    const audits = await loadAudits({});
    const finding = audits.auditGroups.flatMap((g) => g.findings).find((f) => f.clause === '§8.5.1')!;
    expect(finding).toMatchObject({ actionId: 'A-212', action: { id: 'A-212', title: expect.stringMatching(/^Mettre à jour la gamme/) } });
  });

  it('création depuis l’événement : service QHSE seulement, source imposée, événement lié, journal', async () => {
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as const) {
      actAs(role, 'ville-a');
      expect(await saveAction({}, newAction({})), role).toEqual({ error: QHSE_ONLY_CREATE_MESSAGE });
    }
    actAs('Animateur QHSE', 'ville-a');
    // Événement QSE (PA) : la source « Réclamation client » est refusée.
    expect(await saveAction({}, newAction({ source: 'reclamation_client' }))).toMatchObject({ fieldErrors: { source: expect.any(String) } });
    const before = (await loadEventDetail('EV-2026-131'))!.actions.length;
    const r = await saveAction({}, newAction({}));
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, id: expect.stringMatching(/^A-\d+$/) });
    const after = (await loadEventDetail('EV-2026-131'))!.actions;
    expect(after).toHaveLength(before + 1);
    expect(after.find((a) => a.id === r.id)).toMatchObject({ eventId: 'EV-2026-131', source: 'evenement', status: 'a_faire', siteId: 'ville-a' });
    expect(await lastLog('action', r.id!)).toMatchObject({ action: 'create', byId: 'clefevre' });
  });

  it('création depuis l’événement d’un autre site que le site sélectionné, ou sur un autre site que celui de l’événement : refusée, rien d’écrit', async () => {
    const db = await getDb();
    const count = async () => (await db.select({ id: t.actions.id }).from(t.actions).where(eq(t.actions.eventId, 'EV-2026-131'))).length;
    const before = await count();
    // EV-2026-131 est sur le site A ; site B sélectionné.
    actAs('Animateur QHSE', 'ville-b');
    const otherSite = 'Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.';
    expect(await saveAction({}, newAction({}))).toMatchObject({ error: otherSite, fieldErrors: { link: otherSite } });
    expect(await saveAction({}, newAction({ siteId: 'ville-b' }))).toMatchObject({ error: otherSite });
    // « Tous les sites » : le site de l'action doit être celui de l'événement.
    actAs('Animateur QHSE', 'all');
    expect(await saveAction({}, newAction({ siteId: 'ville-b' }))).toMatchObject({ fieldErrors: { siteId: expect.any(String) } });
    expect(await count()).toBe(before);
  });
});

describe('étape « Actions » sans action liée (ACT-22)', () => {
  it('rôle qui ne crée pas d’action : le blocage rappelle que les actions QSE sont créées par le service QHSE', async () => {
    const db = await getDb();
    await db.insert(t.events).values({
      id: 'EV-2026-951', siteId: 'ville-a', type: 'SD', title: 'Passage encombré', occurredOn: '2026-10-02', location: 'Magasin', severity: 2, step: 2,
      pilotId: 'sbenali', analysisMethod: 'why',
    });
    await db.insert(t.eventAnalyses).values({ eventId: 'EV-2026-951', method: 'why', content: ['Palettes en attente sans zone dédiée'] });
    const step = "Liez au moins une action avant le passage à l'étape « Actions ».";
    actAs('Chef de service', 'ville-a');
    expect((await loadEventDetail('EV-2026-951'))!.blocker).toBe(`${step} ${QHSE_ONLY_CREATE_MESSAGE}`);
    expect(await advanceEvent('EV-2026-951')).toEqual({ error: `${step} ${QHSE_ONLY_CREATE_MESSAGE}` });
    actAs('Animateur QHSE', 'ville-a');
    expect((await loadEventDetail('EV-2026-951'))!.blocker).toBe(step);
    expect(await advanceEvent('EV-2026-951')).toEqual({ error: step });
  });
});

describe('étapes et classement de l’événement (EVT-15)', () => {
  it('« Efficacité vérifiée » : une action Terminée — à vérifier bloque encore le passage', async () => {
    actAs('Animateur QHSE', 'ville-a');
    const db = await getDb();
    await db.insert(t.events).values({
      id: 'EV-2026-950', siteId: 'ville-a', type: 'SD', title: 'Câble au sol', occurredOn: '2026-10-01', location: 'Atelier', severity: 2, step: 3,
      pilotId: 'sbenali',
    });
    await db.insert(t.actions).values({
      id: 'A-950', detail: 'Ranger le câble', source: 'evenement', originRef: 'EV-2026-950', eventId: 'EV-2026-950', siteId: 'ville-a', pilotId: 'sbenali',
      openedOn: '2026-10-01', dueOn: '2026-10-05', initialDueOn: '2026-10-05', verifyDueOn: '2026-11-05', status: 'terminee', doneOn: '2026-10-04',
    });
    expect(await advanceEvent('EV-2026-950')).toEqual({
      error: "1 action liée n'est pas encore vérifiée : vérifiez-la (ou abandonnez-la) dans le plan d'actions avant le passage à l'étape « Efficacité vérifiée ».",
    });
    await db.update(t.actions).set({ status: 'verifiee', closedOn: '2026-10-08' }).where(eq(t.actions.id, 'A-950'));
    expect(await advanceEvent('EV-2026-950')).toEqual({});
  });

  it('classement sans suite refusé tant qu’une action n’est pas abandonnée (Vérifiée comprise)', async () => {
    actAs('Animateur QHSE', 'ville-a');
    expect(await dismissEvent({}, form({ id: 'EV-2026-950', reason: 'Doublon' }))).toEqual({ error: "1 action liée : abandonnez-la d'abord dans le plan d'actions." });
    expect(await dismissEvent({}, form({ id: 'EV-2026-131', reason: 'Doublon' }))).toMatchObject({ error: expect.stringMatching(/actions liées : abandonnez-les d'abord/) });
  });
});

describe('retour au déclarant (EVT-17)', () => {
  it('signalement du salarié : libellé court et avancement des actions, ni responsable ni problème', async () => {
    actAs('Salarié', 'all');
    const report = (await loadMyReport('EV-2026-131'))!;
    expect(report.actions[0]).toEqual({
      id: 'A-214', label: 'Remplacer les élingues textiles par des élingues à œillets, étiquetage CMU', avancement: '40 %', tone: 'accent',
    });
    const json = JSON.stringify(report.actions);
    expect(json).not.toContain('sbenali');
    expect(json).not.toContain('problem');
  });
});
