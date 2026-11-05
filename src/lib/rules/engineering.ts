// Modifications techniques (D12 de Matrix, lot 5 de M-02, décision CV-06 du 05/11/2026 ; docs/specs/modifications-techniques.md) :
// règles pures des demandes (ECR) et ordres (ECO) de modification. Module sans import de serveur : utilisé par les server
// actions (src/server/engineering.ts), le traitement des demandes reçues (src/server/inbound.ts), les chargements et les
// écrans. Clés stockées : src/lib/state-keys.ts (contraintes de la migration 0029, spécification
// partage/60-vigie-ecr-eco.sql de Matrix). Valeurs calculées, jamais stockées : dispositions à décider, verrouillage.

import type { Tone } from '../domain';
import type {
  ECO_APPROVAL_KEY_CODES, ECO_DECISION_CODES, ECO_STATUS_CODES, ECO_TYPE_CODES, ECR_KIND_CODES, ECR_STATUS_CODES, ECR_SUBJECT_CODES,
  EFFECTIVITY_DISPOSITION_CODES, EFFECTIVITY_TARGET_CODES, ENGINEERING_SOURCE_CODES,
} from '../state-keys';

export type EcoType = (typeof ECO_TYPE_CODES)[number];
export type EcoStatus = (typeof ECO_STATUS_CODES)[number];
export type EcrKind = (typeof ECR_KIND_CODES)[number];
export type EcrSubject = (typeof ECR_SUBJECT_CODES)[number];
export type EcrStatus = (typeof ECR_STATUS_CODES)[number];
export type EcoApprovalKey = (typeof ECO_APPROVAL_KEY_CODES)[number];
export type EcoDecision = (typeof ECO_DECISION_CODES)[number];
export type EffectivityTarget = (typeof EFFECTIVITY_TARGET_CODES)[number];
export type EffectivityDisposition = (typeof EFFECTIVITY_DISPOSITION_CODES)[number];
export type EngineeringSource = (typeof ENGINEERING_SOURCE_CODES)[number];

/** Chemin de l'écran (adresse convenue avec Keystone, NEW-D4-1, et proposée à Codex : CV-06). */
export const ENGINEERING_PATH = '/modifications-techniques';
/** Onglet des demandes de modification (`?onglet=demandes`) ; les ordres sont l'onglet par défaut. */
export const ECR_TAB = 'demandes';

export const ECO_TYPES: Record<EcoType, string> = {
  rev: 'Révision d’article', sub: 'Substitution en nomenclature', asm: 'Structure d’assemblage', sup: 'Fournisseur / faire ou acheter', obs: 'Obsolescence',
};
export const ECO_TYPE_KEYS = Object.keys(ECO_TYPES) as EcoType[];

export const ECO_STATUSES: Record<EcoStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  impact_analysis: { label: 'Analyse d’impact', tone: 'accent' },
  in_approval: { label: 'En approbation', tone: 'warn' },
  released: { label: 'Libéré', tone: 'ok' },
  rejected: { label: 'Rejeté', tone: 'danger' },
};
export const ECO_STATUS_KEYS = Object.keys(ECO_STATUSES) as EcoStatus[];
/** Étapes du parcours d'un ordre (indicateur d'étapes) ; « rejected » hors parcours. */
export const ECO_FLOW: readonly EcoStatus[] = ['draft', 'impact_analysis', 'in_approval', 'released'];
/** Étape suivante demandable (par Vigie ou par Keystone) : la libération est automatique, jamais demandée. */
export const ECO_NEXT_STEP: Partial<Record<EcoStatus, EcoStatus>> = { draft: 'impact_analysis', impact_analysis: 'in_approval' };
/** Ordre encore modifiable (champs, articles, projets, documents) : brouillon ou analyse d'impact. */
export const ecoEditable = (s: EcoStatus) => s === 'draft' || s === 'impact_analysis';
/** Ordre ouvert : ni libéré ni rejeté. */
export const ecoOpen = (s: EcoStatus) => s !== 'released' && s !== 'rejected';

export const INTERCHANGEABILITY: Record<'yes' | 'no', string> = { yes: 'Interchangeable', no: 'Non interchangeable' };
export const INTERCHANGEABILITY_UNSET = 'Non évaluée';

