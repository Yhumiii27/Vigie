'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { isQhse } from '@/lib/action-rules';
import { fmtDate } from '@/lib/dates';
import { QHSE_ONLY } from '@/lib/edit-rights';
import { formReader, type FormState } from '@/lib/forms';
import { requireEditor, requireInSite } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import { loadPeople } from '@/lib/queries';
import {
  ASSESSMENT_STANDARDS, ASSESSMENT_STANDARD_KEYS, CONFORMITY_LEVELS, CONFORMITY_LEVEL_KEYS, FINDING_MAX, HEADING_MAX, JUSTIFICATION_MAX,
  clauseError, closeAssessmentError, compareClauses, frozenAssessmentError, lineError, type ConformityLevel,
} from '@/lib/rules/self-assessment';
import { ALL_SITES } from '@/lib/session';
import { today } from '@/lib/today';
import { diffFields, logChange } from './changelog';
import { nextEntityReference } from './references';
import { VERSION_FIELD, assertFresh, freshWrite } from './versions';

// Auto-évaluation par référentiel (AUD-40, réponses du service QHSE du 09/11/2026). Catalogue des exigences : animateur QHSE
// seulement (intitulés, ajout, archivage et restauration motivés ; journal `assessment_requirement`). Campagnes : rôles qui
// saisissent sur l'écran Audits (requireEditor('audits') : animateur QHSE, direction), site de la campagne dans le site
// sélectionné et le périmètre (requireInSite ; « Tous les sites » = campagne d'entreprise, périmètre complet) ; brouillon
// modifiable, clôture (toutes les exigences évaluées) qui fige la campagne, annulation motivée d'un brouillon ; commentaires
// avant comme après la clôture. Journal `self_assessment` (en-tête, clôture, annulation, commentaires, preuves) et
// `self_assessment_line` (évaluation d'une exigence, version QUA-12 de la ligne), dans la transaction de chaque écriture.

const MISSING = 'Campagne d’auto-évaluation introuvable.';
const COMMENT_MAX = 2000;
const SCOPE_MAX = 400;
const CONCLUSION_MAX = 4000;

/** Catalogue des exigences : animateur QHSE seulement (sur un écran Audits ouvert en saisie). */
async function requireCatalogueEditor() {
  const { session, error } = await requireEditor('audits');
  if (error) return { session, error };
  return { session, error: isQhse(session.role) ? null : QHSE_ONLY };
}

const requireAssessmentEditor = () => requireEditor('audits');

/** Champ Site : « Tous les sites » (campagne d'entreprise) = null. */
const siteOf = (v: string) => (!v || v === ALL_SITES ? null : v);

async function loadAssessment(id: string) {
  const db = await getDb();
  const [a] = await db.select().from(t.selfAssessments).where(eq(t.selfAssessments.id, id));
  if (!a) return { db, a: null, error: MISSING } as const;
  const siteError = await requireInSite(a.siteId);
  if (siteError) return { db, a: null, error: siteError } as const;
  return { db, a, error: null } as const;
}

// ─── Catalogue des exigences ───────────────────────────────────────────────

