import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { REVIEW_TRACK } from '@/components/audits/shared';
import { buildReviewDossier, loadMyContributions, loadReviewCard, type Review } from '@/lib/data/review';
import { loadVisibleTodo } from '@/lib/data/todo';
import type { Role } from '@/lib/domain';
import { savePlanItem } from '@/server/audits';
import { abandonAction } from '@/server/plan-ui';
import { cancelReview, closeReview, createReview, holdReview, rescheduleReview, saveReviewDecision, setReviewItemDone } from '@/server/review';

// Revue de direction du lot 2 : consultation pour l'encadrement (AUD-02), contributions sans l'écran Audits (AUD-04),
// suivi des décisions des revues précédentes (AUD-05), échéance du programme rattachée à la revue (AUD-01, AUD-30).
// Server actions : droits, motif, journal (les revues n'ont pas de site : AUD-22 ; dossier sur « Tous les sites »).

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';
const APPROVERS_ONLY = "Réservé à l'animateur QHSE et à la direction.";
const CHIEFS: Role[] = ['Chef de service', 'Chef de projet'];

async function reviewOn(date: string): Promise<Review> {
  const db = await getDb();
  const [r] = await db.select().from(t.reviews).where(eq(t.reviews.reviewOn, date));
  if (!r) throw new Error(`revue du ${date} introuvable`);
  return r;
}
async function itemOf(reviewId: number, label: string) {
  const db = await getDb();
  const [i] = await db.select().from(t.reviewItems).where(and(eq(t.reviewItems.reviewId, reviewId), eq(t.reviewItems.label, label)));
  if (!i) throw new Error(`élément ${label} introuvable`);
  return i;
}
async function planOf(reviewId: number) {
  const db = await getDb();
  const [p] = await db.select().from(t.auditPlanItems).where(eq(t.auditPlanItems.reviewId, reviewId));
  return p;
}

describe('AUD-02 : revue de direction en consultation pour l’encadrement', () => {
  it('chef de service et chef de projet ne planifient, ne saisissent ni ne clôturent la revue', async () => {
    const annual = await reviewOn('2026-12-10');
    for (const role of CHIEFS) {
      actAs(role);
      expect(await createReview({}, form({ reviewOn: '2027-09-16', kind: 'ordinaire' })), role).toEqual({ error: DENIED });
      expect(await holdReview({}, form({ id: String(annual.id), reviewOn: '2026-10-01', minutes: 'x' })), role).toEqual({ error: DENIED });
      expect(await saveReviewDecision({}, form({ reviewId: String(annual.id), kind: 'decision', text: 'x' })), role).toEqual({ error: DENIED });
      expect(await closeReview(annual.id), role).toEqual({ error: APPROVERS_ONLY });
      const card = await loadReviewCard({ revue: String(annual.id) });
      expect(card.flags).toMatchObject({ canEdit: false, canDossier: false });
    }
    actAs('Animateur QHSE');
    expect((await loadReviewCard({ revue: String(annual.id) })).flags).toMatchObject({ canEdit: true, canDossier: true });
  });
});

