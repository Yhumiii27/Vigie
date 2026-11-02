'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { fmtDate } from '@/lib/dates';
import { isClosedActionStatus } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireEditor, requireInSite } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import {
  FACILITATOR_EXTERNAL_MAX, LINK_REQUIRED, REPORT_REF_MAX, STUDY_CONCLUSIONS, STUDY_CONCLUSION_KEYS, STUDY_MILESTONES, STUDY_MILESTONE_KEYS, STUDY_STATUS,
  STUDY_TYPES, STUDY_TYPE_KEYS, STUDY_REF_PREFIX, capexCodeError, projectCodeError, studyFieldErrors, studyTypeError,
  type StoredStudyStatus, type StudyConclusion, type StudyMilestone, type StudyType,
} from '@/lib/rules/process-safety';
import { today } from '@/lib/today';
import { diffFields, logChange } from './changelog';
import { nextEntityReference } from './references';
import { STALE_EDIT, VERSION_FIELD, staleEditError } from './versions';

// Études de sécurité des procédés (VG-01 à VG-05, demande d'Arche du 01/11/2026 ; CNF-12 à CNF-14). Saisie, validation,
// réouverture et annulation : animateur QHSE et direction (requireEditor('risks', { approver: true })), étude du site
// sélectionné et du périmètre (requireInSite ; création ou changement de site : { create: true }). Réserve bloquante d'une
// recommandation (action QSE rattachée) : posée ou levée (motif) par les mêmes, journalisée sur l'étude et sur l'action
// (ACT-03). Jamais de suppression ; journal `process_safety_study` dans la transaction de chaque écriture.

const ENTITY = 'process_safety_study';
const NOT_FOUND = 'Étude de sécurité introuvable.';
const CANCELLED = 'Étude annulée : elle reste consultable avec son historique.';
const TO_FIX = 'Certains champs sont à corriger.';
const STUDY_SITE_LOCKED = 'L’étude porte des recommandations : elle ne change plus de site.';

const requireStudyEditor = () => requireEditor('risks', { approver: true });

/** Étude chargée pour une écriture : existante, du site sélectionné et du périmètre ; annulée refusée. */
async function loadForWrite(id: string | null) {
  if (!id) return { s: null, error: NOT_FOUND };
  const db = await getDb();
  const [s] = await db.select().from(t.processSafetyStudies).where(eq(t.processSafetyStudies.id, id));
  if (!s) return { s: null, error: NOT_FOUND };
  const siteError = await requireInSite(s.siteId);
  if (siteError) return { s: null, error: siteError };
  if (s.cancelledAt) return { s: null, error: CANCELLED };
  return { s, error: null };
}

const LABELS = {
  site: 'Site', capexCode: 'Code CAPEX', keystoneProjectCode: 'Projet EPC2i', milestone: 'Jalon', type: 'Type', status: 'Statut',
  sessionOn: 'Séance', facilitator: 'Animateur', reportRef: 'Rapport (Codex)', scope: 'Périmètre et objet',
} as const;

type Shown = Record<keyof typeof LABELS, string | null>;

/**
 * Crée ou modifie une étude : site, code CAPEX (« CPX-… ») et / ou projet EPC2i (au moins un), jalon et type compatibles,
 * statut planifiée ou réalisée (la validation passe par « Valider », la réouverture par « Rouvrir » motivé : une étude
 * validée garde son statut et sa conclusion ici), date de séance, animateur (personne présente — ou celle déjà
 * enregistrée — ou intervenant extérieur, l'un ou l'autre), référence Codex du rapport, périmètre. Modification : contrôle
 * de version (QUA-12) ; dates contrôlées sur les seules valeurs modifiées.
 */
