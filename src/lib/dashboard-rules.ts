// Règles pures des indicateurs du tableau de bord (TDB-13, TDB-14) : calculées à l'affichage, jamais stockées.
// Sans dépendance serveur : partagées par src/lib/data/dashboard.ts et ses tests.

import { daysBetween, parisDay } from './dates';
import { NC_ORIGINS, REQUIREMENT_EVAL, type Tone } from './domain';

/** Fenêtre de la note « n déclarés sur les 7 derniers jours » : aujourd'hui et les 6 jours précédents. */
export const RECENT_DAYS = 7;

/**
 * Événements déclarés sur les 7 derniers jours (TDB-13) : jour de Paris de la déclaration (events.created_at), et non la
 * date des faits — un événement ancien déclaré aujourd'hui compte, un événement d'hier saisi il y a un mois non.
 */
export const declaredRecently = (events: { createdAt: Date }[], today: string) =>
  events.filter((e) => {
    const d = daysBetween(parisDay(e.createdAt), today);
    return d >= 0 && d < RECENT_DAYS;
  }).length;

/**
 * Contrôle cité par la note du KPI « Contrôles réglementaires » (TDB-13) : le plus en retard (plus petit nombre de jours
 * restants), à égalité le premier de la liste ; null sans contrôle dépassé.
 */
export function mostOverdue<T extends { s: { days: number } }>(list: T[]): T | null {
  return list.filter((x) => x.s.days < 0).reduce<T | null>((worst, x) => (!worst || x.s.days < worst.s.days ? x : worst), null);
}

/** Paramètre ?origine= des non-conformités sans origine renseignée (ou d'une origine hors liste). */
export const NC_ORIGIN_NONE = 'aucune';

/** Origine d'une NC dans la liste NC_ORIGINS, sinon null (origine non renseignée ou ancienne valeur hors liste). */
export const ncOriginOf = (e: { ncOrigin: string | null }) => (e.ncOrigin && NC_ORIGINS.includes(e.ncOrigin) ? e.ncOrigin : null);

/** Barre du graphique « Non-conformités par origine ». */
export type NcBar = { key: string; label: string; n: number; href: string };

const CUSTOMER_ORIGIN = 'Réclamation client';

/**
 * Barres « Non-conformités par origine » (TDB-13) sur les NC et réclamations ouvertes :
 * - une barre par origine des NC (NC_ORIGINS), l'origine « Réclamation client » d'une NC séparée des réclamations client
 *   (type RC), qu'elle ne rejoint plus ;
 * - réclamations client (type RC), quelle que soit leur origine ;
 * - NC sans origine renseignée : barre ajoutée quand il y en a (?origine=aucune).
 * Les barres « NC · réclamation client » et « Origine non renseignée » n'apparaissent que si elles comptent un élément.
 */
export function ncBars(open: { type: string; ncOrigin: string | null }[]): NcBar[] {
  const nc = open.filter((e) => e.type === 'NC');
  const count = (origin: string | null) => nc.filter((e) => ncOriginOf(e) === origin).length;
  const originHref = (o: string) => `/evenements?type=NC&origine=${encodeURIComponent(o)}`;
  const bars: (NcBar & { always: boolean })[] = [
    ...NC_ORIGINS.filter((o) => o !== CUSTOMER_ORIGIN).map((o) => ({ key: o, label: o, n: count(o), href: originHref(o), always: true })),
    { key: 'nc-client', label: 'NC · origine client', n: count(CUSTOMER_ORIGIN), href: originHref(CUSTOMER_ORIGIN), always: false },
    { key: 'rc', label: 'Réclamations client', n: open.filter((e) => e.type === 'RC').length, href: '/evenements?type=RC', always: true },
    { key: NC_ORIGIN_NONE, label: 'Origine non renseignée', n: count(null), href: originHref(NC_ORIGIN_NONE), always: false },
  ];
  return bars.filter((b) => b.always || b.n > 0).map(({ key, label, n, href }) => ({ key, label, n, href }));
}

/** Note du KPI « Non-conformités » : les deux barres les plus fournies (« Fabrication 3 · Réclamations client 2 »). */
export const ncTopNote = (bars: NcBar[]) =>
  [...bars].filter((b) => b.n > 0).sort((a, b) => b.n - a.n).slice(0, 2).map((b) => `${b.label} ${b.n}`).join(' · ') || '—';

/**
 * Carte « Veille réglementaire » (TDB-14) : avant la date d'application, « Applicable au [date], dans n jours » ; à partir
 * de cette date, « Applicable depuis le [date] » avec l'état de conformité évalué (l'évaluation reste un jugement du pilote,
 * jamais déduite de la date).
 */
export function featuredApplicability(dueOn: string, today: string, evaluation: string): {
  applied: boolean; daysLeft: number; prefix: string; state: { label: string; tone: Tone } | null;
} {
  const daysLeft = daysBetween(today, dueOn);
  const applied = daysLeft <= 0;
  const ev = REQUIREMENT_EVAL[evaluation] ?? { label: evaluation, tone: 'neutral' as Tone };
  return { applied, daysLeft, prefix: applied ? 'Applicable depuis le' : 'Applicable au', state: applied ? ev : null };
}
