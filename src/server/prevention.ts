'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  EE_HEADCOUNT_MAX, MAX_PLAN_FILES, MEETING_PERIOD_MAX_DAYS, MEETING_PERIOD_MIN_DAYS, PLAN_CONTENT, PLAN_CONTENT_KEYS, PLAN_MEETING_KINDS, PLAN_MEETING_KIND_KEYS, activityLinkIssues, fullSignatureOn, isMandatory, isPlanEnded,
  permitDays, planEndIssue, planSignIssue, planStatus, signedBeforeStart, type PlanContentKey,
} from '@/components/prevention/model';
import { fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { formReader, type FormState } from '@/lib/forms';
import { requireInSite, requireManager } from '@/lib/guard';
import { checkUploadBatch, deleteAttachment, listAttachments, saveUpload } from '@/lib/uploads';
import { PLAN_ATTACHMENT } from '@/lib/data/prevention';
import { diffFields, logChange } from './changelog';
import { nextEntityReference } from './references';
import { STALE_EDIT, VERSION_FIELD, staleEditError } from './versions';
import { ARCHIVED_CONTRACTOR, done, isOpenPermit, linkedActivities, ok, siteRule, type Db, type Result } from './prevention-shared';

// Plans de prévention (QUA-26 : entreprises extérieures dans src/server/contractors.ts, permis dans src/server/permits.ts).

const ENDED_PLAN = (p: { status: string }) => (p.status === 'annule' ? 'Ce plan est annulé.' : 'Ce plan est clos.');

// ─── Plans de prévention ────────────────────────────────────────────────────

/** Champs dont la modification annule les signatures d'un plan (le plan modifié doit être signé à nouveau). */
const MATERIAL_FIELDS = ['siteId', 'contractorId', 'title', 'location', 'startOn', 'endOn', 'estimatedHours', 'dangerousWork', 'interferenceRisks', 'measures'] as const;
/**
 * Contenu réglementaire (PRV-02, R. 4511-10, R. 4512-8, R. 4512-9) : modifier une section déjà renseignée annule les
 * signatures ; compléter une section vide d'un plan signé (plan antérieur au contenu structuré) les conserve.
 */
const CONTENT_FIELDS = ['eeHeadcount', ...PLAN_CONTENT_KEYS] as const;

/**
 * Actions reprises rattachées au plan (actions.preventionPlanId, ACT-01), abandonnées comprises : un plan qui en porte une
 * est engagé (jamais supprimé). La Prévention ne crée plus d'action QSE (réponses du service QHSE du 15/10/2026).
 */
async function planActionIds(db: Db, planId: string) {
  const rows = await db.select({ id: t.actions.id }).from(t.actions).where(eq(t.actions.preventionPlanId, planId));
  return rows.map((r) => r.id).sort();
}

/** Crée ou modifie un plan de prévention ; le statut est dérivé (inspection commune, signatures). */
export async function savePlan(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  // « 1 200 » : séparateur de milliers usuel en français, accepté comme dans le formulaire.
  for (const name of ['estimatedHours', 'eeHeadcount']) {
    const raw = fd.get(name);
    if (typeof raw === 'string') fd.set(name, raw.replace(/\s/g, ''));
  }
  const now = today();
  const f = formReader(fd);
  const id = f.opt('id');
  const contractorId = f.str('contractorId', { required: true });
  const title = f.str('title', { required: true, max: 200 });
  const location = f.str('location', { required: true, max: 160 });
  const siteId = f.str('siteId', { required: true });
  const startOn = f.date('startOn', { required: true });
  const endOn = f.date('endOn', { required: true });
  const estimatedHours = f.int('estimatedHours', { required: true, min: 0, max: 100_000 });
  const dangerousWork = f.bool('dangerousWork');
  const keystoneProject = f.opt('keystoneProject');
  const inspectionOn = f.date('inspectionOn');
  const interferenceRisks = f.str('interferenceRisks', { max: 4000 });
  const measures = f.str('measures', { max: 4000 });
  const eeHeadcount = f.int('eeHeadcount', { min: 1, max: EE_HEADCOUNT_MAX });
  const content = Object.fromEntries(PLAN_CONTENT.map((c) => [c.key, f.str(c.key, { max: c.max })])) as Record<PlanContentKey, string>;
  const ownerId = f.opt('ownerId');
  if (startOn && endOn && endOn < startOn) f.fail('endOn', 'La fin ne peut pas précéder le début.');
  if (inspectionOn && endOn && inspectionOn > endOn) f.fail('inspectionOn', "L'inspection commune doit avoir lieu au plus tard le dernier jour de l'intervention.");

  const db = await getDb();
  const [contractors, sites, people, projects] = await Promise.all([
    db.select({ id: t.contractors.id, archivedAt: t.contractors.archivedAt }).from(t.contractors),
    db.select({ id: t.sites.id }).from(t.sites),
    db.select({ id: t.people.id }).from(t.people),
    db.select({ id: t.keystoneProjects.id, client: t.keystoneProjects.client }).from(t.keystoneProjects),
  ]);
  if (siteId && !sites.some((s) => s.id === siteId)) f.fail('siteId', 'Site inconnu.');
  if (ownerId && !people.some((p) => p.id === ownerId)) f.fail('ownerId', 'Personne inconnue.');

  const [existing] = id ? await db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, id)) : [];
  if (id && !existing) return { error: 'Plan de prévention introuvable.' };
  if (existing && isPlanEnded(existing)) return { error: 'Un plan clos ou annulé ne peut plus être modifié.' };
  const siteError = (existing ? await requireInSite(existing.siteId) : null)
    ?? (siteId && siteId !== existing?.siteId ? await requireInSite(siteId, { create: true }) : null);
  if (siteError) return { error: siteError };
  const contractor = contractors.find((c) => c.id === contractorId);
  if (contractorId && !contractor) f.fail('contractorId', 'Entreprise introuvable.');
  else if (contractor?.archivedAt && contractor.id !== existing?.contractorId) f.fail('contractorId', ARCHIVED_CONTRACTOR);
  const knownProject = !keystoneProject || keystoneProject === existing?.keystoneProject || projects.some((p) => `${p.id} · ${p.client}` === keystoneProject);
  if (!knownProject) f.fail('keystoneProject', 'Projet Keystone inconnu.');
  if (existing) {
    // Les permis actifs rattachés restent sur le site et l'entreprise du plan.
    const linked = (await db.select().from(t.permits).where(eq(t.permits.preventionPlanId, existing.id))).filter(isOpenPermit);
    const refs = (list: { id: string }[]) => list.map((p) => p.id).join(', ');
    const otherSite = linked.filter((p) => p.siteId !== siteId);
    const otherContractor = linked.filter((p) => p.contractorId && p.contractorId !== contractorId);
    if (siteId && otherSite.length) f.fail('siteId', `Permis actifs rattachés sur le site actuel (${refs(otherSite)}) : clôturez-les ou annulez-les avant de changer de site.`);
    if (contractorId && otherContractor.length) f.fail('contractorId', `Permis actifs rattachés pour cette entreprise (${refs(otherContractor)}) : clôturez-les ou annulez-les avant de changer d'entreprise.`);
    // La période du plan doit continuer de couvrir la validité des permis actifs rattachés.
    if (startOn && endOn && endOn >= startOn) {
      const days = linked.map((p) => ({ id: p.id, ...permitDays(p) }));
      const before = days.filter((d) => d.from < startOn);
      const after = days.filter((d) => d.to > endOn);
      if (before.length) f.fail('startOn', `Permis actifs rattachés avant cette date (${refs(before)}) : modifiez-les ou annulez-les avant de réduire la période.`);
      if (after.length) f.fail('endOn', `Permis actifs rattachés après cette date (${refs(after)}) : modifiez-les ou annulez-les avant de réduire la période.`);
    }
    // PRV-11 : les activités de la carte rattachées (non annulées) restent sur le site, l'entreprise et la période du plan.
    if (siteId && startOn && endOn && endOn >= startOn) {
      const issues = activityLinkIssues({ siteId, contractorId, from: startOn, to: endOn }, await linkedActivities(db, 'plan', existing.id), 'all');
      const named = (list: { title: string }[]) => list.map((a) => `« ${a.title} »`).join(', ');
      if (issues.site.length) f.fail('siteId', `Activités de la carte rattachées sur le site actuel (${named(issues.site)}) : annulez-les ou rattachez-les à un autre plan avant de changer de site.`);
      if (issues.contractor.length) f.fail('contractorId', `Activités de la carte rattachées pour cette entreprise (${named(issues.contractor)}) : modifiez-les avant de changer d'entreprise.`);
      const early = issues.period.filter((a) => a.startOn < startOn);
      const late = issues.period.filter((a) => a.endOn > endOn);
      if (early.length) f.fail('startOn', `Activités de la carte rattachées avant cette date (${named(early)}) : modifiez leurs dates avant de réduire la période.`);
      if (late.length) f.fail('endOn', `Activités de la carte rattachées après cette date (${named(late)}) : modifiez leurs dates avant de réduire la période.`);
    }
  }
  // Intervention commencée : déplacer sa date de début pourrait effacer un écart R. 4512-6 (plan signé après le début,
  // intervention sans plan signé) ; la modification exige un motif, conservé dans le journal.
  const startMoved = !!existing && existing.startOn <= now && !!startOn && startOn !== existing.startOn;
  const reason = startMoved ? f.reason() : null;
  if (!f.ok) return f.state();

  const values = {
    siteId, contractorId, title, location, startOn: startOn!, endOn: endOn!, estimatedHours: estimatedHours!, dangerousWork,
    keystoneProject, inspectionOn, interferenceRisks, measures, eeHeadcount, ...content, ownerId,
  };

  if (existing) {
    const changed = MATERIAL_FIELDS.some((k) => existing[k] !== values[k])
      || CONTENT_FIELDS.some((k) => existing[k] != null && existing[k] !== '' && existing[k] !== values[k]);
    // Signatures effacées : la date de la première signature complète reste (écart R. 4512-6 jugé sur celle-ci).
    const signatures = changed
      ? { signedEuOn: null, signedEeOn: null, signedEuName: null, signedEuQuality: null, signedEeName: null, signedEeQuality: null, firstSignedOn: existing.firstSignedOn ?? fullSignatureOn(existing) }
      : { signedEuOn: existing.signedEuOn, signedEeOn: existing.signedEeOn };
    // Signatures conservées : l'inspection commune préalable doit rester antérieure (ou du même jour) à la première signature.
    const firstSignature = [signatures.signedEuOn, signatures.signedEeOn].filter((d): d is string => !!d).sort()[0];
    if (firstSignature && (!inspectionOn || inspectionOn > firstSignature)) {
      f.fail('inspectionOn', `L'inspection commune doit précéder les signatures (au plus tard le ${fmtDate(firstSignature)}).`);
      return f.state();
    }
    const status = planStatus({ ...values, ...signatures, status: existing.status }, now);
    const details = diffFields(existing, values, PLAN_LABELS, fmtValue);
    const unsigned = changed && !!(existing.signedEuOn || existing.signedEeOn);
    const fresh = await db.transaction(async (tx) => {
      // QUA-12 : plan modifié (ou signé) depuis l'ouverture du formulaire : rien n'est écrasé.
      if (await staleEditError(tx, 'prevention_plan', existing.id, fd.get(VERSION_FIELD))) return false;
      await tx.update(t.preventionPlans).set({ ...values, ...signatures, status }).where(eq(t.preventionPlans.id, existing.id));
      if (details.length) {
        await logChange(tx, { entityType: 'prevention_plan', entityId: existing.id, action: 'update', summary: unsigned ? 'Plan modifié, signatures effacées' : 'Plan modifié', details, reason });
      }
      return true;
    });
    if (!fresh) {
      revalidatePath('/', 'layout');
      return { error: STALE_EDIT };
    }
    return done(existing.id);
  }

  const status = planStatus({ ...values, signedEuOn: null, signedEeOn: null, status: 'brouillon' }, now);
  // Référence tirée sous verrou dans la transaction (PRD-08) ; brouillons supprimés compris (journal) : jamais réattribuée.
  const newId = await db.transaction(async (tx) => {
    const ref = await nextEntityReference(tx, 'prevention_plan', `PP-${now.slice(0, 4)}-`, 3);
    await tx.insert(t.preventionPlans).values({ id: ref, ...values, status });
    await logChange(tx, { entityType: 'prevention_plan', entityId: ref, action: 'create', summary: 'Plan de prévention créé' });
    return ref;
  });
  return done(newId);
}

