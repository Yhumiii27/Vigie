import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { ChangeEntry } from '@/components/ChangeLog';
import { loadPeople } from '../queries';

/**
 * Historique de plusieurs fiches d'un même type, en une requête : identifiant → entrées, les plus récentes d'abord.
 * Sérialisable pour les composants client (<ChangeLogList entries={…} />).
 */
export async function loadChangeLogs(entityType: string, ids: (string | number)[]): Promise<Map<string, ChangeEntry[]>> {
  const map = new Map<string, ChangeEntry[]>();
  if (!ids.length) return map;
  const db = await getDb();
  const [rows, people] = await Promise.all([
    db.select().from(t.changeLog)
      .where(and(eq(t.changeLog.entityType, entityType), inArray(t.changeLog.entityId, ids.map(String))))
      .orderBy(desc(t.changeLog.at), desc(t.changeLog.id)),
    loadPeople(),
  ]);
  rows.forEach((r) => {
    const list = map.get(r.entityId) ?? [];
    list.push({
      id: r.id,
      at: r.at.toISOString(),
      who: r.byId ? people.get(r.byId)?.name ?? r.byId : 'Vigie',
      action: r.action,
      summary: r.summary,
      reason: r.reason,
      details: Array.isArray(r.details) ? (r.details as ChangeEntry['details']) : [],
    });
    map.set(r.entityId, list);
  });
  return map;
}

/** Historique d'une seule fiche. */
export async function loadChangeLog(entityType: string, id: string | number): Promise<ChangeEntry[]> {
  return (await loadChangeLogs(entityType, [id])).get(String(id)) ?? [];
}
