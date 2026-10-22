import { and, count, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import * as t from '../schema';
import type { SeedTx } from './types';

// Jeu de démonstration de la vue pub_controles (demande de Crucible, migration 0014) : code commun d'équipement du banc
// d'essais BE-1, moyen d'essais partagé (zone d'essais du site B), saisi dans la fiche du contrôle et journalisé.

const BENCH = "Banc d'essais BE-1 — matériel ATEX";
export const DEMO_EQUIPMENT_CODE = 'BE-1';

/**
 * Remplit (une seule fois) le code d'équipement de démonstration : jeu neuf (dans sa transaction) ou base de
 * démonstration antérieure à la migration 0014 (upgradeDemo). Rien si un contrôle porte déjà un code ou si un code a
 * déjà été saisi puis retiré (entrée « Code équipement » au journal d'un contrôle) : un choix fait ensuite n'est jamais
 * écrasé.
 */
export async function seedControlCodes(tx: SeedTx) {
  const [coded] = await tx.select({ n: count() }).from(t.controls).where(isNotNull(t.controls.equipmentCode));
  const [touched] = await tx.select({ n: count() }).from(t.changeLog)
    .where(and(eq(t.changeLog.entityType, 'control'), sql`${t.changeLog.details}::text like '%Code équipement%'`));
  if (coded.n > 0 || touched.n > 0) return;
  const [bench] = await tx.select({ id: t.controls.id }).from(t.controls)
    .where(and(eq(t.controls.equipment, BENCH), isNull(t.controls.equipmentCode), isNull(t.controls.archivedAt)));
  if (!bench) return;
  await tx.update(t.controls).set({ equipmentCode: DEMO_EQUIPMENT_CODE }).where(eq(t.controls.id, bench.id));
  await tx.insert(t.changeLog).values({
    entityType: 'control', entityId: String(bench.id), action: 'update', summary: 'Contrôle modifié', byId: 'clefevre',
    at: new Date('2026-10-08T09:30:00+02:00'), details: [{ field: 'Code équipement', from: null, to: DEMO_EQUIPMENT_CODE }],
  });
}
