import { describe, expect, it } from 'vitest';
import { form } from '../next-mocks';
import { actAs, changeLog, freshDemoDatabase, lastLog } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadAudits } from '@/lib/data/audits';
import { loadReviewCard } from '@/lib/data/review';
import { saveFinding, savePlanItem } from '@/server/audits';
import { closeReview } from '@/server/review';

// Paquet 4 — audits et revue de direction : constats sur un audit réalisé et date « Réalisé le » jamais perdue (AUD-11),
// plus de libellé d'audit codé en dur (AUD-07), contrôles avant le visa (AUD-14), visa réservé à la direction (AUD-15).

freshDemoDatabase();

const DENIED = 'Votre rôle ne permet pas cette modification.';

async function planItem(label: string) {
  const [p] = await (await getDb()).select().from(t.auditPlanItems).where(eq(t.auditPlanItems.label, label));
  if (!p) throw new Error(`élément ${label} introuvable`);
  return p;
}
/** Formulaire de modification d'un élément du programme, repris de la ligne (comme ProgramTimeline). */
const planForm = (p: typeof t.auditPlanItems.$inferSelect, over: Record<string, string> = {}) => form({
  id: String(p.id), track: p.track, label: p.label, detail: p.detail ?? '', ownerId: p.ownerId ?? '', auditor: p.auditor ?? '', scope: p.scope ?? '',
  certificationId: p.certificationId ?? '', done: p.done ? 'on' : '', doneOn: p.doneOn ?? '', ...over,
});

describe('AUD-07 et AUD-11 : constats d’audit', () => {
  it('audits proposés : réalisés seulement (aucun libellé par défaut)', async () => {
    actAs('Animateur QHSE');
    const data = await loadAudits({ year: '2026' });
    const be = await planItem('BE · 17/10');
    const production = await planItem('Production');
    expect(data.auditOptions.some(([v]) => v === String(be.id))).toBe(false);
    expect(data.auditOptions.some(([v]) => v === String(production.id))).toBe(true);
  });

  it('constat sur un audit à venir refusé ; sur un audit réalisé, enregistré et journalisé ; rôles en consultation refusés', async () => {
    const be = await planItem('BE · 17/10');
    const production = await planItem('Production');
    actAs('Chef de service');
    expect(await saveFinding({}, form({ planItemId: String(production.id), kind: 'piste', text: 'x' }))).toEqual({ error: DENIED });
    actAs('Animateur QHSE');
    expect(await saveFinding({}, form({ planItemId: String(be.id), kind: 'piste', text: 'Revue de conception à formaliser' }))).toEqual({
      error: "Cet audit n'est pas réalisé : déclarez-le réalisé dans le programme avant d'en saisir les constats.",
      fieldErrors: { planItemId: 'Choisissez un audit réalisé.' },
    });
    const ok = await saveFinding({}, form({ planItemId: String(production.id), kind: 'piste', text: 'Repères de traçabilité à harmoniser' }));
    expect(ok).toMatchObject({ ok: true });
    expect(await lastLog('audit_finding', Number(ok.id))).toMatchObject({ action: 'create', byId: 'clefevre' });
    const [row] = await (await getDb()).select().from(t.auditFindings).where(eq(t.auditFindings.id, Number(ok.id)));
    expect(row).toMatchObject({ planItemId: production.id, foundOn: '2026-06-11' });
  });

  it('constat existant d’un audit redevenu « à réaliser » : il garde son audit à la modification', async () => {
    actAs('Animateur QHSE');
    const be = await planItem('BE · 17/10');
    const db = await getDb();
    const [legacy] = await db.insert(t.auditFindings).values({ audit: 'BE', planItemId: be.id, kind: 'piste', text: 'Constat repris', foundOn: '2026-09-01' }).returning();
    expect(await saveFinding({}, form({ id: String(legacy.id), planItemId: String(be.id), kind: 'piste', text: 'Constat repris (corrigé)' }))).toMatchObject({ ok: true });
    expect(await lastLog('audit_finding', legacy.id)).toMatchObject({ action: 'update', summary: 'Constat modifié' });
  });

  it('« Réalisé le » sans la case cochée : refusé (jamais perdu en silence) ; annuler une réalisation garde sa date affichée', async () => {
    actAs('Animateur QHSE');
    const be = await planItem('BE · 17/10');
    const before = (await changeLog('audit_plan_item', be.id)).length;
    expect(await savePlanItem({}, planForm(be, { doneOn: '2026-10-08' }))).toMatchObject({ fieldErrors: { doneOn: 'Cochez « Réalisé » pour enregistrer cette date, ou effacez-la.' } });
    expect((await planItem('BE · 17/10')).done).toBe(false);
    expect(await changeLog('audit_plan_item', be.id)).toHaveLength(before);
    expect(await savePlanItem({}, planForm(be, { done: 'on', doneOn: '2026-10-08' }))).toMatchObject({ ok: true });
    expect(await planItem('BE · 17/10')).toMatchObject({ done: true, doneOn: '2026-10-08' });
    expect(await lastLog('audit_plan_item', be.id)).toMatchObject({ summary: 'Réalisé le 08/10/2026', byId: 'clefevre' });
    // Case décochée, date préremplie inchangée : la réalisation est annulée (journalisée).
    const done = await planItem('BE · 17/10');
    expect(await savePlanItem({}, planForm(done, { done: '' }))).toMatchObject({ ok: true });
    expect(await planItem('BE · 17/10')).toMatchObject({ done: false, doneOn: null });
    expect(await lastLog('audit_plan_item', be.id)).toMatchObject({ summary: 'Réalisation annulée' });
  });
});

