import 'server-only';
import { and, eq, like } from 'drizzle-orm';
import { schema as t, type DbOrTx } from '@/db';
import { addDays } from '@/lib/dates';
import {
  ECO_APPROVAL_KEYS, ECO_APPROVAL_KEY_LIST, ECO_DECISIONS, ECO_STATUSES, EFFECTIVITY_DEFAULT_DAYS, dispositionNeedsWork, ecoOutcome, ecoPrefix, ecrPrefix,
  type EcoApprovalKey, type EcoDecision, type EcoStatus,
} from '@/lib/rules/engineering';
import { codexDecisionPayload } from '@/lib/rules/outbound';
import { today } from '@/lib/today';
import { logChange } from './changelog';
import { nextReference, usedIds } from './references';

// Écritures communes des modifications techniques (D12, lot 5 de M-02) : server actions de l'écran
// (src/server/engineering.ts) et traitement des demandes reçues de Codex et de Keystone (src/server/inbound.ts). Pas de
// 'use server' : aucune action appelable depuis le navigateur ; ne lit jamais la session (auteur passé en argument, null
// pour une demande reçue : l'outil est nommé dans l'intitulé du journal). Toujours appelé dans la transaction de l'écriture.

export const ECO_ENTITY = 'eco';
export const ECR_ENTITY = 'ecr';

type Tx = DbOrTx;
type Eco = typeof t.ecos.$inferSelect;
type Ecr = typeof t.ecrs.$inferSelect;

/** Prochain numéro « ECO-AAAA-NNN » de l'année du jour (compteur « ref:ECO-AAAA- »), dans la transaction de création. */
export const nextEcoRef = (tx: Tx) => nextReference(tx, { prefix: ecoPrefix(today().slice(0, 4)), pad: 3, used: usedIds('eco', ecoPrefix(today().slice(0, 4))) });

/**
 * Prochain numéro « ECR-AAAA-NNN » : même compteur que la fonction vigie.pub_creer_demande_modification (portée
 * « ref:ECR-AAAA- »), au-delà des numéros déjà réservés par Codex (demandes reçues pas encore traitées) et des fiches.
 */
export function nextEcrRef(tx: Tx) {
  const prefix = ecrPrefix(today().slice(0, 4));
  return nextReference(tx, {
    prefix, pad: 3,
    used: async (db) => {
      const reserved = await db.select({ id: t.inboundRequests.targetRef }).from(t.inboundRequests)
        .where(and(eq(t.inboundRequests.kind, 'ecr_create'), like(t.inboundRequests.targetRef, `${prefix}%`)));
      return [...(await usedIds('ecr', prefix)(db)), ...reserved.map((r) => r.id)];
    },
  });
}

/**
 * File d'envoi vers Codex : décision sur une demande de Codex (webhook POST /api/integrations/vigie), écrite dans la
 * transaction de la décision ; état d'envoi recopié sur la demande (notify_*). Sans effet pour une demande qui ne vient pas
 * de Codex ou ne vise pas un de ses documents (Codex ne connaît que les siennes).
 */
export async function enqueueCodexDecision(tx: Tx, ecr: Pick<Ecr, 'id' | 'source' | 'codexDocId' | 'modifierRef'>, o: { accepted: boolean; ecoRef: string | null; note: string | null }) {
  if (ecr.source !== 'codex' || !ecr.codexDocId) return false;
  await tx.insert(t.outboundMessages).values({
    target: 'codex', kind: 'ecr_decision', entityType: ECR_ENTITY, entityId: ecr.id,
    payload: codexDecisionPayload({ requestId: ecr.id, accepted: o.accepted, ecoRef: o.ecoRef, modifierId: o.accepted ? ecr.modifierRef : null, note: o.note }),
    // Horloge du serveur Node, celle que compare sendOutboundMessages (le défaut now() de la base peut être en avance).
    nextAttemptAt: new Date(),
  });
  await tx.update(t.ecrs).set({ notifyStatus: 'pending', notifyAttempts: 0, notifyError: null, updatedAt: new Date() }).where(eq(t.ecrs.id, ecr.id));
  return true;
}

/** Libellé de l'auteur d'une écriture reçue dans un intitulé du journal (« Keystone (keystone_app) : … »). */
const by = (actor: string | null) => (actor ? `${actor} : ` : '');

