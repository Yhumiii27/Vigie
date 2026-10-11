import 'server-only';
import { cache } from 'react';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { fmtQty } from '@/components/environment/model';
import type { ChangeEntry } from '@/components/ChangeLog';
import { HEALTH_LOG_FIELDS, advanceBlocker, analysisFilled, eventLockReason, needsCpam, withoutHealth, type AttachmentItem } from '@/components/events/shared';
import { addDays, fmtDate, fmtDayMonth } from '../dates';
import { today } from '@/lib/today';
import {
  CPAM_DELAY_DAYS, EVENT_STEPS, EVENT_TRANSITIONS, EVENT_TYPES, METHODS, QUALIFY_DELAY_DAYS, STEP_CLOSED,
  canSeeHealth, isEmployee, type EventTransition, type EventType, type Role, type Tone, type TodoItem,
} from '../domain';
import { actionView, controlStatus, eventView, loadControls, loadEvents, loadPeople, loadSiteEvents } from '../queries';
import { loadChangeLog } from './changelog';
import { loadQhseLeads } from './leads';
import { currentSiteId, getSession, inSite } from '../session';
import { attachmentUrl } from '../uploads';
import type { Option } from './options';

// ─── Signalements et événements ─────────────────────────────────────────────

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Jour calendaire (Europe/Paris) d'un horodatage, au format ISO « AAAA-MM-JJ ». */
const isoDay = (d: Date) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

type StepRow = typeof t.eventSteps.$inferSelect;

/**
 * Date d'entrée dans chaque étape (index = étape, [0] = déclaration) en rejouant l'historique :
 * un retour arrière ou une réouverture efface les dates des étapes quittées ; les étapes non atteintes restent null.
 */
function stepDatesOf(rows: readonly StepRow[], createdAt: Date, step: number): (string | null)[] {
  const dates: (string | null)[] = EVENT_STEPS.map(() => null);
  dates[0] = isoDay(createdAt);
  for (const r of rows) {
    if (r.kind === 'advance') dates[r.toStep] = isoDay(r.at);
    else if (r.kind === 'revert' || r.kind === 'reopen') for (let k = r.toStep + 1; k < dates.length; k++) dates[k] = null;
  }
  return dates.map((d, i) => (i <= step ? d : null));
}

async function loadSteps(eventIds: string[]) {
  if (!eventIds.length) return [];
  const db = await getDb();
  return db.select().from(t.eventSteps).where(inArray(t.eventSteps.eventId, eventIds)).orderBy(asc(t.eventSteps.at), asc(t.eventSteps.id));
}

/** Pièces jointes d'un événement (photos du signalement, constats, rapports…), les plus anciennes d'abord. */
export async function loadEventAttachments(eventId: string): Promise<AttachmentItem[]> {
  const db = await getDb();
  const rows = await db.select().from(t.attachments)
    .where(and(eq(t.attachments.entityType, 'event'), eq(t.attachments.entityId, eventId)))
    .orderBy(asc(t.attachments.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.fileName, mime: r.mimeType, size: r.size, url: attachmentUrl(r.id), isImage: r.mimeType.startsWith('image/') }));
}

/** Rattachement affiché sur la fiche (lien vers le module concerné). */
export type EventLink = { id: string; label: string; href: string; status?: { label: string; tone: Tone } };
export type EventLinks = Partial<Record<'control' | 'risk' | 'document' | 'plan' | 'permit', EventLink>>;

