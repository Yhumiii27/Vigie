import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { schema as t, type Db, type DbOrTx } from '@/db';
import { EVENT_STEPS } from '@/lib/domain';
import { log } from '@/lib/log';
import { readDocumentsByRef } from '@/lib/foreign/codex';
import { isWithdrawn } from '@/lib/rules/documents';
import { ECO_STATUSES, matriculeOrNull, type EcoApprovalKey, type EcoDecision, type EcoStatus } from '@/lib/rules/engineering';
import {
  INBOUND_KINDS, NC_REFERENCE_LABELS, callerText, decideEcoRequest, decideEcrRequest, decideNcRequest, ecoPayloadSchema, isNcKind, ncPayloadSchema,
  type InboundKind, type InboundResultCode, type NcDecision, type NcFacts, type NcReferences,
} from '@/lib/rules/inbound';
import { logChange, type ChangeDetail } from './changelog';
import { ECR_ENTITY, enqueueCodexDecision, settleEco, writeApproval, writeEcoStep } from './engineering-core';
import { eventAdvanceBlocker, writeAdvance } from './event-workflow';

// Traitement des demandes reçues des autres outils (D13, décision CV-08 du 04/11/2026). La fonction
// vigie.pub_signaler_avancement_nc (migration 0026) ne fait que déposer une ligne « received » dans inbound_requests ;
// ce module la traite avec les règles de Vigie — décision pure decideNcRequest (src/lib/rules/inbound.ts), puis, pour un
// passage d'étape, la règle et l'écriture communes à l'écran Événements (src/server/event-workflow.ts) — et son journal :
// chaque changement appliqué est écrit dans change_log dans la même transaction, auteur vide (byId null) et appelant
// nommé dans l'intitulé (« Keystone (keystone_app) »), personne déclarée par l'appelant et commentaire dans le détail.
// Une demande n'est traitée qu'une fois (état relu dans la transaction ; une ligne par identifiant externe). Appelé par la
// tâche planifiée « Demandes reçues » (src/db/scheduler.ts) et par « Traiter maintenant » (src/server/connectors.ts).

export type InboundRunResult = { processed: number; applied: number; rejected: number; failed: number; deferred: number };

/** Nombre maximal de demandes traitées par passage (le reste attend le passage suivant). */
const BATCH = 200;

type Links = { eventId?: string | null; ecrId?: string | null; ecoId?: string | null };
type Outcome = ({ status: 'applied'; result: string } | { status: 'rejected'; code: InboundResultCode; result: string }) & Links & { eventId: string | null }
  // Source d'un autre outil indisponible (Codex) : demande laissée « reçue », reprise au passage suivant.
  | { status: 'defer'; result: string; eventId: null };

const rejected = (d: Extract<NcDecision, { kind: 'reject' }>, eventId: string | null): Outcome => ({ status: 'rejected', code: d.code, result: d.message, eventId });

type Request = typeof t.inboundRequests.$inferSelect;
type Caller = typeof t.inboundCallers.$inferSelect;

/** Outil admis pour chaque nature de demande : Keystone pour les NC et les ordres, Codex pour la création d'une demande. */
const toolFor = (kind: string) => (kind === 'ecr_create' ? 'codex' : 'keystone');

/** Traite une demande dans la transaction ; null si elle a déjà été traitée. */
async function processOne(tx: DbOrTx, id: number): Promise<Outcome | null> {
  const [r] = await tx.select().from(t.inboundRequests).where(and(eq(t.inboundRequests.id, id), eq(t.inboundRequests.status, 'received')));
  if (!r) return null;
  const [caller] = await tx.select().from(t.inboundCallers).where(eq(t.inboundCallers.role, r.caller));
  if (!caller || caller.tool !== toolFor(r.kind)) {
    return { status: 'rejected', code: 'refused', result: `Appelant ${r.caller} non admis pour cette demande.`, eventId: null };
  }
  if (r.kind === 'ecr_create') return processEcrCreate(tx, r, caller);
  if (!isNcKind(r.kind)) return processEco(tx, r, caller);
  return processNc(tx, r, caller);
}

