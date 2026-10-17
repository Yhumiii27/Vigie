'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import {
  BENIGN_REGISTER_FIELD, DECLARANT_MAX, FIVE_M, HEALTH_DENIED, HEALTH_FILE_FIELD, HEALTH_FORM_FIELDS, HEALTH_LABELS, INJURY_KEYS, LOCATION_UNSPECIFIED,
  MAX_BATCH_BYTES, MAX_FILES_PER_BATCH, MAX_PHOTOS, MAX_PUBLIC_PHOTOS, MAX_PUBLIC_PHOTO_BYTES, MAX_TREE_LINES, MAX_WHYS, REPORTED_VIA, REPORT_TRAP_FIELD,
  advanceBlocker, analysisFilled, benignRegisterBlocker, cpamPending, declarationDuty, eventLockReason, hasNcOrigin, injuryLabel, missingQualification,
  neutralAccidentTitle, normalizeTree, qualificationInput, type D8Content, type ReportedVia, type TreeLine,
} from '@/components/events/shared';
import { canCreateAction } from '@/lib/action-rules';
import { REPORT_TOKEN_PARAM } from '@/lib/auth/paths';
import { config } from '@/lib/config';
import { loadFirstAiders } from '@/lib/data/events';
import { resolveReportToken } from '@/lib/data/report-posts';
import { fmtDate, fromParisLocal, parisDay, referenceNow, toParisLocal } from '@/lib/dates';
import { today } from '@/lib/today';
import {
  BENIGN_CAREGIVER_KEYS, D8_STEPS, ENV_ASPECTS, ENV_MEDIA, EVENT_STEPS, EVENT_TYPES, EVENT_TYPE_KEYS, METHODS, NC_ORIGINS, SEVERITY, STEP_CLOSED,
  STEP_QUALIFIED, VICTIM_KINDS, VICTIM_KIND_KEYS, canSeeHealth, type AnalysisMethod, type EventType, type VictimKind,
} from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireInSite, requireManager } from '@/lib/guard';
import { REPORT_LIMITS, ReportLimitError, anonymousPhoto, checkedPhoto, clientIp, countPostReport, hitReportLimit } from '@/lib/report-guard';
import { readReportToken } from '@/lib/report-token';
import { ALL_SITES, getOptionalSession, inSite, type Session } from '@/lib/session';
import { checkUpload, deleteAttachment, saveUpload } from '@/lib/uploads';
import { diffFields, logChange } from './changelog';
import { notifyReportOutcome } from './notify';
import { nextEntityReference } from './references';

const METHOD_KEYS = METHODS.map(([k]) => k);
const done = () => revalidatePath('/', 'layout');
const CONCURRENT = "L'événement vient d'être modifié par ailleurs : rechargez la page.";

type EventRow = typeof t.events.$inferSelect;

async function findEvent(db: DbOrTx, id: string): Promise<EventRow | undefined> {
  const [ev] = await db.select().from(t.events).where(eq(t.events.id, id));
  return ev;
}

type BenignRow = typeof t.benignAccidents.$inferSelect;

/** Inscription active (non annulée) de l'événement au registre des accidents bénins. */
async function activeBenign(db: DbOrTx, eventId: string): Promise<BenignRow | undefined> {
  const [row] = await db.select().from(t.benignAccidents).where(and(eq(t.benignAccidents.eventId, eventId), isNull(t.benignAccidents.cancelledAt)));
  return row;
}


/**
 * Date et heure saisies dans un champ datetime-local (heure de Paris) : invalide, postérieure à maintenant (date du jour
 * Vigie) ou antérieure à `notBefore` (jour « AAAA-MM-JJ » ou instant) → erreur sur le champ, null.
 */
function readLocalDateTime(f: Reader, name: string, opts: { required?: boolean; notBefore?: { day?: string | null; at?: Date | null; message: string } } = {}): Date | null {
  const raw = f.str(name, { required: opts.required });
  if (!raw) return null;
  const d = fromParisLocal(raw);
  if (!d) { f.fail(name, 'Date et heure invalides.'); return null; }
  if (d.getTime() > referenceNow(today()).getTime()) { f.fail(name, 'La date ne peut pas être postérieure à maintenant.'); return null; }
  const nb = opts.notBefore;
  if (nb && ((nb.day && parisDay(d) < nb.day) || (nb.at && d.getTime() < nb.at.getTime()))) { f.fail(name, nb.message); return null; }
  return d;
}

// ─── Workflow ───────────────────────────────────────────────────────────────

/**
 * Passe l'événement à l'étape suivante du workflow (règles : pilote et données propres au type pour « Qualifié », analyse
 * puis action liée pour « Actions », actions vérifiées pour « Efficacité vérifiée » ; clôture d'un AT par un rôle habilité,
 * déclaration CPAM saisie, inscription au registre des accidents bénins ou absence de déclaration motivée) et trace la transition.
 */
export async function advanceEvent(id: string): Promise<{ error?: string }> {
  const { session, error } = await requireManager();
  if (error) return { error: "Seuls l'animateur QHSE et l'encadrement font avancer un événement." };
  const db = await getDb();
  const ev = await findEvent(db, id);
  if (!ev) return { error: 'Événement introuvable.' };
  const siteError = await requireInSite(ev.siteId);
  if (siteError) return { error: siteError };
  const [linked, [analysis], entry] = await Promise.all([
    db.select({ status: t.actions.status }).from(t.actions).where(eq(t.actions.eventId, id)),
    db.select({ content: t.eventAnalyses.content }).from(t.eventAnalyses).where(and(eq(t.eventAnalyses.eventId, id), eq(t.eventAnalyses.method, ev.analysisMethod))),
    ev.type === 'AT' ? activeBenign(db, id) : undefined,
  ]);
  const health = canSeeHealth(session.role);
  const blocker = advanceBlocker(ev.step, linked, {
    pilotId: ev.pilotId, hasAnalysis: analysisFilled(ev.analysisMethod, analysis?.content), dismissed: !!ev.dismissedAt,
    methodLabel: METHODS.find(([k]) => k === ev.analysisMethod)?.[1] ?? ev.analysisMethod,
    missing: missingQualification(ev),
    canCreateActions: canCreateAction(session.role),
    accident: ev.type === 'AT' ? { health, cpamPending: cpamPending(ev, !!entry), benign: ev.injury === 'soins', duty: declarationDuty(ev) } : undefined,
  });
  if (blocker) return { error: blocker };
  const moved = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.events).set({ step: ev.step + 1 })
      .where(and(eq(t.events.id, id), eq(t.events.step, ev.step), isNull(t.events.dismissedAt))).returning({ id: t.events.id });
    if (!row) return false;
    await tx.insert(t.eventSteps).values({ eventId: id, kind: 'advance', fromStep: ev.step, toStep: ev.step + 1, byId: session.user.id });
    // TDB-06 : le déclarant est informé de la qualification et de la clôture de son signalement.
    const outcome = ev.step + 1 === STEP_QUALIFIED ? 'qualifie' : ev.step + 1 === STEP_CLOSED ? 'cloture' : null;
    if (outcome) await notifyReportOutcome(tx, ev, outcome, session.user);
    return true;
  });
  if (!moved) return { error: CONCURRENT };
  done();
  return {};
}

/**
 * Ramène l'événement à l'étape précédente (correction d'une erreur de workflow), ou rouvre un événement clôturé.
 * Animateur QHSE et direction, motif obligatoire (historique du workflow).
 */
export async function revertEvent(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const ev = await findEvent(db, id);
  if (!ev) return { error: 'Événement introuvable.' };
  const siteError = await requireInSite(ev.siteId);
  if (siteError) return { error: siteError };
  if (ev.dismissedAt) return { error: "Événement classé sans suite : annulez d'abord le classement." };
  if (ev.step <= 0) return { error: `L'événement est déjà à l'étape « ${EVENT_STEPS[0]} ».` };
  const kind = ev.step === STEP_CLOSED ? 'reopen' : 'revert';
  const moved = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.events).set({ step: ev.step - 1 }).where(and(eq(t.events.id, id), eq(t.events.step, ev.step))).returning({ id: t.events.id });
    if (!row) return false;
    await tx.insert(t.eventSteps).values({ eventId: id, kind, fromStep: ev.step, toStep: ev.step - 1, reason, byId: session.user.id });
    return true;
  });
  if (!moved) return { error: CONCURRENT };
  done();
  return { ok: true, id };
}

