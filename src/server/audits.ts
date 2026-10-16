'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { CERT_TONES, CERT_TONE_LABELS, FINDING_KEYS, NEW_TRACK, OTHER_AUDIT, isReviewPlanItem, type CertTone } from '@/components/audits/shared';
import { planItemAuditLabel, planStart, relabelDay } from '@/lib/data/audits';
import { MAX_BATCH_BYTES, MAX_FILES_PER_BATCH } from '@/lib/attachments';
import { fmtDate, monthName, monthOf, yearOf } from '@/lib/dates';
import { today } from '@/lib/today';
import { FINDING_KINDS, canEdit } from '@/lib/domain';
import { formReader, nextRef, type FormState } from '@/lib/forms';
import { requireApprover, requireManager } from '@/lib/guard';
import { loadPeople } from '@/lib/queries';
import { checkUpload, deleteAttachment, listAttachments, saveUpload } from '@/lib/uploads';
import { diffFields, logChange, loggedIds } from './changelog';

type Result = { error?: string };

// Traçabilité : un référentiel certifié, un élément du programme ou un constat ne sont jamais supprimés. Le constat et
// l'élément du programme s'annulent avec un motif (AUD-03) ; seul un référentiel jamais certifié se retire. La planification
// d'un élément existant ne change que par « Reporter » (motif obligatoire). Toute modification est inscrite au journal
// (change_log), affiché dans les fenêtres de l'écran.

/**
 * Programme et constats : rôles qui saisissent sur l'écran « Audits » (canEdit : animateur QHSE, direction).
 * Le chef de service et le chef de projet le consultent seulement (AUD-02) : ils ne modifient rien ici.
 */
async function requireAuditEditor() {
  const r = await requireManager();
  if (r.error) return r;
  return canEdit(r.session.role, 'audits') ? r : { ...r, error: 'Votre rôle ne permet pas cette modification.' };
}

const nextSort = (rows: { sort: number }[]) => Math.max(-1, ...rows.map((r) => r.sort)) + 1;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'erreur inconnue');
const shownDate = (d: string | null) => (d ? fmtDate(d) : null);

/** Pièce jointe d'une entité du domaine (retrait d'un fichier ajouté par erreur). */
async function attachmentOf(id: unknown, entityType: string) {
  if (typeof id !== 'string' || !id) return null;
  const db = await getDb();
  const [row] = await db.select().from(t.attachments).where(and(eq(t.attachments.id, id), eq(t.attachments.entityType, entityType)));
  return row ?? null;
}

/** Fichiers d'un même envoi : au-delà, la requête dépasserait la limite des server actions (next.config). */
function checkFiles(f: ReturnType<typeof formReader>, name: string, files: File[]) {
  files.forEach((file) => { const err = checkUpload(file); if (err) f.fail(name, err); });
  if (files.length > MAX_FILES_PER_BATCH) f.fail(name, `${MAX_FILES_PER_BATCH} fichiers au maximum par envoi.`);
  else if (files.reduce((s, x) => s + x.size, 0) > MAX_BATCH_BYTES) f.fail(name, `Les fichiers dépassent ${MAX_BATCH_BYTES / 1024 / 1024} Mo au total : joignez-en moins ou réduisez leur taille.`);
}

// ─── Certifications (animateur QHSE, direction) ─────────────────────────────

const CERT_FIELDS = {
  standard: 'Référentiel', domain: 'Domaine', tone: 'Engagement', organization: 'Organisme', issuedOn: 'Émis le',
  validUntil: "Valable jusqu'au", status: 'Précision', note: 'Note',
} as const;
type CertFields = { domain: string; standard: string; status: string; tone: string; note: string; organization: string | null; issuedOn: string | null; validUntil: string | null };
const certShown = (c: CertFields) => ({
  ...c, tone: CERT_TONE_LABELS[c.tone as CertTone] ?? c.tone, issuedOn: shownDate(c.issuedOn), validUntil: shownDate(c.validUntil),
});

