// TDB-08 (réponse du service QHSE du 09/11/2026 : « avertir et proposer le transfert en masse ») : éléments ouverts d'un
// site qu'on cesse de suivre, décomptés avant l'archivage et transférables en une fois vers un autre site actif.

/** Types d'éléments ouverts couverts par le transfert (colonne `site_id` d'un seul site). */
export const SITE_OPEN_KINDS = ['events', 'actions', 'controls', 'plans', 'permits'] as const;
export type SiteOpenKind = (typeof SITE_OPEN_KINDS)[number];
export type SiteOpenCounts = Record<SiteOpenKind, number>;

/** Libellés (singulier, pluriel) des éléments ouverts. */
export const SITE_OPEN_LABELS: Record<SiteOpenKind, [string, string]> = {
  events: ['événement non clôturé', 'événements non clôturés'],
  actions: ['action QSE ouverte', 'actions QSE ouvertes'],
  controls: ['contrôle périodique en vigueur', 'contrôles périodiques en vigueur'],
  plans: ['plan de prévention en cours', 'plans de prévention en cours'],
  permits: ['permis demandé ou délivré', 'permis demandés ou délivrés'],
};

export const emptyOpenCounts = (): SiteOpenCounts => ({ events: 0, actions: 0, controls: 0, plans: 0, permits: 0 });
export const openTotal = (c: SiteOpenCounts) => SITE_OPEN_KINDS.reduce((n, k) => n + c[k], 0);

/** « 3 événements non clôturés, 1 action QSE ouverte » ; chaîne vide sans élément ouvert. */
export function openItemsSummary(c: SiteOpenCounts): string {
  return SITE_OPEN_KINDS.filter((k) => c[k] > 0).map((k) => `${c[k]} ${SITE_OPEN_LABELS[k][c[k] > 1 ? 1 : 0]}`).join(', ');
}

/** Refus du site de destination d'un transfert, ou null : site actif, autre que le site archivé. */
export function transferTargetError(fromId: string, targetId: string, activeIds: readonly string[]): string | null {
  if (targetId === fromId) return 'Choisissez un autre site que celui que vous archivez.';
  return activeIds.includes(targetId) ? null : 'Site de destination archivé ou inconnu : choisissez un site actif.';
}
