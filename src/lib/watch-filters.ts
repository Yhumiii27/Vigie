// Filtres, recherche et tri des listes de la veille (VEI-13) — règles pures, portées par l'URL (convention UX-12 :
// un paramètre par critère, `?q=` pour la recherche, valeur par défaut omise, valeur inconnue ignorée).
//
// - Exigences : `?evaluation=` (clé de REQUIREMENT_EVAL), `?domaine=`, `?pilote=` (identifiant d'une personne pilote d'une
//   exigence de la liste), `?q=` (texte, domaine, résumé), `?tri=echeance` (échéance la plus proche d'abord, sans échéance
//   en dernier ; par défaut : ordre de la veille).
// - Contrôles périodiques : `?responsable=` (responsable d'un contrôle de la liste), `?q=` (équipement, nature, organisme,
//   code d'équipement), `?tri=echeance` (prochain contrôle le plus proche d'abord).
// Les choix proposés sont tirés de la liste déjà chargée pour la personne (site sélectionné, périmètre) : un filtre ne révèle
// aucune personne ni aucun élément hors de ce qu'elle voit.

import { firstParam, type SearchParams } from './url-state';

export const WATCH_QUERY_MAX = 100;
export const SORT_DUE = 'echeance';

type Option = readonly [string, string];
type Req = { evaluation: string; domain: string; pilotId: string | null; pilot: string; text: string; summary: string | null; dueSort: string | null };
type Ctrl = { responsibleId: string | null; responsible: string; equipment: string; controlType: string; organization: string; equipmentCode: string | null; nextOn: string };

export type RequirementFilters = { evaluation?: string; domaine?: string; pilote?: string; q?: string; tri?: typeof SORT_DUE };
export type ControlListFilters = { responsable?: string; q?: string; tri?: typeof SORT_DUE };

const clean = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const text = (sp: SearchParams, k: string) => firstParam(sp[k])?.trim().slice(0, WATCH_QUERY_MAX) || undefined;
const among = (sp: SearchParams, k: string, options: readonly Option[]) => {
  const v = firstParam(sp[k])?.trim();
  return v && options.some(([o]) => o === v) ? v : undefined;
};
const byLabel = (a: Option, b: Option) => a[1].localeCompare(b[1], 'fr');
const sortParam = (sp: SearchParams) => (firstParam(sp.tri) === SORT_DUE ? SORT_DUE : undefined);

/** Choix des filtres des exigences, tirés des exigences affichées (hors archivées selon la portée). */
export function requirementChoices(rows: readonly Req[], evaluations: Record<string, { label: string }>) {
  const domains = [...new Set(rows.map((r) => r.domain).filter(Boolean))].map((d) => [d, d] as const).sort(byLabel);
  const pilots = [...new Map(rows.filter((r) => r.pilotId).map((r) => [r.pilotId!, r.pilot || r.pilotId!])).entries()].sort(byLabel);
  const evals = Object.entries(evaluations).map(([k, v]) => [k, v.label] as const);
  return { domains, pilots, evaluations: evals };
}

export function parseRequirementFilters(sp: SearchParams, choices: ReturnType<typeof requirementChoices>): RequirementFilters {
  return {
    evaluation: among(sp, 'evaluation', choices.evaluations), domaine: among(sp, 'domaine', choices.domains),
    pilote: among(sp, 'pilote', choices.pilots), q: text(sp, 'q'), tri: sortParam(sp),
  };
}

/** Exigences retenues par les filtres, triées si demandé (copie : la liste d'origine n'est pas modifiée). */
export function filterRequirements<T extends Req>(rows: readonly T[], f: RequirementFilters): T[] {
  const q = f.q ? clean(f.q) : '';
  const out = rows.filter((r) => (!f.evaluation || r.evaluation === f.evaluation) && (!f.domaine || r.domain === f.domaine)
    && (!f.pilote || r.pilotId === f.pilote) && (!q || clean(`${r.text} ${r.domain} ${r.summary ?? ''}`).includes(q)));
  return f.tri === SORT_DUE ? out.sort((a, b) => (a.dueSort ?? '9999').localeCompare(b.dueSort ?? '9999')) : out;
}

/** Choix du filtre « responsable » des contrôles, tirés des contrôles affichés. */
export function controlChoices(rows: readonly Ctrl[]) {
  return { responsibles: [...new Map(rows.filter((r) => r.responsibleId).map((r) => [r.responsibleId!, r.responsible || r.responsibleId!])).entries()].sort(byLabel) };
}

export function parseControlFilters(sp: SearchParams, choices: ReturnType<typeof controlChoices>): ControlListFilters {
  return { responsable: among(sp, 'responsable', choices.responsibles), q: text(sp, 'q'), tri: sortParam(sp) };
}

export function filterControls<T extends Ctrl>(rows: readonly T[], f: ControlListFilters): T[] {
  const q = f.q ? clean(f.q) : '';
  const out = rows.filter((r) => (!f.responsable || r.responsibleId === f.responsable)
    && (!q || clean(`${r.equipment} ${r.controlType} ${r.organization} ${r.equipmentCode ?? ''}`).includes(q)));
  return f.tri === SORT_DUE ? out.sort((a, b) => a.nextOn.localeCompare(b.nextOn)) : out;
}

/** Filtres actifs (hors tri). */
export const hasListFilters = (f: Record<string, string | undefined>) => Object.entries(f).some(([k, v]) => k !== 'tri' && !!v);
