'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { addMonths, fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { canApprove, canEdit, isClosedActionStatus } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireInSite, requireManager } from '@/lib/guard';
import { checkUploadBatch, deleteAttachment, removeStoredFile, saveUpload } from '@/lib/uploads';
import { diffFields, logChange } from './changelog';
import { prerequisiteCycle } from '@/components/skills/rules';

// Habilitations et formations : formations suivies, exigences par salarié, personnel et titres suivis.
// Plan d'actions : aucune formation ni aucun recyclage ne donne lieu à une action QSE (réponses du service QHSE du
// 15/10/2026, le service RH gère cette partie) ; ces server actions ne lisent ni n'écrivent aucune action, sauf pour
// protéger le rattachement d'une action de recyclage reprise (actions.qualification_person_id / qualification_title_id,
// HAB-04) encore non close.

const clean = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Identifiant libre dérivé de `base` (suffixe numérique en cas de doublon). */
function uniqueId(base: string, existing: Set<string>, sep = '') {
  let id = base;
  for (let n = 2; existing.has(id); n++) id = `${base}${sep}${n}`;
  return id;
}

const titleSlug = (label: string) => clean(label).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'titre';

const done = () => revalidatePath('/', 'layout');

/** Journal de l'exigence « titre requis pour ce salarié » (case de la matrice, HAB-03) : identifiant « personne|titre ». */
const requirementKey = (personId: string, titleId: string) => `${personId}|${titleId}`;

/**
 * Saisie réservée aux rôles qui ont accès à l'écran « Habilitations et formations » (hors salariés et lecture seule) :
 * le chef de projet saisit ailleurs mais n'a pas cet écran, il ne modifie rien ici.
 */
async function requireSkillsEditor() {
  const { session, error } = await requireManager();
  if (error) return { session, error };
  return canEdit(session.role, 'skills') ? { session, error: null } : { session, error: 'Votre rôle ne permet pas cette modification.' };
}

/** Refus d'une modification des titres suivis hors QHSE (HAB-12). */
const TITLES_RESERVED = "Titres suivis communs à tous les sites : réservés à l'animateur QHSE et à la direction.";

/**
 * Titres suivis (ajout, intitulé, validité, archivage, restauration) : communs à tous les sites (aucun siteId), ils
 * relèvent du service QHSE et de la direction (HAB-12), comme tout élément commun à tous les sites (ALL_SITES_RESERVED).
 */
async function requireTitlesEditor() {
  const { session, error } = await requireSkillsEditor();
  if (error) return { session, error };
  return canApprove(session.role) ? { session, error: null } : { session, error: TITLES_RESERVED };
}

/** Salarié sorti de l'effectif à la date du jour (archivé : plus de saisie sur sa fiche ni ses formations). */
const hasLeft = (p: { leftOn: string | null }) => !!p.leftOn && p.leftOn <= today();

/** Contrôle d'un envoi d'attestations (nombre, volume, contenu, limites de la personne) ; message d'erreur ou null. */
const checkFiles = (files: File[], by: string) => checkUploadBatch(files, by);

/**
 * Actions de recyclage reprises encore non closes (ni Vérifiée ni Abandonnée, Terminée comprise) rattachées aux exigences
 * d'un titre ou d'un salarié.
 */
