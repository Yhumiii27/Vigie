'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, gt, isNull, ne, or } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { REVIEW_TRACK } from '@/components/audits/shared';
import { planStart, relabelDay, reviewSlot } from '@/lib/data/audits';
import { fmtDate, fmtDayMonth, monthName, monthOf, yearOf } from '@/lib/dates';
import { today } from '@/lib/today';
import {
  REVIEW_DECISION_KEYS, REVIEW_DECISION_KINDS, REVIEW_KINDS, REVIEW_KIND_KEYS, REVIEW_SOURCES, REVIEW_SOURCE_KEYS, canEdit, canSignReview,
  type ReviewKind, type ReviewSource,
} from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireManager } from '@/lib/guard';
import { ALL_SITES, getSession } from '@/lib/session';
import {
  buildReviewDossier, followingReview, isEditableReview, parseReviewSnapshot, reviewRecordParts, withRecordParts, type Review, type ReviewSnapshot,
} from '@/lib/data/review';
import { reviewCloseBlockers } from '@/lib/review-rules';
import { diffFields, logChange } from './changelog';

type Result = { error?: string };
type PlanRow = typeof t.auditPlanItems.$inferSelect;

const DENIED = 'Votre rôle ne permet pas cette modification.';
const NOT_FOUND = 'Revue introuvable.';
const SIGNER_ONLY = 'Visa réservé à la direction.';
/** Dossier de séance et dossier du visa : tout le périmètre (AUD-06). */
const SEANCE_ALL_SITES = 'Sélectionnez « Tous les sites » : le dossier de séance, figé à la saisie du compte rendu, couvre tout le périmètre.';

// Le journal reçoit l'auteur explicitement (byId) : sans cela, logChange relit la session hors de la transaction.

/** Préparation et compte rendu : rôles qui saisissent sur l'écran « Audits » (canEdit ; consultation seule pour l'encadrement, AUD-02). */
async function requireReviewEditor() {
  const r = await requireManager();
  if (r.error) return r;
  return canEdit(r.session.role, 'audits') ? r : { ...r, error: DENIED };
}

/** Visa de la direction (clôture, dossier figé) : la direction seulement (AUD-15). */
async function requireReviewSigner() {
  const r = await requireApprover();
  if (r.error) return r;
  return canSignReview(r.session.role) && canEdit(r.session.role, 'audits') ? r : { ...r, error: SIGNER_ONLY };
}

/** Annulation d'une revue planifiée : animateur QHSE et direction. */
async function requireReviewApprover() {
  const r = await requireApprover();
  if (r.error) return r;
  return canEdit(r.session.role, 'audits') ? r : { ...r, error: DENIED };
}

/** Identifiant numérique reçu du client (les server actions sont appelables avec n'importe quelle valeur). */
const validId = (id: unknown): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0;
const nextSort = (rows: { sort: number }[]) => Math.max(-1, ...rows.map((r) => r.sort)) + 1;
const done = () => revalidatePath('/', 'layout');
const kindKey = (k: string): ReviewKind => (k in REVIEW_KINDS ? (k as ReviewKind) : 'ordinaire');

async function findReview(db: DbOrTx, id: number) {
  const [r] = await db.select().from(t.reviews).where(eq(t.reviews.id, id));
  return r;
}

/** Une seule revue non annulée par date. */
async function dateTaken(db: DbOrTx, on: string, exceptId?: number) {
  const rows = await db.select({ id: t.reviews.id }).from(t.reviews)
    .where(and(eq(t.reviews.reviewOn, on), ne(t.reviews.status, 'annulee'), exceptId ? ne(t.reviews.id, exceptId) : undefined));
  return rows.length > 0;
}

async function validPerson(db: DbOrTx, id: string | null) {
  if (!id) return true;
  const [p] = await db.select({ id: t.people.id }).from(t.people).where(eq(t.people.id, id));
  return !!p;
}

// ─── Programme annuel : échéance de la revue (AUD-01) ───────────────────────
// L'échéance porte la revue (audit_plan_items.review_id) : sa date, sa réalisation et son annulation suivent la revue, et
// chaque changement fait par la revue est inscrit au journal de l'élément (AUD-10).

/** Échéance du programme portée par la revue. */
async function planItemOf(db: DbOrTx, reviewId: number): Promise<PlanRow | undefined> {
  const [p] = await db.select().from(t.auditPlanItems).where(eq(t.auditPlanItems.reviewId, reviewId));
  return p;
}

