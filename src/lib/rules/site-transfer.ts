// TDB-08 (réponse du service QHSE du 09/11/2026 : « avertir et proposer le transfert en masse ») : éléments ouverts d'un
// site qu'on cesse de suivre, décomptés avant l'archivage et transférables en une fois vers un autre site actif.
import { msgFr, type Msg } from '@/i18n/msg';

/** Types d'éléments ouverts couverts par le transfert (colonne `site_id` d'un seul site). */
export const SITE_OPEN_KINDS = ['events', 'actions', 'controls', 'plans', 'permits'] as const;
export type SiteOpenKind = (typeof SITE_OPEN_KINDS)[number];
export type SiteOpenCounts = Record<SiteOpenKind, number>;

/** Chaînes sources (singulier, pluriel) des éléments ouverts, rendues par src/i18n/msg.ts (VG-N01). */
const SITE_OPEN_EN: Record<SiteOpenKind, [Msg, Msg]> = {
  events: [{ en: '{n} open event#site' }, { en: '{n} open events#site' }],
  actions: [{ en: '{n} open QSE action' }, { en: '{n} open QSE actions' }],
  controls: [{ en: '{n} periodic check in force' }, { en: '{n} periodic checks in force' }],
  plans: [{ en: '{n} prevention plan in progress' }, { en: '{n} prevention plans in progress' }],
  permits: [{ en: '{n} permit requested or delivered' }, { en: '{n} permits requested or delivered' }],
};

export const emptyOpenCounts = (): SiteOpenCounts => ({ events: 0, actions: 0, controls: 0, plans: 0, permits: 0 });
export const openTotal = (c: SiteOpenCounts) => SITE_OPEN_KINDS.reduce((n, k) => n + c[k], 0);

/** Éléments ouverts d'un site, un libellé composé par type (« 3 événements non clôturés ») ; vide sans élément ouvert. */
export const openItemsMsgs = (c: SiteOpenCounts): Msg[] =>
  SITE_OPEN_KINDS.filter((k) => c[k] > 0).map((k) => ({ ...SITE_OPEN_EN[k][c[k] > 1 ? 1 : 0], values: { n: c[k] } }));

/** « 3 événements non clôturés, 1 action QSE ouverte » (français, journal et motif) ; chaîne vide sans élément ouvert. */
export function openItemsSummary(c: SiteOpenCounts): string {
  return openItemsMsgs(c).map(msgFr).join(', ');
}

/** Refus du site de destination d'un transfert, ou null : site actif, autre que le site archivé. */
export function transferTargetError(fromId: string, targetId: string, activeIds: readonly string[]): string | null {
  if (targetId === fromId) return 'Choisissez un autre site que celui que vous archivez.';
  return activeIds.includes(targetId) ? null : 'Site de destination archivé ou inconnu : choisissez un site actif.';
}