/** Rattachements d'un événement vers les contrôles, le DUERP, les documents et la prévention (lus sans filtre de site). */
async function loadLinks(e: typeof t.events.$inferSelect, now: string): Promise<EventLinks> {
  const db = await getDb();
  const [[control], [risk], [doc], [plan], [permit]] = await Promise.all([
    e.controlId != null ? db.select().from(t.controls).where(eq(t.controls.id, e.controlId)) : [],
    e.riskId != null
      ? db.select({ id: t.risks.id, hazard: t.risks.hazard, situation: t.risks.situation, unitId: t.risks.unitId, unit: t.workUnits.label, archivedAt: t.risks.archivedAt })
        .from(t.risks).innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id)).where(eq(t.risks.id, e.riskId))
      : [],
    e.documentId ? db.select({ id: t.documents.id, title: t.documents.title }).from(t.documents).where(eq(t.documents.id, e.documentId)) : [],
    e.preventionPlanId ? db.select({ id: t.preventionPlans.id, title: t.preventionPlans.title }).from(t.preventionPlans).where(eq(t.preventionPlans.id, e.preventionPlanId)) : [],
    e.permitId ? db.select({ id: t.permits.id, description: t.permits.description }).from(t.permits).where(eq(t.permits.id, e.permitId)) : [],
  ]);
  const links: EventLinks = {};
  if (control) {
    links.control = {
      id: String(control.id), label: `${control.controlType} · ${control.equipment}`,
      href: `/veille?onglet=controles&controle=${control.id}`,
      status: control.archivedAt ? { label: 'Équipement réformé', tone: 'neutral' } : controlStatus(control, now),
    };
  }
  if (risk) links.risk = { id: String(risk.id), label: clip(`${risk.archivedAt ? 'Archivé · ' : ''}${risk.unit} · ${risk.hazard} — ${risk.situation}`), href: `/risques?risque=${risk.id}` };
  if (doc) links.document = { id: doc.id, label: `${doc.id} · ${doc.title}`, href: `/documents?doc=${encodeURIComponent(doc.id)}` };
  if (plan) links.plan = { id: plan.id, label: clip(`${plan.id} · ${plan.title}`), href: `/prevention?plan=${encodeURIComponent(plan.id)}` };
  if (permit) links.permit = { id: permit.id, label: clip(`${permit.id} · ${permit.description}`), href: `/prevention?onglet=permis&permis=${encodeURIComponent(permit.id)}` };
  return links;
}

/**
 * Enlèvements du registre des déchets consécutifs à l'événement (champ « Événement lié » de l'enlèvement), annulés compris :
 * lien vers le registre de l'année, filtré sur la filière (vue « Annulés » pour un enlèvement annulé).
 */
async function loadWasteEntries(eventId: string): Promise<EventLink[]> {
  const db = await getDb();
  const rows = await db.select({
    id: t.wasteEntries.id, removedOn: t.wasteEntries.removedOn, quantity: t.wasteEntries.quantity, cancelledAt: t.wasteEntries.cancelledAt,
    streamId: t.wasteStreams.id, stream: t.wasteStreams.label, unit: t.wasteStreams.unit,
  }).from(t.wasteEntries).innerJoin(t.wasteStreams, eq(t.wasteEntries.streamId, t.wasteStreams.id))
    .where(eq(t.wasteEntries.eventId, eventId)).orderBy(asc(t.wasteEntries.removedOn), asc(t.wasteEntries.id));
  return rows.map((r) => ({
    id: String(r.id),
    label: `${fmtDate(r.removedOn)} · ${r.stream} · ${fmtQty(r.quantity, r.unit)}`,
    href: `/environnement?annee=${r.removedOn.slice(0, 4)}&filiere=${encodeURIComponent(r.streamId)}${r.cancelledAt ? '&vue=annules' : ''}`,
    status: r.cancelledAt ? { label: 'Annulé', tone: 'neutral' } : undefined,
  }));
}

/** Entrée de l'historique du workflow, sérialisable. */
export type EventHistoryEntry = { id: number; kind: EventTransition; label: string; icon: string; from: string; to: string; reason: string | null; by: string; at: string };

/** Déclaration CPAM d'un AT : date de déclaration, échéance (48 h) ou mention « non requise » (soins). */
export type CpamState = { declaredOn: string | null; dueOn: string | null; tone: Tone; label: string } | null;