/** Étape suivante d'un ordre (règle vérifiée avant l'appel : ecoStepBlocker). Renvoie false si l'ordre a changé entre-temps. */
export async function writeEcoStep(tx: Tx, eco: Pick<Eco, 'id' | 'status'>, to: EcoStatus, o: { byId: string | null; actor?: string | null; details?: { field: string; from: string | null; to: string | null }[] }) {
  const [row] = await tx.update(t.ecos).set({
    status: to, updatedAt: new Date(), ...(to === 'in_approval' ? { approvalRequestedOn: today() } : {}),
  }).where(and(eq(t.ecos.id, eco.id), eq(t.ecos.status, eco.status))).returning({ id: t.ecos.id });
  if (!row) return false;
  await logChange(tx, {
    entityType: ECO_ENTITY, entityId: eco.id, action: 'status', byId: o.byId,
    summary: `${by(o.actor ?? null)}étape « ${ECO_STATUSES[to].label} »`,
    details: [{ field: 'Étape', from: ECO_STATUSES[eco.status as EcoStatus].label, to: ECO_STATUSES[to].label }, ...(o.details ?? [])],
  });
  return true;
}

/** Décision d'une clé d'approbation (vérifications faites avant), puis issue de l'ordre (settleEco). */
export async function writeApproval(tx: Tx, ecoId: string, key: EcoApprovalKey, o: {
  decision: Exclude<EcoDecision, 'pending'>; comment: string | null; byId: string | null; byName: string; byMatricule: string | null; via: 'vigie' | 'keystone';
  actor?: string | null; at?: Date; details?: { field: string; from: string | null; to: string | null }[];
}) {
  const [row] = await tx.update(t.ecoApprovals).set({
    decision: o.decision, decidedByName: o.byName, decidedByMatricule: o.byMatricule, decidedAt: o.at ?? new Date(), comment: o.comment, via: o.via, decidedById: o.byId,
  }).where(and(eq(t.ecoApprovals.ecoId, ecoId), eq(t.ecoApprovals.approvalKey, key), eq(t.ecoApprovals.decision, 'pending'))).returning({ key: t.ecoApprovals.approvalKey });
  if (!row) return false;
  await tx.update(t.ecos).set({ updatedAt: new Date() }).where(eq(t.ecos.id, ecoId));
  await logChange(tx, {
    entityType: ECO_ENTITY, entityId: ecoId, action: 'approval', byId: o.byId,
    summary: `${by(o.actor ?? null)}${ECO_APPROVAL_KEYS[key].label} : ${ECO_DECISIONS[o.decision].label.toLowerCase()}`,
    details: [
      { field: ECO_APPROVAL_KEYS[key].label, from: ECO_DECISIONS.pending.label, to: ECO_DECISIONS[o.decision].label },
      ...(o.byId ? [] : [{ field: 'Décidé par', from: null, to: o.byName }]),
      ...(o.comment ? [{ field: 'Commentaire', from: null, to: o.comment }] : []),
      ...(o.details ?? []),
    ],
  });
  await settleEco(tx, ecoId, { byId: o.byId, actor: o.actor ?? null });
  return true;
}

/**
 * Issue d'un ordre en approbation (règle pure ecoOutcome) : libéré d'office (trois clés approuvées, interchangeabilité
 * évaluée, aucune disposition à décider ; échéance posée pour chaque mise à jour ou rétrofit), ou rejeté (une clé refusée) ;
 * les demandes acceptées rattachées sont alors transmises à Codex (acceptées avec le numéro de l'ordre, ou refusées).
 */
export async function settleEco(tx: Tx, ecoId: string, o: { byId: string | null; actor?: string | null }) {
  const [eco] = await tx.select().from(t.ecos).where(eq(t.ecos.id, ecoId));
  if (!eco) return null;
  const [approvals, targets] = await Promise.all([
    tx.select({ approvalKey: t.ecoApprovals.approvalKey, decision: t.ecoApprovals.decision }).from(t.ecoApprovals).where(eq(t.ecoApprovals.ecoId, ecoId)),
    tx.select().from(t.ecoEffectivity).where(eq(t.ecoEffectivity.ecoId, ecoId)),
  ]);
  const outcome = ecoOutcome(eco as { status: EcoStatus; interchangeability: string | null }, approvals as { approvalKey: EcoApprovalKey; decision: EcoDecision }[], targets);
  if (!outcome) return null;
  const now = new Date();
  if (outcome === 'released') {
    await tx.update(t.ecos).set({ status: 'released', releasedAt: now, updatedAt: now }).where(eq(t.ecos.id, ecoId));
    const due = addDays(today(), EFFECTIVITY_DEFAULT_DAYS);
    for (const g of targets) {
      if (dispositionNeedsWork(g.disposition as never) && !g.dueOn && !g.doneOn) {
        await tx.update(t.ecoEffectivity).set({ dueOn: due })
          .where(and(eq(t.ecoEffectivity.ecoId, ecoId), eq(t.ecoEffectivity.targetType, g.targetType), eq(t.ecoEffectivity.targetRef, g.targetRef)));
      }
    }
    await logChange(tx, {
      entityType: ECO_ENTITY, entityId: ecoId, action: 'release', byId: o.byId,
      summary: 'Ordre libéré d’office : approbations et dispositions acquises',
      details: [{ field: 'Étape', from: ECO_STATUSES.in_approval.label, to: ECO_STATUSES.released.label }],
    });
  } else {
    await tx.update(t.ecos).set({ status: 'rejected', rejectedAt: now, updatedAt: now }).where(eq(t.ecos.id, ecoId));
    await logChange(tx, {
      entityType: ECO_ENTITY, entityId: ecoId, action: 'reject', byId: o.byId,
      summary: 'Ordre rejeté : une approbation est refusée',
      details: [{ field: 'Étape', from: ECO_STATUSES.in_approval.label, to: ECO_STATUSES.rejected.label }],
    });
  }
  await closeLinkedEcrs(tx, ecoId, outcome === 'released' ? 'released' : 'rejected', o.byId, null);
  return outcome;
}