/** Responsable de l'échéance du programme : la direction (dernier rôle connu, présente à l'effectif), sinon `fallbackId`. */
async function directorId(tx: DbOrTx, fallbackId: string) {
  const [d] = await tx.select({ id: t.people.id }).from(t.people)
    .where(and(eq(t.people.lastRole, 'Direction'), or(isNull(t.people.leftOn), gt(t.people.leftOn, today()))))
    .orderBy(asc(t.people.sort)).limit(1);
  return d?.id ?? fallbackId;
}

const planLabel = (kind: ReviewKind, on: string) => `${REVIEW_KINDS[kind].short} ${fmtDayMonth(on)}`;
const planDetail = (kind: ReviewKind) => (kind === 'ordinaire' ? 'Revue de direction annuelle' : 'Revue de direction intermédiaire');
const shownDate = (d: string | null) => (d ? fmtDate(d) : null);

/**
 * Inscrit la revue au programme annuel (reviewSlot) : reprend l'échéance de revue saisie au seul programme ce mois-là, sinon
 * la crée sur la ligne « Revues de direction » si ce mois y est libre ; sinon la revue reste « hors programme ». Sans effet
 * pour une revue déjà rattachée.
 */
async function ensurePlanItem(tx: DbOrTx, review: Pick<Review, 'id' | 'reviewOn' | 'kind'>, byId: string) {
  if (await planItemOf(tx, review.id)) return;
  const on = review.reviewOn;
  const kind = kindKey(review.kind);
  const year = yearOf(on);
  const month = monthOf(on);
  const items = await tx.select().from(t.auditPlanItems).where(and(eq(t.auditPlanItems.year, year), eq(t.auditPlanItems.month, month)));
  const slot = reviewSlot(items, on);
  if ('taken' in slot) return;
  if ('adopt' in slot) {
    const p = items.find((i) => i.id === slot.adopt)!;
    const values = { reviewId: review.id, plannedOn: on, year, month, label: planLabel(kind, on), detail: p.detail ?? planDetail(kind), ownerId: p.ownerId ?? await directorId(tx, byId) };
    await tx.update(t.auditPlanItems).set(values).where(eq(t.auditPlanItems.id, p.id));
    await logChange(tx, {
      entityType: 'audit_plan_item', entityId: p.id, action: 'link', byId, summary: `Rattaché à la revue du ${fmtDate(on)}`,
      details: diffFields({ plannedOn: shownDate(p.plannedOn), label: p.label }, { plannedOn: shownDate(on), label: values.label }, { plannedOn: 'Date prévue', label: 'Libellé court' }),
    });
    return;
  }
  const [row] = await tx.insert(t.auditPlanItems).values({
    track: REVIEW_TRACK, year, month, plannedOn: on, label: planLabel(kind, on), detail: planDetail(kind), ownerId: await directorId(tx, byId), reviewId: review.id,
  }).returning({ id: t.auditPlanItems.id });
  await logChange(tx, {
    entityType: 'audit_plan_item', entityId: row.id, action: 'create', byId,
    summary: `Ajouté au programme ${year} (${REVIEW_TRACK}, ${monthName(month)}) · revue du ${fmtDate(on)}`,
  });
}

/** Le programme n'admet qu'un élément en vigueur par ligne et par mois : message d'erreur si le déplacement de l'échéance entre en conflit. */
async function planClash(db: DbOrTx, linked: PlanRow | undefined, to: string) {
  if (!linked) return null;
  const [clash] = await db.select({ label: t.auditPlanItems.label }).from(t.auditPlanItems)
    .where(and(eq(t.auditPlanItems.year, yearOf(to)), eq(t.auditPlanItems.track, linked.track), eq(t.auditPlanItems.month, monthOf(to)),
      isNull(t.auditPlanItems.cancelledAt), ne(t.auditPlanItems.id, linked.id)));
  return clash
    ? `Le programme annuel prévoit déjà « ${clash.label} » en ${monthName(monthOf(to))} ${yearOf(to)} sur la ligne « ${linked.track} ». Libérez ce mois dans le programme ou choisissez une autre date.`
    : null;
}

/**
 * Déplace la revue et son échéance du programme (date prévue, mois, année, date reprise dans le libellé court, date de
 * réalisation d'une échéance réalisée). `postpone` : report de la revue — la première planification de l'échéance est
 * conservée (postponedFrom). Revue sans échéance : inscrite au programme à la nouvelle date si possible.
 */
