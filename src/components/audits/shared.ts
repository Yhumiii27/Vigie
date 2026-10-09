// Constantes partagées par les composants de l'écran Audits et par src/server/audits.ts.
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

/**
 * Échéance du programme qui porte une revue de direction (ni auditeur, ni périmètre, ni rapport, ni constats) : ligne des
 * revues, ou libellé / intitulé « revue de direction ». Une « revue de contrat » ou « de conception » reste un audit.
 * Même règle pour le formulaire (affichage des champs d'audit), le serveur et les chargements.
 */
export const isReviewPlanItem = (p: { track: string; label: string; detail: string | null }) =>
  /revue/i.test(p.track) || /revue\s+de\s+direction/i.test(`${p.label} ${p.detail ?? ''}`);

export const MONTH_OPTIONS = MONTHS_SHORT.map((_, i) => {
  const name = monthName(i + 1);
  return [String(i + 1), name[0].toUpperCase() + name.slice(1)] as const;
});