async function openRenewals(db: DbOrTx, by: { titleId: string } | { personId: string }) {
  // Actions des exigences en vigueur (une case dont le titre n'est plus requis ne retient plus rien).
  const rows = await db.select({ id: t.actions.id, status: t.actions.status }).from(t.actions)
    .innerJoin(t.qualificationRequirements, and(
      eq(t.qualificationRequirements.personId, t.actions.qualificationPersonId), eq(t.qualificationRequirements.titleId, t.actions.qualificationTitleId),
    ))
    .where('titleId' in by ? eq(t.actions.qualificationTitleId, by.titleId) : eq(t.actions.qualificationPersonId, by.personId));
  return rows.filter((a) => !isClosedActionStatus(a.status)).map((a) => a.id).sort();
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
 * Une action de recyclage reprise rattachée à l'exigence n'est jamais modifiée (le service QHSE la clôt ou l'abandonne
 * dans le plan d'actions).
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
  // HAB-10 : catégories ou niveaux obtenus (lus si le titre en porte, voir plus bas).
  const scopeRaw = f.str('scope', { max: 120 }) || null;
  const files = f.files('files');
  const now = today();
  if (obtainedOn && obtainedOn > now) f.fail('obtainedOn', "La date d'obtention ne peut pas être postérieure à aujourd'hui.");
  if (obtainedOn && expiresOn && expiresOn <= obtainedOn) f.fail('expiresOn', "L'échéance doit suivre la date d'obtention.");
  const invalidFiles = await checkFiles(files, session.user.id);
  if (invalidFiles) f.fail('files', invalidFiles);
  if (!f.ok) return f.state();

  const db = await getDb();
  const [[person], [title]] = await Promise.all([
    db.select({ id: t.people.id, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, personId)),
    db.select().from(t.trainingTitles).where(eq(t.trainingTitles.id, titleId)),
  ]);
  if (!person) return { error: 'Salarié introuvable.', fieldErrors: { personId: 'Salarié introuvable.' } };
  if (!title) return { error: 'Titre introuvable.', fieldErrors: { titleId: 'Titre introuvable.' } };
  if (title.archivedAt) return { error: 'Titre archivé.', fieldErrors: { titleId: 'Titre archivé.' } };
  if (hasLeft(person)) return { error: "Salarié sorti de l'effectif.", fieldErrors: { personId: "Salarié sorti de l'effectif." } };
  const blocked = await requireInSite(person.siteId);
  if (blocked) return { error: blocked };
  if (!expiresOn && title.validityMonths > 0) expiresOn = addMonths(obtainedOn!, title.validityMonths);

  const values = { obtainedOn: obtainedOn!, expiresOn, provider, scope: title.scopeLabel ? scopeRaw : null };
  const summary = `Formation du ${fmtDate(values.obtainedOn)}${expiresOn ? ` (échéance ${fmtDate(expiresOn)})` : ''}${values.scope ? ` · ${values.scope}` : ''}`;
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
    const added = await tx.insert(t.qualificationRequirements).values({ personId, titleId }).onConflictDoNothing().returning({ personId: t.qualificationRequirements.personId });
    if (added.length) {
      await logChange(tx, { entityType: 'qualification_requirement', entityId: requirementKey(personId, titleId), action: 'create', summary: `Titre « ${title.label} » requis (formation enregistrée)` });
    }
    return { id };
  });
  if ('error' in result) return { error: result.error };
  await saveAttestations(files, result.id, session.user.id);
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
  // Aucune action n'est touchée : une action de recyclage reprise rattachée reste en l'état (plan d'actions, service QHSE).
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
  const invalid = await checkFiles(files, session.user.id);
  if (invalid) return { error: invalid };
  const db = await getDb();
  const row = await findQualification(db, id);
  if (!row) return { error: 'Formation introuvable.' };
  if (row.q.cancelledAt) return { error: 'Formation annulée : ajout impossible.' };
  const blocked = await frozenReason(row);
  if (blocked) return { error: blocked };
  await saveAttestations(files, id, session.user.id);
  done();
  return { count: files.length };
}

/** Attestations d'une formation : chaque fichier joint est journalisé sur la formation (HAB-03), avec l'enregistrement de la pièce. */
async function saveAttestations(files: File[], qualificationId: number, userId: string) {
  if (!files.length) return;
  const db = await getDb();
  for (const file of files) {
    await db.transaction(async (tx) => {
      const att = await saveUpload(file, 'qualification', String(qualificationId), userId, { db: tx });
      await logChange(tx, {
        entityType: 'qualification', entityId: qualificationId, action: 'attach', byId: userId,
        summary: 'Attestation jointe', details: [{ field: 'Fichier', from: null, to: att.fileName }],
      });
    });
  }
}