async function moveReview(tx: DbOrTx, review: Pick<Review, 'id' | 'reviewOn' | 'kind'>, to: string, opts: { postpone: boolean; byId: string; note?: string }) {
  await tx.update(t.reviews).set({ reviewOn: to }).where(eq(t.reviews.id, review.id));
  const linked = await planItemOf(tx, review.id);
  if (!linked) {
    await ensurePlanItem(tx, { ...review, reviewOn: to }, opts.byId);
    return;
  }
  if (linked.plannedOn === to && linked.year === yearOf(to) && linked.month === monthOf(to)) return;
  const values = {
    plannedOn: to, year: yearOf(to), month: monthOf(to), label: relabelDay(linked.label, linked.plannedOn, to),
    ...(linked.done ? { doneOn: to } : {}),
    ...(opts.postpone ? { postponedFrom: linked.postponedFrom ?? planStart(linked) } : {}),
  };
  await tx.update(t.auditPlanItems).set(values).where(eq(t.auditPlanItems.id, linked.id));
  await logChange(tx, {
    entityType: 'audit_plan_item', entityId: linked.id, action: 'update', byId: opts.byId,
    summary: `${opts.postpone ? 'Reporté' : 'Date corrigée'} au ${fmtDate(to)} (revue de direction${opts.note ? ` · ${opts.note}` : ''})`,
    details: diffFields(
      { month: monthName(linked.month), plannedOn: shownDate(linked.plannedOn), year: String(linked.year), doneOn: shownDate(linked.doneOn) },
      { month: monthName(values.month), plannedOn: shownDate(to), year: String(values.year), doneOn: shownDate(linked.done ? to : linked.doneOn) },
      { month: 'Mois', plannedOn: 'Date prévue', year: 'Année', doneOn: 'Réalisé le' },
    ),
  });
}

/** Reprend la check-list d'une revue (libellés, sources, contributeurs) : tout est à refournir, sans date de remise. */
async function copyChecklist(tx: DbOrTx, fromId: number, toId: number) {
  const items = await tx.select().from(t.reviewItems).where(eq(t.reviewItems.reviewId, fromId));
  if (!items.length) return 0;
  await tx.insert(t.reviewItems).values(items.map((i) => ({
    reviewId: toId, label: i.label, source: i.source, ownerId: i.ownerId, owner: i.owner, sort: i.sort, done: false, dueOn: null,
  })));
  return items.length;
}

// ─── Cycle de vie de la revue ───────────────────────────────────────────────

export async function createReview(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error, session } = await requireReviewEditor();
  if (error) return { error };
  const f = formReader(fd);
  const reviewOn = f.date('reviewOn', { required: true });
  const kind = f.oneOf('kind', REVIEW_KIND_KEYS) ?? 'ordinaire';
  const copyFrom = f.int('copyFrom', { min: 1 });
  const copyItems = f.bool('copyItems');
  if (!f.ok) return f.state();

  const db = await getDb();
  if (await dateTaken(db, reviewOn!)) return { error: `Une revue est déjà prévue le ${fmtDate(reviewOn!)}.`, fieldErrors: { reviewOn: 'Date déjà occupée.' } };
  const source = copyItems && copyFrom ? await findReview(db, copyFrom) : undefined;
  const id = await db.transaction(async (tx) => {
    const [row] = await tx.insert(t.reviews).values({ reviewOn: reviewOn!, kind }).returning({ id: t.reviews.id });
    const copied = source ? await copyChecklist(tx, source.id, row.id) : 0;
    await logChange(tx, {
      byId: session.user.id,
      entityType: 'review', entityId: row.id, action: 'create',
      summary: `${REVIEW_KINDS[kind].label} planifiée le ${fmtDate(reviewOn!)}${copied ? ` · check-list reprise de la revue du ${fmtDate(source!.reviewOn)} (${copied} éléments)` : ''}`,
    });
    await ensurePlanItem(tx, { id: row.id, reviewOn: reviewOn!, kind }, session.user.id);
    return row.id;
  });
  done();
  return { ok: true, id: String(id) };
}

export async function rescheduleReview(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error, session } = await requireReviewEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const to = f.date('to', { required: true });
  // Motif du report (QUA-22), comme le report d'un élément du programme (AUD-03).
  const reason = f.reason();
  if (!f.ok) return f.state();

  const db = await getDb();
  const review = await findReview(db, id!);
  if (!review) return { error: NOT_FOUND };
  if (review.status !== 'planifiee') return { error: 'Seule une revue planifiée peut être reportée.' };
  if (review.reviewOn === to) return { ok: true };
  if (await dateTaken(db, to!, review.id)) return { error: `Une revue est déjà prévue le ${fmtDate(to!)}.`, fieldErrors: { to: 'Date déjà occupée.' } };
  const clash = await planClash(db, await planItemOf(db, review.id), to!);
  if (clash) return { error: clash, fieldErrors: { to: 'Mois déjà occupé au programme annuel.' } };

  await db.transaction(async (tx) => {
    await moveReview(tx, review, to!, { postpone: true, byId: session.user.id });
    await logChange(tx, {
      byId: session.user.id,
      entityType: 'review', entityId: review.id, action: 'update', summary: `Revue reportée au ${fmtDate(to!)}`, reason,
      details: [{ field: 'Date', from: fmtDate(review.reviewOn), to: fmtDate(to!) }],
    });
  });
  done();
  return { ok: true };
}

