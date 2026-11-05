import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { schema as t, type Db, type DbOrTx } from '@/db';
import { EVENT_STEPS } from '@/lib/domain';
import { log } from '@/lib/log';
import {
  INBOUND_KINDS, NC_REFERENCE_LABELS, callerText, decideNcRequest, ncPayloadSchema, type InboundKind, type InboundResultCode, type NcDecision,
  type NcFacts, type NcReferences,
} from '@/lib/rules/inbound';
import { logChange, type ChangeDetail } from './changelog';
import { eventAdvanceBlocker, writeAdvance } from './event-workflow';

// Traitement des demandes reçues des autres outils (D13, décision CV-08 du 04/11/2026). La fonction
// vigie.pub_signaler_avancement_nc (migration 0026) ne fait que déposer une ligne « received » dans inbound_requests ;
// ce module la traite avec les règles de Vigie — décision pure decideNcRequest (src/lib/rules/inbound.ts), puis, pour un
// passage d'étape, la règle et l'écriture communes à l'écran Événements (src/server/event-workflow.ts) — et son journal :
// chaque changement appliqué est écrit dans change_log dans la même transaction, auteur vide (byId null) et appelant
// nommé dans l'intitulé (« Keystone (keystone_app) »), personne déclarée par l'appelant et commentaire dans le détail.
// Une demande n'est traitée qu'une fois (état relu dans la transaction ; une ligne par identifiant externe). Appelé par la
// tâche planifiée « Demandes reçues » (src/db/scheduler.ts) et par « Traiter maintenant » (src/server/connectors.ts).

export type InboundRunResult = { processed: number; applied: number; rejected: number; failed: number };

/** Nombre maximal de demandes traitées par passage (le reste attend le passage suivant). */
const BATCH = 200;

type Outcome = { status: 'applied'; result: string; eventId: string | null } | { status: 'rejected'; code: InboundResultCode; result: string; eventId: string | null };

const rejected = (d: Extract<NcDecision, { kind: 'reject' }>, eventId: string | null): Outcome => ({ status: 'rejected', code: d.code, result: d.message, eventId });

/** Traite une demande dans la transaction ; null si elle a déjà été traitée. */
async function processOne(tx: DbOrTx, id: number): Promise<Outcome | null> {
  const [r] = await tx.select().from(t.inboundRequests).where(and(eq(t.inboundRequests.id, id), eq(t.inboundRequests.status, 'received')));
  if (!r) return null;
  const [caller] = await tx.select().from(t.inboundCallers).where(eq(t.inboundCallers.role, r.caller));
  if (!caller || caller.tool !== 'keystone') {
    return { status: 'rejected', code: 'refused', result: `Appelant ${r.caller} non admis pour cette demande.`, eventId: null };
  }
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
  const out: InboundRunResult = { processed: 0, applied: 0, rejected: 0, failed: 0 };
  const pending = await db.select({ id: t.inboundRequests.id }).from(t.inboundRequests)
    .where(eq(t.inboundRequests.status, 'received')).orderBy(asc(t.inboundRequests.id)).limit(BATCH);
  for (const { id } of pending) {
    try {
      const outcome = await db.transaction(async (tx) => {
        const o = await processOne(tx, id);
        if (!o) return null;
        await tx.update(t.inboundRequests).set({
          status: o.status, processedAt: new Date(), result: o.result, resultCode: o.status === 'rejected' ? o.code : null, eventId: o.eventId,
        }).where(and(eq(t.inboundRequests.id, id), eq(t.inboundRequests.status, 'received')));
        return o;
      });
      if (!outcome) continue;
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
