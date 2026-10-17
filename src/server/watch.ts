'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, isNull, max, ne } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { MAX_BATCH_BYTES, MAX_FILES_PER_BATCH } from '@/lib/attachments';
import { addMonths, fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { REQUIREMENT_EVAL, canSee } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireInSite, requireManager } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import { loadPeople } from '@/lib/queries';
import { checkUpload, deleteAttachment, listAttachments, saveUpload } from '@/lib/uploads';
import { diffFields, logChange } from './changelog';

const EVALUATIONS = Object.keys(REQUIREMENT_EVAL);
const ARCHIVED_REQ = 'Exigence archivée : restaurez-la pour la modifier.';
const ARCHIVED_CTRL = 'Contrôle archivé : restaurez-le pour le modifier.';

/** Saisie réservée aux rôles qui modifient et ont accès à l'écran « Veille et contrôles ». */
async function requireWatchManager() {
  const { session, error } = await requireManager();
  if (error) return { session, error };
  if (!canSee(session.role, 'watch')) return { session, error: 'Votre rôle ne permet pas cette modification.' };
  return { session, error: null };
}

/** Personne choisie (pilote, responsable) : présente ou sortie de l'effectif (`leftOn`), undefined si inconnue. */
async function findPerson(id: string) {
  const db = await getDb();
  const [p] = await db.select({ id: t.people.id, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, id));
  return p;
}

/** Motif d'archivage, de restauration ou d'annulation (champ `reason`). */
function readReason(f: ReturnType<typeof formReader>) {
  const reason = f.reason();
  if (reason && reason.length < 3) f.fail('reason', 'Motif trop court (3 caractères au minimum).');
  return reason;
}

/** Contrôle d'un envoi de pièces jointes (nombre, volume total, format) ; l'erreur est portée par le champ `name`. */
function checkFiles(f: ReturnType<typeof formReader>, name: string, files: File[]) {
  if (files.length > MAX_FILES_PER_BATCH) f.fail(name, `${MAX_FILES_PER_BATCH} fichiers au maximum par envoi.`);
  else if (files.reduce((s, x) => s + x.size, 0) > MAX_BATCH_BYTES) f.fail(name, `Les fichiers dépassent ${MAX_BATCH_BYTES / 1024 / 1024} Mo au total : joignez-en moins ou réduisez leur taille.`);
  files.forEach((file) => { const err = checkUpload(file); if (err) f.fail(name, err); });
}

/** Valeurs affichées dans le journal (dates en jj/mm/aaaa, cases à cocher en Oui / Non). */
const fmtLog = (v: unknown) =>
  v == null || v === '' ? null : typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmtDate(String(v)) : String(v);

async function withNames<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]) {
  const people = await loadPeople();
  return { ...row, ...Object.fromEntries(keys.map((k) => [k, row[k] ? people.get(String(row[k]))?.name ?? row[k] : null])) } as T;
}

// ─── Exigences réglementaires ───────────────────────────────────────────────

const REQ_LABELS = {
  text: 'Texte', domain: 'Domaine', summary: "Ce qu'il exige", dueOn: 'Échéance', dueNote: "Note d'échéance", evaluation: 'Évaluation',
  evaluationNote: 'Précision', pilotId: 'Pilote', impact: 'Impact', keystoneProjects: 'Projets Keystone (surcharge)',
  affectsProjects: 'Concerne les projets Keystone', featured: 'À la une',
} as const;

/**
 * Crée ou modifie une exigence. Une seule exigence est mise en avant sur le tableau de bord :
 * la cocher retire la mise en avant des autres. Un changement d'évaluation (ou de sa précision)
 * est daté du jour et ajouté à l'historique des évaluations ; une exigence créée « À évaluer » reste sans date.
 */
