'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { and, eq, isNotNull, isNull, like, ne, sql } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import {
  DECLARANT_MAX, FIVE_M, HEALTH_DENIED, HEALTH_FIELDS, HEALTH_LABELS, INJURY_KEYS, MAX_BATCH_BYTES, MAX_FILES_PER_BATCH, MAX_PHOTOS, MAX_PUBLIC_PHOTOS, MAX_PUBLIC_PHOTO_BYTES,
  MAX_TREE_LINES, MAX_WHYS, REPORT_TRAP_FIELD, advanceBlocker, analysisFilled, eventLockReason, hasNcOrigin, injuryLabel, needsCpam,
  normalizeTree, type D8Content, type TreeLine,
} from '@/components/events/shared';
import { REPORT_TOKEN_PARAM } from '@/lib/auth/paths';
import { config } from '@/lib/config';
import { resolveReportToken } from '@/lib/data/report-posts';
import { fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import {
  D8_STEPS, EVENT_STEPS, EVENT_TYPES, EVENT_TYPE_KEYS, METHODS, NC_ORIGINS, SEVERITY, STEP_CLOSED, STEP_QUALIFIED,
  canSeeHealth, type AnalysisMethod, type EventType,
} from '@/lib/domain';
import { formReader, nextRef, type FormState } from '@/lib/forms';
import { requireApprover, requireInSite, requireManager } from '@/lib/guard';
import { REPORT_LIMITS, ReportLimitError, checkedPhoto, clientIp, countPostReport, hitReportLimit } from '@/lib/report-guard';
import { readReportToken } from '@/lib/report-token';
import { ALL_SITES, getOptionalSession, inSite } from '@/lib/session';
import { checkUpload, deleteAttachment, saveUpload } from '@/lib/uploads';
import { diffFields, logChange } from './changelog';

const METHOD_KEYS = METHODS.map(([k]) => k);
const done = () => revalidatePath('/', 'layout');
const CONCURRENT = "L'événement vient d'être modifié par ailleurs : rechargez la page.";

type EventRow = typeof t.events.$inferSelect;

async function findEvent(db: DbOrTx, id: string): Promise<EventRow | undefined> {
  const [ev] = await db.select().from(t.events).where(eq(t.events.id, id));
  return ev;
}

// ─── Workflow ───────────────────────────────────────────────────────────────

/**
 * Passe l'événement à l'étape suivante du workflow (règles : pilote pour « Qualifié », analyse puis action liée
 * pour « Actions », actions clôturées pour « Efficacité vérifiée ») et trace la transition.
 */
export async function advanceEvent(id: string): Promise<{ error?: string }> {
  const { session, error } = await requireManager();
  if (error) return { error: "Seuls l'animateur QHSE et l'encadrement font avancer un événement." };
  const db = await getDb();
  const ev = await findEvent(db, id);
  if (!ev) return { error: 'Événement introuvable.' };
  const siteError = await requireInSite(ev.siteId);
  if (siteError) return { error: siteError };
  const [linked, [analysis]] = await Promise.all([
    db.select({ status: t.actions.status }).from(t.actions).where(eq(t.actions.eventId, id)),
    db.select({ content: t.eventAnalyses.content }).from(t.eventAnalyses).where(and(eq(t.eventAnalyses.eventId, id), eq(t.eventAnalyses.method, ev.analysisMethod))),
  ]);
  const blocker = advanceBlocker(ev.step, linked, {
    pilotId: ev.pilotId, hasAnalysis: analysisFilled(ev.analysisMethod, analysis?.content), dismissed: !!ev.dismissedAt,
    methodLabel: METHODS.find(([k]) => k === ev.analysisMethod)?.[1] ?? ev.analysisMethod,
  });
  if (blocker) return { error: blocker };
  const moved = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.events).set({ step: ev.step + 1 })
      .where(and(eq(t.events.id, id), eq(t.events.step, ev.step), isNull(t.events.dismissedAt))).returning({ id: t.events.id });
    if (!row) return false;
    await tx.insert(t.eventSteps).values({ eventId: id, kind: 'advance', fromStep: ev.step, toStep: ev.step + 1, byId: session.user.id });
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
 * Animateur QHSE et direction, motif obligatoire ; refusé s'il porte encore des actions non annulées.
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
  const linked = await db.select({ id: t.actions.id }).from(t.actions).where(and(eq(t.actions.eventId, id), ne(t.actions.status, 'cancelled')));
  if (linked.length) {
    const s = linked.length > 1 ? 's' : '';
    return { error: `${linked.length} action${s} liée${s} : annulez-${s ? 'les' : 'la'} d'abord dans le plan d'actions.` };
  }
  const saved = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.events).set({ dismissedAt: new Date(), dismissedById: session.user.id, dismissReason: reason })
      .where(and(eq(t.events.id, id), isNull(t.events.dismissedAt), eq(t.events.step, ev.step))).returning({ id: t.events.id });
    if (!row) return false;
    await tx.insert(t.eventSteps).values({ eventId: id, kind: 'dismiss', fromStep: ev.step, toStep: ev.step, reason, byId: session.user.id });
    await logChange(tx, { entityType: 'event', entityId: id, action: 'cancel', summary: 'Événement classé sans suite', reason, byId: session.user.id });
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
 * aux données de santé (SEC-06) ; sinon blessure, jours perdus et déclaration CPAM ne sont pas lus (null).
 */