export async function saveCertification(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const domain = f.str('domain', { required: true, max: 60 });
  const standard = f.str('standard', { required: true, max: 80 });
  const status = f.str('status', { max: 80 });
  const tone = f.oneOf('tone', CERT_TONES, { required: true });
  const note = f.str('note', { max: 240 });
  const organization = f.str('organization', { max: 120 }) || null;
  const issuedOn = f.date('issuedOn');
  const validUntil = f.date('validUntil');
  const files = f.files('certificate');
  if (issuedOn && validUntil && validUntil <= issuedOn) f.fail('validUntil', "La fin de validité doit suivre la date d'émission.");
  if (tone === 'ok' && !validUntil && !f.fieldErrors.validUntil) f.fail('validUntil', 'Indiquez la fin de validité du certificat');
  checkFiles(f, 'certificate', files);
  if (!f.ok) return f.state();

  const db = await getDb();
  const byId = session.user.id;
  const values = { domain, standard, status, tone: tone!, note, organization, issuedOn, validUntil };
  let certId = id;
  if (id) {
    const ok = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(t.certifications).where(eq(t.certifications.id, id));
      if (!before) return false;
      await tx.update(t.certifications).set(values).where(eq(t.certifications.id, id));
      const details = diffFields(certShown(before), certShown(values), CERT_FIELDS);
      if (details.length) await logChange(tx, { entityType: 'certification', entityId: id, action: 'update', summary: 'Référentiel modifié', details, byId });
      return true;
    });
    if (!ok) return { error: 'Référentiel introuvable.' };
  } else {
    const rows = await db.select({ id: t.certifications.id, sort: t.certifications.sort }).from(t.certifications);
    // Jamais la référence d'un référentiel retiré : son journal la suit.
    certId = nextRef([...rows.map((r) => r.id), ...(await loggedIds(db, 'certification'))], 'cert-');
    await db.insert(t.certifications).values({ id: certId, ...values, sort: nextSort(rows) });
  }

  try {
    for (const file of files) await saveUpload(file, 'certification', certId!, byId);
  } catch (e) {
    // La fiche reste enregistrée ; un nouveau référentiel (pas encore journalisé) est retiré pour éviter un doublon à la nouvelle saisie.
    if (!id) {
      for (const a of await listAttachments('certification', certId!)) await deleteAttachment(a.id);
      await db.delete(t.certifications).where(eq(t.certifications.id, certId!));
    }
    revalidatePath('/', 'layout');
    return { error: `Le certificat n'a pas pu être enregistré : ${errMsg(e)}`, fieldErrors: { certificate: 'Fichier non enregistré.' } };
  }
  if (!id) await logChange(db, { entityType: 'certification', entityId: certId!, action: 'create', summary: `Référentiel ${standard} ajouté`, byId });
  if (files.length) await logChange(db, { entityType: 'certification', entityId: certId!, action: 'attach', summary: `Certificat joint : ${files.map((x) => x.name).join(', ')}`, byId });
  revalidatePath('/', 'layout');
  return { ok: true, id: certId! };
}

/** Retire un certificat joint par erreur. */
export async function removeCertificationFile(attachmentId: string): Promise<Result> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const row = await attachmentOf(attachmentId, 'certification');
  if (!row) return { error: 'Fichier introuvable.' };
  await deleteAttachment(row.id);
  await logChange(null, { entityType: 'certification', entityId: row.entityId, action: 'detach', summary: `Certificat retiré : ${row.fileName}`, byId: session.user.id });
  revalidatePath('/', 'layout');
  return {};
}

/** Retire un référentiel saisi par erreur : jamais certifié, sans audit au programme ni certificat. Sinon, il passe en « Non engagé ». */
export async function deleteCertification(id: string): Promise<Result> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  if (typeof id !== 'string' || !id) return { error: 'Référentiel introuvable.' };
  const db = await getDb();
  const [[cert], [audit], files] = await Promise.all([
    db.select().from(t.certifications).where(eq(t.certifications.id, id)),
    db.select({ id: t.auditPlanItems.id }).from(t.auditPlanItems).where(eq(t.auditPlanItems.certificationId, id)).limit(1),
    listAttachments('certification', id),
  ]);
  if (!cert) return { error: 'Référentiel introuvable.' };
  if (audit || files.length) return { error: 'Des audits du programme ou un certificat sont rattachés à ce référentiel.' };
  if (cert.issuedOn || cert.validUntil) return { error: 'Référentiel certifié : il reste suivi. Passez-le en « Non engagé » pour arrêter la certification.' };
  await db.transaction(async (tx) => {
    await tx.delete(t.certifications).where(eq(t.certifications.id, id));
    await logChange(tx, { entityType: 'certification', entityId: id, action: 'delete', summary: `Référentiel ${cert.standard} retiré (jamais certifié)`, byId: session.user.id });
  });
  revalidatePath('/', 'layout');
  return {};
}