/**
 * Compte rendu de la séance (saisie, puis correction tant que la revue n'est pas clôturée) : la revue passe « tenue »,
 * son échéance du programme est réalisée, et la prochaine revue (date et type) est créée avec la check-list reprise.
 * À la première saisie (ou quand la date de la séance change), le dossier de séance est figé, indicateurs arrêtés à la
 * date de la séance (AUD-06) : il couvre tout le périmètre (« Tous les sites »).
 */
export async function holdReview(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error, session } = await requireReviewEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reviewOn = f.date('reviewOn', { required: true });
  const participantIds = [...new Set(f.list('participantIds'))];
  const externalParticipants = f.str('externalParticipants', { max: 300 }) || null;
  const customerPerception = f.str('customerPerception', { max: 2000 }) || null;
  const resourceNeeds = f.str('resourceNeeds', { max: 2000 }) || null;
  const minutes = f.str('minutes', { max: 4000 }) || null;
  const nextReviewOn = f.date('nextReviewOn');
  const nextKind = f.oneOf('nextKind', REVIEW_KIND_KEYS) ?? 'ordinaire';
  const now = today();
  if (reviewOn && reviewOn > now) f.fail('reviewOn', "La revue n'a pas encore eu lieu.");
  if (reviewOn && nextReviewOn && nextReviewOn <= reviewOn) f.fail('nextReviewOn', 'La prochaine revue doit suivre celle-ci.');
  if (!f.ok) return f.state();

  const db = await getDb();
  const review = await findReview(db, id!);
  if (!review) return { error: NOT_FOUND };
  if (!isEditableReview(review)) return { error: 'Revue clôturée ou annulée : compte rendu figé.' };
  const snap = parseReviewSnapshot(review.snapshot);
  // Dossier de séance à figer : première saisie, date de séance corrigée, ou revue tenue avant le lot 2 (sans dossier de séance).
  const freeze = review.status === 'planifiee' || reviewOn !== review.reviewOn || snap?.phase !== 'seance';
  if (freeze && session.site.id !== ALL_SITES) return { error: SEANCE_ALL_SITES };
  const people = new Set((await db.select({ id: t.people.id }).from(t.people)).map((p) => p.id));
  if (participantIds.some((p) => !people.has(p))) return { error: 'Participant introuvable.', fieldErrors: { participantIds: 'Choisissez des personnes de la liste.' } };
  const linked = await planItemOf(db, review.id);
  if (reviewOn !== review.reviewOn) {
    if (await dateTaken(db, reviewOn!, review.id)) return { error: `Une autre revue est enregistrée le ${fmtDate(reviewOn!)}.`, fieldErrors: { reviewOn: 'Date déjà occupée.' } };
    const clash = await planClash(db, linked, reviewOn!);
    if (clash) return { error: clash, fieldErrors: { reviewOn: 'Mois déjà occupé au programme annuel.' } };
  }

  // Prochaine revue : déjà enregistrée à cette date (rien à faire), sinon la revue planifiée qui suit celle-ci est
  // déplacée — celle d'un compte rendu précédent, ou planifiée par « Préparer la prochaine revue » — ; créée à défaut.
  const reviews: Review[] = await db.select().from(t.reviews);
  const live = (r: Review) => r.status !== 'annulee' && r.id !== review.id;
  const nextExisting = nextReviewOn ? reviews.find((r) => live(r) && r.reviewOn === nextReviewOn) : undefined;
  const recorded = review.nextReviewOn ? reviews.find((r) => live(r) && r.status === 'planifiee' && r.reviewOn === review.nextReviewOn) : undefined;
  const following = followingReview(reviews, { id: review.id, reviewOn: reviewOn! });
  const plannedNext = recorded ?? (following?.status === 'planifiee' ? following : undefined);
  if (!nextReviewOn && plannedNext) {
    return {
      error: `La revue du ${fmtDate(plannedNext.reviewOn)} est planifiée : indiquez-la comme prochaine revue (ou une autre date pour la reporter), ou faites-la annuler avant d'effacer cette date.`,
      fieldErrors: { nextReviewOn: 'Prochaine revue déjà planifiée.' },
    };
  }
  if (nextReviewOn && !nextExisting && plannedNext) {
    const clash = await planClash(db, await planItemOf(db, plannedNext.id), nextReviewOn);
    if (clash) return { error: clash, fieldErrors: { nextReviewOn: 'Mois déjà occupé au programme annuel.' } };
  }

  const values = { participantIds, externalParticipants, customerPerception, resourceNeeds, minutes, nextReviewOn, status: 'tenue', recordedById: session.user.id };
  // Dossier de séance, calculé avant l'écriture (chargements lourds, jamais dans la transaction) pour la revue telle qu'elle sera.
  let seance: ReviewSnapshot | null = null;
  if (freeze) {
    const held: Review = { ...review, ...values, reviewOn: reviewOn! };
    const dossier = await buildReviewDossier(held, reviews.map((r) => (r.id === review.id ? held : r)), { asOf: reviewOn! });
    seance = { version: 2, phase: 'seance', asOf: reviewOn!, takenOn: now, takenBy: session.user.name, dossier };
  }
  const byId = session.user.id;
  const firstHold = review.status !== 'tenue';
  const saved = await db.transaction(async (tx) => {
    const rows = await tx.update(t.reviews).set({ ...values, ...(seance ? { snapshot: seance } : {}) })
      .where(and(eq(t.reviews.id, review.id), eq(t.reviews.status, review.status))).returning({ id: t.reviews.id });
    if (!rows.length) return false;
    if (reviewOn !== review.reviewOn) await moveReview(tx, review, reviewOn!, { postpone: false, byId, note: 'séance tenue à une autre date' });
    else if (!linked) await ensurePlanItem(tx, review, byId);
    const item = await planItemOf(tx, review.id);
    if (item && !item.done) {
      await tx.update(t.auditPlanItems).set({ done: true, doneOn: reviewOn! }).where(eq(t.auditPlanItems.id, item.id));
      await logChange(tx, { entityType: 'audit_plan_item', entityId: item.id, action: 'status', summary: `Réalisé (revue tenue le ${fmtDate(reviewOn!)})`, byId });
    }
    await logChange(tx, {
      byId,
      entityType: 'review', entityId: review.id, action: firstHold ? 'status' : 'update',
      summary: (firstHold ? `Revue tenue le ${fmtDate(reviewOn!)} · compte rendu saisi` : 'Compte rendu modifié')
        + (seance ? ` · dossier de séance figé (indicateurs arrêtés au ${fmtDate(reviewOn!)})` : ''),
      details: reviewOn !== review.reviewOn ? [{ field: 'Date', from: fmtDate(review.reviewOn), to: fmtDate(reviewOn!) }] : undefined,
    });

    if (!nextReviewOn || nextExisting) return true;
    if (plannedNext) {
      await moveReview(tx, plannedNext, nextReviewOn, { postpone: true, byId, note: `compte rendu du ${fmtDate(reviewOn!)}` });
      await tx.update(t.reviews).set({ kind: nextKind }).where(eq(t.reviews.id, plannedNext.id));
      await logChange(tx, { byId, entityType: 'review', entityId: plannedNext.id, action: 'update', summary: `Revue reportée au ${fmtDate(nextReviewOn)} (compte rendu du ${fmtDate(reviewOn!)})` });
      return true;
    }
    const [next] = await tx.insert(t.reviews).values({ reviewOn: nextReviewOn, kind: nextKind }).returning({ id: t.reviews.id });
    await copyChecklist(tx, review.id, next.id);
    await logChange(tx, { byId, entityType: 'review', entityId: next.id, action: 'create', summary: `${REVIEW_KINDS[nextKind].label} planifiée le ${fmtDate(nextReviewOn)} (compte rendu du ${fmtDate(reviewOn!)})` });
    await ensurePlanItem(tx, { id: next.id, reviewOn: nextReviewOn, kind: nextKind }, byId);
    return true;
  });
  if (!saved) return { error: 'Revue modifiée entre-temps : rechargez la page.' };
  done();
  return { ok: true };
}