export async function saveRequirement(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireWatchManager();
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
  const affectsProjects = f.bool('affectsProjects');
  const keystoneProjects = f.int('keystoneProjects', { min: 0, max: 999 });
  const featured = f.bool('featured');
  if (!dueOn && !dueNote) f.fail('dueNote', "Indiquez une date d'échéance ou une note (ex. Permanent).");
  if (featured && !dueOn) f.fail('dueOn', 'Date requise pour la mise en avant sur le tableau de bord.');
  if (affectsProjects && !dueOn) f.fail('dueOn', "Date d'application requise pour calculer les projets concernés.");

  const db = await getDb();
  const now = today();
  const [current] = id ? await db.select().from(t.requirements).where(eq(t.requirements.id, id)) : [];
  // Pilote sorti de l'effectif : conservé tant qu'il n'est pas remplacé, jamais choisi à nouveau (VEI-01).
  const pilot = pilotId ? await findPerson(pilotId) : undefined;
  if (pilotId && !pilot) f.fail('pilotId', 'Pilote inconnu.');
  else if (pilot && hasLeft(pilot, now) && pilotId !== current?.pilotId) f.fail('pilotId', "Pilote sorti de l'effectif : choisissez une personne présente.");
  if (!f.ok) return f.state();
  if (id && !current) return { error: 'Exigence introuvable.' };

  const values = { text, domain, summary, dueOn, dueNote, evaluation: evaluation!, evaluationNote, pilotId, impact, affectsProjects, keystoneProjects, featured };
  const evalRow = (requirementId: number) => ({ requirementId, evaluatedOn: now, evaluation: values.evaluation, note: evaluationNote, evaluatedById: session.user.id });

  let savedId = id;
  if (current) {
    if (current.archivedAt) return { error: ARCHIVED_REQ };
    const reevaluated = current.evaluation !== values.evaluation || (current.evaluationNote ?? null) !== values.evaluationNote;
    const details = diffFields(await withNames(current, ['pilotId']), await withNames({ ...current, ...values }, ['pilotId']), REQ_LABELS, fmtLog);
    await db.transaction(async (tx) => {
      if (featured) await tx.update(t.requirements).set({ featured: false }).where(and(eq(t.requirements.featured, true), ne(t.requirements.id, current.id)));
      await tx.update(t.requirements).set({ ...values, lastEvaluatedOn: reevaluated ? now : current.lastEvaluatedOn }).where(eq(t.requirements.id, current.id));
      if (reevaluated) await tx.insert(t.requirementEvaluations).values(evalRow(current.id));
      if (details.length) await logChange(tx, { entityType: 'requirement', entityId: current.id, action: 'update', summary: 'Exigence modifiée', details });
    });
  } else {
    savedId = await db.transaction(async (tx) => {
      if (featured) await tx.update(t.requirements).set({ featured: false }).where(eq(t.requirements.featured, true));
      const [{ m }] = await tx.select({ m: max(t.requirements.sort) }).from(t.requirements);
      const [row] = await tx.insert(t.requirements).values({
        ...values, lastEvaluatedOn: values.evaluation === 'a_evaluer' ? null : now, sort: (m ?? -1) + 1,
      }).returning({ id: t.requirements.id });
      if (values.evaluation !== 'a_evaluer') await tx.insert(t.requirementEvaluations).values(evalRow(row.id));
      await logChange(tx, { entityType: 'requirement', entityId: row.id, action: 'create', summary: 'Exigence ajoutée à la veille' });
      return row.id;
    });
  }
  revalidatePath('/', 'layout');
  return { ok: true, id: String(savedId) };
}

/**
 * Évaluation de la conformité : évaluation, précision et date du jour, ajoutées à l'historique des évaluations
 * avec une preuve facultative (pièce jointe 'requirement_evaluation').
 */
