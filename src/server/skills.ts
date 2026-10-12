'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, asc, eq, gte, isNotNull } from 'drizzle-orm';
import { coversNeed } from '@/components/skills/rules';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { MAX_BATCH_BYTES, MAX_FILES_PER_BATCH } from '@/lib/attachments';
import { addDays, addMonths, fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { canEdit, isOpenActionStatus } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireInSite, requireManager } from '@/lib/guard';
import { checkUpload, deleteAttachment, saveUpload } from '@/lib/uploads';
import { logChange } from './changelog';

// Habilitations et formations : formations suivies, exigences par salarié, personnel et titres suivis.

const clean = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Identifiant libre dérivé de `base` (suffixe numérique en cas de doublon). */
function uniqueId(base: string, existing: Set<string>, sep = '') {
  let id = base;
  for (let n = 2; existing.has(id); n++) id = `${base}${sep}${n}`;
  return id;
}

const titleSlug = (label: string) => clean(label).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'titre';

const done = () => revalidatePath('/', 'layout');

/**
 * Saisie réservée aux rôles qui ont accès à l'écran « Habilitations et formations » (hors salariés et lecture seule) :
 * le chef de projet saisit ailleurs mais n'a pas cet écran, il ne modifie rien ici.
 */
async function requireSkillsEditor() {
  const { session, error } = await requireManager();
  if (error) return { session, error };
  return canEdit(session.role, 'skills') ? { session, error: null } : { session, error: 'Votre rôle ne permet pas cette modification.' };
}

/** Salarié sorti de l'effectif à la date du jour (archivé : plus de saisie sur sa fiche ni ses formations). */
const hasLeft = (p: { leftOn: string | null }) => !!p.leftOn && p.leftOn <= today();

/** Contrôle d'un envoi d'attestations (nombre, volume, format) ; message d'erreur ou null. */
function checkFiles(files: File[]) {
  if (files.length > MAX_FILES_PER_BATCH) return `${MAX_FILES_PER_BATCH} fichiers au maximum par envoi.`;
  if (files.reduce((s, x) => s + x.size, 0) > MAX_BATCH_BYTES) return `L'envoi dépasse ${MAX_BATCH_BYTES / 1024 / 1024} Mo : ajoutez les fichiers en plusieurs fois.`;
  return files.map(checkUpload).find(Boolean) ?? null;
}

/** Actions de recyclage encore ouvertes rattachées aux exigences d'un titre ou d'un salarié. */
async function openRenewals(db: DbOrTx, by: { titleId: string } | { personId: string }) {
  const rows = await db.select({ id: t.actions.id, status: t.actions.status }).from(t.qualificationRequirements)
    .innerJoin(t.actions, eq(t.qualificationRequirements.renewalActionId, t.actions.id))
    .where(and(
      isNotNull(t.qualificationRequirements.renewalActionId),
      'titleId' in by ? eq(t.qualificationRequirements.titleId, by.titleId) : eq(t.qualificationRequirements.personId, by.personId),
    ));
  return rows.filter((a) => isOpenActionStatus(a.status)).map((a) => a.id).sort();
}

/** Formation, salarié et titre concernés, pour les contrôles communs (voir `frozenReason`). */
async function findQualification(db: DbOrTx, id: number) {
  const [row] = await db.select({ q: t.qualifications, person: { siteId: t.people.siteId, leftOn: t.people.leftOn }, title: { archivedAt: t.trainingTitles.archivedAt } })
    .from(t.qualifications)
    .innerJoin(t.people, eq(t.qualifications.personId, t.people.id))
    .innerJoin(t.trainingTitles, eq(t.qualifications.titleId, t.trainingTitles.id))
    .where(eq(t.qualifications.id, id));
  return row;
}

/**
 * Formation figée (historique en consultation seule) : salarié sorti ou titre archivé ; ou hors du site sélectionné.
 * Message d'erreur, ou null si la formation (et ses attestations) peut être modifiée.
 */
async function frozenReason(row: NonNullable<Awaited<ReturnType<typeof findQualification>>>) {
  if (hasLeft(row.person)) return "Salarié sorti de l'effectif : ses formations sont conservées en consultation seule.";
  if (row.title.archivedAt) return 'Titre archivé : restaurez-le pour modifier ses formations.';
  return requireInSite(row.person.siteId);
}

