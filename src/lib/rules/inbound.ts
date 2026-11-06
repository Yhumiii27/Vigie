// Demandes reçues des autres outils (D13, décisions CV-07 et CV-08 du 04/11/2026) : règles pures du traitement des
// demandes déposées par Keystone dans la table de réception inbound_requests (fonction vigie.pub_signaler_avancement_nc,
// migration 0026). Module sans import de serveur : utilisé par src/server/inbound.ts (traitement), les chargements et les
// écrans. Clés stockées : src/lib/state-keys.ts.
//
// Ce que Keystone peut demander sur une NC de projet (événement de type NC portant le code du projet ; numéro = référence
// EV-… de Vigie, CV-07) — choix les plus restrictifs, à confirmer (docs/specs/convergence-m02.md § 7 ter) :
// - « step » : passage à l'étape suivante, depuis l'étape qu'il voit (sinon refus « stale »), selon les règles de Vigie
//   (advanceBlocker : analyse saisie, action liée, actions vérifiées) ; ni la qualification (pilote, gravité : le QHSE dans
//   Vigie), ni la clôture ;
// - « verification » : avis de vérification (approuvée → clôture proposée, refusée → retour aux actions correctives
//   proposé) ; Vigie n'en change pas l'étape : la proposition est une échéance du responsable QHSE du site, qui clôt ou
//   ramène la NC lui-même ;
// - « references » : activité, article et livrable Keystone de la NC, posés seulement s'ils sont vides dans Vigie.
// Jamais : une donnée de santé, un autre type d'événement (AT, MP…), une NC sans projet ou d'un autre projet (même réponse
// « introuvable » que pour un numéro inconnu : rien n'est révélé), une NC classée sans suite ou clôturée.

import { z } from 'zod';
import type { Tone } from '../domain';
import type { ENGINEERING_INBOUND_KIND_CODES, INBOUND_KIND_CODES, INBOUND_RESULT_CODES, INBOUND_STATUS_CODES } from '../state-keys';
import {
  ECO_APPROVAL_KEYS, ECO_NEXT_STEP, ECO_STATUSES, ECR_KINDS, KEYSTONE_APPROVAL_KEYS, ecoStepBlocker, type EcoApprovalKey, type EcoDecision, type EcoStatus,
} from './engineering';

export type InboundStatus = (typeof INBOUND_STATUS_CODES)[number];
export type InboundKind = (typeof INBOUND_KIND_CODES)[number] | (typeof ENGINEERING_INBOUND_KIND_CODES)[number];
export type InboundResultCode = (typeof INBOUND_RESULT_CODES)[number];

/** État d'une demande reçue (inbound_requests.status). */
export const INBOUND_STATUSES: Record<InboundStatus, { label: string; tone: Tone }> = {
  received: { label: 'Reçue, à traiter', tone: 'accent' },
  applied: { label: 'Appliquée', tone: 'ok' },
  rejected: { label: 'Refusée', tone: 'danger' },
};

/** Nature d'une demande (inbound_requests.kind). */
export const INBOUND_KINDS: Record<InboundKind, string> = {
  nc_step: 'Avancement',
  nc_verification: 'Vérification',
  nc_references: 'Références Keystone',
  // D12 (lot 5 de M-02) : demande de modification créée par Codex, avancement et approbation d'un ordre par Keystone.
  ecr_create: 'Demande de modification',
  eco_step: 'Avancement d’un ordre',
  eco_approval: 'Approbation d’un ordre',
};

/** Motif codé d'un refus (inbound_requests.result_code), lu par l'outil appelant. */
export const INBOUND_RESULTS: Record<InboundResultCode, string> = {
  stale: 'État changé dans Vigie',
  refused: 'Refusée par les règles de Vigie',
  not_found: 'Élément introuvable',
  invalid: 'Demande invalide',
};

/** Délai au-delà duquel une demande encore « reçue » devient une échéance du QHSE (traitement planifié en panne). */
export const INBOUND_PENDING_DAYS = 1;

/**
 * États d'une NC tels que Keystone les lit dans vigie.pub_non_conformites (colonne status : étape 0 à 5 de Vigie,
 * `least(step, 5)`) ; même ordre que EVENT_STEPS.
 */
