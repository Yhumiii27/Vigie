// Tâches planifiées du serveur (PRD-12), sur le modèle de la maintenance horaire (src/db/maintenance.ts, qui garde sa
// propre minuterie) : un registre de tâches construit à l'ouverture de la base (scheduledTasks, src/db/index.ts), passé
// toutes les 10 minutes. Module sans 'server-only' : utilisable par les scripts et les tests.
//
// Chaque tâche décide elle-même si elle a quelque chose à faire (créneau, journal d'envoi en base) : un passage manqué
// (serveur arrêté, base ouverte plus tard) est simplement rattrapé au passage suivant dans le créneau de la tâche, jamais
// au-delà (rappel du mercredi : pas de rattrapage le jeudi, D13). La base, et donc le planificateur, s'ouvre à la première
// requête ou sonde de santé (HEALTHCHECK de l'image : 30 s après le démarrage).
//
// Tâches inscrites (scheduledTasks) : référentiels partagés (lot 0 de M-02, une fois par nuit, serveur Next.js seulement) ;
// demandes reçues de Keystone (D13, CV-08 : à chaque passage, serveur Next.js seulement) ; envois aux outils (D12 : décisions
// transmises à Codex, à chaque passage, serveur Next.js seulement) ;
// rappel du mercredi par e-mail (ACT-33), seulement quand un transport d'e-mail existe
// (VIGIE_MAIL_TRANSPORT ≠ aucun) ; échéances par personne (PRD-12, src/lib/data/person-todo.ts), calculées toutes les heures
// hors requête et gardées en mémoire pour un futur canal sortant, dans le serveur Next.js seulement (instrumentation :
// src/lib/server-runtime.ts ; jamais dans les scripts ni les tests). Les passages s'exécutent dans le contexte racine du
// serveur, jamais dans celui de la requête qui a ouvert la base.

import { runWeeklyReminder, reminderClock } from '@/lib/action-reminder-job';
import type { VigieConfig } from '@/lib/env';
import { createTransport } from '@/lib/mail/transport';
import type { Db } from './types';
import { log } from '../lib/log';
import { inRootContext, serverRuntime } from '../lib/server-runtime';

/** Intervalle des passages du planificateur. */
export const SCHEDULER_INTERVAL_MS = 10 * 60_000;

/** Tâche planifiée : `run` est appelé à chaque passage avec l'instant du passage ; une erreur est journalisée. */
export type ScheduledTask = { name: string; run(db: Db, now: Date): Promise<void> };

/** Nom de la tâche du rappel du mercredi (journal du serveur). */
export const WEEKLY_REMINDER_TASK = 'Rappel du mercredi';

/** Nom de la tâche des échéances par personne (PRD-12, journal du serveur). */
export const PERSON_TODO_TASK = 'Échéances par personne';
/** Intervalle minimal entre deux calculs des échéances par personne. */
export const PERSON_TODO_INTERVAL_MS = 60 * 60_000;

/**
 * Échéances par personne (PRD-12) : calculées hors requête au premier passage, puis au plus une fois par heure ; lecture
 * seule, rien n'est envoyé ni écrit en base. Journal du serveur : nombres seulement (personnes, échéances, retards).
 */
export function personTodoTask(intervalMs = PERSON_TODO_INTERVAL_MS): ScheduledTask {
  let last = 0;
  return {
    name: PERSON_TODO_TASK,
    async run(_db, now) {
      if (last && now.getTime() - last < intervalMs) return;
      last = now.getTime();
      const started = Date.now();
      const { computePersonTodo } = await import('@/lib/data/person-todo');
      const digest = await computePersonTodo(now);
      log.info('scheduler.person-todo', 'Échéances par personne calculées', {
        people: digest.people.length,
        items: digest.people.reduce((n, p) => n + p.items.length, 0),
        late: digest.people.reduce((n, p) => n + p.late, 0),
        ms: Date.now() - started,
      });
    },
  };
}

/** Nom de la tâche des référentiels partagés (lot 0 de M-02, journal du serveur). */
export const SHARED_REFERENCES_TASK = 'Référentiels partagés';
/** Heure de Paris à partir de laquelle le rafraîchissement de la nuit a lieu (une fois par jour). */
export const SHARED_REFERENCES_HOUR = 2;

const parisClock = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
};

/**
 * Référentiels partagés (lot 0 de M-02) : caches des vues des autres outils (sites de Matrix, affectations de Keystone)
 * rafraîchis une fois par nuit, à partir de 2 h (heure de Paris) ; l'ouverture de la base fait déjà le rafraîchissement du
 * jour du démarrage. Passages : sync_runs (src/server/foreign-sync.ts).
 */
