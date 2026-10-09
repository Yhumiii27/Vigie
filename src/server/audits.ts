'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, ne } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { CERT_TONES, FINDING_KEYS, NEW_TRACK } from '@/components/audits/shared';
import { fmtDayMonth, monthName, monthOf, yearOf } from '@/lib/dates';
import { canSee } from '@/lib/domain';
import { formReader, nextRef, type FormState } from '@/lib/forms';
import { requireApprover, requireManager } from '@/lib/guard';

type Result = { error?: string };

/**
 * Programme, constats et check-list : rôles qui saisissent (canManage) ET qui ont accès à l'écran « Audits ».
 * Le chef de service et le chef de projet peuvent saisir ailleurs mais n'ont pas cet écran : ils ne modifient rien ici.
 */
async function requireAuditEditor() {
  const r = await requireManager();
  if (r.error) return r;
  return canSee(r.session.role, 'audits') ? r : { ...r, error: 'Votre rôle ne permet pas cette modification.' };
}

const nextSort = (rows: { sort: number }[]) => Math.max(-1, ...rows.map((r) => r.sort)) + 1;
/** Identifiant numérique reçu du client (les server actions sont appelables avec n'importe quelle valeur). */
const validId = (id: unknown): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0;

// ─── Certifications (animateur QHSE, direction) ─────────────────────────────

export async function saveCertification(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const domain = f.str('domain', { required: true, max: 60 });
  const standard = f.str('standard', { required: true, max: 80 });
  const status = f.str('status', { required: true, max: 80 });
  const tone = f.oneOf('tone', CERT_TONES, { required: true });
  const note = f.str('note', { max: 240 });
  if (!f.ok) return f.state();

  const db = await getDb();
  const values = { domain, standard, status, tone: tone!, note };
  if (id) {
    const [row] = await db.update(t.certifications).set(values).where(eq(t.certifications.id, id)).returning({ id: t.certifications.id });
    if (!row) return { error: 'Référentiel introuvable.' };
    revalidatePath('/', 'layout');
    return { ok: true, id };
  }
  const rows = await db.select({ id: t.certifications.id, sort: t.certifications.sort }).from(t.certifications);
  const newId = nextRef(rows.map((r) => r.id), 'cert-');
  await db.insert(t.certifications).values({ id: newId, ...values, sort: nextSort(rows) });
  revalidatePath('/', 'layout');
  return { ok: true, id: newId };
}

export async function deleteCertification(id: string): Promise<Result> {
  const { error } = await requireApprover();
  if (error) return { error };
  if (typeof id !== 'string' || !id) return { error: 'Référentiel introuvable.' };
  const db = await getDb();
  const [row] = await db.delete(t.certifications).where(eq(t.certifications.id, id)).returning({ id: t.certifications.id });
  if (!row) return { error: 'Référentiel introuvable.' };
  revalidatePath('/', 'layout');
  return {};
}

// ─── Programme annuel ───────────────────────────────────────────────────────