function cpamState(e: { type: string; injury: string | null; occurredOn: string; cpamDeclaredOn: string | null }, now: string): CpamState {
  if (e.type !== 'AT') return null;
  if (!needsCpam(e)) return { declaredOn: null, dueOn: null, tone: 'neutral', label: 'Non requise · registre des accidents bénins' };
  if (e.cpamDeclaredOn) return { declaredOn: e.cpamDeclaredOn, dueOn: null, tone: 'ok', label: `Déclarée le ${fmtDayMonth(e.cpamDeclaredOn)}` };
  const dueOn = addDays(e.occurredOn, CPAM_DELAY_DAYS);
  return { declaredOn: null, dueOn, tone: dueOn < now ? 'danger' : 'warn', label: `À déclarer avant le ${fmtDayMonth(dueOn)}` };
}

/**
 * Événements consultables sur /evenements (site sélectionné, classés sans suite compris), du plus récent au plus ancien :
 * le Salarié ne voit que ses propres signalements nominatifs (rapprochement par identifiant, jamais les anonymes).
 */
export const loadVisibleEvents = cache(async () => {
  const [events, { role, user }] = await Promise.all([loadSiteEvents(), getSession()]);
  return isEmployee(role) ? events.filter((e) => e.declarantId === user.id && !e.anonymous) : events;
});

/**
 * Fiche d'un événement consultable (loadVisibleEvents : site sélectionné, ses propres signalements pour le Salarié),
 * classés sans suite compris : vue, actions liées, contenus d'analyse, pièces jointes, historique du workflow,
 * rattachements et éventuel blocage du passage à l'étape suivante ; null si l'événement n'est pas consultable.
 * Données de santé (SEC-06) : retirées de la fiche (valeurs à null, `health: false`) pour un rôle non habilité.
 */
export async function loadEventDetail(id: string) {
  const db = await getDb();
  const now = today();
  const [people, events, { role }] = await Promise.all([loadPeople(), loadVisibleEvents(), getSession()]);
  const row = events.find((x) => x.id === id);
  if (!row) return null;
  const health = canSeeHealth(role);
  const e = health ? row : withoutHealth(row);
  // Les actions liées sont lues sans filtre de site : elles suivent l'événement.
  const [actions, analyses, attachments, steps, links, wasteEntries] = await Promise.all([
    db.select().from(t.actions).where(eq(t.actions.eventId, e.id)),
    db.select().from(t.eventAnalyses).where(eq(t.eventAnalyses.eventId, e.id)),
    loadEventAttachments(e.id),
    loadSteps([e.id]),
    loadLinks(e, now),
    loadWasteEntries(e.id),
  ]);
  const content = Object.fromEntries(analyses.map((a) => [a.method, a.content])) as Record<string, unknown>;
  const methodLabel = METHODS.find(([k]) => k === e.analysisMethod)?.[1] ?? e.analysisMethod;
  const name = (pid: string | null) => (pid ? people.get(pid)?.name ?? pid : 'Vigie');
  const history: EventHistoryEntry[] = steps.map((r) => {
    const kind = (r.kind in EVENT_TRANSITIONS ? r.kind : 'advance') as EventTransition;
    return {
      id: r.id, kind, ...EVENT_TRANSITIONS[kind], from: EVENT_STEPS[r.fromStep] ?? '—', to: EVENT_STEPS[r.toStep] ?? '—',
      reason: r.reason, by: name(r.byId), at: r.at.toISOString(),
    };
  });
  const dismissStep = [...steps].reverse().find((r) => r.kind === 'dismiss');
  return {
    event: eventView(e, people, now),
    actions: actions.sort((a, b) => a.id.localeCompare(b.id, 'fr', { numeric: true })).map((a) => ({ ...actionView(a, people, now), originKey: a.origin })),
    analyses: content,
    attachments,
    blocker: advanceBlocker(e.step, actions, { pilotId: e.pilotId, hasAnalysis: analysisFilled(e.analysisMethod, content[e.analysisMethod]), dismissed: !!e.dismissedAt, methodLabel }),
    lock: eventLockReason(e),
    history,
    stepDates: stepDatesOf(steps, e.createdAt, e.step),
    links,
    wasteEntries,
    cpam: health ? cpamState(e, now) : null,
    /** Données de santé transmises (rôle habilité) ; sinon « Données restreintes ». */
    health,
    dismissal: e.dismissedAt
      ? { on: isoDay(e.dismissedAt), by: name(e.dismissedById ?? dismissStep?.byId ?? null), reason: e.dismissReason ?? dismissStep?.reason ?? '' }
      : null,
  };
}
export type EventDetail = NonNullable<Awaited<ReturnType<typeof loadEventDetail>>>;