/** Retire une attestation ajoutée par erreur (seule suppression admise), tant que la formation n'est ni annulée ni figée. */
export async function removeQualificationFile(attachmentId: string): Promise<{ error?: string }> {
  const { session, error } = await requireSkillsEditor();
  if (error) return { error };
  if (typeof attachmentId !== 'string' || !attachmentId) return { error: 'Pièce jointe introuvable.' };
  const db = await getDb();
  const [file] = await db.select({ entityType: t.attachments.entityType, entityId: t.attachments.entityId, fileName: t.attachments.fileName }).from(t.attachments).where(eq(t.attachments.id, attachmentId));
  if (!file || file.entityType !== 'qualification') return { error: 'Pièce jointe introuvable.' };
  const row = await findQualification(db, Number(file.entityId));
  if (!row) return { error: 'Formation introuvable.' };
  if (row.q.cancelledAt) return { error: 'Formation annulée : ses attestations sont conservées.' };
  const blocked = await frozenReason(row);
  if (blocked) return { error: blocked };
  // Ligne supprimée et journal dans la même transaction ; le fichier stocké n'est effacé qu'après validation.
  const removed = await db.transaction(async (tx) => {
    const r = await deleteAttachment(attachmentId, { db: tx });
    if (r) {
      await logChange(tx, {
        entityType: 'qualification', entityId: row.q.id, action: 'detach', byId: session.user.id,
        summary: 'Attestation retirée (ajoutée par erreur)', details: [{ field: 'Fichier', from: file.fileName, to: null }],
      });
    }
    return r;
  });
  if (removed) await removeStoredFile(removed);
  done();
  return {};
}

/**
 * Rend un titre requis (ou non) pour un salarié. Les formations déjà enregistrées sont conservées.
 * Retirer l'exigence est refusé tant que l'action de recyclage reprise rattachée n'est pas close (le lien serait perdu).
 */