export const NC_STATUS_CODES = ['open', 'containment', 'root_cause', 'corrective_action', 'verification', 'closed'] as const;
export type NcStatus = (typeof NC_STATUS_CODES)[number];
export const ncStatusOfStep = (step: number): NcStatus => NC_STATUS_CODES[Math.max(0, Math.min(step, NC_STATUS_CODES.length - 1))];
export const stepOfNcStatus = (s: NcStatus) => NC_STATUS_CODES.indexOf(s);

/** Outil appelant affiché au journal : « Keystone (keystone_app) ». */
export const callerText = (label: string, role: string) => `${label} (${role})`;

const ref = z.string().trim().min(1).max(64).regex(/^[^\p{Cc}]+$/u);
const optionalRef = ref.nullish();

/**
 * Contenu d'une demande d'avancement de NC (inbound_requests.payload), tel que la fonction le dépose : clés du corps déjà
 * émis par Keystone (quality-connector.ts : kind, fromStatus, targetStatus, decision, comment, actor, recordedAt) et
 * références du volet projet. Contrôlé à nouveau ici (une ligne écrite autrement que par la fonction est refusée).
 */
export const ncPayloadSchema = z.object({
  kind: z.enum(['step', 'verification', 'references']),
  fromStatus: z.enum(NC_STATUS_CODES).nullish(),
  targetStatus: z.enum(NC_STATUS_CODES).nullish(),
  decision: z.enum(['approved', 'rejected']).nullish(),
  comment: z.string().max(2000).nullish(),
  actor: z.object({ name: z.string().max(200).nullish(), role: z.string().max(50).nullish() }).nullish(),
  recordedAt: z.string().max(40).nullish(),
  activityCode: optionalRef,
  partRef: optionalRef,
  deliverableNumber: optionalRef,
});
export type NcPayload = z.infer<typeof ncPayloadSchema>;

/** Nature attendue de la demande d'après son contenu (colonne kind = « nc_ » + payload.kind). */
export const inboundKindOf = (p: Pick<NcPayload, 'kind'>): InboundKind => `nc_${p.kind}`;
/** Demande d'avancement d'une NC (D13), par opposition aux demandes de D12. */
export const isNcKind = (k: string) => k.startsWith('nc_');

/** Références Keystone d'une NC (colonnes de events, volet D13). */
export type NcReferences = { activityCode: string | null; partRef: string | null; deliverableNumber: string | null };
export const NC_REFERENCE_LABELS: Record<keyof NcReferences, string> = {
  activityCode: 'Activité Keystone', partRef: 'Article Keystone', deliverableNumber: 'Livrable Keystone',
};

/** Ce que Vigie sait de l'élément visé (null : aucune NC de projet de ce numéro pour ce projet). */
export type NcFacts = { step: number; dismissed: boolean } & NcReferences;

export type NcDecision =
  | { kind: 'advance'; fromStep: number; toStep: number }
  | { kind: 'proposal'; decision: 'approved' | 'rejected' }
  | { kind: 'references'; set: Partial<NcReferences> }
  | { kind: 'reject'; code: InboundResultCode; message: string };

const reject = (code: InboundResultCode, message: string): NcDecision => ({ kind: 'reject', code, message });

/** Libellé d'une étape vue de Keystone, avec son étape de Vigie : « Analyse des causes (root_cause) ». */
const stepText = (labels: readonly string[], s: NcStatus) => `« ${labels[stepOfNcStatus(s)]} » (${s})`;

/**
 * Décision sur une demande d'avancement de NC, avant les règles d'étape de Vigie (advanceBlocker, appliquées ensuite par
 * le traitement pour un passage d'étape). `stepLabels` : EVENT_STEPS.
 */
