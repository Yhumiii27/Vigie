'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, gte, ne } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  FIRE_WATCH_HOURS, MAX_PLAN_FILES, PERMIT_TYPES, PERMIT_TYPE_KEYS,
  addHoursLocal, firstMinuteReason, firstMinuteRule, fmtPeriod, fromParisLocal, inspectionDone, isMandatory, isPlanEnded, lcfirst, missingPresets,
  parseChecklist, permitDays, permitPlanIssue, planCovers, planEndIssue, planStatus, referenceNow, validityOver,
  type ChecklistItem, type SiteRule,
} from '@/components/prevention/model';
import { fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { formReader, nextRef, type FormState } from '@/lib/forms';
import { MAX_BATCH_BYTES } from '@/lib/attachments';
import { requireInSite, requireManager } from '@/lib/guard';
import { checkUpload, deleteAttachment, listAttachments, saveUpload } from '@/lib/uploads';
import { PLAN_ATTACHMENT } from '@/lib/data/prevention';
import { diffFields, logChange, loggedIds } from './changelog';

type Result = { error?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CHECKLIST = 30;
/** Permis encore actifs (demandés ou délivrés) : ils suivent le site et l'entreprise de leur plan. */
const isOpenPermit = (p: { status: string }) => p.status === 'demande' || p.status === 'delivre';

/** Règle de prévention du site (classement Seveso, plan « dès la première minute »). */
async function siteRule(db: Awaited<ReturnType<typeof getDb>>, siteId: string): Promise<SiteRule | undefined> {
  const [site] = await db.select({ seveso: t.sites.seveso, ppFromFirstMinute: t.sites.ppFromFirstMinute }).from(t.sites).where(eq(t.sites.id, siteId));
  return site;
}

const done = (id?: string): FormState => {
  revalidatePath('/', 'layout');
  return { ok: true, id };
};
const ok = (): Result => {
  revalidatePath('/', 'layout');
  return {};
};

const ARCHIVED_CONTRACTOR = 'Entreprise archivée : réactivez-la dans l’onglet Entreprises extérieures.';
const ENDED_PLAN = (p: { status: string }) => (p.status === 'annule' ? 'Ce plan est annulé.' : 'Ce plan est clos.');

// ─── Entreprises extérieures ────────────────────────────────────────────────

/** Crée ou modifie une entreprise extérieure. */
export async function saveContractor(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const name = f.str('name', { required: true, max: 120 });
  const trade = f.str('trade', { required: true, max: 120 });
  const contactName = f.str('contactName', { max: 120 }) || null;
  const contactPhone = f.str('contactPhone', { max: 40 }) || null;
  const contactEmail = f.str('contactEmail', { max: 160 }) || null;
  if (contactEmail && !EMAIL.test(contactEmail)) f.fail('contactEmail', 'Adresse e-mail invalide.');
  if (!f.ok) return f.state();

  const db = await getDb();
  const all = await db.select().from(t.contractors);
  const key = name.toLocaleLowerCase('fr');
  if (all.some((c) => c.id !== id && c.name.toLocaleLowerCase('fr') === key)) {
    return { error: 'Cette entreprise existe déjà.', fieldErrors: { name: 'Nom déjà utilisé.' } };
  }
  const values = { name, trade, contactName, contactPhone, contactEmail };
  if (id) {
    const before = all.find((c) => c.id === id);
    if (!before) return { error: 'Entreprise introuvable.' };
    const details = diffFields(before, values, { name: 'Raison sociale', trade: 'Corps de métier', contactName: 'Interlocuteur', contactPhone: 'Téléphone', contactEmail: 'E-mail' });
    await db.transaction(async (tx) => {
      await tx.update(t.contractors).set(values).where(eq(t.contractors.id, id));
      if (details.length) await logChange(tx, { entityType: 'contractor', entityId: id, action: 'update', summary: 'Fiche modifiée', details });
    });
    return done(id);
  }
  const newId = nextRef(all.map((c) => c.id), 'EE-', 3);
  await db.transaction(async (tx) => {
    await tx.insert(t.contractors).values({ id: newId, ...values });
    await logChange(tx, { entityType: 'contractor', entityId: newId, action: 'create', summary: 'Entreprise ajoutée' });
  });
  return done(newId);
}

/**
 * Archive une entreprise qui n'intervient plus (motif obligatoire) : elle n'est plus proposée dans les formulaires,
 * ses plans et permis restent consultables. Refusé tant qu'elle a des plans ou des permis en cours, sur tout site.
 * Pas de suppression : la fiche est tracée dès l'ajout, une entreprise saisie par erreur s'archive aussi.
 */
export async function archiveContractor(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [row] = await db.select().from(t.contractors).where(eq(t.contractors.id, id));
  if (!row) return { error: 'Entreprise introuvable.' };
  if (row.archivedAt) return { error: 'Cette entreprise est déjà archivée.' };
  const [plans, permits] = await Promise.all([
    db.select({ id: t.preventionPlans.id, status: t.preventionPlans.status }).from(t.preventionPlans).where(eq(t.preventionPlans.contractorId, id)),
    db.select({ id: t.permits.id, status: t.permits.status }).from(t.permits).where(eq(t.permits.contractorId, id)),
  ]);
  const busy = [...plans.filter((p) => !isPlanEnded(p)), ...permits.filter(isOpenPermit)].map((p) => p.id);
  if (busy.length) return { error: `Plans ou permis en cours (${busy.join(', ')}) : clôturez-les ou annulez-les avant d'archiver.` };
  await db.transaction(async (tx) => {
    await tx.update(t.contractors).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason }).where(eq(t.contractors.id, id));
    await logChange(tx, { entityType: 'contractor', entityId: id, action: 'archive', summary: 'Entreprise archivée', reason, byId: session.user.id });
  });
  return done(id);
}

