'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  FIRE_WATCH_HOURS, PERMIT_TYPES, PERMIT_TYPE_KEYS,
  addHoursLocal, firstMinuteReason, firstMinuteRule, fmtPeriod, fromParisLocal, inspectionDone, isFullySigned, isMandatory, lcfirst, missingPresets,
  parseChecklist, permitDays, permitPlanIssue, planCovers, planStatus, referenceNow, validityOver,
  type ChecklistItem, type SiteRule,
} from '@/components/prevention/model';
import { fmtDate, today } from '@/lib/dates';
import { formReader, nextRef, type FormState } from '@/lib/forms';
import { requireManager } from '@/lib/guard';
import { checkUpload, saveUpload } from '@/lib/uploads';
import { PLAN_ATTACHMENT } from '@/lib/data/prevention';

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
  const all = await db.select({ id: t.contractors.id, name: t.contractors.name }).from(t.contractors);
  const key = name.toLocaleLowerCase('fr');
  if (all.some((c) => c.id !== id && c.name.toLocaleLowerCase('fr') === key)) {
    return { error: 'Cette entreprise existe déjà.', fieldErrors: { name: 'Nom déjà utilisé.' } };
  }
  const values = { name, trade, contactName, contactPhone, contactEmail };
  if (id) {
    const [row] = await db.update(t.contractors).set(values).where(eq(t.contractors.id, id)).returning({ id: t.contractors.id });
    if (!row) return { error: 'Entreprise introuvable.' };
    return done(id);
  }
  const newId = nextRef(all.map((c) => c.id), 'EE-', 3);
  await db.insert(t.contractors).values({ id: newId, ...values });
  return done(newId);
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
    db.select({ id: t.contractors.id }).from(t.contractors),
    db.select({ id: t.sites.id }).from(t.sites),
    db.select({ id: t.people.id }).from(t.people),
    db.select({ id: t.keystoneProjects.id, client: t.keystoneProjects.client }).from(t.keystoneProjects),
  ]);
  if (contractorId && !contractors.some((c) => c.id === contractorId)) f.fail('contractorId', 'Entreprise introuvable.');
  if (siteId && !sites.some((s) => s.id === siteId)) f.fail('siteId', 'Site inconnu.');
  if (ownerId && !people.some((p) => p.id === ownerId)) f.fail('ownerId', 'Personne inconnue.');

  const [existing] = id ? await db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, id)) : [];
  if (id && !existing) return { error: 'Plan de prévention introuvable.' };
  if (existing?.status === 'clos') return { error: 'Un plan clos ne peut plus être modifié.' };
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
    await db.update(t.preventionPlans).set({ ...values, ...signatures, status }).where(eq(t.preventionPlans.id, existing.id));
    return done(existing.id);
  }

  const ids = (await db.select({ id: t.preventionPlans.id }).from(t.preventionPlans)).map((r) => r.id);
  const newId = nextRef(ids, `PP-${now.slice(0, 4)}-`, 3);
  const status = planStatus({ ...values, signedEuOn: null, signedEeOn: null, status: 'brouillon' }, now);
  await db.insert(t.preventionPlans).values({ id: newId, ...values, status });
  return done(newId);
}

async function loadPlan(id: string) {
  const db = await getDb();
  const [plan] = await db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, id));
  return { db, plan };
}

