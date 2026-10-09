'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, ne } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { isReviewPlanItem } from '@/components/audits/shared';
import { fmtDate, fmtDayMonth, monthName, monthOf, today, yearOf } from '@/lib/dates';
import {
  REVIEW_DECISION_KEYS, REVIEW_DECISION_KINDS, REVIEW_KINDS, REVIEW_KIND_KEYS, REVIEW_SOURCES, REVIEW_SOURCE_KEYS, ROLES, canSee,
  type ReviewKind, type ReviewSource,
} from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireManager } from '@/lib/guard';
import { ALL_SITES } from '@/lib/session';
import { buildReviewDossier, followingReview, isEditableReview, type Review, type ReviewSnapshot } from '@/lib/data/review';
import { logChange } from './changelog';

type Result = { error?: string };

const DENIED = 'Votre rôle ne permet pas cette modification.';
const NOT_FOUND = 'Revue introuvable.';
const PLAN_TRACK = 'Revues de direction';

// Le journal reçoit l'auteur explicitement (byId) : sans cela, logChange relit la session hors de la transaction.

/** Préparation et compte rendu : rôles qui saisissent (canManage) ET qui ont l'écran « Audits ». */
async function requireReviewEditor() {
  const r = await requireManager();
  if (r.error) return r;
  return canSee(r.session.role, 'audits') ? r : { ...r, error: DENIED };
}

/** Clôture (visa de la direction) et annulation : animateur QHSE et direction. */
async function requireReviewApprover() {
  const r = await requireApprover();
  if (r.error) return r;
  return canSee(r.session.role, 'audits') ? r : { ...r, error: DENIED };
}

/** Identifiant numérique reçu du client (les server actions sont appelables avec n'importe quelle valeur). */
const validId = (id: unknown): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0;
const nextSort = (rows: { sort: number }[]) => Math.max(-1, ...rows.map((r) => r.sort)) + 1;
const done = () => revalidatePath('/', 'layout');

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

// ─── Programme annuel : échéance « Revues de direction » ────────────────────

/** Échéances du programme datées du jour de la revue. */
async function planItemsOf(db: DbOrTx, reviewOn: string) {
  return (await db.select().from(t.auditPlanItems).where(eq(t.auditPlanItems.plannedOn, reviewOn))).filter(isReviewPlanItem);
}

/** Inscrit la revue au programme annuel si la ligne « Revues de direction » n'a rien ce mois-là (sinon, rien). */
async function ensurePlanItem(tx: DbOrTx, reviewOn: string, kind: ReviewKind) {
  const [taken] = await tx.select({ id: t.auditPlanItems.id }).from(t.auditPlanItems)
    .where(and(eq(t.auditPlanItems.track, PLAN_TRACK), eq(t.auditPlanItems.year, yearOf(reviewOn)), eq(t.auditPlanItems.month, monthOf(reviewOn))));
  if (taken) return;
  await tx.insert(t.auditPlanItems).values({
    track: PLAN_TRACK, year: yearOf(reviewOn), month: monthOf(reviewOn), plannedOn: reviewOn,
    label: `${REVIEW_KINDS[kind].short} ${fmtDayMonth(reviewOn)}`,
    detail: REVIEW_KINDS[kind].label === 'Revue annuelle' ? 'Revue de direction annuelle' : 'Revue de direction intermédiaire',
    ownerId: ROLES.Direction.personId,
  });
}

/** Le programme n'admet qu'un élément par ligne et par mois : message d'erreur si le report entre en conflit. */
async function planClash(db: DbOrTx, from: string, to: string) {
  for (const p of await planItemsOf(db, from)) {
    const [clash] = await db.select({ label: t.auditPlanItems.label }).from(t.auditPlanItems)
      .where(and(eq(t.auditPlanItems.year, yearOf(to)), eq(t.auditPlanItems.track, p.track), eq(t.auditPlanItems.month, monthOf(to)), ne(t.auditPlanItems.id, p.id)));
    if (clash) {
      return `Le programme annuel prévoit déjà « ${clash.label} » en ${monthName(monthOf(to))} ${yearOf(to)} sur la ligne « ${p.track} ». Libérez ce mois dans le programme ou choisissez une autre date.`;
    }
  }
  return null;
}

