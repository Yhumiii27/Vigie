// Auto-évaluation par référentiel (AUD-40, réponses du service QHSE du 09/11/2026) : règles pures, sans dépendance serveur,
// partagées par les server actions (src/server/self-assessment.ts), les chargements (src/lib/data/self-assessment.ts), le
// dossier de la revue de direction et les composants. La synthèse (taux par article et global, écart avec la campagne
// précédente) est calculée à l'affichage, jamais stockée.

import type { Tone } from '../domain';

export type AssessmentStandard = 'iso45001' | 'iso14001' | 'iso9001';
export const ASSESSMENT_STANDARDS: Record<AssessmentStandard, { label: string; short: string; domain: string }> = {
  iso45001: { label: 'ISO 45001 — santé et sécurité au travail', short: 'ISO 45001', domain: 'Santé et sécurité' },
  iso14001: { label: 'ISO 14001 — management environnemental', short: 'ISO 14001', domain: 'Environnement' },
  iso9001: { label: 'ISO 9001 — management de la qualité', short: 'ISO 9001', domain: 'Qualité' },
};
export const ASSESSMENT_STANDARD_KEYS = Object.keys(ASSESSMENT_STANDARDS) as AssessmentStandard[];
export const isAssessmentStandard = (v: unknown): v is AssessmentStandard => typeof v === 'string' && Object.hasOwn(ASSESSMENT_STANDARDS, v);

export type ConformityLevel = 'conforme' | 'partiel' | 'non_conforme' | 'non_applicable';
/** Niveaux de conformité ; `score` : part de l'exigence satisfaite (null : hors calcul, non applicable). */
export const CONFORMITY_LEVELS: Record<ConformityLevel, { label: string; tone: Tone; score: number | null }> = {
  conforme: { label: 'Conforme', tone: 'ok', score: 1 },
  partiel: { label: 'Partiellement conforme', tone: 'warn', score: 0.5 },
  non_conforme: { label: 'Non conforme', tone: 'danger', score: 0 },
  non_applicable: { label: 'Non applicable', tone: 'neutral', score: null },
};
export const CONFORMITY_LEVEL_KEYS = Object.keys(CONFORMITY_LEVELS) as ConformityLevel[];
export const isConformityLevel = (v: unknown): v is ConformityLevel => typeof v === 'string' && Object.hasOwn(CONFORMITY_LEVELS, v);

export type AssessmentStatusKey = 'brouillon' | 'cloturee' | 'annulee';
/** États d'une campagne (« annulée » : calculé d'après le triplet d'annulation). */
export const ASSESSMENT_STATUSES: Record<AssessmentStatusKey, { label: string; tone: Tone }> = {
  brouillon: { label: 'En cours', tone: 'warn' },
  cloturee: { label: 'Clôturée', tone: 'ok' },
  annulee: { label: 'Annulée', tone: 'neutral' },
};
/** États stockés (self_assessments.status). */
export const STORED_ASSESSMENT_STATUS_KEYS = ['brouillon', 'cloturee'] as const;
export const assessmentStatus = (a: { status: string; cancelledAt: unknown }): AssessmentStatusKey =>
  a.cancelledAt ? 'annulee' : a.status === 'cloturee' ? 'cloturee' : 'brouillon';

/** Vue de l'écran Audits et lien profond d'une campagne. */
export const SELF_ASSESSMENT_VIEW = 'auto-evaluation';
export const selfAssessmentHref = (id?: string) => `/audits?vue=${SELF_ASSESSMENT_VIEW}${id ? `&campagne=${encodeURIComponent(id)}` : ''}`;
export const selfAssessmentPrintHref = (id: string) => `/audits/auto-evaluation/imprimer/${encodeURIComponent(id)}`;

export const HEADING_MAX = 160;
export const FINDING_MAX = 4000;
export const JUSTIFICATION_MAX = 2000;

/** Numéro d'article : « 4 », « 6.1 », « 6.1.2 » (chiffres séparés par des points). */
export const CLAUSE_PATTERN = /^\d{1,2}(\.\d{1,2}){0,3}$/;
export function clauseError(clause: string): string | null {
  return CLAUSE_PATTERN.test(clause) ? null : 'Numéro d’article attendu, ex. 6.1.2.';
}

/** Article principal d'une exigence (« 6 » pour « 6.1.2 »). */
export const mainClause = (clause: string) => clause.split('.')[0];