export function decideNcRequest(kind: InboundKind, rawPayload: unknown, facts: NcFacts | null, stepLabels: readonly string[], target: string): NcDecision {
  const parsed = ncPayloadSchema.safeParse(rawPayload);
  if (!parsed.success || inboundKindOf(parsed.data) !== kind) return reject('invalid', 'Contenu de la demande invalide.');
  const p = parsed.data;
  if (!facts) {
    return reject('not_found', `NC de projet ${target} introuvable dans Vigie pour ce projet (numéro inconnu, autre projet, ou élément qui n'est pas une non-conformité de projet).`);
  }
  if (facts.dismissed) return reject('refused', `NC ${target} classée sans suite dans Vigie : plus aucune demande n'y est appliquée.`);
  const current = ncStatusOfStep(facts.step);
  if (current === 'closed') return reject('refused', `NC ${target} clôturée dans Vigie : plus aucune demande n'y est appliquée.`);

  if (p.kind === 'references') {
    const asked: Partial<NcReferences> = {};
    for (const k of Object.keys(NC_REFERENCE_LABELS) as (keyof NcReferences)[]) if (p[k]) asked[k] = p[k]!.trim();
    if (!Object.keys(asked).length) return reject('invalid', 'Aucune référence Keystone transmise.');
    const conflicts = (Object.keys(asked) as (keyof NcReferences)[]).filter((k) => facts[k] && facts[k] !== asked[k]);
    if (conflicts.length) {
      return reject('refused', `Déjà renseigné dans Vigie avec une autre valeur : ${conflicts.map((k) => `${NC_REFERENCE_LABELS[k]} « ${facts[k]} »`).join(', ')} (à corriger par le QHSE dans Vigie).`);
    }
    const set = Object.fromEntries(Object.entries(asked).filter(([k]) => !facts[k as keyof NcReferences])) as Partial<NcReferences>;
    return { kind: 'references', set };
  }

  if (!p.fromStatus) return reject('invalid', "Étape de départ (fromStatus) absente.");
  if (p.fromStatus !== current) {
    return reject('stale', `État changé dans Vigie : la NC ${target} est à l'étape ${stepText(stepLabels, current)}, pas ${stepText(stepLabels, p.fromStatus)}.`);
  }

  if (p.kind === 'verification') {
    if (!p.decision) return reject('invalid', 'Décision de vérification (decision) absente.');
    if (current !== 'verification') {
      return reject('stale', `La NC ${target} n'est pas à l'étape ${stepText(stepLabels, 'verification')}.`);
    }
    return { kind: 'proposal', decision: p.decision };
  }

  // Passage d'étape.
  const next = NC_STATUS_CODES[stepOfNcStatus(current) + 1];
  if (!p.targetStatus || p.targetStatus !== next) {
    return reject('invalid', `Étape demandée ${p.targetStatus ? stepText(stepLabels, p.targetStatus) : 'absente'} : seule l'étape suivante ${stepText(stepLabels, next)} peut être demandée.`);
  }
  if (next === 'containment') {
    return reject('refused', `La qualification d'une NC (pilote, gravité, étape ${stepText(stepLabels, 'containment')}) se fait dans Vigie par le QHSE.`);
  }
  if (next === 'closed') return reject('refused', 'La clôture passe par une vérification (proposée au QHSE de Vigie), jamais par un passage d’étape.');
  return { kind: 'advance', fromStep: stepOfNcStatus(current), toStep: stepOfNcStatus(next) };
}

/** Texte court d'une demande pour l'historique de la fiche : « Avancement → Analyse des causes ». */
export function inboundSummary(kind: InboundKind, rawPayload: unknown, stepLabels: readonly string[]): string {
  if (kind === 'ecr_create') {
    const p = ecrCreatePayloadSchema.safeParse(rawPayload);
    return p.success ? `${ECR_KINDS[p.data.kind]} du document ${p.data.documentId}` : INBOUND_KINDS[kind];
  }
  if (kind === 'eco_step' || kind === 'eco_approval') {
    const p = ecoPayloadSchema.safeParse(rawPayload);
    if (!p.success) return INBOUND_KINDS[kind];
    return p.data.kind === 'step'
      ? `Passage à l'étape « ${p.data.targetStatus ? ECO_STATUSES[p.data.targetStatus].label : '—'} »`
      : `${ECO_APPROVAL_KEYS[p.data.approvalKey ?? 'englead'].label} : ${p.data.decision === 'ok' ? 'approuvé' : 'refusé'}`;
  }
  const parsed = ncPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return INBOUND_KINDS[kind] ?? kind;
  const p = parsed.data;
  if (p.kind === 'step') return `Passage à l'étape « ${p.targetStatus ? stepLabels[stepOfNcStatus(p.targetStatus)] : '—'} »`;
  if (p.kind === 'verification') return p.decision === 'approved' ? 'Vérification approuvée : clôture proposée' : 'Vérification refusée : retour aux actions correctives proposé';
  const refs = (Object.keys(NC_REFERENCE_LABELS) as (keyof NcReferences)[]).filter((k) => p[k]).map((k) => `${NC_REFERENCE_LABELS[k]} ${p[k]}`);
  return `Références : ${refs.join(', ') || '—'}`;
}

