import 'server-only';
import { cache } from 'react';
import { asc, desc, eq } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { today } from '@/lib/today';
import { entityVersions } from '@/server/versions';
import { actionLabel, canReadAction, isLate } from '../action-rules';
import { addDays, parisDay } from '../dates';
import { AVANCEMENT, canApprove, isAvancement, isEmployee, type Tone, type TodoItem } from '../domain';
import { loadProjectIndex, readArticles, readBomUsage, readFleet } from '../foreign/keystone';
import { projectText, unavailableMessage } from '../foreign/labels';
import { hasLeft } from '../people';
import { loadPeople, loadSiteRows } from '../queries';
import {
  ECO_APPROVAL_DAYS, ECO_APPROVAL_KEYS, ECO_APPROVAL_KEY_LIST, ECO_DECISIONS, ECO_STATUSES, ECO_TYPES, ECR_DECISION_DAYS, ECR_KINDS, ECR_STATUSES,
  ECR_SUBJECTS, EFFECTIVITY_DISPOSITIONS, EFFECTIVITY_TARGETS, ENGINEERING_SOURCES, INTERCHANGEABILITY, INTERCHANGEABILITY_UNSET, canDecideApproval,
  dispositionNeedsWork, ecoLocked, engineeringHref, pendingDispositions, proposeEffectivity, targetText,
  type EcoApprovalKey, type EcoDecision, type EcoStatus, type EcoType, type EcrKind, type EcrStatus, type EcrSubject, type EffectivityDisposition,
  type EffectivityTarget, type EngineeringSource, type ProposedTarget,
} from '../rules/engineering';
import { OUTBOUND_STATUSES, type OutboundStatus } from '../rules/outbound';
import { TODO_HORIZON_DAYS } from '../horizons';
import { getSession, siteFilter } from '../session';
import { documentRefLabel, resolveDocuments } from './documents';
import { loadQhseLeads } from './leads';

// Modifications techniques (D12, lot 5 de M-02, décision CV-06) : registre des demandes (ECR) et ordres (ECO) de
// modification, fiches, choix des formulaires et échéances. Lecteurs : animateur QHSE, direction et encadrement (consultation
// de son périmètre) ; Salarié : rien. Fiches du site sélectionné (« Tous les sites » : périmètre) ; une fiche sans site vaut
// pour toute l'entreprise. Documents de Codex résolus par resolveDocuments (titre masqué s'il est confidentiel) ; articles et
// projets de Keystone lus dans ses vues (libellé « code · client »). Valeurs calculées, jamais stockées : dispositions à
// décider, verrouillage, retards.

export type ApprovalView = {
  key: EcoApprovalKey; label: string; approver: string; approverId: string | null; decision: EcoDecision; decisionLabel: string; tone: Tone;
  decidedBy: string | null; decidedAt: string | null; comment: string | null; via: string | null;
  /** La personne connectée peut décider cette clé (QHSE, ou approbateur désigné), ordre en approbation. */
  canDecide: boolean;
};
export type TargetView = {
  targetType: EffectivityTarget; targetRef: string; label: string; typeLabel: string; disposition: EffectivityDisposition | null; dispositionLabel: string;
  isAutomatic: boolean; note: string | null; fittedPartRef: string | null; fittedRevision: string | null; dueOn: string | null; doneOn: string | null;
  late: boolean;
};
export type LinkedActionView = { id: string; readable: boolean; label: string; statusLabel: string; tone: Tone; dueOn: string; late: boolean };
export type EcrBrief = { id: string; title: string; statusLabel: string; tone: Tone };

export type EcoView = {
  id: string; title: string; type: EcoType; typeLabel: string; status: EcoStatus; statusLabel: string; tone: Tone;
  interchangeability: 'yes' | 'no' | null; interchangeabilityLabel: string; fromRevision: string; toRevision: string;
  costEur: number; scheduleDays: number; stockImpact: string; description: string;
  requestedBy: string; raisedOn: string; pilotId: string | null; pilot: string | null; siteId: string | null; siteLabel: string;
  source: EngineeringSource; sourceLabel: string; releasedOn: string | null; rejectedOn: string | null; approvalRequestedOn: string | null;
  parts: { ref: string; label: string }[]; projects: { code: string; label: string }[];
  documents: { refLabel: string; codexDocId: string | null; label: string; href: string | null; ecrId: string | null }[];
  approvals: ApprovalView[]; targets: TargetView[]; pendingDispositions: number; locked: boolean;
  ecrs: EcrBrief[]; actions: LinkedActionView[];
  cancelled: { on: string; by: string; reason: string } | null;
};

