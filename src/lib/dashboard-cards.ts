// Tableaux de bord configurables (TDB-19, réponses du service QHSE du 09/11/2026 : « des tableaux de bord configurables,
// accessibles à la Direction ») : catalogue fermé des cartes (indicateurs déjà calculés de Vigie), options de période et de
// périmètre, lecture et contrôle d'une disposition. Module pur, sans dépendance serveur : partagé par le chargement
// (src/lib/data/dashboard-cards.ts), la server action (src/server/dashboard-layouts.ts) et l'éditeur. Les indicateurs restent
// calculés à l'affichage ; seule la disposition (cartes, ordre, options) est enregistrée.

import type { Role } from './domain';

/** Rôles dont le tableau de bord est configurable ; les autres gardent le tableau de bord fixe. */
export const DASHBOARD_ROLES = ['Animateur QHSE', 'Direction'] as const satisfies readonly Role[];
export type DashboardRole = (typeof DASHBOARD_ROLES)[number];
export const isDashboardRole = (role: Role): role is DashboardRole => (DASHBOARD_ROLES as readonly string[]).includes(role);
/** Disposition par défaut d'un rôle : tenue par l'animateur QHSE (pour lui-même et pour la direction). */
export const canEditRoleLayout = (role: Role) => role === 'Animateur QHSE';

export type CardPeriod = 'mois' | 'trimestre' | 'annee';
/** Périodes : derniers mois complets (1, 3 ou 12), comme le TF1 du tableau de bord. */
export const CARD_PERIODS: Record<CardPeriod, { label: string; months: number }> = {
  mois: { label: 'Dernier mois complet', months: 1 },
  trimestre: { label: '3 derniers mois complets', months: 3 },
  annee: { label: '12 derniers mois complets', months: 12 },
};
export const CARD_PERIOD_KEYS = Object.keys(CARD_PERIODS) as CardPeriod[];

export type CardScope = 'site' | 'perimetre';
export const CARD_SCOPES: Record<CardScope, string> = {
  site: 'Site sélectionné',
  perimetre: 'Tous les sites de mon périmètre',
};
export const CARD_SCOPE_KEYS = Object.keys(CARD_SCOPES) as CardScope[];

export type CardId =
  | 'jours_sans_at' | 'tf1' | 'evenements_ouverts' | 'evenements_declares' | 'actions_retard' | 'actions_soldees'
  | 'controles' | 'controles_a_jour' | 'habilitations' | 'veille' | 'nc_ouvertes' | 'dgi_ouverts' | 'causeries'
  | 'auto_evaluation' | 'carte_sites';

type CardDef = {
  label: string;
  hint: string;
  /** Période proposée (null : indicateur à la date du jour). */
  periods: readonly CardPeriod[] | null;
  /** Périmètre proposé (false : carte sans périmètre, ex. carte des sites). */
  scoped: boolean;
  /** Carte qui révèle une donnée de santé : rôles canSeeHealth seulement (aucune à ce jour : agrégats seulement). */
  health?: boolean;
  /** Carte réservée aux lecteurs du registre des dangers graves et imminents (canReadDgi). */
  dgi?: boolean;
};

/** Catalogue fermé, dans l'ordre de la liste « Ajouter une carte ». */
export const DASHBOARD_CARDS: Record<CardId, CardDef> = {
  jours_sans_at: { label: 'Jours sans accident avec arrêt', hint: 'Accidents de l’effectif, hors trajet.', periods: null, scoped: true },
  tf1: { label: 'TF1 et TG', hint: 'Taux de fréquence et de gravité sur les mois complets de la période.', periods: CARD_PERIOD_KEYS, scoped: true },
  evenements_ouverts: { label: 'Événements ouverts', hint: 'Événements non clos, dont ceux de plus de 30 jours.', periods: null, scoped: true },
  evenements_declares: { label: 'Événements déclarés', hint: 'Événements déclarés sur la période, par date de déclaration.', periods: CARD_PERIOD_KEYS, scoped: true },
  actions_retard: { label: 'Actions en retard', hint: 'Actions ouvertes dont la date cible est passée.', periods: null, scoped: true },
  actions_soldees: { label: 'Actions vérifiées', hint: 'Actions vérifiées sur la période et part jugée efficace.', periods: CARD_PERIOD_KEYS, scoped: true },
  controles: { label: 'Contrôles réglementaires à 30 jours', hint: 'Contrôles à réaliser sous 30 jours, dont dépassés.', periods: null, scoped: true },
  controles_a_jour: { label: 'Contrôles à jour', hint: 'Part des contrôles périodiques non dépassés.', periods: null, scoped: true },
  habilitations: { label: 'Titres requis valides', hint: 'Part des titres requis valides dans la matrice des habilitations (Cursus).', periods: null, scoped: true },
  veille: { label: 'Conformité de la veille', hint: 'Part des exigences en vigueur évaluées conformes.', periods: null, scoped: true },
  nc_ouvertes: { label: 'Non-conformités ouvertes', hint: 'Non-conformités et réclamations client ouvertes.', periods: null, scoped: true },
  dgi_ouverts: { label: 'Dangers graves et imminents', hint: 'Avis du registre sans mesures ou non clos.', periods: null, scoped: true, dgi: true },
  causeries: { label: 'Causeries sécurité', hint: 'Causeries tenues sur la période et taux d’émargement.', periods: CARD_PERIOD_KEYS, scoped: true },
  auto_evaluation: { label: 'Auto-évaluation ISO', hint: 'Taux de conformité de la dernière campagne clôturée de chaque référentiel.', periods: null, scoped: true },
  carte_sites: { label: 'Carte des sites', hint: 'Sites et leurs indicateurs, sous « Tous les sites ».', periods: null, scoped: false },
};
export const CARD_IDS = Object.keys(DASHBOARD_CARDS) as CardId[];
export const isCardId = (v: unknown): v is CardId => typeof v === 'string' && Object.hasOwn(DASHBOARD_CARDS, v);

