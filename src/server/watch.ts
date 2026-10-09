'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, max, ne } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { addMonthsClamped } from '@/components/watch/period';
import { today } from '@/lib/dates';
import { REQUIREMENT_EVAL, canSee } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireManager } from '@/lib/guard';
import { currentSiteId, inSite } from '@/lib/session';
import { checkUpload, deleteAttachment, listAttachments, saveUpload } from '@/lib/uploads';

const EVALUATIONS = Object.keys(REQUIREMENT_EVAL);

/** Saisie réservée aux rôles qui modifient et ont accès à l'écran « Veille et contrôles ». */
async function requireWatchManager() {
  const { session, error } = await requireManager();
  if (error) return { session, error };
  if (!canSee(session.role, 'watch')) return { session, error: 'Votre rôle ne permet pas cette modification.' };
  return { session, error: null };
}

async function personExists(id: string) {
  const db = await getDb();
  const [p] = await db.select({ id: t.people.id }).from(t.people).where(eq(t.people.id, id));
  return !!p;
}

// ─── Exigences réglementaires ───────────────────────────────────────────────

/**
 * Crée ou modifie une exigence. Une seule exigence est mise en avant sur le tableau de bord :
 * la cocher retire la mise en avant des autres. Un changement d'évaluation (ou de sa précision)
 * est daté du jour ; une exigence créée « À évaluer » reste sans date (jamais évaluée).
 */
export async function saveRequirement(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireWatchManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id');
  const text = f.str('text', { required: true, max: 120 });
  const domain = f.str('domain', { required: true, max: 120 });
  const summary = f.str('summary', { required: true, max: 1000 });
  const dueOn = f.date('dueOn');
  const dueNote = f.str('dueNote', { max: 60 }) || null;
  const evaluation = f.oneOf('evaluation', EVALUATIONS, { required: true });
  const evaluationNote = f.str('evaluationNote', { max: 160 }) || null;
  const pilotId = f.opt('pilotId');
  const impact = f.str('impact', { max: 300 }) || null;
  const keystoneProjects = f.int('keystoneProjects', { min: 0, max: 999 });
  const featured = f.bool('featured');
  if (!dueOn && !dueNote) f.fail('dueNote', "Indiquez une date d'échéance ou une note (ex. Permanent).");
  if (featured && !dueOn) f.fail('dueOn', 'Date requise pour la mise en avant sur le tableau de bord.');
  if (pilotId && !(await personExists(pilotId))) f.fail('pilotId', 'Pilote inconnu.');
  if (!f.ok) return f.state();

  const db = await getDb();
  const now = today();
  const values = { text, domain, summary, dueOn, dueNote, evaluation: evaluation!, evaluationNote, pilotId, impact, keystoneProjects, featured };

  let savedId = id;
  if (id) {
    const [current] = await db.select().from(t.requirements).where(eq(t.requirements.id, id));
    if (!current) return { error: 'Exigence introuvable.' };
    const reevaluated = current.evaluation !== values.evaluation || (current.evaluationNote ?? null) !== values.evaluationNote;
    await db.transaction(async (tx) => {
      if (featured) await tx.update(t.requirements).set({ featured: false }).where(and(eq(t.requirements.featured, true), ne(t.requirements.id, id)));
      await tx.update(t.requirements).set({ ...values, lastEvaluatedOn: reevaluated ? now : current.lastEvaluatedOn }).where(eq(t.requirements.id, id));
    });
  } else {
    savedId = await db.transaction(async (tx) => {
      if (featured) await tx.update(t.requirements).set({ featured: false }).where(eq(t.requirements.featured, true));
      const [{ m }] = await tx.select({ m: max(t.requirements.sort) }).from(t.requirements);
      const [row] = await tx.insert(t.requirements).values({
        ...values, lastEvaluatedOn: values.evaluation === 'a_evaluer' ? null : now, sort: (m ?? -1) + 1,
      }).returning({ id: t.requirements.id });
      return row.id;
    });
  }
  revalidatePath('/', 'layout');
  return { ok: true, id: String(savedId) };
}

