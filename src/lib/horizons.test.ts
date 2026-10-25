import { describe, expect, it } from 'vitest';
import * as domain from './domain';
import {
  CERT_SOON_DAYS, CONTROL_HORIZON_DAYS, NOTIFY_HORIZON_DAYS, TODO_GROUPS, TODO_HORIZON_DAYS, groupTodo, inNotifyHorizon, inTodoHorizon,
  isTodoLate, todoGroup,
} from './horizons';

// TDB-16 : horizons d'échéances centralisés et groupes de la page À faire.
const today = '2026-10-09';

describe('horizons des échéances (TDB-16)', () => {
  it('valeurs uniques, reprises par domain.ts', () => {
    expect([TODO_HORIZON_DAYS, CONTROL_HORIZON_DAYS, CERT_SOON_DAYS, NOTIFY_HORIZON_DAYS]).toEqual([15, 30, 30, 7]);
    expect(domain.TODO_HORIZON_DAYS).toBe(TODO_HORIZON_DAYS);
    expect(domain.CONTROL_HORIZON_DAYS).toBe(CONTROL_HORIZON_DAYS);
    expect(domain.NOTIFY_HORIZON_DAYS).toBe(NOTIFY_HORIZON_DAYS);
    expect(domain.CERT_SOON_DAYS).toBe(CERT_SOON_DAYS);
  });

  it('retard : signalé par le domaine, ou daté avant aujourd’hui', () => {
    expect(isTodoLate({ date: today, overdue: true }, today)).toBe(true);
    expect(isTodoLate({ date: '2026-10-08' }, today)).toBe(true);
    expect(isTodoLate({ date: today }, today)).toBe(false);
  });

  it('groupes : retard, 7 jours, 15 jours, au-delà (plus « Contrôles à 30 jours » pour tout ce qui dépasse 15 jours)', () => {
    expect(todoGroup({ date: '2026-10-16' }, today)).toBe('week');
    expect(todoGroup({ date: '2026-10-17' }, today)).toBe('horizon');
    expect(todoGroup({ date: '2026-10-24' }, today)).toBe('horizon');
    expect(todoGroup({ date: '2026-10-25' }, today)).toBe('later');
    expect(TODO_GROUPS.later).toBe('Au-delà de 15 jours');
    const rows = [
      { id: 'c', date: '2026-11-05' }, { id: 'r', date: today, overdue: true }, { id: 'w', date: '2026-10-10' }, { id: 'h', date: '2026-10-20' },
      { id: 'w2', date: '2026-10-12' },
    ];
    expect(groupTodo(rows, today).map(([label, list]) => [label, list.map((x) => x.id)])).toEqual([
      ['En retard', ['r']], ['Cette semaine', ['w', 'w2']], ["D'ici 15 jours", ['h']], ['Au-delà de 15 jours', ['c']],
    ]);
    expect(groupTodo([{ date: '2026-10-10' }], today).map(([label]) => label)).toEqual(['Cette semaine']);
  });

  it('carte « À traiter » (15 jours) et cloche (7 jours) : retards toujours compris', () => {
    expect(inTodoHorizon({ date: '2026-10-24' }, today)).toBe(true);
    expect(inTodoHorizon({ date: '2026-10-25' }, today)).toBe(false);
    expect(inTodoHorizon({ date: '2026-12-01', overdue: true }, today)).toBe(true);
    expect(inNotifyHorizon({ date: '2026-10-16' }, today)).toBe(true);
    expect(inNotifyHorizon({ date: '2026-10-17' }, today)).toBe(false);
    expect(inNotifyHorizon({ date: '2026-10-30', overdue: true }, today)).toBe(true);
  });
});