export type CardConfig = { id: CardId; period: CardPeriod | null; scope: CardScope | null };
export const MAX_CARDS = 16;

/** Options par défaut d'une carte du catalogue (12 mois, site sélectionné). */
export const cardDefaults = (id: CardId): CardConfig => ({
  id,
  period: DASHBOARD_CARDS[id].periods ? 'annee' : null,
  scope: DASHBOARD_CARDS[id].scoped ? 'site' : null,
});

/** Disposition de Vigie quand ni la personne ni son rôle n'en ont : les indicateurs du tableau de bord fixe. */
export const BUILT_IN_LAYOUT: readonly CardConfig[] = (['jours_sans_at', 'tf1', 'evenements_ouverts', 'actions_retard', 'controles', 'nc_ouvertes', 'carte_sites'] as CardId[]).map(cardDefaults);

/** Carte visible pour la personne (santé, registre des DGI). */
export const cardAllowed = (id: CardId, viewer: { health: boolean; dgi: boolean }) =>
  (!DASHBOARD_CARDS[id].health || viewer.health) && (!DASHBOARD_CARDS[id].dgi || viewer.dgi);

/**
 * Lecture d'une disposition reçue (formulaire) ou stockée (jsonb) : cartes connues, sans doublon, options admises pour la
 * carte (sinon celles par défaut), MAX_CARDS au plus. `error` : disposition refusée (format, carte inconnue ou en double).
 */
export function parseLayout(raw: unknown): { cards: CardConfig[]; error: string | null } {
  if (!Array.isArray(raw)) return { cards: [], error: 'Disposition illisible.' };
  if (raw.length > MAX_CARDS) return { cards: [], error: `${MAX_CARDS} cartes au plus.` };
  const cards: CardConfig[] = [];
  for (const item of raw) {
    const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined;
    if (!isCardId(id)) return { cards: [], error: 'Carte inconnue : choisissez dans le catalogue.' };
    if (cards.some((c) => c.id === id)) return { cards: [], error: `Carte « ${DASHBOARD_CARDS[id].label} » en double.` };
    const def = DASHBOARD_CARDS[id];
    const p = (item as { period?: unknown }).period;
    const s = (item as { scope?: unknown }).scope;
    cards.push({
      id,
      period: def.periods ? (def.periods.includes(p as CardPeriod) ? (p as CardPeriod) : 'annee') : null,
      scope: def.scoped ? (CARD_SCOPE_KEYS.includes(s as CardScope) ? (s as CardScope) : 'site') : null,
    });
  }
  return { cards, error: null };
}

/** Disposition appliquée : celle de la personne, sinon celle de son rôle, sinon celle de Vigie ; cartes non permises retirées. */
export function effectiveLayout(own: unknown, roleDefault: unknown, viewer: { health: boolean; dgi: boolean }): { cards: CardConfig[]; origin: 'personne' | 'role' | 'vigie' } {
  const pick = own != null ? { raw: own, origin: 'personne' as const } : roleDefault != null ? { raw: roleDefault, origin: 'role' as const } : null;
  const cards = pick ? parseLayout(pick.raw).cards : [...BUILT_IN_LAYOUT];
  return { cards: cards.filter((c) => cardAllowed(c.id, viewer)), origin: pick?.origin ?? 'vigie' };
}

/** Libellé d'une disposition au journal : « TF1 et TG (12 derniers mois complets, site sélectionné) · … ». */
export const layoutSummary = (cards: readonly CardConfig[]) => cards.map((c) => {
  const opts = [c.period ? CARD_PERIODS[c.period].label.toLowerCase() : null, c.scope ? CARD_SCOPES[c.scope].toLowerCase() : null].filter(Boolean);
  return `${DASHBOARD_CARDS[c.id].label}${opts.length ? ` (${opts.join(', ')})` : ''}`;
}).join(' · ') || 'aucune carte';

/** Mois complets de la période (« AAAA-MM »), du plus ancien au plus récent, se terminant le mois précédant `today`. */
export function periodMonths(today: string, period: CardPeriod): string[] {
  const n = CARD_PERIODS[period].months;
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - n + i, 1)).toISOString().slice(0, 7));
}

/** Premier et dernier jours de la période (« AAAA-MM-JJ »). */
export function periodRange(today: string, period: CardPeriod): { from: string; to: string } {
  const months = periodMonths(today, period);
  const last = months[months.length - 1];
  const end = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return { from: `${months[0]}-01`, to: end };
}