/** Valeur affichée dans l'historique (booléens en clair). */
const fmtValue = (v: unknown) => (v == null || v === '' ? null : typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : String(v));

/** Libellés des champs suivis dans l'historique d'un plan. */
const PLAN_LABELS = {
  siteId: 'Site', contractorId: 'Entreprise', title: 'Nature des travaux', location: 'Lieu', startOn: 'Début', endOn: 'Fin',
  estimatedHours: 'Heures sur 12 mois', dangerousWork: 'Travaux dangereux', keystoneProject: 'Projet Keystone', inspectionOn: 'Inspection commune',
  interferenceRisks: "Risques d'interférence", measures: 'Mesures de prévention', ownerId: 'Responsable',
  eeHeadcount: 'Effectif prévisible', eeSupervisor: "Responsable de l'intervention (entreprise extérieure)", subcontracting: 'Sous-traitance',
  dangerousPhases: 'Phases dangereuses', equipment: 'Matériels et installations', workerInstructions: 'Instructions aux travailleurs',
  emergencyOrganisation: 'Premiers secours et évacuation', coordination: 'Coordination et commandement', sirPosts: 'Suivi individuel renforcé',
} as const;

async function loadPlan(id: string) {
  const db = await getDb();
  const [plan] = await db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, String(id)));
  return { db, plan };
}