describe('AUD-14 et AUD-15 : visa de la revue de direction', () => {
  it('visa réservé à la direction ; participants, synthèse et pilotes des décisions exigés ; journal', async () => {
    const db = await getDb();
    const [review] = await db.insert(t.reviews).values({ reviewOn: '2026-09-24', kind: 'intermediaire', status: 'tenue', minutes: null }).returning();
    await db.insert(t.reviewDecisions).values({ reviewId: review.id, kind: 'decision', text: 'Renforcer le contrôle final', pilotId: null });

    actAs('Chef de service', 'all');
    expect(await closeReview(review.id)).toEqual({ error: "Réservé à l'animateur QHSE et à la direction." });
    actAs('Animateur QHSE', 'all');
    expect(await closeReview(review.id)).toEqual({ error: 'Visa réservé à la direction.' });
    const qhseCard = await loadReviewCard({ revue: String(review.id) });
    expect(qhseCard.flags).toMatchObject({ canApprove: true, canSign: false });

    actAs('Direction', 'all');
    const card = await loadReviewCard({ revue: String(review.id) });
    expect(card.flags).toMatchObject({ canSign: true });
    expect(card.flags.closeBlockers).toEqual([
      "Indiquez au compte rendu les participants de l'entreprise.",
      'Rédigez la synthèse de la séance au compte rendu.',
      'Désignez le pilote de la décision « Renforcer le contrôle final ».',
    ]);
    expect(await closeReview(review.id)).toEqual({ error: card.flags.closeBlockers.join(' ') });
    expect((await db.select().from(t.reviews).where(eq(t.reviews.id, review.id)))[0].status).toBe('tenue');
    expect(await changeLog('review', review.id)).toEqual([]);

    await db.update(t.reviews).set({ participantIds: ['hmarchand', 'clefevre'], minutes: 'Séance de septembre' }).where(eq(t.reviews.id, review.id));
    await db.update(t.reviewDecisions).set({ pilotId: 'lmoreau' }).where(eq(t.reviewDecisions.reviewId, review.id));
    expect((await loadReviewCard({ revue: String(review.id) })).flags.closeBlockers).toEqual([]);
    expect(await closeReview(review.id)).toEqual({});
    expect((await db.select().from(t.reviews).where(eq(t.reviews.id, review.id)))[0]).toMatchObject({ status: 'cloturee', closedById: 'hmarchand' });
    expect(await lastLog('review', review.id)).toMatchObject({ action: 'status', byId: 'hmarchand' });
  });
});