/**
 * Classe un événement sans suite (doublon, faux signalement, hors sujet) : jamais supprimé, exclu des indicateurs.
 * Animateur QHSE et direction, motif obligatoire ; refusé s'il porte encore des actions non abandonnées (une action
 * Vérifiée compte : elle reste rattachée à l'événement, qui ne peut plus être classé sans suite).
 */
export async function dismissEvent(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const ev = await findEvent(db, id);
  if (!ev) return { error: 'Événement introuvable.' };
  const siteError = await requireInSite(ev.siteId);
  if (siteError) return { error: siteError };
  const lock = eventLockReason(ev);
  if (lock) return { error: ev.dismissedAt ? 'Événement déjà classé sans suite.' : lock };
  const linked = await db.select({ id: t.actions.id }).from(t.actions).where(and(eq(t.actions.eventId, id), ne(t.actions.status, 'abandonnee')));
  if (linked.length) {
    const s = linked.length > 1 ? 's' : '';
    return { error: `${linked.length} action${s} liée${s} : abandonnez-${s ? 'les' : 'la'} d'abord dans le plan d'actions.` };
  }
  // Rôle validateur = rôle habilité aux données de santé : le message ne révèle rien à un autre rôle.
  if (await activeBenign(db, id)) return { error: "Annulez d'abord l'inscription au registre des accidents bénins." };
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.events).set({ dismissedAt: new Date(), dismissedById: session.user.id, dismissReason: reason })
      .where(and(eq(t.events.id, id), isNull(t.events.dismissedAt), eq(t.events.step, ev.step))).returning({ id: t.events.id });
    if (!row) return false;
    await tx.insert(t.eventSteps).values({ eventId: id, kind: 'dismiss', fromStep: ev.step, toStep: ev.step, reason, byId: session.user.id });
    await logChange(tx, { entityType: 'event', entityId: id, action: 'cancel', summary: 'Événement classé sans suite', reason, byId: session.user.id });
    await notifyReportOutcome(tx, ev, 'classe', session.user);
    return true;
  });
  if (!saved) return { error: CONCURRENT };
  done();
  return { ok: true, id };
}

/** Annule le classement sans suite : l'événement reprend son étape (animateur QHSE et direction, motif obligatoire). */
export async function restoreEvent(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const ev = await findEvent(db, id);
  if (!ev) return { error: 'Événement introuvable.' };
  const siteError = await requireInSite(ev.siteId);
  if (siteError) return { error: siteError };
  if (!ev.dismissedAt) return { error: "L'événement n'est pas classé sans suite." };
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.events).set({ dismissedAt: null, dismissedById: null, dismissReason: null })
      .where(and(eq(t.events.id, id), isNotNull(t.events.dismissedAt))).returning({ id: t.events.id });
    if (!row) return false;
    await tx.insert(t.eventSteps).values({ eventId: id, kind: 'restore', fromStep: ev.step, toStep: ev.step, reason, byId: session.user.id });
    await logChange(tx, { entityType: 'event', entityId: id, action: 'restore', summary: 'Classement sans suite annulé', reason, byId: session.user.id });
    return true;
  });
  if (!saved) return { error: CONCURRENT };
  done();
  return { ok: true, id };
}

export async function setAnalysisMethod(id: string, method: string): Promise<{ error?: string }> {
  const { error } = await requireManager();
  if (error) return { error };
  if (!METHOD_KEYS.includes(method as AnalysisMethod)) return { error: "Méthode d'analyse inconnue." };
  const db = await getDb();
  const ev = await findEvent(db, id);
  if (!ev) return { error: 'Événement introuvable.' };
  const blocked = eventLockReason(ev) ?? (await requireInSite(ev.siteId));
  if (blocked) return { error: blocked };
  await db.update(t.events).set({ analysisMethod: method }).where(eq(t.events.id, id));
  done();
  return {};
}

// ─── Fiche événement ────────────────────────────────────────────────────────

type Reader = ReturnType<typeof formReader>;

/**
 * Champs communs à la création et à la modification d'un événement (formulaire EventFields). `health` : rôle habilité
 * aux données de santé (SEC-06) ; sinon blessure, jours perdus, déclaration CPAM, lésions, soins et réserves ne sont pas lus
 * (null). Rubriques de la déclaration d'accident du travail (EVT-01) : AT seulement ; client et référence : réclamation
 * client ; aspect et milieu : environnement (EVT-05). Un changement de type efface les rubriques de l'ancien type.
 */
function readEventForm(f: Reader, health: boolean) {
  const type = f.oneOf('type', EVENT_TYPE_KEYS, { required: true });
  const title = f.str('title', { required: true, max: 200 });
  const occurredOn = f.date('occurredOn', { required: true });
  const time = f.str('occurredTime');
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) f.fail('occurredTime', 'Heure invalide (HH:MM).');
  const occurredTime = time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
  const location = f.str('location', { required: true, max: 120 });
  const equipment = f.str('equipment', { max: 120 }) || null;
  const keystoneProject = f.opt('keystoneProject');
  const pilotId = f.opt('pilotId');
  const severity = f.int('severity', { required: true, min: 1, max: 4 });
  const siteId = f.str('siteId', { required: true });
  const description = f.str('description', { max: 4000 });
  const immediateMeasures = f.str('immediateMeasures', { max: 4000 });
  const ncOrigin = type && hasNcOrigin(type) ? f.oneOf('ncOrigin', NC_ORIGINS) : null;
  const at = type === 'AT';
  const text = (name: string, max: number) => (f.str(name, { max }) || null);
  // Déclaration d'accident du travail : victime (de l'effectif, ou intérimaire / personne extérieure déclarée), horaire,
  // connaissance par l'employeur (départ du délai de 48 h), activité, circonstances, témoins, tiers.
  const victimKind = at ? f.oneOf('victimKind', VICTIM_KIND_KEYS) : null;
  const victimId = at ? f.opt('victimId') : null;
  const declared = at && victimKind !== 'salarie';
  const victimName = declared ? text('victimName', 120) : null;
  const victimCompany = declared ? text('victimCompany', 120) : null;
  const workSchedule = at ? text('workSchedule', 80) : null;
  const knownAt = at ? readLocalDateTime(f, 'knownAt', { notBefore: { day: occurredOn, message: "La date ne peut pas précéder l'accident." } }) : null;
  const activity = at ? text('activity', 300) : null;
  const circumstances = at ? text('circumstances', 4000) : null;
  const witnesses = at ? text('witnesses', 1000) : null;
  const thirdParty = at ? text('thirdParty', 500) : null;
  const customer = type === 'RC' ? text('customer', 120) : null;
  const customerRef = type === 'RC' ? text('customerRef', 120) : null;
  const envAspect = type === 'ENV' ? f.oneOf('envAspect', ENV_ASPECTS) : null;
  const envMedium = type === 'ENV' ? f.oneOf('envMedium', ENV_MEDIA) : null;
  // Données de santé (SEC-06).
  const injury = health && at ? f.oneOf('injury', INJURY_KEYS) : null;
  const lostDays = injury === 'arret' ? f.int('lostDays', { min: 0, max: 3650 }) : null;
  // Déclaration CPAM : tout AT, premiers soins compris (le registre des accidents bénins est une faculté) ; refusée par
  // saveEvent pour un accident inscrit au registre.
  const cpamDeclaredOn = health && at ? f.date('cpamDeclaredOn') : null;
  const lesionNature = health && at ? text('lesionNature', 200) : null;
  const lesionSite = health && at ? text('lesionSite', 200) : null;
  const careGiven = health && at ? text('careGiven', 1000) : null;
  const reservesOn = health && at ? f.date('reservesOn') : null;
  const controlId = f.int('controlId', { min: 1 });
  const riskId = f.int('riskId', { min: 1 });
  const documentId = f.opt('documentId');
  const preventionPlanId = f.opt('preventionPlanId');
  const permitId = f.opt('permitId');
  const now = today();
  if (occurredOn && occurredOn > now) f.fail('occurredOn', "La date ne peut pas être postérieure à aujourd'hui.");
  if (cpamDeclaredOn && cpamDeclaredOn > now) f.fail('cpamDeclaredOn', "La date ne peut pas être postérieure à aujourd'hui.");
  if (cpamDeclaredOn && occurredOn && cpamDeclaredOn < occurredOn) f.fail('cpamDeclaredOn', "La déclaration ne peut pas précéder l'accident.");
  if (reservesOn && reservesOn > now) f.fail('reservesOn', "La date ne peut pas être postérieure à aujourd'hui.");
  if (reservesOn && cpamDeclaredOn && reservesOn < cpamDeclaredOn) f.fail('reservesOn', 'Les réserves ne peuvent pas précéder la déclaration.');
  return {
    type: type as EventType, title, occurredOn: occurredOn!, occurredTime, location, equipment, keystoneProject, pilotId, severity: severity!, siteId,
    description, immediateMeasures, ncOrigin,
    victimKind, victimId, victimName, victimCompany, workSchedule, knownAt, activity, circumstances, witnesses, thirdParty,
    customer, customerRef, envAspect, envMedium,
    injury, lostDays, cpamDeclaredOn, lesionNature, lesionSite, careGiven, reservesOn,
    controlId, riskId, documentId, preventionPlanId, permitId,
  };
}
type EventValues = ReturnType<typeof readEventForm>;