export const ECR_KINDS: Record<EcrKind, string> = { modification: 'Modification', obsolescence: 'Retrait (obsolescence)' };
export const ECR_KIND_KEYS = Object.keys(ECR_KINDS) as EcrKind[];
export const ECR_SUBJECTS: Record<EcrSubject, string> = { document: 'Document (Codex)', part: 'Article (Keystone)', project: 'Projet (Keystone)', event: 'Événement (NC)' };
export const ECR_SUBJECT_KEYS = Object.keys(ECR_SUBJECTS) as EcrSubject[];
export const ECR_STATUSES: Record<EcrStatus, { label: string; tone: Tone }> = {
  submitted: { label: 'À décider', tone: 'warn' },
  accepted: { label: 'Acceptée', tone: 'accent' },
  rejected: { label: 'Refusée', tone: 'danger' },
  implemented: { label: 'Mise en œuvre', tone: 'ok' },
};
export const ECR_STATUS_KEYS = Object.keys(ECR_STATUSES) as EcrStatus[];

export const ENGINEERING_SOURCES: Record<EngineeringSource, string> = { vigie: 'Vigie', keystone: 'Keystone', codex: 'Codex' };

/** Clés d'approbation d'un ordre, dans l'ordre de la fiche (Keystone : ECO_APPROVER_KEYS). */
export const ECO_APPROVAL_KEYS: Record<EcoApprovalKey, { label: string; short: string; fallback: string }> = {
  englead: { label: 'Responsable ingénierie', short: 'Ingénierie', fallback: 'Responsable ingénierie' },
  quality: { label: 'Qualité (ISO 9001)', short: 'Qualité', fallback: 'Service QHSE' },
  pm: { label: 'Chefs des projets visés', short: 'Projets', fallback: 'Chefs des projets visés' },
};
export const ECO_APPROVAL_KEY_LIST = Object.keys(ECO_APPROVAL_KEYS) as EcoApprovalKey[];
export const ECO_DECISIONS: Record<EcoDecision, { label: string; tone: Tone }> = {
  pending: { label: 'En attente', tone: 'neutral' },
  ok: { label: 'Approuvé', tone: 'ok' },
  rejected: { label: 'Refusé', tone: 'danger' },
};
/**
 * Clés qu'un autre outil (Keystone) peut décider par la fonction vigie.pub_signaler_avancement_eco : ingénierie et chefs de
 * projet ; la clé qualité est décidée dans Vigie par le service QHSE (choix par défaut à confirmer).
 */
export const KEYSTONE_APPROVAL_KEYS: readonly EcoApprovalKey[] = ['englead', 'pm'];

export const EFFECTIVITY_TARGETS: Record<EffectivityTarget, string> = { project: 'Projet', machine: 'Machine du parc' };
export const EFFECTIVITY_DISPOSITIONS: Record<EffectivityDisposition, { label: string; machineOnly?: boolean }> = {
  update: { label: 'Mise à jour' },
  pinned: { label: 'Conservé à l’indice actuel' },
  retrofit: { label: 'Rétrofit', machineOnly: true },
  na: { label: 'Sans objet' },
};
export const EFFECTIVITY_DISPOSITION_KEYS = Object.keys(EFFECTIVITY_DISPOSITIONS) as EffectivityDisposition[];
/** Dispositions qui demandent une réalisation (échéance, date de réalisation) une fois l'ordre libéré. */
export const dispositionNeedsWork = (d: EffectivityDisposition | null) => d === 'update' || d === 'retrofit';
/** Disposition admise pour une cible (le rétrofit ne vaut que pour une machine du parc installé). */
export const dispositionError = (target: EffectivityTarget, d: EffectivityDisposition | null) =>
  d && EFFECTIVITY_DISPOSITIONS[d].machineOnly && target !== 'machine' ? 'Le rétrofit ne vaut que pour une machine du parc installé.' : null;

// ─── Numérotation ────────────────────────────────────────────────────────────

/** Préfixe de numérotation d'une année : « ECO-2026- », « ECR-2026- » (portée du compteur « ref:<préfixe> »). */
export const ecoPrefix = (year: string) => `ECO-${year}-`;
export const ecrPrefix = (year: string) => `ECR-${year}-`;
export const ECO_REF = /^ECO-\d{4}-\d{3,}$/;
export const ECR_REF = /^ECR-\d{4}-\d{3,}$/;
/** Numéro d'une fiche de l'écran (ordre ou demande), ou null. */
export const engineeringKind = (ref: string | null | undefined): 'eco' | 'ecr' | null =>
  !ref ? null : ECO_REF.test(ref) ? 'eco' : ECR_REF.test(ref) ? 'ecr' : null;
/** Lien profond d'une fiche (onglet des demandes pour un ECR). */
export const engineeringHref = (ref: string) =>
  `${ENGINEERING_PATH}?${engineeringKind(ref) === 'ecr' ? `onglet=${ECR_TAB}&` : ''}sel=${encodeURIComponent(ref)}`;