/** Ordre naturel des numéros d'articles (« 4.10 » après « 4.9 »). */
export function compareClauses(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/** Justification exigée pour « non applicable » et « non conforme » (contrainte de la base aussi). */
export function lineError(level: ConformityLevel | null, justification: string): string | null {
  if ((level === 'non_applicable' || level === 'non_conforme') && !justification.trim()) {
    return level === 'non_applicable' ? 'Justifiez la non-applicabilité de l’exigence.' : 'Justifiez la non-conformité (écart constaté).';
  }
  return null;
}

/** Campagne qui ne se modifie plus (lignes, en-tête, preuves) : message, ou null si elle est un brouillon. */
export function frozenAssessmentError(a: { status: string; cancelledAt: unknown }): string | null {
  const s = assessmentStatus(a);
  if (s === 'cloturee') return 'Campagne clôturée : elle est figée (seuls des actions et des commentaires s’y ajoutent).';
  if (s === 'annulee') return 'Campagne annulée : consultation seule.';
  return null;
}

/** Clôture refusée tant qu'une exigence n'est pas évaluée : message, ou null. */
export function closeAssessmentError(lines: readonly { level: string | null }[]): string | null {
  const missing = lines.filter((l) => !l.level).length;
  if (!lines.length) return 'Aucune exigence à évaluer.';
  return missing ? `${missing} exigence${missing > 1 ? 's' : ''} encore à évaluer avant la clôture.` : null;
}

export type LevelCounts = Record<ConformityLevel, number> & { pending: number };
export type ClauseSynthesis = {
  clause: string;
  heading: string;
  counts: LevelCounts;
  /** Taux de conformité en % (conforme = 1, partiel = ½, non conforme = 0 ; non applicable exclu), null sans exigence évaluée. */
  rate: number | null;
};
export type Synthesis = { overall: ClauseSynthesis; clauses: ClauseSynthesis[] };

const emptyCounts = (): LevelCounts => ({ conforme: 0, partiel: 0, non_conforme: 0, non_applicable: 0, pending: 0 });

function rateOf(counts: LevelCounts): number | null {
  const applicable = counts.conforme + counts.partiel + counts.non_conforme;
  return applicable ? Math.round(((counts.conforme + counts.partiel * 0.5) / applicable) * 100) : null;
}

/**
 * Synthèse d'une campagne : par article principal (4 à 10, dans l'ordre) et globale ; intitulé d'un article principal pris
 * de sa ligne (« 6 »), à défaut « Article 6 ».
 */
export function synthesize(lines: readonly { clause: string; heading: string; level: string | null }[]): Synthesis {
  const byMain = new Map<string, { heading: string; counts: LevelCounts }>();
  const overall = emptyCounts();
  for (const l of [...lines].sort((a, b) => compareClauses(a.clause, b.clause))) {
    const main = mainClause(l.clause);
    const entry = byMain.get(main) ?? { heading: '', counts: emptyCounts() };
    if (l.clause === main) entry.heading = l.heading;
    const key = isConformityLevel(l.level) ? l.level : 'pending';
    entry.counts[key] += 1;
    overall[key] += 1;
    byMain.set(main, entry);
  }
  const clauses = [...byMain.entries()].sort(([a], [b]) => compareClauses(a, b))
    .map(([clause, e]) => ({ clause, heading: e.heading || `Article ${clause}`, counts: e.counts, rate: rateOf(e.counts) }));
  return { overall: { clause: '', heading: 'Ensemble du référentiel', counts: overall, rate: rateOf(overall) }, clauses };
}

/** Écart de taux (points) avec la campagne précédente, null si l'un des deux taux manque. */
export const rateDelta = (current: number | null, previous: number | null | undefined) =>
  current == null || previous == null ? null : current - previous;

/** « +8 pts », « −3 pts », « = » ; « — » sans comparaison. */
export function fmtDelta(delta: number | null): string {
  if (delta == null) return '—';
  if (delta === 0) return '=';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} pt${Math.abs(delta) > 1 ? 's' : ''}`;
}

/** Ton d'un taux de conformité (≥ 80 % : maîtrisé, ≥ 50 % : à renforcer, sinon : insuffisant). */
export const rateTone = (rate: number | null): Tone => (rate == null ? 'neutral' : rate >= 80 ? 'ok' : rate >= 50 ? 'warn' : 'danger');

/**
 * Campagne précédente à comparer : même référentiel et même site (ou toutes deux d'entreprise), clôturée, non annulée,
 * évaluée avant la campagne (à date égale, celle créée avant). Null s'il n'y en a pas.
 */
export function previousAssessment<T extends { id: string; standard: string; siteId: string | null; assessedOn: string; status: string; cancelledAt: unknown; createdAt: Date }>(
  all: readonly T[], current: Pick<T, 'id' | 'standard' | 'siteId' | 'assessedOn' | 'createdAt'>,
): T | null {
  const before = all.filter((a) => a.id !== current.id && a.standard === current.standard && a.siteId === current.siteId
    && assessmentStatus(a) === 'cloturee'
    && (a.assessedOn < current.assessedOn || (a.assessedOn === current.assessedOn && a.createdAt < current.createdAt)));
  return before.sort((a, b) => b.assessedOn.localeCompare(a.assessedOn) || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}