// ─── D12 (lot 5 de M-02) : demandes et ordres de modification ────────────────
//
// - Codex crée une demande de modification (ECR) d'un de ses documents par vigie.pub_creer_demande_modification : la
//   fonction réserve le numéro ECR-AAAA-NNN (rendu à Codex) et dépose la demande ; Vigie crée la demande à son traitement
//   (« À décider »), ou une demande refusée d'office avec le motif (document inconnu de Codex, demande déjà en cours pour ce
//   document) : le numéro rendu désigne toujours une demande lisible dans vigie.pub_demandes_modification.
// - Keystone signale l'avancement d'un ordre (ECO) par vigie.pub_signaler_avancement_eco : étape suivante (brouillon →
//   analyse d'impact → en approbation, selon les règles de l'écran), ou décision d'une clé d'approbation qu'il tient
//   (ingénierie, chefs de projet ; la clé qualité est décidée dans Vigie) ; jamais la libération (d'office) ni le rejet direct.

const optText = (max: number) => z.string().max(max).nullish();

/** Contenu d'une création de demande par Codex (payload déposé par la fonction). */
export const ecrCreatePayloadSchema = z.object({
  kind: z.enum(['modification', 'obsolescence']),
  documentId: ref,
  reason: z.string().trim().min(1).max(2000),
  description: optText(4000),
  requester: z.object({ ref: optText(64), name: z.string().trim().min(1).max(200), matricule: optText(20) }),
  replacementId: ref.nullish(),
  recordedAt: z.string().max(40).nullish(),
});
export type EcrCreatePayload = z.infer<typeof ecrCreatePayloadSchema>;

/** Ce que Vigie sait du document visé : null si Codex ne le connaît pas ; `openEcr` : demande déjà en cours pour lui. */
export type EcrCreateFacts = { document: { id: string; title: string; site: string | null; withdrawn: boolean } | null; openEcr: string | null };

export type EcrCreateDecision =
  | { kind: 'create'; payload: EcrCreatePayload; title: string }
  | { kind: 'reject_create'; payload: EcrCreatePayload; title: string; code: InboundResultCode; message: string }
  | { kind: 'reject'; code: InboundResultCode; message: string };

/**
 * Décision sur une création de demande par Codex. Contenu invalide : refus sans demande (rien à créer). Document inconnu,
 * retiré, ou déjà visé par une demande en cours : demande créée « refusée » avec le motif (le numéro rendu à Codex reste
 * lisible). Sinon : demande créée « À décider ».
 */
export function decideEcrRequest(rawPayload: unknown, facts: EcrCreateFacts, target: string): EcrCreateDecision {
  const parsed = ecrCreatePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return { kind: 'reject', code: 'invalid', message: `Contenu de la demande ${target} invalide.` };
  const p = parsed.data;
  const title = `${ECR_KINDS[p.kind]} de ${facts.document ? `${facts.document.id} · ${facts.document.title}` : p.documentId}`.slice(0, 300);
  if (!facts.document) return { kind: 'reject_create', payload: p, title, code: 'not_found', message: `Document ${p.documentId} introuvable dans Codex (vue des documents publiée par Codex).` };
  if (facts.document.withdrawn) return { kind: 'reject_create', payload: p, title, code: 'refused', message: `Document ${p.documentId} déjà retiré de la diffusion dans Codex.` };
  if (facts.openEcr) return { kind: 'reject_create', payload: p, title, code: 'refused', message: `Une demande est déjà en cours pour le document ${p.documentId} : ${facts.openEcr}.` };
  return { kind: 'create', payload: p, title };
}