/** Le formulaire porte-t-il une donnée de santé (champ renseigné) ? Refusé pour un rôle non habilité (SEC-06). */
const submitsHealth = (fd: FormData) => HEALTH_FORM_FIELDS.some((k) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v.trim() !== '' : v != null;
});

/**
 * Vérifie les références saisies (site, pilote, projet, rattachements du même site que l'événement) ; complète le plan
 * de prévention d'après le permis. `current` : valeurs déjà enregistrées, admises même si elles ne seraient plus proposées
 * (projet saisi avant la synchronisation Keystone, équipement réformé depuis).
 */
async function validateEventRefs(db: DbOrTx, f: Reader, v: EventValues, current?: EventRow) {
  const [people, projects, [control], [risk], [doc], [plan], [permit]] = await Promise.all([
    db.select({ id: t.people.id, leftOn: t.people.leftOn }).from(t.people),
    db.select({ id: t.keystoneProjects.id, client: t.keystoneProjects.client }).from(t.keystoneProjects),
    v.controlId != null ? db.select({ siteId: t.controls.siteId, archivedAt: t.controls.archivedAt }).from(t.controls).where(eq(t.controls.id, v.controlId)) : [],
    v.riskId != null
      ? db.select({ siteId: t.workUnits.siteId, archivedAt: t.risks.archivedAt }).from(t.risks).innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id)).where(eq(t.risks.id, v.riskId))
      : [],
    v.documentId ? db.select({ siteId: t.documents.siteId }).from(t.documents).where(eq(t.documents.id, v.documentId)) : [],
    v.preventionPlanId ? db.select({ siteId: t.preventionPlans.siteId }).from(t.preventionPlans).where(eq(t.preventionPlans.id, v.preventionPlanId)) : [],
    v.permitId ? db.select({ siteId: t.permits.siteId, planId: t.permits.preventionPlanId }).from(t.permits).where(eq(t.permits.id, v.permitId)) : [],
  ]);
  // Site actif exigé pour une création ou un changement de site.
  if (!current || v.siteId !== current.siteId) {
    const siteError = await requireInSite(v.siteId, { create: true });
    if (siteError) f.fail('siteId', siteError);
  }
  if (v.pilotId && !people.some((p) => p.id === v.pilotId)) f.fail('pilotId', 'Personne inconnue.');
  // Victime de l'effectif : présente à la date de l'accident (la victime déjà enregistrée reste admise, sortie depuis).
  if (v.victimId && v.victimId !== current?.victimId) {
    const victim = people.find((p) => p.id === v.victimId);
    if (!victim) f.fail('victimId', 'Personne inconnue.');
    else if (victim.leftOn && victim.leftOn <= v.occurredOn) f.fail('victimId', "Personne sortie de l'effectif à la date de l'accident.");
  }
  if (v.keystoneProject && v.keystoneProject !== current?.keystoneProject && !projects.some((p) => `${p.id} · ${p.client}` === v.keystoneProject)) {
    f.fail('keystoneProject', 'Projet Keystone inconnu.');
  }
  // Contrôle, unité de travail et document sans site (null) valent pour tous les sites.
  if (v.controlId != null) {
    if (!control) f.fail('controlId', 'Contrôle périodique inconnu.');
    else if (!inSite(v.siteId, control.siteId)) f.fail('controlId', "Cet équipement relève d'un autre site.");
    else if (control.archivedAt && v.controlId !== current?.controlId) f.fail('controlId', 'Équipement réformé : choisissez un équipement en service.');
  }
  if (v.riskId != null) {
    if (!risk) f.fail('riskId', 'Risque inconnu.');
    else if (!inSite(v.siteId, risk.siteId)) f.fail('riskId', "Ce risque concerne une unité de travail d'un autre site.");
    else if (risk.archivedAt && v.riskId !== current?.riskId) f.fail('riskId', 'Risque archivé : choisissez un risque du DUERP en vigueur.');
  }
  if (v.documentId) {
    if (!doc) f.fail('documentId', 'Document inconnu.');
    else if (!inSite(v.siteId, doc.siteId)) f.fail('documentId', 'Ce document concerne un autre site.');
  }
  if (v.preventionPlanId) {
    if (!plan) f.fail('preventionPlanId', 'Plan de prévention inconnu.');
    else if (plan.siteId !== v.siteId) f.fail('preventionPlanId', 'Ce plan concerne un autre site.');
  }
  if (v.permitId) {
    if (!permit) f.fail('permitId', 'Permis inconnu.');
    else if (permit.siteId !== v.siteId) f.fail('permitId', 'Ce permis concerne un autre site.');
    else if (permit.planId && v.preventionPlanId && permit.planId !== v.preventionPlanId) f.fail('permitId', `Ce permis relève du plan ${permit.planId}.`);
    else if (permit.planId && !v.preventionPlanId) v.preventionPlanId = permit.planId;
  }
}

const LABELS: Partial<Record<keyof EventValues, string>> = {
  type: 'Type', title: 'Intitulé', occurredOn: 'Date', occurredTime: 'Heure', location: 'Lieu', equipment: 'Équipement', keystoneProject: 'Projet Keystone',
  pilotId: 'Pilote', severity: 'Gravité potentielle', siteId: 'Site', description: 'Description', immediateMeasures: 'Mesures immédiates',
  ncOrigin: 'Origine',
  victimKind: 'Statut de la victime', victimId: 'Victime', victimName: 'Victime (nom déclaré)', victimCompany: 'Entreprise de la victime',
  workSchedule: 'Horaire de travail', knownAt: "Connu de l'employeur le", activity: 'Activité de la victime', circumstances: 'Circonstances',
  witnesses: 'Témoins', thirdParty: 'Tiers impliqué', customer: 'Client', customerRef: 'Référence client',
  envAspect: 'Aspect environnemental', envMedium: 'Milieu',
  // Données de santé saisies dans le formulaire (jamais les colonnes de l'absence de déclaration motivée : pas de faux écart).
  ...Object.fromEntries(HEALTH_FORM_FIELDS.map((k) => [k, HEALTH_LABELS[k]])),
  controlId: 'Équipement contrôlé', riskId: 'Risque du DUER', documentId: 'Document', preventionPlanId: 'Plan de prévention', permitId: 'Permis',
};
// Les textes longs sont signalés comme modifiés sans recopier leur contenu dans le journal.
const LONG: (keyof EventValues)[] = ['description', 'immediateMeasures', 'circumstances', 'activity', 'witnesses', 'careGiven'];

/**
 * Modifie la fiche d'un événement (qualification par l'animateur QHSE ou l'encadrement). Un événement qualifié garde son
 * pilote et les données propres à son type (EVT-05) ; un accident inscrit au registre des accidents bénins garde son type
 * et sa blessure « premiers soins » (bascule en déclaration CPAM : escalateBenignAccident).
 */
