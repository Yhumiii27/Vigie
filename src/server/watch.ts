'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, isNull, max, ne } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { addMonths, fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import {
  CONTROL_CATEGORIES, CONTROL_CATEGORY_KEYS, CONTROL_RESULTS, CONTROL_RESULT_KEYS, REQUIREMENT_EVAL, REQUIREMENT_LINKS, REQUIREMENT_LINK_KEYS,
  REQUIREMENT_REVIEW_MAX, REQUIREMENT_REVIEW_MONTHS, SAFETY_NOTICE_KINDS, SAFETY_NOTICE_KIND_KEYS, controlResultsFor,
} from '@/lib/domain';
import { nextEntityReference } from './references';
import { currentEvaluation, equipmentCodeError, legalTextUrlError, normalizeEquipmentCode } from '@/lib/watch-rules';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireEditor, requireInSite } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import { loadPeople } from '@/lib/queries';
import { checkUploadBatch, deleteAttachment, listAttachments, saveUpload } from '@/lib/uploads';
import { diffFields, logChange } from './changelog';
import { VERSION_FIELD, assertFresh, freshWrite } from './versions';

const EVALUATIONS = Object.keys(REQUIREMENT_EVAL);
const ARCHIVED_REQ = 'Exigence archivée : restaurez-la pour la modifier.';
const ARCHIVED_CTRL = 'Contrôle archivé : restaurez-le pour le modifier.';

/** Saisie réservée aux rôles qui modifient et ont accès à l'écran « Veille et contrôles ». */
const requireWatchManager = () => requireEditor('watch');

/** Personne choisie (pilote, responsable) : présente ou sortie de l'effectif (`leftOn`), undefined si inconnue. */
async function findPerson(id: string) {
  const db = await getDb();
  const [p] = await db.select({ id: t.people.id, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, id));
  return p;
}

