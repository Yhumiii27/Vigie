import 'server-only';
import { asc } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { isDemo } from '../config';
import { ALL_SITES } from '../domain';
import { PERSON_COLUMNS, type Person } from '../people';
import { todoByPerson, type PersonTodo } from '../rules/person-todo';
import { runAsBackground, type Session } from '../session';
import { today } from '../today';
import { loadTodo } from './todo';

// Échéances par personne, calculées hors requête par une tâche planifiée (PRD-12, src/db/scheduler.ts) : prérequis d'un
// futur canal sortant (e-mail, Teams…, non décidé). Les échéances sont celles des écrans (load<Domaine>Signals via
// loadTodo), calculées une fois pour tout le périmètre avec la session de la tâche (rôle Direction, tous les sites), puis
// réparties par responsable désigné et filtrées par le rôle de chacun (todoByPerson, src/lib/rules/person-todo.ts).
// Rien n'est stocké en base (indicateurs calculés) : le dernier calcul, horodaté, est gardé en mémoire du processus.

/** Résultat d'un calcul : horodatage, jour de référence, échéances par personne. */
export type PersonTodoDigest = { computedAt: Date; today: string; people: PersonTodo[] };

/** Personne fictive de la session de la tâche planifiée (jamais écrite en base, jamais responsable d'une échéance). */
const SCHEDULER_USER: Person = {
  id: '__vigie_scheduler__', name: 'Vigie (tâche planifiée)', job: '', siteId: null, inSkillsMatrix: false, sort: 0, service: '',
  leftOn: null, leftReason: null, email: null, matricule: null, lastRole: null,
};

/** Session de la tâche : rôle Direction (toutes les échéances, données de santé comprises), tous les sites. */
async function schedulerSession(): Promise<Session> {
  const db = await getDb();
  const sites = await db.select({ id: t.sites.id, label: t.sites.label, archivedAt: t.sites.archivedAt }).from(t.sites).orderBy(asc(t.sites.sort));
  const active = sites.filter((s) => !s.archivedAt).map((s) => ({ id: s.id, label: s.label }));
  const all = { id: ALL_SITES, label: 'Tous les sites' };
  return { role: 'Direction', user: SCHEDULER_USER, site: all, siteOptions: [...active, all], allowedSiteIds: null, bootstrap: !active.length, demo: isDemo() };
}

const LATEST = Symbol.for('vigie.personTodo');
const memory = globalThis as unknown as Record<symbol, PersonTodoDigest | undefined>;

/** Dernier calcul de la tâche planifiée (null avant le premier passage, ou sans planificateur). */
export function latestPersonTodo(): PersonTodoDigest | null {
  return memory[LATEST] ?? null;
}

/**
 * Calcule les échéances de chaque personne, sans requête ni session d'utilisateur, et garde le résultat en mémoire
 * (latestPersonTodo). Lecture seule : aucune écriture en base, aucun envoi.
 */
export async function computePersonTodo(at = new Date()): Promise<PersonTodoDigest> {
  const db = await getDb();
  const [items, people] = await Promise.all([
    runAsBackground(await schedulerSession(), () => loadTodo()),
    db.select(PERSON_COLUMNS).from(t.people).orderBy(asc(t.people.sort), asc(t.people.name)),
  ]);
  const day = today();
  const digest: PersonTodoDigest = { computedAt: at, today: day, people: todoByPerson(items, people, day) };
  memory[LATEST] = digest;
  return digest;
}