export async function saveEvent(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  // Données de santé d'un AT (SEC-06) : saisies par l'animateur QHSE et la direction seulement.
  const health = canSeeHealth(session.role);
  if (!health && submitsHealth(fd)) return { error: HEALTH_DENIED };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const read = readEventForm(f, health);
  if (!f.ok) return f.state();

  const db = await getDb();
  const ev = await findEvent(db, id);
  if (!ev) return { error: 'Événement introuvable.' };
  const blocked = eventLockReason(ev) ?? (await requireInSite(ev.siteId));
  if (blocked) return { error: blocked };
  // Rôle non habilité : données de santé enregistrées conservées ; un AT garde son type (le requalifier effacerait
  // ses données de santé et le retirerait des taux de fréquence et de gravité).
  if (!health && ev.type === 'AT' && read.type !== 'AT') f.fail('type', "Seuls l'animateur QHSE et la direction requalifient un accident du travail.");
  const v: EventValues = health ? read : { ...read, ...Object.fromEntries(HEALTH_FORM_FIELDS.map((k) => [k, ev[k]])) };
  if (ev.step >= STEP_QUALIFIED) {
    if (!v.pilotId) f.fail('pilotId', 'Un événement qualifié garde un pilote désigné.');
    for (const k of missingQualification(v)) f.fail(qualificationInput(k, v), 'Requis pour un événement qualifié.');
  }
  // Registre des accidents bénins (rôle habilité seulement : les autres ne modifient ni le type d'un AT ni sa blessure).
  // Un changement de site est admis : l'inscription reste au registre du site où elle a été faite.
  const entry = health && ev.type === 'AT' ? await activeBenign(db, id) : undefined;
  if (entry && v.type !== 'AT') f.fail('type', "Inscrit au registre des accidents bénins : annulez d'abord l'inscription.");
  else if (entry && !entry.escalatedAt && v.injury !== 'soins') f.fail('injury', 'Inscrit au registre des accidents bénins : utilisez « Basculer en déclaration CPAM ».');
  else if (entry?.escalatedAt && v.injury === 'soins') f.fail('injury', 'Accident basculé en déclaration CPAM : la blessure ne revient pas aux premiers soins.');
  if (entry && !entry.escalatedAt && v.cpamDeclaredOn) f.fail('cpamDeclaredOn', 'Inscrit au registre des accidents bénins : utilisez « Basculer en déclaration CPAM », ou annulez l’inscription.');
  await validateEventRefs(db, f, v, ev);
  if (!f.ok) return f.state();

  const people = new Map((await db.select({ id: t.people.id, name: t.people.name }).from(t.people)).map((p) => [p.id, p.name]));
  const fmt = (k: keyof EventValues) => (x: unknown): string | null => {
    if (x == null || x === '') return null;
    if (k === 'pilotId' || k === 'victimId') return people.get(String(x)) ?? String(x);
    if (k === 'type') return EVENT_TYPES[x as EventType]?.label ?? String(x);
    if (k === 'severity') return SEVERITY[Number(x)] ?? String(x);
    if (k === 'injury') return injuryLabel(String(x));
    if (k === 'victimKind') return VICTIM_KINDS[x as VictimKind] ?? String(x);
    if (k === 'knownAt') return x instanceof Date ? toParisLocal(x).replace(/^(\d{4})-(\d{2})-(\d{2})T/, '$3/$2/$1 ') : String(x);
    if (k === 'occurredOn' || k === 'cpamDeclaredOn' || k === 'reservesOn') return fmtDate(String(x));
    return String(x);
  };
  // Textes longs : comparés en entier, journalisés sans leur contenu.
  const details = (Object.keys(LABELS) as (keyof EventValues)[]).flatMap((k) => {
    if (!LONG.includes(k)) return diffFields({ [k]: ev[k] } as Record<string, unknown>, { [k]: v[k] }, { [k]: LABELS[k] }, fmt(k));
    const before = String(ev[k] ?? ''), after = String(v[k] ?? '');
    return before === after ? [] : [{ field: LABELS[k]!, from: before ? '(texte précédent)' : null, to: after ? '(texte modifié)' : null }];
  });

  await db.transaction(async (tx) => {
    await tx.update(t.events).set(v).where(eq(t.events.id, id));
    // Les actions rattachées au site de l'événement le suivent s'il change de site ; chacune trace le changement dans son
    // historique (ACT-03), dans la même transaction.
    if (v.siteId !== ev.siteId) {
      const moved = await tx.update(t.actions).set({ siteId: v.siteId })
        .where(and(eq(t.actions.eventId, id), eq(t.actions.siteId, ev.siteId))).returning({ id: t.actions.id });
      if (moved.length) {
        const labels = new Map((await tx.select({ id: t.sites.id, label: t.sites.label }).from(t.sites)).map((s) => [s.id, s.label]));
        for (const a of moved) {
          await logChange(tx, {
            entityType: 'action', entityId: a.id, action: 'update', byId: session.user.id,
            summary: `Site modifié avec l'événement ${id}`,
            details: [{ field: 'Site', from: labels.get(ev.siteId) ?? ev.siteId, to: labels.get(v.siteId) ?? v.siteId }],
          });
        }
      }
    }
    if (details.length) await logChange(tx, { entityType: 'event', entityId: id, action: 'update', summary: 'Fiche modifiée', details });
  });
  done();
  return { ok: true, id };
}

/** Prochaine référence d'événement de l'année (EV-AAAA-n), sous verrou dans la transaction de création (PRD-08). */
const nextEventId = (tx: DbOrTx) => nextEntityReference(tx, 'event', `EV-${today().slice(0, 4)}-`);

/**
 * Crée un événement complet depuis le bureau (saisie a posteriori : réclamation reçue par mail, NC d'audit, AT déclaré
 * par téléphone…) — animateur QHSE et encadrement. L'événement démarre à l'étape « Déclaré ».
 */
export async function createEvent(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  // Données de santé d'un AT (SEC-06) : complétées ensuite par l'animateur QHSE ou la direction pour les autres rôles.
  const health = canSeeHealth(session.role);
  if (!health && submitsHealth(fd)) return { error: HEALTH_DENIED };
  const f = formReader(fd);
  const v = readEventForm(f, health);
  const declarantId = f.opt('declarantId');
  const declarant = f.str('declarant', { max: 120 });
  if (!declarantId && !declarant) f.fail('declarant', 'Indiquez le déclarant externe, ou choisissez une personne.');
  if (!f.ok) return f.state();

  const db = await getDb();
  await validateEventRefs(db, f, v);
  const [person] = declarantId ? await db.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, declarantId)) : [];
  if (declarantId && !person) f.fail('declarantId', 'Personne inconnue.');
  if (!f.ok) return f.state();

  const id = await db.transaction(async (tx) => {
    const id = await nextEventId(tx);
    await tx.insert(t.events).values({
      id, ...v, declarantId, declarant: person?.name ?? declarant, anonymous: false, step: 0,
    });
    await logChange(tx, { entityType: 'event', entityId: id, action: 'create', summary: 'Événement saisi depuis Vigie', byId: session.user.id });
    return id;
  });
  done();
  return { ok: true, id };
}

// ─── Accident du travail : déclaration CPAM (EVT-02) ────────────────────────

/** Contexte d'une action sur les données de santé d'un AT, ou refus (`fail`). */
type Checked<T> = { fail: FormState } | ({ fail?: undefined } & T);
type Db = Awaited<ReturnType<typeof getDb>>;

/** Contrôles communs aux actions sur les données de santé d'un AT : rôle validateur habilité, événement du site. */
async function healthEvent(fd: FormData, opts: { reason?: boolean } = {}): Promise<Checked<{ session: Session; db: Db; ev: EventRow; reason: string; f: Reader }>> {
  const { session, error } = await requireApprover();
  if (error) return { fail: { error } };
  if (!canSeeHealth(session.role)) return { fail: { error: HEALTH_DENIED } };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = opts.reason ? f.reason() : '';
  if (!f.ok) return { fail: f.state() };
  const db = await getDb();
  const ev = await findEvent(db, id);
  if (!ev) return { fail: { error: 'Événement introuvable.' } };
  const siteError = await requireInSite(ev.siteId);
  if (siteError) return { fail: { error: siteError } };
  if (ev.dismissedAt) return { fail: { error: 'Événement classé sans suite.' } };
  if (ev.type !== 'AT') return { fail: { error: 'Seul un accident du travail se déclare à la CPAM.' } };
  return { session, db, ev, reason, f };
}