// ─── Programme annuel ───────────────────────────────────────────────────────

const PLAN_FIELDS = {
  track: 'Ligne', month: 'Mois', label: 'Libellé court', plannedOn: 'Date prévue', detail: 'Intitulé', owner: 'Responsable',
  certification: 'Référentiel', auditor: 'Auditeur', scope: 'Périmètre', done: 'État', doneOn: 'Réalisé le',
} as const;
type PlanFields = {
  track: string; month: number; label: string; plannedOn: string | null; detail: string | null; ownerId: string | null; done: boolean;
  doneOn: string | null; auditor: string | null; scope: string | null; certificationId: string | null;
};

/** Élément porté par une revue de direction (AUD-01) : verrouillé dans le programme. */
const LOCKED = "Échéance d'une revue de direction : sa date et sa réalisation suivent la revue (carte Revue de direction).";
const PLAN_NOT_FOUND = 'Élément du programme introuvable.';

/**
 * Ajout d'un élément au programme, ou modification d'un élément existant (ligne, libellés, responsable, auditeur,
 * réalisation, rapport). Planification d'un élément existant (année, mois, date prévue) : « Reporter » seulement
 * (reschedulePlanItem, motif obligatoire) — les champs reçus sont ignorés.
 */
export async function savePlanItem(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id');
  const db = await getDb();
  const [before] = id ? await db.select().from(t.auditPlanItems).where(eq(t.auditPlanItems.id, id)) : [];
  if (id && !before) return { error: PLAN_NOT_FOUND };
  if (before?.cancelledAt) return { error: 'Élément annulé : il ne peut plus être modifié.' };
  if (before?.reviewId != null) return { error: LOCKED };

  const year = before ? before.year : f.int('year', { required: true, min: 2000, max: 2100 });
  const trackChoice = f.str('track', { required: true });
  const track = trackChoice === NEW_TRACK ? f.str('newTrack', { required: true, max: 40 }) : trackChoice;
  const month = before ? before.month : f.int('month', { required: true, min: 1, max: 12 });
  const label = f.str('label', { required: true, max: 30 });
  const plannedOn = before ? before.plannedOn : f.date('plannedOn');
  const detail = f.str('detail', { max: 160 }) || null;
  const ownerId = f.opt('ownerId');
  const done = f.bool('done');
  const certificationId = f.opt('certificationId');
  const doneOnInput = f.date('doneOn');
  const files = f.files('report');
  // Revue de direction : ni auditeur, ni périmètre, ni rapport (même règle que le formulaire et les chargements).
  const review = isReviewPlanItem({ track, label, detail });
  const auditor = review ? null : f.str('auditor', { max: 120 }) || null;
  const scope = review ? null : f.str('scope', { max: 200 }) || null;
  const now = today();
  if (!before && year && month && plannedOn && (yearOf(plannedOn) !== year || monthOf(plannedOn) !== month)) {
    f.fail('plannedOn', `La date prévue doit tomber en ${monthName(month)} ${year}.`);
  }
  if (doneOnInput && doneOnInput > now) f.fail('doneOn', 'Date de réalisation future.');
  if (review && files.length) f.fail('report', "Une revue de direction ne porte pas de rapport d'audit.");
  checkFiles(f, 'report', files);
  if (!f.ok) return f.state();

  const byId = session.user.id;
  if (ownerId) {
    const [p] = await db.select({ id: t.people.id }).from(t.people).where(eq(t.people.id, ownerId));
    if (!p) return { error: 'Responsable introuvable.', fieldErrors: { ownerId: 'Choisissez une personne de la liste.' } };
  }
  if (certificationId) {
    const [c] = await db.select({ id: t.certifications.id }).from(t.certifications).where(eq(t.certifications.id, certificationId));
    if (!c) return { error: 'Référentiel introuvable.', fieldErrors: { certificationId: 'Choisissez un référentiel de la liste.' } };
  }
  if (before && review && !isReviewPlanItem(before)) {
    // Un audit qui porte des constats ou un rapport ne devient pas une revue (constats et rapport deviendraient inaccessibles).
    const [[finding], reports] = await Promise.all([
      db.select({ id: t.auditFindings.id }).from(t.auditFindings).where(eq(t.auditFindings.planItemId, before.id)).limit(1),
      listAttachments('audit_plan_item', String(before.id)),
    ]);
    if (finding || reports.length) return { error: 'Cet audit porte des constats ou un rapport : il ne peut pas devenir une revue de direction (ligne ou intitulé « revue de direction »).' };
  }
  // Un élément en vigueur par ligne et par mois (un élément annulé libère le mois).
  const clash = await db.select({ id: t.auditPlanItems.id }).from(t.auditPlanItems)
    .where(and(eq(t.auditPlanItems.year, year!), eq(t.auditPlanItems.track, track), eq(t.auditPlanItems.month, month!), isNull(t.auditPlanItems.cancelledAt), id ? ne(t.auditPlanItems.id, id) : undefined));
  if (clash.length) {
    const field = before ? 'track' : 'month';
    return { error: `Un élément est déjà prévu en ${monthName(month!)} sur la ligne « ${track} ». Modifiez-le ou choisissez un autre mois.`, fieldErrors: { [field]: 'Mois déjà occupé sur cette ligne.' } };
  }

  // Réalisé sans date : la date prévue si elle est passée, sinon aujourd'hui ; non réalisé : pas de date de réalisation.
  const doneOn = done ? doneOnInput ?? (plannedOn && plannedOn <= now ? plannedOn : now) : null;
  const values = { year: year!, track, month: month!, label, plannedOn, detail, ownerId, done, doneOn, auditor, scope, certificationId };
  let itemId = id;
  if (before) {
    const [people, certs] = await Promise.all([
      loadPeople(),
      db.select({ id: t.certifications.id, standard: t.certifications.standard }).from(t.certifications)
        .where(inArray(t.certifications.id, [before.certificationId, certificationId].filter((c): c is string => !!c))),
    ]);
    const shown = (p: PlanFields) => ({
      ...p, month: monthName(p.month), plannedOn: shownDate(p.plannedOn), doneOn: shownDate(p.doneOn), done: p.done ? 'Réalisé' : 'À réaliser',
      owner: p.ownerId ? people.get(p.ownerId)?.name ?? p.ownerId : null,
      certification: p.certificationId ? certs.find((c) => c.id === p.certificationId)?.standard ?? p.certificationId : null,
    });
    const saved = await db.transaction(async (tx) => {
      const rows = await tx.update(t.auditPlanItems).set(values)
        .where(and(eq(t.auditPlanItems.id, before.id), isNull(t.auditPlanItems.cancelledAt), isNull(t.auditPlanItems.reviewId)))
        .returning({ id: t.auditPlanItems.id });
      if (!rows.length) return false;
      // Les constats rattachés reprennent le libellé de l'audit (intitulé, mois, année).
      await tx.update(t.auditFindings).set({ audit: planItemAuditLabel(values) }).where(eq(t.auditFindings.planItemId, before.id));
      const details = diffFields(shown(before), shown(values), PLAN_FIELDS);
      if (details.length) {
        const summary = done && !before.done ? `Réalisé le ${fmtDate(doneOn!)}` : !done && before.done ? 'Réalisation annulée' : 'Élément modifié';
        await logChange(tx, { entityType: 'audit_plan_item', entityId: before.id, action: 'update', summary, details, byId });
      }
      return true;
    });
    if (!saved) return { error: 'Élément annulé ou rattaché à une revue entre-temps : rechargez la page.' };
  } else {
    const [row] = await db.insert(t.auditPlanItems).values(values).returning({ id: t.auditPlanItems.id });
    itemId = row.id;
  }

  try {
    for (const file of files) await saveUpload(file, 'audit_plan_item', String(itemId), byId);
  } catch (e) {
    // Un élément modifié reste enregistré ; un nouvel élément (pas encore journalisé) est retiré pour permettre une nouvelle saisie complète.
    if (!id) {
      for (const a of await listAttachments('audit_plan_item', String(itemId))) await deleteAttachment(a.id);
      await db.delete(t.auditPlanItems).where(eq(t.auditPlanItems.id, itemId!));
    }
    revalidatePath('/', 'layout');
    return { error: `Le rapport n'a pas pu être enregistré : ${errMsg(e)}`, fieldErrors: { report: 'Fichier non enregistré.' } };
  }
  if (!id) await logChange(db, { entityType: 'audit_plan_item', entityId: itemId!, action: 'create', summary: `Ajouté au programme ${year} (${track}, ${monthName(month!)})`, byId });
  if (files.length) await logChange(db, { entityType: 'audit_plan_item', entityId: itemId!, action: 'attach', summary: `Rapport joint : ${files.map((x) => x.name).join(', ')}`, byId });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(itemId) };
}