function readEventForm(f: Reader, health: boolean) {
  const type = f.oneOf('type', EVENT_TYPE_KEYS, { required: true });
  const title = f.str('title', { required: true, max: 200 });
  const occurredOn = f.date('occurredOn', { required: true });
  const location = f.str('location', { required: true, max: 120 });
  const equipment = f.str('equipment', { max: 120 }) || null;
  const keystoneProject = f.opt('keystoneProject');
  const pilotId = f.opt('pilotId');
  const severity = f.int('severity', { required: true, min: 1, max: 4 });
  const siteId = f.str('siteId', { required: true });
  const description = f.str('description', { max: 4000 });
  const immediateMeasures = f.str('immediateMeasures', { max: 4000 });
  const ncOrigin = type && hasNcOrigin(type) ? f.oneOf('ncOrigin', NC_ORIGINS) : null;
  const injury = health && type === 'AT' ? f.oneOf('injury', INJURY_KEYS) : null;
  const lostDays = injury === 'arret' ? f.int('lostDays', { min: 0, max: 3650 }) : null;
  const cpamDeclaredOn = health && type && needsCpam({ type, injury }) ? f.date('cpamDeclaredOn') : null;
  const controlId = f.int('controlId', { min: 1 });
  const riskId = f.int('riskId', { min: 1 });
  const documentId = f.opt('documentId');
  const preventionPlanId = f.opt('preventionPlanId');
  const permitId = f.opt('permitId');
  const now = today();
  if (occurredOn && occurredOn > now) f.fail('occurredOn', "La date ne peut pas être postérieure à aujourd'hui.");
  if (cpamDeclaredOn && cpamDeclaredOn > now) f.fail('cpamDeclaredOn', "La date ne peut pas être postérieure à aujourd'hui.");
  if (cpamDeclaredOn && occurredOn && cpamDeclaredOn < occurredOn) f.fail('cpamDeclaredOn', "La déclaration ne peut pas précéder l'accident.");
  return {
    type: type as EventType, title, occurredOn: occurredOn!, location, equipment, keystoneProject, pilotId, severity: severity!, siteId,
    description, immediateMeasures, ncOrigin, injury, lostDays, cpamDeclaredOn, controlId, riskId, documentId, preventionPlanId, permitId,
  };
}
type EventValues = ReturnType<typeof readEventForm>;