/** Déplace la revue et son échéance du programme (date prévue, mois, année et date reprise dans le libellé court). */
async function moveReview(tx: DbOrTx, id: number, from: string, to: string) {
  for (const p of await planItemsOf(tx, from)) {
    await tx.update(t.auditPlanItems)
      .set({ plannedOn: to, year: yearOf(to), month: monthOf(to), label: p.label.replace(fmtDayMonth(from), fmtDayMonth(to)) })
      .where(eq(t.auditPlanItems.id, p.id));
  }
  await tx.update(t.reviews).set({ reviewOn: to }).where(eq(t.reviews.id, id));
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
    await ensurePlanItem(tx, reviewOn!, kind);
    await logChange(tx, {
      byId: session.user.id,
      entityType: 'review', entityId: row.id, action: 'create',
      summary: `${REVIEW_KINDS[kind].label} planifiée le ${fmtDate(reviewOn!)}${copied ? ` · check-list reprise de la revue du ${fmtDate(source!.reviewOn)} (${copied} éléments)` : ''}`,
    });
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
  if (!f.ok) return f.state();

  const db = await getDb();
  const review = await findReview(db, id!);
  if (!review) return { error: NOT_FOUND };
  if (review.status !== 'planifiee') return { error: 'Seule une revue planifiée peut être reportée.' };
  if (review.reviewOn === to) return { ok: true };
  if (await dateTaken(db, to!, review.id)) return { error: `Une revue est déjà prévue le ${fmtDate(to!)}.`, fieldErrors: { to: 'Date déjà occupée.' } };
  const clash = await planClash(db, review.reviewOn, to!);
  if (clash) return { error: clash, fieldErrors: { to: 'Mois déjà occupé au programme annuel.' } };

  await db.transaction(async (tx) => {
    await moveReview(tx, review.id, review.reviewOn, to!);
    await logChange(tx, {
      byId: session.user.id,
      entityType: 'review', entityId: review.id, action: 'update', summary: `Revue reportée au ${fmtDate(to!)}`,
      details: [{ field: 'Date', from: fmtDate(review.reviewOn), to: fmtDate(to!) }],
    });
  });
  done();
  return { ok: true };
}

/**
 * Compte rendu de la séance (saisie, puis correction tant que la revue n'est pas clôturée) : la revue passe « tenue »,
 * son échéance du programme est réalisée, et la prochaine revue (date et type) est créée avec la check-list reprise.
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
  const people = new Set((await db.select({ id: t.people.id }).from(t.people)).map((p) => p.id));
  if (participantIds.some((p) => !people.has(p))) return { error: 'Participant introuvable.', fieldErrors: { participantIds: 'Choisissez des personnes de la liste.' } };
  if (reviewOn !== review.reviewOn) {
    if (await dateTaken(db, reviewOn!, review.id)) return { error: `Une autre revue est enregistrée le ${fmtDate(reviewOn!)}.`, fieldErrors: { reviewOn: 'Date déjà occupée.' } };
    const clash = await planClash(db, review.reviewOn, reviewOn!);
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
    const clash = await planClash(db, plannedNext.reviewOn, nextReviewOn);
    if (clash) return { error: clash, fieldErrors: { nextReviewOn: 'Mois déjà occupé au programme annuel.' } };
  }

  const values = { participantIds, externalParticipants, customerPerception, resourceNeeds, minutes, nextReviewOn, status: 'tenue', recordedById: session.user.id };
  await db.transaction(async (tx) => {
    const plan = await planItemsOf(tx, review.reviewOn);
    if (reviewOn !== review.reviewOn) await moveReview(tx, review.id, review.reviewOn, reviewOn!);
    await tx.update(t.reviews).set(values).where(eq(t.reviews.id, review.id));
    for (const p of plan) await tx.update(t.auditPlanItems).set({ done: true, doneOn: reviewOn! }).where(eq(t.auditPlanItems.id, p.id));
    await logChange(tx, {
      byId: session.user.id,
      entityType: 'review', entityId: review.id, action: review.status === 'tenue' ? 'update' : 'status',
      summary: review.status === 'tenue' ? 'Compte rendu modifié' : `Revue tenue le ${fmtDate(reviewOn!)} · compte rendu saisi`,
      details: reviewOn !== review.reviewOn ? [{ field: 'Date', from: fmtDate(review.reviewOn), to: fmtDate(reviewOn!) }] : undefined,
    });

    if (!nextReviewOn || nextExisting) return;
    if (plannedNext) {
      await moveReview(tx, plannedNext.id, plannedNext.reviewOn, nextReviewOn);
      await tx.update(t.reviews).set({ kind: nextKind }).where(eq(t.reviews.id, plannedNext.id));
      await logChange(tx, { byId: session.user.id, entityType: 'review', entityId: plannedNext.id, action: 'update', summary: `Revue reportée au ${fmtDate(nextReviewOn)} (compte rendu du ${fmtDate(reviewOn!)})` });
      return;
    }
    const [next] = await tx.insert(t.reviews).values({ reviewOn: nextReviewOn, kind: nextKind }).returning({ id: t.reviews.id });
    await copyChecklist(tx, review.id, next.id);
    await ensurePlanItem(tx, nextReviewOn, nextKind);
    await logChange(tx, { byId: session.user.id, entityType: 'review', entityId: next.id, action: 'create', summary: `${REVIEW_KINDS[nextKind].label} planifiée le ${fmtDate(nextReviewOn)} (compte rendu du ${fmtDate(reviewOn!)})` });
  });
  done();
  return { ok: true };
}

/** Visa de la direction : la revue est clôturée et son dossier figé (instantané JSON, plus jamais modifié). */
export async function closeReview(id: number): Promise<Result> {
  const { error, session } = await requireReviewApprover();
  if (error) return { error };
  if (!validId(id)) return { error: NOT_FOUND };
  if (session.site.id !== ALL_SITES) return { error: 'Sélectionnez « Tous les sites » : le dossier archivé couvre tout le périmètre.' };
  const db = await getDb();
  const reviews: Review[] = await db.select().from(t.reviews);
  const review = reviews.find((r) => r.id === id);
  if (!review) return { error: NOT_FOUND };
  if (review.status !== 'tenue') return { error: 'Saisissez le compte rendu avant de clôturer la revue.' };

  const now = today();
  const dossier = await buildReviewDossier(review, reviews);
  const snapshot: ReviewSnapshot = {
    version: 1, takenOn: now, takenBy: session.user.name,
    dossier: { ...dossier, header: { ...dossier.header, status: 'cloturee' }, record: { ...dossier.record, closedBy: session.user.name, closedOn: now } },
  };
  await db.transaction(async (tx) => {
    const rows = await tx.update(t.reviews).set({ status: 'cloturee', closedOn: now, closedById: session.user.id, snapshot })
      .where(and(eq(t.reviews.id, id), eq(t.reviews.status, 'tenue'))).returning({ id: t.reviews.id });
    if (!rows.length) return;
    await logChange(tx, { byId: session.user.id, entityType: 'review', entityId: id, action: 'status', summary: 'Revue clôturée · visa de la direction, dossier figé' });
  });
  done();
  return {};
}