export type EcrView = {
  id: string; kind: EcrKind; kindLabel: string; subject: EcrSubject; subjectLabel: string; title: string; reason: string; description: string;
  source: EngineeringSource; sourceLabel: string; ref: string; refLabel: string; refHref: string | null;
  codexDocId: string | null; partRef: string | null; projectCode: string | null; eventId: string | null;
  requester: string; requesterRef: string | null; status: EcrStatus; statusLabel: string; tone: Tone; ecoId: string | null; modifierRef: string | null;
  decisionNote: string | null; decidedBy: string | null; decidedOn: string | null; implementedOn: string | null; codexRevision: string | null;
  notify: { status: OutboundStatus; label: string; tone: Tone; attempts: number; error: string | null } | null;
  siteId: string | null; siteLabel: string; createdOn: string; overdue: boolean; dueOn: string;
  cancelled: { on: string; by: string; reason: string } | null;
};

const ALL_SITES_LABEL = 'Tous les sites';

/** Lecture brute (périmètre) : ordres, demandes et leurs lignes. */
const readAll = cache(async () => {
  const db = await getDb();
  const [ecos, ecrs, approvals, parts, projects, docs, targets, links, people, sites] = await Promise.all([
    db.select().from(t.ecos).orderBy(desc(t.ecos.raisedOn), desc(t.ecos.id)),
    db.select().from(t.ecrs).orderBy(desc(t.ecrs.createdAt), desc(t.ecrs.id)),
    db.select().from(t.ecoApprovals),
    db.select().from(t.ecoParts).orderBy(asc(t.ecoParts.position)),
    db.select().from(t.ecoProjects).orderBy(asc(t.ecoProjects.position)),
    db.select().from(t.ecoDocuments).orderBy(asc(t.ecoDocuments.position)),
    db.select().from(t.ecoEffectivity).orderBy(asc(t.ecoEffectivity.position)),
    db.select({
      ecoId: t.ecoActions.ecoId, id: t.actions.id, status: t.actions.status, dueOn: t.actions.dueOn, detail: t.actions.detail, pilotId: t.actions.pilotId, siteId: t.actions.siteId,
    }).from(t.ecoActions).innerJoin(t.actions, eq(t.ecoActions.actionId, t.actions.id)).orderBy(asc(t.actions.id)),
    loadPeople(),
    loadSiteRows(),
  ]);
  return { ecos, ecrs, approvals, parts, projects, docs, targets, links, people, sites };
});

const siteLabel = (sites: readonly { id: string; label: string }[], id: string | null) => (id ? sites.find((s) => s.id === id)?.label.split(' — ')[0] ?? id : ALL_SITES_LABEL);
const cancelInfo = (at: Date | null, by: string | null, reason: string | null, name: (id: string | null) => string) =>
  at ? { on: parisDay(at), by: name(by), reason: reason ?? '' } : null;

/**
 * Registre de l'écran : ordres et demandes du site sélectionné (périmètre pour « Tous les sites »), filtres de Keystone
 * `part` et `project` (adresse convenue) appliqués aux ordres ; versions des fiches (QUA-12). Salarié : rien.
 */