/** Retire un rapport d'audit joint par erreur. */
export async function removePlanItemReport(attachmentId: string): Promise<Result> {
  const { session, error } = await requireAuditEditor();
  if (error) return { error };
  const row = await attachmentOf(attachmentId, 'audit_plan_item');
  if (!row) return { error: 'Fichier introuvable.' };
  await deleteAttachment(row.id);
  await logChange(null, { entityType: 'audit_plan_item', entityId: row.entityId, action: 'detach', summary: `Rapport retiré : ${row.fileName}`, byId: session.user.id });
  revalidatePath('/', 'layout');
  return {};
}

/**
 * Reporte un élément du programme (AUD-03) : nouvelle année, mois et date prévue, motif obligatoire. La première
 * planification est conservée (postponedFrom) ; les constats rattachés reprennent le libellé de l'audit. Un élément réalisé,
 * annulé ou porté par une revue de direction (reportée depuis sa carte) ne se reporte pas.
 */
export async function reschedulePlanItem(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const year = f.int('year', { required: true, min: 2000, max: 2100 });
  const month = f.int('month', { required: true, min: 1, max: 12 });
  const plannedOn = f.date('plannedOn');
  const reason = f.reason();
  if (year && month && plannedOn && (yearOf(plannedOn) !== year || monthOf(plannedOn) !== month)) {
    f.fail('plannedOn', `La date prévue doit tomber en ${monthName(month)} ${year}.`);
  }
  if (!f.ok) return f.state();

  const db = await getDb();
  const [before] = await db.select().from(t.auditPlanItems).where(eq(t.auditPlanItems.id, id!));
  if (!before) return { error: PLAN_NOT_FOUND };
  if (before.cancelledAt) return { error: 'Élément annulé : il ne se reporte plus.' };
  if (before.done) return { error: 'Élément réalisé : il ne se reporte pas.' };
  if (before.reviewId != null) return { error: "Échéance d'une revue de direction : reportez la revue depuis sa carte." };
  if (before.year === year && before.month === month && before.plannedOn === plannedOn) {
    return { error: 'Choisissez une autre date ou un autre mois.', fieldErrors: { month: 'Planification inchangée.' } };
  }
  const [clash] = await db.select({ label: t.auditPlanItems.label }).from(t.auditPlanItems)
    .where(and(eq(t.auditPlanItems.year, year!), eq(t.auditPlanItems.track, before.track), eq(t.auditPlanItems.month, month!), isNull(t.auditPlanItems.cancelledAt), ne(t.auditPlanItems.id, before.id)));
  if (clash) {
    return {
      error: `Le programme prévoit déjà « ${clash.label} » en ${monthName(month!)} ${year} sur la ligne « ${before.track} ». Choisissez un autre mois.`,
      fieldErrors: { month: 'Mois déjà occupé sur cette ligne.' },
    };
  }

  const byId = session.user.id;
  const values = {
    year: year!, month: month!, plannedOn, label: relabelDay(before.label, before.plannedOn, plannedOn),
    postponedFrom: before.postponedFrom ?? planStart(before),
  };
  const details = diffFields(
    { month: monthName(before.month), plannedOn: shownDate(before.plannedOn), year: String(before.year) },
    { month: monthName(month!), plannedOn: shownDate(plannedOn), year: String(year) },
    { month: 'Mois', plannedOn: 'Date prévue', year: 'Année' },
  );
  const moved = await db.transaction(async (tx) => {
    const rows = await tx.update(t.auditPlanItems).set(values)
      .where(and(eq(t.auditPlanItems.id, before.id), isNull(t.auditPlanItems.cancelledAt), eq(t.auditPlanItems.done, false), isNull(t.auditPlanItems.reviewId)))
      .returning({ id: t.auditPlanItems.id });
    if (!rows.length) return false;
    // Les constats rattachés reprennent le libellé de l'audit (intitulé, mois, année).
    await tx.update(t.auditFindings).set({ audit: planItemAuditLabel({ ...before, ...values }) }).where(eq(t.auditFindings.planItemId, before.id));
    await logChange(tx, {
      entityType: 'audit_plan_item', entityId: before.id, action: 'update', reason, details, byId,
      summary: plannedOn ? `Reporté au ${fmtDate(plannedOn)}` : `Reporté en ${monthName(month!)} ${year}`,
    });
    return true;
  });
  if (!moved) return { error: 'Élément réalisé, annulé ou rattaché à une revue entre-temps : rechargez la page.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(before.id) };
}

/**
 * Annule un élément du programme (AUD-03), motif obligatoire : jamais supprimé, il sort de la grille, des échéances, des
 * constats et du dossier de revue, et reste consultable dans « Éléments annulés ». Refusé quand l'audit a eu lieu (réalisé,
 * constats ou rapport), quand une action porte l'échéance, ou pour une revue de direction (annulée depuis sa carte).
 */
export async function cancelPlanItem(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();

  const db = await getDb();
  const [[item], [finding], files] = await Promise.all([
    db.select().from(t.auditPlanItems).where(eq(t.auditPlanItems.id, id!)),
    db.select({ id: t.auditFindings.id }).from(t.auditFindings).where(eq(t.auditFindings.planItemId, id!)).limit(1),
    listAttachments('audit_plan_item', String(id)),
  ]);
  if (!item) return { error: PLAN_NOT_FOUND };
  if (item.cancelledAt) return { error: 'Élément déjà annulé.' };
  if (item.done) return { error: 'Élément réalisé : il reste au programme.' };
  if (item.reviewId != null) return { error: "Échéance d'une revue de direction : annulez la revue depuis sa carte." };
  // L'élément d'audit d'une action n'est jamais détaché (D15) : seul l'abandon de l'action le libère.
  if (item.actionId) return { error: `Échéance portée par l'action ${item.actionId} : abandonnez-la d'abord dans le plan d'actions.` };
  if (finding || files.length) return { error: "Des constats ou un rapport sont rattachés à cet audit : l'audit a eu lieu, déclarez-le réalisé." };

  const byId = session.user.id;
  const cancelled = await db.transaction(async (tx) => {
    const rows = await tx.update(t.auditPlanItems).set({ cancelledAt: new Date(), cancelledById: byId, cancelReason: reason })
      .where(and(eq(t.auditPlanItems.id, item.id), isNull(t.auditPlanItems.cancelledAt), eq(t.auditPlanItems.done, false), isNull(t.auditPlanItems.reviewId), isNull(t.auditPlanItems.actionId)))
      .returning({ id: t.auditPlanItems.id });
    if (!rows.length) return false;
    await logChange(tx, {
      entityType: 'audit_plan_item', entityId: item.id, action: 'cancel', reason, byId,
      summary: `Annulé · retiré du programme ${item.year} (${item.track}, ${monthName(item.month)})`,
    });
    return true;
  });
  if (!cancelled) return { error: 'Élément modifié entre-temps : rechargez la page.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(item.id) };
}

// ─── Constats d'audit ───────────────────────────────────────────────────────

const FINDING_FIELDS = { audit: 'Audit', kind: 'Type', clause: 'Exigence', foundOn: 'Date du constat', text: 'Constat' } as const;
type FindingFields = { audit: string; kind: string; clause: string | null; foundOn: string | null; text: string };
const findingShown = (x: FindingFields) => ({ ...x, kind: FINDING_KINDS[x.kind]?.label ?? x.kind, foundOn: shownDate(x.foundOn) });

export async function saveFinding(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id');
  const planChoice = f.str('planItemId');
  const planItemId = planChoice && planChoice !== OTHER_AUDIT ? f.int('planItemId', { min: 1 }) : null;
  // Constat hors programme : libellé d'audit libre (rétrocompatibilité, audits non planifiés).
  const freeAudit = planItemId ? '' : f.str('audit', { required: true, max: 120 });
  const kind = f.oneOf('kind', FINDING_KEYS, { required: true });
  const text = f.str('text', { required: true, max: 400 });
  const clause = f.str('clause', { max: 40 }) || null;
  const foundOnInput = f.date('foundOn');
  if (foundOnInput && foundOnInput > today()) f.fail('foundOn', 'Date du constat future.');
  if (!f.ok) return f.state();

  const db = await getDb();
  const byId = session.user.id;
  const [before] = id ? await db.select().from(t.auditFindings).where(eq(t.auditFindings.id, id)) : [];
  if (id && !before) return { error: 'Constat introuvable.' };
  if (before?.cancelledAt) return { error: 'Constat annulé : il ne peut plus être modifié.' };
  let audit = freeAudit;
  let foundOn = foundOnInput;
  if (planItemId) {
    const [item] = await db.select().from(t.auditPlanItems).where(eq(t.auditPlanItems.id, planItemId));
    if (!item || isReviewPlanItem(item)) return { error: 'Audit introuvable.', fieldErrors: { planItemId: 'Choisissez un audit du programme.' } };
    audit = planItemAuditLabel(item);
    foundOn ??= item.doneOn ?? item.plannedOn;
  }
  const values = { audit, planItemId, clause, foundOn, kind: kind!, text };
  if (before) {
    await db.transaction(async (tx) => {
      await tx.update(t.auditFindings).set(values).where(eq(t.auditFindings.id, before.id));
      const details = diffFields(findingShown(before), findingShown(values), FINDING_FIELDS);
      if (details.length) await logChange(tx, { entityType: 'audit_finding', entityId: before.id, action: 'update', summary: 'Constat modifié', details, byId });
    });
    revalidatePath('/', 'layout');
    return { ok: true, id: String(before.id) };
  }
  const newId = await db.transaction(async (tx) => {
    const rows = await tx.select({ sort: t.auditFindings.sort }).from(t.auditFindings);
    const [row] = await tx.insert(t.auditFindings).values({ ...values, sort: nextSort(rows) }).returning({ id: t.auditFindings.id });
    await logChange(tx, { entityType: 'audit_finding', entityId: row.id, action: 'create', summary: `Constat enregistré (${(FINDING_KINDS[values.kind]?.label ?? values.kind).toLowerCase()}) · ${audit}`, byId });
    return row.id;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(newId) };
}

/**
 * Annule un constat saisi par erreur ou en double (motif obligatoire) : jamais supprimé, il sort des constats, des échéances
 * et du dossier de revue, et reste consultable avec le filtre « Annulés ». L'action liée reste au plan d'actions.
 */
export async function cancelFinding(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const byId = session.user.id;
  const done = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.auditFindings).set({ cancelledAt: new Date(), cancelledById: byId, cancelReason: reason })
      .where(and(eq(t.auditFindings.id, id!), isNull(t.auditFindings.cancelledAt))).returning({ actionId: t.auditFindings.actionId, audit: t.auditFindings.audit });
    if (!row) return false;
    await logChange(tx, {
      entityType: 'audit_finding', entityId: id!, action: 'cancel', reason, byId,
      summary: row.actionId ? `Constat annulé (l'action ${row.actionId} reste au plan d'actions)` : 'Constat annulé',
    });
    if (row.actionId) await logChange(tx, { entityType: 'action', entityId: row.actionId, action: 'update', summary: `Constat d'origine annulé (${row.audit})`, reason, byId });
    return true;
  });
  if (!done) return { error: 'Constat introuvable ou déjà annulé.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(id) };
}