/**
 * Visa de la direction : la revue est clôturée et son dossier figé (instantané JSON, plus jamais modifié). Dossier de séance
 * existant : ses sections, complétées du compte rendu courant ; revue tenue avant le lot 2 : dossier calculé maintenant,
 * indicateurs arrêtés à la date de la séance (AUD-06).
 */
export async function closeReview(id: number): Promise<Result> {
  const { error, session } = await requireReviewSigner();
  if (error) return { error };
  if (!validId(id)) return { error: NOT_FOUND };
  if (session.site.id !== ALL_SITES) return { error: 'Sélectionnez « Tous les sites » : le dossier archivé couvre tout le périmètre.' };
  const db = await getDb();
  const reviews: Review[] = await db.select().from(t.reviews);
  const review = reviews.find((r) => r.id === id);
  if (!review) return { error: NOT_FOUND };
  // AUD-14 : compte rendu complet (participants, synthèse) et décisions pilotées avant le visa.
  const decisions = await db.select({ text: t.reviewDecisions.text, pilotId: t.reviewDecisions.pilotId }).from(t.reviewDecisions)
    .where(eq(t.reviewDecisions.reviewId, review.id));
  const blockers = reviewCloseBlockers({ ...review, participantIds: review.participantIds as string[] }, decisions);
  if (blockers.length) return { error: blockers.join(' ') };

  const now = today();
  const seance = parseReviewSnapshot(review.snapshot);
  const fromSeance = seance?.phase === 'seance' ? seance : null;
  const asOf = fromSeance?.asOf ?? review.reviewOn;
  const base = fromSeance
    ? withRecordParts(fromSeance.dossier, await reviewRecordParts(review, reviews, asOf))
    : await buildReviewDossier(review, reviews, { asOf });
  const snapshot: ReviewSnapshot = {
    version: 2, phase: 'cloture', asOf, takenOn: now, takenBy: session.user.name,
    ...(fromSeance ? { seance: { takenOn: fromSeance.takenOn, takenBy: fromSeance.takenBy } } : {}),
    dossier: { ...base, header: { ...base.header, status: 'cloturee' }, record: { ...base.record, closedBy: session.user.name, closedOn: now } },
  };
  await db.transaction(async (tx) => {
    const rows = await tx.update(t.reviews).set({ status: 'cloturee', closedOn: now, closedById: session.user.id, snapshot })
      .where(and(eq(t.reviews.id, id), eq(t.reviews.status, 'tenue'))).returning({ id: t.reviews.id });
    if (!rows.length) return;
    await logChange(tx, {
      byId: session.user.id, entityType: 'review', entityId: id, action: 'status',
      summary: `Revue clôturée · visa de la direction, dossier figé (indicateurs arrêtés au ${fmtDate(asOf)})`,
    });
  });
  done();
  return {};
}

