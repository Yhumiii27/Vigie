import 'server-only';
import { cache } from 'react';
import { asc } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { toParisLocal } from '../dates';
import { CONTEXT_KINDS, CONTEXT_KIND_KEYS, type ContextKind } from '../domain';
import { loadPeople } from '../queries';

// ─── Contexte du système de management (CNF-05) ─────────────────────────────

export type ContextItemView = {
  id: number; kind: ContextKind; label: string; detail: string; treatment: string; createdOn: string;
  archived: { on: string; by: string; reason: string } | null;
};

/** Éléments du contexte (commun à l'entreprise), par nature dans l'ordre de CONTEXT_KINDS ; archivés à part. */
export const loadContext = cache(async () => {
  const db = await getDb();
  const [rows, people] = await Promise.all([
    db.select().from(t.contextItems).orderBy(asc(t.contextItems.sort), asc(t.contextItems.id)),
    loadPeople(),
  ]);
  const name = (id: string | null) => (id ? people.get(id)?.name ?? id : '—');
  const views: ContextItemView[] = rows.filter((r) => r.kind in CONTEXT_KINDS).map((r) => ({
    id: r.id, kind: r.kind as ContextKind, label: r.label, detail: r.detail, treatment: r.treatment, createdOn: toParisLocal(r.createdAt).slice(0, 10),
    archived: r.archivedAt ? { on: toParisLocal(r.archivedAt).slice(0, 10), by: name(r.archivedById), reason: r.archiveReason ?? '' } : null,
  }));
  const active = views.filter((v) => !v.archived);
  return {
    groups: CONTEXT_KIND_KEYS.map((kind) => ({ kind, ...CONTEXT_KINDS[kind], items: active.filter((v) => v.kind === kind) })),
    archived: views.filter((v) => v.archived),
  };
});
export type ContextData = Awaited<ReturnType<typeof loadContext>>;