/** Réactive une entreprise archivée (de nouveau proposée dans les formulaires). */
export async function restoreContractor(id: string): Promise<Result> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const db = await getDb();
  const [row] = await db.select().from(t.contractors).where(eq(t.contractors.id, String(id)));
  if (!row) return { error: 'Entreprise introuvable.' };
  if (!row.archivedAt) return { error: "Cette entreprise n'est pas archivée." };
  await db.transaction(async (tx) => {
    await tx.update(t.contractors).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.contractors.id, row.id));
    await logChange(tx, { entityType: 'contractor', entityId: row.id, action: 'restore', summary: 'Entreprise réactivée', byId: session.user.id });
  });
  return ok();
}

// ─── Plans de prévention ────────────────────────────────────────────────────

/** Champs dont la modification annule les signatures d'un plan (le plan modifié doit être signé à nouveau). */
const MATERIAL_FIELDS = ['siteId', 'contractorId', 'title', 'location', 'startOn', 'endOn', 'estimatedHours', 'dangerousWork', 'interferenceRisks', 'measures'] as const;

/** Crée ou modifie un plan de prévention ; le statut est dérivé (inspection commune, signatures). */
export async function savePlan(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  // « 1 200 » : séparateur de milliers usuel en français, accepté comme dans le formulaire.
  const hoursRaw = fd.get('estimatedHours');
  if (typeof hoursRaw === 'string') fd.set('estimatedHours', hoursRaw.replace(/\s/g, ''));
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
  }
  if (!f.ok) return f.state();

  const values = {
    siteId, contractorId, title, location, startOn: startOn!, endOn: endOn!, estimatedHours: estimatedHours!, dangerousWork,
    keystoneProject, inspectionOn, interferenceRisks, measures, ownerId,
  };
  const now = today();

  if (existing) {
    const changed = MATERIAL_FIELDS.some((k) => existing[k] !== values[k]);
    const signatures = changed ? { signedEuOn: null, signedEeOn: null } : { signedEuOn: existing.signedEuOn, signedEeOn: existing.signedEeOn };
    // Signatures conservées : l'inspection commune préalable doit rester antérieure (ou du même jour) à la première signature.
    const firstSignature = [signatures.signedEuOn, signatures.signedEeOn].filter((d): d is string => !!d).sort()[0];
    if (firstSignature && (!inspectionOn || inspectionOn > firstSignature)) {
      f.fail('inspectionOn', `L'inspection commune doit précéder les signatures (au plus tard le ${fmtDate(firstSignature)}).`);
      return f.state();
    }
    const status = planStatus({ ...values, ...signatures, status: existing.status }, now);
    const details = diffFields(existing, values, PLAN_LABELS, fmtValue);
    const unsigned = changed && !!(existing.signedEuOn || existing.signedEeOn);
    await db.transaction(async (tx) => {
      await tx.update(t.preventionPlans).set({ ...values, ...signatures, status }).where(eq(t.preventionPlans.id, existing.id));
      if (details.length) {
        await logChange(tx, { entityType: 'prevention_plan', entityId: existing.id, action: 'update', summary: unsigned ? 'Plan modifié, signatures effacées' : 'Plan modifié', details });
      }
    });
    return done(existing.id);
  }

  const ids = (await db.select({ id: t.preventionPlans.id }).from(t.preventionPlans)).map((r) => r.id);
  const newId = nextRef([...ids, ...(await loggedIds(db, 'prevention_plan'))], `PP-${now.slice(0, 4)}-`, 3);
  const status = planStatus({ ...values, signedEuOn: null, signedEeOn: null, status: 'brouillon' }, now);
  await db.transaction(async (tx) => {
    await tx.insert(t.preventionPlans).values({ id: newId, ...values, status });
    await logChange(tx, { entityType: 'prevention_plan', entityId: newId, action: 'create', summary: 'Plan de prévention créé' });
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

/** Signature du plan par l'entreprise utilisatrice (date du jour). */
export async function signPlanEu(id: string): Promise<Result> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const { db, plan } = await loadPlan(id);
  const now = today();
  const blocked = await editablePlanError(plan);
  if (blocked || !plan) return { error: blocked ?? 'Plan de prévention introuvable.' };
  if (plan.signedEuOn) return { error: "Le plan est déjà signé par l'entreprise utilisatrice." };
  if (!inspectionDone(plan, now)) return { error: "Réalisez l'inspection commune préalable avant de signer le plan." };
  if (!plan.measures.trim()) return { error: 'Complétez les mesures de prévention avant de signer le plan.' };
  const next = { ...plan, signedEuOn: now };
  await db.transaction(async (tx) => {
    await tx.update(t.preventionPlans).set({ signedEuOn: now, status: planStatus(next, now) }).where(eq(t.preventionPlans.id, plan.id));
    await logChange(tx, { entityType: 'prevention_plan', entityId: plan.id, action: 'sign', summary: "Signé pour l'entreprise utilisatrice", byId: session.user.id });
  });
  return ok();
}

/** Enregistre la signature de l'entreprise extérieure (date) et, le cas échéant, l'exemplaire signé. */
export async function recordPlanEeSignature(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const signedOn = f.date('signedEeOn', { required: true });
  const files = f.files('file');
  const now = today();
  if (signedOn && signedOn > now) f.fail('signedEeOn', 'La date de signature ne peut pas être future.');
  files.forEach((file) => { const err = checkUpload(file); if (err) f.fail('file', err); });
  if (!f.ok) return f.state();

  const { db, plan } = await loadPlan(id);
  const blocked = await editablePlanError(plan);
  if (blocked || !plan) return { error: blocked ?? 'Plan de prévention introuvable.' };
  if (plan.signedEeOn) return { error: "La signature de l'entreprise extérieure est déjà enregistrée." };
  if (!inspectionDone(plan, now)) return { error: "Réalisez l'inspection commune préalable avant de recueillir les signatures." };
  if (!plan.measures.trim()) return { error: 'Complétez les mesures de prévention avant de recueillir les signatures.' };
  if (plan.inspectionOn && signedOn! < plan.inspectionOn) {
    return { error: "La signature ne peut pas précéder l'inspection commune.", fieldErrors: { signedEeOn: `Au plus tôt le jour de l'inspection commune.` } };
  }
  const next = { ...plan, signedEeOn: signedOn };
  await db.transaction(async (tx) => {
    await tx.update(t.preventionPlans).set({ signedEeOn: signedOn, status: planStatus(next, now) }).where(eq(t.preventionPlans.id, id));
    await logChange(tx, {
      entityType: 'prevention_plan', entityId: id, action: 'sign',
      summary: `Signature de l'entreprise extérieure enregistrée (${fmtDate(signedOn!)})${files.length ? ', exemplaire signé joint' : ''}`, byId: session.user.id,
    });
  });
  for (const file of files) await saveUpload(file, PLAN_ATTACHMENT, id, session.user.id);
  return done(id);
}

/**
 * Motif empêchant de clore ou d'annuler le plan (voir planEndIssue) : jamais pendant une intervention sans le plan
 * obligatoire signé ; après une intervention réalisée sans plan signé, une fois l'écart tracé par une action du plan
 * d'actions unique ; les permis rattachés doivent être clos ou annulés.
 */
async function planEndBlock(db: Awaited<ReturnType<typeof getDb>>, plan: typeof t.preventionPlans.$inferSelect, verb: 'clore' | 'annuler') {
  const [rule, actions, permits] = await Promise.all([
    siteRule(db, plan.siteId),
    db.select({ id: t.actions.id }).from(t.actions)
      .where(and(eq(t.actions.origin, 'prevention'), eq(t.actions.originRef, plan.id), ne(t.actions.status, 'cancelled'))),
    db.select().from(t.permits).where(eq(t.permits.preventionPlanId, plan.id)),
  ]);
  return planEndIssue(plan, {
    mandatory: isMandatory(plan, rule), now: today(), verb,
    openPermitIds: permits.filter(isOpenPermit).map((p) => p.id), actionCount: actions.length,
  });
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
    .where(and(eq(t.siteActivities.preventionPlanId, plan.id), gte(t.siteActivities.endOn, today())));
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
    db.select({ id: t.actions.id }).from(t.actions).where(and(eq(t.actions.origin, 'prevention'), eq(t.actions.originRef, plan.id))),
    db.select({ id: t.siteActivities.id }).from(t.siteActivities).where(eq(t.siteActivities.preventionPlanId, plan.id)),
    db.select({ id: t.events.id }).from(t.events).where(eq(t.events.preventionPlanId, plan.id)),
  ]);
  const engaged = [
    planStatus(plan, today()) !== 'brouillon' || plan.signedEuOn || plan.signedEeOn ? 'inspection commune ou signature enregistrée' : null,
    permits.length ? `permis ${permits.map((p) => p.id).join(', ')}` : null,
    actions.length ? `actions ${actions.map((a) => a.id).join(', ')}` : null,
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
  if (files.length > MAX_PLAN_FILES) f.fail('files', `${MAX_PLAN_FILES} fichiers au maximum par envoi.`);
  else if (files.reduce((s, x) => s + x.size, 0) > MAX_BATCH_BYTES) f.fail('files', `L'envoi dépasse ${MAX_BATCH_BYTES / 1024 / 1024} Mo : ajoutez les fichiers en plusieurs fois.`);
  files.forEach((file) => { const err = checkUpload(file); if (err) f.fail('files', err); });
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

// ─── Permis de feu et permis d'essai ────────────────────────────────────────

function readChecklist(raw: string): ChecklistItem[] | null {
  try {
    const items = parseChecklist(JSON.parse(raw));
    if (!items.length || items.length > MAX_CHECKLIST || items.some((i) => i.label.length > 200)) return null;
    return items;
  } catch {
    return null;
  }
}

/** Crée une demande de permis, ou la modifie tant qu'elle n'est pas délivrée. */
export async function savePermit(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const type = f.oneOf('type', PERMIT_TYPE_KEYS, { required: true });
  const siteId = f.str('siteId', { required: true });
  const location = f.str('location', { required: true, max: 160 });
  const description = f.str('description', { required: true, max: 400 });
  let contractorId = f.opt('contractorId');
  const performer = f.str('performer', { required: true, max: 200 });
  const preventionPlanId = f.opt('preventionPlanId');
  const keystoneProject = f.opt('keystoneProject');
  const fromLocal = f.str('validFrom', { required: true });
  const toLocal = f.str('validTo', { required: true });
  const watchLocal = f.opt('watchUntil');
  const checklist = readChecklist(f.str('checklist'));
  if (!checklist) f.fail('checklist', 'La check-list doit comporter entre 1 et 30 points.');
  const missing = type && checklist ? missingPresets(type, checklist) : [];
  if (missing.length) f.fail('checklist', `Points obligatoires manquants : ${missing.join(', ')}.`);

  const validFrom = fromLocal ? fromParisLocal(fromLocal) : null;
  const validTo = toLocal ? fromParisLocal(toLocal) : null;
  if (fromLocal && !validFrom) f.fail('validFrom', 'Date et heure invalides.');
  if (toLocal && !validTo) f.fail('validTo', 'Date et heure invalides.');
  if (validFrom && validTo && validTo <= validFrom) f.fail('validTo', 'La fin de validité doit suivre le début.');
  let watchUntil: Date | null = null;
  if (watchLocal) {
    watchUntil = fromParisLocal(watchLocal);
    if (!watchUntil) f.fail('watchUntil', 'Date et heure invalides.');
    else if (validTo && watchUntil <= validTo) f.fail('watchUntil', 'La surveillance doit se terminer après la fin des travaux.');
  } else if (type === 'feu' && toLocal && validTo) {
    watchUntil = fromParisLocal(addHoursLocal(toLocal, FIRE_WATCH_HOURS));
  }

  const db = await getDb();
  const [sites, contractors, plans, projects] = await Promise.all([
    db.select({ id: t.sites.id }).from(t.sites),
    db.select({ id: t.contractors.id, archivedAt: t.contractors.archivedAt }).from(t.contractors),
    db.select().from(t.preventionPlans),
    db.select({ id: t.keystoneProjects.id, client: t.keystoneProjects.client }).from(t.keystoneProjects),
  ]);
  if (siteId && !sites.some((s) => s.id === siteId)) f.fail('siteId', 'Site inconnu.');
  const [existing] = id ? await db.select().from(t.permits).where(eq(t.permits.id, id)) : [];
  if (id && !existing) return { error: 'Permis introuvable.' };
  if (existing && existing.status !== 'demande') return { error: 'Un permis délivré, clos ou annulé ne se modifie plus.' };
  const siteError = (existing ? await requireInSite(existing.siteId) : null)
    ?? (siteId && siteId !== existing?.siteId ? await requireInSite(siteId, { create: true }) : null);
  if (siteError) return { error: siteError };
  const contractor = contractors.find((c) => c.id === contractorId);
  if (contractorId && !contractor) f.fail('contractorId', 'Entreprise introuvable.');
  else if (contractor?.archivedAt && contractor.id !== existing?.contractorId) f.fail('contractorId', ARCHIVED_CONTRACTOR);
  if (existing && existing.type !== type) f.fail('type', "Le type d'un permis ne change pas après sa création.");
  if (preventionPlanId) {
    const plan = plans.find((p) => p.id === preventionPlanId);
    if (!plan) f.fail('preventionPlanId', 'Plan de prévention introuvable.');
    else if (isPlanEnded(plan) && plan.id !== existing?.preventionPlanId) f.fail('preventionPlanId', `Ce plan de prévention est ${plan.status === 'annule' ? 'annulé' : 'clos'}.`);
    else if (plan.siteId !== siteId) f.fail('preventionPlanId', "Ce plan concerne un autre site.");
    else if (contractorId && plan.contractorId !== contractorId) f.fail('preventionPlanId', "Ce plan concerne une autre entreprise extérieure.");
    else if (validFrom && validTo && validTo > validFrom && !planCovers(plan, permitDays({ validFrom, validTo }).from, permitDays({ validFrom, validTo }).to)) {
      f.fail('preventionPlanId', `Ce plan (${fmtPeriod(plan.startOn, plan.endOn)}) ne couvre pas la validité du permis.`);
    } else contractorId = plan.contractorId;
  }
  const knownProject = !keystoneProject || keystoneProject === existing?.keystoneProject || projects.some((p) => `${p.id} · ${p.client}` === keystoneProject);
  if (!knownProject) f.fail('keystoneProject', 'Projet Keystone inconnu.');
  if (!f.ok) return f.state();

  const values = {
    type: type!, siteId, location, description, contractorId, performer, preventionPlanId, keystoneProject,
    validFrom: validFrom!, validTo: validTo!, watchUntil, checklist: checklist!,
  };
  if (existing) {
    const details = diffFields(existing, values, { location: 'Lieu', description: 'Travaux', contractorId: 'Entreprise', performer: 'Intervenant(s)', preventionPlanId: 'Plan de prévention', keystoneProject: 'Projet Keystone' });
    const moved = existing.validFrom.getTime() !== validFrom!.getTime() || existing.validTo.getTime() !== validTo!.getTime();
    await db.transaction(async (tx) => {
      await tx.update(t.permits).set(values).where(eq(t.permits.id, existing.id));
      if (details.length || moved) {
        await logChange(tx, { entityType: 'permit', entityId: existing.id, action: 'update', summary: moved ? 'Demande modifiée (validité)' : 'Demande modifiée', details });
      }
    });
    return done(existing.id);
  }
  const ids = (await db.select({ id: t.permits.id }).from(t.permits)).map((r) => r.id);
  const newId = nextRef(ids, `${PERMIT_TYPES[type!].prefix}-${today().slice(0, 4)}-`, 3);
  await db.transaction(async (tx) => {
    await tx.insert(t.permits).values({ id: newId, ...values, status: 'demande' });
    await logChange(tx, { entityType: 'permit', entityId: newId, action: 'create', summary: 'Demande de permis enregistrée' });
  });
  return done(newId);
}

async function loadPermit(id: string) {
  const db = await getDb();
  const [permit] = await db.select().from(t.permits).where(eq(t.permits.id, String(id)));
  const siteError = permit ? await requireInSite(permit.siteId) : null;
  return { db, permit, siteError };
}

/** Coche ou décoche un point de la check-list d'un permis demandé. */
export async function setPermitCheck(id: string, index: number, checked: boolean): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const { db, permit, siteError } = await loadPermit(id);
  if (!permit) return { error: 'Permis introuvable.' };
  if (siteError) return { error: siteError };
  if (permit.status !== 'demande') return { error: 'La check-list est figée une fois le permis délivré.' };
  const items = parseChecklist(permit.checklist);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return { error: 'Point de contrôle introuvable.' };
  items[index] = { ...items[index], checked: checked === true };
  await db.update(t.permits).set({ checklist: items }).where(eq(t.permits.id, id));
  revalidatePath('/', 'layout');
  return {};
}

