import 'server-only';
import { and, eq, like, sql } from 'drizzle-orm';
import { schema as t, type DbOrTx } from '@/db';
import { maxRefNumber } from '@/lib/forms';

// Références sûres des fiches autres que les actions (PRD-08, même mécanisme qu'ACT-35 : src/server/action-core.ts,
// nextActionNumber). Compteur par préfixe dans la table de numérotation `action_counters` (portée → dernier numéro ; portée
// « ref:<préfixe> », ex. « ref:PP-2026- », jamais la portée « A » des actions), incrémenté par un upsert qui verrouille la
// ligne jusqu'à la fin de la transaction : deux créations simultanées obtiennent deux références distinctes (la seconde
// attend la première, puis voit sa fiche). Toujours au-delà de la plus grande référence déjà vue (`used`, lue dans la
// transaction après le verrou : fiches existantes, journal des fiches supprimées) : une référence n'est jamais réattribuée,
// et un compteur en retard (fiche créée hors compteur, base reprise) est avancé. Pas de 'use server' : aucune action
// appelable depuis le navigateur ; ne lit jamais la session.

/** Portée du compteur d'un préfixe de référence (distincte de la portée « A » des actions). */
export const referenceScope = (prefix: string) => `ref:${prefix}`;

/**
 * Prochaine référence « préfixe + n » (n complété à `pad` chiffres), dans la transaction de création (une référence tirée
 * puis abandonnée par une transaction annulée revient au compteur ; tirée dans une transaction validée, elle est perdue,
 * jamais réattribuée). `used` : références déjà attribuées de ce préfixe (fiches et journal), lues dans `tx`.
 */
export async function nextReference(tx: DbOrTx, o: { prefix: string; pad?: number; used: (tx: DbOrTx) => Promise<string[]> }): Promise<string> {
  const scope = referenceScope(o.prefix);
  const [row] = await tx.insert(t.actionCounters).values({ scope, last: 1 })
    .onConflictDoUpdate({ target: t.actionCounters.scope, set: { last: sql`${t.actionCounters.last} + 1` } })
    .returning({ last: t.actionCounters.last });
  const max = maxRefNumber(await o.used(tx), o.prefix);
  let n = row.last;
  if (n <= max) {
    n = max + 1;
    await tx.update(t.actionCounters).set({ last: n }).where(eq(t.actionCounters.scope, scope));
  }
  return `${o.prefix}${String(n).padStart(o.pad ?? 0, '0')}`;
}

/** Tables à référence texte (colonne `id`) et type d'entité de leur journal (fiches supprimées : référence jamais réattribuée). */
const REF_TABLES = {
  contractor: t.contractors, prevention_plan: t.preventionPlans, permit: t.permits, document: t.documents,
  waste_stream: t.wasteStreams, certification: t.certifications, event: t.events,
  // CNF-11 (paquet 13) : demandes de changement « MC-001 ».
  change_request: t.changeRequests,
  // VG-01 : études de sécurité des procédés « ES-001 ».
  process_safety_study: t.processSafetyStudies,
} as const;
export type RefEntity = keyof typeof REF_TABLES;

/** Références déjà attribuées d'un préfixe : identifiants des fiches de `entity` et identifiants de son journal. */
export function usedIds(entity: RefEntity, prefix: string) {
  return async (tx: DbOrTx): Promise<string[]> => {
    const table = REF_TABLES[entity] as typeof t.documents; // colonne `id` texte, seule lue
    const rows = await tx.select({ id: table.id }).from(table).where(like(table.id, `${prefix}%`));
    const logged = await tx.selectDistinct({ id: t.changeLog.entityId }).from(t.changeLog)
      .where(and(eq(t.changeLog.entityType, entity), like(t.changeLog.entityId, `${prefix}%`)));
    return [...rows.map((r) => r.id), ...logged.map((r) => r.id)];
  };
}

/** Prochaine référence d'une fiche `entity` (nextReference sur ses fiches et son journal). */
export const nextEntityReference = (tx: DbOrTx, entity: RefEntity, prefix: string, pad = 0) =>
  nextReference(tx, { prefix, pad, used: usedIds(entity, prefix) });
