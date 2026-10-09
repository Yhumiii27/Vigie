import 'server-only';
import { cache } from 'react';
import { addDays, fmtDayMonth, today } from '../dates';
import { canOpen, type TodoItem } from '../domain';
import { actionColumn, loadActions, loadEvents, loadPeople } from '../queries';
import { getSession } from '../session';
import { loadTodo } from './todo';

export type Notification = TodoItem & { urgent: boolean };

/** Notifications de l'en-tête : dépassements, retards, signalements à qualifier et échéances des 7 prochains jours. */
export const loadNotifications = cache(async (): Promise<Notification[]> => {
  const now = today();
  const week = addDays(now, 7);
  const [{ role, user }, todo, events, actions, people] = await Promise.all([getSession(), loadTodo(), loadEvents(), loadActions(), loadPeople()]);
  const name = (id: string) => people.get(id)?.name ?? '';

  const items: Notification[] = [];
  events.filter((e) => e.step === 0).forEach((e) => {
    items.push({ date: e.occurredOn, kind: 'Signalement à qualifier', tone: 'warn', title: `${e.id} · ${e.title}`, who: e.anonymous ? 'Anonyme' : e.declarant ?? '', href: `/evenements?sel=${e.id}`, urgent: true });
  });
  actions.filter((a) => actionColumn(a, now) === 'late').forEach((a) => {
    items.push({ date: a.dueOn, kind: 'Action en retard', tone: 'danger', title: `${a.id} · ${a.title} — échéance ${fmtDayMonth(a.dueOn)}`, who: name(a.pilotId), href: `/actions?action=${a.id}`, urgent: true });
  });
  todo.filter((t) => t.date <= week).forEach((t) => items.push({ ...t, urgent: t.tone === 'danger' }));

  // Seulement ce que le rôle peut ouvrir ; un salarié ne voit que ce qui le concerne directement.
  const reachable = items.filter((n) => canOpen(role, n.href));
  const mine = role === 'Salarié' ? reachable.filter((n) => n.who.includes(user.name)) : reachable;
  return mine.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.date.localeCompare(b.date));
});