/** Le formulaire porte-t-il une donnée de santé (champ renseigné) ? Refusé pour un rôle non habilité (SEC-06). */
const submitsHealth = (fd: FormData) => HEALTH_FIELDS.some((k) => {
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
    db.select({ id: t.people.id }).from(t.people),
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
  type: 'Type', title: 'Intitulé', occurredOn: 'Date', location: 'Lieu', equipment: 'Équipement', keystoneProject: 'Projet Keystone',
  pilotId: 'Pilote', severity: 'Gravité potentielle', siteId: 'Site', description: 'Description', immediateMeasures: 'Mesures immédiates',
  ncOrigin: 'Origine', ...HEALTH_LABELS, controlId: 'Équipement contrôlé',
  riskId: 'Risque du DUER', documentId: 'Document', preventionPlanId: 'Plan de prévention', permitId: 'Permis',
};
// Les textes longs sont signalés comme modifiés sans recopier leur contenu dans le journal.
const LONG: (keyof EventValues)[] = ['description', 'immediateMeasures'];

/** Modifie la fiche d'un événement (qualification par l'animateur QHSE ou l'encadrement). */
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
  const v: EventValues = health ? read : { ...read, injury: ev.injury, lostDays: ev.lostDays, cpamDeclaredOn: ev.cpamDeclaredOn };
  if (ev.step >= STEP_QUALIFIED && !v.pilotId) f.fail('pilotId', 'Un événement qualifié garde un pilote désigné.');
  await validateEventRefs(db, f, v, ev);
  if (!f.ok) return f.state();

  const people = new Map((await db.select({ id: t.people.id, name: t.people.name }).from(t.people)).map((p) => [p.id, p.name]));
  const fmt = (k: keyof EventValues) => (x: unknown): string | null => {
    if (x == null || x === '') return null;
    if (LONG.includes(k)) return '(texte modifié)';
    if (k === 'pilotId') return people.get(String(x)) ?? String(x);
    if (k === 'type') return EVENT_TYPES[x as EventType]?.label ?? String(x);
    if (k === 'severity') return SEVERITY[Number(x)] ?? String(x);
    if (k === 'injury') return injuryLabel(String(x));
    if (k === 'occurredOn' || k === 'cpamDeclaredOn') return fmtDate(String(x));
    return String(x);
  };
  const details = (Object.keys(LABELS) as (keyof EventValues)[])
    .flatMap((k) => diffFields({ [k]: ev[k] } as Record<string, unknown>, { [k]: v[k] }, { [k]: LABELS[k] }, fmt(k)));

  await db.transaction(async (tx) => {
    await tx.update(t.events).set(v).where(eq(t.events.id, id));
    // Les actions rattachées au site de l'événement le suivent s'il change de site.
    if (v.siteId !== ev.siteId) {
      await tx.update(t.actions).set({ siteId: v.siteId }).where(and(eq(t.actions.eventId, id), eq(t.actions.siteId, ev.siteId)));
    }
    if (details.length) await logChange(tx, { entityType: 'event', entityId: id, action: 'update', summary: 'Fiche modifiée', details });
  });
  done();
  return { ok: true, id };
}

/** Prochaine référence d'événement de l'année (EV-AAAA-n). */
async function nextEventId(db: DbOrTx) {
  const prefix = `EV-${today().slice(0, 4)}-`;
  const existing = await db.select({ id: t.events.id }).from(t.events).where(like(t.events.id, `${prefix}%`));
  return nextRef(existing.map((e) => e.id), prefix);
}

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

/** Ajoute des photos ou documents à un événement (champ `files`, multipart). */
export async function addEventFiles(fd: FormData): Promise<{ error?: string; count?: number }> {
  const { session, error } = await requireManager();
  if (error) return { error };
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
  for (const file of files) await saveUpload(file, 'event', eventId, session.user.id);
  await logChange(null, {
    entityType: 'event', entityId: eventId, action: 'attach', byId: session.user.id,
    summary: `${files.length} pièce${files.length > 1 ? 's' : ''} jointe${files.length > 1 ? 's' : ''} ajoutée${files.length > 1 ? 's' : ''}`,
    details: files.map((file) => ({ field: 'Fichier', from: null, to: file.name })),
  });
  done();
  return { count: files.length };
}

/** Retire une pièce jointe ajoutée par erreur (seule suppression admise, avant clôture), tracée au journal. */
export async function removeEventFile(attachmentId: string): Promise<{ error?: string }> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const db = await getDb();
  const [row] = await db.select({ entityType: t.attachments.entityType, entityId: t.attachments.entityId, fileName: t.attachments.fileName })
    .from(t.attachments).where(eq(t.attachments.id, attachmentId));
  if (!row || row.entityType !== 'event') return { error: 'Pièce jointe introuvable.' };
  const ev = await findEvent(db, row.entityId);
  if (!ev) return { error: 'Événement introuvable.' };
  const blocked = eventLockReason(ev) ?? (await requireInSite(ev.siteId));
  if (blocked) return { error: blocked };
  await deleteAttachment(attachmentId);
  await logChange(null, {
    entityType: 'event', entityId: ev.id, action: 'detach', byId: session.user.id,
    summary: 'Pièce jointe retirée', details: [{ field: 'Fichier', from: row.fileName, to: null }],
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

  let report: { siteId: string; location: string; declarant: string | null; declarantId: string | null; declarantCompany: string | null; reportedVia: 'session' | 'poste' };
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
      siteId, location: f.str('location').slice(0, 120) || (post?.status === 'ok' ? post.post.name : 'Lieu non précisé'),
      declarant: anonymous ? null : user.name, declarantId: anonymous ? null : user.id, declarantCompany: null, reportedVia: 'session',
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
      declarant: name || null, declarantId: null, declarantCompany: company || null, reportedVia: 'poste',
    };
  }

  const firstSentence = description.split(/(?<=[.!?])\s/)[0];
  const title = firstSentence.length > 90 ? `${firstSentence.slice(0, 87)}…` : firstSentence;
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