/** Évaluation rapide de la conformité : évaluation, précision et date du jour. */
export async function evaluateRequirement(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireWatchManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const evaluation = f.oneOf('evaluation', EVALUATIONS, { required: true });
  const evaluationNote = f.str('evaluationNote', { max: 160 }) || null;
  // Le groupe de boutons radio n'a pas de message de champ : l'erreur est remontée en tête de formulaire.
  if (f.fieldErrors.evaluation) return { ...f.state(), error: 'Choisissez une évaluation de conformité.' };
  if (!f.ok) return f.state();

  const db = await getDb();
  const values = { evaluation: evaluation!, evaluationNote, lastEvaluatedOn: today() };
  const [row] = await db.update(t.requirements).set(values)
    .where(eq(t.requirements.id, id!)).returning({ id: t.requirements.id });
  if (!row) return { error: 'Exigence introuvable.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(row.id) };
}

// ─── Contrôles périodiques ──────────────────────────────────────────────────

/** Crée ou modifie un contrôle périodique ; le prochain contrôle vaut par défaut dernier + périodicité. */
export async function saveControl(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireWatchManager();
  if (error) return { error };
  const db = await getDb();
  const siteIds = (await db.select({ id: t.sites.id }).from(t.sites)).map((s) => s.id);
  const f = formReader(fd);
  const id = f.int('id');
  const equipment = f.str('equipment', { required: true, max: 160 });
  const controlType = f.str('controlType', { required: true, max: 120 });
  const periodMonths = f.int('periodMonths', { required: true, min: 1, max: 120 });
  const organization = f.str('organization', { required: true, max: 120 });
  const responsibleId = f.opt('responsibleId');
  const siteId = f.oneOf('siteId', siteIds); // vide = tous les sites
  const lastOn = f.date('lastOn', { required: true });
  let nextOn = f.date('nextOn');
  const reserves = f.str('reserves', { max: 160 }) || null;
  if (lastOn && lastOn > today()) f.fail('lastOn', "Le dernier contrôle ne peut pas être postérieur à aujourd'hui.");
  if (lastOn && periodMonths && !nextOn && !f.fieldErrors.nextOn) nextOn = addMonthsClamped(lastOn, periodMonths);
  if (lastOn && nextOn && nextOn <= lastOn) f.fail('nextOn', 'Le prochain contrôle doit suivre le dernier.');
  if (responsibleId && !(await personExists(responsibleId))) f.fail('responsibleId', 'Responsable inconnu.');
  if (!f.ok) return f.state();

  const values = { equipment, controlType, periodMonths: periodMonths!, organization, responsibleId, siteId, lastOn: lastOn!, nextOn: nextOn!, reserves };
  let savedId = id;
  if (id) {
    const [current] = await db.select({ siteId: t.controls.siteId }).from(t.controls).where(eq(t.controls.id, id));
    if (!current) return { error: 'Contrôle introuvable.' };
    if (!inSite(await currentSiteId(), current.siteId)) return { error: 'Contrôle hors du site sélectionné.' };
    const [row] = await db.update(t.controls).set(values).where(eq(t.controls.id, id)).returning({ id: t.controls.id });
    if (!row) return { error: 'Contrôle introuvable.' };
  } else {
    const [{ m }] = await db.select({ m: max(t.controls.sort) }).from(t.controls);
    const [row] = await db.insert(t.controls).values({ ...values, sort: (m ?? -1) + 1 }).returning({ id: t.controls.id });
    savedId = row.id;
  }
  revalidatePath('/', 'layout');
  return { ok: true, id: String(savedId) };
}

/**
 * Enregistre un contrôle réalisé (historique + rapport joint). S'il est le plus récent,
 * il met à jour le contrôle : dernier = date, prochain = date + périodicité, réserves.
 */
export async function recordControl(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireWatchManager();
  if (error) return { error };
  const f = formReader(fd);
  const controlId = f.int('controlId', { required: true });
  const performedOn = f.date('performedOn', { required: true });
  const organization = f.str('organization', { required: true, max: 120 });
  const reserves = f.str('reserves', { max: 160 }) || null;
  const notes = f.str('notes', { max: 2000 }) || null;
  const files = f.files('report');
  if (performedOn && performedOn > today()) f.fail('performedOn', 'Enregistrez le contrôle une fois réalisé (date future).');
  files.forEach((file) => { const err = checkUpload(file); if (err) f.fail('report', err); });
  if (!f.ok) return f.state();

  const db = await getDb();
  const [control] = await db.select().from(t.controls).where(eq(t.controls.id, controlId!));
  if (!control) return { error: 'Contrôle introuvable.' };
  if (!inSite(await currentSiteId(), control.siteId)) return { error: 'Contrôle hors du site sélectionné.' };
  const latest = performedOn! >= control.lastOn;

  const recordId = await db.transaction(async (tx) => {
    const [rec] = await tx.insert(t.controlRecords).values({
      controlId: control.id, performedOn: performedOn!, organization, reserves, notes, recordedById: session.user.id,
    }).returning({ id: t.controlRecords.id });
    if (latest) {
      await tx.update(t.controls).set({ lastOn: performedOn!, nextOn: addMonthsClamped(performedOn!, control.periodMonths), reserves })
        .where(eq(t.controls.id, control.id));
    }
    return rec.id;
  });

  try {
    for (const file of files) await saveUpload(file, 'control_record', String(recordId), session.user.id);
  } catch (e) {
    // Le rapport n'a pas pu être stocké : on annule l'enregistrement pour permettre une nouvelle saisie complète.
    for (const a of await listAttachments('control_record', String(recordId))) await deleteAttachment(a.id);
    await db.transaction(async (tx) => {
      await tx.delete(t.controlRecords).where(eq(t.controlRecords.id, recordId));
      if (latest) {
        await tx.update(t.controls).set({ lastOn: control.lastOn, nextOn: control.nextOn, reserves: control.reserves })
          .where(eq(t.controls.id, control.id));
      }
    });
    return { error: `Le rapport n'a pas pu être enregistré : ${e instanceof Error ? e.message : 'erreur inconnue'}`, fieldErrors: { report: 'Fichier non enregistré.' } };
  }

  revalidatePath('/', 'layout');
  return { ok: true, id: String(recordId) };
}