export async function saveProcessSafetyStudy(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireStudyEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const siteId = f.str('siteId', { required: true });
  const capexCode = f.str('capexCode', { max: 44 }).toUpperCase() || null;
  const projectCode = f.str('keystoneProjectCode', { max: 40 }).toUpperCase() || null;
  const milestone = f.oneOf('milestone', STUDY_MILESTONE_KEYS, { required: true });
  const type = f.oneOf('type', STUDY_TYPE_KEYS, { required: true });
  const askedStatus = f.oneOf('status', ['planifiee', 'realisee'] as const);
  const sessionOn = f.date('sessionOn', { required: true });
  const facilitatorId = f.opt('facilitatorId');
  const facilitatorExternal = f.str('facilitatorExternal', { max: FACILITATOR_EXTERNAL_MAX }) || null;
  const reportRef = f.str('reportRef', { max: REPORT_REF_MAX }) || null;
  const scope = f.str('scope', { max: 2000 });
  const capexError = capexCodeError(capexCode);
  if (capexError) f.fail('capexCode', capexError);
  const projectError = projectCodeError(projectCode);
  if (projectError) f.fail('keystoneProjectCode', projectError);
  if (!capexCode && !projectCode) f.fail('capexCode', LINK_REQUIRED);
  if (milestone && type) {
    const typeError = studyTypeError(milestone, type);
    if (typeError) f.fail('type', typeError);
  }
  if (facilitatorId && facilitatorExternal) f.fail('facilitatorExternal', 'Une personne de l’effectif ou un intervenant extérieur, pas les deux.');
  if (!f.ok) return f.state();
  const loaded = id ? await loadForWrite(id) : null;
  if (loaded?.error) return { error: loaded.error };
  const current = loaded?.s ?? null;
  const status: StoredStudyStatus = current?.status === 'validee' ? 'validee' : askedStatus ?? 'planifiee';
  const now = today();
  const dateErrors = studyFieldErrors(
    { status, sessionOn, validatedOn: current?.validatedOn ?? null, conclusion: (current?.conclusion as StudyConclusion | null) ?? null },
    now, { sessionOn: !current || sessionOn !== current.sessionOn || status !== current.status, validatedOn: false },
  );
  if (Object.keys(dateErrors).length) return { error: TO_FIX, fieldErrors: dateErrors };
  if (!current || current.siteId !== siteId) {
    const siteError = await requireInSite(siteId, { create: true });
    if (siteError) return { error: siteError, fieldErrors: { siteId: siteError } };
  }
  const db = await getDb();
  // Comme le déplacement d'un risque (DUE-14) : les recommandations gardent leur site, l'étude ne change donc plus de site
  // dès qu'elle en porte une.
  if (current && current.siteId !== siteId) {
    const [rec] = await db.select({ id: t.actions.id }).from(t.actions).where(eq(t.actions.safetyStudyId, current.id)).limit(1);
    if (rec) return { error: TO_FIX, fieldErrors: { siteId: STUDY_SITE_LOCKED } };
  }
  const [people, sites] = await Promise.all([
    db.select({ id: t.people.id, name: t.people.name, leftOn: t.people.leftOn }).from(t.people),
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
  ]);
  if (facilitatorId) {
    const p = people.find((x) => x.id === facilitatorId);
    if (!p) return { error: TO_FIX, fieldErrors: { facilitatorId: 'Choisissez une personne de la liste.' } };
    if (hasLeft(p, now) && facilitatorId !== current?.facilitatorId) return { error: TO_FIX, fieldErrors: { facilitatorId: "Personne sortie de l'effectif : choisissez une personne présente." } };
  }
  const values = {
    siteId, capexCode, keystoneProjectCode: projectCode, milestone: milestone!, type: type!, status, sessionOn: sessionOn!,
    facilitatorId, facilitatorExternal, reportRef, scope,
  };
  const byId = session.user.id;
  const name = (pid: string | null) => (pid ? people.find((p) => p.id === pid)?.name ?? pid : null);
  const shown = (v: typeof values): Shown => ({
    site: sites.find((s) => s.id === v.siteId)?.label.split(' — ')[0] ?? v.siteId,
    capexCode: v.capexCode, keystoneProjectCode: v.keystoneProjectCode,
    milestone: STUDY_MILESTONES[v.milestone as StudyMilestone]?.label ?? v.milestone, type: STUDY_TYPES[v.type as StudyType]?.label ?? v.type,
    status: STUDY_STATUS[v.status as StoredStudyStatus]?.label ?? v.status, sessionOn: v.sessionOn ? fmtDate(v.sessionOn) : null,
    facilitator: name(v.facilitatorId) ?? v.facilitatorExternal, reportRef: v.reportRef, scope: v.scope,
  });
  if (current) {
    const res = await db.transaction(async (tx) => {
      if (await staleEditError(tx, ENTITY, current.id, fd.get(VERSION_FIELD))) return 'stale' as const;
      await tx.update(t.processSafetyStudies).set(values).where(eq(t.processSafetyStudies.id, current.id));
      const details = diffFields(shown(current as typeof values), shown(values), LABELS);
      if (details.length) await logChange(tx, { entityType: ENTITY, entityId: current.id, action: 'update', byId, summary: 'Étude de sécurité modifiée', details });
      return 'ok' as const;
    });
    if (res === 'stale') return { error: STALE_EDIT };
    revalidatePath('/', 'layout');
    return { ok: true, id: current.id };
  }
  const newId = await db.transaction(async (tx) => {
    const ref = await nextEntityReference(tx, 'process_safety_study', STUDY_REF_PREFIX, 3);
    await tx.insert(t.processSafetyStudies).values({ id: ref, ...values, createdById: byId });
    await logChange(tx, {
      entityType: ENTITY, entityId: ref, action: 'create', byId,
      summary: `Étude ${STUDY_TYPES[values.type].label} (jalon ${STUDY_MILESTONES[values.milestone].label}) ${status === 'planifiee' ? 'planifiée le' : 'tenue le'} ${fmtDate(values.sessionOn)}`,
    });
    return ref;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: newId };
}

/**
 * Valide une étude tenue (« Valider ») : date de validation (pas avant la séance ni après aujourd'hui), conclusion
 * (favorable, avec réserves, défavorable) et, facultative, la référence Codex du rapport. Séance passée exigée ; contrôle de
 * version (QUA-12).
 */
export async function validateProcessSafetyStudy(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireStudyEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const validatedOn = f.date('validatedOn', { required: true });
  const conclusion = f.oneOf('conclusion', STUDY_CONCLUSION_KEYS, { required: true });
  const reportField = f.has('reportRef');
  const reportRef = f.str('reportRef', { max: REPORT_REF_MAX }) || null;
  if (!f.ok) return f.state();
  const { s, error: loadError } = await loadForWrite(id);
  if (!s) return { error: loadError };
  if (s.status === 'validee') return { error: 'Étude déjà validée : rouvrez-la (motif) pour changer sa conclusion.' };
  const errors = studyFieldErrors({ status: 'validee', sessionOn: s.sessionOn, validatedOn, conclusion }, today(), { sessionOn: true, validatedOn: true });
  if (errors.sessionOn) return { error: 'Séance à venir : l’étude ne peut pas encore être validée.' };
  if (Object.keys(errors).length) return { error: TO_FIX, fieldErrors: errors };
  const db = await getDb();
  const nextReport = reportField ? reportRef : s.reportRef;
  const res = await db.transaction(async (tx) => {
    if (await staleEditError(tx, ENTITY, s.id, fd.get(VERSION_FIELD))) return 'stale' as const;
    await tx.update(t.processSafetyStudies).set({ status: 'validee', validatedOn, conclusion, reportRef: nextReport }).where(eq(t.processSafetyStudies.id, s.id));
    await logChange(tx, {
      entityType: ENTITY, entityId: s.id, action: 'validate', byId: session.user.id,
      summary: `Étude validée le ${fmtDate(validatedOn!)} : ${STUDY_CONCLUSIONS[conclusion!].label.toLowerCase()}`,
      details: [
        { field: 'Statut', from: STUDY_STATUS[s.status as StoredStudyStatus].label, to: STUDY_STATUS.validee.label },
        { field: 'Conclusion', from: null, to: STUDY_CONCLUSIONS[conclusion!].label },
        ...(nextReport !== s.reportRef ? [{ field: 'Rapport (Codex)', from: s.reportRef, to: nextReport }] : []),
      ],
    });
    return 'ok' as const;
  });
  if (res === 'stale') return { error: STALE_EDIT };
  revalidatePath('/', 'layout');
  return { ok: true, id: s.id };
}

/** Rouvre une étude validée (conclusion à revoir, validation saisie par erreur) : motif obligatoire ; retour à « réalisée ». */
export async function reopenProcessSafetyStudy(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireStudyEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { s, error: loadError } = await loadForWrite(id);
  if (!s) return { error: loadError };
  if (s.status !== 'validee') return { error: 'Seule une étude validée se rouvre.' };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.processSafetyStudies).set({ status: 'realisee', validatedOn: null, conclusion: null }).where(eq(t.processSafetyStudies.id, s.id));
    await logChange(tx, {
      entityType: ENTITY, entityId: s.id, action: 'reopen', reason, byId: session.user.id, summary: 'Étude rouverte',
      details: [
        { field: 'Statut', from: STUDY_STATUS.validee.label, to: STUDY_STATUS.realisee.label },
        { field: 'Conclusion', from: s.conclusion ? STUDY_CONCLUSIONS[s.conclusion as StudyConclusion].label : null, to: null },
        { field: 'Validée le', from: s.validatedOn ? fmtDate(s.validatedOn) : null, to: null },
      ],
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: s.id };
}

/**
 * Annule une étude (saisie par erreur, étude abandonnée avec le CAPEX) : motif obligatoire, jamais supprimée ; ses
 * recommandations restent au plan d'actions avec leur lien (une étude annulée ne compte plus pour le jalon).
 */
export async function cancelProcessSafetyStudy(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireStudyEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { s, error: loadError } = await loadForWrite(id);
  if (!s) return { error: loadError };
  const db = await getDb();
  const done = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.processSafetyStudies).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason })
      .where(and(eq(t.processSafetyStudies.id, s.id), isNull(t.processSafetyStudies.cancelledAt))).returning({ id: t.processSafetyStudies.id });
    if (!row) return false;
    await logChange(tx, { entityType: ENTITY, entityId: s.id, action: 'cancel', reason, byId: session.user.id, summary: 'Étude annulée' });
    return true;
  });
  if (!done) return { error: CANCELLED };
  revalidatePath('/', 'layout');
  return { ok: true, id: s.id };
}