export async function cancelReview(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error, session } = await requireReviewApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (reason.length > 300) f.fail('reason', '300 caractères au maximum.');
  if (!f.ok) return f.state();

  const db = await getDb();
  const review = await findReview(db, id!);
  if (!review) return { error: NOT_FOUND };
  if (review.status !== 'planifiee') return { error: 'Seule une revue planifiée peut être annulée.' };
  await db.transaction(async (tx) => {
    // L'échéance du programme reste en place : à reprogrammer ou à supprimer depuis le programme annuel.
    await tx.update(t.reviews).set({ status: 'annulee', cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.reviews.id, review.id));
    await logChange(tx, { byId: session.user.id, entityType: 'review', entityId: review.id, action: 'cancel', summary: `Revue du ${fmtDate(review.reviewOn)} annulée`, reason });
  });
  done();
  return { ok: true };
}

// ─── Check-list de préparation ──────────────────────────────────────────────

async function itemWithReview(db: DbOrTx, id: number) {
  const [row] = await db.select({ item: t.reviewItems, review: t.reviews }).from(t.reviewItems)
    .innerJoin(t.reviews, eq(t.reviewItems.reviewId, t.reviews.id)).where(eq(t.reviewItems.id, id));
  return row;
}

export async function setReviewItemDone(id: number, isDone: boolean): Promise<Result> {
  const { error, session } = await requireReviewEditor();
  if (error) return { error };
  if (!validId(id) || typeof isDone !== 'boolean') return { error: 'Élément introuvable.' };
  const db = await getDb();
  const row = await itemWithReview(db, id);
  if (!row) return { error: 'Élément introuvable.' };
  if (REVIEW_SOURCES[row.item.source as ReviewSource]?.auto) return { error: 'Élément calculé par Vigie.' };
  if (!isEditableReview(row.review)) return { error: 'Revue clôturée ou annulée : check-list figée.' };
  await db.transaction(async (tx) => {
    await tx.update(t.reviewItems).set({ done: isDone }).where(eq(t.reviewItems.id, id));
    await logChange(tx, { byId: session.user.id, entityType: 'review', entityId: row.review.id, action: 'update', summary: `« ${row.item.label} » ${isDone ? 'fourni' : 'à fournir'}` });
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
  if (row.d.actionId) return { error: `Décision portée par l'action ${row.d.actionId} : détachez ou annulez l'action d'abord.` };
  await db.transaction(async (tx) => {
    await tx.delete(t.reviewDecisions).where(eq(t.reviewDecisions.id, id));
    await logChange(tx, { byId: session.user.id, entityType: 'review', entityId: row.review.id, action: 'update', summary: `Décision retirée : ${row.d.text.slice(0, 80)}` });
  });
  done();
  return {};
}