/** Demande d'avancement d'une NC de projet (D13). */
async function processNc(tx: DbOrTx, r: Request, caller: Caller): Promise<Outcome> {
  const actor = callerText(caller.label, r.caller);
  // NC de projet visée : événement de type NC portant le code projet transmis. Tout autre élément (AT, MP, autre type,
  // autre projet, numéro inconnu) reçoit la même réponse « introuvable » et n'est pas rattaché à la demande.
  const [ev] = await tx.select().from(t.events).where(eq(t.events.id, r.targetRef));
  const nc = ev && ev.type === 'NC' && ev.keystoneProjectCode === r.projectCode ? ev : undefined;
  const facts: NcFacts | null = nc
    ? { step: nc.step, dismissed: !!nc.dismissedAt, activityCode: nc.keystoneActivityCode, partRef: nc.partRef, deliverableNumber: nc.keystoneDeliverableNumber }
    : null;
  const decision = decideNcRequest(r.kind as InboundKind, r.payload, facts, EVENT_STEPS, r.targetRef);
  if (decision.kind === 'reject' || !nc) return rejected(decision.kind === 'reject' ? decision : { kind: 'reject', code: 'not_found', message: 'NC introuvable.' }, nc?.id ?? null);

  const payload = ncPayloadSchema.parse(r.payload);
  const who = [payload.actor?.name, payload.actor?.role ? `(${payload.actor.role})` : null].filter(Boolean).join(' ');
  const context: ChangeDetail[] = [
    { field: 'Demande reçue', from: null, to: `${actor} · n° ${r.id} · ${INBOUND_KINDS[r.kind as InboundKind]}` },
    ...(who ? [{ field: `Personne déclarée par ${caller.label}`, from: null, to: who }] : []),
    ...(payload.comment ? [{ field: 'Commentaire', from: null, to: payload.comment }] : []),
  ];

  if (decision.kind === 'advance') {
    const blocker = await eventAdvanceBlocker(tx, nc, { health: false });
    if (blocker) return { status: 'rejected', code: 'refused', result: blocker, eventId: nc.id };
    if (!(await writeAdvance(tx, nc, { byId: null, inboundRequestId: r.id }))) {
      return { status: 'rejected', code: 'stale', result: "L'événement vient d'être modifié dans Vigie : demande à renvoyer d'après son nouvel état.", eventId: nc.id };
    }
    const to = EVENT_STEPS[decision.toStep];
    await logChange(tx, {
      byId: null, entityType: 'event', entityId: nc.id, action: 'status',
      summary: `${actor} : étape « ${to} » franchie (demande n° ${r.id})`,
      details: [{ field: 'Étape', from: EVENT_STEPS[decision.fromStep], to }, ...context],
    });
    return { status: 'applied', result: `Étape « ${to} » franchie dans Vigie.`, eventId: nc.id };
  }

  if (decision.kind === 'proposal') {
    const approved = decision.decision === 'approved';
    await logChange(tx, {
      byId: null, entityType: 'event', entityId: nc.id, action: 'inbound',
      summary: approved
        ? `${actor} : vérification approuvée, clôture proposée au QHSE (demande n° ${r.id})`
        : `${actor} : vérification refusée, retour aux actions correctives proposé au QHSE (demande n° ${r.id})`,
      details: context,
    });
    return {
      status: 'applied', eventId: nc.id,
      result: approved
        ? `Clôture proposée au QHSE de Vigie : la NC reste à l'étape « ${EVENT_STEPS[4]} » jusqu'à sa décision.`
        : `Retour aux actions correctives proposé au QHSE de Vigie : la NC reste à l'étape « ${EVENT_STEPS[4]} » jusqu'à sa décision.`,
    };
  }

  // Références Keystone (volet projet de la NC) : seulement les valeurs encore vides dans Vigie.
  const set = decision.set;
  const keys = Object.keys(set) as (keyof NcReferences)[];
  if (!keys.length) return { status: 'applied', result: 'Références déjà enregistrées dans Vigie : aucun changement.', eventId: nc.id };
  await tx.update(t.events).set({
    ...(set.activityCode ? { keystoneActivityCode: set.activityCode } : {}),
    ...(set.partRef ? { partRef: set.partRef } : {}),
    ...(set.deliverableNumber ? { keystoneDeliverableNumber: set.deliverableNumber } : {}),
  }).where(eq(t.events.id, nc.id));
  await logChange(tx, {
    byId: null, entityType: 'event', entityId: nc.id, action: 'update',
    summary: `${actor} : références du projet renseignées (demande n° ${r.id})`,
    details: [...keys.map((k) => ({ field: NC_REFERENCE_LABELS[k], from: null, to: set[k] ?? null })), ...context],
  });
  return { status: 'applied', result: `Références enregistrées : ${keys.map((k) => NC_REFERENCE_LABELS[k]).join(', ')}.`, eventId: nc.id };
}

/**
 * Traite les demandes « reçues », de la plus ancienne à la plus récente, une transaction par demande ; jamais d'exception
 * (une erreur imprévue laisse la demande « reçue », journal du serveur, échéance au-delà d'un jour).
 */