/** Contrôle d'un envoi de pièces jointes (nombre, volume, contenu, limites de la personne : checkUploadBatch) ; erreur portée par le champ `name`. */
async function checkFiles(f: ReturnType<typeof formReader>, name: string, files: File[], by: string) {
  const err = await checkUploadBatch(files, by);
  if (err) f.fail(name, err);
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
  affectsProjects: 'Concerne les projets Keystone', featured: 'À la une', siteIds: 'Sites concernés', legifranceUrl: 'Lien vers le texte',
  linkedTo: 'Indicateur rattaché', reviewMonths: 'Réévaluation tous les (mois)', certificationId: 'Certification rattachée',
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
  // VEI-10 : sites où l'exigence s'applique (aucun coché : tous les sites) et lien vers le texte (Légifrance, EUR-Lex).
  const siteIdsField = fd.has('siteIdsField');
  const siteIds = [...new Set(f.list('siteIds'))].sort();
  const legifranceInput = f.str('legifranceUrl', { max: 500 }) || null;
  const legifranceUrl = legifranceInput;
  const urlError = legifranceUrl ? legalTextUrlError(legifranceUrl) : null;
  if (urlError) f.fail('legifranceUrl', urlError);
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
  const sitesOf = siteIdsField ? siteIds : current?.siteIds ?? [];
  // Lien absent du formulaire (appel direct, ancien formulaire) : valeur enregistrée conservée.
  const linkOf = fd.has('legifranceUrl') ? legifranceUrl : current?.legifranceUrl ?? null;
  // VEI-07 : indicateur calculé rattaché explicitement (liste fermée, vide = aucun) ; absent du formulaire : conservé.
  const linkedToField = fd.has('linkedToField');
  const linkedTo = linkedToField ? f.oneOf('linkedTo', REQUIREMENT_LINK_KEYS) ?? null : current?.linkedTo ?? null;
  // VEI-12 : certification rattachée (indicateur « certification » seulement), une exigence en vigueur par certification.
  const certificationId = linkedTo !== 'certification' ? null
    : linkedToField ? f.opt('certificationId') : current?.certificationId ?? null;
  if (linkedToField && linkedTo === 'certification') {
    if (!certificationId) f.fail('certificationId', 'Choisissez la certification dont l’exigence reprend l’état.');
    else {
      const [cert] = await db.select({ id: t.certifications.id }).from(t.certifications).where(eq(t.certifications.id, certificationId));
      if (!cert) f.fail('certificationId', 'Certification inconnue.');
      else if (certificationId !== current?.certificationId) {
        const [taken] = await db.select({ id: t.requirements.id, text: t.requirements.text }).from(t.requirements)
          .where(and(eq(t.requirements.certificationId, certificationId), isNull(t.requirements.archivedAt), id ? ne(t.requirements.id, id) : undefined));
        if (taken) f.fail('certificationId', `Certification déjà rattachée à l'exigence « ${taken.text} » : détachez-la d'abord.`);
      }
    }
  } else if (linkedToField && linkedTo && linkedTo !== current?.linkedTo) {
    const [taken] = await db.select({ id: t.requirements.id, text: t.requirements.text }).from(t.requirements)
      .where(and(eq(t.requirements.linkedTo, linkedTo), isNull(t.requirements.archivedAt), id ? ne(t.requirements.id, id) : undefined));
    if (taken) f.fail('linkedTo', `Indicateur déjà rattaché à l'exigence « ${taken.text} » : détachez-le d'abord.`);
  }
  // VEI-18 : périodicité de réévaluation propre à l'exigence (vide = 12 mois) ; champ absent du formulaire : conservée.
  const reviewMonths = fd.has('reviewMonths') ? f.int('reviewMonths', { min: 1, max: REQUIREMENT_REVIEW_MAX }) ?? null : current?.reviewMonths ?? null;
  if (siteIdsField) {
    const known = new Set((await db.select({ id: t.sites.id, archivedAt: t.sites.archivedAt }).from(t.sites)).filter((s) => !s.archivedAt || current?.siteIds?.includes(s.id)).map((s) => s.id));
    const before = [...(current?.siteIds ?? [])].sort().join(',');
    if (siteIds.some((s) => !known.has(s))) f.fail('siteIds', 'Site inconnu ou archivé.');
    // Applicabilité d'une exigence commune à l'entreprise : fixée par une personne qui voit tous les sites (SEC-02).
    else if (siteIds.join(',') !== before && session.allowedSiteIds) f.fail('siteIds', 'Sites concernés : réservés à la direction et à l’animateur QHSE (périmètre complet).');
  }
  if (!f.ok) return f.state();
  if (id && !current) return { error: 'Exigence introuvable.' };

  const values = {
    text, domain, summary, dueOn, dueNote, evaluation: evaluation!, evaluationNote, pilotId, impact, affectsProjects, keystoneProjects, featured,
    siteIds: sitesOf, legifranceUrl: linkOf, linkedTo, certificationId, reviewMonths,
  };
  const evalRow = (requirementId: number) => ({ requirementId, evaluatedOn: now, evaluation: values.evaluation, note: evaluationNote, evaluatedById: session.user.id });

  let savedId = id;
  if (current) {
    if (current.archivedAt) return { error: ARCHIVED_REQ };
    const reevaluated = current.evaluation !== values.evaluation || (current.evaluationNote ?? null) !== values.evaluationNote;
    const siteNames = new Map((await db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites)).map((s) => [s.id, s.label.split(' — ')[0]]));
    const showSites = (ids: string[] | null | undefined) => (ids?.length ? ids.map((x) => siteNames.get(x) ?? x).join(', ') : 'Tous les sites');
    const linkLabel = (k: string | null) => (k ? REQUIREMENT_LINKS[k as keyof typeof REQUIREMENT_LINKS]?.label ?? k : null);
    const certNames = new Map((await db.select({ id: t.certifications.id, standard: t.certifications.standard }).from(t.certifications)).map((c) => [c.id, c.standard]));
    const certLabel = (k: string | null) => (k ? certNames.get(k) ?? k : null);
    const months = (n: number | null) => (n == null ? `${REQUIREMENT_REVIEW_MONTHS} (par défaut)` : String(n));
    const details = diffFields(
      { ...(await withNames(current, ['pilotId'])), siteIds: showSites(current.siteIds), linkedTo: linkLabel(current.linkedTo), certificationId: certLabel(current.certificationId), reviewMonths: months(current.reviewMonths) },
      { ...(await withNames({ ...current, ...values }, ['pilotId'])), siteIds: showSites(values.siteIds), linkedTo: linkLabel(values.linkedTo), certificationId: certLabel(values.certificationId), reviewMonths: months(values.reviewMonths) }, REQ_LABELS, fmtLog,
    );
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      // QUA-12 : fiche modifiée depuis l'ouverture du formulaire (autre modification, évaluation, pièce jointe) : rien n'est écrasé.
      await assertFresh(tx, 'requirement', current.id, fd.get(VERSION_FIELD));
      if (featured) await tx.update(t.requirements).set({ featured: false }).where(and(eq(t.requirements.featured, true), ne(t.requirements.id, current.id)));
      await tx.update(t.requirements).set({ ...values, lastEvaluatedOn: reevaluated ? now : current.lastEvaluatedOn }).where(eq(t.requirements.id, current.id));
      if (reevaluated) await tx.insert(t.requirementEvaluations).values(evalRow(current.id));
      if (details.length) await logChange(tx, { entityType: 'requirement', entityId: current.id, action: 'update', summary: 'Exigence modifiée', details });
    }));
    if (stale) return { error: stale };
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
  await checkFiles(f, 'proof', files, session.user.id);
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