export async function loadEngineering(filter: { part?: string | null; project?: string | null } = {}) {
  const [session, data, keep, projectIndex] = await Promise.all([getSession(), readAll(), siteFilter('site'), loadProjectIndex()]);
  const now = today();
  if (isEmployee(session.role)) return { now, ecos: [] as EcoView[], ecrs: [] as EcrView[], versions: {} as Record<string, string>, sourceMessages: [] as string[] };
  const qhse = canApprove(session.role);
  const name = (id: string | null) => (id ? data.people.get(id)?.name ?? id : '');
  const ecos = data.ecos.filter((e) => keep(e.siteId));
  const ecrs = data.ecrs.filter((r) => keep(r.siteId));
  const db = await getDb();
  const ecoIds = new Set(ecos.map((e) => e.id));
  const allParts = [...new Set(data.parts.filter((p) => ecoIds.has(p.ecoId)).map((p) => p.partRef).concat(ecrs.flatMap((r) => (r.partRef ? [r.partRef] : []))))];
  const [articles, docs] = await Promise.all([
    readArticles(db, allParts),
    resolveDocuments([...data.docs.filter((d) => ecoIds.has(d.ecoId)).map((d) => d.codexDocId), ...ecrs.map((r) => r.codexDocId)], { db, role: session.role }),
  ]);
  const articleName = new Map(articles.ok ? articles.rows.map((a) => [a.ref, a.name]) : []);
  const sourceMessages = [...(articles.ok ? [] : [unavailableMessage('articles')]), ...(docs.ok ? [] : [docs.message])];

  const ecoViews: EcoView[] = ecos.map((e) => {
    const approvals = data.approvals.filter((a) => a.ecoId === e.id);
    const targets = data.targets.filter((x) => x.ecoId === e.id);
    const status = e.status as EcoStatus;
    const state = { status, interchangeability: e.interchangeability };
    const appr = ECO_APPROVAL_KEY_LIST.map((k): ApprovalView => {
      const a = approvals.find((x) => x.approvalKey === k);
      const decision = (a?.decision ?? 'pending') as EcoDecision;
      return {
        key: k, label: ECO_APPROVAL_KEYS[k].label, approver: a?.approverText ?? ECO_APPROVAL_KEYS[k].fallback, approverId: a?.approverId ?? null,
        decision, decisionLabel: ECO_DECISIONS[decision].label, tone: ECO_DECISIONS[decision].tone,
        decidedBy: a?.decidedByName ?? null, decidedAt: a?.decidedAt?.toISOString() ?? null, comment: a?.comment ?? null, via: a?.via ?? null,
        canDecide: status === 'in_approval' && decision === 'pending' && !e.cancelledAt && canDecideApproval({ qhse, userId: session.user.id, approverId: a?.approverId ?? null }),
      };
    });
    return {
      id: e.id, title: e.title, type: e.ecoType as EcoType, typeLabel: ECO_TYPES[e.ecoType as EcoType] ?? e.ecoType,
      status, statusLabel: e.cancelledAt ? 'Annulé' : ECO_STATUSES[status].label, tone: e.cancelledAt ? 'neutral' : ECO_STATUSES[status].tone,
      interchangeability: e.interchangeability as 'yes' | 'no' | null,
      interchangeabilityLabel: e.interchangeability ? INTERCHANGEABILITY[e.interchangeability as 'yes' | 'no'] : INTERCHANGEABILITY_UNSET,
      fromRevision: e.fromRevision, toRevision: e.toRevision, costEur: Number(e.costEur), scheduleDays: e.scheduleDays, stockImpact: e.stockImpact,
      description: e.description, requestedBy: e.requestedByName, raisedOn: e.raisedOn, pilotId: e.pilotId, pilot: e.pilotId ? name(e.pilotId) : null,
      siteId: e.siteId, siteLabel: siteLabel(data.sites, e.siteId), source: e.source as EngineeringSource, sourceLabel: ENGINEERING_SOURCES[e.source as EngineeringSource],
      releasedOn: e.releasedAt ? parisDay(e.releasedAt) : null, rejectedOn: e.rejectedAt ? parisDay(e.rejectedAt) : null, approvalRequestedOn: e.approvalRequestedOn,
      parts: data.parts.filter((p) => p.ecoId === e.id).map((p) => ({ ref: p.partRef, label: articleName.has(p.partRef) ? `${p.partRef} · ${articleName.get(p.partRef)}` : p.partRef })),
      projects: data.projects.filter((p) => p.ecoId === e.id).map((p) => ({ code: p.keystoneProjectCode, label: projectText(p.keystoneProjectCode, null, projectIndex) ?? p.keystoneProjectCode })),
      documents: data.docs.filter((d) => d.ecoId === e.id).map((d) => {
        const ref = d.codexDocId ? docs.byRef.get(d.codexDocId) : undefined;
        return { refLabel: d.refLabel, codexDocId: d.codexDocId, label: d.codexDocId ? documentRefLabel(d.codexDocId, ref) : d.refLabel, href: ref?.href ?? null, ecrId: d.ecrId };
      }),
      approvals: appr,
      targets: targets.map((g) => ({
        targetType: g.targetType as EffectivityTarget, targetRef: g.targetRef, label: g.label, typeLabel: EFFECTIVITY_TARGETS[g.targetType as EffectivityTarget],
        disposition: g.disposition as EffectivityDisposition | null, dispositionLabel: g.disposition ? EFFECTIVITY_DISPOSITIONS[g.disposition as EffectivityDisposition].label : 'À décider',
        isAutomatic: g.isAutomatic, note: g.note, fittedPartRef: g.fittedPartRef, fittedRevision: g.fittedRevision, dueOn: g.dueOn, doneOn: g.doneOn,
        late: status === 'released' && dispositionNeedsWork(g.disposition as EffectivityDisposition | null) && !g.doneOn && !!g.dueOn && g.dueOn < now,
      })),
      pendingDispositions: pendingDispositions(targets),
      locked: ecoLocked(state, approvals as { approvalKey: EcoApprovalKey; decision: EcoDecision }[], targets),
      ecrs: data.ecrs.filter((r) => r.ecoId === e.id || data.docs.some((d) => d.ecoId === e.id && d.ecrId === r.id))
        .map((r) => ({ id: r.id, title: r.title, statusLabel: ECR_STATUSES[r.status as EcrStatus].label, tone: ECR_STATUSES[r.status as EcrStatus].tone })),
      actions: data.links.filter((l) => l.ecoId === e.id).map((a) => {
        const readable = canReadAction(session.role, session.user.id, a, session.allowedSiteIds);
        const late = isLate(a, now);
        const st = isAvancement(a.status) ? AVANCEMENT[a.status] : null;
        return {
          id: a.id, readable, label: readable ? actionLabel(a.detail) : '', dueOn: readable ? a.dueOn : '', late: readable && late,
          statusLabel: readable ? (late ? 'En retard' : st?.label ?? a.status) : '', tone: readable ? (late ? 'danger' : st?.tone ?? 'neutral') : 'neutral',
        };
      }),
      cancelled: cancelInfo(e.cancelledAt, e.cancelledById, e.cancelReason, name),
    };
  }).filter((e) => (!filter.part || e.parts.some((p) => p.ref === filter.part)) && (!filter.project || e.projects.some((p) => p.code === filter.project)));

  const ecrViews: EcrView[] = ecrs.map((r) => {
    const status = r.status as EcrStatus;
    const ref = r.codexDocId ?? r.partRef ?? r.keystoneProjectCode ?? r.eventId ?? '';
    const doc = r.codexDocId ? docs.byRef.get(r.codexDocId) : undefined;
    const created = parisDay(r.createdAt);
    const dueOn = addDays(created, ECR_DECISION_DAYS);
    const notify = r.notifyStatus as OutboundStatus | null;
    return {
      id: r.id, kind: r.kind as EcrKind, kindLabel: ECR_KINDS[r.kind as EcrKind], subject: r.subject as EcrSubject, subjectLabel: ECR_SUBJECTS[r.subject as EcrSubject],
      title: r.title, reason: r.reason, description: r.description, source: r.source as EngineeringSource, sourceLabel: ENGINEERING_SOURCES[r.source as EngineeringSource],
      ref,
      refLabel: r.codexDocId ? documentRefLabel(r.codexDocId, doc)
        : r.partRef ? (articleName.has(r.partRef) ? `${r.partRef} · ${articleName.get(r.partRef)}` : r.partRef)
          : r.keystoneProjectCode ? projectText(r.keystoneProjectCode, null, projectIndex) ?? r.keystoneProjectCode : ref,
      refHref: doc?.href ?? (r.eventId ? `/evenements?etat=tous&sel=${encodeURIComponent(r.eventId)}` : null),
      codexDocId: r.codexDocId, partRef: r.partRef, projectCode: r.keystoneProjectCode, eventId: r.eventId,
      requester: r.requesterName, requesterRef: r.requesterRef,
      status, statusLabel: r.cancelledAt ? 'Annulée' : ECR_STATUSES[status].label, tone: r.cancelledAt ? 'neutral' : ECR_STATUSES[status].tone,
      ecoId: r.ecoId, modifierRef: r.modifierRef, decisionNote: r.decisionNote, decidedBy: r.decidedById ? name(r.decidedById) : r.decidedAt ? 'Vigie' : null,
      decidedOn: r.decidedAt ? parisDay(r.decidedAt) : null, implementedOn: r.implementedAt ? parisDay(r.implementedAt) : null, codexRevision: r.codexRevision,
      notify: notify ? { status: notify, label: OUTBOUND_STATUSES[notify].label, tone: OUTBOUND_STATUSES[notify].tone, attempts: r.notifyAttempts, error: r.notifyError } : null,
      siteId: r.siteId, siteLabel: siteLabel(data.sites, r.siteId), createdOn: created, dueOn, overdue: status === 'submitted' && dueOn < now,
      cancelled: cancelInfo(r.cancelledAt, r.cancelledById, r.cancelReason, name),
    };
  });
  const versions = Object.fromEntries([
    ...await entityVersions(db, 'eco', ecoViews.map((e) => e.id)),
    ...await entityVersions(db, 'ecr', ecrViews.map((r) => r.id)),
  ]);
  return { now, ecos: ecoViews, ecrs: ecrViews, versions, sourceMessages };
}