/** Signature du plan par l'entreprise utilisatrice (date du jour). */
export async function signPlanEu(id: string): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const { db, plan } = await loadPlan(id);
  const now = today();
  if (!plan) return { error: 'Plan de prévention introuvable.' };
  if (plan.status === 'clos') return { error: 'Ce plan est clos.' };
  if (plan.signedEuOn) return { error: "Le plan est déjà signé par l'entreprise utilisatrice." };
  if (!inspectionDone(plan, now)) return { error: "Réalisez l'inspection commune préalable avant de signer le plan." };
  if (!plan.measures.trim()) return { error: 'Complétez les mesures de prévention avant de signer le plan.' };
  const next = { ...plan, signedEuOn: now };
  await db.update(t.preventionPlans).set({ signedEuOn: now, status: planStatus(next, now) }).where(eq(t.preventionPlans.id, id));
  revalidatePath('/', 'layout');
  return {};
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
  if (!plan) return { error: 'Plan de prévention introuvable.' };
  if (plan.status === 'clos') return { error: 'Ce plan est clos.' };
  if (!inspectionDone(plan, now)) return { error: "Réalisez l'inspection commune préalable avant de recueillir les signatures." };
  if (!plan.measures.trim()) return { error: 'Complétez les mesures de prévention avant de recueillir les signatures.' };
  if (plan.inspectionOn && signedOn! < plan.inspectionOn) {
    return { error: "La signature ne peut pas précéder l'inspection commune.", fieldErrors: { signedEeOn: `Au plus tôt le jour de l'inspection commune.` } };
  }
  const next = { ...plan, signedEeOn: signedOn };
  await db.update(t.preventionPlans).set({ signedEeOn: signedOn, status: planStatus(next, now) }).where(eq(t.preventionPlans.id, id));
  for (const file of files) await saveUpload(file, PLAN_ATTACHMENT, id, session.user.id);
  return done(id);
}

/**
 * Clôture du plan. Un plan obligatoire (selon la règle du site) non signé se clôt si l'intervention n'a pas commencé
 * (intervention annulée), ou après la fin de l'intervention une fois l'écart tracé par une action
 * du plan d'actions unique ; jamais pendant l'intervention. Les permis rattachés doivent être clos ou annulés.
 */
export async function closePlan(id: string): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const { db, plan } = await loadPlan(id);
  if (!plan) return { error: 'Plan de prévention introuvable.' };
  if (plan.status === 'clos') return { error: 'Ce plan est déjà clos.' };
  const now = today();
  if (isMandatory(plan, await siteRule(db, plan.siteId)) && !isFullySigned(plan) && plan.startOn <= now) {
    if (plan.endOn >= now) return { error: 'Intervention en cours avec un plan obligatoire non signé : enregistrez les signatures des deux entreprises avant de clore le plan.' };
    const actions = await db.select({ id: t.actions.id }).from(t.actions)
      .where(and(eq(t.actions.origin, 'prevention'), eq(t.actions.originRef, plan.id)));
    if (!actions.length) return { error: "Intervention réalisée sans plan signé : créez l'action qui trace l'écart avant de clore le plan." };
  }
  const open = (await db.select().from(t.permits).where(eq(t.permits.preventionPlanId, plan.id))).filter(isOpenPermit);
  if (open.length) return { error: `Permis rattachés encore actifs (${open.map((p) => p.id).join(', ')}) : clôturez-les ou annulez-les avant de clore le plan.` };
  await db.update(t.preventionPlans).set({ status: 'clos' }).where(eq(t.preventionPlans.id, id));
  revalidatePath('/', 'layout');
  return {};
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
    db.select({ id: t.contractors.id, name: t.contractors.name }).from(t.contractors),
    db.select().from(t.preventionPlans),
    db.select({ id: t.keystoneProjects.id, client: t.keystoneProjects.client }).from(t.keystoneProjects),
  ]);
  if (siteId && !sites.some((s) => s.id === siteId)) f.fail('siteId', 'Site inconnu.');
  if (contractorId && !contractors.some((c) => c.id === contractorId)) f.fail('contractorId', 'Entreprise introuvable.');
  const [existing] = id ? await db.select().from(t.permits).where(eq(t.permits.id, id)) : [];
  if (id && !existing) return { error: 'Permis introuvable.' };
  if (existing && existing.status !== 'demande') return { error: 'Un permis délivré, clos ou annulé ne se modifie plus.' };
  if (existing && existing.type !== type) f.fail('type', "Le type d'un permis ne change pas après sa création.");
  if (preventionPlanId) {
    const plan = plans.find((p) => p.id === preventionPlanId);
    if (!plan) f.fail('preventionPlanId', 'Plan de prévention introuvable.');
    else if (plan.status === 'clos' && plan.id !== existing?.preventionPlanId) f.fail('preventionPlanId', 'Ce plan de prévention est clos.');
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
    await db.update(t.permits).set(values).where(eq(t.permits.id, existing.id));
    return done(existing.id);
  }
  const ids = (await db.select({ id: t.permits.id }).from(t.permits)).map((r) => r.id);
  const newId = nextRef(ids, `${PERMIT_TYPES[type!].prefix}-${today().slice(0, 4)}-`, 3);
  await db.insert(t.permits).values({ id: newId, ...values, status: 'demande' });
  return done(newId);
}