/**
 * Annule une évaluation de conformité saisie par erreur (VEI-16) : motif obligatoire, jamais supprimée (preuves conservées,
 * figées). L'évaluation courante de l'exigence est recalculée d'après les évaluations restantes (currentEvaluation : la plus
 * récente, sinon « À évaluer »). Service QHSE et direction, comme l'annulation d'un enregistrement de contrôle ; exigence
 * archivée : figée. Journal de l'exigence dans la transaction.
 */
export async function cancelRequirementEvaluation(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();

  const db = await getDb();
  const [row] = await db.select().from(t.requirementEvaluations).where(eq(t.requirementEvaluations.id, id!));
  if (!row) return { error: 'Évaluation introuvable.' };
  if (row.cancelledAt) return { error: 'Évaluation déjà annulée.' };
  const [req] = await db.select().from(t.requirements).where(eq(t.requirements.id, row.requirementId));
  if (!req) return { error: 'Exigence introuvable.' };
  if (req.archivedAt) return { error: ARCHIVED_REQ };

  const label = (k: string | null) => (k ? REQUIREMENT_EVAL[k]?.label ?? k : null);
  const done = await db.transaction(async (tx) => {
    const cancelled = await tx.update(t.requirementEvaluations).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason })
      .where(and(eq(t.requirementEvaluations.id, row.id), isNull(t.requirementEvaluations.cancelledAt))).returning({ id: t.requirementEvaluations.id });
    if (!cancelled.length) return false;
    const history = await tx.select().from(t.requirementEvaluations).where(eq(t.requirementEvaluations.requirementId, req.id));
    const next = currentEvaluation(history.map((e) => ({ id: e.id, evaluatedOn: e.evaluatedOn, evaluation: e.evaluation, note: e.note, cancelled: !!e.cancelledAt })));
    await tx.update(t.requirements).set(next).where(eq(t.requirements.id, req.id));
    await logChange(tx, {
      entityType: 'requirement', entityId: req.id, action: 'cancel', reason, byId: session.user.id,
      summary: `Évaluation « ${label(row.evaluation)} » du ${fmtDate(row.evaluatedOn)} annulée`,
      details: diffFields(
        { evaluation: req.evaluation, evaluationNote: req.evaluationNote, lastEvaluatedOn: req.lastEvaluatedOn },
        next, { evaluation: 'Évaluation', evaluationNote: 'Précision', lastEvaluatedOn: 'Dernière évaluation' },
        (v) => (v == null || v === '' ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmtDate(String(v)) : label(String(v))),
      ),
    });
    return true;
  });
  if (!done) return { error: 'Évaluation déjà annulée.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(req.id) };
}