const WAIVED = "Non déclarée par l'entreprise";

/**
 * Motive l'absence de déclaration CPAM d'un AT (EVT-02) : déclaration faite par l'entreprise de travail temporaire ou un
 * tiers, accident inscrit sur un registre papier, réserves… L'obligation sort des échéances et la clôture redevient
 * possible. Animateur QHSE et direction, motif obligatoire (donnée de santé, journal réservé aux rôles habilités) ;
 * admis sur un événement clôturé (accidents clôturés avant cette règle).
 */
export async function waiveCpamDeclaration(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await healthEvent(fd, { reason: true });
  if (r.fail) return r.fail;
  const { session, db, ev, reason } = r;
  if (ev.cpamDeclaredOn) return { error: `Déclaration CPAM déjà saisie (${fmtDate(ev.cpamDeclaredOn)}).` };
  if (ev.cpamWaivedAt) return { error: 'Absence de déclaration déjà motivée.' };
  const entry = await activeBenign(db, ev.id);
  if (!cpamPending(ev, !!entry)) return { error: `Accident inscrit au registre des accidents bénins (n° ${entry?.number}) : aucune déclaration à motiver.` };
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.events).set({ cpamWaivedAt: new Date(), cpamWaivedById: session.user.id, cpamWaiverReason: reason })
      .where(and(eq(t.events.id, ev.id), isNull(t.events.cpamWaivedAt), isNull(t.events.cpamDeclaredOn))).returning({ id: t.events.id });
    if (!row) return false;
    await logChange(tx, {
      entityType: 'event', entityId: ev.id, action: 'cpam-waiver', summary: 'Absence de déclaration CPAM motivée', reason, byId: session.user.id,
      details: [{ field: HEALTH_LABELS.cpamDeclaredOn, from: 'À déclarer', to: WAIVED }],
    });
    return true;
  });
  if (!saved) return { error: CONCURRENT };
  done();
  return { ok: true, id: ev.id };
}

/** Annule le motif d'absence de déclaration CPAM : l'obligation revient (échéance, clôture bloquée). Motif obligatoire. */
export async function cancelCpamWaiver(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await healthEvent(fd, { reason: true });
  if (r.fail) return r.fail;
  const { session, db, ev, reason } = r;
  if (!ev.cpamWaivedAt) return { error: "Aucune absence de déclaration motivée sur cet accident." };
  const entry = await activeBenign(db, ev.id);
  const after = cpamPending({ ...ev, cpamWaivedAt: null }, !!entry) ? 'À déclarer' : 'Registre des accidents bénins';
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.events).set({ cpamWaivedAt: null, cpamWaivedById: null, cpamWaiverReason: null })
      .where(and(eq(t.events.id, ev.id), isNotNull(t.events.cpamWaivedAt))).returning({ id: t.events.id });
    if (!row) return false;
    await logChange(tx, {
      entityType: 'event', entityId: ev.id, action: 'cpam-waiver-cancel', summary: 'Motif d’absence de déclaration CPAM annulé', reason, byId: session.user.id,
      details: [{ field: HEALTH_LABELS.cpamDeclaredOn, from: WAIVED, to: after }],
    });
    return true;
  });
  if (!saved) return { error: CONCURRENT };
  done();
  return { ok: true, id: ev.id };
}

// ─── Registre des accidents bénins (EVT-04) ─────────────────────────────────
// Un registre par site (art. L. 441-4 et D. 441-1 à D. 441-4 CSS) : accident sans arrêt ni soins médicaux (premiers soins)
// soigné par un secouriste de l'effectif (titre SST valide à la date des soins) ou un professionnel de santé. Numéro
// d'ordre continu par site, jamais réattribué (annulation motivée) ; visas de la victime et du donneur de soins recueillis
// sur le registre imprimé (date seulement) ; arrêt ou soins médicaux connus ensuite : bascule en déclaration CPAM.
// Données de santé : animateur QHSE et direction seulement, journal réservé (BENIGN_REGISTER_FIELD).

const CAREGIVER_KINDS = ['staff', 'pro'] as const;
const PRO_QUALIFICATIONS = BENIGN_CAREGIVER_KEYS.filter((k) => k !== 'sst');
const ENTRY_NOT_FOUND = 'Inscription au registre introuvable.';

/** Inscrit un accident bénin (premiers soins) au registre de son site. */
export async function registerBenignAccident(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  if (!canSeeHealth(session.role)) return { error: HEALTH_DENIED };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  if (!f.ok) return f.state();
  const db = await getDb();
  const ev = await findEvent(db, id);
  if (!ev) return { error: 'Événement introuvable.' };
  const blocked = (await requireInSite(ev.siteId, { create: true })) ?? eventLockReason(ev);
  if (blocked) return { error: blocked };
  // Premiers soins non déclarés, victime de l'effectif, mentions du registre saisies sur la fiche (victime, lieu,
  // circonstances, nature et siège des lésions).
  const refused = benignRegisterBlocker(ev);
  if (refused) return { error: refused };
  const existing = await activeBenign(db, id);
  if (existing) return { error: `Accident déjà inscrit au registre des accidents bénins (n° ${existing.number}).` };

  const careGivenAt = readLocalDateTime(f, 'careGivenAt', { required: true, notBefore: { day: ev.occurredOn, message: "Les soins ne peuvent pas précéder l'accident." } });
  const kind = f.oneOf('caregiverKind', CAREGIVER_KINDS, { required: true });
  const care = f.str('care', { required: true, max: 1000 });
  let caregiverId: string | null = null, caregiverName: string | null = null, qualification: string | null = null;
  if (kind === 'staff') {
    caregiverId = f.str('caregiverId', { required: true }) || null;
    qualification = 'sst';
    if (caregiverId && careGivenAt) {
      const aiders = await loadFirstAiders(ev.siteId, parisDay(careGivenAt));
      if (!aiders.some((a) => a.id === caregiverId)) f.fail('caregiverId', 'Sans titre de secouriste du travail (SST) valide à la date des soins sur ce site.');
    }
  } else if (kind === 'pro') {
    caregiverName = f.str('caregiverName', { required: true, max: 120 }) || null;
    qualification = f.oneOf('caregiverQualification', PRO_QUALIFICATIONS, { required: true });
  }
  if (!f.ok || !careGivenAt || !qualification) return f.state();

  const result = await db.transaction(async (tx) => {
    // Verrou du site : numérotation sans doublon entre deux inscriptions simultanées.
    const [site] = await tx.select({ id: t.sites.id, label: t.sites.label }).from(t.sites).where(eq(t.sites.id, ev.siteId)).for('update');
    const [cur] = await tx.select().from(t.events).where(eq(t.events.id, id)).for('update');
    if (!cur || benignRegisterBlocker(cur) || eventLockReason(cur) || (await activeBenign(tx, id))) return null;
    const [{ max }] = await tx.select({ max: sql<number | null>`max(${t.benignAccidents.number})` }).from(t.benignAccidents).where(eq(t.benignAccidents.siteId, ev.siteId));
    const number = (Number(max) || 0) + 1;
    await tx.insert(t.benignAccidents).values({
      siteId: ev.siteId, number, eventId: id, careGivenAt, caregiverId, caregiverName, caregiverQualification: qualification!, care, createdById: session.user.id,
    });
    await logChange(tx, {
      entityType: 'event', entityId: id, action: 'register', summary: 'Inscrit au registre des accidents bénins', byId: session.user.id,
      details: [{ field: BENIGN_REGISTER_FIELD, from: null, to: `n° ${number} · ${(site?.label ?? ev.siteId).split(' — ')[0]}` }],
    });
    return number;
  });
  if (result == null) return { error: CONCURRENT };
  done();
  return { ok: true, id };
}

/** Inscription active d'après son identifiant (formulaires du registre), avec les contrôles de rôle et de site. */
async function benignEntry(fd: FormData, opts: { reason?: boolean } = {}): Promise<Checked<{ session: Session; db: Db; entry: BenignRow; reason: string; f: Reader }>> {
  const { session, error } = await requireApprover();
  if (error) return { fail: { error } };
  if (!canSeeHealth(session.role)) return { fail: { error: HEALTH_DENIED } };
  const f = formReader(fd);
  const entryId = f.int('id', { required: true, min: 1 });
  const reason = opts.reason ? f.reason() : '';
  if (!f.ok || entryId == null) return { fail: f.state() };
  const db = await getDb();
  const [entry] = await db.select().from(t.benignAccidents).where(eq(t.benignAccidents.id, entryId));
  if (!entry) return { fail: { error: ENTRY_NOT_FOUND } };
  const siteError = await requireInSite(entry.siteId);
  if (siteError) return { fail: { error: siteError } };
  if (entry.cancelledAt) return { fail: { error: 'Inscription annulée.' } };
  return { session, db, entry, reason, f };
}