/**
 * Recommandation (action QSE rattachée à l'étude) chargée pour un changement de sa réserve bloquante : action de l'étude,
 * ouverte (ni vérifiée ni abandonnée : une recommandation close ne bloque plus), étude non annulée du site sélectionné.
 */
async function loadRecommendation(actionId: string | null) {
  if (!actionId) return { a: null, s: null, error: 'Recommandation introuvable.' };
  const db = await getDb();
  const [a] = await db.select({ id: t.actions.id, status: t.actions.status, studyId: t.actions.safetyStudyId, blocking: t.actions.safetyStudyBlocking })
    .from(t.actions).where(eq(t.actions.id, actionId));
  if (!a?.studyId) return { a: null, s: null, error: 'Recommandation introuvable.' };
  const { s, error } = await loadForWrite(a.studyId);
  if (!s) return { a: null, s: null, error };
  if (isClosedActionStatus(a.status)) return { a: null, s: null, error: `L'action ${a.id} est vérifiée ou abandonnée : sa réserve ne bloque plus le jalon.` };
  return { a, s, error: null };
}

/** Écrit la réserve bloquante d'une recommandation, journalisée sur l'étude et sur l'action (ACT-03). */
async function writeBlocking(a: { id: string }, s: { id: string }, blocking: boolean, byId: string, reason?: string) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.actions).set({ safetyStudyBlocking: blocking }).where(eq(t.actions.id, a.id));
    const details = [{ field: 'Réserve bloquante', from: blocking ? 'non' : 'oui', to: blocking ? 'oui' : 'non' }];
    await logChange(tx, {
      entityType: ENTITY, entityId: s.id, action: blocking ? 'blocking' : 'lift', byId, reason,
      summary: blocking ? `Recommandation ${a.id} marquée réserve bloquante` : `Réserve bloquante ${a.id} levée`, details,
    });
    await logChange(tx, {
      entityType: 'action', entityId: a.id, action: 'update', byId, reason,
      summary: blocking ? `Réserve bloquante de l'étude ${s.id}` : `Réserve bloquante de l'étude ${s.id} levée`, details,
    });
  });
  revalidatePath('/', 'layout');
}

/** Marque une recommandation ouverte « réserve bloquante » du jalon de son étude (QHSE). */
export async function markStudyReserve(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireStudyEditor();
  if (error) return { error };
  const { a, s, error: loadError } = await loadRecommendation(formReader(fd).opt('actionId'));
  if (!a || !s) return { error: loadError };
  if (a.blocking) return { error: 'Réserve déjà bloquante.' };
  await writeBlocking(a, s, true, session.user.id);
  return { ok: true, id: s.id };
}

/** Lève la réserve bloquante d'une recommandation encore ouverte (motif obligatoire : décision de la SSE, mesure compensatoire…). */
export async function liftStudyReserve(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireStudyEditor();
  if (error) return { error };
  const f = formReader(fd);
  const actionId = f.opt('actionId');
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { a, s, error: loadError } = await loadRecommendation(actionId);
  if (!a || !s) return { error: loadError };
  if (!a.blocking) return { error: 'Cette recommandation n’est pas une réserve bloquante.' };
  await writeBlocking(a, s, false, session.user.id, reason);
  return { ok: true, id: s.id };
}