/** Délivre le permis : check-list complète, validité non dépassée, plan de prévention en règle selon la règle du site. */
export async function deliverPermit(id: string): Promise<Result> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const { db, permit, siteError } = await loadPermit(id);
  if (!permit) return { error: 'Permis introuvable.' };
  if (siteError) return { error: siteError };
  if (permit.status !== 'demande') return { error: "Seul un permis demandé peut être délivré." };
  const items = parseChecklist(permit.checklist);
  const type = PERMIT_TYPE_KEYS.find((k) => k === permit.type);
  if (!type) return { error: 'Type de permis inconnu.' };
  const missing = missingPresets(type, items);
  if (missing.length) return { error: `Points obligatoires absents de la check-list : ${missing.join(', ')}. Modifiez la demande.` };
  if (!items.every((i) => i.checked)) return { error: 'Tous les points de la check-list doivent être vérifiés avant la délivrance.' };
  const now = referenceNow(today());
  if (validityOver(permit, now.getTime())) return { error: 'La période de validité est dépassée : modifiez les dates ou annulez le permis.' };
  // Plan de prévention : sur un site « dès la première minute », toute entreprise extérieure doit avoir un plan signé
  // (EU et EE), non clos, couvrant la validité du permis ; ailleurs, de même pour le permis de feu d'une entreprise
  // extérieure (travaux dangereux), et le plan rattaché à un autre permis doit être en règle (R. 4512-7).
  const [plan] = permit.preventionPlanId ? await db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, permit.preventionPlanId)) : [];
  const rule = await siteRule(db, permit.siteId);
  const issue = permitPlanIssue(permit, plan, rule);
  if (issue) {
    const reason = firstMinuteRule(rule) ? firstMinuteReason(rule) : '';
    return { error: `${issue} Délivrance impossible${reason ? ` (${lcfirst(reason)})` : ''}.` };
  }
  await db.transaction(async (tx) => {
    await tx.update(t.permits).set({ status: 'delivre', issuerId: session.user.id }).where(eq(t.permits.id, permit.id));
    await logChange(tx, { entityType: 'permit', entityId: permit.id, action: 'status', summary: 'Permis délivré', byId: session.user.id });
  });
  return ok();
}

