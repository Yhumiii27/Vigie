import 'server-only';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { log } from '@/lib/log';

// Journal des consultations (SEC-11) : qui a consulté une pièce jointe ou une donnée de santé, et quand. Distinct du
// journal des modifications (change_log). Pas de 'use server' : aucune action appelable depuis le navigateur.
// - `fichier` : pièce servie par /fichiers/[id] (toute pièce ; `health` pour une pièce médicale) ;
// - `sante` : fiche d'un accident du travail ouverte avec ses données de santé (rôles canSeeHealth) ;
// - `registre_benin` : registre des accidents bénins d'un site ouvert ;
// - `donnees_personnelles` : vue des données d'une personne (SEC-13, droit d'accès), entité `person`.
// Une consultation répétée par la même personne dans la fenêtre DEDUP_MINUTES (rechargements, rafraîchissements après
// une écriture) n'ajoute pas d'entrée. Une erreur d'écriture n'empêche jamais la consultation (journalisée en console).
// Conservation : à fixer avec le DPO (SEC-10) ; aucune purge pour l'instant.

export type AccessKind = 'fichier' | 'sante' | 'registre_benin' | 'donnees_personnelles';

export const DEDUP_MINUTES = 10;

export type AccessInput = {
  kind: AccessKind;
  entityType: string;
  entityId: string;
  personId: string | null;
  attachmentId?: string | null;
  health?: boolean;
};

/** Ajoute une consultation au journal (sauf doublon récent). Ne lève jamais d'erreur. */
export async function logAccess(entry: AccessInput): Promise<void> {
  try {
    const db = await getDb();
    const since = new Date(Date.now() - DEDUP_MINUTES * 60_000);
    const [recent] = await db.select({ id: t.accessLog.id }).from(t.accessLog).where(and(
      entry.personId ? eq(t.accessLog.personId, entry.personId) : isNull(t.accessLog.personId),
      eq(t.accessLog.kind, entry.kind),
      eq(t.accessLog.entityType, entry.entityType),
      eq(t.accessLog.entityId, entry.entityId),
      entry.attachmentId ? eq(t.accessLog.attachmentId, entry.attachmentId) : isNull(t.accessLog.attachmentId),
      gt(t.accessLog.at, since),
    )).limit(1);
    if (recent) return;
    await db.insert(t.accessLog).values({
      kind: entry.kind, entityType: entry.entityType, entityId: entry.entityId, personId: entry.personId,
      attachmentId: entry.attachmentId ?? null, health: entry.health ?? false,
    });
  } catch (err) {
    log.error('access-log.write', 'Journal des consultations : écriture impossible', { error: err });
  }
}