/** Date des visas de la victime et du donneur de soins, recueillis sur le registre imprimé. */
export async function signBenignAccident(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await benignEntry(fd);
  if (r.fail) return r.fail;
  const { session, db, entry, f } = r;
  const signedOn = f.date('signedOn', { required: true });
  if (signedOn && signedOn < parisDay(entry.careGivenAt)) f.fail('signedOn', 'Les visas ne peuvent pas précéder les soins.');
  if (signedOn && signedOn > today()) f.fail('signedOn', "La date ne peut pas être postérieure à aujourd'hui.");
  if (!f.ok || !signedOn) return f.state();
  if (signedOn === entry.signedOn) return { ok: true, id: entry.eventId };
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.benignAccidents).set({ signedOn })
      .where(and(eq(t.benignAccidents.id, entry.id), isNull(t.benignAccidents.cancelledAt))).returning({ id: t.benignAccidents.id });
    if (!row) return false;
    await logChange(tx, {
      entityType: 'event', entityId: entry.eventId, action: 'register-sign', summary: 'Visas du registre des accidents bénins recueillis', byId: session.user.id,
      details: [{ field: BENIGN_REGISTER_FIELD, from: entry.signedOn ? `n° ${entry.number} · visé le ${fmtDate(entry.signedOn)}` : `n° ${entry.number} · visas à recueillir`, to: `n° ${entry.number} · visé le ${fmtDate(signedOn)}` }],
    });
    return true;
  });
  if (!saved) return { error: CONCURRENT };
  done();
  return { ok: true, id: entry.eventId };
}

/**
 * Bascule en déclaration CPAM d'un accident inscrit au registre (arrêt de travail ou soins médicaux connus ensuite) :
 * la blessure de la fiche change, l'inscription reste au registre (mention « basculé »), le délai de 48 h part de la date
 * de connaissance saisie.
 */
export async function escalateBenignAccident(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await healthEvent(fd);
  if (r.fail) return r.fail;
  const { session, db, ev, f } = r;
  const lock = eventLockReason(ev);
  if (lock) return { error: lock };
  const entry = await activeBenign(db, ev.id);
  if (!entry) return { error: 'Accident non inscrit au registre des accidents bénins.' };
  if (entry.escalatedAt) return { error: 'Accident déjà basculé en déclaration CPAM.' };
  const injury = f.oneOf('injury', ['arret', 'sans_arret'] as const, { required: true });
  const knownAt = readLocalDateTime(f, 'knownAt', { required: true, notBefore: { at: entry.careGivenAt, message: 'La date ne peut pas précéder les soins inscrits au registre.' } });
  const lostDays = injury === 'arret' ? f.int('lostDays', { min: 0, max: 3650 }) : null;
  if (!f.ok || !injury || !knownAt) return f.state();
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.events).set({ injury, lostDays })
      .where(and(eq(t.events.id, ev.id), eq(t.events.injury, 'soins'), isNull(t.events.dismissedAt), ne(t.events.step, STEP_CLOSED))).returning({ id: t.events.id });
    if (!row) return false;
    const [moved] = await tx.update(t.benignAccidents).set({ escalatedAt: knownAt, escalatedById: session.user.id })
      .where(and(eq(t.benignAccidents.id, entry.id), isNull(t.benignAccidents.cancelledAt), isNull(t.benignAccidents.escalatedAt))).returning({ id: t.benignAccidents.id });
    if (!moved) throw new Concurrent();
    await logChange(tx, {
      entityType: 'event', entityId: ev.id, action: 'register-escalate', summary: 'Accident bénin basculé en déclaration CPAM', byId: session.user.id,
      details: [
        { field: HEALTH_LABELS.injury, from: injuryLabel('soins'), to: injuryLabel(injury) },
        ...(lostDays != null ? [{ field: HEALTH_LABELS.lostDays, from: null, to: String(lostDays) }] : []),
        { field: BENIGN_REGISTER_FIELD, from: `Inscrit (n° ${entry.number})`, to: 'Basculé en déclaration CPAM' },
      ],
    });
    return true;
  }).catch((err) => { if (err instanceof Concurrent) return false; throw err; });
  if (!saved) return { error: CONCURRENT };
  done();
  return { ok: true, id: ev.id };
}

/** Annule une inscription au registre (erreur de saisie) : jamais supprimée, numéro non réattribué, motif obligatoire. */
export async function cancelBenignAccident(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await benignEntry(fd, { reason: true });
  if (r.fail) return r.fail;
  const { session, db, entry, reason } = r;
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.benignAccidents).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason })
      .where(and(eq(t.benignAccidents.id, entry.id), isNull(t.benignAccidents.cancelledAt))).returning({ id: t.benignAccidents.id });
    if (!row) return false;
    await logChange(tx, {
      entityType: 'event', entityId: entry.eventId, action: 'register-cancel', summary: 'Inscription au registre des accidents bénins annulée', reason, byId: session.user.id,
      details: [{ field: BENIGN_REGISTER_FIELD, from: `n° ${entry.number}`, to: 'Inscription annulée' }],
    });
    return true;
  });
  if (!saved) return { error: CONCURRENT };
  done();
  return { ok: true, id: entry.eventId };
}

/** Écriture concurrente détectée au milieu d'une transaction (annulée). */
class Concurrent extends Error {}

// ─── Analyse des causes ─────────────────────────────────────────────────────

const texts = (fd: FormData, name: string) => fd.getAll(name).map((v) => (typeof v === 'string' ? v.trim() : ''));

/** Enregistre le contenu de l'analyse des causes pour la méthode donnée (formats lus par la fiche événement). */
export async function saveAnalysis(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const eventId = f.str('eventId', { required: true });
  const method = f.oneOf('method', METHOD_KEYS, { required: true });
  if (!f.ok || !method) return { error: 'Analyse introuvable.' };

  let content: unknown;
  if (method === '5m') {
    const rows = FIVE_M.map((cat, i) => [cat, f.str(`m${i}`, { max: 1000 })] as [string, string]);
    if (!f.ok) return f.state();
    const filled = rows.filter(([, v]) => v);
    content = filled.length ? filled : null;
  } else if (method === 'tree') {
    const labels = texts(fd, 'tree_text');
    const levels = fd.getAll('tree_level');
    const mains = fd.getAll('tree_main');
    if (labels.some((l) => l.length > 300)) return { error: "Chaque ligne de l'arbre est limitée à 300 caractères." };
    const lines = labels
      .map((text, i) => ({ level: Number(levels[i]) || 0, text, main: mains[i] === '1' }))
      .filter((l) => l.text);
    if (lines.length > MAX_TREE_LINES) return { error: `L'arbre des causes est limité à ${MAX_TREE_LINES} lignes.` };
    content = lines.length ? normalizeTree(lines).map((l) => [l.level, l.text, l.main] as TreeLine) : null;
  } else if (method === 'why') {
    const whys = texts(fd, 'why').filter(Boolean);
    if (whys.length > MAX_WHYS) return { error: `${MAX_WHYS} « pourquoi » au maximum.` };
    if (whys.some((w) => w.length > 300)) return { error: 'Chaque « pourquoi » est limité à 300 caractères.' };
    content = whys.length ? whys : null;
  } else {
    const current = f.int('current', { required: true, min: 0, max: D8_STEPS.length });
    const notes = texts(fd, 'note').slice(0, D8_STEPS.length);
    if (notes.some((n) => n.length > 1000)) return { error: 'Chaque note est limitée à 1 000 caractères.' };
    if (!f.ok) return f.state();
    const value: D8Content = { current: current! };
    if (notes.some(Boolean)) value.notes = D8_STEPS.map((_, i) => notes[i] ?? '');
    content = value;
  }

  const db = await getDb();
  const ev = await findEvent(db, eventId);
  if (!ev) return { error: 'Événement introuvable.' };
  const blocked = eventLockReason(ev) ?? (await requireInSite(ev.siteId));
  if (blocked) return { error: blocked };
  const key = and(eq(t.eventAnalyses.eventId, eventId), eq(t.eventAnalyses.method, method));
  if (content === null) {
    await db.delete(t.eventAnalyses).where(key);
  } else {
    await db.insert(t.eventAnalyses).values({ eventId, method, content })
      .onConflictDoUpdate({ target: [t.eventAnalyses.eventId, t.eventAnalyses.method], set: { content } });
  }
  done();
  return { ok: true, id: eventId };
}