export async function savePlanItem(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id');
  const year = f.int('year', { required: true, min: 2000, max: 2100 });
  const trackChoice = f.str('track', { required: true });
  const track = trackChoice === NEW_TRACK ? f.str('newTrack', { required: true, max: 40 }) : trackChoice;
  const month = f.int('month', { required: true, min: 1, max: 12 });
  const label = f.str('label', { required: true, max: 30 });
  const plannedOn = f.date('plannedOn');
  const detail = f.str('detail', { max: 160 }) || null;
  const ownerId = f.opt('ownerId');
  const done = f.bool('done');
  if (year && month && plannedOn && (yearOf(plannedOn) !== year || monthOf(plannedOn) !== month)) {
    f.fail('plannedOn', `La date prévue doit tomber en ${monthName(month)} ${year}.`);
  }
  if (!f.ok) return f.state();

  const db = await getDb();
  if (ownerId) {
    const [p] = await db.select({ id: t.people.id }).from(t.people).where(eq(t.people.id, ownerId));
    if (!p) return { error: 'Responsable introuvable.', fieldErrors: { ownerId: 'Choisissez une personne de la liste.' } };
  }
  const clash = await db.select({ id: t.auditPlanItems.id }).from(t.auditPlanItems)
    .where(and(eq(t.auditPlanItems.year, year!), eq(t.auditPlanItems.track, track), eq(t.auditPlanItems.month, month!), id ? ne(t.auditPlanItems.id, id) : undefined));
  if (clash.length) {
    return { error: `Un élément est déjà prévu en ${monthName(month!)} sur la ligne « ${track} ». Modifiez-le ou choisissez un autre mois.`, fieldErrors: { month: 'Mois déjà occupé sur cette ligne.' } };
  }

  const values = { year: year!, track, month: month!, label, plannedOn, detail, ownerId, done };
  if (id) {
    const [row] = await db.update(t.auditPlanItems).set(values).where(eq(t.auditPlanItems.id, id)).returning({ id: t.auditPlanItems.id });
    if (!row) return { error: 'Élément du programme introuvable.' };
    revalidatePath('/', 'layout');
    return { ok: true, id: String(id) };
  }
  const [row] = await db.insert(t.auditPlanItems).values(values).returning({ id: t.auditPlanItems.id });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(row.id) };
}

export async function deletePlanItem(id: number): Promise<Result> {
  const { error } = await requireAuditEditor();
  if (error) return { error };
  if (!validId(id)) return { error: 'Élément du programme introuvable.' };
  const db = await getDb();
  const [row] = await db.delete(t.auditPlanItems).where(eq(t.auditPlanItems.id, id)).returning({ id: t.auditPlanItems.id });
  if (!row) return { error: 'Élément du programme introuvable.' };
  revalidatePath('/', 'layout');
  return {};
}

// ─── Constats d'audit ───────────────────────────────────────────────────────

export async function saveFinding(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id');
  const audit = f.str('audit', { required: true, max: 120 });
  const kind = f.oneOf('kind', FINDING_KEYS, { required: true });
  const text = f.str('text', { required: true, max: 400 });
  if (!f.ok) return f.state();

  const db = await getDb();
  const values = { audit, kind: kind!, text };
  if (id) {
    const [row] = await db.update(t.auditFindings).set(values).where(eq(t.auditFindings.id, id)).returning({ id: t.auditFindings.id });
    if (!row) return { error: 'Constat introuvable.' };
    revalidatePath('/', 'layout');
    return { ok: true, id: String(id) };
  }
  const rows = await db.select({ sort: t.auditFindings.sort }).from(t.auditFindings);
  const [row] = await db.insert(t.auditFindings).values({ ...values, sort: nextSort(rows) }).returning({ id: t.auditFindings.id });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(row.id) };
}

export async function deleteFinding(id: number): Promise<Result> {
  const { error } = await requireAuditEditor();
  if (error) return { error };
  if (!validId(id)) return { error: 'Constat introuvable.' };
  const db = await getDb();
  const [row] = await db.delete(t.auditFindings).where(eq(t.auditFindings.id, id)).returning({ id: t.auditFindings.id });
  if (!row) return { error: 'Constat introuvable.' };
  revalidatePath('/', 'layout');
  return {};
}

// ─── Préparation de la revue de direction ───────────────────────────────────

export async function setReviewItemDone(id: number, done: boolean): Promise<Result> {
  const { error } = await requireAuditEditor();
  if (error) return { error };
  if (!validId(id) || typeof done !== 'boolean') return { error: 'Élément introuvable.' };
  const db = await getDb();
  const [row] = await db.update(t.reviewItems).set({ done }).where(eq(t.reviewItems.id, id)).returning({ id: t.reviewItems.id });
  if (!row) return { error: 'Élément introuvable.' };
  revalidatePath('/', 'layout');
  return {};
}

