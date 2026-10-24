// Tâches de maintenance périodiques du serveur (réserve EVT-07 / SEC-09 du lot 1), lancées à l'ouverture de la base
// (src/db/index.ts), en attendant les tâches planifiées (PRD-12). Module sans 'server-only' ni dépendance vers le reste
// de l'application : utilisable par les scripts et les tests.
//
// - Compteurs du signalement sans compte (report_rate_limits : empreintes HMAC des adresses IP des clients) : supprimés
//   après 24 h, à chaque signalement et toutes les heures, même sans signalement. Idempotent : plusieurs instances
//   de Vigie peuvent purger en même temps.
// - Pièces jointes orphelines (PRD-13) : fichier du dossier des pièces jointes qu'aucune ligne d'`attachments` ne désigne,
//   vieux de plus de 24 h (transaction interrompue par un arrêt brutal du processus ; une transaction annulée efface déjà
//   ses fichiers, src/db/pending-files.ts). Seulement quand src/db/index.ts passe `uploadDir` : serveur avec tâches
//   planifiées (VIGIE_SCHEDULER), base sur disque ou PostgreSQL — jamais une base en mémoire (tests), ni les scripts.

import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { inArray, lt } from 'drizzle-orm';
import { log } from '../lib/log';
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

/** Délai de grâce avant qu'un fichier sans ligne soit tenu pour orphelin (transactions en cours, restauration). */
export const ORPHAN_GRACE_MS = 24 * 3600_000;
/** Nom des fichiers de pièces jointes (identifiant UUID de la ligne) : tout autre fichier du dossier est ignoré. */
const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Efface les fichiers de pièces jointes sans ligne et plus vieux que `graceMs` ; renvoie leur nombre. */
export async function sweepOrphanUploads(db: DbOrTx, dir: string, now = new Date(), graceMs = ORPHAN_GRACE_MS): Promise<number> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => STORED_NAME.test(n));
  } catch {
    return 0; // dossier absent : aucune pièce jointe encore
  }
  let removed = 0;
  for (let i = 0; i < names.length; i += 500) {
    const batch = names.slice(i, i + 500);
    const known = new Set((await db.select({ id: t.attachments.id }).from(t.attachments).where(inArray(t.attachments.id, batch))).map((r) => r.id));
    for (const name of batch.filter((n) => !known.has(n))) {
      const file = path.join(dir, name);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile() || now.getTime() - info.mtimeMs < graceMs) continue;
      await unlink(file).then(() => { removed++; }, () => {});
    }
  }
  return removed;
}

/**
 * Lance la maintenance : un premier passage immédiat, puis toutes les heures (minuterie qui ne retient pas le processus).
 * Une erreur est écrite dans le journal du serveur, jamais levée. Renvoie la fonction d'arrêt, à appeler avant de fermer
 * la base : elle arrête la minuterie et attend la fin du passage en cours.
 */
export function startMaintenance(db: Db, opts: { uploadDir?: string | null } = {}): () => Promise<void> {
  let stopped = false;
  let current: Promise<void> = Promise.resolve();
  const run = () => {
    current = (async () => {
      try {
        const purged = await purgeExpiredRateLimits(db);
        if (purged) log.info('maintenance.rate-limits', `${purged} compteur(s) de limite de débit de plus de 24 h supprimé(s)`, { purged });
      } catch (err) {
        if (!stopped) log.error('maintenance.rate-limits', 'Purge des compteurs de limite de débit impossible', { error: err });
      }
      if (!opts.uploadDir || stopped) return;
      try {
        const orphans = await sweepOrphanUploads(db, opts.uploadDir);
        if (orphans) log.warn('maintenance.orphan-uploads', `${orphans} fichier(s) de pièce jointe sans ligne en base (plus de 24 h) effacé(s)`, { orphans });
      } catch (err) {
        if (!stopped) log.error('maintenance.orphan-uploads', 'Recherche des pièces jointes orphelines impossible', { error: err });
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
