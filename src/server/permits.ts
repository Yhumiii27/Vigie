'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  FIRE_WATCH_HOURS, PERMIT_DELIVERED, PERMIT_TYPES, PERMIT_TYPE_KEYS, activityLinkIssues, addHoursLocal, firstMinuteReason,
  firstMinuteRule, fmtPeriod, fromParisLocal, isPlanEnded, lcfirst, missingPresets, parseChecklist, permitDays, permitPlanIssue,
  planCovers, referenceNow, validityOver, type ChecklistItem,
} from '@/lib/rules/prevention';
import { today } from '@/lib/today';
import { formReader, type FormState } from '@/lib/forms';
import { requireInSite, requireManager } from '@/lib/guard';
import { diffFields, logChange } from './changelog';
import { nextEntityReference } from './references';
import { ARCHIVED_CONTRACTOR, done, isOpenPermit, linkedActivities, ok, siteRule, type Result } from './prevention-shared';

// Permis de feu et permis d'essai (QUA-26 : extrait de src/server/prevention.ts).

const MAX_CHECKLIST = 30;

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
  // PRV-11 : les activités de la carte rattachées (non annulées) restent sur le site et l'entreprise du permis, et
  // sa validité recoupe chacune d'elles.
  if (existing && siteId && validFrom && validTo && validTo > validFrom) {
    const days = permitDays({ validFrom, validTo });
    const issues = activityLinkIssues({ siteId, contractorId, from: days.from, to: days.to }, await linkedActivities(db, 'permit', existing.id), 'overlap');
    const named = (list: { title: string }[]) => list.map((a) => `« ${a.title} »`).join(', ');
    if (issues.site.length) f.fail('siteId', `Activités de la carte rattachées sur le site actuel (${named(issues.site)}) : modifiez-les avant de changer de site.`);
    if (issues.contractor.length) f.fail('contractorId', `Activités de la carte rattachées pour une autre entreprise (${named(issues.contractor)}) : modifiez-les avant de changer d'entreprise.`);
    if (issues.period.length) f.fail('validTo', `Activités de la carte rattachées hors de cette validité (${named(issues.period)}) : modifiez leurs dates ou leur permis.`);
  }
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
  const newId = await db.transaction(async (tx) => {
    const ref = await nextEntityReference(tx, 'permit', `${PERMIT_TYPES[type!].prefix}-${today().slice(0, 4)}-`, 3);
    await tx.insert(t.permits).values({ id: ref, ...values, status: 'demande' });
    await logChange(tx, { entityType: 'permit', entityId: ref, action: 'create', summary: 'Demande de permis enregistrée' });
    return ref;
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
    await logChange(tx, { entityType: 'permit', entityId: permit.id, action: 'status', summary: PERMIT_DELIVERED, byId: session.user.id });
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