export async function processInboundRequests(db: Db): Promise<InboundRunResult> {
  const out: InboundRunResult = { processed: 0, applied: 0, rejected: 0, failed: 0, deferred: 0 };
  const pending = await db.select({ id: t.inboundRequests.id }).from(t.inboundRequests)
    .where(eq(t.inboundRequests.status, 'received')).orderBy(asc(t.inboundRequests.id)).limit(BATCH);
  for (const { id } of pending) {
    try {
      const outcome = await db.transaction(async (tx) => {
        const o = await processOne(tx, id);
        if (!o || o.status === 'defer') return o;
        await tx.update(t.inboundRequests).set({
          status: o.status, processedAt: new Date(), result: o.result, resultCode: o.status === 'rejected' ? o.code : null, eventId: o.eventId,
          ecrId: o.ecrId ?? null, ecoId: o.ecoId ?? null,
        }).where(and(eq(t.inboundRequests.id, id), eq(t.inboundRequests.status, 'received')));
        return o;
      });
      if (!outcome) continue;
      if (outcome.status === 'defer') {
        out.deferred++;
        continue;
      }
      out.processed++;
      out[outcome.status]++;
    } catch (err) {
      out.failed++;
      log.error('inbound.process', 'Demande reçue non traitée', { request: id, error: err });
    }
  }
  if (out.processed || out.failed) log.info('inbound.process', 'Demandes reçues traitées', { ...out });
  return out;
}

// ─── D12 (lot 5 de M-02) : demandes et ordres de modification ────────────────

/** Contexte d'une écriture reçue au journal : demande, personne déclarée par l'outil, commentaire (non publiés). */
function contextOf(r: Request, caller: Caller, actorText: string, p: { actor?: { name?: string | null; role?: string | null } | null; comment?: string | null }): ChangeDetail[] {
  const who = [p.actor?.name, p.actor?.role ? `(${p.actor.role})` : null].filter(Boolean).join(' ');
  return [
    { field: 'Demande reçue', from: null, to: `${actorText} · n° ${r.id} · ${INBOUND_KINDS[r.kind as InboundKind]}` },
    ...(who ? [{ field: `Personne déclarée par ${caller.label}`, from: null, to: who }] : []),
    ...(p.comment ? [{ field: 'Commentaire', from: null, to: p.comment }] : []),
  ];
}

/**
 * Création d'une demande de modification par Codex (vigie.pub_creer_demande_modification) : la demande porte le numéro
 * réservé par la fonction (target_ref) ; document inconnu, retiré ou déjà visé par une demande en cours : demande créée
 * « refusée » avec le motif, et Codex en est prévenu par son webhook. Codex indisponible : demande laissée « reçue ».
 */
async function processEcrCreate(tx: DbOrTx, r: Request, caller: Caller): Promise<Outcome> {
  const actor = callerText(caller.label, r.caller);
  const [exists] = await tx.select({ id: t.ecrs.id }).from(t.ecrs).where(eq(t.ecrs.id, r.targetRef));
  if (exists || !/^ECR-\d{4}-\d{3,}$/.test(r.targetRef)) return { status: 'rejected', code: 'invalid', result: `Numéro ${r.targetRef} invalide ou déjà attribué.`, eventId: null };
  const raw = r.payload as { documentId?: unknown };
  const docRef = typeof raw?.documentId === 'string' ? raw.documentId : '';
  let document: { id: string; title: string; site: string | null; withdrawn: boolean } | null = null;
  let openEcr: string | null = null;
  if (docRef) {
    const read = await readDocumentsByRef(tx, [docRef]);
    if (!read.ok) return { status: 'defer', result: read.message, eventId: null };
    const d = read.rows.find((x) => x.id === docRef || x.aliases.includes(docRef));
    if (d) {
      document = { id: d.id, title: d.title, site: d.site, withdrawn: isWithdrawn(d) };
      const [open] = await tx.select({ id: t.ecrs.id }).from(t.ecrs).where(and(eq(t.ecrs.codexDocId, d.id), inArray(t.ecrs.status, ['submitted', 'accepted'])));
      openEcr = open?.id ?? null;
    }
  }
  const decision = decideEcrRequest(r.payload, { document, openEcr }, r.targetRef);
  if (decision.kind === 'reject') return { status: 'rejected', code: decision.code, result: decision.message, eventId: null };
  const p = decision.payload;
  const [site] = document?.site ? await tx.select({ id: t.sites.id }).from(t.sites).where(eq(t.sites.id, document.site)) : [];
  const now = new Date();
  const rejected = decision.kind === 'reject_create';
  await tx.insert(t.ecrs).values({
    id: r.targetRef, kind: p.kind, subject: 'document', title: decision.title, reason: p.reason, description: p.description ?? '', source: 'codex',
    codexDocId: document?.id ?? p.documentId, requesterName: p.requester.name, requesterMatricule: matriculeOrNull(p.requester.matricule),
    requesterRef: p.requester.ref ?? null, siteId: site?.id ?? null, createdAt: now, updatedAt: now,
    ...(rejected ? { status: 'rejected', decidedAt: now, decisionNote: decision.message } : {}),
  });
  await logChange(tx, {
    entityType: ECR_ENTITY, entityId: r.targetRef, action: 'create', byId: null,
    summary: rejected ? `${actor} : demande reçue, refusée d’office (${decision.message})` : `${actor} : demande de modification reçue`,
    details: [
      ...(p.replacementId ? [{ field: 'Document de remplacement proposé', from: null, to: p.replacementId }] : []),
      ...contextOf(r, caller, actor, { actor: { name: p.requester.name, role: null }, comment: null }),
    ],
  });
  if (rejected) {
    await enqueueCodexDecision(tx, { id: r.targetRef, source: 'codex', codexDocId: document?.id ?? p.documentId, modifierRef: null }, { accepted: false, ecoRef: null, note: decision.message });
    return { status: 'rejected', code: decision.code, result: decision.message, eventId: null, ecrId: r.targetRef };
  }
  return { status: 'applied', result: `Demande ${r.targetRef} créée, à décider par le QHSE de Vigie.`, eventId: null, ecrId: r.targetRef };
}