/** Ordres ouverts (non rejetés) du site sélectionné : choix « Rattacher à un ordre » de la décision d'une demande. */
export async function loadOpenEcoChoices(): Promise<[string, string][]> {
  const [data, keep] = await Promise.all([readAll(), siteFilter('site')]);
  return data.ecos.filter((e) => keep(e.siteId) && !e.cancelledAt && e.status !== 'rejected')
    .map((e) => [e.id, `${e.id} · ${e.title}`.slice(0, 120)] as [string, string]);
}

/**
 * Effectivité proposée pour un ordre d'après Keystone (règle pure proposeEffectivity) : projets déclarés, nomenclatures
 * (keystone.pub_nomenclatures) et parc installé (keystone.pub_parc_machines). Source indisponible : message.
 */
export async function proposeTargetsFor(db: DbOrTx, ecoId: string): Promise<{ ok: true; targets: ProposedTarget[] } | { ok: false; message: string }> {
  const [parts, projects] = await Promise.all([
    db.select({ ref: t.ecoParts.partRef }).from(t.ecoParts).where(eq(t.ecoParts.ecoId, ecoId)),
    db.select({ code: t.ecoProjects.keystoneProjectCode }).from(t.ecoProjects).where(eq(t.ecoProjects.ecoId, ecoId)),
  ]);
  const partRefs = parts.map((p) => p.ref);
  const projectCodes = projects.map((p) => p.code);
  const bom = await readBomUsage(db, partRefs);
  if (!bom.ok) return { ok: false, message: unavailableMessage('bom') };
  const allProjects = [...new Set([...projectCodes, ...bom.rows.map((b) => b.projectCode)])];
  const fleet = await readFleet(db, { parts: partRefs, projects: allProjects });
  if (!fleet.ok) return { ok: false, message: unavailableMessage('fleet') };
  const index = await loadProjectIndex();
  return { ok: true, targets: proposeEffectivity({ parts: partRefs, projects: projectCodes, bom: bom.rows, fleet: fleet.rows, projectLabel: (c) => projectText(c, null, index) ?? c }) };
}