/**
 * Enregistre une formation : nouvelle ligne de l'historique (jamais écrasée), ou correction de la formation
 * `qualificationId` (saisie erronée, même salarié et même titre, formation non annulée).
 * Le titre devient requis pour le salarié s'il ne l'était pas ; l'échéance vaut obtention + validité du titre si elle est laissée vide.
 * `closeRenewal` fait passer l'action de recyclage rattachée à « Efficacité à vérifier », seulement si la formation
 * règle le besoin (titre valide au-delà de 60 jours et couvrant les affectations Keystone à venir) : sinon l'action reste à réaliser.
 * Attestations facultatives (`files`), jointes à la formation (pièces jointes 'qualification').
 */
export async function saveQualification(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireSkillsEditor();
  if (error) return { error };
  const f = formReader(fd);
  const qualificationId = f.int('qualificationId', { min: 1 });
  const personId = f.str('personId', { required: true });
  const titleId = f.str('titleId', { required: true });
  const obtainedOn = f.date('obtainedOn', { required: true });
  let expiresOn = f.date('expiresOn');
  const provider = f.str('provider', { max: 120 }) || null;
  const closeRenewal = f.bool('closeRenewal');
  const files = f.files('files');
  const now = today();
  if (obtainedOn && obtainedOn > now) f.fail('obtainedOn', "La date d'obtention ne peut pas être postérieure à aujourd'hui.");
  if (obtainedOn && expiresOn && expiresOn <= obtainedOn) f.fail('expiresOn', "L'échéance doit suivre la date d'obtention.");
  const invalidFiles = checkFiles(files);
  if (invalidFiles) f.fail('files', invalidFiles);
  if (!f.ok) return f.state();

  const db = await getDb();
  const [[person], [title], upcoming] = await Promise.all([
    db.select({ id: t.people.id, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, personId)),
    db.select().from(t.trainingTitles).where(eq(t.trainingTitles.id, titleId)),
    db.select({ startOn: t.keystoneAssignments.startOn, endOn: t.keystoneAssignments.endOn }).from(t.keystoneAssignments)
      .where(and(eq(t.keystoneAssignments.personId, personId), gte(t.keystoneAssignments.endOn, now)))
      .orderBy(asc(t.keystoneAssignments.startOn)),
  ]);
  if (!person) return { error: 'Salarié introuvable.', fieldErrors: { personId: 'Salarié introuvable.' } };
  if (!title) return { error: 'Titre introuvable.', fieldErrors: { titleId: 'Titre introuvable.' } };
  if (title.archivedAt) return { error: 'Titre archivé.', fieldErrors: { titleId: 'Titre archivé.' } };
  if (hasLeft(person)) return { error: "Salarié sorti de l'effectif.", fieldErrors: { personId: "Salarié sorti de l'effectif." } };
  const blocked = await requireInSite(person.siteId);
  if (blocked) return { error: blocked };
  if (!expiresOn && title.validityMonths > 0) expiresOn = addMonths(obtainedOn!, title.validityMonths);

  const values = { obtainedOn: obtainedOn!, expiresOn, provider };
  const summary = `Formation du ${fmtDate(values.obtainedOn)}${expiresOn ? ` (échéance ${fmtDate(expiresOn)})` : ''}`;
  const result = await db.transaction(async (tx): Promise<{ error: string } | { id: number }> => {
    let id: number;
    if (qualificationId) {
      // Correction d'une saisie : la ligne doit appartenir à la case et ne pas être annulée.
      const [prev] = await tx.select().from(t.qualifications).where(eq(t.qualifications.id, qualificationId));
      if (!prev || prev.personId !== personId || prev.titleId !== titleId) return { error: 'Formation introuvable.' };
      if (prev.cancelledAt) return { error: 'Formation annulée : elle ne peut plus être corrigée.' };
      await tx.update(t.qualifications).set(values).where(eq(t.qualifications.id, qualificationId));
      id = qualificationId;
      await logChange(tx, { entityType: 'qualification', entityId: id, action: 'update', summary: `${summary} corrigée` });
    } else {
      const [row] = await tx.insert(t.qualifications).values({ personId, titleId, ...values, recordedById: session.user.id }).returning({ id: t.qualifications.id });
      id = row.id;
      await logChange(tx, { entityType: 'qualification', entityId: id, action: 'create', summary: `${summary} enregistrée` });
    }
    await tx.insert(t.qualificationRequirements).values({ personId, titleId }).onConflictDoNothing();
    // Formation ancienne ou trop courte : le recyclage reste à réaliser (case masquée côté formulaire).
    if (!closeRenewal || !coversNeed(expiresOn, upcoming, now)) return { id };
    const [req] = await tx.select({ actionId: t.qualificationRequirements.renewalActionId }).from(t.qualificationRequirements)
      .where(and(eq(t.qualificationRequirements.personId, personId), eq(t.qualificationRequirements.titleId, titleId)));
    if (!req?.actionId) return { id };
    const [action] = await tx.select().from(t.actions).where(eq(t.actions.id, req.actionId));
    // Action à lancer ou en cours seulement (une action clôturée ou annulée n'est pas rouverte).
    if (action && (action.status === 'todo' || action.status === 'doing')) {
      await tx.update(t.actions).set({ status: 'verify', verifyDueOn: action.verifyDueOn ?? addDays(now, 30), closedOn: null }).where(eq(t.actions.id, action.id));
    }
    return { id };
  });
  if ('error' in result) return { error: result.error };
  for (const file of files) await saveUpload(file, 'qualification', String(result.id), session.user.id);
  done();
  return { ok: true, id: String(result.id) };
}