/**
 * Journal des modifications d'un événement. Rôle non habilité aux données de santé (SEC-06) : les champs correspondants
 * sont retirés, et une modification qui ne portait que sur eux disparaît.
 */
export async function loadEventChangeLog(id: string): Promise<ChangeEntry[]> {
  const [{ role }, log] = await Promise.all([getSession(), loadChangeLog('event', id)]);
  if (canSeeHealth(role)) return log;
  return log.flatMap((entry) => {
    const details = entry.details.filter((d) => !HEALTH_LOG_FIELDS.includes(d.field));
    return details.length || !entry.details.length ? [{ ...entry, details }] : [];
  });
}

/** Date de clôture (dernier passage à « Clôturé ») des événements donnés : identifiant → date ISO. */
export async function loadEventClosures(ids: string[]): Promise<Map<string, string>> {
  const rows = (await loadSteps(ids)).filter((r) => r.kind === 'advance' && r.toStep === STEP_CLOSED);
  return new Map(rows.map((r) => [r.eventId, isoDay(r.at)]));
}

/**
 * Listes de choix des rattachements d'un événement (site sélectionné) : équipements contrôlés, risques du DUERP,
 * documents maîtrisés, plans de prévention et permis non annulés.
 */
export const loadEventLinkOptions = cache(async () => {
  const db = await getDb();
  const site = await currentSiteId();
  const [controls, risks, docs, plans, permits] = await Promise.all([
    loadControls(),
    // Risques en vigueur du DUERP (unités et risques archivés exclus).
    db.select({ id: t.risks.id, hazard: t.risks.hazard, situation: t.risks.situation, unit: t.workUnits.label, siteId: t.workUnits.siteId })
      .from(t.risks).innerJoin(t.workUnits, eq(t.risks.unitId, t.workUnits.id))
      .where(and(isNull(t.risks.archivedAt), isNull(t.workUnits.archivedAt))).orderBy(asc(t.workUnits.sort), asc(t.risks.sort)),
    db.select({ id: t.documents.id, title: t.documents.title, siteId: t.documents.siteId }).from(t.documents).orderBy(asc(t.documents.id)),
    db.select({ id: t.preventionPlans.id, title: t.preventionPlans.title, siteId: t.preventionPlans.siteId, status: t.preventionPlans.status }).from(t.preventionPlans).orderBy(desc(t.preventionPlans.id)),
    db.select({ id: t.permits.id, description: t.permits.description, siteId: t.permits.siteId, status: t.permits.status }).from(t.permits).orderBy(desc(t.permits.id)),
  ]);
  return {
    controls: controls.map((c) => [String(c.id), clip(`${c.controlType} · ${c.equipment}`)] as Option),
    risks: risks.filter((r) => inSite(site, r.siteId)).map((r) => [String(r.id), clip(`${r.unit} · ${r.hazard} — ${r.situation}`)] as Option),
    documents: docs.filter((d) => inSite(site, d.siteId)).map((d) => [d.id, clip(`${d.id} · ${d.title}`)] as Option),
    plans: plans.filter((p) => p.status !== 'annule' && inSite(site, p.siteId)).map((p) => [p.id, clip(`${p.id} · ${p.title}`)] as Option),
    permits: permits.filter((p) => p.status !== 'annule' && inSite(site, p.siteId)).map((p) => [p.id, clip(`${p.id} · ${p.description}`)] as Option),
  };
});
export type EventLinkOptions = Awaited<ReturnType<typeof loadEventLinkOptions>>;