/** Ajoute une exigence au catalogue d'un référentiel, ou modifie son intitulé (le numéro et le référentiel ne changent pas). */
export async function saveAssessmentRequirement(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireCatalogueEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { min: 1 });
  const heading = f.str('heading', { required: true, max: HEADING_MAX });
  const db = await getDb();
  if (id != null) {
    if (!f.ok) return f.state();
    const [before] = await db.select().from(t.assessmentRequirements).where(eq(t.assessmentRequirements.id, id));
    if (!before) return { error: 'Exigence introuvable.' };
    if (before.archivedAt) return { error: 'Exigence archivée : restaurez-la pour la modifier.' };
    const details = diffFields(before, { ...before, heading }, { heading: 'Intitulé' });
    if (!details.length) return { ok: true, id: String(id) };
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      await assertFresh(tx, 'assessment_requirement', id, fd.get(VERSION_FIELD));
      await tx.update(t.assessmentRequirements).set({ heading }).where(eq(t.assessmentRequirements.id, id));
      await logChange(tx, { entityType: 'assessment_requirement', entityId: id, action: 'update', byId: session.user.id, summary: `Intitulé de l’exigence ${before.clause} modifié`, details });
    }));
    if (stale) return { error: stale };
    revalidatePath('/', 'layout');
    return { ok: true, id: String(id), message: 'Exigence enregistrée.' };
  }
  const standard = f.oneOf('standard', ASSESSMENT_STANDARD_KEYS, { required: true });
  const clause = f.str('clause', { required: true, max: 12 });
  const clauseIssue = clause ? clauseError(clause) : null;
  if (clauseIssue) f.fail('clause', clauseIssue);
  if (!f.ok) return f.state();
  const [twin] = await db.select({ id: t.assessmentRequirements.id, archivedAt: t.assessmentRequirements.archivedAt }).from(t.assessmentRequirements)
    .where(and(eq(t.assessmentRequirements.standard, standard!), eq(t.assessmentRequirements.clause, clause)));
  if (twin) return { error: 'Certains champs sont à corriger.', fieldErrors: { clause: twin.archivedAt ? 'Article déjà au catalogue (archivé) : restaurez-le.' : 'Article déjà au catalogue.' } };
  const siblings = await db.select({ clause: t.assessmentRequirements.clause, sort: t.assessmentRequirements.sort }).from(t.assessmentRequirements)
    .where(eq(t.assessmentRequirements.standard, standard!));
  // Rang : juste après le dernier article qui le précède (ordre naturel des numéros).
  const before = siblings.filter((s) => compareClauses(s.clause, clause) < 0).sort((a, b) => b.sort - a.sort)[0];
  const sort = before ? before.sort + 1 : 0;
  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(t.assessmentRequirements).values({ standard: standard!, clause, heading, sort, createdById: session.user.id }).returning({ id: t.assessmentRequirements.id });
    await logChange(tx, { entityType: 'assessment_requirement', entityId: row.id, action: 'create', byId: session.user.id, summary: `Exigence ${clause} « ${heading} » ajoutée au catalogue ${ASSESSMENT_STANDARDS[standard!].short}` });
    return row.id;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(created), message: 'Exigence ajoutée au catalogue.' };
}

