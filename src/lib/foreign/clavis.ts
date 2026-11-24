import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db';
import { pubAcces } from '@/db/foreign';
import { readSource, type SourceRead } from './source';

// Lectures de Clavis (connexion centrale, décision du propriétaire du 23/11/2026 : une seule base, les droits lus dans la
// base, jamais dans le jeton). clavis.pub_acces : une ligne par personne et application ; Vigie lit les siennes
// (application = « vigie »). Lien de lecture vigie_app accordé par Matrix. Aucune écriture (décision M-17 de Matrix).

/** Code de Vigie dans Clavis (clavis.applications.code). */
export const CLAVIS_APPLICATION = 'vigie';

/** Ligne de la personne pour Vigie : rôle propre de Vigie (Vigie.Direction…) et ouverture de l'application maintenant. */
export type ClavisAccess = { role: string | null; open: boolean };

/**
 * Accès de la personne `personId` (oid du jeton de Clavis = personne_id) à Vigie : au plus une ligne ; aucune ligne = aucun
 * accès accordé. Source indisponible (vue absente, lecture refusée, erreur) : état de readSource, jamais une exception.
 */
export function readClavisAccess(db: DbOrTx, personId: string): Promise<SourceRead<ClavisAccess>> {
  return readSource(db, 'access', () => db.select({ role: pubAcces.role, open: pubAcces.ouvert }).from(pubAcces)
    .where(and(sql`${pubAcces.personneId}::text = ${personId}`, eq(pubAcces.application, CLAVIS_APPLICATION))).limit(1)
    .then((rows) => rows.map((r) => ({ role: r.role, open: r.open === true }))));
}

/** Lignes de Vigie dans clavis.pub_acces (onglet « Connecteurs » : la lecture est-elle possible ? combien de lignes ?). */
export function readClavisAccessRows(db: DbOrTx): Promise<SourceRead<{ open: boolean }>> {
  return readSource(db, 'access', () => db.select({ open: pubAcces.ouvert }).from(pubAcces).where(eq(pubAcces.application, CLAVIS_APPLICATION))
    .then((rows) => rows.map((r) => ({ open: r.open === true }))));
}