/**
 * Rattache un plan de prévention au permis demandé ou délivré d'une entreprise extérieure (régularisation d'un écart) :
 * plan non clos, du même site et de la même entreprise, couvrant la validité du permis. Un permis délivré ne peut
 * être rattaché qu'à un plan en règle (signé s'il est exigé) : le rattachement ne doit pas contourner la délivrance.
 */
export async function linkPermitPlan(id: string, planId: string): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const { db, permit, siteError } = await loadPermit(id);
  if (!permit) return { error: 'Permis introuvable.' };
  if (siteError) return { error: siteError };
  if (!isOpenPermit(permit)) return { error: 'Ce permis est clos ou annulé.' };
  if (!permit.contractorId) return { error: "Permis d'une intervention interne : indiquez l'entreprise extérieure en modifiant la demande." };
  const [plan] = await db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, String(planId)));
  if (!plan) return { error: 'Plan de prévention introuvable.' };
  if (isPlanEnded(plan)) return { error: `Le plan de prévention ${plan.id} est ${plan.status === 'annule' ? 'annulé' : 'clos'}.` };
  if (plan.siteId !== permit.siteId) return { error: 'Ce plan concerne un autre site.' };
  if (plan.contractorId !== permit.contractorId) return { error: 'Ce plan concerne une autre entreprise extérieure.' };
  const { from, to } = permitDays(permit);
  if (!planCovers(plan, from, to)) return { error: `Ce plan (${fmtPeriod(plan.startOn, plan.endOn)}) ne couvre pas la validité du permis.` };
  if (permit.status === 'delivre') {
    const issue = permitPlanIssue({ ...permit, preventionPlanId: plan.id }, plan, await siteRule(db, permit.siteId));
    if (issue) return { error: `${issue} Un permis délivré ne peut être rattaché qu'à un plan en règle.` };
  }
  await db.transaction(async (tx) => {
    await tx.update(t.permits).set({ preventionPlanId: plan.id }).where(eq(t.permits.id, permit.id));
    await logChange(tx, {
      entityType: 'permit', entityId: permit.id, action: 'link', summary: `Plan de prévention ${plan.id} rattaché`,
      details: [{ field: 'Plan de prévention', from: permit.preventionPlanId, to: plan.id }],
    });
  });
  return ok();
}