/** Plan modifiable : existant, du site sélectionné, ni clos ni annulé ; message d'erreur sinon. */
async function editablePlanError(plan: { siteId: string; status: string } | undefined): Promise<string | null> {
  if (!plan) return 'Plan de prévention introuvable.';
  return (await requireInSite(plan.siteId)) ?? (isPlanEnded(plan) ? ENDED_PLAN(plan) : null);
}

/**
 * Signature tardive (écart R. 4512-6, règle du site) : plan obligatoire signé après le début de l'intervention, alors
 * qu'il n'avait jamais été signé par les deux entreprises au plus tard le jour du début (dates déclarées, même jour admis).
 */
const lateSignature = (plan: typeof t.preventionPlans.$inferSelect, signedOn: string, mandatory: boolean) =>
  mandatory && signedOn > plan.startOn && !signedBeforeStart(plan);

/** Première signature complète à enregistrer quand la signature complète le plan (jamais remplacée ensuite). */
const firstSignedUpdate = (plan: typeof t.preventionPlans.$inferSelect, next: { signedEuOn: string | null; signedEeOn: string | null }) => {
  const full = fullSignatureOn(next);
  return full && !plan.firstSignedOn ? { firstSignedOn: full } : {};
};

/** Nom et qualité du signataire d'une entreprise (PRV-07), obligatoires. */
function readSigner(f: ReturnType<typeof formReader>, prefix: 'signedEu' | 'signedEe') {
  const name = f.str(`${prefix}Name`, { required: true, max: 120 });
  const quality = f.str(`${prefix}Quality`, { required: true, max: 120 });
  return { name, quality };
}