/** Annulation d'une revue planifiée (motif obligatoire) : son échéance du programme est annulée avec elle (AUD-30). */
export async function cancelReview(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error, session } = await requireReviewApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();

  const db = await getDb();
  const review = await findReview(db, id!);
  if (!review) return { error: NOT_FOUND };
  if (review.status !== 'planifiee') return { error: 'Seule une revue planifiée peut être annulée.' };
  const byId = session.user.id;
  const cancelled = await db.transaction(async (tx) => {
    const rows = await tx.update(t.reviews).set({ status: 'annulee', cancelledAt: new Date(), cancelledById: byId, cancelReason: reason })
      .where(and(eq(t.reviews.id, review.id), eq(t.reviews.status, 'planifiee'))).returning({ id: t.reviews.id });
    if (!rows.length) return false;
    await logChange(tx, { byId, entityType: 'review', entityId: review.id, action: 'cancel', summary: `Revue du ${fmtDate(review.reviewOn)} annulée`, reason });
    const item = await planItemOf(tx, review.id);
    if (item && !item.cancelledAt && !item.done) {
      const itemReason = `Revue de direction annulée : ${reason}`;
      await tx.update(t.auditPlanItems).set({ cancelledAt: new Date(), cancelledById: byId, cancelReason: itemReason }).where(eq(t.auditPlanItems.id, item.id));
      await logChange(tx, {
        byId, entityType: 'audit_plan_item', entityId: item.id, action: 'cancel', reason: itemReason,
        summary: `Annulé avec la revue du ${fmtDate(review.reviewOn)} · retiré du programme ${item.year}`,
      });
    }
    return true;
  });
  if (!cancelled) return { error: 'Seule une revue planifiée peut être annulée.' };
  done();
  return { ok: true };
}

// ─── Check-list de préparation ──────────────────────────────────────────────

async function itemWithReview(db: DbOrTx, id: number) {
  const [row] = await db.select({ item: t.reviewItems, review: t.reviews }).from(t.reviewItems)
    .innerJoin(t.reviews, eq(t.reviewItems.reviewId, t.reviews.id)).where(eq(t.reviewItems.id, id));
  return row;
}

