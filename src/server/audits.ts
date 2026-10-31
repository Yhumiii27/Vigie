'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { CERT_TONES, CERT_TONE_LABELS, FINDING_KEYS, NEW_TRACK, OTHER_AUDIT, isReviewPlanItem, type CertTone } from '@/lib/rules/audits';
import { planItemAuditLabel, planStart, relabelDay } from '@/lib/data/audits';
import { addMonths, fmtDate, monthName, monthOf, yearOf } from '@/lib/dates';
import { today } from '@/lib/today';
import { CERT_CYCLE_MONTHS, FINDING_GAP_KINDS, FINDING_KINDS } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireEditor, requireInSite } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import { loadPeople } from '@/lib/queries';
import { ALL_SITES } from '@/lib/session';
import { checkUploadBatch, deleteAttachment, listAttachments, saveUpload } from '@/lib/uploads';
import { diffFields, logChange } from './changelog';
import { VERSION_FIELD, assertFresh, freshWrite } from './versions';
import { nextEntityReference } from './references';
import { nextSort } from '@/lib/sort-order';

type Result = { error?: string };

// Traçabilité : un référentiel certifié, un élément du programme ou un constat ne sont jamais supprimés. Le constat et
// l'élément du programme s'annulent avec un motif (AUD-03) ; seul un référentiel jamais certifié se retire. La planification
// d'un élément existant ne change que par « Reporter » (motif obligatoire). Toute modification est inscrite au journal
// (change_log), affiché dans les fenêtres de l'écran.

/**
 * Programme et constats : rôles qui saisissent sur l'écran « Audits » (canEdit : animateur QHSE, direction).
 * Le chef de service et le chef de projet le consultent seulement (AUD-02) : ils ne modifient rien ici.
 */
const requireAuditEditor = () => requireEditor('audits');


/** Champ Site d'un formulaire (AUD-22) : « Tous les sites » (élément commun à l'entreprise) = null. */
const siteField = (f: ReturnType<typeof formReader>) => {
  const v = f.str('siteId');
  return !v || v === ALL_SITES ? null : v;
};

/**
 * Règle de site d'une écriture (AUD-22) : l'élément existant est du site sélectionné et du périmètre (requireInSite) ; un
 * nouvel élément, ou un changement de site, vise un site actif du périmètre (« Tous les sites » : périmètre complet).
 */
async function siteRule(before: { siteId: string | null } | null | undefined, siteId: string | null): Promise<string | null> {
  if (before) {
    const err = await requireInSite(before.siteId);
    if (err) return err;
    if (before.siteId === siteId) return null;
  }
  return requireInSite(siteId, { create: true });
}

/** Libellé d'un site au journal (« Tous les sites » pour un élément commun). */
async function siteNames() {
  const db = await getDb();
  const rows = await db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites);
  const m = new Map(rows.map((r) => [r.id, r.label.split(' — ')[0]]));
  return (id: string | null) => (id ? m.get(id) ?? id : 'Tous les sites');
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'erreur inconnue');
const shownDate = (d: string | null) => (d ? fmtDate(d) : null);

/** Pièce jointe d'une entité du domaine (retrait d'un fichier ajouté par erreur). */
async function attachmentOf(id: unknown, entityType: string) {
  if (typeof id !== 'string' || !id) return null;
  const db = await getDb();
  const [row] = await db.select().from(t.attachments).where(and(eq(t.attachments.id, id), eq(t.attachments.entityType, entityType)));
  return row ?? null;
}

/** Contrôle d'un envoi de pièces jointes (nombre, volume, contenu, limites de la personne : checkUploadBatch) ; erreur portée par le champ `name`. */
async function checkFiles(f: ReturnType<typeof formReader>, name: string, files: File[], by: string) {
  const err = await checkUploadBatch(files, by);
  if (err) f.fail(name, err);
}

// ─── Certifications (animateur QHSE, direction) ─────────────────────────────