export async function evaluateRequirement(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireWatchManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const evaluation = f.oneOf('evaluation', EVALUATIONS, { required: true });
  const evaluationNote = f.str('evaluationNote', { max: 160 }) || null;
  const files = f.files('proof');
  checkFiles(f, 'proof', files);
  // Le groupe de boutons radio n'a pas de message de champ : l'erreur est remontée en tête de formulaire.
  if (f.fieldErrors.evaluation) return { ...f.state(), error: 'Choisissez une évaluation de conformité.' };
  if (!f.ok) return f.state();

  const db = await getDb();
  const [current] = await db.select().from(t.requirements).where(eq(t.requirements.id, id!));
  if (!current) return { error: 'Exigence introuvable.' };
  if (current.archivedAt) return { error: ARCHIVED_REQ };
  const now = today();

  const evalId = await db.transaction(async (tx) => {
    await tx.update(t.requirements).set({ evaluation: evaluation!, evaluationNote, lastEvaluatedOn: now }).where(eq(t.requirements.id, current.id));
    const [row] = await tx.insert(t.requirementEvaluations).values({
      requirementId: current.id, evaluatedOn: now, evaluation: evaluation!, note: evaluationNote, evaluatedById: session.user.id,
    }).returning({ id: t.requirementEvaluations.id });
    return row.id;
  });

  try {
    for (const file of files) await saveUpload(file, 'requirement_evaluation', String(evalId), session.user.id);
  } catch (e) {
    // La preuve n'a pas pu être stockée : on annule l'évaluation pour permettre une nouvelle saisie complète.
    for (const a of await listAttachments('requirement_evaluation', String(evalId))) await deleteAttachment(a.id);
    await db.transaction(async (tx) => {
      await tx.delete(t.requirementEvaluations).where(eq(t.requirementEvaluations.id, evalId));
      await tx.update(t.requirements).set({ evaluation: current.evaluation, evaluationNote: current.evaluationNote, lastEvaluatedOn: current.lastEvaluatedOn })
        .where(eq(t.requirements.id, current.id));
    });
    return { error: `La preuve n'a pas pu être enregistrée : ${e instanceof Error ? e.message : 'erreur inconnue'}`, fieldErrors: { proof: 'Fichier non enregistré.' } };
  }

  const label = REQUIREMENT_EVAL[evaluation!].label;
  await logChange(null, {
    entityType: 'requirement', entityId: current.id, action: 'evaluate',
    summary: `Évaluation « ${label} » enregistrée${files.length ? ` · ${files.length} preuve${files.length > 1 ? 's' : ''} jointe${files.length > 1 ? 's' : ''}` : ''}`,
    details: diffFields(current, { evaluation: evaluation!, evaluationNote }, { evaluation: 'Évaluation', evaluationNote: 'Précision' },
      (v) => (v == null || v === '' ? null : REQUIREMENT_EVAL[String(v)]?.label ?? String(v))),
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(current.id) };
}

/** Archive une exigence (texte abrogé) : motif obligatoire, historique et action liée conservés, retirée de la une. */
export async function archiveRequirement(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireWatchManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const reason = readReason(f);
  if (!f.ok) return f.state();

  const db = await getDb();
  const [current] = await db.select({ id: t.requirements.id, archivedAt: t.requirements.archivedAt }).from(t.requirements).where(eq(t.requirements.id, id!));
  if (!current) return { error: 'Exigence introuvable.' };
  if (current.archivedAt) return { error: 'Exigence déjà archivée.' };
  await db.transaction(async (tx) => {
    await tx.update(t.requirements).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason, featured: false })
      .where(eq(t.requirements.id, current.id));
    await logChange(tx, { entityType: 'requirement', entityId: current.id, action: 'archive', summary: 'Exigence archivée · texte abrogé', reason });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(current.id) };
}

/** Restaure une exigence archivée (animateur QHSE, direction), avec motif. */
export async function restoreRequirement(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const reason = readReason(f);
  if (!f.ok) return f.state();

  const db = await getDb();
  const [current] = await db.select({ id: t.requirements.id, archivedAt: t.requirements.archivedAt }).from(t.requirements).where(eq(t.requirements.id, id!));
  if (!current) return { error: 'Exigence introuvable.' };
  if (!current.archivedAt) return { error: "L'exigence n'est pas archivée." };
  await db.transaction(async (tx) => {
    await tx.update(t.requirements).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.requirements.id, current.id));
    await logChange(tx, { entityType: 'requirement', entityId: current.id, action: 'restore', summary: 'Exigence restaurée', reason });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(current.id) };
}

// ─── Contrôles périodiques ──────────────────────────────────────────────────

const CTRL_LABELS = {
  equipment: 'Équipement', controlType: 'Type de contrôle', periodMonths: 'Périodicité (mois)', organization: 'Organisme',
  responsibleId: 'Responsable', siteId: 'Site', lastOn: 'Dernier contrôle', nextOn: 'Prochain contrôle', reserves: 'Réserves',
  requirementId: 'Exigence',
} as const;

const RECORD_TO_CHANGE = 'Modifié par « Enregistrer un contrôle » (ou l’annulation d’un enregistrement) : le changement est alors tracé dans l’historique.';

