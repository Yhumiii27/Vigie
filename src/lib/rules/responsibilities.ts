// HAB-05 (réponse du service QHSE du 09/11/2026 : « proposer de les réaffecter en masse ») : responsabilités ouvertes d'une
// personne sortie de l'effectif (sortie lue dans Cursus), signalées puis réaffectées en une fois à une personne présente.

/** Types de responsabilités ouvertes couverts (colonne de la personne désignée). */
export const RESPONSIBILITY_KINDS = ['actions', 'events', 'plans', 'audits', 'controls', 'requirements'] as const;
export type ResponsibilityKind = (typeof RESPONSIBILITY_KINDS)[number];
export type ResponsibilityCounts = Record<ResponsibilityKind, number>;

/** Libellés (singulier, pluriel) et rôle tenu. */
export const RESPONSIBILITY_LABELS: Record<ResponsibilityKind, [string, string]> = {
  actions: ['action QSE ouverte (responsable)', 'actions QSE ouvertes (responsable)'],
  events: ['événement non clôturé (pilote)', 'événements non clôturés (pilote)'],
  plans: ['plan de prévention en cours (responsable)', 'plans de prévention en cours (responsable)'],
  audits: ["élément du programme d'audit non réalisé (responsable)", "éléments du programme d'audit non réalisés (responsable)"],
  controls: ['contrôle périodique (responsable)', 'contrôles périodiques (responsable)'],
  requirements: ['exigence de veille (pilote)', 'exigences de veille (pilote)'],
};

export const responsibilityTotal = (c: ResponsibilityCounts) => RESPONSIBILITY_KINDS.reduce((n, k) => n + c[k], 0);

/** « 2 actions QSE ouvertes (responsable), 1 contrôle périodique (responsable) » ; vide sans responsabilité. */
export function responsibilitySummary(c: ResponsibilityCounts): string {
  return RESPONSIBILITY_KINDS.filter((k) => c[k] > 0).map((k) => `${c[k]} ${RESPONSIBILITY_LABELS[k][c[k] > 1 ? 1 : 0]}`).join(', ');
}

/** Refus de la personne choisie pour reprendre les responsabilités, ou null : personne connue, présente, autre que la sortante. */
export function reassignTargetError(fromId: string, target: { id: string; left: boolean } | undefined): string | null {
  if (!target) return 'Personne inconnue.';
  if (target.id === fromId) return 'Choisissez une autre personne que la personne sortie.';
  return target.left ? "Personne sortie de l'effectif : choisissez une personne présente." : null;
}