export function sharedReferencesTask(startedAt = new Date()): ScheduledTask {
  let lastDay = parisClock(startedAt).day;
  return {
    name: SHARED_REFERENCES_TASK,
    async run(db, now) {
      const { day, hour } = parisClock(now);
      if (day === lastDay || hour < SHARED_REFERENCES_HOUR) return;
      lastDay = day;
      const { refreshSharedReferences } = await import('@/server/foreign-sync');
      await refreshSharedReferences(db);
    },
  };
}

/** Nom de la tâche des demandes reçues des autres outils (D13, décision CV-08, journal du serveur). */
export const INBOUND_REQUESTS_TASK = 'Demandes reçues';

/**
 * Demandes reçues (D13, décision CV-08) : demandes déposées par Keystone avec vigie.pub_signaler_avancement_nc, traitées à
 * chaque passage du planificateur (10 min) par les règles de Vigie (src/server/inbound.ts).
 */
export function inboundRequestsTask(): ScheduledTask {
  return {
    name: INBOUND_REQUESTS_TASK,
    async run(db) {
      const { processInboundRequests } = await import('@/server/inbound');
      await processInboundRequests(db);
    },
  };
}

/** Nom de la tâche des envois aux autres outils (D12, lot 5 de M-02, journal du serveur). */
export const OUTBOUND_MESSAGES_TASK = 'Envois aux outils';

/**
 * Envois aux outils (D12) : messages de la file outbound_messages (décisions sur les demandes de modification de Codex),
 * envoyés à chaque passage du planificateur (10 min) avec reprises espacées (src/server/outbound.ts).
 */
export function outboundMessagesTask(): ScheduledTask {
  return {
    name: OUTBOUND_MESSAGES_TASK,
    async run(db) {
      const { sendOutboundMessages } = await import('@/server/outbound');
      await sendOutboundMessages(db);
    },
  };
}

type TaskConfig = Pick<VigieConfig, 'mailTransport' | 'mailDir' | 'mailFrom' | 'reminderTime' | 'publicUrl' | 'demo' | 'today'>;

/**
 * Registre des tâches de la configuration : le rappel du mercredi par e-mail quand un transport existe (« fichier » ;
 * « aucun » : registre vide, aucun passage ni journal d'envoi).
 */
export function scheduledTasks(c: TaskConfig): ScheduledTask[] {
  const tasks: ScheduledTask[] = [];
  // Serveur Next.js seulement (sessions et chargements des écrans) : ni scripts (vigie-db), ni tests.
  if (serverRuntime()) tasks.push(personTodoTask(), sharedReferencesTask(), inboundRequestsTask(), outboundMessagesTask());
  const transport = createTransport(c);
  if (transport) {
    tasks.push({
      name: WEEKLY_REMINDER_TASK,
      async run(db, real) {
        const { todayIso, now } = reminderClock(c, real);
        await runWeeklyReminder(db, { now, todayIso, cfg: c, transport });
      },
    });
  }
  return tasks;
}

/**
 * Lance le planificateur : un premier passage immédiat, puis toutes les `intervalMs` (minuterie qui ne retient pas le
 * processus). Les tâches d'un passage s'exécutent l'une après l'autre ; un passage ne démarre pas tant que le précédent
 * n'est pas fini. Une erreur est écrite dans le journal du serveur, jamais levée. Renvoie la fonction d'arrêt, à appeler
 * avant de fermer la base : elle arrête la minuterie et attend la fin du passage en cours.
 */
export function startScheduler(db: Db, tasks: readonly ScheduledTask[], intervalMs = SCHEDULER_INTERVAL_MS): () => Promise<void> {
  let stopped = false;
  let running = false;
  let current: Promise<void> = Promise.resolve();
  const pass = () => {
    if (running || stopped) return;
    running = true;
    current = (async () => {
      for (const task of tasks) {
        if (stopped) break;
        try {
          await task.run(db, new Date());
        } catch (err) {
          if (!stopped) log.error('scheduler.task', `Tâche planifiée « ${task.name} » en erreur`, { task: task.name, error: err });
        }
      }
    })().finally(() => { running = false; });
  };
  // Contexte racine du serveur (hors requête) : ni cookies, ni session, ni mémoïsation de la requête qui a ouvert la base.
  const timer = inRootContext(() => {
    pass();
    return setInterval(pass, intervalMs);
  });
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await current;
  };
}