/**
 * Annule une formation enregistrée par erreur (jamais supprimée), en cours ou plus ancienne : motif obligatoire ; elle sort
 * du calcul de l'état. Refusée pour un salarié sorti ou un titre archivé (historique figé).
 */
export async function cancelQualification(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireSkillsEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const row = await findQualification(db, id!);
  if (!row) return { error: 'Formation introuvable.' };
  if (row.q.cancelledAt) return { error: 'Cette formation est déjà annulée.' };
  const blocked = await frozenReason(row);
  if (blocked) return { error: blocked };
  // Une action de recyclage passée en « Efficacité à vérifier » par cette formation reste en l'état (domaine actions).
  await db.transaction(async (tx) => {
    await tx.update(t.qualifications).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.qualifications.id, id!));
    await logChange(tx, { entityType: 'qualification', entityId: id!, action: 'cancel', summary: `Formation du ${fmtDate(row.q.obtainedOn)} annulée`, reason });
  });
  done();
  return { ok: true };
}

/** Ajoute des attestations à une formation (non annulée, salarié présent, titre actif). */
export async function addQualificationFiles(fd: FormData): Promise<{ error?: string; count?: number }> {
  const { session, error } = await requireSkillsEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('qualificationId', { required: true, min: 1 });
  const files = f.files('files');
  if (!f.ok || !id) return { error: 'Formation introuvable.' };
  if (!files.length) return { error: 'Choisissez au moins un fichier.' };
  const invalid = checkFiles(files);
  if (invalid) return { error: invalid };
  const db = await getDb();
  const row = await findQualification(db, id);
  if (!row) return { error: 'Formation introuvable.' };
  if (row.q.cancelledAt) return { error: 'Formation annulée : ajout impossible.' };
  const blocked = await frozenReason(row);
  if (blocked) return { error: blocked };
  for (const file of files) await saveUpload(file, 'qualification', String(id), session.user.id);
  done();
  return { count: files.length };
}

/** Retire une attestation ajoutée par erreur (seule suppression admise), tant que la formation n'est ni annulée ni figée. */
export async function removeQualificationFile(attachmentId: string): Promise<{ error?: string }> {
  const { error } = await requireSkillsEditor();
  if (error) return { error };
  const db = await getDb();
  const [file] = await db.select({ entityType: t.attachments.entityType, entityId: t.attachments.entityId }).from(t.attachments).where(eq(t.attachments.id, attachmentId));
  if (!file || file.entityType !== 'qualification') return { error: 'Pièce jointe introuvable.' };
  const row = await findQualification(db, Number(file.entityId));
  if (!row) return { error: 'Formation introuvable.' };
  if (row.q.cancelledAt) return { error: 'Formation annulée : ses attestations sont conservées.' };
  const blocked = await frozenReason(row);
  if (blocked) return { error: blocked };
  await deleteAttachment(attachmentId);
  done();
  return {};
}