/**
 * Signature du plan par l'entreprise utilisatrice (PRV-07) : date de signature (au plus tard aujourd'hui, au plus tôt le
 * jour de l'inspection commune), nom et qualité du signataire ; une signature après le début de l'intervention est
 * tracée comme écart.
 */
export async function signPlanEu(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const signedOn = f.date('signedEuOn', { required: true });
  const signer = readSigner(f, 'signedEu');
  const now = today();
  if (signedOn && signedOn > now) f.fail('signedEuOn', 'La date de signature ne peut pas être future.');
  if (!f.ok || !signedOn) return f.state();
  const { db, plan } = await loadPlan(id);
  const blocked = await editablePlanError(plan);
  if (blocked || !plan) return { error: blocked ?? 'Plan de prévention introuvable.' };
  if (plan.signedEuOn) return { error: "Le plan est déjà signé par l'entreprise utilisatrice." };
  const mandatory = isMandatory(plan, await siteRule(db, plan.siteId));
  const issue = planSignIssue(plan, { now, mandatory, verb: 'signer' });
  if (issue) return { error: issue };
  if (plan.inspectionOn && signedOn < plan.inspectionOn) {
    return { error: "La signature ne peut pas précéder l'inspection commune.", fieldErrors: { signedEuOn: `Au plus tôt le jour de l'inspection commune.` } };
  }
  const next = { ...plan, signedEuOn: signedOn };
  const by = `${signer.name} (${signer.quality}), le ${fmtDate(signedOn)}`;
  const summary = lateSignature(plan, signedOn, mandatory)
    ? `Signé pour l'entreprise utilisatrice par ${by}, après le début de l'intervention (${fmtDate(plan.startOn)}) : écart R. 4512-6`
    : `Signé pour l'entreprise utilisatrice par ${by}`;
  await db.transaction(async (tx) => {
    await tx.update(t.preventionPlans).set({
      signedEuOn: signedOn, signedEuName: signer.name, signedEuQuality: signer.quality, status: planStatus(next, now), ...firstSignedUpdate(plan, next),
    }).where(eq(t.preventionPlans.id, plan.id));
    await logChange(tx, { entityType: 'prevention_plan', entityId: plan.id, action: 'sign', summary, byId: session.user.id });
  });
  return done(plan.id);
}