/** Archive (retire du catalogue des nouvelles campagnes) ou restaure une exigence, motif obligatoire. */
async function setRequirementArchived(f: ReturnType<typeof formReader>, reason: string, archive: boolean): Promise<FormState> {
  const { session, error } = await requireCatalogueEditor();
  if (error) return { error };
  const id = f.int('id', { required: true, min: 1 });
  if (!f.ok) return f.state();
  const db = await getDb();
  const [r] = await db.select().from(t.assessmentRequirements).where(eq(t.assessmentRequirements.id, id!));
  if (!r) return { error: 'Exigence introuvable.' };
  if (archive === !!r.archivedAt) return { error: archive ? 'Exigence déjà archivée.' : 'Exigence déjà au catalogue.' };
  await db.transaction(async (tx) => {
    await tx.update(t.assessmentRequirements)
      .set(archive ? { archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason } : { archivedAt: null, archivedById: null, archiveReason: null })
      .where(eq(t.assessmentRequirements.id, r.id));
    await logChange(tx, {
      entityType: 'assessment_requirement', entityId: r.id, action: archive ? 'archive' : 'restore', byId: session.user.id, reason,
      summary: archive ? `Exigence ${r.clause} retirée du catalogue (les campagnes existantes la gardent)` : `Exigence ${r.clause} restaurée au catalogue`,
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(r.id), message: archive ? 'Exigence archivée.' : 'Exigence restaurée.' };
}

export async function archiveAssessmentRequirement(_prev: FormState, fd: FormData): Promise<FormState> {
  const f = formReader(fd);
  return setRequirementArchived(f, f.reason(), true);
}

export async function restoreAssessmentRequirement(_prev: FormState, fd: FormData): Promise<FormState> {
  const f = formReader(fd);
  return setRequirementArchived(f, f.reason(), false);
}

// ─── Campagnes ─────────────────────────────────────────────────────────────

/**
 * Crée une campagne (référentiel, site ou toute l'entreprise, date, évaluateur, périmètre) ou modifie l'en-tête d'un
 * brouillon (date, évaluateur, périmètre, conclusion ; le référentiel et le site sont fixés à la création). À la création,
 * une ligne par exigence en vigueur du catalogue (numéro et intitulé recopiés).
 */
export async function saveSelfAssessment(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAssessmentEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const assessedOn = f.date('assessedOn', { required: true });
  const assessorId = f.str('assessorId', { required: true });
  const scope = f.str('scope', { max: SCOPE_MAX });
  const conclusion = f.str('conclusion', { max: CONCLUSION_MAX });
  if (assessedOn && assessedOn > today()) f.fail('assessedOn', 'Date à venir : saisissez la campagne une fois l’évaluation commencée.');
  const people = await loadPeople();
  const person = people.get(assessorId);
  if (!f.ok) return f.state();

  if (id) {
    const { db, a, error: loadError } = await loadAssessment(id);
    if (!a) return { error: loadError };
    const frozen = frozenAssessmentError(a);
    if (frozen) return { error: frozen };
    if ((!person || hasLeft(person, today())) && assessorId !== a.assessorId) return { error: 'Certains champs sont à corriger.', fieldErrors: { assessorId: 'Personne inconnue ou sortie de l’effectif.' } };
    const name = (pid: string) => people.get(pid)?.name ?? pid;
    const values = { assessedOn: assessedOn!, assessorId, scope, conclusion: f.has('conclusion') ? conclusion : a.conclusion };
    const details = diffFields({ ...a, assessorId: name(a.assessorId) }, { ...a, ...values, assessorId: name(values.assessorId) },
      { assessedOn: 'Date', assessorId: 'Évaluateur', scope: 'Périmètre', conclusion: 'Conclusion' }, (v) => (v == null || v === '' ? null : String(v)));
    if (!details.length) return { ok: true, id: a.id };
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      await assertFresh(tx, 'self_assessment', a.id, fd.get(VERSION_FIELD));
      await tx.update(t.selfAssessments).set(values).where(eq(t.selfAssessments.id, a.id));
      await logChange(tx, { entityType: 'self_assessment', entityId: a.id, action: 'update', byId: session.user.id, summary: 'Campagne modifiée', details });
    }));
    if (stale) return { error: stale };
    revalidatePath('/', 'layout');
    return { ok: true, id: a.id, message: 'Campagne enregistrée.' };
  }

  const standard = f.oneOf('standard', ASSESSMENT_STANDARD_KEYS, { required: true });
  const siteId = siteOf(f.str('siteId'));
  if (!f.ok) return f.state();
  if (!person || hasLeft(person, today())) return { error: 'Certains champs sont à corriger.', fieldErrors: { assessorId: 'Personne inconnue ou sortie de l’effectif.' } };
  const siteError = await requireInSite(siteId, { create: true });
  if (siteError) return { error: siteError, fieldErrors: { siteId: 'Site non autorisé.' } };
  const db = await getDb();
  const reqs = await db.select().from(t.assessmentRequirements)
    .where(and(eq(t.assessmentRequirements.standard, standard!), isNull(t.assessmentRequirements.archivedAt)))
    .orderBy(asc(t.assessmentRequirements.sort), asc(t.assessmentRequirements.id));
  if (!reqs.length) return { error: 'Aucune exigence au catalogue de ce référentiel.' };
  const ref = await db.transaction(async (tx) => {
    const newId = await nextEntityReference(tx, 'self_assessment', 'AE-', 3);
    await tx.insert(t.selfAssessments).values({ id: newId, standard: standard!, siteId, assessedOn: assessedOn!, assessorId, scope, conclusion, createdById: session.user.id });
    await tx.insert(t.selfAssessmentLines).values(reqs.map((r) => ({ assessmentId: newId, requirementId: r.id, clause: r.clause, heading: r.heading, sort: r.sort })));
    await logChange(tx, {
      entityType: 'self_assessment', entityId: newId, action: 'create', byId: session.user.id,
      summary: `Auto-évaluation ${ASSESSMENT_STANDARDS[standard!].short} du ${fmtDate(assessedOn!)} ouverte (${reqs.length} exigences)`,
    });
    return newId;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: ref, message: 'Campagne ouverte.' };
}

/** Évalue une exigence d'un brouillon : niveau, justification (exigée pour « non applicable » et « non conforme »), constat. */
export async function saveAssessmentLine(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAssessmentEditor();
  if (error) return { error };
  const f = formReader(fd);
  const lineId = f.int('lineId', { required: true, min: 1 });
  const level = f.oneOf('level', CONFORMITY_LEVEL_KEYS) as ConformityLevel | null;
  const justification = f.str('justification', { max: JUSTIFICATION_MAX });
  const finding = f.str('finding', { max: FINDING_MAX });
  const issue = lineError(level, justification);
  if (issue) f.fail('justification', issue);
  if (!f.ok) return f.state();
  const db = await getDb();
  const [line] = await db.select().from(t.selfAssessmentLines).where(eq(t.selfAssessmentLines.id, lineId!));
  if (!line) return { error: 'Exigence introuvable.' };
  const { a, error: loadError } = await loadAssessment(line.assessmentId);
  if (!a) return { error: loadError };
  const frozen = frozenAssessmentError(a);
  if (frozen) return { error: frozen };
  const label = (v: string | null) => (v ? CONFORMITY_LEVELS[v as ConformityLevel]?.label ?? v : null);
  const details = diffFields({ ...line, level: label(line.level) }, { ...line, level: label(level), justification, finding },
    { level: 'Niveau', justification: 'Justification', finding: 'Constat' }, (v) => (v == null || v === '' ? null : String(v)));
  if (!details.length) return { ok: true, id: String(line.id) };
  const stale = await freshWrite(() => db.transaction(async (tx) => {
    await assertFresh(tx, 'self_assessment_line', line.id, fd.get(VERSION_FIELD));
    await tx.update(t.selfAssessmentLines).set({ level, justification, finding, assessedById: session.user.id, assessedAt: new Date() }).where(eq(t.selfAssessmentLines.id, line.id));
    await logChange(tx, { entityType: 'self_assessment_line', entityId: line.id, action: 'update', byId: session.user.id, summary: `Exigence ${line.clause} évaluée (${a.id})`, details });
  }));
  if (stale) return { error: stale };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(line.id), message: `Exigence ${line.clause} enregistrée.` };
}