/**
 * Demandes acceptées rattachées à un ordre qui vient d'être libéré, rejeté ou annulé : transmises à Codex (acceptées avec le
 * numéro de l'ordre une fois libéré ; refusées sinon, la demande passant « refusée » avec le motif).
 */
export async function closeLinkedEcrs(tx: Tx, ecoId: string, how: 'released' | 'rejected' | 'cancelled', byId: string | null, reason: string | null) {
  const linked = await tx.select().from(t.ecrs).where(and(eq(t.ecrs.ecoId, ecoId), eq(t.ecrs.status, 'accepted')));
  for (const r of linked) {
    if (how === 'released') {
      await enqueueCodexDecision(tx, r, { accepted: true, ecoRef: ecoId, note: r.decisionNote });
      continue;
    }
    const note = how === 'cancelled' ? `Ordre ${ecoId} annulé : ${reason ?? ''}`.trim() : `Ordre ${ecoId} rejeté à l’approbation.`;
    await tx.update(t.ecrs).set({ status: 'rejected', decisionNote: note.slice(0, 2000), decidedAt: new Date(), decidedById: byId, updatedAt: new Date() }).where(eq(t.ecrs.id, r.id));
    await logChange(tx, {
      entityType: ECR_ENTITY, entityId: r.id, action: 'status', byId, summary: `Demande refusée : ${note}`,
      details: [{ field: 'État', from: 'Acceptée', to: 'Refusée' }],
    });
    await enqueueCodexDecision(tx, r, { accepted: false, ecoRef: ecoId, note });
  }
}

/** Articles, projets et documents d'un ordre réécrits (positions dans l'ordre saisi). */
export async function writeEcoLists(tx: Tx, ecoId: string, o: { parts: readonly string[]; projects: readonly string[]; documents: readonly { refLabel: string; codexDocId: string | null; ecrId?: string | null }[] }) {
  await tx.delete(t.ecoParts).where(eq(t.ecoParts.ecoId, ecoId));
  await tx.delete(t.ecoProjects).where(eq(t.ecoProjects.ecoId, ecoId));
  await tx.delete(t.ecoDocuments).where(eq(t.ecoDocuments.ecoId, ecoId));
  if (o.parts.length) await tx.insert(t.ecoParts).values(o.parts.map((partRef, i) => ({ ecoId, partRef, position: i + 1 })));
  if (o.projects.length) await tx.insert(t.ecoProjects).values(o.projects.map((keystoneProjectCode, i) => ({ ecoId, keystoneProjectCode, position: i + 1 })));
  if (o.documents.length) {
    await tx.insert(t.ecoDocuments).values(o.documents.map((d, i) => ({ ecoId, position: i + 1, refLabel: d.refLabel, codexDocId: d.codexDocId, ecrId: d.ecrId ?? null })));
  }
}

/** Approbateurs d'un ordre (texte affiché et personne désignée dans Vigie), trois clés créées « en attente ». */
export async function writeApprovers(tx: Tx, ecoId: string, approvers: Record<EcoApprovalKey, { text: string; approverId: string | null }>) {
  const current = await tx.select().from(t.ecoApprovals).where(eq(t.ecoApprovals.ecoId, ecoId));
  for (const key of ECO_APPROVAL_KEY_LIST) {
    const a = approvers[key];
    const row = current.find((c) => c.approvalKey === key);
    if (!row) await tx.insert(t.ecoApprovals).values({ ecoId, approvalKey: key, approverText: a.text, approverId: a.approverId });
    else if (row.decision === 'pending' && (row.approverText !== a.text || row.approverId !== a.approverId)) {
      await tx.update(t.ecoApprovals).set({ approverText: a.text, approverId: a.approverId }).where(and(eq(t.ecoApprovals.ecoId, ecoId), eq(t.ecoApprovals.approvalKey, key)));
    }
  }
}