export async function setRequirement(personId: string, titleId: string, required: boolean): Promise<{ error?: string }> {
  const { session, error } = await requireSkillsEditor();
  if (error) return { error };
  if (typeof personId !== 'string' || typeof titleId !== 'string') return { error: 'Salarié ou titre introuvable.' };
  const db = await getDb();
  const [[person], [title]] = await Promise.all([
    db.select({ id: t.people.id, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, personId)),
    db.select({ id: t.trainingTitles.id, label: t.trainingTitles.label, archivedAt: t.trainingTitles.archivedAt }).from(t.trainingTitles).where(eq(t.trainingTitles.id, titleId)),
  ]);
  if (!person || !title) return { error: 'Salarié ou titre introuvable.' };
  if (title.archivedAt) return { error: 'Titre archivé : restaurez-le pour modifier ses exigences.' };
  if (hasLeft(person)) return { error: "Salarié sorti de l'effectif." };
  const blocked = await requireInSite(person.siteId);
  if (blocked) return { error: blocked };
  const where = and(eq(t.qualificationRequirements.personId, personId), eq(t.qualificationRequirements.titleId, titleId));
  const log = (tx: DbOrTx, on: boolean) => logChange(tx, {
    entityType: 'qualification_requirement', entityId: requirementKey(personId, titleId), action: on ? 'create' : 'delete', byId: session.user.id,
    summary: on ? `Titre « ${title.label} » requis pour ce salarié` : `Titre « ${title.label} » n'est plus requis (formations conservées)`,
  });
  if (required) {
    await db.transaction(async (tx) => {
      const added = await tx.insert(t.qualificationRequirements).values({ personId, titleId }).onConflictDoNothing().returning({ personId: t.qualificationRequirements.personId });
      if (added.length) await log(tx, true);
    });
  } else {
    const renewals = await db.select({ id: t.actions.id, status: t.actions.status }).from(t.actions)
      .where(and(eq(t.actions.qualificationPersonId, personId), eq(t.actions.qualificationTitleId, titleId)));
    const action = renewals.filter((a) => !isClosedActionStatus(a.status)).sort((a, b) => a.id.localeCompare(b.id))[0];
    if (action) {
      return { error: `L'action ${action.id} (recyclage) n'est pas close : le service QHSE doit la clôturer ou l'abandonner avant le retrait de l'exigence.` };
    }
    await db.transaction(async (tx) => {
      const removed = await tx.delete(t.qualificationRequirements).where(where).returning({ personId: t.qualificationRequirements.personId });
      if (removed.length) await log(tx, false);
    });
  }
  done();
  return {};
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Champs de la fiche salarié suivis par le journal (HAB-03). */
const PERSON_LABELS = {
  name: 'Nom', job: 'Poste', service: 'Service', siteId: 'Site de rattachement', inSkillsMatrix: 'Suivi dans la matrice', email: 'E-mail', matricule: 'Matricule',
} as const;

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
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
    db.select({
      id: t.people.id, sort: t.people.sort, siteId: t.people.siteId, leftOn: t.people.leftOn, email: t.people.email, matricule: t.people.matricule,
      name: t.people.name, job: t.people.job, service: t.people.service, inSkillsMatrix: t.people.inSkillsMatrix,
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
    const siteLabel = (sid: string | null) => (sid ? sites.find((s) => s.id === sid)?.label ?? sid : null);
    const fmt = (v: unknown) => (v == null || v === '' ? null : typeof v === 'boolean' ? (v ? 'oui' : 'non') : String(v));
    const details = diffFields({ ...prev, siteId: siteLabel(prev.siteId) }, { ...values, siteId: siteLabel(values.siteId) }, PERSON_LABELS, fmt);
    await db.transaction(async (tx) => {
      await tx.update(t.people).set(values).where(eq(t.people.id, id));
      if (details.length) await logChange(tx, { entityType: 'person', entityId: id, action: 'update', summary: 'Fiche salarié modifiée', details });
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
  // Motif de la sortie : règle commune des motifs (QUA-22, formReader.reason).
  const leftReason = f.reason('leftReason');
  if (leftOn && leftOn < addMonths(today(), -12)) f.fail('leftOn', "La date de sortie ne peut pas remonter à plus d'un an.");
  if (!f.ok) return f.state();
  const db = await getDb();
  const [person] = await db.select({ id: t.people.id, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, id));
  if (!person) return { error: 'Salarié introuvable.' };
  if (hasLeft(person)) return { error: "Salarié déjà sorti de l'effectif." };
  const blocked = await requireInSite(person.siteId);
  if (blocked) return { error: blocked };
  const open = await openRenewals(db, { personId: id });
  if (open.length) return { error: `Recyclage encore ouvert (${open.join(', ')}) : le service QHSE doit clôturer ou abandonner ces actions avant la déclaration de sortie.` };
  await db.transaction(async (tx) => {
    await tx.update(t.people).set({ leftOn, leftReason }).where(eq(t.people.id, id));
    await logChange(tx, { entityType: 'person', entityId: id, action: 'archive', summary: `Sortie de l'effectif le ${fmtDate(leftOn!)}`, reason: leftReason });
  });
  done();
  return { ok: true, id };
}

/** Réintègre un salarié sorti (ou annule une sortie déclarée), motif obligatoire (QUA-22) : il revient dans la matrice et les listes. */
export async function reinstatePerson(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireSkillsEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [person] = await db.select({ id: t.people.id, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, id));
  if (!person) return { error: 'Salarié introuvable.' };
  if (!person.leftOn) return { error: 'Aucune sortie déclarée pour ce salarié.' };
  const blocked = await requireInSite(person.siteId);
  if (blocked) return { error: blocked };
  await db.transaction(async (tx) => {
    await tx.update(t.people).set({ leftOn: null, leftReason: null }).where(eq(t.people.id, id));
    await logChange(tx, { entityType: 'person', entityId: id, action: 'restore', summary: 'Salarié réintégré', reason });
  });
  done();
  return { ok: true, id };
}

/**
 * Ajoute un titre suivi ou modifie son intitulé, sa durée de validité et la case « secourisme » (`firstAid`, lue seulement
 * si le formulaire porte `firstAidField` : titres des donneurs de soins du registre des accidents bénins, EVT-04) ; les
 * échéances enregistrées ne sont pas recalculées.
 */
export async function saveTitle(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireTitlesEditor();
  if (error) return { error };
  const db = await getDb();
  const titles = await db.select().from(t.trainingTitles);
  const f = formReader(fd);
  const id = f.opt('id');
  const label = f.str('label', { required: true, max: 60 });
  const validityMonths = f.int('validityMonths', { required: true, min: 0, max: 240 });
  const firstAidField = fd.has('firstAidField');
  // HAB-10 : titres prérequis (actifs, sans cycle) et libellé des catégories ou niveaux ; lus si le formulaire les porte.
  const prerequisitesField = fd.has('prerequisitesField');
  const prerequisiteIds = [...new Set(f.list('prerequisiteIds'))];
  const scopeLabel = f.str('scopeLabel', { max: 60 }) || null;
  if (prerequisitesField) {
    const active = new Map(titles.filter((x) => !x.archivedAt).map((x) => [x.id, x]));
    if (prerequisiteIds.some((p) => p === id)) f.fail('prerequisiteIds', 'Un titre ne peut pas être son propre prérequis.');
    else if (prerequisiteIds.some((p) => !active.has(p))) f.fail('prerequisiteIds', 'Titre prérequis inconnu ou archivé.');
    else if (id) {
      const cycle = prerequisiteCycle(id, prerequisiteIds, new Map(titles.map((x) => [x.id, x.prerequisiteIds ?? []])));
      if (cycle) f.fail('prerequisiteIds', `« ${active.get(cycle)?.label ?? cycle} » exige déjà ce titre (prérequis circulaire).`);
    }
  }
  // Les titres archivés comptent : restaurer plutôt que recréer (historique des formations conservé).
  const twin = label ? titles.find((x) => x.id !== id && clean(x.label) === clean(label)) : undefined;
  if (twin) f.fail('label', twin.archivedAt ? 'Ce titre existe déjà (archivé) : restaurez-le.' : 'Ce titre est déjà suivi.');
  if (!f.ok) return f.state();

  if (id) {
    const prev = titles.find((x) => x.id === id);
    if (!prev) return { error: 'Titre introuvable.' };
    if (prev.archivedAt) return { error: 'Titre archivé : restaurez-le pour le modifier.' };
    const firstAid = firstAidField ? f.bool('firstAid') : prev.firstAid;
    const prereq = prerequisitesField ? prerequisiteIds : prev.prerequisiteIds ?? [];
    const scope = prerequisitesField ? scopeLabel : prev.scopeLabel;
    const labelOf = (ids: readonly string[]) => ids.map((x) => titles.find((ti) => ti.id === x)?.label ?? x).join(', ') || null;
    const details = [
      ...(prev.label !== label ? [{ field: 'Intitulé', from: prev.label, to: label }] : []),
      ...(prev.validityMonths !== validityMonths ? [{ field: 'Validité (mois)', from: String(prev.validityMonths), to: String(validityMonths) }] : []),
      ...(prev.firstAid !== firstAid ? [{ field: 'Secourisme', from: prev.firstAid ? 'oui' : 'non', to: firstAid ? 'oui' : 'non' }] : []),
      ...(labelOf(prev.prerequisiteIds ?? []) !== labelOf(prereq) ? [{ field: 'Prérequis', from: labelOf(prev.prerequisiteIds ?? []), to: labelOf(prereq) }] : []),
      ...((prev.scopeLabel ?? null) !== scope ? [{ field: 'Catégories ou niveaux', from: prev.scopeLabel, to: scope }] : []),
    ];
    await db.transaction(async (tx) => {
      await tx.update(t.trainingTitles).set({ label, validityMonths: validityMonths!, firstAid, prerequisiteIds: prereq, scopeLabel: scope }).where(eq(t.trainingTitles.id, id));
      await logChange(tx, { entityType: 'training_title', entityId: id, action: 'update', summary: `Titre « ${label} » modifié`, details });
    });
    done();
    return { ok: true, id };
  }
  const newId = uniqueId(titleSlug(label), new Set(titles.map((x) => x.id)), '-');
  const sort = Math.max(-1, ...titles.map((x) => x.sort)) + 1;
  const firstAid = firstAidField && f.bool('firstAid');
  await db.transaction(async (tx) => {
    await tx.insert(t.trainingTitles).values({ id: newId, label, validityMonths: validityMonths!, sort, firstAid, prerequisiteIds: prerequisitesField ? prerequisiteIds : [], scopeLabel: prerequisitesField ? scopeLabel : null });
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
  const { session, error } = await requireTitlesEditor();
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
  if (open.length) return { error: `Recyclage encore ouvert (${open.join(', ')}) : le service QHSE doit clôturer ou abandonner ces actions avant l'archivage du titre.` };
  await db.transaction(async (tx) => {
    await tx.update(t.trainingTitles).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason }).where(eq(t.trainingTitles.id, id));
    await logChange(tx, { entityType: 'training_title', entityId: id, action: 'archive', summary: `Titre « ${title.label} » archivé`, reason });
  });
  done();
  return { ok: true, id };
}

/** Restaure un titre archivé, motif obligatoire (QUA-22) : il revient dans la matrice avec ses exigences et formations. */
export async function restoreTitle(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireTitlesEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [title] = await db.select().from(t.trainingTitles).where(eq(t.trainingTitles.id, id));
  if (!title) return { error: 'Titre introuvable.' };
  if (!title.archivedAt) return { ok: true, id };
  await db.transaction(async (tx) => {
    await tx.update(t.trainingTitles).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.trainingTitles.id, id));
    await logChange(tx, { entityType: 'training_title', entityId: id, action: 'restore', summary: `Titre « ${title.label} » restauré`, reason });
  });
  done();
  return { ok: true, id };
}
