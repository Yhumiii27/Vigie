// Registre des documents lus dans Codex (lot 4 de M-02, D10, décision CV-05 du 05/11/2026) : règles pures partagées par le
// serveur et les composants client. Codex fait foi (création, révisions, circuits, revues, retraits, conservation par
// type) ; Vigie consulte ses vues publiées, filtrées sur le périmètre QHSE et la confidentialité.

import { daysBetween } from '@/lib/dates';
import { TODO_HORIZON_DAYS } from '@/lib/horizons';
import type { Tone } from '@/lib/domain';

/**
 * Périmètre du registre (question C-06, choix par défaut du 05/11/2026) : documents sans rattachement (`attachment = 'none'`)
 * des départements Qualité et HSE de Codex. Un document cité par une fiche de Vigie reste résolu hors de ce périmètre.
 */
export const QHSE_DEPARTMENTS = ['QUA', 'HSE'] as const;

/** Le document relève-t-il du registre QHSE de Vigie ? */
export const inRegisterScope = (d: { attachment: string | null; department: string | null }) =>
  d.attachment === 'none' && (QHSE_DEPARTMENTS as readonly string[]).includes(d.department ?? '');

/** Niveaux de confidentialité publiés par Codex (« tres_confidentiel » n'est jamais publié). */
export const CONF_LEVELS: Record<string, string> = { public: 'Public', restreint: 'Restreint', interne: 'Interne', confidentiel: 'Confidentiel' };

/**
 * Lecture d'un document selon sa confidentialité (choix par défaut du lot 4) : public, restreint et interne pour tout
 * lecteur de l'écran Documents ; confidentiel pour le QHSE et la direction seulement (`qhse` = canApprove) ; tout autre
 * niveau (très confidentiel, inconnu) jamais.
 */
export function confReadable(conf: string | null, qhse: boolean): boolean {
  if (conf === 'public' || conf === 'restreint' || conf === 'interne') return true;
  return conf === 'confidentiel' && qhse;
}

/** Statut d'un document dans Codex (documents.status) : libellé et ton. */
export const DOC_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  in_review: { label: 'En validation', tone: 'warn' },
  approved: { label: 'Approuvé', tone: 'accent' },
  in_force: { label: 'En vigueur', tone: 'ok' },
  obsolete: { label: 'Obsolète', tone: 'neutral' },
  archived: { label: 'Archivé', tone: 'neutral' },
};
export const docStatus = (status: string | null) => DOC_STATUS[status ?? ''] ?? { label: status ?? '—', tone: 'neutral' as Tone };

/** Statut d'une révision dans Codex (revisions.status). */
export const REVISION_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  in_review: { label: 'En validation', tone: 'warn' },
  approved: { label: 'Approuvée', tone: 'accent' },
  in_force: { label: 'En vigueur', tone: 'ok' },
  superseded: { label: 'Remplacée', tone: 'neutral' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
};
export const revisionStatus = (status: string) => REVISION_STATUS[status] ?? { label: status, tone: 'neutral' as Tone };

/** Révision en cours de rédaction ou de validation (rattachable à une action, lien « docversion »). */
export const isOpenRevision = (status: string) => status === 'draft' || status === 'in_review' || status === 'approved';

/** Document applicable : actif et pourvu d'une révision en vigueur. */
export const isInForce = (d: { state: string | null; revInForce: string | null }) => d.state === 'active' && !!d.revInForce;
/** Document retiré (obsolète ou archivé dans Codex). */
export const isWithdrawn = (d: { state: string | null }) => d.state === 'obsolete' || d.state === 'archived';

/** Prochaine revue (review_due_at de Codex) : jours restants, retard, échéance proche (horizon commun TDB-16). */
export function reviewState(reviewDueAt: string | null, now: string) {
  const reviewDays = reviewDueAt ? daysBetween(now, reviewDueAt) : null;
  return { reviewDays, overdue: reviewDays != null && reviewDays < 0, dueSoon: reviewDays != null && reviewDays >= 0 && reviewDays <= TODO_HORIZON_DAYS };
}

/** Processus de l'entreprise (process_code de Codex) : libellés connus, code affiché sinon. */
export const PROCESSES: Record<string, string> = {
  QHSE: 'Management QHSE',
  DIR: 'Direction',
  COM: 'Commercial',
  BE: "Bureau d'études",
  ACH: 'Achats',
  USI: 'Usinage',
  MON: 'Montage',
  ESS: 'Essais',
  MAG: 'Magasin et logistique',
  RH: 'Ressources humaines',
};
export const processLabel = (code: string | null) => (!code ? '—' : Object.hasOwn(PROCESSES, code) ? PROCESSES[code] : code);

/** Filtres de statut (paramètre « statut ») : un document peut relever de plusieurs. */
export const STATUS_FILTERS = [
  ['vigueur', 'En vigueur'],
  ['validation', 'Révision en validation'],
  ['retard', 'Revue en retard'],
  ['brouillon', 'Révision en rédaction'],
  ['obsolete', 'Obsolètes ou archivés'],
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number][0];

/** Lien profond vers la fiche d'un document dans Codex (`VIGIE_CODEX_URL`) ; null sans adresse configurée. */
export const codexDocumentHref = (base: string | null | undefined, id: string) =>
  base ? `${base.replace(/\/+$/, '')}/documents/${encodeURIComponent(id)}` : null;

/** Lien du registre de Vigie vers un document (`?doc=`). */
export const documentHref = (id: string) => `/documents?doc=${encodeURIComponent(id)}`;

/** Libellé de conservation d'un type de Codex (« 10 ans après remplacement »). */
const TRIGGERS: Record<string, string> = {
  superseded: 'après remplacement', creation: 'après création', project_end: 'après la fin du projet', asset_life: 'durée de vie de l’ouvrage',
  contract_end: 'après la fin du contrat', employee_exit: 'après le départ du salarié',
};
export function retentionText(t: { retentionYears: number | null; retentionTrigger: string | null } | null | undefined): string | null {
  if (!t || (!t.retentionYears && !t.retentionTrigger)) return null;
  const when = t.retentionTrigger ? TRIGGERS[t.retentionTrigger] ?? t.retentionTrigger : '';
  if (t.retentionTrigger === 'asset_life') return `Durée de vie de l’ouvrage${t.retentionYears ? ` (au moins ${t.retentionYears} ans)` : ''}`;
  return t.retentionYears ? `${t.retentionYears} ans ${when}`.trim() : when;
}