// ─── Pièces jointes ─────────────────────────────────────────────────────────

/**
 * Ajoute des photos ou documents à un événement (champ `files`, multipart). `health=1` : pièces médicales d'un AT
 * (certificat, avis d'arrêt, réserves…), réservées à l'animateur QHSE et à la direction (SEC-06).
 */
export async function addEventFiles(fd: FormData): Promise<{ error?: string; count?: number }> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const health = fd.get('health') === '1';
  if (health && !canSeeHealth(session.role)) return { error: HEALTH_DENIED };
  const f = formReader(fd);
  const eventId = f.str('eventId', { required: true });
  const files = f.files('files');
  if (!files.length) return { error: 'Choisissez au moins un fichier.' };
  if (files.length > MAX_FILES_PER_BATCH) return { error: `${MAX_FILES_PER_BATCH} fichiers au maximum par envoi.` };
  if (files.reduce((s, x) => s + x.size, 0) > MAX_BATCH_BYTES) return { error: `L'envoi dépasse ${MAX_BATCH_BYTES / 1024 / 1024} Mo : ajoutez les fichiers en plusieurs fois.` };
  const invalid = files.map(checkUpload).find(Boolean);
  if (invalid) return { error: invalid };
  const db = await getDb();
  const ev = await findEvent(db, eventId);
  if (!ev) return { error: 'Événement introuvable.' };
  const blocked = eventLockReason(ev) ?? (await requireInSite(ev.siteId));
  if (blocked) return { error: blocked };
  if (health && ev.type !== 'AT') return { error: "Pièces médicales : réservées aux accidents du travail." };
  for (const file of files) await saveUpload(file, 'event', eventId, session.user.id, { health });
  const n = files.length, s = n > 1 ? 's' : '';
  await logChange(null, {
    entityType: 'event', entityId: eventId, action: 'attach', byId: session.user.id,
    summary: health ? `${n} pièce${s} médicale${s} ajoutée${s}` : `${n} pièce${s} jointe${s} ajoutée${s}`,
    details: files.map((file) => ({ field: health ? HEALTH_FILE_FIELD : 'Fichier', from: null, to: file.name })),
  });
  done();
  return { count: files.length };
}

/** Retire une pièce jointe ajoutée par erreur (seule suppression admise, avant clôture), tracée au journal. */
export async function removeEventFile(attachmentId: string): Promise<{ error?: string }> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const db = await getDb();
  const [row] = await db.select({ entityType: t.attachments.entityType, entityId: t.attachments.entityId, fileName: t.attachments.fileName, health: t.attachments.health })
    .from(t.attachments).where(eq(t.attachments.id, attachmentId));
  // Pièce médicale pour un rôle non habilité : même réponse qu'une pièce absente (SEC-06).
  if (!row || row.entityType !== 'event' || (row.health && !canSeeHealth(session.role))) return { error: 'Pièce jointe introuvable.' };
  const ev = await findEvent(db, row.entityId);
  if (!ev) return { error: 'Événement introuvable.' };
  const blocked = eventLockReason(ev) ?? (await requireInSite(ev.siteId));
  if (blocked) return { error: blocked };
  await deleteAttachment(attachmentId);
  await logChange(null, {
    entityType: 'event', entityId: ev.id, action: 'detach', byId: session.user.id,
    summary: row.health ? 'Pièce médicale retirée' : 'Pièce jointe retirée', details: [{ field: row.health ? HEALTH_FILE_FIELD : 'Fichier', from: row.fileName, to: null }],
  });
  done();
  return {};
}

/**
 * Reclasse une pièce jointe d'un AT en pièce médicale (certificat joint parmi les photos…) : elle disparaît pour les rôles
 * non habilités. Sans retour : une erreur se corrige en retirant la pièce. Animateur QHSE et direction.
 */
export async function classifyEventFileAsMedical(attachmentId: string): Promise<{ error?: string }> {
  const { session, error } = await requireManager();
  if (error) return { error };
  if (!canSeeHealth(session.role)) return { error: HEALTH_DENIED };
  const db = await getDb();
  const [row] = await db.select({ entityType: t.attachments.entityType, entityId: t.attachments.entityId, fileName: t.attachments.fileName, health: t.attachments.health })
    .from(t.attachments).where(eq(t.attachments.id, attachmentId));
  if (!row || row.entityType !== 'event') return { error: 'Pièce jointe introuvable.' };
  if (row.health) return { error: 'Pièce déjà classée en pièce médicale.' };
  const ev = await findEvent(db, row.entityId);
  if (!ev) return { error: 'Événement introuvable.' };
  if (ev.type !== 'AT') return { error: "Pièces médicales : réservées aux accidents du travail." };
  const blocked = eventLockReason(ev) ?? (await requireInSite(ev.siteId));
  if (blocked) return { error: blocked };
  await db.transaction(async (tx) => {
    await tx.update(t.attachments).set({ health: true }).where(eq(t.attachments.id, attachmentId));
    await logChange(tx, {
      entityType: 'event', entityId: ev.id, action: 'classify', byId: session.user.id,
      summary: 'Pièce reclassée en pièce médicale (accès restreint)', details: [{ field: HEALTH_FILE_FIELD, from: null, to: row.fileName }],
    });
  });
  done();
  return {};
}

// ─── Signalement terrain ────────────────────────────────────────────────────

export type ReportResult = { id?: string; error?: string; warning?: string };

const REPORT_LIMITED = "Trop de signalements envoyés depuis ce poste ou ce réseau : réessayez dans une heure, ou prévenez directement l'animateur QHSE.";
const REPORT_POST_CEILING = "Ce poste a reçu trop de signalements sans compte depuis une heure : l'animateur QHSE est prévenu. Connectez-vous à Vigie pour signaler, ou prévenez-le directement.";
const REPORT_TOKEN_ERRORS = {
  revoked: "Ce QR code a été remplacé : scannez l'étiquette actuelle du poste, ou prévenez l'animateur QHSE.",
  invalid: "Ce QR code n'est pas reconnu : scannez l'étiquette du poste, ou prévenez l'animateur QHSE.",
} as const;

/**
 * Signalement terrain (formulaire /signaler) : crée l'événement à l'étape « Déclaré » et enregistre les photos jointes
 * (champ `photos`). Le QR code du poste (champ `jeton`, src/lib/report-token.ts) fixe le site ; le lieu est pré-rempli.
 * - Personne connectée (Entra ID, ou rôle choisi en démonstration), tous rôles : signalement en son nom (ou anonyme),
 *   suivi dans « Mes signalements ». Sans QR code valide : `siteId` d'un ancien QR code (?poste=&site=) s'il est dans
 *   son périmètre, sinon site sélectionné.
 * - Sans session (EVT-07) : seulement avec un jeton de poste valide ; anonyme ou nom + entreprise déclarés (jamais
 *   rattaché à une fiche), champ piège anti-robot, photos limitées et contrôlées sur leur contenu, limite de débit
 *   (src/lib/report-guard.ts) : tentatives par client, puis signalements enregistrés par poste et client et plafond du
 *   poste, comptés dans la transaction qui crée l'événement (une demande refusée ne consomme pas le quota du poste).
 * - Signalement anonyme, quel que soit le canal (SEC-09) : canal « terrain » (reported_via), photos renommées « photo-N ».
 * - Accident : intitulé neutre « Accident · lieu » (SEC-06), la description étant libre.
 */