/** Contrôle du site sélectionné, chargé pour une modification ; `error` si introuvable, hors site ou archivé (sauf `archived`). */
async function loadControlForEdit(id: number, opts: { archived?: boolean } = {}) {
  const db = await getDb();
  const [control] = await db.select().from(t.controls).where(eq(t.controls.id, id));
  if (!control) return { control: null, error: 'Contrôle introuvable.' };
  const siteError = await requireInSite(control.siteId);
  if (siteError) return { control: null, error: siteError };
  if (!opts.archived && control.archivedAt) return { control: null, error: ARCHIVED_CTRL };
  return { control, error: null };
}

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
  const requirementId = f.int('requirementId');
  // VEI-09 : à la modification, « Dernier contrôle » et « Réserves en cours » ne changent que par un contrôle enregistré
  // (« Enregistrer un contrôle ») ou l'annulation d'un enregistrement : historique et détachement de l'action de levée.
  const current = id ? await loadControlForEdit(id) : null;
  if (current?.error) return { error: current.error };
  const before = current?.control ?? null;
  const lastOn = before && !fd.has('lastOn') ? before.lastOn : f.date('lastOn', { required: true });
  let nextOn = f.date('nextOn');
  const reserves = before && !fd.has('reserves') ? before.reserves : f.str('reserves', { max: 160 }) || null;
  if (before && lastOn && lastOn !== before.lastOn) f.fail('lastOn', RECORD_TO_CHANGE);
  if (before && reserves !== before.reserves) f.fail('reserves', RECORD_TO_CHANGE);
  if (lastOn && lastOn > today()) f.fail('lastOn', "Le dernier contrôle ne peut pas être postérieur à aujourd'hui.");
  if (lastOn && periodMonths && !nextOn && !f.fieldErrors.nextOn) nextOn = addMonths(lastOn, periodMonths);
  if (lastOn && nextOn && nextOn <= lastOn) f.fail('nextOn', 'Le prochain contrôle doit suivre le dernier.');
  const responsible = responsibleId ? await findPerson(responsibleId) : undefined;
  if (responsibleId && !responsible) f.fail('responsibleId', 'Responsable inconnu.');
  if (!f.ok) return f.state();

  // Responsable sorti de l'effectif : conservé tant qu'il n'est pas remplacé, jamais choisi à nouveau (VEI-01).
  if (responsible && hasLeft(responsible, today()) && responsibleId !== before?.responsibleId) {
    return { error: 'Certains champs sont à corriger.', fieldErrors: { responsibleId: "Responsable sorti de l'effectif : choisissez une personne présente." } };
  }
  if (!before || before.siteId !== siteId) {
    const siteError = await requireInSite(siteId, { create: true });
    if (siteError) return { error: siteError, fieldErrors: { siteId: 'Site non autorisé.' } };
  }
  if (requirementId && requirementId !== before?.requirementId) {
    const [req] = await db.select({ archivedAt: t.requirements.archivedAt }).from(t.requirements).where(eq(t.requirements.id, requirementId));
    if (!req) f.fail('requirementId', 'Exigence inconnue.');
    else if (req.archivedAt) f.fail('requirementId', 'Exigence archivée : choisissez une exigence en vigueur.');
    if (!f.ok) return f.state();
  }

  const values = { equipment, controlType, periodMonths: periodMonths!, organization, responsibleId, siteId, requirementId, lastOn: lastOn!, nextOn: nextOn!, reserves };
  let savedId = id;
  if (before) {
    const details = diffFields(await withNames(before, ['responsibleId']), await withNames({ ...before, ...values }, ['responsibleId']), CTRL_LABELS, fmtLog);
    await db.transaction(async (tx) => {
      await tx.update(t.controls).set(values).where(eq(t.controls.id, before.id));
      if (details.length) await logChange(tx, { entityType: 'control', entityId: before.id, action: 'update', summary: 'Contrôle modifié', details });
    });
  } else {
    savedId = await db.transaction(async (tx) => {
      const [{ m }] = await tx.select({ m: max(t.controls.sort) }).from(t.controls);
      const [row] = await tx.insert(t.controls).values({ ...values, sort: (m ?? -1) + 1 }).returning({ id: t.controls.id });
      await logChange(tx, { entityType: 'control', entityId: row.id, action: 'create', summary: 'Contrôle périodique ajouté' });
      return row.id;
    });
  }
  revalidatePath('/', 'layout');
  return { ok: true, id: String(savedId) };
}

/**
 * Détachement d'une action par un changement des réserves d'un contrôle (enregistrement ou annulation d'un
 * enregistrement) : entrée « unlink » dans l'historique de l'action (ACT-03 : changements faits par les autres modules).
 */