export async function saveReviewItem(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id');
  const label = f.str('label', { required: true, max: 160 });
  const owner = f.str('owner', { max: 80 });
  const reviewOn = id ? null : f.date('reviewOn', { required: true });
  if (!f.ok) return f.state();

  const db = await getDb();
  if (id) {
    const [row] = await db.update(t.reviewItems).set({ label, owner }).where(eq(t.reviewItems.id, id)).returning({ id: t.reviewItems.id });
    if (!row) return { error: 'Élément introuvable.' };
    revalidatePath('/', 'layout');
    return { ok: true, id: String(id) };
  }
  const rows = await db.select({ sort: t.reviewItems.sort }).from(t.reviewItems).where(eq(t.reviewItems.reviewOn, reviewOn!));
  const [row] = await db.insert(t.reviewItems).values({ reviewOn: reviewOn!, label, owner, done: f.bool('done'), sort: nextSort(rows) }).returning({ id: t.reviewItems.id });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(row.id) };
}

export async function deleteReviewItem(id: number): Promise<Result> {
  const { error } = await requireAuditEditor();
  if (error) return { error };
  if (!validId(id)) return { error: 'Élément introuvable.' };
  const db = await getDb();
  const [row] = await db.delete(t.reviewItems).where(eq(t.reviewItems.id, id)).returning({ id: t.reviewItems.id });
  if (!row) return { error: 'Élément introuvable.' };
  revalidatePath('/', 'layout');
  return {};
}

/** Échéance du programme annuel qui porte la revue (ligne, libellé ou intitulé mentionnant la revue). */
const isReviewPlanItem = (p: { track: string; label: string; detail: string | null }) => /revue/i.test(`${p.track} ${p.label} ${p.detail ?? ''}`);

/**
 * Reporte la revue : tous les éléments de la check-list passent à la nouvelle date, ainsi que l'échéance
 * correspondante du programme annuel (date prévue, mois, année et date reprise dans le libellé court).
 */
export async function setReviewDate(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const from = f.date('from', { required: true });
  const to = f.date('to', { required: true });
  if (!f.ok) return f.state();
  if (from === to) return { ok: true };

  const db = await getDb();
  const planItems = (await db.select().from(t.auditPlanItems).where(eq(t.auditPlanItems.plannedOn, from!))).filter(isReviewPlanItem);
  // Le programme n'admet qu'un élément par ligne et par mois.
  for (const p of planItems) {
    const [clash] = await db.select({ label: t.auditPlanItems.label }).from(t.auditPlanItems)
      .where(and(eq(t.auditPlanItems.year, yearOf(to!)), eq(t.auditPlanItems.track, p.track), eq(t.auditPlanItems.month, monthOf(to!)), ne(t.auditPlanItems.id, p.id)));
    if (clash) {
      const when = `${monthName(monthOf(to!))} ${yearOf(to!)}`;
      return {
        error: `Le programme annuel prévoit déjà « ${clash.label} » en ${when} sur la ligne « ${p.track} ». Libérez ce mois dans le programme ou choisissez une autre date.`,
        fieldErrors: { to: `Mois déjà occupé sur la ligne « ${p.track} » du programme.` },
      };
    }
  }

  const moved = await db.transaction(async (tx) => {
    const rows = await tx.update(t.reviewItems).set({ reviewOn: to! }).where(eq(t.reviewItems.reviewOn, from!)).returning({ id: t.reviewItems.id });
    if (!rows.length) return 0;
    for (const p of planItems) {
      await tx.update(t.auditPlanItems)
        .set({ plannedOn: to!, year: yearOf(to!), month: monthOf(to!), label: p.label.replace(fmtDayMonth(from!), fmtDayMonth(to!)) })
        .where(eq(t.auditPlanItems.id, p.id));
    }
    return rows.length;
  });
  if (!moved) return { error: 'Aucun élément de check-list pour cette revue.' };
  revalidatePath('/', 'layout');
  return { ok: true };
}