/** Enregistre la signature de l'entreprise extérieure (date) et, le cas échéant, l'exemplaire signé. */
export async function recordPlanEeSignature(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const signedOn = f.date('signedEeOn', { required: true });
  const signer = readSigner(f, 'signedEe');
  const files = f.files('file');
  const now = today();
  if (signedOn && signedOn > now) f.fail('signedEeOn', 'La date de signature ne peut pas être future.');
  const fileError = await checkUploadBatch(files, session.user.id);
  if (fileError) f.fail('file', fileError);
  if (!f.ok) return f.state();

  const { db, plan } = await loadPlan(id);
  const blocked = await editablePlanError(plan);
  if (blocked || !plan) return { error: blocked ?? 'Plan de prévention introuvable.' };
  if (plan.signedEeOn) return { error: "La signature de l'entreprise extérieure est déjà enregistrée." };
  const mandatory = isMandatory(plan, await siteRule(db, plan.siteId));
  const issue = planSignIssue(plan, { now, mandatory, verb: 'recueillir' });
  if (issue) return { error: issue };
  if (plan.inspectionOn && signedOn! < plan.inspectionOn) {
    return { error: "La signature ne peut pas précéder l'inspection commune.", fieldErrors: { signedEeOn: `Au plus tôt le jour de l'inspection commune.` } };
  }
  const next = { ...plan, signedEeOn: signedOn };
  const late = lateSignature(plan, signedOn!, mandatory) ? ", après le début de l'intervention : écart R. 4512-6" : '';
  await db.transaction(async (tx) => {
    await tx.update(t.preventionPlans).set({
      signedEeOn: signedOn, signedEeName: signer.name, signedEeQuality: signer.quality, status: planStatus(next, now), ...firstSignedUpdate(plan, next),
    }).where(eq(t.preventionPlans.id, id));
    await logChange(tx, {
      entityType: 'prevention_plan', entityId: id, action: 'sign',
      summary: `Signature de l'entreprise extérieure enregistrée : ${signer.name} (${signer.quality}), le ${fmtDate(signedOn!)}${late}${files.length ? ', exemplaire signé joint' : ''}`, byId: session.user.id,
    });
  });
  for (const file of files) await saveUpload(file, PLAN_ATTACHMENT, id, session.user.id);
  return done(id);
}

