// Statistiques mensuelles du plan d'actions (ACT-29, docs/specs/actions-qse.md § 17) : règles pures, sans base ni React,
// calculées à la demande et jamais stockées. Définitions tranchées par le service QHSE le 15/10/2026 :
//   - répartitions (avancement, source, domaine, responsable, niveau de risque) : état de TOUT le plan à la fin du mois
//     (mois en cours : à la date du jour), reconstitué par le journal structuré des avancements (entrées « status » et
//     « reprise », détail « Avancement » avec fromKey / toKey) ; une action reprise sans historique est réputée avoir atteint
//     son avancement repris à la date de reprise (avant : « À faire », avancement de toute action à son ouverture) ;
//   - taux de retard : actions en retard / actions ouvertes (À faire → 80 %) à la fin du mois, date cible ACTUELLE ;
//   - délai moyen de clôture : moyenne (date de vérification − date d'ouverture) des actions Vérifiées dans le mois ;
//   - taux d'efficacité : Vérifiées « Efficace » / Vérifiées dans le mois ;
//   - respect des dates cibles : Terminées dans le mois (date effective) dont la date effective ≤ dernière date cible ;
//   - évolution sur 12 mois : ouvertes (date d'ouverture), clôturées (date de vérification), abandonnées, ouvertes et en
//     retard à la fin de chaque mois ;
//   - Abandonnées exclues des taux et des répartitions autres que l'avancement, comptées dans la répartition par avancement.
// Le responsable, la source, le domaine, le niveau de risque et la date cible sont les valeurs actuelles (non journalisées
// sous forme structurée).

import { isLate } from './action-rules';
import { addDays, daysBetween, MONTHS_SHORT } from './dates';
import {
  ACTION_AVANCEMENTS, ACTION_DOMAINS, ACTION_RISK_LEVELS, ACTION_SOURCES, AVANCEMENT, isAvancement, isOpenAvancement,
  type Avancement,
} from './domain';

/** Champs d'une action lus par les statistiques. */
export type StatsAction = {
  id: string; openedOn: string; status: Avancement; dueOn: string; doneOn: string | null; closedOn: string | null;
  effective: boolean | null; source: string | null; domain: string | null; pilotId: string; riskLevel: number | null;
  cancelledOn: string | null; // jour de Paris de l'abandon
};

/** Changement d'avancement lu dans le journal : jour de Paris, ordre d'écriture, clés ; reprise : avancement repris. */
export type StatusTransition = { actionId: string; day: string; seq: number; from: Avancement | null; to: Avancement; reprise: boolean };

/** Entrée du journal telle que lue en base (src/lib/data/action-stats.ts) : type d'entrée et détail JSON. */
export type StatusLogRow = { actionId: string; action: string; day: string; seq: number; details: unknown };

/**
 * Changement d'avancement d'une entrée du journal : entrées « status » (transitions, D11) et « reprise » (migration 0005,
 * avancement repris), détail « Avancement » portant `toKey` (clé d'avancement valide) ; null pour toute autre entrée
 * (journal de l'ancien modèle sans clés, clé inconnue).
 */
export function statusTransition(r: StatusLogRow): StatusTransition | null {
  if ((r.action !== 'status' && r.action !== 'reprise') || !Array.isArray(r.details)) return null;
  const d = (r.details as { field?: unknown; fromKey?: unknown; toKey?: unknown }[]).find((x) => x && x.field === 'Avancement');
  if (!d || typeof d.toKey !== 'string' || !isAvancement(d.toKey)) return null;
  const reprise = r.action === 'reprise';
  const from = !reprise && typeof d.fromKey === 'string' && isAvancement(d.fromKey) ? d.fromKey : null;
  return { actionId: r.actionId, day: r.day, seq: r.seq, from, to: d.toKey, reprise };
}

/** Avancement initial présumé d'une action avant sa première entrée de journal (reprise, ou entrée sans clé de départ). */
const INITIAL: Avancement = 'a_faire';