/**
 * Avancement d'un ordre de modification par Keystone (vigie.pub_signaler_avancement_eco) : étape suivante selon les règles de
 * l'écran, ou décision d'une clé qu'il tient (ingénierie, chefs de projet), puis issue de l'ordre (libération d'office).
 * Ordre inconnu, annulé, ou sans article ni projet de Keystone : « introuvable ».
 */
async function processEco(tx: DbOrTx, r: Request, caller: Caller): Promise<Outcome> {
  const actor = callerText(caller.label, r.caller);
  const [eco] = await tx.select().from(t.ecos).where(eq(t.ecos.id, r.targetRef));
  let concerns = false;
  if (eco && !eco.cancelledAt) {
    const [part] = await tx.select({ id: t.ecoParts.ecoId }).from(t.ecoParts).where(eq(t.ecoParts.ecoId, eco.id)).limit(1);
    const [project] = await tx.select({ id: t.ecoProjects.ecoId }).from(t.ecoProjects).where(eq(t.ecoProjects.ecoId, eco.id)).limit(1);
    concerns = !!part || !!project || eco.source === 'keystone';
  }
  const approvals = concerns ? await tx.select({ approvalKey: t.ecoApprovals.approvalKey, decision: t.ecoApprovals.decision }).from(t.ecoApprovals).where(eq(t.ecoApprovals.ecoId, eco!.id)) : [];
  const facts = concerns ? {
    status: eco!.status as EcoStatus, interchangeability: eco!.interchangeability,
    approvals: approvals as { approvalKey: EcoApprovalKey; decision: EcoDecision }[],
  } : null;
  const decision = decideEcoRequest(r.kind as InboundKind, r.payload, facts, r.targetRef);
  const ecoId = concerns ? eco!.id : null;
  if (decision.kind === 'reject') return { status: 'rejected', code: decision.code, result: decision.message, eventId: null, ecoId };
  const p = ecoPayloadSchema.parse(r.payload);
  const context = contextOf(r, caller, actor, p);
  if (decision.kind === 'step') {
    if (!(await writeEcoStep(tx, eco!, decision.to, { byId: null, actor, details: context }))) {
      return { status: 'rejected', code: 'stale', result: "L'ordre vient d'être modifié dans Vigie : demande à renvoyer d'après son nouvel état.", eventId: null, ecoId };
    }
    await settleEco(tx, eco!.id, { byId: null, actor });
    return { status: 'applied', result: `Étape « ${ECO_STATUSES[decision.to].label} » franchie dans Vigie.`, eventId: null, ecoId };
  }
  if (decision.unchanged) return { status: 'applied', result: 'Décision déjà enregistrée dans Vigie : aucun changement.', eventId: null, ecoId };
  const at = p.recordedAt && !Number.isNaN(Date.parse(p.recordedAt)) && Date.parse(p.recordedAt) <= Date.now() ? new Date(p.recordedAt) : new Date();
  const ok = await writeApproval(tx, eco!.id, decision.key, {
    decision: decision.decision, comment: p.comment?.trim() || null, byId: null, byName: p.actor?.name?.trim() || caller.label, byMatricule: null,
    via: 'keystone', actor, at, details: context,
  });
  if (!ok) return { status: 'rejected', code: 'stale', result: 'Clé décidée entre-temps dans Vigie.', eventId: null, ecoId };
  const [after] = await tx.select({ status: t.ecos.status }).from(t.ecos).where(eq(t.ecos.id, eco!.id));
  return {
    status: 'applied', eventId: null, ecoId,
    result: after?.status === 'released' ? 'Décision enregistrée : ordre libéré.' : after?.status === 'rejected' ? 'Décision enregistrée : ordre rejeté.' : 'Décision enregistrée dans Vigie.',
  };
}