/**
 * « Fourni » / « à fournir » : rôles qui saisissent sur l'écran Audits, ou le contributeur de l'élément lui-même, quel que
 * soit son rôle (AUD-04, « Mes contributions »).
 */
export async function setReviewItemDone(id: number, isDone: boolean): Promise<Result> {
  const session = await getSession();
  if (!validId(id) || typeof isDone !== 'boolean') return { error: 'Élément introuvable.' };
  const db = await getDb();
  const row = await itemWithReview(db, id);
  if (!row) return { error: 'Élément introuvable.' };
  const editor = canEdit(session.role, 'audits');
  const contributor = !!row.item.ownerId && row.item.ownerId === session.user.id;
  if (!editor && !contributor) return { error: DENIED };
  if (REVIEW_SOURCES[row.item.source as ReviewSource]?.auto) return { error: 'Élément calculé par Vigie.' };
  if (!isEditableReview(row.review)) return { error: 'Revue clôturée ou annulée : check-list figée.' };
  await db.transaction(async (tx) => {
    await tx.update(t.reviewItems).set({ done: isDone }).where(eq(t.reviewItems.id, id));
    await logChange(tx, {
      byId: session.user.id, entityType: 'review', entityId: row.review.id, action: 'update',
      summary: `« ${row.item.label} » ${isDone ? 'fourni' : 'à fournir'}${contributor ? ` (contributeur : ${session.user.name})` : ''}`,
    });
  });
  done();
  return {};
}

export async function saveReviewItem(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error, session } = await requireReviewEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { min: 1 });
  const reviewId = id ? null : f.int('reviewId', { required: true, min: 1 });
  const label = f.str('label', { required: true, max: 160 });
  const source = f.oneOf('source', REVIEW_SOURCE_KEYS) ?? 'manuel';
  const ownerId = f.opt('ownerId');
  const owner = f.str('owner', { max: 80 });
  const dueOn = f.date('dueOn');
  if (!f.ok) return f.state();

  const db = await getDb();
  if (!(await validPerson(db, ownerId))) return { error: 'Contributeur introuvable.', fieldErrors: { ownerId: 'Choisissez une personne de la liste.' } };
  const auto = REVIEW_SOURCES[source].auto;
  // Élément automatique : fourni par Vigie, sans contributeur ni date de remise.
  const values = { label, source, ownerId: auto ? null : ownerId, owner: auto ? '' : owner, dueOn: auto ? null : dueOn };

  if (id) {
    const row = await itemWithReview(db, id);
    if (!row) return { error: 'Élément introuvable.' };
    if (!isEditableReview(row.review)) return { error: 'Revue clôturée ou annulée : check-list figée.' };
    await db.transaction(async (tx) => {
      await tx.update(t.reviewItems).set(values).where(eq(t.reviewItems.id, id));
      await logChange(tx, { byId: session.user.id, entityType: 'review', entityId: row.review.id, action: 'update', summary: `Élément « ${label} » modifié` });
    });
    done();
    return { ok: true, id: String(id) };
  }
  const review = await findReview(db, reviewId!);
  if (!review) return { error: NOT_FOUND };
  if (!isEditableReview(review)) return { error: 'Revue clôturée ou annulée : check-list figée.' };
  const newId = await db.transaction(async (tx) => {
    const rows = await tx.select({ sort: t.reviewItems.sort }).from(t.reviewItems).where(eq(t.reviewItems.reviewId, review.id));
    const [row] = await tx.insert(t.reviewItems).values({ reviewId: review.id, ...values, done: !auto && f.bool('done'), sort: nextSort(rows) }).returning({ id: t.reviewItems.id });
    await logChange(tx, { byId: session.user.id, entityType: 'review', entityId: review.id, action: 'update', summary: `Élément « ${label} » ajouté à la check-list` });
    return row.id;
  });
  done();
  return { ok: true, id: String(newId) };
}

/** Suppression réelle tolérée : donnée de préparation, tant que la revue n'est pas tenue. */
export async function deleteReviewItem(id: number): Promise<Result> {
  const { error, session } = await requireReviewEditor();
  if (error) return { error };
  if (!validId(id)) return { error: 'Élément introuvable.' };
  const db = await getDb();
  const row = await itemWithReview(db, id);
  if (!row) return { error: 'Élément introuvable.' };
  if (row.review.status !== 'planifiee') return { error: 'Revue tenue : la check-list est conservée telle quelle.' };
  // AUD-17 : un élément qui porte des pièces jointes n'est pas supprimé (pièces à retirer d'abord, avec leur motif).
  const [file] = await db.select({ id: t.attachments.id }).from(t.attachments)
    .where(and(eq(t.attachments.entityType, 'review_item'), eq(t.attachments.entityId, String(id))));
  if (file) return { error: "Cet élément porte des pièces jointes : retirez-les d'abord (motif conservé à l'historique)." };
  await db.transaction(async (tx) => {
    await tx.delete(t.reviewItems).where(eq(t.reviewItems.id, id));
    await logChange(tx, { byId: session.user.id, entityType: 'review', entityId: row.review.id, action: 'update', summary: `Élément « ${row.item.label} » retiré de la check-list` });
  });
  done();
  return {};
}