// ─── Saisie ──────────────────────────────────────────────────────────────────

export const ECO_TITLE_MAX = 300;
export const ECR_TEXT_MAX = 2000;
export const REVISION_MAX = 20;
/** Référence Keystone (article, projet, machine) : 64 caractères au plus, sans caractère de contrôle. */
export const KEYSTONE_REF = /^[^\p{Cc},;]{1,64}$/u;
/** Matricule de Cursus (D01) : « EMP-0042 » ; une autre forme n'est pas enregistrée (contrainte de la spécification). */
export const MATRICULE = /^EMP-\d{4,}$/;
export const matriculeOrNull = (m: string | null | undefined) => (m && MATRICULE.test(m) ? m : null);

/** Liste saisie (articles, projets) : une référence par ligne ou séparée par une virgule, sans doublon, ordre gardé. */
export function parseRefList(raw: string): string[] {
  return [...new Set(raw.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean))];
}
/** Références invalides d'une liste (forme seulement ; l'existence est contrôlée contre les vues de Keystone). */
export const invalidRefs = (refs: readonly string[]) => refs.filter((r) => !KEYSTONE_REF.test(r));

/** Documents cités : une ligne « libellé » ou « libellé | identifiant Codex ». */
export function parseDocumentLines(raw: string): { refLabel: string; codexDocId: string | null }[] {
  return raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [label, id] = l.split('|').map((s) => s.trim());
    return { refLabel: label || id, codexDocId: id || null };
  });
}
export const documentLinesText = (docs: readonly { refLabel: string; codexDocId: string | null }[]) =>
  docs.map((d) => (d.codexDocId && d.codexDocId !== d.refLabel ? `${d.refLabel} | ${d.codexDocId}` : d.codexDocId ?? d.refLabel)).join('\n');

/** Objet d'une demande : la référence attendue selon l'objet (contrainte ecrs_objet_check). */
export function ecrSubjectError(subject: EcrSubject, refs: { codexDocId: string | null; partRef: string | null; projectCode: string | null; eventId: string | null }): { field: string; message: string } | null {
  const need: Record<EcrSubject, [keyof typeof refs, string]> = {
    document: ['codexDocId', 'Document de Codex obligatoire pour une demande sur un document.'],
    part: ['partRef', 'Article Keystone obligatoire pour une demande sur un article.'],
    project: ['projectCode', 'Projet Keystone obligatoire pour une demande sur un projet.'],
    event: ['eventId', 'Événement obligatoire pour une demande née d’un événement.'],
  };
  const [field, message] = need[subject];
  return refs[field] ? null : { field, message };
}

// ─── Parcours d'un ordre ─────────────────────────────────────────────────────

/** Refus d'un passage à l'étape suivante (règle commune à l'écran et aux demandes de Keystone), ou null. */
export function ecoStepBlocker(eco: { status: EcoStatus; interchangeability: string | null }, target: EcoStatus): string | null {
  const next = ECO_NEXT_STEP[eco.status];
  if (!next) return eco.status === 'in_approval' ? 'L’ordre est en approbation : il est libéré d’office quand toutes les approbations et dispositions sont acquises.' : 'Ordre libéré ou rejeté : il ne change plus d’étape.';
  if (target !== next) return `Seule l’étape suivante « ${ECO_STATUSES[next].label} » peut être demandée.`;
  if (target === 'in_approval' && !eco.interchangeability) return 'Interchangeabilité à évaluer avant la soumission à l’approbation.';
  return null;
}

type ApprovalState = { approvalKey: EcoApprovalKey; decision: EcoDecision };

/** Dispositions encore à décider (cibles sans disposition) : valeur publiée `pending_dispositions`, calculée. */
export const pendingDispositions = (targets: readonly { disposition: string | null }[]) => targets.filter((t) => !t.disposition).length;

/**
 * Issue d'un ordre en approbation après une décision ou une disposition : rejeté dès qu'une clé est refusée ; libéré d'office
 * quand les trois clés sont approuvées, l'interchangeabilité évaluée et aucune disposition à décider ; sinon inchangé
 * (« verrouillé » si les trois clés sont approuvées mais une disposition ou l'interchangeabilité manque).
 */