/** Clôt le permis en fin de travaux (après la ronde de surveillance pour un permis de feu, confirmée dans la fiche). */
export async function closePermit(id: string): Promise<Result> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const { db, permit, siteError } = await loadPermit(id);
  if (!permit) return { error: 'Permis introuvable.' };
  if (siteError) return { error: siteError };
  if (permit.status !== 'delivre') return { error: 'Seul un permis délivré peut être clos.' };
  const now = referenceNow(today());
  if (permit.validFrom > now) return { error: "Les travaux n'ont pas commencé : annulez le permis plutôt que de le clore." };
  await db.transaction(async (tx) => {
    await tx.update(t.permits).set({ status: 'clos', closedAt: now }).where(eq(t.permits.id, permit.id));
    await logChange(tx, { entityType: 'permit', entityId: permit.id, action: 'status', summary: 'Permis clos (fin des travaux)', byId: session.user.id });
  });
  return ok();
}

/** Annule un permis demandé ou délivré (travaux n'ayant pas lieu ou arrêtés), motif obligatoire. */
export async function cancelPermit(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { db, permit, siteError } = await loadPermit(id);
  if (!permit) return { error: 'Permis introuvable.' };
  if (siteError) return { error: siteError };
  if (!isOpenPermit(permit)) return { error: 'Ce permis est déjà clos ou annulé.' };
  const requested = permit.status === 'demande';
  await db.transaction(async (tx) => {
    await tx.update(t.permits)
      .set({ status: 'annule', closedAt: referenceNow(today()), cancelledById: session.user.id, cancelReason: reason })
      .where(eq(t.permits.id, permit.id));
    await logChange(tx, { entityType: 'permit', entityId: permit.id, action: 'cancel', summary: requested ? 'Demande de permis annulée' : 'Permis annulé', reason, byId: session.user.id });
  });
  return done(permit.id);
}
