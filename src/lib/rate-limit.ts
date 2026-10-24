import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';

// Limites par personne connectée (SEC-07), en base comme celles du signalement sans compte (table report_rate_limits,
// partagée par toutes les instances, purgée après 24 h par src/db/maintenance.ts, exclue des sauvegardes). Clé :
// « u:<nature>:<empreinte de l'identifiant> » (aucun identifiant en clair, jamais d'adresse IP).
//
// Contrôle en deux temps : `userLimitError` (lecture seule) avant l'écriture, pour un message clair dans le formulaire ;
// `consumeUserLimit` dans la transaction de l'écriture (annulée avec elle : un envoi refusé ne consomme rien).

/**
 * Limites par fenêtre fixe (minutes) :
 * - `report` : signalements d'une personne connectée par heure ;
 * - `uploadFiles` : fichiers joints par heure ; `uploadMegabytes` : volume joint (Mo, arrondi au Mo supérieur par fichier)
 *   par jour (fenêtre de 24 h alignée sur minuit UTC) ;
 * - `ppDetect` : analyses d'un fichier par l'import des plans de prévention, par heure (lecture des scans par l'API Claude
 *   plafonnée en plus par VIGIE_AI_DAILY_SCANS, INT-06).
 */
export const USER_LIMITS = {
  report: { max: 30, windowMinutes: 60, message: 'Vous avez enregistré beaucoup de signalements en une heure : réessayez plus tard, ou prévenez l’animateur QHSE.' },
  uploadFiles: { max: 100, windowMinutes: 60, message: 'Limite de 100 fichiers joints par heure atteinte : réessayez plus tard.' },
  uploadMegabytes: { max: 500, windowMinutes: 1440, message: 'Limite de 500 Mo de fichiers joints par jour atteinte : réessayez demain, ou contactez l’administrateur de Vigie.' },
  ppDetect: { max: 60, windowMinutes: 60, message: 'Limite de 60 analyses de fichiers par heure atteinte : réessayez plus tard.' },
} as const;
export type UserLimitScope = keyof typeof USER_LIMITS;

export const userLimitKey = (scope: UserLimitScope, personId: string) =>
  `u:${scope}:${createHash('sha256').update(`${scope}\n${personId}`).digest('hex').slice(0, 32)}`;

const windowStart = (scope: UserLimitScope, now: Date) => {
  const ms = USER_LIMITS[scope].windowMinutes * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
};

/** Volume d'un fichier compté par `uploadMegabytes` (Mo entamé). */
export const megabytesOf = (size: number) => Math.max(1, Math.ceil(size / (1024 * 1024)));

/** Consommation de la fenêtre courante. */
export async function userLimitHits(scope: UserLimitScope, personId: string, opts: { now?: Date; db?: DbOrTx } = {}): Promise<number> {
  const db = opts.db ?? (await getDb());
  const [row] = await db.select({ hits: t.reportRateLimits.hits }).from(t.reportRateLimits)
    .where(and(eq(t.reportRateLimits.key, userLimitKey(scope, personId)), eq(t.reportRateLimits.windowStart, windowStart(scope, opts.now ?? new Date()))));
  return row?.hits ?? 0;
}

/** Message si `amount` de plus dépasserait la limite (lecture seule), sinon null. */
export async function userLimitError(scope: UserLimitScope, personId: string, amount = 1, opts: { now?: Date; db?: DbOrTx } = {}): Promise<string | null> {
  const { max, message } = USER_LIMITS[scope];
  return (await userLimitHits(scope, personId, opts)) + amount > max ? message : null;
}

/** Erreur levée par consumeUserLimit (dans une transaction : l'annule, consommation comprise). */
export class UserLimitError extends Error {
  constructor(readonly scope: UserLimitScope) {
    super(USER_LIMITS[scope].message);
    this.name = 'UserLimitError';
  }
}

/**
 * Consomme `amount` dans la fenêtre courante (incrément atomique INSERT … ON CONFLICT, juste avec plusieurs instances) ;
 * lève UserLimitError si la limite est dépassée. Avec `db` (transaction en cours), annulé avec elle.
 */
export async function consumeUserLimit(scope: UserLimitScope, personId: string, amount = 1, opts: { now?: Date; db?: DbOrTx } = {}): Promise<number> {
  const db = opts.db ?? (await getDb());
  const [row] = await db.insert(t.reportRateLimits)
    .values({ key: userLimitKey(scope, personId), windowStart: windowStart(scope, opts.now ?? new Date()), hits: amount })
    .onConflictDoUpdate({ target: [t.reportRateLimits.key, t.reportRateLimits.windowStart], set: { hits: sql`${t.reportRateLimits.hits} + ${amount}` } })
    .returning({ hits: t.reportRateLimits.hits });
  if (row.hits > USER_LIMITS[scope].max) throw new UserLimitError(scope);
  return row.hits;
}