/** Archive une exigence (texte abrogé) : motif obligatoire, historique et action liée conservés, retirée de la une. */
export async function archiveRequirement(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireWatchManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const reason = f.reason();
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
  const reason = f.reason();
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
  requirementId: 'Exigence', equipmentCode: 'Code équipement', category: 'Nature', tolerance: 'Tolérance (EMT)',
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
  // Code commun avec les moyens d'essais de Crucible (vue pub_controles) : facultatif, non unique (un équipement, plusieurs contrôles).
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
  // Code commun avec les moyens d'essais de Crucible (vue pub_controles) : facultatif, non unique (un équipement porte
  // plusieurs contrôles) ; champ absent du formulaire à la modification : code conservé.
  const equipmentCode = before && !fd.has('equipmentCode') ? before.equipmentCode : normalizeEquipmentCode(f.opt('equipmentCode'));
  const codeError = equipmentCodeError(equipmentCode);
  if (codeError) f.fail('equipmentCode', codeError);
  // VEI-14 : nature du contrôle (vérification réglementaire ou étalonnage) et tolérance ; champs absents : valeurs conservées.
  const category = fd.has('category') ? f.oneOf('category', CONTROL_CATEGORY_KEYS) ?? 'reglementaire' : before?.category ?? 'reglementaire';
  const tolerance = fd.has('tolerance') ? f.str('tolerance', { max: 120 }) || null : before?.tolerance ?? null;
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

  const values = { equipment, equipmentCode, controlType, periodMonths: periodMonths!, organization, responsibleId, siteId, requirementId, lastOn: lastOn!, nextOn: nextOn!, reserves, category, tolerance };
  let savedId = id;
  if (before) {
    const cat = (k: string) => CONTROL_CATEGORIES[k as keyof typeof CONTROL_CATEGORIES]?.short ?? k;
    const details = diffFields(
      { ...(await withNames(before, ['responsibleId'])), category: cat(before.category) },
      { ...(await withNames({ ...before, ...values }, ['responsibleId'])), category: cat(values.category) }, CTRL_LABELS, fmtLog,
    );
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      await assertFresh(tx, 'control', before.id, fd.get(VERSION_FIELD));
      await tx.update(t.controls).set(values).where(eq(t.controls.id, before.id));
      if (details.length) await logChange(tx, { entityType: 'control', entityId: before.id, action: 'update', summary: 'Contrôle modifié', details });
    }));
    if (stale) return { error: stale };
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

/** Réponse de recordControl : `notice` quand la non-conformité d'un étalonnage hors tolérance n'a pas pu être ouverte d'office. */
export type RecordControlState = FormState & { notice?: string; eventId?: string };

/**
 * VEI-14 : non-conformité ouverte par un étalonnage hors tolérance (ISO 9001 §7.1.5.2 : évaluer la validité des résultats
 * de mesure antérieurs) — événement NC à l'étape « Déclaré », rattaché à l'équipement (events.control_id) et à
 * l'enregistrement (control_records.event_id), déclaré par la personne qui saisit le contrôle ; journal de l'événement et du
 * contrôle dans la même transaction. Équipement commun à tous les sites (sans site) : aucune NC d'office (un événement porte
 * un site), `notice` invite à la déclarer.
 */
