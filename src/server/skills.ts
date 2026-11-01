'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { addMonths, fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { TRAINING_EFFECTIVENESS, TRAINING_EFFECTIVENESS_KEYS, canApprove, isClosedActionStatus } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireEditor, requireInSite } from '@/lib/guard';
import { checkUploadBatch, deleteAttachment, removeStoredFile, saveUpload } from '@/lib/uploads';
import { diffFields, logChange } from './changelog';
import { VERSION_FIELD, assertFresh, freshWrite } from './versions';
import { missingPrerequisites, prerequisiteCycle, sessionParticipantsError } from '@/lib/rules/skills';
import { nextSort } from '@/lib/sort-order';

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
const requireSkillsEditor = () => requireEditor('skills');

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
  let result = { error: 'Formation introuvable.' } as { error: string } | { id: number };
  const stale = await freshWrite(async () => { result = await db.transaction(async (tx): Promise<{ error: string } | { id: number }> => {
    let id: number;
    if (qualificationId) {
      // Correction d'une saisie : la ligne doit appartenir à la case et ne pas être annulée.
      const [prev] = await tx.select().from(t.qualifications).where(eq(t.qualifications.id, qualificationId));
      if (!prev || prev.personId !== personId || prev.titleId !== titleId) return { error: 'Formation introuvable.' };
      if (prev.cancelledAt) return { error: 'Formation annulée : elle ne peut plus être corrigée.' };
      // QUA-12 : formation corrigée, annulée ou complétée entre-temps (attestation, efficacité) : rien n'est écrasé.
      await assertFresh(tx, 'qualification', qualificationId, fd.get(VERSION_FIELD));
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
  }); });
  if (stale) return { error: stale };
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

/**
 * HAB-13 : évaluation à froid de l'efficacité d'une formation (ISO 45001 §7.2 d, ISO 9001 §7.2 c) — résultat, date (au plus
 * tôt l'obtention, au plus tard aujourd'hui) et constat (obligatoire si la formation n'est pas jugée efficace). Une nouvelle
 * évaluation remplace la précédente, gardée au journal de la formation. Formation non annulée, salarié présent, titre actif,
 * site du salarié (frozenReason) ; rôles qui saisissent les habilitations.
 */
export async function evaluateTrainingEffectiveness(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireSkillsEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const effectiveness = f.oneOf('effectiveness', TRAINING_EFFECTIVENESS_KEYS, { required: true });
  const effectivenessOn = f.date('effectivenessOn', { required: true });
  const effectivenessNote = f.str('effectivenessNote', { max: 500 }) || null;
  if (effectiveness && effectiveness !== 'efficace' && !effectivenessNote) f.fail('effectivenessNote', 'Précisez le constat (écarts observés, suite donnée).');
  if (effectivenessOn && effectivenessOn > today()) f.fail('effectivenessOn', "Date postérieure à aujourd'hui.");
  if (!f.ok) return f.state();
  const db = await getDb();
  const row = await findQualification(db, id!);
  if (!row) return { error: 'Formation introuvable.' };
  if (row.q.cancelledAt) return { error: 'Formation annulée : elle ne peut plus être évaluée.' };
  const blocked = await frozenReason(row);
  if (blocked) return { error: blocked };
  if (effectivenessOn! < row.q.obtainedOn) return { error: 'Certains champs sont à corriger.', fieldErrors: { effectivenessOn: "L'évaluation suit l'obtention de la formation." } };
  const label = (k: string | null) => (k ? TRAINING_EFFECTIVENESS[k as keyof typeof TRAINING_EFFECTIVENESS]?.label ?? k : null);
  const values = { effectiveness: effectiveness!, effectivenessOn: effectivenessOn!, effectivenessNote, effectivenessById: session.user.id };
  await db.transaction(async (tx) => {
    await tx.update(t.qualifications).set(values).where(eq(t.qualifications.id, row.q.id));
    await logChange(tx, {
      entityType: 'qualification', entityId: row.q.id, action: 'evaluate', byId: session.user.id,
      summary: `Efficacité de la formation du ${fmtDate(row.q.obtainedOn)} évaluée le ${fmtDate(values.effectivenessOn)} : ${label(values.effectiveness)}`,
      details: diffFields(
        { effectiveness: label(row.q.effectiveness), effectivenessOn: row.q.effectivenessOn ? fmtDate(row.q.effectivenessOn) : null, effectivenessNote: row.q.effectivenessNote },
        { effectiveness: label(values.effectiveness), effectivenessOn: fmtDate(values.effectivenessOn), effectivenessNote },
        { effectiveness: 'Efficacité', effectivenessOn: 'Évaluée le', effectivenessNote: 'Constat' },
      ),
    });
  });
  done();
  return { ok: true, id: String(row.q.id) };
}

/**
 * HAB-06 : session de formation collective, ou recyclage groupé depuis la prévision (HAB-09) — un titre, une date, un
 * organisme, des participants (`participants`, cases à cocher). Une formation par participant (même règles que
 * saveQualification : obtention jamais future, échéance = obtention + validité du titre si elle est laissée vide, titre
 * rendu requis), créées avec la session dans une seule transaction et journalisées (session, chaque formation, chaque
 * exigence ajoutée). Chaque participant : présent, du site sélectionné (requireInSite). Prérequis (HAB-10) : jamais refusés,
 * signalés dans la confirmation (la case sera « Prérequis non valide »). Attestations : ajoutées ensuite à chaque formation.
 */
export async function saveTrainingSession(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireSkillsEditor();
  if (error) return { error };
  const f = formReader(fd);
  const titleId = f.str('titleId', { required: true });
  const heldOn = f.date('heldOn', { required: true });
  let expiresOn = f.date('expiresOn');
  const provider = f.str('provider', { max: 120 }) || null;
  const scopeRaw = f.str('scope', { max: 120 }) || null;
  const participants = f.list('participants');
  const now = today();
  if (heldOn && heldOn > now) f.fail('heldOn', "La date de la session ne peut pas être postérieure à aujourd'hui.");
  if (heldOn && expiresOn && expiresOn <= heldOn) f.fail('expiresOn', "L'échéance doit suivre la date de la session.");
  const listError = sessionParticipantsError(participants);
  if (listError) f.fail('participants', listError);
  if (!f.ok) return f.state();

  const db = await getDb();
  const [[title], people, titles] = await Promise.all([
    db.select().from(t.trainingTitles).where(eq(t.trainingTitles.id, titleId)),
    db.select({ id: t.people.id, name: t.people.name, siteId: t.people.siteId, leftOn: t.people.leftOn }).from(t.people).where(inArray(t.people.id, participants)),
    db.select({ id: t.trainingTitles.id, label: t.trainingTitles.label, archivedAt: t.trainingTitles.archivedAt }).from(t.trainingTitles),
  ]);
  if (!title) return { error: 'Titre introuvable.', fieldErrors: { titleId: 'Titre introuvable.' } };
  if (title.archivedAt) return { error: 'Titre archivé.', fieldErrors: { titleId: 'Titre archivé.' } };
  const byId = new Map(people.map((p) => [p.id, p]));
  for (const id of participants) {
    const p = byId.get(id);
    if (!p) return { error: 'Participant introuvable.', fieldErrors: { participants: 'Participant introuvable.' } };
    if (hasLeft(p)) return { error: `${p.name} est sorti de l'effectif.`, fieldErrors: { participants: `${p.name} est sorti de l'effectif.` } };
    const blocked = await requireInSite(p.siteId);
    if (blocked) return { error: blocked };
  }
  if (!expiresOn && title.validityMonths > 0) expiresOn = addMonths(heldOn!, title.validityMonths);
  const scope = title.scopeLabel ? scopeRaw : null;
  const label = `Session « ${title.label} » du ${fmtDate(heldOn!)}`;
  const summary = `Formation du ${fmtDate(heldOn!)}${expiresOn ? ` (échéance ${fmtDate(expiresOn)})` : ''}${scope ? ` · ${scope}` : ''}`;
  const names = participants.map((id) => byId.get(id)!.name);

  const sessionId = await db.transaction(async (tx) => {
    const [row] = await tx.insert(t.trainingSessions)
      .values({ titleId, heldOn: heldOn!, expiresOn, provider, scope, recordedById: session.user.id })
      .returning({ id: t.trainingSessions.id });
    await logChange(tx, {
      entityType: 'training_session', entityId: row.id, action: 'create',
      summary: `${label} enregistrée : ${participants.length} participant${participants.length > 1 ? 's' : ''}`,
      details: [{ field: 'Participants', from: null, to: names.join(', ') }, ...(provider ? [{ field: 'Organisme', from: null, to: provider }] : [])],
    });
    for (const personId of participants) {
      const [q] = await tx.insert(t.qualifications)
        .values({ personId, titleId, obtainedOn: heldOn!, expiresOn, provider, scope, recordedById: session.user.id, sessionId: row.id })
        .returning({ id: t.qualifications.id });
      await logChange(tx, { entityType: 'qualification', entityId: q.id, action: 'create', summary: `${summary} enregistrée (session collective n° ${row.id})` });
      const added = await tx.insert(t.qualificationRequirements).values({ personId, titleId }).onConflictDoNothing().returning({ personId: t.qualificationRequirements.personId });
      if (added.length) {
        await logChange(tx, { entityType: 'qualification_requirement', entityId: requirementKey(personId, titleId), action: 'create', summary: `Titre « ${title.label} » requis (session collective n° ${row.id})` });
      }
    }
    return row.id;
  });

  // HAB-10 : prérequis non valides après la session (signalés, jamais refusés).
  const prereqs = title.prerequisiteIds ?? [];
  let warning = '';
  if (prereqs.length) {
    const held = await db.select({ personId: t.qualifications.personId, titleId: t.qualifications.titleId, expiresOn: t.qualifications.expiresOn })
      .from(t.qualifications)
      .where(and(inArray(t.qualifications.personId, participants), inArray(t.qualifications.titleId, prereqs), isNull(t.qualifications.cancelledAt)))
      .orderBy(desc(t.qualifications.obtainedOn), desc(t.qualifications.id));
    const active = new Set(titles.filter((ti) => !ti.archivedAt).map((ti) => ti.id));
    const lacking = participants.filter((pid) => {
      const mine = new Map<string, { expiresOn: string | null }>();
      held.filter((h) => h.personId === pid).forEach((h) => { if (!mine.has(h.titleId)) mine.set(h.titleId, h); });
      return missingPrerequisites(prereqs, mine, active, now).length > 0;
    });
    if (lacking.length) {
      const prereqLabels = prereqs.filter((id) => active.has(id)).map((id) => titles.find((ti) => ti.id === id)?.label ?? id).join(' ou ');
      warning = ` Prérequis non valide (${prereqLabels}) pour ${lacking.map((id) => byId.get(id)!.name).join(', ')} : titre inopérant tant qu'il n'est pas régularisé.`;
    }
  }
  done();
  return { ok: true, id: String(sessionId), message: `Session enregistrée : ${participants.length} formation${participants.length > 1 ? 's' : ''} créée${participants.length > 1 ? 's' : ''}.${warning}` };
}

/**
 * Annule une session saisie par erreur (jamais supprimée) : motif obligatoire ; ses formations encore en vigueur sont
 * annulées avec le même motif, chacune journalisée, dans la même transaction. Refusée si une formation de la session est
 * figée (salarié sorti, titre archivé) ou d'un autre site que celui sélectionné.
 */
export async function cancelTrainingSession(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireSkillsEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [row] = await db.select().from(t.trainingSessions).where(eq(t.trainingSessions.id, id!));
  if (!row) return { error: 'Session introuvable.' };
  if (row.cancelledAt) return { error: 'Cette session est déjà annulée.' };
  const quals = await db.select({ id: t.qualifications.id }).from(t.qualifications)
    .where(and(eq(t.qualifications.sessionId, row.id), isNull(t.qualifications.cancelledAt)));
  for (const q of quals) {
    const found = await findQualification(db, q.id);
    const blocked = found ? await frozenReason(found) : 'Formation introuvable.';
    if (blocked) return { error: blocked };
  }
  const at = new Date();
  await db.transaction(async (tx) => {
    await tx.update(t.trainingSessions).set({ cancelledAt: at, cancelledById: session.user.id, cancelReason: reason }).where(eq(t.trainingSessions.id, row.id));
    await logChange(tx, { entityType: 'training_session', entityId: row.id, action: 'cancel', summary: `Session du ${fmtDate(row.heldOn)} annulée (${quals.length} formation${quals.length > 1 ? 's' : ''})`, reason });
    for (const q of quals) {
      await tx.update(t.qualifications).set({ cancelledAt: at, cancelledById: session.user.id, cancelReason: reason }).where(eq(t.qualifications.id, q.id));
      await logChange(tx, { entityType: 'qualification', entityId: q.id, action: 'cancel', summary: `Formation du ${fmtDate(row.heldOn)} annulée (session collective n° ${row.id} annulée)`, reason });
    }
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
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      await assertFresh(tx, 'person', id, fd.get(VERSION_FIELD));
      await tx.update(t.people).set(values).where(eq(t.people.id, id));
      if (details.length) await logChange(tx, { entityType: 'person', entityId: id, action: 'update', summary: 'Fiche salarié modifiée', details });
    }));
    if (stale) return { error: stale };
    done();
    return { ok: true, id };
  }
  const blocked = await requireInSite(siteId, { create: true });
  if (blocked) return { error: blocked };
  const newId = randomUUID();
  const sort = nextSort(people);
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
  // HAB-13 : action de sensibilisation (§7.3) plutôt que formation qualifiante ; lue si le formulaire porte le champ.
  const awarenessField = fd.has('awarenessField');
  // AUD-27 : titre qui qualifie un auditeur interne ; lu si le formulaire porte le champ.
  const auditorField = fd.has('internalAuditorField');
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
    const awareness = awarenessField ? f.bool('awareness') : prev.awareness;
    const internalAuditor = auditorField ? f.bool('internalAuditor') : prev.internalAuditor;
    const labelOf = (ids: readonly string[]) => ids.map((x) => titles.find((ti) => ti.id === x)?.label ?? x).join(', ') || null;
    const details = [
      ...(prev.label !== label ? [{ field: 'Intitulé', from: prev.label, to: label }] : []),
      ...(prev.validityMonths !== validityMonths ? [{ field: 'Validité (mois)', from: String(prev.validityMonths), to: String(validityMonths) }] : []),
      ...(prev.firstAid !== firstAid ? [{ field: 'Secourisme', from: prev.firstAid ? 'oui' : 'non', to: firstAid ? 'oui' : 'non' }] : []),
      ...(labelOf(prev.prerequisiteIds ?? []) !== labelOf(prereq) ? [{ field: 'Prérequis', from: labelOf(prev.prerequisiteIds ?? []), to: labelOf(prereq) }] : []),
      ...((prev.scopeLabel ?? null) !== scope ? [{ field: 'Catégories ou niveaux', from: prev.scopeLabel, to: scope }] : []),
      ...(prev.awareness !== awareness ? [{ field: 'Sensibilisation', from: prev.awareness ? 'oui' : 'non', to: awareness ? 'oui' : 'non' }] : []),
      ...(prev.internalAuditor !== internalAuditor ? [{ field: 'Auditeur interne', from: prev.internalAuditor ? 'oui' : 'non', to: internalAuditor ? 'oui' : 'non' }] : []),
    ];
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      await assertFresh(tx, 'training_title', id, fd.get(VERSION_FIELD));
      await tx.update(t.trainingTitles).set({ label, validityMonths: validityMonths!, firstAid, prerequisiteIds: prereq, scopeLabel: scope, awareness, internalAuditor }).where(eq(t.trainingTitles.id, id));
      await logChange(tx, { entityType: 'training_title', entityId: id, action: 'update', summary: `Titre « ${label} » modifié`, details });
    }));
    if (stale) return { error: stale };
    done();
    return { ok: true, id };
  }
  const newId = uniqueId(titleSlug(label), new Set(titles.map((x) => x.id)), '-');
  const sort = nextSort(titles);
  const firstAid = firstAidField && f.bool('firstAid');
  const awareness = awarenessField && f.bool('awareness');
  const internalAuditor = auditorField && f.bool('internalAuditor');
  await db.transaction(async (tx) => {
    await tx.insert(t.trainingTitles).values({ id: newId, label, validityMonths: validityMonths!, sort, firstAid, awareness, internalAuditor, prerequisiteIds: prerequisitesField ? prerequisiteIds : [], scopeLabel: prerequisitesField ? scopeLabel : null });
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

/**
 * HAB-15 : déplace un titre suivi d'un rang vers la gauche (« up ») ou la droite (« down ») dans les colonnes de la matrice,
 * parmi les titres en vigueur (les titres archivés gardent leur rang) ; service QHSE et direction (requireTitlesEditor,
 * HAB-12), commun à tous les sites. Renumérotation 0..n-1 dans la transaction, inscrite au journal du titre.
 */
export async function moveTitle(id: string, dir: 'up' | 'down'): Promise<{ error?: string }> {
  const { error } = await requireTitlesEditor();
  if (error) return { error };
  if (typeof id !== 'string' || !id || (dir !== 'up' && dir !== 'down')) return { error: 'Titre introuvable.' };
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const scope = await tx.select({ id: t.trainingTitles.id, label: t.trainingTitles.label, sort: t.trainingTitles.sort }).from(t.trainingTitles)
      .where(isNull(t.trainingTitles.archivedAt)).orderBy(asc(t.trainingTitles.sort), asc(t.trainingTitles.id));
    const i = scope.findIndex((x) => x.id === id);
    if (i < 0) return { error: 'Titre introuvable ou archivé.' };
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= scope.length) return { moved: false };
    const title = scope[i];
    const neighbour = scope[j];
    [scope[i], scope[j]] = [scope[j], scope[i]];
    for (const [n, x] of scope.entries()) if (x.sort !== n) await tx.update(t.trainingTitles).set({ sort: n }).where(eq(t.trainingTitles.id, x.id));
    await logChange(tx, {
      entityType: 'training_title', entityId: id, action: 'move',
      summary: `Titre « ${title.label} » placé ${dir === 'up' ? 'avant' : 'après'} « ${neighbour.label} » dans la matrice`,
    });
    return { moved: true };
  });
  if ('error' in result) return { error: result.error };
  if (result.moved) done();
  return {};
}