/**
 * Rend un titre requis (ou non) pour un salarié. Les formations déjà enregistrées sont conservées.
 * Retirer l'exigence est refusé tant que l'action de recyclage rattachée est ouverte (le lien serait perdu).
 */
export async function setRequirement(personId: string, titleId: string, required: boolean): Promise<{ error?: string }> {
  const { error } = await requireSkillsEditor();
  if (error) return { error };
  const db = await getDb();
  const [[person], [title]] = await Promise.all([
    db.select({ id: t.people.id, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, personId)),
    db.select({ id: t.trainingTitles.id, archivedAt: t.trainingTitles.archivedAt }).from(t.trainingTitles).where(eq(t.trainingTitles.id, titleId)),
  ]);
  if (!person || !title) return { error: 'Salarié ou titre introuvable.' };
  if (title.archivedAt) return { error: 'Titre archivé : restaurez-le pour modifier ses exigences.' };
  if (hasLeft(person)) return { error: "Salarié sorti de l'effectif." };
  const blocked = await requireInSite(person.siteId);
  if (blocked) return { error: blocked };
  const where = and(eq(t.qualificationRequirements.personId, personId), eq(t.qualificationRequirements.titleId, titleId));
  if (required) {
    await db.insert(t.qualificationRequirements).values({ personId, titleId }).onConflictDoNothing();
  } else {
    const [req] = await db.select({ actionId: t.qualificationRequirements.renewalActionId }).from(t.qualificationRequirements).where(where);
    const [action] = req?.actionId
      ? await db.select({ id: t.actions.id, status: t.actions.status }).from(t.actions).where(eq(t.actions.id, req.actionId))
      : [];
    if (action && isOpenActionStatus(action.status)) {
      return { error: `L'action ${action.id} (recyclage) est encore ouverte : clôturez-la avant de retirer l'exigence.` };
    }
    await db.delete(t.qualificationRequirements).where(where);
  }
  done();
  return {};
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Ajoute ou modifie un salarié (saisie provisoire, en attendant le connecteur Cursus). Fiche d'un salarié sorti : réintégrer d'abord.
 * Identifiant généré (jamais tiré du nom : deux homonymes sont deux fiches) ; doublons refusés sur l'e-mail (sans tenir compte
 * de la casse) et le matricule, clés de rapprochement avec Entra ID et Cursus.
 */
export async function savePerson(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireSkillsEditor();
  if (error) return { error };
  const db = await getDb();
  const [sites, people] = await Promise.all([
    db.select({ id: t.sites.id }).from(t.sites),
    db.select({
      id: t.people.id, sort: t.people.sort, siteId: t.people.siteId, leftOn: t.people.leftOn, email: t.people.email, matricule: t.people.matricule,
    }).from(t.people),
  ]);
  const f = formReader(fd);
  const id = f.opt('id');
  const name = f.str('name', { required: true, max: 80 });
  const job = f.str('job', { max: 80 });
  const service = f.str('service', { max: 60 });
  const siteId = f.oneOf('siteId', sites.map((s) => s.id), { required: true });
  const inSkillsMatrix = f.bool('inSkillsMatrix');
  const email = f.str('email', { max: 254 }).toLowerCase() || null;
  const matricule = f.str('matricule', { max: 40 }) || null;
  if (email && !EMAIL.test(email)) f.fail('email', 'Adresse e-mail invalide.');
  if (email && people.some((p) => p.id !== id && p.email?.toLowerCase() === email)) f.fail('email', 'Une autre fiche porte déjà cet e-mail.');
  if (matricule && people.some((p) => p.id !== id && p.matricule === matricule)) f.fail('matricule', 'Une autre fiche porte déjà ce matricule.');
  if (!f.ok) return f.state();

  // E-mail et matricule : champs absents du formulaire (saisie partielle) = inchangés.
  const values = {
    name, job, service, siteId, inSkillsMatrix,
    ...(fd.has('email') ? { email } : {}),
    ...(fd.has('matricule') ? { matricule } : {}),
  };
  if (id) {
    const prev = people.find((p) => p.id === id);
    if (!prev) return { error: 'Salarié introuvable.' };
    if (hasLeft(prev)) return { error: "Salarié sorti de l'effectif : réintégrez-le pour modifier sa fiche." };
    const blocked = (await requireInSite(prev.siteId)) ?? (siteId !== prev.siteId ? await requireInSite(siteId, { create: true }) : null);
    if (blocked) return { error: blocked };
    await db.transaction(async (tx) => {
      await tx.update(t.people).set(values).where(eq(t.people.id, id));
      await logChange(tx, { entityType: 'person', entityId: id, action: 'update', summary: 'Fiche salarié modifiée' });
    });
    done();
    return { ok: true, id };
  }
  const blocked = await requireInSite(siteId, { create: true });
  if (blocked) return { error: blocked };
  const newId = randomUUID();
  const sort = Math.max(-1, ...people.map((p) => p.sort)) + 1;
  await db.transaction(async (tx) => {
    await tx.insert(t.people).values({ id: newId, ...values, sort });
    await logChange(tx, { entityType: 'person', entityId: newId, action: 'create', summary: 'Salarié ajouté' });
  });
  done();
  return { ok: true, id: newId };
}