export function ecoOutcome(eco: { status: EcoStatus; interchangeability: string | null }, approvals: readonly ApprovalState[], targets: readonly { disposition: string | null }[]): 'rejected' | 'released' | null {
  if (eco.status !== 'in_approval') return null;
  if (approvals.some((a) => a.decision === 'rejected')) return 'rejected';
  const allOk = ECO_APPROVAL_KEY_LIST.every((k) => approvals.some((a) => a.approvalKey === k && a.decision === 'ok'));
  if (allOk && eco.interchangeability && pendingDispositions(targets) === 0) return 'released';
  return null;
}

/** Valeur publiée `locked` (définition de Matrix) : trois approbations acquises mais disposition ou interchangeabilité manquante. */
export function ecoLocked(eco: { status: EcoStatus; interchangeability: string | null }, approvals: readonly ApprovalState[], targets: readonly { disposition: string | null }[]) {
  const ok = approvals.filter((a) => a.decision === 'ok').length;
  return approvals.length === 3 && ok === 3 && eco.status !== 'draft' && eco.status !== 'rejected'
    && (pendingDispositions(targets) > 0 || !eco.interchangeability);
}

/**
 * Droit de décider une clé d'approbation dans Vigie : le service QHSE (animateur, direction) décide toute clé (pour le
 * compte de l'approbateur, journalisé) ; l'approbateur désigné dans Vigie décide la sienne seulement.
 */
export const canDecideApproval = (o: { qhse: boolean; userId: string; approverId: string | null }) => o.qhse || (!!o.approverId && o.approverId === o.userId);

// ─── Effectivité proposée d'après Keystone ───────────────────────────────────

export type BomUsage = { projectCode: string; partRef: string };
export type FleetRow = { number: string; name: string; projectCode: string | null; partRef: string | null; fittedRevision: string | null };
export type ProposedTarget = { targetType: EffectivityTarget; targetRef: string; label: string; isAutomatic: boolean; fittedPartRef: string | null; fittedRevision: string | null };

/**
 * Cibles proposées pour un ordre (effectivité par défaut) : projets déclarés, projets dont la nomenclature
 * (keystone.pub_nomenclatures) emploie un article de l'ordre, machines du parc (keystone.pub_parc_machines) qui portent un
 * article de l'ordre ou livrées par un projet visé (révision montée reprise). Les cibles déclarées à la main ne sont pas
 * « automatiques ». Ordre : projets, puis machines, par référence.
 */
export function proposeEffectivity(o: {
  parts: readonly string[]; projects: readonly string[]; bom: readonly BomUsage[]; fleet: readonly FleetRow[];
  projectLabel?: (code: string) => string;
}): ProposedTarget[] {
  const parts = new Set(o.parts);
  const declared = new Set(o.projects);
  const projectCodes = new Set([...o.projects, ...o.bom.filter((b) => parts.has(b.partRef)).map((b) => b.projectCode)]);
  const label = o.projectLabel ?? ((c: string) => c);
  const projects: ProposedTarget[] = [...projectCodes].sort().map((code) => ({
    targetType: 'project', targetRef: code, label: label(code), isAutomatic: !declared.has(code), fittedPartRef: null, fittedRevision: null,
  }));
  const machines = new Map<string, ProposedTarget>();
  for (const m of o.fleet) {
    const fitted = !!m.partRef && parts.has(m.partRef);
    const delivered = !!m.projectCode && projectCodes.has(m.projectCode);
    if (!fitted && !delivered) continue;
    const prev = machines.get(m.number);
    if (prev && prev.fittedPartRef) continue; // première révision montée d'un article de l'ordre gardée
    machines.set(m.number, {
      targetType: 'machine', targetRef: m.number, label: m.name ? `${m.number} · ${m.name}` : m.number, isAutomatic: true,
      fittedPartRef: fitted ? m.partRef : null, fittedRevision: fitted ? m.fittedRevision : null,
    });
  }
  return [...projects, ...[...machines.values()].sort((a, b) => a.targetRef.localeCompare(b.targetRef))];
}

// ─── Échéances ───────────────────────────────────────────────────────────────

/** Délai de décision d'une demande reçue (jours après sa création) au-delà duquel l'échéance est en retard. */
export const ECR_DECISION_DAYS = 15;
/** Délai d'approbation d'une clé (jours après le passage à « en approbation »). */
export const ECO_APPROVAL_DAYS = 10;
/** Délai proposé pour une mise à jour ou un rétrofit après la libération (jours), modifiable par cible. */
export const EFFECTIVITY_DEFAULT_DAYS = 60;

/** Texte d'une cible d'effectivité : « Projet K-2025-042 · Malaxeur… ». */
export const targetText = (t: { targetType: EffectivityTarget; label: string }) => `${EFFECTIVITY_TARGETS[t.targetType]} ${t.label}`;