/**
 * Motif empêchant de clore ou d'annuler le plan (voir planEndIssue) : jamais pendant une intervention sans le plan
 * obligatoire signé ; les permis rattachés doivent être clos ou annulés. Aucune action QSE n'est exigée pour un écart
 * R. 4512-6 passé (actions immédiates hors actions QSE, réponses du service QHSE du 15/10/2026).
 */
async function planEndBlock(db: Db, plan: typeof t.preventionPlans.$inferSelect, verb: 'clore' | 'annuler') {
  const [rule, permits] = await Promise.all([
    siteRule(db, plan.siteId),
    db.select().from(t.permits).where(eq(t.permits.preventionPlanId, plan.id)),
  ]);
  return planEndIssue(plan, { mandatory: isMandatory(plan, rule), now: today(), verb, openPermitIds: permits.filter(isOpenPermit).map((p) => p.id) });
}

/** Clôture du plan en fin d'intervention (voir planEndBlock). */
export async function closePlan(id: string): Promise<Result> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const { db, plan } = await loadPlan(id);
  const blocked = await editablePlanError(plan);
  if (blocked || !plan) return { error: blocked ?? 'Plan de prévention introuvable.' };
  const issue = await planEndBlock(db, plan, 'clore');
  if (issue) return { error: issue };
  await db.transaction(async (tx) => {
    await tx.update(t.preventionPlans).set({ status: 'clos' }).where(eq(t.preventionPlans.id, plan.id));
    await logChange(tx, { entityType: 'prevention_plan', entityId: plan.id, action: 'status', summary: 'Plan clos', byId: session.user.id });
  });
  return ok();
}

/**
 * Annule un plan (intervention n'ayant pas lieu ou interrompue), motif obligatoire ; le plan reste consultable.
 * Mêmes conditions que la clôture, et aucune activité de la carte rattachée en cours ou à venir.
 */
export async function cancelPlan(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { db, plan } = await loadPlan(id);
  const blocked = await editablePlanError(plan);
  if (blocked || !plan) return { error: blocked ?? 'Plan de prévention introuvable.' };
  const issue = await planEndBlock(db, plan, 'annuler');
  if (issue) return { error: issue };
  const live = await db.select({ id: t.siteActivities.id }).from(t.siteActivities)
    .where(and(eq(t.siteActivities.preventionPlanId, plan.id), gte(t.siteActivities.endOn, today()), isNull(t.siteActivities.cancelledAt)));
  if (live.length) return { error: "Activités de la carte en cours ou à venir rattachées au plan : retirez ou modifiez les activités de la carte rattachées avant d'annuler le plan." };
  await db.transaction(async (tx) => {
    await tx.update(t.preventionPlans)
      .set({ status: 'annule', cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason })
      .where(eq(t.preventionPlans.id, plan.id));
    await logChange(tx, { entityType: 'prevention_plan', entityId: plan.id, action: 'cancel', summary: 'Plan annulé', reason, byId: session.user.id });
  });
  return done(plan.id);
}

/**
 * Supprime un brouillon saisi par erreur : sans signature ni inspection commune réalisée, sans permis, action, activité
 * de la carte ni événement rattachés. Tout autre plan s'annule avec un motif. Ses pièces jointes et le fichier importé sont supprimés.
 */