async function logControlDetach(tx: DbOrTx | null, control: { id: number; controlType: string; equipment: string }, actionId: string, why: string, byId: string, reason?: string | null) {
  await logChange(tx, {
    entityType: 'action', entityId: actionId, action: 'unlink', byId, reason: reason ?? null,
    summary: `Détachée de ${control.controlType} · ${control.equipment} (${why}) : l'action reste dans le plan d'actions`,
  });
  // VEI-04 : aussi dans l'historique du contrôle.
  await logChange(tx, {
    entityType: 'control', entityId: control.id, action: 'unlink', byId, reason: reason ?? null,
    summary: `Action ${actionId} détachée (${why}) : elle reste dans le plan d'actions`,
  });
}

/**
 * Enregistre un contrôle réalisé (historique + rapport joint). S'il est le plus récent,
 * il met à jour le contrôle : dernier = date, prochain = date + périodicité, réserves (l'état précédent est conservé
 * sur l'enregistrement pour pouvoir l'annuler). De nouvelles réserves détachent l'action de levée des précédentes.
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
  checkFiles(f, 'report', files);
  if (!f.ok) return f.state();

  const { control, error: ctrlError } = await loadControlForEdit(controlId!);
  if (!control) return { error: ctrlError };
  const db = await getDb();
  const latest = performedOn! >= control.lastOn;
  // Réserves différentes : « Lever les réserves » réapparaît, l'ancienne action reste dans le plan d'actions.
  const actionId = latest && reserves !== control.reserves ? null : control.actionId;

  const recordId = await db.transaction(async (tx) => {
    const [rec] = await tx.insert(t.controlRecords).values({
      controlId: control.id, performedOn: performedOn!, organization, reserves, notes, recordedById: session.user.id,
      ...(latest ? { prevLastOn: control.lastOn, prevNextOn: control.nextOn, prevReserves: control.reserves } : {}),
    }).returning({ id: t.controlRecords.id });
    if (latest) {
      await tx.update(t.controls).set({ lastOn: performedOn!, nextOn: addMonths(performedOn!, control.periodMonths), reserves, actionId })
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
        await tx.update(t.controls).set({ lastOn: control.lastOn, nextOn: control.nextOn, reserves: control.reserves, actionId: control.actionId })
          .where(eq(t.controls.id, control.id));
      }
    });
    return { error: `Le rapport n'a pas pu être enregistré : ${e instanceof Error ? e.message : 'erreur inconnue'}`, fieldErrors: { report: 'Fichier non enregistré.' } };
  }

  await logChange(null, {
    entityType: 'control', entityId: control.id, action: 'record',
    summary: `Contrôle du ${fmtDate(performedOn!)} enregistré${latest ? '' : " dans l'historique (antérieur au dernier)"}`,
    details: latest ? diffFields(control, { lastOn: performedOn!, reserves }, { lastOn: 'Dernier contrôle', reserves: 'Réserves' }, fmtLog) : [],
  });
  // Nouvelles réserves : l'action de levée des précédentes est détachée du contrôle (elle reste au plan) ; son historique
  // le trace (ACT-03), une fois l'enregistrement définitif (rapport stocké).
  if (control.actionId && actionId !== control.actionId) await logControlDetach(null, control, control.actionId, `nouvelles réserves au contrôle du ${fmtDate(performedOn!)}`, session.user.id);
  revalidatePath('/', 'layout');
  return { ok: true, id: String(recordId) };
}

/** Archive un contrôle (équipement réformé) : motif obligatoire, historique conservé. */
export async function archiveControl(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireWatchManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const reason = readReason(f);
  if (!f.ok) return f.state();

  const { control, error: ctrlError } = await loadControlForEdit(id!, { archived: true });
  if (!control) return { error: ctrlError };
  if (control.archivedAt) return { error: 'Contrôle déjà archivé.' };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.controls).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason }).where(eq(t.controls.id, control.id));
    await logChange(tx, { entityType: 'control', entityId: control.id, action: 'archive', summary: 'Contrôle archivé · équipement réformé', reason });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(control.id) };
}

/** Restaure un contrôle archivé (animateur QHSE, direction), avec motif. */
export async function restoreControl(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const reason = readReason(f);
  if (!f.ok) return f.state();

  const { control, error: ctrlError } = await loadControlForEdit(id!, { archived: true });
  if (!control) return { error: ctrlError };
  if (!control.archivedAt) return { error: "Le contrôle n'est pas archivé." };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.controls).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.controls.id, control.id));
    await logChange(tx, { entityType: 'control', entityId: control.id, action: 'restore', summary: 'Contrôle restauré', reason });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(control.id) };
}

/** Réponse de cancelControlRecord : `notice` quand l'état du contrôle n'a pas pu être recalculé. */
export type CancelRecordState = FormState & { notice?: string };

