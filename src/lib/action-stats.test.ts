import { describe, expect, it } from 'vitest';
import {
  computeActionStats, monthEnd, monthShift, monthsEnding, parseStatsMonth, statusAt, statusTransition, type StatsAction, type StatusTransition,
} from './action-stats';

// Statistiques mensuelles (ACT-29) : lecture du journal structuré, état reconstitué à une date, indicateurs du mois.

const action = (over: Partial<StatsAction> & { id: string }): StatsAction => ({
  openedOn: '2026-01-10', status: 'a_faire', dueOn: '2026-12-31', doneOn: null, closedOn: null, effective: null, source: 'evenement',
  domain: 'securite', pilotId: 'p1', riskLevel: null, cancelledOn: null, ...over,
});
const tr = (actionId: string, day: string, from: StatusTransition['from'], to: StatusTransition['to'], seq = 0, reprise = false): StatusTransition =>
  ({ actionId, day, seq, from, to, reprise });

describe('mois', () => {
  it('décalage, fin de mois, 12 mois, paramètre ?mois=', () => {
    expect(monthShift('2026-01', -1)).toBe('2025-12');
    expect(monthShift('2026-11', 3)).toBe('2027-02');
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2024-02')).toBe('2024-02-29');
    expect(monthEnd('2026-12')).toBe('2026-12-31');
    expect(monthsEnding('2026-10', 12)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(parseStatsMonth('2026-09', '2026-10-17')).toBe('2026-09');
    expect(parseStatsMonth('2026-11', '2026-10-17')).toBe('2026-10'); // futur : mois en cours
    expect(parseStatsMonth('2026-13', '2026-10-17')).toBe('2026-10');
    expect(parseStatsMonth(null, '2026-10-17')).toBe('2026-10');
  });
});

describe('journal structuré', () => {
  it('entrées « status » et « reprise » avec clé d’arrivée valide ; autres entrées ignorées', () => {
    const av = (fromKey: unknown, toKey: unknown) => [{ field: 'Avancement', from: 'x', to: 'y', fromKey, toKey }];
    expect(statusTransition({ actionId: 'A-1', action: 'status', day: '2026-05-01', seq: 3, details: av('a_faire', 'p20') }))
      .toEqual({ actionId: 'A-1', day: '2026-05-01', seq: 3, from: 'a_faire', to: 'p20', reprise: false });
    // Reprise 0005 : clé de départ de l'ancien modèle (« done »), sans valeur pour les statistiques.
    expect(statusTransition({ actionId: 'A-1', action: 'reprise', day: '2026-10-01', seq: 1, details: av('done', 'verifiee') }))
      .toMatchObject({ from: null, to: 'verifiee', reprise: true });
    expect(statusTransition({ actionId: 'A-1', action: 'status', day: '2026-05-01', seq: 1, details: [{ field: 'Avancement', from: 'À lancer', to: 'En cours' }] })).toBeNull();
    expect(statusTransition({ actionId: 'A-1', action: 'status', day: '2026-05-01', seq: 1, details: av('a_faire', 'inconnu') })).toBeNull();
    expect(statusTransition({ actionId: 'A-1', action: 'update', day: '2026-05-01', seq: 1, details: av('a_faire', 'p20') })).toBeNull();
    expect(statusTransition({ actionId: 'A-1', action: 'status', day: '2026-05-01', seq: 1, details: null })).toBeNull();
  });

  it('état à une date : pas encore ouverte, départ du premier changement, dernier changement, avancement actuel sans journal', () => {
    const a = action({ id: 'A-1', status: 'terminee', openedOn: '2026-03-01' });
    const ts = [tr('A-1', '2026-04-10', 'a_faire', 'p40', 1), tr('A-1', '2026-06-02', 'p40', 'terminee', 2)];
    expect(statusAt(a, ts, '2026-02-28')).toBeNull();
    expect(statusAt(a, ts, '2026-03-31')).toBe('a_faire');
    expect(statusAt(a, ts, '2026-04-10')).toBe('p40');
    expect(statusAt(a, ts, '2026-06-30')).toBe('terminee');
    expect(statusAt(a, [], '2026-03-31')).toBe('terminee');
    // Reprise : avancement repris atteint à la date de reprise, « À faire » avant.
    const r = [tr('A-1', '2026-10-01', null, 'verifiee', 1, true)];
    expect(statusAt({ openedOn: '2025-01-01', status: 'verifiee' }, r, '2026-09-30')).toBe('a_faire');
    expect(statusAt({ openedOn: '2025-01-01', status: 'verifiee' }, r, '2026-10-01')).toBe('verifiee');
  });
});

describe('indicateurs du mois', () => {
  const actions: StatsAction[] = [
    // Ouverte en retard à fin septembre (date cible actuelle 15/09).
    action({ id: 'A-1', status: 'p40', dueOn: '2026-09-15', pilotId: 'p1', riskLevel: 3 }),
    // Ouverte dans les temps.
    action({ id: 'A-2', status: 'initiee', openedOn: '2026-09-05', dueOn: '2026-11-30', pilotId: 'p2', domain: 'qualite', source: 'duerp' }),
    // Terminée en septembre avant sa date cible, vérifiée efficace en septembre.
    action({ id: 'A-3', status: 'verifiee', openedOn: '2026-08-01', doneOn: '2026-09-10', dueOn: '2026-09-20', closedOn: '2026-09-21', effective: true }),
    // Terminée en septembre après sa date cible, vérifiée non efficace en septembre.
    action({ id: 'A-4', status: 'verifiee', openedOn: '2026-07-01', doneOn: '2026-09-12', dueOn: '2026-09-01', closedOn: '2026-09-25', effective: false }),
    // Abandonnée en septembre : comptée dans l'avancement, exclue des taux.
    action({ id: 'A-5', status: 'abandonnee', dueOn: '2026-08-01', cancelledOn: '2026-09-03' }),
    // Ouverte en octobre : absente de l'état de septembre.
    action({ id: 'A-6', status: 'a_faire', openedOn: '2026-10-02' }),
  ];
  const transitions = [
    tr('A-1', '2026-02-01', 'a_faire', 'p40', 1),
    tr('A-3', '2026-09-10', 'a_faire', 'terminee', 2), tr('A-3', '2026-09-21', 'terminee', 'verifiee', 3),
    tr('A-4', '2026-09-12', 'a_faire', 'terminee', 4), tr('A-4', '2026-09-25', 'terminee', 'verifiee', 5),
    tr('A-5', '2026-09-03', 'a_faire', 'abandonnee', 6),
  ];
  const names = new Map([['p1', 'P. Un'], ['p2', 'P. Deux']]);
  const s = computeActionStats({ actions, transitions, month: '2026-09', today: '2026-10-17', pilotNames: names });

  it('état du plan à la fin du mois (Abandonnées comprises dans l’avancement)', () => {
    expect(s.asOf).toBe('2026-09-30');
    expect(s.current).toBe(false);
    expect(s.total).toBe(5);
    const by = Object.fromEntries(s.byAvancement.map((r) => [r.key, r.count]));
    expect(by).toMatchObject({ a_faire: 0, initiee: 1, p40: 1, verifiee: 2, abandonnee: 1 });
  });

  it('taux de retard, délai de clôture, efficacité, respect des dates cibles', () => {
    expect([s.open, s.late, s.lateRate]).toEqual([2, 1, 0.5]);
    expect(s.verified).toBe(2);
    expect(s.meanCloseDays).toBe((51 + 86) / 2); // 01/08 → 21/09 ; 01/07 → 25/09
    expect([s.effective, s.efficacyRate]).toEqual([1, 0.5]);
    expect([s.finished, s.onTime, s.onTimeRate]).toEqual([2, 1, 0.5]);
  });

  it('répartitions hors Abandonnées : source, domaine, responsable, niveau de risque (« À compléter » en dernier)', () => {
    expect(s.bySource.find((r) => r.key === 'evenement')).toMatchObject({ label: 'Évènement QSE', total: 3, open: 1 });
    expect(s.byDomain.map((r) => r.key)).toEqual(['qualite', 'securite']);
    expect(s.byPilot.find((r) => r.key === 'p2')).toMatchObject({ label: 'P. Deux', total: 1, open: 1 });
    expect(s.byRiskLevel.map((r) => r.key)).toEqual(['3', '']);
    expect(s.byRiskLevel.at(-1)).toMatchObject({ label: 'À compléter', total: 3 });
  });

  it('évolution sur 12 mois : ouvertes, clôturées, abandonnées, en cours et retard en fin de mois', () => {
    expect(s.evolution).toHaveLength(12);
    expect(s.evolution.at(-1)).toMatchObject({ month: '2026-09', opened: 1, closed: 2, abandoned: 1, open: 2, late: 1, lateRate: 0.5 });
    // Août : A-1 (40 %), A-3, A-4, A-5 ouvertes ; seule A-5 (date cible 01/08) est en retard au 31/08.
    expect(s.evolution.at(-2)).toMatchObject({ month: '2026-08', opened: 1, open: 4, late: 1 });
  });

  it('mois en cours : état à la date du jour', () => {
    const now = computeActionStats({ actions, transitions, month: '2026-10', today: '2026-10-17', pilotNames: names });
    expect(now).toMatchObject({ asOf: '2026-10-17', current: true, total: 6, open: 3 });
    expect(now.verified).toBe(0);
    expect(now.meanCloseDays).toBeNull();
    expect(now.efficacyRate).toBeNull();
  });
});