export async function deletePlan(id: string): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const { db, plan } = await loadPlan(id);
  const blocked = await editablePlanError(plan);
  if (blocked || !plan) return { error: blocked ?? 'Plan de prévention introuvable.' };
  const [permits, actions, activities, events] = await Promise.all([
    db.select({ id: t.permits.id }).from(t.permits).where(eq(t.permits.preventionPlanId, plan.id)),
    planActionIds(db, plan.id),
    db.select({ id: t.siteActivities.id }).from(t.siteActivities).where(eq(t.siteActivities.preventionPlanId, plan.id)),
    db.select({ id: t.events.id }).from(t.events).where(eq(t.events.preventionPlanId, plan.id)),
  ]);
  const engaged = [
    planStatus(plan, today()) !== 'brouillon' || plan.signedEuOn || plan.signedEeOn ? 'inspection commune ou signature enregistrée' : null,
    permits.length ? `permis ${permits.map((p) => p.id).join(', ')}` : null,
    actions.length ? `actions ${actions.join(', ')}` : null,
    activities.length ? 'activités de la carte' : null,
    events.length ? `événements ${events.map((e) => e.id).join(', ')}` : null,
  ].filter(Boolean);
  if (engaged.length) return { error: `Plan déjà engagé (${engaged.join(', ')}) : annulez-le avec un motif.` };
  const files = await listAttachments(PLAN_ATTACHMENT, plan.id);
  await db.transaction(async (tx) => {
    // La ligne du plan d'abord : elle référence le fichier importé (importedFromId).
    await tx.delete(t.preventionPlans).where(eq(t.preventionPlans.id, plan.id));
    await logChange(tx, { entityType: 'prevention_plan', entityId: plan.id, action: 'delete', summary: `Brouillon supprimé (${plan.title})` });
  });
  for (const file of files) await deleteAttachment(file.id);
  if (plan.importedFromId && !files.some((file) => file.id === plan.importedFromId)) await deleteAttachment(plan.importedFromId);
  return ok();
}

/** Joint des fichiers à un plan non clos (exemplaire signé, compte rendu d'inspection commune, avenant…). */
export async function addPlanAttachments(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const files = f.files('files');
  if (!files.length) f.fail('files', 'Choisissez au moins un fichier.');
  const fileError = await checkUploadBatch(files, session.user.id, { maxFiles: MAX_PLAN_FILES });
  if (fileError) f.fail('files', fileError);
  if (!f.ok) return f.state();
  const { plan } = await loadPlan(id);
  const blocked = await editablePlanError(plan);
  if (blocked) return { error: blocked };
  for (const file of files) {
    await saveUpload(file, PLAN_ATTACHMENT, id, session.user.id);
    await logChange(null, { entityType: 'prevention_plan', entityId: id, action: 'attach', summary: `Pièce jointe ajoutée : ${file.name}`, byId: session.user.id });
  }
  return done(id);
}

/** Retire une pièce jointe ajoutée par erreur (plan non clos) ; le fichier source d'un formulaire importé reste attaché au plan. */
export async function removePlanAttachment(attachmentId: string): Promise<Result> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const db = await getDb();
  const [row] = await db.select().from(t.attachments).where(eq(t.attachments.id, String(attachmentId)));
  if (!row || row.entityType !== PLAN_ATTACHMENT) return { error: 'Pièce jointe introuvable.' };
  const { plan } = await loadPlan(row.entityId);
  const blocked = await editablePlanError(plan);
  if (blocked || !plan) return { error: blocked ?? 'Plan de prévention introuvable.' };
  if (plan.importedFromId === row.id) return { error: 'Le formulaire importé reste attaché au plan.' };
  await deleteAttachment(row.id);
  await logChange(db, { entityType: 'prevention_plan', entityId: plan.id, action: 'detach', summary: `Pièce jointe retirée : ${row.fileName}`, byId: session.user.id });
  return ok();
}


// ─── Inspections et réunions périodiques (PRV-17) ───────────────────────────

/**
 * Fixe (ou retire) la périodicité des inspections et réunions de coordination d'un plan (R. 4513-2 : selon une périodicité
 * définie par l'entreprise utilisatrice), en jours ; vide = non fixée. Plan du site, ni clos ni annulé ; journal du plan.
 */