/**
 * Annule un enregistrement de contrôle saisi par erreur (motif obligatoire, pièces jointes conservées pour la trace).
 * S'il fixait l'état du contrôle, cet état est recalculé : état antérieur à la saisie, ou enregistrement restant le plus récent.
 */
export async function cancelControlRecord(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const reason = readReason(f);
  if (!f.ok) return f.state();

  const db = await getDb();
  const [record] = await db.select().from(t.controlRecords).where(eq(t.controlRecords.id, id!));
  if (!record) return { error: 'Enregistrement introuvable.' };
  if (record.cancelledAt) return { error: 'Enregistrement déjà annulé.' };
  const { control, error: ctrlError } = await loadControlForEdit(record.controlId);
  if (!control) return { error: ctrlError };

  const others = await db.select().from(t.controlRecords)
    .where(and(eq(t.controlRecords.controlId, control.id), isNull(t.controlRecords.cancelledAt), ne(t.controlRecords.id, record.id)))
    .orderBy(desc(t.controlRecords.performedOn), desc(t.controlRecords.id));
  // Même ordre que l'historique (loadWatch) : date, puis saisie la plus récente (une correction du même jour l'emporte).
  const fixesState = record.performedOn === control.lastOn
    && !others.some((o) => o.performedOn > record.performedOn || (o.performedOn === record.performedOn && o.id > record.id));
  const m = others[0];
  let next: { lastOn: string; nextOn: string; reserves: string | null } | null = null;
  if (fixesState) {
    if (record.prevLastOn && (!m || record.prevLastOn >= m.performedOn)) {
      next = { lastOn: record.prevLastOn, nextOn: record.prevNextOn ?? addMonths(record.prevLastOn, control.periodMonths), reserves: record.prevReserves };
    } else if (m) {
      next = { lastOn: m.performedOn, nextOn: addMonths(m.performedOn, control.periodMonths), reserves: m.reserves };
    }
  }

  await db.transaction(async (tx) => {
    await tx.update(t.controlRecords).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.controlRecords.id, record.id));
    if (next) {
      const detached = next.reserves !== control.reserves && control.actionId;
      await tx.update(t.controls).set({ ...next, actionId: detached ? null : control.actionId }).where(eq(t.controls.id, control.id));
      if (detached) await logControlDetach(tx, control, detached, `réserves rétablies par l'annulation de l'enregistrement du ${fmtDate(record.performedOn)}`, session.user.id, reason);
    }
    await logChange(tx, {
      entityType: 'control', entityId: control.id, action: 'cancel_record', reason,
      summary: `Enregistrement du ${fmtDate(record.performedOn)} annulé`,
      details: next ? diffFields(control, next, { lastOn: 'Dernier contrôle', nextOn: 'Prochain contrôle', reserves: 'Réserves' }, fmtLog) : [],
    });
  });
  revalidatePath('/', 'layout');
  const res: CancelRecordState = { ok: true, id: String(record.id), notice: fixesState && !next ? 'Aucun autre enregistrement : état du contrôle à corriger dans la fiche.' : undefined };
  return res;
}

/** Retire une pièce jointe ajoutée par erreur à un enregistrement de contrôle non annulé (suppression réelle du fichier). */
export async function removeControlRecordFile(id: string): Promise<{ error?: string }> {
  const { error } = await requireWatchManager();
  if (error) return { error };
  const db = await getDb();
  const [file] = await db.select().from(t.attachments).where(and(eq(t.attachments.id, id), eq(t.attachments.entityType, 'control_record')));
  if (!file) return { error: 'Pièce jointe introuvable.' };
  const [record] = await db.select().from(t.controlRecords).where(eq(t.controlRecords.id, Number(file.entityId)));
  if (!record) return { error: 'Enregistrement introuvable.' };
  if (record.cancelledAt) return { error: 'Enregistrement annulé : ses pièces jointes sont conservées pour la trace.' };
  const { control, error: ctrlError } = await loadControlForEdit(record.controlId);
  if (!control) return { error: ctrlError ?? undefined };
  await deleteAttachment(file.id);
  await logChange(null, {
    entityType: 'control', entityId: control.id, action: 'remove_file',
    summary: `Pièce jointe « ${file.fileName} » retirée de l'enregistrement du ${fmtDate(record.performedOn)}`,
  });
  revalidatePath('/', 'layout');
  return {};
}