/** Clôture d'un brouillon dont toutes les exigences sont évaluées : la campagne est figée. */
export async function closeSelfAssessment(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAssessmentEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  if (!f.ok) return f.state();
  const { db, a, error: loadError } = await loadAssessment(id);
  if (!a) return { error: loadError };
  const frozen = frozenAssessmentError(a);
  if (frozen) return { error: frozen };
  const lines = await db.select({ level: t.selfAssessmentLines.level }).from(t.selfAssessmentLines).where(eq(t.selfAssessmentLines.assessmentId, a.id));
  const blocked = closeAssessmentError(lines);
  if (blocked) return { error: blocked };
  await db.transaction(async (tx) => {
    await tx.update(t.selfAssessments).set({ status: 'cloturee', closedAt: new Date(), closedById: session.user.id }).where(and(eq(t.selfAssessments.id, a.id), eq(t.selfAssessments.status, 'brouillon')));
    await logChange(tx, { entityType: 'self_assessment', entityId: a.id, action: 'status', byId: session.user.id, summary: 'Campagne clôturée (figée)' });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: a.id, message: 'Campagne clôturée.' };
}

/** Annule un brouillon saisi par erreur (motif) ; jamais supprimé, une campagne clôturée ne s'annule pas. */
export async function cancelSelfAssessment(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAssessmentEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { db, a, error: loadError } = await loadAssessment(id);
  if (!a) return { error: loadError };
  const frozen = frozenAssessmentError(a);
  if (frozen) return { error: frozen };
  await db.transaction(async (tx) => {
    await tx.update(t.selfAssessments).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.selfAssessments.id, a.id));
    await logChange(tx, { entityType: 'self_assessment', entityId: a.id, action: 'cancel', byId: session.user.id, reason, summary: 'Campagne annulée' });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: a.id, message: 'Campagne annulée.' };
}

/** Commentaire d'une campagne (avant ou après la clôture ; jamais sur une campagne annulée), jamais modifié ni supprimé. */
export async function addSelfAssessmentComment(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireAssessmentEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const body = f.str('body', { required: true, max: COMMENT_MAX });
  if (!f.ok) return f.state();
  const { db, a, error: loadError } = await loadAssessment(id);
  if (!a) return { error: loadError };
  if (a.cancelledAt) return { error: 'Campagne annulée : consultation seule.' };
  await db.transaction(async (tx) => {
    await tx.insert(t.selfAssessmentComments).values({ assessmentId: a.id, authorId: session.user.id, body });
    await logChange(tx, { entityType: 'self_assessment', entityId: a.id, action: 'comment', byId: session.user.id, summary: 'Commentaire ajouté', details: [{ field: 'Commentaire', from: null, to: body.slice(0, 200) }] });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: a.id, message: 'Commentaire ajouté.' };
}
