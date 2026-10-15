// Tâches de maintenance périodiques du serveur (réserve EVT-07 / SEC-09 du lot 1), lancées à l'ouverture de la base
// (src/db/index.ts), en attendant les tâches planifiées (PRD-12). Module sans 'server-only' ni dépendance vers le reste
// de l'application : utilisable par les scripts et les tests.
//
// - Compteurs du signalement sans compte (report_rate_limits : empreintes HMAC des adresses IP des clients) : supprimés
//   après 24 h, à chaque signalement et toutes les heures, même sans signalement. Idempotent : plusieurs instances
//   de Vigie peuvent purger en même temps.

import { lt } from 'drizzle-orm';
import * as t from './schema';
import type { Db, DbOrTx } from './types';

/** Durée de conservation des compteurs de la limite de débit (fenêtres d'une heure au plus). */
export const RATE_LIMIT_RETENTION_MS = 24 * 3600_000;
/** Intervalle des passages de maintenance. */
export const MAINTENANCE_INTERVAL_MS = 3600_000;

/** Supprime les compteurs de plus de 24 h ; renvoie le nombre de lignes supprimées. */
export async function purgeExpiredRateLimits(db: DbOrTx, now = new Date()): Promise<number> {
  const deleted = await db.delete(t.reportRateLimits)
    .where(lt(t.reportRateLimits.windowStart, new Date(now.getTime() - RATE_LIMIT_RETENTION_MS)))
    .returning({ key: t.reportRateLimits.key });
  return deleted.length;
}

/**
 * Lance la maintenance : un premier passage immédiat, puis toutes les heures (minuterie qui ne retient pas le processus).
 * Une erreur est écrite dans le journal du serveur, jamais levée. Renvoie la fonction d'arrêt, à appeler avant de fermer
 * la base : elle arrête la minuterie et attend la fin du passage en cours.
 */
export function startMaintenance(db: Db): () => Promise<void> {
  let stopped = false;
  let current: Promise<void> = Promise.resolve();
  const run = () => {
    current = (async () => {
      try {
        const purged = await purgeExpiredRateLimits(db);
        if (purged) console.info(`[vigie] Maintenance : ${purged} compteur(s) de signalement sans compte de plus de 24 h supprimé(s).`);
      } catch (err) {
        if (!stopped) console.error(`[vigie] Maintenance : purge des compteurs de signalement impossible (${err instanceof Error ? err.message : String(err)}).`);
      }
    })();
  };
  run();
  const timer = setInterval(run, MAINTENANCE_INTERVAL_MS);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await current;
  };
}
