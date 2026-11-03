import 'server-only';
import { cache } from 'react';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { SOURCE_KEYS, SOURCES, type SourceKey, type SyncStatus } from '@/lib/foreign/labels';

/** Source lue chez un autre outil, telle que l'onglet « Connecteurs » l'affiche (lot 0 de M-02, INT-01). */
export type ConnectorRow = {
  key: SourceKey;
  /** Dernier passage : date (ISO), issue, nombres, message technique. */
  last: { at: string; status: SyncStatus; read: number; added: number; updated: number; removed: number; message: string | null } | null;
  /** Dernière lecture réussie (ISO) ; null : jamais lue. */
  lastOkAt: string | null;
};

/** Derniers passages de chaque source (journal sync_runs). Lecture seule, animateur QHSE et direction (« Gérer les sites »). */
export const loadConnectors = cache(async (): Promise<ConnectorRow[]> => {
  const db = await getDb();
  return Promise.all(SOURCE_KEYS.map(async (key) => {
    const source = SOURCES[key].view;
    const [runs, ok] = await Promise.all([
      db.select().from(t.syncRuns).where(eq(t.syncRuns.source, source)).orderBy(desc(t.syncRuns.startedAt), desc(t.syncRuns.id)).limit(1),
      db.select({ at: t.syncRuns.startedAt }).from(t.syncRuns).where(and(eq(t.syncRuns.source, source), eq(t.syncRuns.status, 'ok')))
        .orderBy(desc(t.syncRuns.startedAt), desc(t.syncRuns.id)).limit(1),
    ]);
    const last = runs[0];
    return {
      key,
      last: last ? {
        at: (last.finishedAt ?? last.startedAt).toISOString(), status: last.status as SyncStatus, read: last.read, added: last.added,
        updated: last.updated, removed: last.removed, message: last.message,
      } : null,
      lastOkAt: ok[0]?.at.toISOString() ?? null,
    };
  }));
});