/**
 * Échéances des modifications techniques, sur tout le périmètre (TDB-05) ; Salarié : aucune.
 * - demande à décider (`ecr-decision|<id>`) : au responsable QHSE du site, échéance 15 j après la création ;
 * - clé d'approbation en attente d'un ordre en approbation (`eco-approbation|<ordre>|<clé>`) : à l'approbateur désigné,
 *   sinon au responsable QHSE du site ; échéance 10 j après la soumission ;
 * - ordre approuvé dont des dispositions restent à décider (`eco-dispositions|<ordre>`) : au pilote, sinon au responsable QHSE ;
 * - mise à jour ou rétrofit d'un ordre libéré, non réalisé, échéance dans l'horizon ou dépassée
 *   (`eco-effectivite|<ordre>|<type>|<cible>`) : au pilote, sinon au responsable QHSE du site.
 * Visibles du QHSE et de la direction (écran modifiable), et des destinataires (approbateur, pilote).
 */
export const loadEngineeringSignals = cache(async (): Promise<{ todo: TodoItem[] }> => {
  const session = await getSession();
  if (isEmployee(session.role)) return { todo: [] };
  const [data, keep, leads] = await Promise.all([readAll(), siteFilter('perimeter'), loadQhseLeads()]);
  const now = today();
  const present = (id: string | null) => {
    const p = id ? data.people.get(id) : undefined;
    return p && !hasLeft(p, now) ? { who: p.name, ownerIds: [p.id] } : null;
  };
  const dated = (dueOn: string) => (dueOn < now ? { date: now, dueOn, overdue: true, tone: 'danger' as const } : { date: dueOn, dueOn, tone: 'warn' as const });
  const todo: TodoItem[] = [];
  for (const r of data.ecrs) {
    if (r.status !== 'submitted' || r.cancelledAt || !keep(r.siteId)) continue;
    const to = leads.forSite(r.siteId);
    todo.push({
      ...dated(addDays(parisDay(r.createdAt), ECR_DECISION_DAYS)), kind: 'Modification technique', key: `ecr-decision|${r.id}`,
      title: `${r.id} · demande de ${ENGINEERING_SOURCES[r.source as EngineeringSource]} à décider : ${r.title}`,
      who: to.who, ownerIds: to.ownerIds, siteId: r.siteId, href: engineeringHref(r.id),
    });
  }
  for (const e of data.ecos) {
    if (e.cancelledAt || !keep(e.siteId)) continue;
    const approvals = data.approvals.filter((a) => a.ecoId === e.id);
    const targets = data.targets.filter((x) => x.ecoId === e.id);
    const owner = present(e.pilotId) ?? leads.forSite(e.siteId);
    if (e.status === 'in_approval') {
      const due = addDays(e.approvalRequestedOn ?? e.raisedOn, ECO_APPROVAL_DAYS);
      for (const a of approvals.filter((x) => x.decision === 'pending')) {
        const to = present(a.approverId) ?? leads.forSite(e.siteId);
        todo.push({
          ...dated(due), kind: 'Modification technique', key: `eco-approbation|${e.id}|${a.approvalKey}`,
          title: `${e.id} · approbation « ${ECO_APPROVAL_KEYS[a.approvalKey as EcoApprovalKey].label} » attendue (${a.approverText}) : ${e.title}`,
          who: to.who, ownerIds: to.ownerIds, siteId: e.siteId, href: engineeringHref(e.id),
        });
      }
      if (ecoLocked({ status: 'in_approval', interchangeability: e.interchangeability }, approvals as { approvalKey: EcoApprovalKey; decision: EcoDecision }[], targets)) {
        const last = approvals.reduce<Date | null>((m, a) => (a.decidedAt && (!m || a.decidedAt > m) ? a.decidedAt : m), null);
        todo.push({
          ...dated(last ? parisDay(last) : now), kind: 'Modification technique', key: `eco-dispositions|${e.id}`,
          title: `${e.id} · approuvé : ${pendingDispositions(targets)} disposition(s) d’effectivité à décider avant la libération`,
          who: owner.who, ownerIds: owner.ownerIds, siteId: e.siteId, href: engineeringHref(e.id),
        });
      }
    }
    if (e.status === 'released') {
      for (const g of targets) {
        if (!dispositionNeedsWork(g.disposition as EffectivityDisposition | null) || g.doneOn || !g.dueOn || g.dueOn > addDays(now, TODO_HORIZON_DAYS)) continue;
        todo.push({
          ...dated(g.dueOn), kind: 'Modification technique', key: `eco-effectivite|${e.id}|${g.targetType}|${g.targetRef}`,
          title: `${e.id} · ${EFFECTIVITY_DISPOSITIONS[g.disposition as EffectivityDisposition].label.toLowerCase()} à réaliser : ${targetText({ targetType: g.targetType as EffectivityTarget, label: g.label })}`,
          who: owner.who, ownerIds: owner.ownerIds, siteId: e.siteId, href: engineeringHref(e.id),
        });
      }
    }
  }
  return { todo: todo.filter((x) => canApprove(session.role) || (x.ownerIds ?? []).includes(session.user.id)) };
});