// ─── Décisions, objectifs et besoins en ressources ──────────────────────────

export async function saveReviewDecision(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error, session } = await requireReviewEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { min: 1 });
  const reviewId = id ? null : f.int('reviewId', { required: true, min: 1 });
  const kind = f.oneOf('kind', REVIEW_DECISION_KEYS, { required: true });
  const text = f.str('text', { required: true, max: 400 });
  const pilotId = f.opt('pilotId');
  const dueOn = f.date('dueOn');
  if (!f.ok) return f.state();

  const db = await getDb();
  if (!(await validPerson(db, pilotId))) return { error: 'Pilote introuvable.', fieldErrors: { pilotId: 'Choisissez une personne de la liste.' } };
  const values = { kind: kind!, text, pilotId, dueOn };
  const label = REVIEW_DECISION_KINDS[kind!].label;

  if (id) {
    const [row] = await db.select({ d: t.reviewDecisions, review: t.reviews }).from(t.reviewDecisions)
      .innerJoin(t.reviews, eq(t.reviewDecisions.reviewId, t.reviews.id)).where(eq(t.reviewDecisions.id, id));
    if (!row) return { error: 'Décision introuvable.' };
    if (!isEditableReview(row.review)) return { error: 'Revue clôturée ou annulée : décisions figées.' };
    await db.transaction(async (tx) => {
      await tx.update(t.reviewDecisions).set(values).where(eq(t.reviewDecisions.id, id));
      await logChange(tx, { byId: session.user.id, entityType: 'review', entityId: row.review.id, action: 'update', summary: `${label} modifié(e) : ${text.slice(0, 80)}` });
    });
    done();
    return { ok: true, id: String(id) };
  }
  const review = await findReview(db, reviewId!);
  if (!review) return { error: NOT_FOUND };
  if (!isEditableReview(review)) return { error: 'Revue clôturée ou annulée : décisions figées.' };
  const newId = await db.transaction(async (tx) => {
    const rows = await tx.select({ sort: t.reviewDecisions.sort }).from(t.reviewDecisions).where(eq(t.reviewDecisions.reviewId, review.id));
    const [row] = await tx.insert(t.reviewDecisions).values({ reviewId: review.id, ...values, sort: nextSort(rows) }).returning({ id: t.reviewDecisions.id });
    await logChange(tx, { byId: session.user.id, entityType: 'review', entityId: review.id, action: 'update', summary: `${label} ajouté(e) : ${text.slice(0, 80)}` });
    return row.id;
  });
  done();
  return { ok: true, id: String(newId) };
}

/**
 * Suppression réelle tolérée : projet de décision préparé avant la séance, sans action créée. Une fois la revue
 * tenue, la décision appartient au compte rendu (éventuellement diffusé) : on peut la corriger, plus la retirer.
 */
export async function deleteReviewDecision(id: number): Promise<Result> {
  const { error, session } = await requireReviewEditor();
  if (error) return { error };
  if (!validId(id)) return { error: 'Décision introuvable.' };
  const db = await getDb();
  const [row] = await db.select({ d: t.reviewDecisions, review: t.reviews }).from(t.reviewDecisions)
    .innerJoin(t.reviews, eq(t.reviewDecisions.reviewId, t.reviews.id)).where(eq(t.reviewDecisions.id, id));
  if (!row) return { error: 'Décision introuvable.' };
  if (row.review.status !== 'planifiee') return { error: 'Revue tenue : les décisions du compte rendu sont conservées (corrigez leur intitulé au besoin).' };
  if (row.d.actionId) return { error: `Décision portée par l'action ${row.d.actionId} : détachez-la ou abandonnez-la d'abord dans le plan d'actions.` };
  await db.transaction(async (tx) => {
    await tx.delete(t.reviewDecisions).where(eq(t.reviewDecisions.id, id));
    await logChange(tx, { byId: session.user.id, entityType: 'review', entityId: row.review.id, action: 'update', summary: `Décision retirée : ${row.d.text.slice(0, 80)}` });
  });
  done();
  return {};
}