async function openOutOfToleranceNc(
  control: typeof t.controls.$inferSelect, record: { id: number; performedOn: string; organization: string; notes: string | null },
  user: { id: string; name: string },
): Promise<string | null> {
  if (!control.siteId) return null;
  const db = await getDb();
  const siteId = control.siteId;
  return db.transaction(async (tx) => {
    const id = await nextEntityReference(tx, 'event', `EV-${today().slice(0, 4)}-`);
    const equipment = control.equipment.split(' — ')[0];
    await tx.insert(t.events).values({
      id, siteId, type: 'NC', step: 0, severity: 2, anonymous: false,
      title: `Équipement de mesure hors tolérance — ${equipment}`.slice(0, 160),
      occurredOn: record.performedOn, location: control.equipment.slice(0, 120),
      declarant: user.name, declarantId: user.id, controlId: control.id, equipment: control.equipment.slice(0, 160),
      isoClause: '7.1.5 Monitoring and measuring resources',
      description: [
        `${control.controlType} du ${fmtDate(record.performedOn)} par ${record.organization} : résultat hors tolérance${control.tolerance ? ` (tolérance : ${control.tolerance})` : ''}.`,
        record.notes ?? '',
        'Évaluer la validité des mesures réalisées depuis le dernier étalonnage conforme et décider du traitement (ISO 9001 §7.1.5.2).',
      ].filter(Boolean).join('\n'),
    });
    await tx.update(t.controlRecords).set({ eventId: id }).where(eq(t.controlRecords.id, record.id));
    await logChange(tx, { entityType: 'event', entityId: id, action: 'create', byId: user.id, summary: `Non-conformité ouverte par l'étalonnage hors tolérance du ${fmtDate(record.performedOn)} (${equipment})` });
    await logChange(tx, { entityType: 'control', entityId: control.id, action: 'link', byId: user.id, summary: `Non-conformité ${id} ouverte : étalonnage hors tolérance du ${fmtDate(record.performedOn)}` });
    return id;
  });
}

/**
 * Enregistre un contrôle réalisé (historique + rapport joint). S'il est le plus récent,
 * il met à jour le contrôle : dernier = date, prochain = date + périodicité, réserves (l'état précédent est conservé
 * sur l'enregistrement pour pouvoir l'annuler). De nouvelles réserves détachent l'action de levée des précédentes.
 * Résultat proposé selon la nature du contrôle (controlResultsFor) ; un étalonnage hors tolérance ouvre une NC (VEI-14).
 */