/**
 * Sortie de l'effectif (archivage, jamais de suppression) : date de sortie et motif. À partir de cette date, le salarié
 * quitte la matrice, les signaux et les listes ; ses formations restent consultables. Saisie provisoire (connecteur Cursus).
 * Refusée tant qu'un recyclage rattaché à ses exigences est ouvert.
 */
export async function setPersonLeft(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireSkillsEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const leftOn = f.date('leftOn', { required: true });
  const leftReason = f.str('leftReason', { required: true, max: 200 });
  if (leftOn && leftOn < addMonths(today(), -12)) f.fail('leftOn', "La date de sortie ne peut pas remonter à plus d'un an.");
  if (!f.ok) return f.state();
  const db = await getDb();
  const [person] = await db.select({ id: t.people.id, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, id));
  if (!person) return { error: 'Salarié introuvable.' };
  if (hasLeft(person)) return { error: "Salarié déjà sorti de l'effectif." };
  const blocked = await requireInSite(person.siteId);
  if (blocked) return { error: blocked };
  const open = await openRenewals(db, { personId: id });
  if (open.length) return { error: `Recyclage encore ouvert (${open.join(', ')}) : clôturez ou annulez ces actions avant de déclarer la sortie.` };
  await db.transaction(async (tx) => {
    await tx.update(t.people).set({ leftOn, leftReason }).where(eq(t.people.id, id));
    await logChange(tx, { entityType: 'person', entityId: id, action: 'archive', summary: `Sortie de l'effectif le ${fmtDate(leftOn!)}`, reason: leftReason });
  });
  done();
  return { ok: true, id };
}

/** Réintègre un salarié sorti (ou annule une sortie déclarée) : il revient dans la matrice et les listes. */
export async function reinstatePerson(id: string): Promise<{ error?: string }> {
  const { error } = await requireSkillsEditor();
  if (error) return { error };
  const db = await getDb();
  const [person] = await db.select({ id: t.people.id, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, id));
  if (!person) return { error: 'Salarié introuvable.' };
  if (!person.leftOn) return { error: 'Aucune sortie déclarée pour ce salarié.' };
  const blocked = await requireInSite(person.siteId);
  if (blocked) return { error: blocked };
  await db.transaction(async (tx) => {
    await tx.update(t.people).set({ leftOn: null, leftReason: null }).where(eq(t.people.id, id));
    await logChange(tx, { entityType: 'person', entityId: id, action: 'restore', summary: 'Salarié réintégré' });
  });
  done();
  return {};
}

/**
 * Ajoute un titre suivi ou modifie son intitulé, sa durée de validité et la case « secourisme » (`firstAid`, lue seulement
 * si le formulaire porte `firstAidField` : titres des donneurs de soins du registre des accidents bénins, EVT-04) ; les
 * échéances enregistrées ne sont pas recalculées.
 */