/** Contenu d'un avancement d'ordre par Keystone (corps de eco-connector.ts de Keystone, docs/integrations/vigie-contract.md § 3.1). */
export const ecoPayloadSchema = z.object({
  kind: z.enum(['step', 'approval']),
  approvalKey: z.enum(['englead', 'quality', 'pm']).nullish(),
  decision: z.enum(['ok', 'rejected']).nullish(),
  fromStatus: z.enum(['draft', 'impact_analysis', 'in_approval', 'released', 'rejected']).nullish(),
  targetStatus: z.enum(['draft', 'impact_analysis', 'in_approval', 'released', 'rejected']).nullish(),
  comment: z.string().max(2000).nullish(),
  actor: z.object({ name: z.string().max(200).nullish(), role: z.string().max(50).nullish() }).nullish(),
  recordedAt: z.string().max(40).nullish(),
});

/** Ce que Vigie sait de l'ordre visé (null : inconnu, annulé, ou sans article ni projet de Keystone). */
export type EcoFacts = {
  status: EcoStatus; interchangeability: string | null;
  approvals: { approvalKey: EcoApprovalKey; decision: EcoDecision }[];
};

export type EcoInboundDecision =
  | { kind: 'step'; from: EcoStatus; to: EcoStatus }
  | { kind: 'approval'; key: EcoApprovalKey; decision: 'ok' | 'rejected'; unchanged: boolean }
  | { kind: 'reject'; code: InboundResultCode; message: string };

/** Décision sur une demande de Keystone visant un ordre (avant les écritures, faites par src/server/engineering-core.ts). */
export function decideEcoRequest(kind: InboundKind, rawPayload: unknown, facts: EcoFacts | null, target: string): EcoInboundDecision {
  const parsed = ecoPayloadSchema.safeParse(rawPayload);
  const reject = (code: InboundResultCode, message: string): EcoInboundDecision => ({ kind: 'reject', code, message });
  if (!parsed.success || `eco_${parsed.data.kind}` !== kind) return reject('invalid', 'Contenu de la demande invalide.');
  const p = parsed.data;
  if (!facts) return reject('not_found', `Ordre de modification ${target} introuvable dans Vigie (numéro inconnu, annulé, ou sans article ni projet de Keystone).`);
  if (facts.status === 'released' || facts.status === 'rejected') {
    return reject('refused', `Ordre ${target} ${ECO_STATUSES[facts.status].label.toLowerCase()} dans Vigie : plus aucune demande n'y est appliquée.`);
  }
  if (p.kind === 'step') {
    if (!p.fromStatus) return reject('invalid', 'Étape de départ (fromStatus) absente.');
    if (p.fromStatus !== facts.status) {
      return reject('stale', `État changé dans Vigie : l'ordre ${target} est à l'étape « ${ECO_STATUSES[facts.status].label} » (${facts.status}), pas « ${ECO_STATUSES[p.fromStatus].label} » (${p.fromStatus}).`);
    }
    if (!p.targetStatus) return reject('invalid', 'Étape demandée (targetStatus) absente.');
    const blocker = ecoStepBlocker(facts, p.targetStatus);
    // Étape qui n'est pas la suivante : demande invalide ; étape suivante bloquée par une règle (interchangeabilité) : refus.
    if (blocker) return reject(ECO_NEXT_STEP[facts.status] === p.targetStatus ? 'refused' : 'invalid', blocker);
    return { kind: 'step', from: facts.status, to: p.targetStatus };
  }
  if (!p.approvalKey || !p.decision) return reject('invalid', "Clé d'approbation (approvalKey) ou décision (decision) absente.");
  if (!KEYSTONE_APPROVAL_KEYS.includes(p.approvalKey)) {
    return reject('refused', `La clé « ${ECO_APPROVAL_KEYS[p.approvalKey].label} » se décide dans Vigie par le service QHSE.`);
  }
  if (facts.status !== 'in_approval') return reject('stale', `L'ordre ${target} n'est pas en approbation dans Vigie (étape « ${ECO_STATUSES[facts.status].label} »).`);
  const current = facts.approvals.find((a) => a.approvalKey === p.approvalKey);
  if (current && current.decision !== 'pending') {
    if (current.decision === p.decision) return { kind: 'approval', key: p.approvalKey, decision: p.decision, unchanged: true };
    return reject('refused', `Clé « ${ECO_APPROVAL_KEYS[p.approvalKey].label} » déjà décidée dans Vigie (${current.decision === 'ok' ? 'approuvée' : 'refusée'}).`);
  }
  return { kind: 'approval', key: p.approvalKey, decision: p.decision, unchanged: false };
}