/** Résumé de la file d'envoi (onglet « Connecteurs », QHSE et direction) : nombres par état, messages refusés. */
export async function loadOutboundOverview() {
  const db = await getDb();
  const rows = await db.select().from(t.outboundMessages).orderBy(asc(t.outboundMessages.id));
  const counts = Object.fromEntries((Object.keys(OUTBOUND_STATUSES) as OutboundStatus[]).map((s) => [s, rows.filter((r) => r.status === s).length])) as Record<OutboundStatus, number>;
  const view = (r: (typeof rows)[number]) => ({
    id: r.id, target: r.target, entityId: r.entityId, status: r.status as OutboundStatus, attempts: r.attempts, lastError: r.lastError,
    nextAttemptAt: r.status === 'pending' ? r.nextAttemptAt.toISOString() : null, sentAt: r.sentAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
  });
  return {
    counts,
    failed: rows.filter((r) => r.status === 'failed').map(view),
    pending: rows.filter((r) => r.status === 'pending').map(view),
    lastSentAt: rows.reduce<Date | null>((m, r) => (r.sentAt && (!m || r.sentAt > m) ? r.sentAt : m), null)?.toISOString() ?? null,
  };
}
export type OutboundOverview = Awaited<ReturnType<typeof loadOutboundOverview>>;
