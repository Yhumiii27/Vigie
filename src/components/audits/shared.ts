// Constantes partagées par les composants de l'écran Audits et par src/server/audits.ts.
import { admissibleSources } from '@/lib/action-rules';
import type { ActionDefaults } from '@/lib/action-view';
import { MONTHS_SHORT, monthName } from '@/lib/dates';
import { FINDING_KINDS, TONE } from '@/lib/domain';

/** Valeur du choix « Nouvelle ligne… » dans le formulaire du programme annuel. */
export const NEW_TRACK = '__new';
/** Valeur du choix « Autre audit (hors programme)… » du formulaire de constat : libellé d'audit libre. */
export const OTHER_AUDIT = '__other';

export const CERT_TONES = ['ok', 'warn', 'off'] as const;
export type CertTone = (typeof CERT_TONES)[number];
export const CERT_TONE_LABELS: Record<CertTone, string> = { ok: 'Certifié', warn: 'En cours', off: 'Non engagé' };
export const certDot = (tone: string) => (tone === 'ok' ? TONE.ok.dot : tone === 'warn' ? TONE.warn.dot : 'var(--color-neutral-600)');

export const FINDING_KEYS = Object.keys(FINDING_KINDS);

/** Ligne du programme annuel où s'inscrivent les échéances des revues de direction (AUD-01). */
export const REVIEW_TRACK = 'Revues de direction';

/** « revue(s) de direction », casse et espaces indifférents (AUD-23). */
const REVIEW_WORDS = /\brevues?\s+de\s+direction\b/i;

/**
 * Échéance du programme qui porte une revue de direction (ni auditeur, ni périmètre, ni rapport, ni constats) : ligne des
 * revues (« Revues de direction »), ou libellé / intitulé « revue de direction ». Une ligne ou un élément « Revue de
 * contrat », « Revue de conception », « Revue documentaire »… reste un audit (AUD-23 : plus de simple mot « revue »).
 * Même règle pour le formulaire (affichage des champs d'audit), le serveur et les chargements.
 */
export const isReviewPlanItem = (p: { track: string; label: string; detail: string | null }) =>
  REVIEW_WORDS.test(p.track) || REVIEW_WORDS.test(`${p.label} ${p.detail ?? ''}`);

export const MONTH_OPTIONS = MONTHS_SHORT.map((_, i) => {
  const name = monthName(i + 1);
  return [String(i + 1), name[0].toUpperCase() + name.slice(1)] as const;
});

/** « Septembre 2026 » : mois et année d'un élément du programme (planification, report). */
export const monthLabel = (month: number, year: number) => `${MONTH_OPTIONS[month - 1]?.[1] ?? month} ${year}`;

/**
 * Source d'une action créée depuis un constat ou un élément du programme (D20, ACT-28) : imposée par la ligne du programme
 * (Certification → Audit de certification, Visites sécurité → Audit terrain, Audits internes → Audit interne, Fournisseurs →
 * Audit fournisseur, élément « Revues de direction » → Revue de direction) ; constat hors programme ou ligne libre : l'une des
 * quatre sources d'audit, Audit interne proposé.
 */
export function auditActionSource(kind: 'finding' | 'plan', track: string | null): Pick<ActionDefaults, 'source' | 'lockSource' | 'sourceChoices'> {
  const sources = admissibleSources(kind, { track });
  if (sources.length === 1) return { source: sources[0], lockSource: true };
  return { source: sources.includes('audit_interne') ? 'audit_interne' : sources[0], sourceChoices: sources };
}
