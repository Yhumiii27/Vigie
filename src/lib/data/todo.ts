import 'server-only';
import { cache } from 'react';
import { getDb, schema as t } from '@/db';
import { addDays, fmtDayMonth, today } from '../dates';
import type { TodoItem } from '../domain';
import { actionColumn, controlStatus, lcfirst, loadActions, loadControls, loadPeople } from '../queries';
import { loadDocumentSignals } from './documents';
import { loadEnvironmentSignals } from './environment';
import { loadPreventionSignals } from './prevention';
import { loadCoactivitySignals } from './sitemap';
import { loadSkillMatrix } from './skills';

export const TODO_HORIZON_DAYS = 15;

const PLAN_KIND: Record<string, string> = { 'Audits internes': 'Audit interne', 'Visites sécurité': 'Visite sécurité', Certification: 'Certification', Fournisseurs: 'Audit fournisseur', 'Revues de direction': 'Revue de direction' };
const equipShort = (e: string) => e.split(' — ')[0];

/** Échéances des 15 prochains jours et dépassements, tous domaines confondus (tableau de bord, notifications). */
export const loadTodo = cache(async (): Promise<TodoItem[]> => {
  const db = await getDb();
  const now = today();
  const [people, actions, controls, plan, skills, ...signals] = await Promise.all([
    loadPeople(), loadActions(), loadControls(), db.select().from(t.auditPlanItems), loadSkillMatrix(),
    loadPreventionSignals(), loadDocumentSignals(), loadEnvironmentSignals(), loadCoactivitySignals(),
  ]);
  const horizon = addDays(now, TODO_HORIZON_DAYS);
  const inWindow = (d: string | null | undefined): d is string => !!d && d >= now && d <= horizon;
  const name = (id: string | null | undefined) => (id ? people.get(id)?.name ?? '' : '');
  const planActions = new Set(plan.map((p) => p.actionId).filter(Boolean));
  const todo: TodoItem[] = [];

  controls.forEach((c) => {
    const s = controlStatus(c, now);
    const who = [c.organization, name(c.responsibleId)].filter(Boolean).join(' · ');
    const title = `${c.controlType} · ${lcfirst(equipShort(c.equipment))}`;
    const href = `/veille?onglet=controles&controle=${c.id}`;
    if (s.days < 0) todo.push({ date: now, kind: 'Contrôle', tone: 'danger', title: `${title} — dépassé depuis le ${fmtDayMonth(c.nextOn)}`, who, href });
    else if (inWindow(c.nextOn)) todo.push({ date: c.nextOn, kind: 'Contrôle', tone: 'warn', title, who, href });
  });
  actions.forEach((a) => {
    const col = actionColumn(a, now);
    const href = `/actions?action=${a.id}`;
    if ((col === 'todo' || col === 'doing') && inWindow(a.dueOn) && !planActions.has(a.id)) todo.push({ date: a.dueOn, kind: 'Action', tone: 'accent', title: `${a.id} · ${a.title}`, who: name(a.pilotId), href });
    if (col === 'verify' && inWindow(a.verifyDueOn)) todo.push({ date: a.verifyDueOn, kind: 'Efficacité', tone: 'accent', title: `${a.eventId ?? a.originRef} · vérification d'efficacité de ${a.id}`, who: name(a.pilotId), href });
  });
  plan.forEach((p) => {
    if (!p.done && inWindow(p.plannedOn)) todo.push({ date: p.plannedOn, kind: PLAN_KIND[p.track] ?? p.track, tone: 'neutral', title: p.detail ?? p.label, who: name(p.ownerId), href: '/audits' });
  });
  skills.alerts.forEach((al) => {
    const d = al.assignment.startOn < now ? now : al.assignment.startOn;
    if (d <= horizon) todo.push({ date: d, kind: 'Habilitation', tone: 'danger', title: `${al.person.name} · ${lcfirst(al.title)} ${al.state === 'x' ? 'expiré' : 'jamais suivi'}, affecté à ${al.assignment.project.split(' · ')[0]}`, who: name('clefevre'), href: '/habilitations' });
  });

  signals.forEach((s) => todo.push(...s.todo));
  return todo.sort((a, b) => a.date.localeCompare(b.date));
});