// ─── Parcours terrain : « Mes signalements » ────────────────────────────────

/**
 * Signalements nominatifs déclarés par l'utilisateur courant, tous sites confondus (rapprochement par identifiant).
 * Les signalements anonymes ne portent pas de déclarant : ils ne peuvent pas, par conception, être retrouvés ici.
 */
export async function loadMyReports() {
  const db = await getDb();
  const { user } = await getSession();
  const [events, sites, photos] = await Promise.all([
    db.select().from(t.events).where(and(eq(t.events.declarantId, user.id), eq(t.events.anonymous, false))),
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
    db.select({ entityId: t.attachments.entityId, mime: t.attachments.mimeType }).from(t.attachments).where(eq(t.attachments.entityType, 'event')),
  ]);
  const siteLabel = new Map(sites.map((s) => [s.id, s.label.split(' — ')[0]]));
  return events
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id, 'fr', { numeric: true }))
    .map((e) => {
      const type = EVENT_TYPES[e.type as EventType];
      return {
        id: e.id, occurredOn: e.occurredOn, title: e.title, location: e.location, step: e.step,
        typeLabel: type.label, typeTone: type.tone, typeIcon: type.icon,
        siteId: e.siteId, siteLabel: siteLabel.get(e.siteId) ?? e.siteId, dismissed: !!e.dismissedAt,
        photoCount: photos.filter((p) => p.entityId === e.id && p.mime.startsWith('image/')).length,
      };
    });
}
export type MyReport = Awaited<ReturnType<typeof loadMyReports>>[number];

/**
 * Détail d'un signalement pour son déclarant (retour d'information) : étape et dates, description, mesures immédiates,
 * actions décidées (titre et statut). Ni l'analyse des causes ni le pilote ne sont transmis. null si ce n'est pas le sien.
 */
export async function loadMyReport(id: string) {
  const db = await getDb();
  const now = today();
  const { user } = await getSession();
  const [[e], people] = await Promise.all([
    db.select().from(t.events).where(and(eq(t.events.id, id), eq(t.events.declarantId, user.id), eq(t.events.anonymous, false))),
    loadPeople(),
  ]);
  if (!e) return null;
  const [[site], actions, photos, steps] = await Promise.all([
    db.select({ label: t.sites.label }).from(t.sites).where(eq(t.sites.id, e.siteId)),
    db.select().from(t.actions).where(eq(t.actions.eventId, e.id)),
    db.select({ mime: t.attachments.mimeType }).from(t.attachments).where(and(eq(t.attachments.entityType, 'event'), eq(t.attachments.entityId, e.id))),
    loadSteps([e.id]),
  ]);
  const type = EVENT_TYPES[e.type as EventType];
  return {
    id: e.id, title: e.title, location: e.location, siteLabel: site?.label.split(' — ')[0] ?? e.siteId,
    typeLabel: type.label, typeTone: type.tone, typeIcon: type.icon,
    occurredOn: e.occurredOn, createdOn: isoDay(e.createdAt), step: e.step, stepDates: stepDatesOf(steps, e.createdAt, e.step),
    description: e.description, immediateMeasures: e.immediateMeasures,
    photoCount: photos.filter((p) => p.mime.startsWith('image/')).length,
    dismissed: e.dismissedAt ? { on: isoDay(e.dismissedAt), reason: e.dismissReason ?? '' } : null,
    actions: actions
      .sort((a, b) => a.id.localeCompare(b.id, 'fr', { numeric: true }))
      .map((a) => { const v = actionView(a, people, now); return { id: a.id, title: a.title, statusLabel: v.statusLabel, tone: v.tone }; }),
  };
}
export type MyReportDetail = NonNullable<Awaited<ReturnType<typeof loadMyReport>>>;