export async function saveTitle(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireSkillsEditor();
  if (error) return { error };
  const db = await getDb();
  const titles = await db.select().from(t.trainingTitles);
  const f = formReader(fd);
  const id = f.opt('id');
  const label = f.str('label', { required: true, max: 60 });
  const validityMonths = f.int('validityMonths', { required: true, min: 0, max: 240 });
  const firstAidField = fd.has('firstAidField');
  // Les titres archivés comptent : restaurer plutôt que recréer (historique des formations conservé).
  const twin = label ? titles.find((x) => x.id !== id && clean(x.label) === clean(label)) : undefined;
  if (twin) f.fail('label', twin.archivedAt ? 'Ce titre existe déjà (archivé) : restaurez-le.' : 'Ce titre est déjà suivi.');
  if (!f.ok) return f.state();

  if (id) {
    const prev = titles.find((x) => x.id === id);
    if (!prev) return { error: 'Titre introuvable.' };
    if (prev.archivedAt) return { error: 'Titre archivé : restaurez-le pour le modifier.' };
    const firstAid = firstAidField ? f.bool('firstAid') : prev.firstAid;
    const details = [
      ...(prev.label !== label ? [{ field: 'Intitulé', from: prev.label, to: label }] : []),
      ...(prev.validityMonths !== validityMonths ? [{ field: 'Validité (mois)', from: String(prev.validityMonths), to: String(validityMonths) }] : []),
      ...(prev.firstAid !== firstAid ? [{ field: 'Secourisme', from: prev.firstAid ? 'oui' : 'non', to: firstAid ? 'oui' : 'non' }] : []),
    ];
    await db.transaction(async (tx) => {
      await tx.update(t.trainingTitles).set({ label, validityMonths: validityMonths!, firstAid }).where(eq(t.trainingTitles.id, id));
      await logChange(tx, { entityType: 'training_title', entityId: id, action: 'update', summary: `Titre « ${label} » modifié`, details });
    });
    done();
    return { ok: true, id };
  }
  const newId = uniqueId(titleSlug(label), new Set(titles.map((x) => x.id)), '-');
  const sort = Math.max(-1, ...titles.map((x) => x.sort)) + 1;
  const firstAid = firstAidField && f.bool('firstAid');
  await db.transaction(async (tx) => {
    await tx.insert(t.trainingTitles).values({ id: newId, label, validityMonths: validityMonths!, sort, firstAid });
    await logChange(tx, { entityType: 'training_title', entityId: newId, action: 'create', summary: `Titre « ${label} » ajouté${firstAid ? ' (secourisme)' : ''}` });
  });
  done();
  return { ok: true, id: newId };
}

/**
 * Archive un titre (retiré de la matrice, des formulaires et des échéances) avec un motif. Exigences et formations
 * sont conservées et consultables. Refusé tant qu'un recyclage rattaché à une exigence de ce titre est ouvert.
 */
export async function archiveTitle(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireSkillsEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [title] = await db.select().from(t.trainingTitles).where(eq(t.trainingTitles.id, id));
  if (!title) return { error: 'Titre introuvable.' };
  if (title.archivedAt) return { error: 'Ce titre est déjà archivé.' };
  const open = await openRenewals(db, { titleId: id });
  if (open.length) return { error: `Recyclage encore ouvert (${open.join(', ')}) : clôturez ou annulez ces actions avant d'archiver le titre.` };
  await db.transaction(async (tx) => {
    await tx.update(t.trainingTitles).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason }).where(eq(t.trainingTitles.id, id));
    await logChange(tx, { entityType: 'training_title', entityId: id, action: 'archive', summary: `Titre « ${title.label} » archivé`, reason });
  });
  done();
  return { ok: true, id };
}

/** Restaure un titre archivé : il revient dans la matrice avec ses exigences et formations. */
export async function restoreTitle(id: string): Promise<{ error?: string }> {
  const { error } = await requireSkillsEditor();
  if (error) return { error };
  const db = await getDb();
  const [title] = await db.select().from(t.trainingTitles).where(eq(t.trainingTitles.id, id));
  if (!title) return { error: 'Titre introuvable.' };
  if (!title.archivedAt) return {};
  await db.transaction(async (tx) => {
    await tx.update(t.trainingTitles).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.trainingTitles.id, id));
    await logChange(tx, { entityType: 'training_title', entityId: id, action: 'restore', summary: `Titre « ${title.label} » restauré` });
  });
  done();
  return {};
}