const CERT_FIELDS = {
  standard: 'Référentiel', domain: 'Domaine', tone: 'Engagement', organization: 'Organisme', issuedOn: 'Émis le',
  validUntil: "Valable jusqu'au", status: 'Précision', note: 'Note', site: 'Site',
} as const;
type CertFields = { domain: string; standard: string; status: string; tone: string; note: string; organization: string | null; issuedOn: string | null; validUntil: string | null; siteId?: string | null };
const certShown = (c: CertFields, site: (id: string | null) => string = (id) => id ?? 'Tous les sites') => ({
  ...c, tone: CERT_TONE_LABELS[c.tone as CertTone] ?? c.tone, issuedOn: shownDate(c.issuedOn), validUntil: shownDate(c.validUntil),
  site: c.siteId === undefined ? undefined : site(c.siteId ?? null),
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
  const siteInput = fd.has('siteId') ? siteField(f) : undefined;
  const files = f.files('certificate');
  if (issuedOn && validUntil && validUntil <= issuedOn) f.fail('validUntil', "La fin de validité doit suivre la date d'émission.");
  if (tone === 'ok' && !validUntil && !f.fieldErrors.validUntil) f.fail('validUntil', 'Indiquez la fin de validité du certificat');
  // AUD-08 : un certificat vaut un cycle de 3 ans au plus (ISO/IEC 17021-1).
  if (issuedOn && validUntil && validUntil > addMonths(issuedOn, CERT_CYCLE_MONTHS)) f.fail('validUntil', CYCLE_TOO_LONG);
  await checkFiles(f, 'certificate', files, session.user.id);
  if (!f.ok) return f.state();

  const db = await getDb();
  const byId = session.user.id;
  // AUD-22 : site couvert par le certificat (null : entreprise), règle de site des écritures.
  const [current] = id ? await db.select({ siteId: t.certifications.siteId }).from(t.certifications).where(eq(t.certifications.id, id)) : [];
  if (id && !current) return { error: 'Référentiel introuvable.' };
  // Champ absent (appel antérieur au paquet 13) : site enregistré conservé.
  const siteId = siteInput === undefined ? current?.siteId ?? null : siteInput;
  const siteError = await siteRule(current, siteId);
  if (siteError) return { error: siteError, fieldErrors: { siteId: siteError } };
  const site = await siteNames();
  const values = { domain, standard, status, tone: tone!, note, organization, issuedOn, validUntil, siteId };
  let certId = id;
  if (id) {
    let ok = false;
    const stale = await freshWrite(async () => { ok = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(t.certifications).where(eq(t.certifications.id, id));
      if (!before) return false;
      // QUA-12 : référentiel modifié depuis l'ouverture du formulaire (autre saisie, cycle, certificat) : rien n'est écrasé.
      await assertFresh(tx, 'certification', id, fd.get(VERSION_FIELD));
      await tx.update(t.certifications).set(values).where(eq(t.certifications.id, id));
      const details = diffFields(certShown(before, site), certShown(values, site), CERT_FIELDS);
      if (details.length) await logChange(tx, { entityType: 'certification', entityId: id, action: 'update', summary: 'Référentiel modifié', details, byId });
      return true;
    }); });
    if (stale) return { error: stale };
    if (!ok) return { error: 'Référentiel introuvable.' };
  } else {
    // Référence tirée sous verrou dans la transaction (PRD-08) ; jamais celle d'un référentiel retiré : son journal la suit.
    certId = await db.transaction(async (tx) => {
      const rows = await tx.select({ id: t.certifications.id, sort: t.certifications.sort }).from(t.certifications);
      const ref = await nextEntityReference(tx, 'certification', 'cert-');
      await tx.insert(t.certifications).values({ id: ref, ...values, sort: nextSort(rows) });
      return ref;
    });
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

const CYCLE_TOO_LONG = 'Un certificat vaut au plus 3 ans après son émission (cycle de certification, ISO/IEC 17021-1).';

/** Référentiel certifié modifiable par le cycle de certification (AUD-08), ou message d'erreur. */
async function certifiedCert(id: string) {
  const db = await getDb();
  const [cert] = await db.select().from(t.certifications).where(eq(t.certifications.id, id));
  if (!cert) return { error: 'Référentiel introuvable.' as string, db, cert: undefined };
  const siteError = await requireInSite(cert.siteId);
  if (siteError) return { error: siteError, db, cert: undefined };
  if (cert.tone !== 'ok' || !cert.issuedOn) return { error: 'Référentiel non certifié : enregistrez d’abord le certificat (Modifier).', db, cert: undefined };
  return { error: null, db, cert };
}

/**
 * Renouvelle le certificat après l'audit de renouvellement (AUD-08) : nouveau cycle (émission, fin de validité dans les
 * 3 ans, organisme) ; le cycle précédent reste au journal du référentiel. Refusé pendant une suspension.
 */
export async function renewCertification(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const issuedOn = f.date('issuedOn', { required: true });
  const validUntil = f.date('validUntil', { required: true });
  const organization = f.str('organization', { max: 120 }) || null;
  if (issuedOn && issuedOn > today()) f.fail('issuedOn', "Date d'émission future.");
  if (issuedOn && validUntil && validUntil <= issuedOn) f.fail('validUntil', "La fin de validité doit suivre la date d'émission.");
  if (issuedOn && validUntil && validUntil > addMonths(issuedOn, CERT_CYCLE_MONTHS)) f.fail('validUntil', CYCLE_TOO_LONG);
  if (!f.ok) return f.state();
  const { error: certError, db, cert } = await certifiedCert(id);
  if (!cert) return { error: certError ?? 'Référentiel introuvable.' };
  if (cert.suspendedOn) return { error: 'Certificat suspendu : levez la suspension avant de le renouveler.' };
  if (issuedOn! <= cert.issuedOn!) return { error: 'Certains champs sont à corriger.', fieldErrors: { issuedOn: `Le nouveau certificat suit le précédent (émis le ${fmtDate(cert.issuedOn!)}).` } };
  const next = { issuedOn: issuedOn!, validUntil: validUntil!, organization: organization ?? cert.organization };
  await db.transaction(async (tx) => {
    await tx.update(t.certifications).set(next).where(eq(t.certifications.id, cert.id));
    await logChange(tx, {
      entityType: 'certification', entityId: cert.id, action: 'renew', byId: session.user.id,
      summary: `Certificat renouvelé · nouveau cycle du ${fmtDate(next.issuedOn)} au ${fmtDate(next.validUntil)}`,
      details: diffFields(certShown(cert), certShown({ ...cert, ...next }), CERT_FIELDS),
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: cert.id };
}

/** Suspension du certificat par l'organisme (AUD-08) : date et motif obligatoires ; statut « suspendu » jusqu'à la levée. */
export async function suspendCertification(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const suspendedOn = f.date('suspendedOn', { required: true });
  const reason = f.reason();
  if (suspendedOn && suspendedOn > today()) f.fail('suspendedOn', 'Date future.');
  if (!f.ok) return f.state();
  const { error: certError, db, cert } = await certifiedCert(id);
  if (!cert) return { error: certError ?? 'Référentiel introuvable.' };
  if (cert.suspendedOn) return { error: 'Certificat déjà suspendu.' };
  if (suspendedOn! < cert.issuedOn!) return { error: 'Certains champs sont à corriger.', fieldErrors: { suspendedOn: `Au plus tôt le ${fmtDate(cert.issuedOn!)} (émission).` } };
  await db.transaction(async (tx) => {
    await tx.update(t.certifications).set({ suspendedOn, suspendedById: session.user.id, suspendReason: reason }).where(eq(t.certifications.id, cert.id));
    await logChange(tx, { entityType: 'certification', entityId: cert.id, action: 'suspend', reason, byId: session.user.id, summary: `Certificat suspendu le ${fmtDate(suspendedOn!)}` });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: cert.id };
}

/** Levée de la suspension (décision de l'organisme), motif obligatoire ; la suspension reste au journal. */
export async function reinstateCertification(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { error: certError, db, cert } = await certifiedCert(id);
  if (!cert) return { error: certError ?? 'Référentiel introuvable.' };
  if (!cert.suspendedOn) return { error: "Le certificat n'est pas suspendu." };
  await db.transaction(async (tx) => {
    await tx.update(t.certifications).set({ suspendedOn: null, suspendedById: null, suspendReason: null }).where(eq(t.certifications.id, cert.id));
    await logChange(tx, {
      entityType: 'certification', entityId: cert.id, action: 'reinstate', reason, byId: session.user.id,
      summary: `Suspension levée (suspendu depuis le ${fmtDate(cert.suspendedOn!)})`,
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: cert.id };
}

/** Retire un certificat joint par erreur. */
export async function removeCertificationFile(attachmentId: string): Promise<Result> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const row = await attachmentOf(attachmentId, 'certification');
  if (!row) return { error: 'Fichier introuvable.' };
  const db = await getDb();
  const [cert] = await db.select({ siteId: t.certifications.siteId }).from(t.certifications).where(eq(t.certifications.id, row.entityId));
  const siteError = await requireInSite(cert?.siteId);
  if (siteError) return { error: siteError };
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
  const siteError = await requireInSite(cert.siteId);
  if (siteError) return { error: siteError };
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
  certification: 'Référentiel', auditorName: 'Auditeur interne', auditor: 'Auditeur externe', scope: 'Périmètre', site: 'Site', done: 'État', doneOn: 'Réalisé le',
} as const;
type PlanFields = {
  track: string; month: number; label: string; plannedOn: string | null; detail: string | null; ownerId: string | null; done: boolean;
  doneOn: string | null; auditor: string | null; auditorId: string | null; scope: string | null; certificationId: string | null; siteId: string | null;
};

/** Élément porté par une revue de direction (AUD-01) : verrouillé dans le programme. */
const LOCKED = "Échéance d'une revue de direction : sa date et sa réalisation suivent la revue (carte Revue de direction).";
const PLAN_NOT_FOUND = 'Élément du programme introuvable.';
const LEFT_AUDITOR = "Auditeur sorti de l'effectif : choisissez une personne présente.";

/**
 * Ajout d'un élément au programme, ou modification d'un élément existant (ligne, libellés, responsable, auditeur,
 * réalisation, rapport, site). Planification d'un élément existant (année, mois, date prévue) : « Reporter » seulement
 * (reschedulePlanItem, motif obligatoire) — les champs reçus sont ignorés. Plusieurs éléments par ligne et par mois (AUD-21).
 * AUD-20 : audit hors programme (`unplanned`, à la création) : réalisé à sa date (année et mois déduits), hors échéances.
 * AUD-22 : site de l'élément (requireInSite, création ou changement de site) repris par ses constats. AUD-27 : auditeur
 * interne choisi dans l'annuaire (personne présente, ou celle déjà enregistrée), auditeur externe en texte.
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
  const unplanned = before ? before.unplanned : f.bool('unplanned');

  const trackChoice = f.str('track', { required: true });
  const track = trackChoice === NEW_TRACK ? f.str('newTrack', { required: true, max: 40 }) : trackChoice;
  const label = f.str('label', { required: true, max: 30 });
  const detail = f.str('detail', { max: 160 }) || null;
  const ownerId = f.opt('ownerId');
  const certificationId = f.opt('certificationId');
  const doneOnInput = f.date('doneOn', { required: unplanned && !before });
  // Audit hors programme : toujours réalisé, à sa date de réalisation (année et mois déduits à la création).
  const done = unplanned ? true : f.bool('done');
  // Audit hors programme : sa date de réalisation fixe l'année, le mois et la date (aussi à la modification).
  const unplannedOn = unplanned ? doneOnInput ?? before?.doneOn ?? null : null;
  const year = unplanned ? (unplannedOn ? yearOf(unplannedOn) : null) : before ? before.year : f.int('year', { required: true, min: 2000, max: 2100 });
  const month = unplanned ? (unplannedOn ? monthOf(unplannedOn) : null) : before ? before.month : f.int('month', { required: true, min: 1, max: 12 });
  const plannedOn = unplanned ? unplannedOn : before ? before.plannedOn : f.date('plannedOn');
  const files = f.files('report');
  // Champ absent du formulaire (appel antérieur au paquet 13) : site et auditeur interne enregistrés conservés.
  const siteChoice = fd.has('siteId') ? siteField(f) : before?.siteId ?? null;
  // Revue de direction : ni auditeur, ni périmètre, ni rapport (même règle que le formulaire et les chargements) ; commune
  // à l'entreprise (AUD-22).
  const review = isReviewPlanItem({ track, label, detail });
  const siteId = review ? null : siteChoice;
  const auditor = review ? null : f.str('auditor', { max: 120 }) || null;
  const auditorId = review ? null : fd.has('auditorId') ? f.opt('auditorId') : before?.auditorId ?? null;
  const scope = review ? null : f.str('scope', { max: 200 }) || null;
  const now = today();
  if (unplanned && review) f.fail('track', 'Un audit hors programme ne porte pas de revue de direction : planifiez la revue depuis sa carte.');
  if (!before && !unplanned && year && month && plannedOn && (yearOf(plannedOn) !== year || monthOf(plannedOn) !== month)) {
    f.fail('plannedOn', `La date prévue doit tomber en ${monthName(month)} ${year}.`);
  }
  if (doneOnInput && doneOnInput > now) f.fail('doneOn', 'Date de réalisation future.');
  if (unplanned && before && !doneOnInput && !before.doneOn) f.fail('doneOn', 'Indiquez la date de réalisation de l’audit.');
  // AUD-11 : une date « Réalisé le » sans la case cochée n'est jamais perdue en silence (sauf la date déjà enregistrée
  // d'un élément dont on annule la réalisation).
  if (doneOnInput && !done && !(before?.done && before.doneOn === doneOnInput)) {
    f.fail('doneOn', "Cochez « Réalisé » pour enregistrer cette date, ou effacez-la.");
  }
  if (review && files.length) f.fail('report', "Une revue de direction ne porte pas de rapport d'audit.");
  await checkFiles(f, 'report', files, session.user.id);
  if (!f.ok) return f.state();

  const siteError = await siteRule(before, siteId);
  if (siteError) return { error: siteError, fieldErrors: { siteId: siteError } };
  const byId = session.user.id;
  if (ownerId) {
    const [p] = await db.select({ id: t.people.id }).from(t.people).where(eq(t.people.id, ownerId));
    if (!p) return { error: 'Responsable introuvable.', fieldErrors: { ownerId: 'Choisissez une personne de la liste.' } };
  }
  if (auditorId) {
    const [p] = await db.select({ id: t.people.id, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, auditorId));
    if (!p) return { error: 'Auditeur introuvable.', fieldErrors: { auditorId: 'Choisissez une personne de la liste.' } };
    if (hasLeft(p, now) && auditorId !== before?.auditorId) return { error: 'Certains champs sont à corriger.', fieldErrors: { auditorId: LEFT_AUDITOR } };
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

  // Réalisé sans date : la date prévue si elle est passée, sinon aujourd'hui ; non réalisé : pas de date de réalisation.
  const doneOn = done ? doneOnInput ?? (unplanned ? before?.doneOn : null) ?? (plannedOn && plannedOn <= now ? plannedOn : now) : null;
  const values = { year: year!, track, month: month!, label, plannedOn, detail, ownerId, done, doneOn, auditor, auditorId, scope, certificationId, siteId, unplanned };
  let itemId = id;
  if (before) {
    const [people, certs, site] = await Promise.all([
      loadPeople(),
      db.select({ id: t.certifications.id, standard: t.certifications.standard }).from(t.certifications)
        .where(inArray(t.certifications.id, [before.certificationId, certificationId].filter((c): c is string => !!c))),
      siteNames(),
    ]);
    const shown = (p: PlanFields) => ({
      ...p, month: monthName(p.month), plannedOn: shownDate(p.plannedOn), doneOn: shownDate(p.doneOn), done: p.done ? 'Réalisé' : 'À réaliser',
      owner: p.ownerId ? people.get(p.ownerId)?.name ?? p.ownerId : null,
      auditorName: p.auditorId ? people.get(p.auditorId)?.name ?? p.auditorId : null,
      certification: p.certificationId ? certs.find((c) => c.id === p.certificationId)?.standard ?? p.certificationId : null,
      site: site(p.siteId),
    });
    let saved = false;
    const stale = await freshWrite(async () => { saved = await db.transaction(async (tx) => {
      await assertFresh(tx, 'audit_plan_item', before.id, fd.get(VERSION_FIELD));
      const rows = await tx.update(t.auditPlanItems).set(values)
        .where(and(eq(t.auditPlanItems.id, before.id), isNull(t.auditPlanItems.cancelledAt), isNull(t.auditPlanItems.reviewId)))
        .returning({ id: t.auditPlanItems.id });
      if (!rows.length) return false;
      // Les constats rattachés reprennent le libellé de l'audit (intitulé, mois, année) et son site (AUD-22).
      const moved = await tx.update(t.auditFindings).set({ audit: planItemAuditLabel(values), siteId })
        .where(eq(t.auditFindings.planItemId, before.id)).returning({ id: t.auditFindings.id });
      if (before.siteId !== siteId) {
        for (const m of moved) {
          await logChange(tx, { entityType: 'audit_finding', entityId: m.id, action: 'update', byId, summary: `Site repris de l'audit : ${site(siteId)}`, details: [{ field: 'Site', from: site(before.siteId), to: site(siteId) }] });
        }
      }
      const details = diffFields(shown(before), shown(values), PLAN_FIELDS);
      if (details.length) {
        const summary = done && !before.done ? `Réalisé le ${fmtDate(doneOn!)}` : !done && before.done ? 'Réalisation annulée' : 'Élément modifié';
        await logChange(tx, { entityType: 'audit_plan_item', entityId: before.id, action: 'update', summary, details, byId });
      }
      return true;
    }); });
    if (stale) return { error: stale };
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
  if (!id) {
    await logChange(db, {
      entityType: 'audit_plan_item', entityId: itemId!, action: 'create', byId,
      summary: unplanned ? `Audit hors programme enregistré (${track}, réalisé le ${fmtDate(doneOn!)})` : `Ajouté au programme ${year} (${track}, ${monthName(month!)})`,
    });
  }
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
  const db = await getDb();
  const [item] = await db.select({ siteId: t.auditPlanItems.siteId }).from(t.auditPlanItems).where(eq(t.auditPlanItems.id, Number(row.entityId)));
  const siteError = await requireInSite(item?.siteId);
  if (siteError) return { error: siteError };
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
  const siteError = await requireInSite(before.siteId);
  if (siteError) return { error: siteError };
  if (before.year === year && before.month === month && before.plannedOn === plannedOn) {
    return { error: 'Choisissez une autre date ou un autre mois.', fieldErrors: { month: 'Planification inchangée.' } };
  }
  // AUD-21 : plusieurs éléments par ligne et par mois — un mois déjà occupé ne bloque plus le report.

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
  // AUD-20 : un audit hors programme (toujours réalisé) saisi par erreur s'annule tant qu'il ne porte ni rapport ni constat.
  if (item.done && !item.unplanned) return { error: 'Élément réalisé : il reste au programme.' };
  const siteError = await requireInSite(item.siteId);
  if (siteError) return { error: siteError };
  if (item.reviewId != null) return { error: "Échéance d'une revue de direction : annulez la revue depuis sa carte." };
  // L'élément d'audit d'une action n'est jamais détaché (D15) : seul l'abandon de l'action le libère.
  if (item.actionId) return { error: `Échéance portée par l'action ${item.actionId} : abandonnez-la d'abord dans le plan d'actions.` };
  if (finding || files.length) return { error: "Des constats ou un rapport sont rattachés à cet audit : l'audit a eu lieu, déclarez-le réalisé." };

  const byId = session.user.id;
  const cancelled = await db.transaction(async (tx) => {
    const rows = await tx.update(t.auditPlanItems).set({ cancelledAt: new Date(), cancelledById: byId, cancelReason: reason })
      .where(and(eq(t.auditPlanItems.id, item.id), isNull(t.auditPlanItems.cancelledAt), eq(t.auditPlanItems.done, item.done), isNull(t.auditPlanItems.reviewId), isNull(t.auditPlanItems.actionId)))
      .returning({ id: t.auditPlanItems.id });
    if (!rows.length) return false;
    await logChange(tx, {
      entityType: 'audit_plan_item', entityId: item.id, action: 'cancel', reason, byId,
      summary: item.unplanned ? `Audit hors programme annulé (${item.track}, ${monthName(item.month)} ${item.year})` : `Annulé · retiré du programme ${item.year} (${item.track}, ${monthName(item.month)})`,
    });
    return true;
  });
  if (!cancelled) return { error: 'Élément modifié entre-temps : rechargez la page.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(item.id) };
}

// ─── Lignes du programme et reconduction (AUD-24) ───────────────────────────

/** Ligne ou intitulé « revue(s) de direction » : ligne des échéances des revues (AUD-01), ni renommée ni masquée ici. */
const isReviewTrack = (track: string) => isReviewPlanItem({ track, label: '', detail: null });

/** Programme commun à l'entreprise (lignes, reconduction) : périmètre complet, « Tous les sites » sélectionné. */
const WHOLE_PROGRAM = "Sélectionnez « Tous les sites » : les lignes et la reconduction valent pour tout le programme.";
async function wholeProgramError(session: { site: { id: string } }): Promise<string | null> {
  const scopeError = await requireInSite(null, { create: true });
  if (scopeError) return scopeError;
  return session.site.id === ALL_SITES ? null : WHOLE_PROGRAM;
}
const trackEntity = (year: number, track: string) => `${year}|${track}`;

/**
 * Renomme une ligne du programme d'une année (AUD-24) : tous les éléments de l'année sur cette ligne (annulés compris)
 * prennent le nouveau nom, journalisé sur chacun. Refusé pour la ligne des revues de direction, vers une ligne existante
 * de l'année (pas de fusion implicite), pour une ligne sans élément cette année (ligne reprise : masquez-la ou ajoutez un
 * élément), ou si un élément relève d'un site hors du site sélectionné ou du périmètre (requireInSite).
 */
export async function renameTrack(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const year = f.int('year', { required: true, min: 2000, max: 2100 });
  const from = f.str('from', { required: true, max: 40 });
  const to = f.str('to', { required: true, max: 40 });
  if (from && to && from === to) f.fail('to', 'Saisissez un autre nom.');
  if (to && isReviewTrack(to)) f.fail('to', 'Nom réservé aux revues de direction (ligne « Revues de direction »).');
  if (!f.ok) return f.state();
  if (isReviewTrack(from)) return { error: 'La ligne des revues de direction ne se renomme pas.' };
  const db = await getDb();
  const rows = await db.select({ id: t.auditPlanItems.id, track: t.auditPlanItems.track, siteId: t.auditPlanItems.siteId }).from(t.auditPlanItems).where(eq(t.auditPlanItems.year, year!));
  const items = rows.filter((r) => r.track === from);
  if (!items.length) return { error: `Aucun élément sur la ligne « ${from} » en ${year} : masquez-la ou ajoutez-y un élément.` };
  if (rows.some((r) => r.track === to)) return { error: 'Certains champs sont à corriger.', fieldErrors: { to: `La ligne « ${to} » existe déjà en ${year}.` } };
  for (const siteId of new Set(items.map((i) => i.siteId))) {
    const siteError = await requireInSite(siteId);
    if (siteError) return { error: siteError };
  }
  const byId = session.user.id;
  await db.transaction(async (tx) => {
    for (const item of items) {
      await tx.update(t.auditPlanItems).set({ track: to }).where(eq(t.auditPlanItems.id, item.id));
      await logChange(tx, { entityType: 'audit_plan_item', entityId: item.id, action: 'update', byId, summary: `Ligne renommée « ${to} »`, details: [{ field: 'Ligne', from, to }] });
    }
  });
  revalidatePath('/', 'layout');
  return { ok: true, message: `Ligne renommée « ${to} » (${items.length} élément${items.length > 1 ? 's' : ''}).` };
}

/**
 * Masque une ligne reprise de l'année précédente (AUD-24), motif obligatoire : elle ne porte aucun élément en vigueur cette
 * année (tous sites). Réservé au périmètre complet sous « Tous les sites » (le programme est commun). Journal
 * `audit_plan_track`.
 */
export async function hideTrack(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const year = f.int('year', { required: true, min: 2000, max: 2100 });
  const track = f.str('track', { required: true, max: 40 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const scopeError = await wholeProgramError(session);
  if (scopeError) return { error: scopeError };
  const db = await getDb();
  const [[live], [earlier]] = await Promise.all([
    db.select({ id: t.auditPlanItems.id }).from(t.auditPlanItems)
      .where(and(eq(t.auditPlanItems.year, year!), eq(t.auditPlanItems.track, track), isNull(t.auditPlanItems.cancelledAt))).limit(1),
    db.select({ id: t.auditPlanItems.id }).from(t.auditPlanItems).where(and(eq(t.auditPlanItems.track, track), lt(t.auditPlanItems.year, year!))).limit(1),
  ]);
  if (live) return { error: `La ligne « ${track} » porte des éléments en ${year} : annulez-les ou déplacez-les avant de la masquer.` };
  if (!earlier) return { error: 'Ligne introuvable.' };
  const byId = session.user.id;
  const hidden = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(t.auditPlanTracks).where(and(eq(t.auditPlanTracks.year, year!), eq(t.auditPlanTracks.track, track)));
    if (row?.hiddenAt) return false;
    const values = { hiddenAt: new Date(), hiddenById: byId, hideReason: reason };
    if (row) await tx.update(t.auditPlanTracks).set(values).where(eq(t.auditPlanTracks.id, row.id));
    else await tx.insert(t.auditPlanTracks).values({ year: year!, track, ...values });
    await logChange(tx, { entityType: 'audit_plan_track', entityId: trackEntity(year!, track), action: 'archive', reason, byId, summary: `Ligne « ${track} » masquée du programme ${year}` });
    return true;
  });
  if (!hidden) return { error: 'Ligne déjà masquée.' };
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Affiche à nouveau une ligne masquée (AUD-24), motif obligatoire ; le masquage reste au journal. */
export async function showTrack(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const year = f.int('year', { required: true, min: 2000, max: 2100 });
  const track = f.str('track', { required: true, max: 40 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const scopeError = await wholeProgramError(session);
  if (scopeError) return { error: scopeError };
  const db = await getDb();
  const byId = session.user.id;
  const shown = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(t.auditPlanTracks).where(and(eq(t.auditPlanTracks.year, year!), eq(t.auditPlanTracks.track, track)));
    if (!row?.hiddenAt) return false;
    await tx.update(t.auditPlanTracks).set({ hiddenAt: null, hiddenById: null, hideReason: null }).where(eq(t.auditPlanTracks.id, row.id));
    await logChange(tx, {
      entityType: 'audit_plan_track', entityId: trackEntity(year!, track), action: 'restore', reason, byId,
      summary: `Ligne « ${track} » affichée à nouveau au programme ${year}`, details: [{ field: 'Motif du masquage', from: row.hideReason, to: null }],
    });
    return true;
  });
  if (!shown) return { error: "Cette ligne n'est pas masquée." };
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Reconduit le programme de l'année précédente sur l'année `year` (AUD-24) : chaque élément en vigueur de N-1 (hors
 * revues de direction, planifiées depuis leur carte, et audits hors programme) est recopié à la même ligne et au même mois,
 * à réaliser, date prévue décalée d'un an, avec son intitulé, son périmètre, son référentiel, son site et ses responsable et
 * auditeur encore présents. Un élément déjà présent (même ligne, mois et intitulé) n'est pas recopié ; un élément d'un
 * site archivé non plus. Périmètre complet sous « Tous les sites ». Journal de chaque élément créé.
 */
export async function renewProgram(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const year = f.int('year', { required: true, min: 2001, max: 2100 });
  if (!f.ok) return f.state();
  const scopeError = await wholeProgramError(session);
  if (scopeError) return { error: scopeError };
  const db = await getDb();
  const now = today();
  const [rows, people, sites] = await Promise.all([
    db.select().from(t.auditPlanItems).where(inArray(t.auditPlanItems.year, [year! - 1, year!])),
    db.select({ id: t.people.id, leftOn: t.people.leftOn }).from(t.people),
    db.select({ id: t.sites.id, archivedAt: t.sites.archivedAt }).from(t.sites),
  ]);
  const present = (id: string | null) => (id && people.some((p) => p.id === id && !hasLeft(p, now)) ? id : null);
  const archivedSite = (id: string | null) => !!id && sites.some((x) => x.id === id && x.archivedAt);
  const same = (a: typeof rows[number], b: typeof rows[number]) => a.track === b.track && a.month === b.month && (a.detail ?? a.label) === (b.detail ?? b.label);
  const target = rows.filter((r) => r.year === year && !r.cancelledAt);
  const source = rows.filter((r) => r.year === year! - 1 && !r.cancelledAt && !r.unplanned && r.reviewId == null && !isReviewPlanItem(r));
  if (!source.length) return { error: `Aucun élément à reconduire du programme ${year! - 1}.` };
  const skippedSites = source.filter((r) => archivedSite(r.siteId)).length;
  const copies = source.filter((r) => !archivedSite(r.siteId) && !target.some((x) => same(x, r)));
  if (!copies.length) return { error: `Le programme ${year} reprend déjà les éléments de ${year! - 1}.` };
  const byId = session.user.id;
  await db.transaction(async (tx) => {
    for (const r of copies) {
      const plannedOn = r.plannedOn ? addMonths(r.plannedOn, 12) : null;
      const [row] = await tx.insert(t.auditPlanItems).values({
        year: year!, track: r.track, month: r.month, label: relabelDay(r.label, r.plannedOn, plannedOn), plannedOn, detail: r.detail,
        ownerId: present(r.ownerId), auditor: r.auditor, auditorId: present(r.auditorId), scope: r.scope, certificationId: r.certificationId, siteId: r.siteId,
      }).returning({ id: t.auditPlanItems.id });
      await logChange(tx, { entityType: 'audit_plan_item', entityId: row.id, action: 'create', byId, summary: `Reconduit du programme ${year! - 1} (${r.track}, ${monthName(r.month)})` });
    }
  });
  revalidatePath('/', 'layout');
  const n = copies.length;
  return { ok: true, message: `${n} élément${n > 1 ? 's' : ''} reconduit${n > 1 ? 's' : ''} au programme ${year}${skippedSites ? ` (${skippedSites} d'un site archivé non repris)` : ''}.` };
}

/**
 * Enregistre un audit à libellé libre (constats antérieurs à AUD-20) comme un vrai audit hors programme : élément réalisé
 * (ligne, date de réalisation, auditeur, périmètre, site), auquel tous les constats de ce libellé sans audit sont rattachés.
 * Constats du site sélectionné et du périmètre seulement ; journal de l'audit et de chaque constat.
 */
export async function convertFreeAudit(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const audit = f.str('audit', { required: true, max: 120 });
  const trackChoice = f.str('track', { required: true });
  const track = trackChoice === NEW_TRACK ? f.str('newTrack', { required: true, max: 40 }) : trackChoice;
  const label = f.str('label', { required: true, max: 30 });
  const doneOn = f.date('doneOn', { required: true });
  const auditor = f.str('auditor', { max: 120 }) || null;
  const auditorId = f.opt('auditorId');
  const scope = f.str('scope', { max: 200 }) || null;
  const siteId = siteField(f);
  if (doneOn && doneOn > today()) f.fail('doneOn', 'Date de réalisation future.');
  if (track && isReviewTrack(track)) f.fail('track', 'Choisissez une ligne d’audit.');
  if (!f.ok) return f.state();
  const db = await getDb();
  const findings = (await db.select({ id: t.auditFindings.id, siteId: t.auditFindings.siteId }).from(t.auditFindings)
    .where(and(eq(t.auditFindings.audit, audit), isNull(t.auditFindings.planItemId))));
  if (!findings.length) return { error: 'Aucun constat sans audit sous ce libellé.' };
  for (const sid of new Set(findings.map((x) => x.siteId))) {
    const siteError = await requireInSite(sid);
    if (siteError) return { error: siteError };
  }
  const siteError = await requireInSite(siteId, { create: true });
  if (siteError) return { error: siteError, fieldErrors: { siteId: siteError } };
  if (auditorId) {
    const [p] = await db.select({ id: t.people.id, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, auditorId));
    if (!p) return { error: 'Auditeur introuvable.', fieldErrors: { auditorId: 'Choisissez une personne de la liste.' } };
    if (hasLeft(p, today())) return { error: 'Certains champs sont à corriger.', fieldErrors: { auditorId: LEFT_AUDITOR } };
  }
  const byId = session.user.id;
  const site = await siteNames();
  const id = await db.transaction(async (tx) => {
    const values = { year: yearOf(doneOn!), month: monthOf(doneOn!), track, label, plannedOn: doneOn, detail: audit, done: true, doneOn, auditor, auditorId, scope, siteId, unplanned: true };
    const [row] = await tx.insert(t.auditPlanItems).values(values).returning({ id: t.auditPlanItems.id });
    await logChange(tx, { entityType: 'audit_plan_item', entityId: row.id, action: 'create', byId, summary: `Audit hors programme enregistré (${track}, réalisé le ${fmtDate(doneOn!)}) · ${findings.length} constat${findings.length > 1 ? 's' : ''} repris` });
    const newLabel = planItemAuditLabel(values);
    for (const x of findings) {
      await tx.update(t.auditFindings).set({ planItemId: row.id, audit: newLabel, siteId }).where(eq(t.auditFindings.id, x.id));
      await logChange(tx, {
        entityType: 'audit_finding', entityId: x.id, action: 'update', byId, summary: `Rattaché à l'audit hors programme « ${newLabel} »`,
        details: [{ field: 'Audit', from: audit, to: newLabel }, ...(x.siteId !== siteId ? [{ field: 'Site', from: site(x.siteId), to: site(siteId) }] : [])],
      });
    }
    return row.id;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(id) };
}

// ─── Constats d'audit ───────────────────────────────────────────────────────

const FINDING_FIELDS = { audit: 'Audit', kind: 'Type', clause: 'Exigence', foundOn: 'Date du constat', text: 'Constat', responseDueOn: 'Réponse attendue le' } as const;
/** AUD-20 : plus de nouveau constat à libellé d'audit libre. */
const FREE_AUDIT_REFUSED = "Rattachez le constat à un audit : un audit hors programme s'enregistre d'abord (« Audit hors programme »), avec sa date et son auditeur.";
type FindingFields = { audit: string; kind: string; clause: string | null; foundOn: string | null; text: string; responseDueOn: string | null };
const findingShown = (x: FindingFields) => ({ ...x, kind: FINDING_KINDS[x.kind]?.label ?? x.kind, foundOn: shownDate(x.foundOn), responseDueOn: shownDate(x.responseDueOn) });

export async function saveFinding(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id');
  const planChoice = f.str('planItemId');
  const planItemId = planChoice && planChoice !== OTHER_AUDIT ? f.int('planItemId', { min: 1 }) : null;
  // Constat à libellé d'audit libre : constats antérieurs à AUD-20 seulement (rétrocompatibilité). Un nouveau constat hors
  // programme se rattache à un audit hors programme enregistré (date, auditeur, rapport : « Audit hors programme »).
  const freeAudit = planItemId ? '' : f.str('audit', { required: true, max: 120 });
  const kind = f.oneOf('kind', FINDING_KEYS, { required: true });
  const text = f.str('text', { required: true, max: 400 });
  const clause = f.str('clause', { max: 40 }) || null;
  const foundOnInput = f.date('foundOn');
  // AUD-09 : délai de réponse d'un écart (plan d'actions attendu par l'organisme ou l'auditeur).
  const responseDueOn = kind && FINDING_GAP_KINDS.includes(kind) ? f.date('responseDueOn') : null;
  if (foundOnInput && foundOnInput > today()) f.fail('foundOn', 'Date du constat future.');
  if (responseDueOn && foundOnInput && responseDueOn < foundOnInput) f.fail('responseDueOn', 'La réponse ne peut pas être attendue avant le constat.');
  if (!f.ok) return f.state();

  const db = await getDb();
  const byId = session.user.id;
  const [before] = id ? await db.select().from(t.auditFindings).where(eq(t.auditFindings.id, id)) : [];
  if (id && !before) return { error: 'Constat introuvable.' };
  if (before?.cancelledAt) return { error: 'Constat annulé : il ne peut plus être modifié.' };
  if (before) {
    const siteError = await requireInSite(before.siteId);
    if (siteError) return { error: siteError };
  }
  if (!planItemId && !(before && before.planItemId == null)) {
    return { error: 'Certains champs sont à corriger.', fieldErrors: { planItemId: FREE_AUDIT_REFUSED } };
  }
  let audit = freeAudit;
  let foundOn = foundOnInput;
  // AUD-22 : site du constat = celui de son audit ; constat à libellé libre : site inchangé.
  let siteId = before?.siteId ?? null;
  if (planItemId) {
    const [item] = await db.select().from(t.auditPlanItems).where(eq(t.auditPlanItems.id, planItemId));
    if (!item || isReviewPlanItem(item)) return { error: 'Audit introuvable.', fieldErrors: { planItemId: 'Choisissez un audit du programme.' } };
    const siteError = await requireInSite(item.siteId);
    if (siteError) return { error: siteError, fieldErrors: { planItemId: siteError } };
    siteId = item.siteId;
    // AUD-11 : un constat se rattache à un audit réalisé (en vigueur) ; un constat déjà rattaché garde son audit.
    const kept = before?.planItemId === item.id;
    if (!kept && (item.cancelledAt || !item.done)) {
      return {
        error: item.cancelledAt ? 'Audit annulé : choisissez un autre audit.' : "Cet audit n'est pas réalisé : déclarez-le réalisé dans le programme avant d'en saisir les constats.",
        fieldErrors: { planItemId: 'Choisissez un audit réalisé.' },
      };
    }
    audit = planItemAuditLabel(item);
    foundOn ??= item.doneOn ?? item.plannedOn;
  }
  if (responseDueOn && foundOn && responseDueOn < foundOn) return { error: 'Certains champs sont à corriger.', fieldErrors: { responseDueOn: 'La réponse ne peut pas être attendue avant le constat.' } };
  const values = { audit, planItemId, clause, foundOn, kind: kind!, text, responseDueOn, siteId };
  if (before) {
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      await assertFresh(tx, 'audit_finding', before.id, fd.get(VERSION_FIELD));
      await tx.update(t.auditFindings).set(values).where(eq(t.auditFindings.id, before.id));
      const details = diffFields(findingShown(before), findingShown(values), FINDING_FIELDS);
      if (details.length) await logChange(tx, { entityType: 'audit_finding', entityId: before.id, action: 'update', summary: 'Constat modifié', details, byId });
    }));
    if (stale) return { error: stale };
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
 * et du dossier de revue, et reste consultable avec le filtre « Annulés ». Ses actions restent au plan d'actions.
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
  const [current] = await db.select({ siteId: t.auditFindings.siteId }).from(t.auditFindings).where(eq(t.auditFindings.id, id!));
  const siteError = current ? await requireInSite(current.siteId) : null;
  if (siteError) return { error: siteError };
  const done = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.auditFindings).set({ cancelledAt: new Date(), cancelledById: byId, cancelReason: reason })
      .where(and(eq(t.auditFindings.id, id!), isNull(t.auditFindings.cancelledAt))).returning({ audit: t.auditFindings.audit });
    if (!row) return false;
    // Actions du constat (AUD-28 : plusieurs par constat) : elles restent au plan d'actions, l'annulation est inscrite à
    // l'historique de chacune (ACT-03).
    const actionIds = (await tx.select({ id: t.findingActions.actionId }).from(t.findingActions).where(eq(t.findingActions.findingId, id!)))
      .map((r) => r.id).sort((x, y) => x.localeCompare(y, 'fr', { numeric: true }));
    await logChange(tx, {
      entityType: 'audit_finding', entityId: id!, action: 'cancel', reason, byId,
      summary: actionIds.length > 1 ? `Constat annulé (les actions ${actionIds.join(', ')} restent au plan d'actions)`
        : actionIds.length ? `Constat annulé (l'action ${actionIds[0]} reste au plan d'actions)` : 'Constat annulé',
    });
    for (const actionId of actionIds) await logChange(tx, { entityType: 'action', entityId: actionId, action: 'update', summary: `Constat d'origine annulé (${row.audit})`, reason, byId });
    return true;
  });
  if (!done) return { error: 'Constat introuvable ou déjà annulé.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(id) };
}

/**
 * Rétablit un constat annulé à tort (AUD-25), motif obligatoire : il revient dans les constats, les échéances et le dossier
 * des revues à venir (un dossier déjà figé ne change pas). Refusé si son audit du programme a été annulé depuis. Journal du
 * constat et de chacune de ses actions, dans la transaction.
 */
export async function restoreFinding(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAuditEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [row] = await db.select({ finding: t.auditFindings, item: { cancelledAt: t.auditPlanItems.cancelledAt } }).from(t.auditFindings)
    .leftJoin(t.auditPlanItems, eq(t.auditPlanItems.id, t.auditFindings.planItemId)).where(eq(t.auditFindings.id, id!));
  if (!row) return { error: 'Constat introuvable.' };
  if (!row.finding.cancelledAt) return { error: "Ce constat n'est pas annulé." };
  const siteError = await requireInSite(row.finding.siteId);
  if (siteError) return { error: siteError };
  if (row.item?.cancelledAt) return { error: 'Audit annulé au programme : le constat ne peut pas être rétabli.' };
  const byId = session.user.id;
  const restored = await db.transaction(async (tx) => {
    const [r] = await tx.update(t.auditFindings).set({ cancelledAt: null, cancelledById: null, cancelReason: null })
      .where(and(eq(t.auditFindings.id, id!), isNotNull(t.auditFindings.cancelledAt))).returning({ audit: t.auditFindings.audit });
    if (!r) return false;
    await logChange(tx, {
      entityType: 'audit_finding', entityId: id!, action: 'restore', reason, byId,
      summary: 'Constat rétabli', details: [{ field: "Motif de l'annulation", from: row.finding.cancelReason, to: null }],
    });
    const actionIds = (await tx.select({ id: t.findingActions.actionId }).from(t.findingActions).where(eq(t.findingActions.findingId, id!))).map((x) => x.id).sort();
    for (const actionId of actionIds) await logChange(tx, { entityType: 'action', entityId: actionId, action: 'update', summary: `Constat d'origine rétabli (${r.audit})`, reason, byId });
    return true;
  });
  if (!restored) return { error: "Ce constat n'est pas annulé." };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(id) };
}