// ─── QR codes de poste ──────────────────────────────────────────────────────

// Postes, jetons signés et résolution des QR codes : src/lib/data/report-posts.ts ; adresse publique des QR codes :
// publicOrigin() (src/lib/public-url.ts, VIGIE_PUBLIC_URL, jamais l'en-tête Host — PRD-07).

// ─── Échéances du domaine (tableau de bord, À faire, notifications, badge) ──

/**
 * Échéances des événements :
 * - signalements à qualifier sous QUALIFY_DELAY_DAYS après la déclaration (createdAt) — dépassé : danger ;
 * - accidents du travail à déclarer à la CPAM sous CPAM_DELAY_DAYS après l'accident (hors soins sans arrêt) : donnée de
 *   santé (SEC-06), échéance réservée aux rôles habilités (`health`), adressée au pilote si son dernier rôle connu l'est,
 *   sinon au responsable QHSE du site (animateurs QHSE si le poste est vacant).
 * Les classés sans suite sont exclus (loadEvents).
 */
export const loadEventSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const [events, people, leads] = await Promise.all([loadEvents(), loadPeople(), loadQhseLeads()]);
  const now = today();
  const todo: TodoItem[] = [];
  const who = (pid: string) => people.get(pid)?.name ?? '';
  const healthOwner = (pid: string | null) => {
    const r = pid ? people.get(pid)?.lastRole : null;
    return !!r && canSeeHealth(r as Role);
  };
  for (const e of events) {
    const href = `/evenements?sel=${e.id}`;
    // Sans pilote désigné : le responsable QHSE du site (ou les animateurs QHSE si le poste est vacant).
    const lead = leads.forSite(e.siteId);
    if (e.step === 0) {
      const due = addDays(isoDay(e.createdAt), QUALIFY_DELAY_DAYS);
      todo.push({
        date: due, kind: 'Signalement à qualifier', tone: due < now ? 'danger' : 'warn', title: `${e.id} · ${e.title}`,
        who: e.pilotId ? who(e.pilotId) : lead.who, href, ownerIds: e.pilotId ? [e.pilotId] : lead.ownerIds, overdue: due < now,
      });
    }
    if (needsCpam(e) && !e.cpamDeclaredOn && e.step < STEP_CLOSED) {
      const due = addDays(e.occurredOn, CPAM_DELAY_DAYS);
      const pilot = e.pilotId && healthOwner(e.pilotId) ? e.pilotId : null;
      const owners = [...new Set([...lead.ownerIds, ...(pilot ? [pilot] : [])])];
      todo.push({
        date: due, kind: 'Déclaration AT à la CPAM', tone: due < now ? 'danger' : 'warn', title: `${e.id} · ${e.title}`,
        who: pilot ? who(pilot) : lead.who, href, ownerIds: owners, overdue: due < now, health: true,
      });
    }
  }
  return { todo };
});

/**
 * Valeurs proposées à « Nouvel événement » ouvert depuis un plan de prévention ou un permis (?plan=, ?permis=) :
 * site et lieu repris de l'intervention ; un identifiant inconnu ou hors du site sélectionné est ignoré.
 */
export async function loadNewEventDefaults(planId: string | undefined, permitId: string | undefined) {
  const db = await getDb();
  const site = await currentSiteId();
  const [[permit], [planRow]] = await Promise.all([
    permitId ? db.select().from(t.permits).where(eq(t.permits.id, permitId)) : [],
    planId ? db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, planId)) : [],
  ]);
  const p = permit && inSite(site, permit.siteId) ? permit : undefined;
  const pp = planRow && inSite(site, planRow.siteId) && (!p || p.siteId === planRow.siteId) ? planRow : undefined;
  if (!p && !pp) return null;
  return {
    siteId: p?.siteId ?? pp!.siteId,
    location: p?.location ?? pp!.location,
    permitId: p?.id ?? null,
    preventionPlanId: pp?.id ?? p?.preventionPlanId ?? null,
  };
}
