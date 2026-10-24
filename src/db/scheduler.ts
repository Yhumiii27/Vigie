// Tâches planifiées du serveur (PRD-12), sur le modèle de la maintenance horaire (src/db/maintenance.ts, qui garde sa
// propre minuterie) : un registre de tâches construit à l'ouverture de la base (scheduledTasks, src/db/index.ts), passé
// toutes les 10 minutes. Module sans 'server-only' : utilisable par les scripts et les tests.
//
// Chaque tâche décide elle-même si elle a quelque chose à faire (créneau, journal d'envoi en base) : un passage manqué
// (serveur arrêté, base ouverte plus tard) est simplement rattrapé au passage suivant dans le créneau de la tâche, jamais
// au-delà (rappel du mercredi : pas de rattrapage le jeudi, D13). La base, et donc le planificateur, s'ouvre à la première
// requête ou sonde de santé (HEALTHCHECK de l'image : 30 s après le démarrage).
//
// Tâches inscrites (scheduledTasks) : rappel du mercredi par e-mail (ACT-33), seulement quand un transport d'e-mail existe
// (VIGIE_MAIL_TRANSPORT ≠ aucun). Les futures tâches PRD-12 s'ajoutent au registre.

import { runWeeklyReminder, reminderClock } from '@/lib/action-reminder-job';
import type { VigieConfig } from '@/lib/env';
import { createTransport } from '@/lib/mail/transport';
import type { Db } from './types';
import { log } from '../lib/log';

/** Intervalle des passages du planificateur. */
export const SCHEDULER_INTERVAL_MS = 10 * 60_000;

/** Tâche planifiée : `run` est appelé à chaque passage avec l'instant du passage ; une erreur est journalisée. */
export type ScheduledTask = { name: string; run(db: Db, now: Date): Promise<void> };

/** Nom de la tâche du rappel du mercredi (journal du serveur). */
export const WEEKLY_REMINDER_TASK = 'Rappel du mercredi';

type TaskConfig = Pick<VigieConfig, 'mailTransport' | 'mailDir' | 'mailFrom' | 'reminderTime' | 'publicUrl' | 'demo' | 'today'>;

/**
 * Registre des tâches de la configuration : le rappel du mercredi par e-mail quand un transport existe (« fichier » ;
 * « aucun » : registre vide, aucun passage ni journal d'envoi).
 */
export function scheduledTasks(c: TaskConfig): ScheduledTask[] {
  const tasks: ScheduledTask[] = [];
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
  pass();
  const timer = setInterval(pass, intervalMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await current;
  };
}