export async function recordControl(_prev: FormState, fd: FormData): Promise<RecordControlState> {
  const { session, error } = await requireWatchManager();
  if (error) return { error };
  const f = formReader(fd);
  const controlId = f.int('controlId', { required: true });
  const performedOn = f.date('performedOn', { required: true });
  const organization = f.str('organization', { required: true, max: 120 });
  const reserves = f.str('reserves', { max: 160 }) || null;
  const notes = f.str('notes', { max: 2000 }) || null;
  // VEI-11 : résultat du contrôle (avis de l'organisme) ; « avec réserves » exige les réserves, « favorable » n'en porte pas.
  const result = f.oneOf('result', CONTROL_RESULT_KEYS, { required: true });
  if (result === 'reserves' && !reserves) f.fail('reserves', 'Précisez les réserves émises.');
  if (result === 'favorable' && reserves) f.fail('result', 'Réserves saisies : choisissez « Favorable avec réserves », ou retirez les réserves.');
  const files = f.files('report');
  if (performedOn && performedOn > today()) f.fail('performedOn', 'Enregistrez le contrôle une fois réalisé (date future).');
  await checkFiles(f, 'report', files, session.user.id);
  if (!f.ok) return f.state();

  const { control, error: ctrlError } = await loadControlForEdit(controlId!);
  if (!control) return { error: ctrlError };
  if (result && !controlResultsFor(control.category).includes(result)) {
    return { error: 'Certains champs sont à corriger.', fieldErrors: { result: `Résultat non proposé pour un contrôle « ${CONTROL_CATEGORIES[control.category as keyof typeof CONTROL_CATEGORIES]?.short ?? control.category} ».` } };
  }
  const db = await getDb();
  const latest = performedOn! >= control.lastOn;
  // Réserves différentes : « Lever les réserves » réapparaît, l'ancienne action reste dans le plan d'actions.
  const actionId = latest && reserves !== control.reserves ? null : control.actionId;

  const recordId = await db.transaction(async (tx) => {
    const [rec] = await tx.insert(t.controlRecords).values({
      controlId: control.id, performedOn: performedOn!, organization, reserves, notes, result, recordedById: session.user.id,
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
    summary: `Contrôle du ${fmtDate(performedOn!)} enregistré · ${result ? CONTROL_RESULTS[result].label.toLowerCase() : ''}${latest ? '' : " dans l'historique (antérieur au dernier)"}`,
    details: latest ? diffFields(control, { lastOn: performedOn!, reserves }, { lastOn: 'Dernier contrôle', reserves: 'Réserves' }, fmtLog) : [],
  });
  // Nouvelles réserves : l'action de levée des précédentes est détachée du contrôle (elle reste au plan) ; son historique
  // le trace (ACT-03), une fois l'enregistrement définitif (rapport stocké).
  if (control.actionId && actionId !== control.actionId) await logControlDetach(null, control, control.actionId, `nouvelles réserves au contrôle du ${fmtDate(performedOn!)}`, session.user.id);
  // VEI-14 : étalonnage hors tolérance → non-conformité (après le rapport stocké : l'enregistrement est définitif).
  if (result === 'hors_tolerance') {
    const eventId = await openOutOfToleranceNc(control, { id: recordId, performedOn: performedOn!, organization, notes }, session.user);
    revalidatePath('/', 'layout');
    return eventId
      ? { ok: true, id: String(recordId), eventId, notice: `Contrôle enregistré · non-conformité ${eventId} ouverte (étalonnage hors tolérance).` }
      : { ok: true, id: String(recordId), notice: 'Contrôle enregistré · équipement commun à tous les sites : déclarez la non-conformité depuis l’écran Événements.' };
  }
  revalidatePath('/', 'layout');
  return { ok: true, id: String(recordId) };
}

/** Archive un contrôle (équipement réformé) : motif obligatoire, historique conservé. */
export async function archiveControl(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireWatchManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const reason = f.reason();
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
  const reason = f.reason();
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
  const reason = f.reason();
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

// ─── Registre de sécurité : observations et mises en demeure (VEI-15) ───────

const NOTICE_LABELS = {
  kind: 'Nature', receivedOn: 'Reçue le', authority: 'Émetteur', reference: 'Référence', text: 'Objet', dueOn: 'Délai de réponse', controlId: 'Équipement',
} as const;
const CANCELLED_NOTICE = 'Observation annulée : elle reste au registre en consultation seule.';

/** Observation ou mise en demeure chargée pour une écriture : existante, du périmètre (site), non annulée. */
async function loadNoticeForEdit(id: number) {
  const db = await getDb();
  const [notice] = await db.select().from(t.safetyNotices).where(eq(t.safetyNotices.id, id));
  if (!notice) return { notice: null, error: 'Observation introuvable.' };
  const siteError = await requireInSite(notice.siteId);
  if (siteError) return { notice: null, error: siteError };
  if (notice.cancelledAt) return { notice: null, error: CANCELLED_NOTICE };
  return { notice, error: null };
}

/**
 * Inscrit ou modifie une observation ou une mise en demeure au registre de sécurité du site (L. 4711-1) : émetteur
 * (inspection du travail, CARSAT, organisme), date de réception, objet, délai de réponse, équipement concerné (contrôle du
 * même site, facultatif). Encadrement qui saisit la veille ; site du périmètre (`requireInSite`, création ou changement de
 * site). Journal `safety_notice` dans la transaction.
 */
export async function saveSafetyNotice(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireWatchManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { min: 1 });
  const kind = f.oneOf('kind', SAFETY_NOTICE_KIND_KEYS, { required: true });
  const siteId = f.str('siteId', { required: true });
  const receivedOn = f.date('receivedOn', { required: true });
  const authority = f.str('authority', { required: true, max: 120 });
  const reference = f.str('reference', { max: 60 }) || null;
  const text = f.str('text', { required: true, max: 2000 });
  const dueOn = f.date('dueOn');
  const controlId = f.int('controlId', { min: 1 });
  if (receivedOn && receivedOn > today()) f.fail('receivedOn', 'Date de réception postérieure à aujourd’hui.');
  if (receivedOn && dueOn && dueOn < receivedOn) f.fail('dueOn', 'Le délai de réponse suit la réception.');
  if (!f.ok) return f.state();

  const before = id ? await loadNoticeForEdit(id) : null;
  if (before?.error) return { error: before.error };
  const current = before?.notice ?? null;
  if (!current || current.siteId !== siteId) {
    const siteError = await requireInSite(siteId, { create: true });
    if (siteError) return { error: siteError, fieldErrors: { siteId: 'Site non autorisé.' } };
  }
  const db = await getDb();
  if (controlId && controlId !== current?.controlId) {
    const [ctrl] = await db.select({ siteId: t.controls.siteId, archivedAt: t.controls.archivedAt }).from(t.controls).where(eq(t.controls.id, controlId));
    if (!ctrl || (ctrl.siteId && ctrl.siteId !== siteId)) f.fail('controlId', 'Équipement inconnu sur ce site.');
    else if (ctrl.archivedAt) f.fail('controlId', 'Équipement réformé : choisissez un contrôle en service.');
    if (!f.ok) return f.state();
  }
  const values = { kind: kind!, siteId, receivedOn: receivedOn!, authority, reference, text, dueOn, controlId };
  const kindLabel = SAFETY_NOTICE_KINDS[values.kind].label;
  let savedId = id;
  if (current) {
    const label = (k: string) => SAFETY_NOTICE_KINDS[k as keyof typeof SAFETY_NOTICE_KINDS]?.label ?? k;
    const details = diffFields({ ...current, kind: label(current.kind) }, { ...current, ...values, kind: label(values.kind) }, NOTICE_LABELS, fmtLog);
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      await assertFresh(tx, 'safety_notice', current.id, fd.get(VERSION_FIELD));
      await tx.update(t.safetyNotices).set(values).where(eq(t.safetyNotices.id, current.id));
      if (details.length) await logChange(tx, { entityType: 'safety_notice', entityId: current.id, action: 'update', byId: session.user.id, summary: `${kindLabel} modifiée`, details });
    }));
    if (stale) return { error: stale };
  } else {
    savedId = await db.transaction(async (tx) => {
      const [row] = await tx.insert(t.safetyNotices).values({ ...values, createdById: session.user.id }).returning({ id: t.safetyNotices.id });
      await logChange(tx, { entityType: 'safety_notice', entityId: row.id, action: 'create', byId: session.user.id, summary: `${kindLabel} (${authority}) inscrite au registre de sécurité` });
      return row.id;
    });
  }
  revalidatePath('/', 'layout');
  return { ok: true, id: String(savedId) };
}