export async function setPlanMeetingPeriod(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const days = f.int('meetingPeriodDays', { min: MEETING_PERIOD_MIN_DAYS, max: MEETING_PERIOD_MAX_DAYS });
  if (!f.ok) return f.state();
  const { db, plan } = await loadPlan(id);
  const blocked = await editablePlanError(plan);
  if (blocked || !plan) return { error: blocked ?? 'Plan de prévention introuvable.' };
  if ((plan.meetingPeriodDays ?? null) === days) return done(plan.id);
  const show = (n: number | null) => (n == null ? null : `${n} j`);
  await db.transaction(async (tx) => {
    await tx.update(t.preventionPlans).set({ meetingPeriodDays: days }).where(eq(t.preventionPlans.id, plan.id));
    await logChange(tx, {
      entityType: 'prevention_plan', entityId: plan.id, action: 'update', byId: session.user.id,
      summary: days ? `Inspections et réunions périodiques : tous les ${days} jours` : 'Périodicité des inspections et réunions retirée',
      details: [{ field: 'Périodicité des inspections et réunions', from: show(plan.meetingPeriodDays), to: show(days) }],
    });
  });
  return done(plan.id);
}

/**
 * Enregistre une inspection commune ou une réunion de coordination tenue pendant l'intervention (PRV-17) : nature, date
 * (entre le début de l'intervention et aujourd'hui), participants, constats et mesures. Plan du site, signé ou en cours,
 * ni clos ni annulé ; journal du plan.
 */
export async function recordPlanMeeting(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const planId = f.str('planId', { required: true });
  const kind = f.oneOf('kind', PLAN_MEETING_KIND_KEYS, { required: true });
  const heldOn = f.date('heldOn', { required: true });
  const participants = f.str('participants', { required: true, max: 500 });
  const notes = f.str('notes', { max: 4000 });
  if (heldOn && heldOn > today()) f.fail('heldOn', "Enregistrez la séance une fois tenue (date future).");
  if (!f.ok) return f.state();
  const { db, plan } = await loadPlan(planId);
  const blocked = await editablePlanError(plan);
  if (blocked || !plan) return { error: blocked ?? 'Plan de prévention introuvable.' };
  if (heldOn! < plan.startOn) return { error: 'Certains champs sont à corriger.', fieldErrors: { heldOn: `Séance antérieure au début de l'intervention (${fmtDate(plan.startOn)}) : l'inspection commune préalable se renseigne dans le plan.` } };
  const id = await db.transaction(async (tx) => {
    const [row] = await tx.insert(t.preventionPlanMeetings).values({ planId: plan.id, kind: kind!, heldOn: heldOn!, participants, notes, recordedById: session.user.id })
      .returning({ id: t.preventionPlanMeetings.id });
    await logChange(tx, { entityType: 'prevention_plan', entityId: plan.id, action: 'meeting', byId: session.user.id, summary: `${PLAN_MEETING_KINDS[kind!]} du ${fmtDate(heldOn!)} enregistrée` });
    return row.id;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(id) };
}

/** Annule une séance enregistrée par erreur (motif obligatoire, jamais supprimée) ; plan ni clos ni annulé, du site. */
export async function cancelPlanMeeting(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [meeting] = await db.select().from(t.preventionPlanMeetings).where(eq(t.preventionPlanMeetings.id, id!));
  if (!meeting) return { error: 'Séance introuvable.' };
  if (meeting.cancelledAt) return { error: 'Séance déjà annulée.' };
  const { plan } = await loadPlan(meeting.planId);
  const blocked = await editablePlanError(plan);
  if (blocked || !plan) return { error: blocked ?? 'Plan de prévention introuvable.' };
  await db.transaction(async (tx) => {
    await tx.update(t.preventionPlanMeetings).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.preventionPlanMeetings.id, meeting.id));
    await logChange(tx, {
      entityType: 'prevention_plan', entityId: plan.id, action: 'cancel_meeting', byId: session.user.id, reason,
      summary: `${PLAN_MEETING_KINDS[meeting.kind as keyof typeof PLAN_MEETING_KINDS] ?? 'Séance'} du ${fmtDate(meeting.heldOn)} annulée`,
    });
  });
  return done(plan.id);
}