async function loadPermit(id: string) {
  const db = await getDb();
  const [permit] = await db.select().from(t.permits).where(eq(t.permits.id, id));
  return { db, permit };
}

/** Coche ou décoche un point de la check-list d'un permis demandé. */
export async function setPermitCheck(id: string, index: number, checked: boolean): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const { db, permit } = await loadPermit(id);
  if (!permit) return { error: 'Permis introuvable.' };
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
  const { db, permit } = await loadPermit(id);
  if (!permit) return { error: 'Permis introuvable.' };
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
  await db.update(t.permits).set({ status: 'delivre', issuerId: session.user.id }).where(eq(t.permits.id, id));
  revalidatePath('/', 'layout');
  return {};
}

/**
 * Rattache un plan de prévention au permis demandé ou délivré d'une entreprise extérieure (régularisation d'un écart) :
 * plan non clos, du même site et de la même entreprise, couvrant la validité du permis. Un permis délivré ne peut
 * être rattaché qu'à un plan en règle (signé s'il est exigé) : le rattachement ne doit pas contourner la délivrance.
 */
export async function linkPermitPlan(id: string, planId: string): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const { db, permit } = await loadPermit(id);
  if (!permit) return { error: 'Permis introuvable.' };
  if (!isOpenPermit(permit)) return { error: 'Ce permis est clos ou annulé.' };
  if (!permit.contractorId) return { error: "Permis d'une intervention interne : indiquez l'entreprise extérieure en modifiant la demande." };
  const [plan] = await db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, String(planId)));
  if (!plan) return { error: 'Plan de prévention introuvable.' };
  if (plan.status === 'clos') return { error: `Le plan de prévention ${plan.id} est clos.` };
  if (plan.siteId !== permit.siteId) return { error: 'Ce plan concerne un autre site.' };
  if (plan.contractorId !== permit.contractorId) return { error: 'Ce plan concerne une autre entreprise extérieure.' };
  const { from, to } = permitDays(permit);
  if (!planCovers(plan, from, to)) return { error: `Ce plan (${fmtPeriod(plan.startOn, plan.endOn)}) ne couvre pas la validité du permis.` };
  if (permit.status === 'delivre') {
    const issue = permitPlanIssue({ ...permit, preventionPlanId: plan.id }, plan, await siteRule(db, permit.siteId));
    if (issue) return { error: `${issue} Un permis délivré ne peut être rattaché qu'à un plan en règle.` };
  }
  await db.update(t.permits).set({ preventionPlanId: plan.id }).where(eq(t.permits.id, id));
  revalidatePath('/', 'layout');
  return {};
}

/** Clôt le permis en fin de travaux (après la ronde de surveillance pour un permis de feu, confirmée dans la fiche). */
export async function closePermit(id: string): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const { db, permit } = await loadPermit(id);
  if (!permit) return { error: 'Permis introuvable.' };
  if (permit.status !== 'delivre') return { error: 'Seul un permis délivré peut être clos.' };
  const now = referenceNow(today());
  if (permit.validFrom > now) return { error: "Les travaux n'ont pas commencé : annulez le permis plutôt que de le clore." };
  await db.update(t.permits).set({ status: 'clos', closedAt: now }).where(eq(t.permits.id, id));
  revalidatePath('/', 'layout');
  return {};
}

/** Annule un permis demandé ou délivré. */
export async function cancelPermit(id: string): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const { db, permit } = await loadPermit(id);
  if (!permit) return { error: 'Permis introuvable.' };
  if (permit.status !== 'demande' && permit.status !== 'delivre') return { error: 'Ce permis est déjà clos ou annulé.' };
  await db.update(t.permits).set({ status: 'annule', closedAt: referenceNow(today()) }).where(eq(t.permits.id, id));
  revalidatePath('/', 'layout');
  return {};
}