describe('AUD-04 : contributeurs de la revue, quel que soit leur rôle', () => {
  it('le contributeur coche son élément (journal à son nom) ; pas celui d’un autre', async () => {
    const annual = await reviewOn('2026-12-10');
    const own = await itemOf(annual.id, "Retour d'expérience des visites sécurité");
    const other = await itemOf(annual.id, 'Veille réglementaire : impacts du règlement 2023/1230');
    actAs('Chef de service');
    const card = await loadReviewCard({ revue: String(annual.id) });
    expect(card.items.find((i) => i.id === own.id)?.canToggle).toBe(true);
    expect(card.items.find((i) => i.id === other.id)?.canToggle).toBe(false);
    expect(card.flags.mine).toBe(true);
    expect(await setReviewItemDone(own.id, true)).toEqual({});
    expect((await itemOf(annual.id, own.label)).done).toBe(true);
    expect(await lastLog('review', annual.id)).toMatchObject({
      action: 'update', byId: 'sbenali', summary: "« Retour d'expérience des visites sécurité » fourni (contributeur : [S. Benali])",
    });
    expect(await setReviewItemDone(other.id, true)).toEqual({ error: DENIED });
    actAs('Salarié');
    expect(await setReviewItemDone(own.id, false)).toEqual({ error: DENIED });
    expect((await itemOf(annual.id, own.label)).done).toBe(true);
  });

  it('salarié contributeur : échéance avec « Mes contributions », sa revue seulement, sans les noms des autres', async () => {
    const db = await getDb();
    const annual = await reviewOn('2026-12-10');
    const [mine] = await db.insert(t.reviewItems).values({
      reviewId: annual.id, label: 'Retour des opérateurs sur les consignes de poste', source: 'manuel', ownerId: 'tnguyen', dueOn: '2026-10-05', sort: 30,
    }).returning();
    actAs('Salarié');
    const todo = await loadVisibleTodo();
    const due = todo.find((x) => x.title.startsWith('Retour des opérateurs sur les consignes de poste'));
    expect(due?.href).toMatch(/^\/audits\/contributions\?revue=\d+$/);

    const data = await loadMyContributions({ revue: String(annual.id) });
    expect(data.focus).toBe(annual.id);
    expect(data.reviews.map((r) => r.id)).toEqual([annual.id]);
    expect(data.reviews[0]).toMatchObject({ involvement: 'contributor', record: null, openHref: null, dossierHref: null, editable: true });
    expect(data.reviews[0].myItems.map((i) => [i.id, i.canToggle])).toEqual([[mine.id, true]]);
    const json = JSON.stringify(data);
    for (const other of ['[C. Lefèvre]', '[S. Benali]', '[H. Marchand]', '[E. Dubois]', '[L. Moreau]', '[M. Girard]']) expect(json, other).not.toContain(other);

    expect(await setReviewItemDone(mine.id, true)).toEqual({});
    expect(await lastLog('review', annual.id)).toMatchObject({ byId: 'tnguyen', summary: '« Retour des opérateurs sur les consignes de poste » fourni (contributeur : [T. Nguyen])' });
  });

  it('chef de service : ses trois revues, compte rendu des revues tenues ; check-list figée et éléments automatiques refusés', async () => {
    actAs('Chef de service');
    const data = await loadMyContributions({});
    expect(data.reviews.map((r) => r.reviewOn)).toEqual(['2026-12-10', '2026-06-18', '2025-12-11']);
    expect(data.reviews.map((r) => r.involvement)).toEqual(['contributor', 'participant', 'participant']);
    expect(data.reviews[1].record?.minutes).toContain("Point d'étape");
    expect(data.reviews[2].record?.minutes).toContain('Politique QHSE reconduite');
    expect(data.reviews[1].record?.decisions.map((d) => d.actionId)).toEqual(['A-174']);
    expect(data.reviews[0].openHref).toMatch(/^\/audits\?annee=2026&revue=\d+#revue$/);
    expect(data.reviews[0].dossierHref).toBeNull();

    const db = await getDb();
    const closed = await reviewOn('2025-12-11');
    const [late] = await db.insert(t.reviewItems).values({ reviewId: closed.id, label: 'Bilan sécurité', source: 'manuel', ownerId: 'sbenali', sort: 9 }).returning();
    expect(await setReviewItemDone(late.id, true)).toEqual({ error: 'Revue clôturée ou annulée : check-list figée.' });
    actAs('Animateur QHSE');
    const auto = await itemOf((await reviewOn('2026-12-10')).id, 'Suivi des actions de la revue précédente');
    expect(await setReviewItemDone(auto.id, true)).toEqual({ error: 'Élément calculé par Vigie.' });
  });
});

describe('AUD-05 : suivi des décisions et actions des revues précédentes', () => {
  it('décisions sans action, objectifs, actions closes et en cours ; action abandonnée avec son motif', async () => {
    actAs('Animateur QHSE', 'all');
    const db = await getDb();
    const reviews: Review[] = await db.select().from(t.reviews);
    const annual = reviews.find((r) => r.reviewOn === '2026-12-10')!;
    const rows = (await buildReviewDossier(annual, reviews)).previousFollowUp;
    const byText = (s: string) => rows.find((r) => r.text.startsWith(s));
    expect(byText('Recruter un technicien méthodes')).toMatchObject({ state: 'no_action', kind: 'ressource', review: 'Revue du 11/12/2025' });
    expect(byText('Politique QHSE reconduite')).toMatchObject({ state: 'no_action', kind: 'objectif', tone: 'neutral' });
    expect(rows.filter((r) => r.state === 'action').map((r) => r.actionId).sort()).toEqual(['A-152', 'A-158', 'A-174']);
    expect(byText('Former les chefs')).toMatchObject({ open: true, review: 'Revue du 18/06/2026' });
    expect(rows[0].open).toBe(true);

    // A-174 (Reportée) : encore à suivre ; abandonnée par le service QHSE (flux A, vérifié à l'Integration).
    expect(byText('Former les chefs')).toMatchObject({ actionId: 'A-174', action: { status: 'Reportée' } });
    expect(await abandonAction({}, form({ id: 'A-174', from: 'reportee', reason: 'Formation reportée au plan 2027' }))).toMatchObject({ ok: true });
    const after = (await buildReviewDossier(annual, await db.select().from(t.reviews))).previousFollowUp;
    expect(after.find((r) => r.actionId === 'A-174')).toMatchObject({
      state: 'cancelled', kind: 'action', open: false, cancelled: { reason: 'Formation reportée au plan 2027', on: expect.any(String) },
    });
    // La décision détachée de son action abandonnée reste suivie : sans action au plan.
    expect(after.find((r) => r.text.startsWith('Former les chefs') && r.kind === 'decision')).toMatchObject({ state: 'no_action', tone: 'warn' });
  });
});

describe('AUD-01 : programme annuel et revues liés par reviewId', () => {
  it('nouvelle revue : échéance créée sur la ligne des revues, ou reprise d’une échéance saisie au seul programme', async () => {
    actAs('Animateur QHSE');
    const created = await createReview({}, form({ reviewOn: '2027-06-17', kind: 'intermediaire' }));
    expect(created).toMatchObject({ ok: true });
    const june = await planOf(+created.id!);
    expect(june).toMatchObject({ track: REVIEW_TRACK, year: 2027, month: 6, plannedOn: '2027-06-17', label: 'Interm. 17/06', ownerId: 'hmarchand', done: false });
    expect((await changeLog('audit_plan_item', june.id)).map((l) => l.action)).toEqual(['create']);

    const placeholder = await savePlanItem({}, form({ year: '2027', track: REVIEW_TRACK, month: '3', label: 'Revue T1' }));
    expect(placeholder).toMatchObject({ ok: true });
    const march = await createReview({}, form({ reviewOn: '2027-03-18', kind: 'ordinaire' }));
    const adopted = await planOf(+march.id!);
    expect(adopted).toMatchObject({ id: +placeholder.id!, plannedOn: '2027-03-18', label: 'Annuelle 18/03', detail: 'Revue de direction annuelle', ownerId: 'hmarchand' });
    expect(await lastLog('audit_plan_item', adopted.id)).toMatchObject({ action: 'link', summary: 'Rattaché à la revue du 18/03/2027', byId: 'clefevre' });
    const card = await loadReviewCard({ revue: march.id });
    expect(card.programme).toMatchObject({ id: adopted.id, year: 2027, label: 'Annuelle 18/03', stateLabel: 'À venir' });
  });

  it('revue reportée : son échéance suit (première date conservée) ; mois occupé refusé', async () => {
    actAs('Animateur QHSE');
    const annual = await reviewOn('2026-12-10');
    const before = await planOf(annual.id);
    expect(await rescheduleReview({}, form({ id: String(annual.id), to: '2027-01-14' }))).toEqual({ ok: true });
    expect(await planOf(annual.id)).toMatchObject({ id: before.id, year: 2027, month: 1, plannedOn: '2027-01-14', label: 'Annuelle 14/01', postponedFrom: '2026-12-10' });
    expect(await lastLog('audit_plan_item', before.id)).toMatchObject({
      action: 'update', summary: 'Reporté au 14/01/2027 (revue de direction)', byId: 'clefevre',
      details: expect.arrayContaining([{ field: 'Mois', from: 'décembre', to: 'janvier' }, { field: 'Année', from: '2026', to: '2027' }]),
    });
    const clash = await rescheduleReview({}, form({ id: String(annual.id), to: '2026-06-25' }));
    expect(clash.error).toContain('« Interm. 18/06 »');
    expect((await reviewOn('2027-01-14')).id).toBe(annual.id);
  });

  it('revue annulée : son échéance est annulée avec elle, motif et journal (AUD-30)', async () => {
    actAs('Animateur QHSE');
    const june = await reviewOn('2027-06-17');
    const item = await planOf(june.id);
    expect(await cancelReview({}, form({ id: String(june.id) }))).toMatchObject({ fieldErrors: { reason: 'Motif obligatoire.' } });
    expect(await cancelReview({}, form({ id: String(june.id), reason: 'Regroupée avec la revue annuelle' }))).toEqual({ ok: true });
    expect(await planOf(june.id)).toMatchObject({ id: item.id, cancelledById: 'clefevre', cancelReason: 'Revue de direction annulée : Regroupée avec la revue annuelle' });
    expect(await lastLog('review', june.id)).toMatchObject({ action: 'cancel', reason: 'Regroupée avec la revue annuelle' });
    expect(await lastLog('audit_plan_item', item.id)).toMatchObject({ action: 'cancel', reason: 'Revue de direction annulée : Regroupée avec la revue annuelle' });
  });
});
