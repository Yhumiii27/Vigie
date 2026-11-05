import 'server-only';
import { cache } from 'react';
import { and, asc, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { today } from '@/lib/today';
import { parisDay, referenceNow } from '../dates';
import { EVENT_STEPS, STEP_CLOSED, canApprove, isEmployee, type TodoItem } from '../domain';
import { INBOUND_KINDS, INBOUND_PENDING_DAYS, INBOUND_RESULTS, INBOUND_STATUSES, inboundSummary, ncPayloadSchema, type InboundKind, type InboundResultCode, type InboundStatus } from '../rules/inbound';
import { INBOUND_STATUS_CODES } from '../state-keys';
import { loadPeople } from '../queries';
import { getSession, siteFilter } from '../session';
import { loadQhseLeads } from './leads';

// Demandes reçues des autres outils (D13, décision CV-08) : historique sur la fiche d'une NC, résumé de l'onglet
// « Connecteurs », échéances du QHSE. Lecture seule ; le traitement est dans src/server/inbound.ts.

type Row = typeof t.inboundRequests.$inferSelect;

/** Demande reçue telle que la fiche d'une NC ou l'onglet « Connecteurs » l'affiche. */
export type InboundView = {
  id: number;
  tool: string;
  caller: string;
  kind: string;
  summary: string;
  /** Personne déclarée par l'outil appelant (nom et rôle chez lui) ; jamais une personne de Vigie. */
  person: string | null;
  comment: string | null;
  receivedAt: string;
  processedAt: string | null;
  status: InboundStatus;
  statusLabel: string;
  statusTone: (typeof INBOUND_STATUSES)[InboundStatus]['tone'];
  resultCode: InboundResultCode | null;
  resultLabel: string | null;
  result: string | null;
  targetRef: string;
  eventId: string | null;
  acknowledged: { at: string; by: string; reason: string } | null;
};

function view(r: Row, labels: ReadonlyMap<string, string>, people: ReadonlyMap<string, { name: string }>): InboundView {
  const p = ncPayloadSchema.safeParse(r.payload);
  const actor = p.success ? p.data.actor : null;
  const status = r.status as InboundStatus;
  const code = (r.resultCode as InboundResultCode | null) ?? null;
  return {
    id: r.id, tool: labels.get(r.caller) ?? r.tool, caller: r.caller, kind: INBOUND_KINDS[r.kind as InboundKind] ?? r.kind,
    summary: inboundSummary(r.kind as InboundKind, r.payload, EVENT_STEPS),
    person: actor?.name ? `${actor.name}${actor.role ? ` (${actor.role})` : ''}` : null,
    comment: p.success ? p.data.comment ?? null : null,
    receivedAt: r.receivedAt.toISOString(), processedAt: r.processedAt?.toISOString() ?? null,
    status, statusLabel: INBOUND_STATUSES[status].label, statusTone: INBOUND_STATUSES[status].tone,
    resultCode: code, resultLabel: code ? INBOUND_RESULTS[code] : null, result: r.result,
    targetRef: r.targetRef, eventId: r.eventId,
    acknowledged: r.acknowledgedAt
      ? { at: r.acknowledgedAt.toISOString(), by: r.acknowledgedById ? people.get(r.acknowledgedById)?.name ?? r.acknowledgedById : 'Vigie', reason: r.acknowledgeReason ?? '' }
      : null,
  };
}

const callerLabels = async () => {
  const db = await getDb();
  return new Map((await db.select().from(t.inboundCallers)).map((c) => [c.role, c.label]));
};

/**
 * Demandes reçues pour une NC (fiche d'un événement, rôles qui lisent la fiche hors Salarié) : toutes pour le QHSE et la
 * direction (refus et motifs compris) ; les autres rôles ne voient que les demandes reçues ou appliquées.
 */
export async function loadEventInbound(eventId: string): Promise<{ items: InboundView[]; qhse: boolean }> {
  const { role } = await getSession();
  if (isEmployee(role)) return { items: [], qhse: false };
  const qhse = canApprove(role);
  const db = await getDb();
  const [rows, labels, people] = await Promise.all([
    db.select().from(t.inboundRequests)
      .where(and(eq(t.inboundRequests.eventId, eventId), qhse ? undefined : ne(t.inboundRequests.status, 'rejected')))
      .orderBy(desc(t.inboundRequests.receivedAt), desc(t.inboundRequests.id)),
    callerLabels(), loadPeople(),
  ]);
  return { items: rows.map((r) => view(r, labels, people)), qhse };
}

/** Résumé de la boîte de réception (onglet « Connecteurs », QHSE et direction) : nombres par état, refus à prendre en compte. */
export type InboundOverview = { counts: Record<InboundStatus, number>; rejected: InboundView[]; lastReceivedAt: string | null };

export const loadInboundOverview = cache(async (): Promise<InboundOverview> => {
  const db = await getDb();
  const [rows, labels, people] = await Promise.all([
    db.select().from(t.inboundRequests).orderBy(asc(t.inboundRequests.id)),
    callerLabels(), loadPeople(),
  ]);
  const counts = Object.fromEntries(INBOUND_STATUS_CODES.map((s) => [s, rows.filter((r) => r.status === s).length])) as Record<InboundStatus, number>;
  return {
    counts,
    rejected: rows.filter((r) => r.status === 'rejected' && !r.acknowledgedAt).map((r) => view(r, labels, people)),
    lastReceivedAt: rows.length ? rows.reduce((a, r) => (r.receivedAt > a ? r.receivedAt : a), rows[0].receivedAt).toISOString() : null,
  };
});

const ONE_DAY = 24 * 3_600_000;

/** Lien d'une demande : la NC visée (fiche), sinon la liste des NC. */
export const inboundHref = (eventId: string | null) => (eventId ? `/evenements?etat=tous&sel=${encodeURIComponent(eventId)}` : '/evenements?etat=tous&type=NC');

/**
 * Échéances des demandes reçues (D13), au responsable QHSE du site de la NC (sinon les destinataires communs) :
 * - demande refusée, refus pas encore pris en compte (`keystone-refus|<id>`) ;
 * - demande encore « reçue » plus d'un jour après son dépôt (`keystone-attente|<id>` : traitement planifié arrêté) ;
 * - vérification de Keystone appliquée (clôture ou retour proposé) alors que la NC est toujours à l'étape « Efficacité
 *   vérifiée » sans changement d'étape depuis (`keystone-verification|<id>`) : la décision revient au QHSE.
 * Visibles du QHSE et de la direction, et de leurs destinataires ; jamais du Salarié.
 */
export const loadInboundSignals = cache(async (): Promise<{ todo: TodoItem[] }> => {
  const session = await getSession();
  if (isEmployee(session.role)) return { todo: [] };
  const db = await getDb();
  const now = today();
  const nowAt = referenceNow(now);
  const rows = await db.select().from(t.inboundRequests).where(or(
    and(eq(t.inboundRequests.status, 'rejected'), isNull(t.inboundRequests.acknowledgedAt)),
    eq(t.inboundRequests.status, 'received'),
    and(eq(t.inboundRequests.status, 'applied'), eq(t.inboundRequests.kind, 'nc_verification')),
  ));
  if (!rows.length) return { todo: [] };
  const targets = [...new Set(rows.map((r) => r.eventId ?? r.targetRef))];
  const [events, steps, labels, keep, leads] = await Promise.all([
    db.select({ id: t.events.id, siteId: t.events.siteId, type: t.events.type, projectCode: t.events.keystoneProjectCode, step: t.events.step, dismissedAt: t.events.dismissedAt })
      .from(t.events).where(inArray(t.events.id, targets)),
    db.select({ eventId: t.eventSteps.eventId, at: t.eventSteps.at }).from(t.eventSteps)
      .where(and(inArray(t.eventSteps.eventId, targets), gt(t.eventSteps.at, new Date(Math.min(...rows.map((r) => (r.processedAt ?? r.receivedAt).getTime())))))),
    callerLabels(), siteFilter('perimeter'), loadQhseLeads(),
  ]);
  const byId = new Map(events.map((e) => [e.id, e]));
  const todo: TodoItem[] = rows.flatMap((r): TodoItem[] => {
    // Site : celui de la NC visée (rattachée, ou NC de projet du numéro transmis) ; sinon élément commun.
    const e = byId.get(r.eventId ?? r.targetRef);
    const nc = e && e.type === 'NC' && e.projectCode === r.projectCode ? e : undefined;
    const siteId = nc?.siteId ?? null;
    if (!keep(siteId)) return [];
    const tool = labels.get(r.caller) ?? r.tool;
    const to = leads.forSite(siteId);
    const base = { who: to.who, ownerIds: to.ownerIds, siteId, href: inboundHref(nc?.id ?? null), kind: `Demande de ${tool}` } as const;
    if (r.status === 'rejected') {
      const day = parisDay(r.processedAt ?? r.receivedAt);
      return [{
        ...base, date: day, dueOn: day, tone: 'warn',
        title: `${r.targetRef} · demande n° ${r.id} de ${tool} refusée : ${INBOUND_RESULTS[r.resultCode as InboundResultCode] ?? 'refus'} — prenez-en connaissance`,
        key: `keystone-refus|${r.id}`,
      } satisfies TodoItem];
    }
    if (r.status === 'received') {
      if (nowAt.getTime() - r.receivedAt.getTime() <= INBOUND_PENDING_DAYS * ONE_DAY) return [];
      const due = parisDay(new Date(r.receivedAt.getTime() + INBOUND_PENDING_DAYS * ONE_DAY));
      return [{
        ...base, date: now, dueOn: due, tone: 'danger', overdue: true,
        title: `${r.targetRef} · demande n° ${r.id} de ${tool} non traitée depuis plus d'un jour : vérifiez la tâche « Demandes reçues » (Connecteurs)`,
        key: `keystone-attente|${r.id}`,
      } satisfies TodoItem];
    }
    // Vérification appliquée : proposition au QHSE tant que la NC n'a pas changé d'étape depuis.
    if (!nc || nc.dismissedAt || nc.step !== STEP_CLOSED - 1) return [];
    const since = r.processedAt ?? r.receivedAt;
    if (steps.some((s) => s.eventId === nc.id && s.at > since)) return [];
    const p = ncPayloadSchema.safeParse(r.payload);
    const approved = p.success && p.data.decision === 'approved';
    const day = parisDay(since);
    return [{
      ...base, date: day, dueOn: day, tone: 'warn',
      title: `${nc.id} · ${tool} ${approved ? 'propose la clôture de la NC' : 'propose le retour aux actions correctives'} : décision du QHSE (« ${EVENT_STEPS[STEP_CLOSED]} » ou retour arrière)`,
      key: `keystone-verification|${r.id}`,
    } satisfies TodoItem];
  }).filter((x) => canApprove(session.role) || (x.ownerIds ?? []).includes(session.user.id));
  return { todo };
});