/**
 * Réponse apportée à une observation ou une mise en demeure (mise en conformité, courrier de réponse) : date et texte
 * obligatoires ; une nouvelle réponse remplace la précédente, l'ancienne reste au journal.
 */
export async function answerSafetyNotice(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireWatchManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const answeredOn = f.date('answeredOn', { required: true });
  const answer = f.str('answer', { required: true, max: 2000 });
  if (answeredOn && answeredOn > today()) f.fail('answeredOn', 'Date postérieure à aujourd’hui.');
  if (!f.ok) return f.state();
  const { notice, error: noticeError } = await loadNoticeForEdit(id!);
  if (!notice) return { error: noticeError };
  if (answeredOn! < notice.receivedOn) return { error: 'Certains champs sont à corriger.', fieldErrors: { answeredOn: 'La réponse suit la réception.' } };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.safetyNotices).set({ answeredOn, answer, answeredById: session.user.id }).where(eq(t.safetyNotices.id, notice.id));
    await logChange(tx, {
      entityType: 'safety_notice', entityId: notice.id, action: 'answer', byId: session.user.id,
      summary: `Réponse du ${fmtDate(answeredOn!)} enregistrée`,
      details: diffFields(notice, { answeredOn, answer }, { answeredOn: 'Réponse le', answer: 'Réponse' }, fmtLog),
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(notice.id) };
}

/** Annule une observation saisie par erreur (motif obligatoire, jamais supprimée) : animateur QHSE et direction. */
export async function cancelSafetyNotice(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { notice, error: noticeError } = await loadNoticeForEdit(id!);
  if (!notice) return { error: noticeError };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.safetyNotices).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.safetyNotices.id, notice.id));
    await logChange(tx, { entityType: 'safety_notice', entityId: notice.id, action: 'cancel', byId: session.user.id, reason, summary: `${SAFETY_NOTICE_KINDS[notice.kind as keyof typeof SAFETY_NOTICE_KINDS]?.label ?? 'Observation'} annulée` });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(notice.id) };
}