/**
 * Avancement de l'action à la fin du jour `day` : null si elle n'est pas encore ouverte ; sinon l'arrivée du dernier
 * changement du journal daté au plus tard ce jour-là ; avant le premier changement, son départ (« À faire » avant une
 * reprise) ; sans aucun changement journalisé, l'avancement actuel. `transitions` : ceux de l'action, dans l'ordre.
 */
export function statusAt(a: Pick<StatsAction, 'openedOn' | 'status'>, transitions: readonly StatusTransition[], day: string): Avancement | null {
  if (a.openedOn > day) return null;
  if (!transitions.length) return a.status;
  let current: Avancement | null = null;
  for (const t of transitions) {
    if (t.day > day) break;
    current = t.to;
  }
  return current ?? (transitions[0].reprise ? INITIAL : transitions[0].from ?? INITIAL);
}

/** Dernier jour du mois « AAAA-MM ». */
export const monthEnd = (ym: string) => addDays(`${monthShift(ym, 1)}-01`, -1);
/** Mois « AAAA-MM » décalé de `n` mois. */
export function monthShift(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}
/** Les `n` mois se terminant par `ym` (le plus ancien d'abord). */
export const monthsEnding = (ym: string, n: number) => Array.from({ length: n }, (_, i) => monthShift(ym, i - n + 1));
/** « Oct. 2026 » → libellé court « Oct 2026 ». */
export const monthLabel = (ym: string) => `${MONTHS_SHORT[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** Mois de la vue (?mois=AAAA-MM) : valeur valide ≤ mois en cours, sinon le mois en cours. */
export function parseStatsMonth(raw: string | null | undefined, today: string): string {
  const current = today.slice(0, 7);
  return raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) && raw <= current && raw >= '2000-01' ? raw : current;
}

const rate = (n: number, d: number) => (d ? n / d : null);
const inMonth = (day: string | null | undefined, ym: string) => !!day && day.slice(0, 7) === ym;

export type StatsRow = { key: string; label: string; total: number; open: number };
export type MonthEvolution = { month: string; label: string; opened: number; closed: number; abandoned: number; open: number; late: number; lateRate: number | null };
export type ActionStats = {
  month: string; label: string; asOf: string; current: boolean;
  total: number; // actions du plan à la date d'état (Abandonnées comprises)
  byAvancement: { key: Avancement; label: string; count: number }[];
  bySource: StatsRow[]; byDomain: StatsRow[]; byPilot: StatsRow[]; byRiskLevel: StatsRow[];
  open: number; late: number; lateRate: number | null;
  verified: number; meanCloseDays: number | null; effective: number; efficacyRate: number | null;
  finished: number; onTime: number; onTimeRate: number | null;
  evolution: MonthEvolution[];
};

/** État de chaque action à la date `day` (null : pas encore ouverte). */
function statesAt(actions: readonly StatsAction[], byAction: Map<string, StatusTransition[]>, day: string) {
  return actions.map((a) => ({ a, status: statusAt(a, byAction.get(a.id) ?? [], day) }));
}

/**
 * Statistiques du mois `month` (« AAAA-MM ») à la date du jour `today` (mois en cours : état au jour même), avec
 * l'évolution des 12 mois se terminant par `month`. `pilotNames` : libellés des responsables.
 */
export function computeActionStats(input: {
  actions: readonly StatsAction[]; transitions: readonly StatusTransition[]; month: string; today: string; pilotNames: Map<string, string>;
}): ActionStats {
  const { actions, month, today } = input;
  const byAction = new Map<string, StatusTransition[]>();
  [...input.transitions].sort((x, y) => x.day.localeCompare(y.day) || x.seq - y.seq)
    .forEach((t) => byAction.set(t.actionId, [...(byAction.get(t.actionId) ?? []), t]));
  const asOfFor = (ym: string) => (monthEnd(ym) < today ? monthEnd(ym) : today);
  const asOf = asOfFor(month);
  const states = statesAt(actions, byAction, asOf).filter((s): s is { a: StatsAction; status: Avancement } => s.status !== null);
  const kept = states.filter((s) => s.status !== 'abandonnee');
  const openStates = kept.filter((s) => isOpenAvancement(s.status));
  const lateCount = openStates.filter((s) => isLate({ status: s.status, dueOn: s.a.dueOn }, asOf)).length;

  const group = (keyOf: (a: StatsAction) => string | null, labelOf: (k: string) => string, order?: readonly string[]): StatsRow[] => {
    const rows = new Map<string, StatsRow>();
    for (const s of kept) {
      const key = keyOf(s.a) ?? '';
      const row = rows.get(key) ?? { key, label: key ? labelOf(key) : 'À compléter', total: 0, open: 0 };
      row.total += 1;
      if (isOpenAvancement(s.status)) row.open += 1;
      rows.set(key, row);
    }
    const list = [...rows.values()];
    return order
      ? list.sort((x, y) => (x.key === '' ? 1 : y.key === '' ? -1 : order.indexOf(x.key) - order.indexOf(y.key)))
      : list.sort((x, y) => y.total - x.total || x.label.localeCompare(y.label, 'fr'));
  };

  // Vérifiées dans le mois : avancement actuel Vérifiée, date de vérification dans le mois (une vérification rouverte
  // depuis n'est plus comptée : sa date est effacée).
  const verifiedRows = actions.filter((a) => a.status === 'verifiee' && inMonth(a.closedOn, month));
  const delays = verifiedRows.map((a) => daysBetween(a.openedOn, a.closedOn!));
  const finishedRows = actions.filter((a) => a.status !== 'abandonnee' && inMonth(a.doneOn, month));
  const onTime = finishedRows.filter((a) => a.doneOn! <= a.dueOn).length;
  const effective = verifiedRows.filter((a) => a.effective === true).length;

  const evolution = monthsEnding(month, 12).map((ym): MonthEvolution => {
    const day = asOfFor(ym);
    const open = statesAt(actions, byAction, day).filter((s) => s.status && isOpenAvancement(s.status));
    const late = open.filter((s) => isLate({ status: s.status!, dueOn: s.a.dueOn }, day)).length;
    return {
      month: ym, label: monthLabel(ym),
      opened: actions.filter((a) => inMonth(a.openedOn, ym)).length,
      closed: actions.filter((a) => a.status === 'verifiee' && inMonth(a.closedOn, ym)).length,
      abandoned: actions.filter((a) => a.status === 'abandonnee' && inMonth(a.cancelledOn, ym)).length,
      open: open.length, late, lateRate: rate(late, open.length),
    };
  });

  return {
    month, label: monthLabel(month), asOf, current: asOf === today && monthEnd(month) >= today,
    total: states.length,
    byAvancement: ACTION_AVANCEMENTS.map((key) => ({ key, label: AVANCEMENT[key].label, count: states.filter((s) => s.status === key).length })),
    bySource: group((a) => a.source, (k) => ACTION_SOURCES[k as keyof typeof ACTION_SOURCES]?.label ?? k),
    byDomain: group((a) => a.domain, (k) => ACTION_DOMAINS[k as keyof typeof ACTION_DOMAINS] ?? k, Object.keys(ACTION_DOMAINS)),
    byPilot: group((a) => a.pilotId, (k) => input.pilotNames.get(k) ?? k),
    byRiskLevel: group((a) => (a.riskLevel == null ? null : String(a.riskLevel)), (k) => ACTION_RISK_LEVELS[Number(k)] ?? k,
      Object.keys(ACTION_RISK_LEVELS)),
    open: openStates.length, late: lateCount, lateRate: rate(lateCount, openStates.length),
    verified: verifiedRows.length,
    meanCloseDays: delays.length ? Math.round((delays.reduce((n, d) => n + d, 0) / delays.length) * 10) / 10 : null,
    effective, efficacyRate: rate(effective, verifiedRows.length),
    finished: finishedRows.length, onTime, onTimeRate: rate(onTime, finishedRows.length),
    evolution,
  };
}