export async function createReport(fd: FormData): Promise<ReportResult> {
  const f = formReader(fd);
  const session = await getOptionalSession();
  // Champ piège rempli : un robot. Réponse neutre, rien n'est enregistré.
  if (!session && f.str(REPORT_TRAP_FIELD)) return {};
  const type = f.str('type');
  if (!(EVENT_TYPE_KEYS as string[]).includes(type)) return { error: 'Choisissez le type de signalement.' };
  const description = f.str('description');
  if (!description) return { error: "Décrivez ce qui s'est passé." };
  if (description.length > 4000) return { error: 'La description est limitée à 4 000 caractères.' };
  const gravity = f.opt('gravity');
  const anonymous = f.bool('anonymous');
  const token = f.opt(REPORT_TOKEN_PARAM);
  const photos = f.files('photos');
  const maxPhotos = session ? MAX_PHOTOS : MAX_PUBLIC_PHOTOS;
  if (photos.length > maxPhotos) return { error: `${maxPhotos} photos au maximum.` };
  if (photos.reduce((s, p) => s + p.size, 0) > MAX_BATCH_BYTES) return { error: 'Les photos sont trop lourdes : retirez-en une.' };
  for (const p of photos) {
    if (!p.type.startsWith('image/')) return { error: `« ${p.name} » n'est pas une photo.` };
    if (!session && p.size > MAX_PUBLIC_PHOTO_BYTES) return { error: `« ${p.name} » dépasse ${MAX_PUBLIC_PHOTO_BYTES / 1024 / 1024} Mo.` };
    const err = checkUpload(p);
    if (err) return { error: err };
  }

  let report: { siteId: string; location: string; declarant: string | null; declarantId: string | null; declarantCompany: string | null; reportedVia: ReportedVia };
  let files = photos;
  /** Signalement sans compte : poste (version du QR code) et client, comptés à l'enregistrement. */
  let publicPost: { zoneId: number; name: string; version: number; client: string; secret: string } | null = null;
  if (session) {
    const { user, site, siteOptions } = session;
    const post = token ? await resolveReportToken(token) : null;
    // Site du QR code de poste (même hors du périmètre : la personne est au poste), sinon celui d'un ancien QR code
    // s'il est dans ses sites, sinon le site sélectionné (ou le premier site pour « Tous les sites »).
    const requestedSite = f.opt('siteId');
    const qrSite = post?.status === 'ok' ? post.post.siteId
      : requestedSite && siteOptions.some((s) => s.id === requestedSite && s.id !== ALL_SITES) ? requestedSite : null;
    const siteId = qrSite ?? (site.id === ALL_SITES ? siteOptions.find((s) => s.id !== ALL_SITES)?.id : site.id);
    if (!siteId) return { error: "Aucun site n'est encore configuré dans Vigie : le signalement ne peut pas être enregistré." };
    report = {
      siteId, location: f.str('location').slice(0, 120) || (post?.status === 'ok' ? post.post.name : LOCATION_UNSPECIFIED),
      declarant: anonymous ? null : user.name, declarantId: anonymous ? null : user.id, declarantCompany: null,
      reportedVia: anonymous ? REPORTED_VIA.anonymous : REPORTED_VIA.session,
    };
  } else {
    const name = anonymous ? '' : f.str('declarant').slice(0, DECLARANT_MAX);
    const company = anonymous ? '' : f.str('declarantCompany').slice(0, DECLARANT_MAX);
    if (!anonymous && !name) return { error: 'Indiquez votre nom, ou choisissez de rester anonyme.' };
    if (!token) return { error: "Scannez le QR code du poste pour signaler sans compte, ou connectez-vous à Vigie." };
    const secret = config().reportSecret;
    if (!secret) return { error: REPORT_TOKEN_ERRORS.invalid };
    // Photos d'un formulaire public : contrôlées sur leur contenu (type enregistré d'après celui-ci), avant tout compteur.
    const checked = await Promise.all(photos.map(checkedPhoto));
    const refused = photos.find((_, i) => !checked[i]);
    if (refused) return { error: `« ${refused.name} » n'est pas une photo.` };
    files = checked as File[];
    // Limite par client avant de vérifier le jeton (essais de jetons compris) ; celles du poste se comptent à l'enregistrement.
    const client = clientIp(await headers());
    if (!(await hitReportLimit('ip', client, secret))) return { error: REPORT_LIMITED };
    const post = await resolveReportToken(token);
    if (post.status !== 'ok') return { error: REPORT_TOKEN_ERRORS[post.status] };
    publicPost = { zoneId: post.post.zoneId, name: post.post.name, version: readReportToken(token)!.version, client, secret };
    report = {
      siteId: post.post.siteId, location: f.str('location').slice(0, 120) || post.post.name,
      declarant: name || null, declarantId: null, declarantCompany: company || null,
      reportedVia: anonymous ? REPORTED_VIA.anonymous : REPORTED_VIA.post,
    };
  }

  // Accident : intitulé neutre (la description peut décrire la lésion ; l'intitulé paraît dans les listes et les échéances, SEC-06).
  const firstSentence = description.split(/(?<=[.!?])\s/)[0];
  const title = type === 'AT' ? neutralAccidentTitle(report.location) : firstSentence.length > 90 ? `${firstSentence.slice(0, 87)}…` : firstSentence;
  // Signalement anonyme (tout canal, SEC-09) : noms d'origine des photos remplacés (date, nom, appareil…).
  if (anonymous) files = files.map((p, i) => anonymousPhoto(p, i));
  const severity = gravity === 'Oui' ? 3 : gravity === 'Peut-être' ? 2 : 1;
  const db = await getDb();
  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      // Sans compte : quota du poste compté avec l'événement (ReportLimitError annule la transaction, compteurs compris) ;
      // plafond du poste atteint → journal du site et alerte au responsable QHSE (loadReportPostSignals).
      if (publicPost) {
        const { ceilingReached } = await countPostReport(tx, publicPost, publicPost.client, publicPost.secret);
        if (ceilingReached) {
          await logChange(tx, {
            entityType: 'site', entityId: report.siteId, action: 'report-limit', byId: null,
            summary: `Poste « ${publicPost.name} » : plafond de ${REPORT_LIMITS.postTotal.max} signalements sans compte dans l'heure atteint, les suivants sont refusés — régénérez le QR code s'il circule hors du site`,
          });
        }
      }
      const id = await nextEventId(tx);
      await tx.insert(t.events).values({
        id,
        ...report,
        type: type as EventType,
        title,
        occurredOn: today(),
        anonymous,
        severity,
        step: 0,
        description,
      });
      return id;
    });
  } catch (err) {
    if (err instanceof ReportLimitError) return { error: err.scope === 'postTotal' ? REPORT_POST_CEILING : REPORT_LIMITED };
    throw err;
  }

  // Signalement anonyme ou sans compte : la photo n'est rattachée à aucune fiche.
  let warning: string | undefined;
  for (const p of files) {
    try {
      await saveUpload(p, 'event', id, report.declarantId);
    } catch {
      warning = "Le signalement est enregistré, mais une photo n'a pas pu l'être : transmettez-la à l'animateur QHSE.";
    }
  }
  done();
  return { id, warning };
}

/**
 * « Régénérer le QR » d'un poste (zone du plan de site) : la version signée dans le jeton change, les étiquettes déjà
 * imprimées n'ouvrent plus le formulaire sans compte (QR code arraché, photographié, diffusé hors du site…). Motif journalisé.
 */
export async function regenerateReportPost(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true });
  const reason = f.reason();
  if (!f.ok || id == null) return f.state();
  const db = await getDb();
  const [zone] = await db.select({ siteId: t.mapZones.siteId, name: t.mapZones.name }).from(t.mapZones).where(eq(t.mapZones.id, id));
  if (!zone) return { error: 'Poste introuvable : la zone a peut-être été supprimée du plan de site.' };
  const siteError = await requireInSite(zone.siteId);
  if (siteError) return { error: siteError };
  await db.transaction(async (tx) => {
    const [row] = await tx.update(t.mapZones).set({ qrVersion: sql`${t.mapZones.qrVersion} + 1` }).where(eq(t.mapZones.id, id))
      .returning({ version: t.mapZones.qrVersion });
    await logChange(tx, {
      entityType: 'site', entityId: zone.siteId, action: 'qr', byId: session.user.id, reason,
      summary: `QR code du poste « ${zone.name} » régénéré (version ${row.version}) : les étiquettes précédentes ne fonctionnent plus`,
    });
  });
  done();
  return { ok: true };
}
