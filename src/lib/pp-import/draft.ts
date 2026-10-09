// Préremplissage du plan de prévention (étape « Vérification ») à partir des valeurs lues et de la correspondance.
// Module pur : dates et heures interprétées, entreprise et projet Keystone rapprochés des référentiels.

import type { PpTarget } from '../pp-form';
import { checkedSummary, type AppliedMapping } from './mapping';
import { cleanValue, isYes, matchByName, matchProject, parseDates, parseHours, squash } from './text';

/** Valeur spéciale du choix d'entreprise : créer l'entreprise lue dans le formulaire. */
export const NEW_CONTRACTOR = '__new__';

export type PlanDraft = {
  contractorId: string; // entreprise existante, NEW_CONTRACTOR ou ''
  contractorName: string;
  contractorTrade: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  title: string;
  location: string;
  startOn: string;
  endOn: string;
  estimatedHours: string;
  dangerousWork: boolean;
  keystoneProject: string;
  inspectionOn: string;
  interferenceRisks: string;
  measures: string;
  signedEuOn: string;
  signedEeOn: string;
  /** Valeurs lues mais non reconnues (date illisible, projet inconnu…), affichées sous le champ. */
  hints: Partial<Record<keyof PlanDraft, string>>;
};

export const EMPTY_DRAFT: PlanDraft = {
  contractorId: '', contractorName: '', contractorTrade: '', contactName: '', contactPhone: '', contactEmail: '',
  title: '', location: '', startOn: '', endOn: '', estimatedHours: '', dangerousWork: false, keystoneProject: '',
  inspectionOn: '', interferenceRisks: '', measures: '', signedEuOn: '', signedEeOn: '', hints: {},
};

type Ctx = {
  contractors: { id: string; name: string }[];
  projects: readonly (readonly [string, string])[];
  /** Date du jour « AAAA-MM-JJ » (année des dates écrites sans année). */
  today: string;
};

/** Sections dont les cases cochées décrivent les risques, puis les mesures. */
const RISK_SECTIONS = /\b(risques?|interferences?|dangers?|coactivite)\b/;
const MEASURE_SECTIONS = /\b(mesures?|prevention|protections?|epi|consignes?|secours|moyens)\b/;

const quote = (s: string) => `« ${s.length > 60 ? `${s.slice(0, 59)}…` : s} »`;

export function buildDraft(applied: AppliedMapping, ctx: Ctx): PlanDraft {
  const draft: PlanDraft = { ...EMPTY_DRAFT, hints: {} };
  const year = Number(ctx.today.slice(0, 4));
  const list = (t: PpTarget) => (applied.values[t] ?? []).map((v) => cleanValue(v)).filter(Boolean);
  const first = (t: PpTarget) => list(t)[0] ?? '';
  const joined = (t: PpTarget, sep: string) => [...new Set(list(t))].join(sep);

  // Entreprise extérieure : rapprochée des entreprises connues, sinon proposée à la création.
  draft.contractorName = first('contractorName');
  draft.contractorTrade = first('contractorTrade');
  draft.contactName = first('contactName');
  draft.contactPhone = first('contactPhone');
  draft.contactEmail = first('contactEmail');
  if (draft.contractorName) {
    const hit = matchByName(draft.contractorName, ctx.contractors);
    draft.contractorId = hit ? hit.id : NEW_CONTRACTOR;
  }

  draft.title = joined('title', ' — ');
  draft.location = joined('location', ' · ');

  // Dates : « du 12/10 au 16/10/2026 » dans un seul champ alimente le début et la fin.
  const date = (t: PpTarget, pick: 'first' | 'last' = 'first') => {
    const raw = list(t);
    const all = raw.flatMap((v) => parseDates(v, year));
    if (!all.length && raw.length) draft.hints[t as keyof PlanDraft] = `Valeur lue ${quote(raw.join(' ; '))} non reconnue comme une date.`;
    return (pick === 'first' ? all[0] : all[all.length - 1]) ?? '';
  };
  draft.startOn = date('startOn');
  draft.endOn = date('endOn', 'last');
  const startDates = list('startOn').flatMap((v) => parseDates(v, year));
  if (!draft.endOn && startDates.length > 1) draft.endOn = startDates[startDates.length - 1];
  draft.inspectionOn = date('inspectionOn');
  draft.signedEuOn = date('signedEuOn');
  draft.signedEeOn = date('signedEeOn');

  const hoursRaw = first('estimatedHours');
  const hours = parseHours(hoursRaw);
  if (hours != null) draft.estimatedHours = String(hours);
  else if (hoursRaw) draft.hints.estimatedHours = `Valeur lue ${quote(hoursRaw)} non reconnue comme un nombre d'heures.`;

  draft.dangerousWork = applied.dangerousWork ?? isYes(first('dangerousWork'));

  const projectRaw = first('keystoneProject');
  if (projectRaw) {
    const hit = matchProject(projectRaw, ctx.projects);
    if (hit) draft.keystoneProject = hit;
    else draft.hints.keystoneProject = `Valeur lue ${quote(projectRaw)} : aucun projet Keystone correspondant.`;
  }

  // Risques et mesures : cases cochées de la grille, complétées par les textes associés.
  const compose = (summary: string, texts: string[]) => [summary, ...texts.filter((t) => !summary.includes(t))].filter(Boolean).join('\n');
  draft.interferenceRisks = compose(checkedSummary(applied.sections, RISK_SECTIONS), list('interferenceRisks')).slice(0, 4000);
  draft.measures = compose(checkedSummary(applied.sections, MEASURE_SECTIONS), list('measures')).slice(0, 4000);
  draft.title = squash(draft.title).slice(0, 200);
  draft.location = squash(draft.location).slice(0, 160);
  return draft;
}
