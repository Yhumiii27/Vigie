'use server';

import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadVisibleEvents } from '@/lib/data/events';
import { canSeeHealth } from '@/lib/domain';
import { loadPeople } from '@/lib/queries';
import { getSession } from '@/lib/session';

// Consultations d'un événement (SEC-11), lues à l'ouverture du bloc « Consultations » de la fiche : données de santé d'un
// AT affichées et pièces jointes de l'événement ouvertes. Réservé aux rôles habilités aux données de santé (canSeeHealth),
// pour un événement visible sur le site sélectionné. Lecture seule, rien n'est journalisé.

export type AccessEntry = { id: number; at: string; who: string; what: string };

const NOT_FOUND = 'Journal des consultations introuvable.';
const MAX_ENTRIES = 200;

export async function loadEventAccesses(eventId: string): Promise<{ entries: AccessEntry[] } | { error: string }> {
  if (typeof eventId !== 'string' || !eventId || eventId.length > 64) return { error: NOT_FOUND };
  const { role } = await getSession();
  if (!canSeeHealth(role)) return { error: NOT_FOUND };
  if (!(await loadVisibleEvents()).some((e) => e.id === eventId)) return { error: NOT_FOUND };
  const db = await getDb();
  const [rows, people] = await Promise.all([
    db.select().from(t.accessLog)
      .where(and(eq(t.accessLog.entityType, 'event'), eq(t.accessLog.entityId, eventId), or(eq(t.accessLog.kind, 'sante'), eq(t.accessLog.kind, 'fichier'))))
      .orderBy(desc(t.accessLog.at), desc(t.accessLog.id)).limit(MAX_ENTRIES),
    loadPeople(),
  ]);
  const fileIds = [...new Set(rows.map((r) => r.attachmentId).filter((id): id is string => !!id))];
  const files = fileIds.length
    ? new Map((await db.select({ id: t.attachments.id, fileName: t.attachments.fileName }).from(t.attachments).where(inArray(t.attachments.id, fileIds))).map((f) => [f.id, f.fileName]))
    : new Map<string, string>();
  return {
    entries: rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      who: r.personId ? people.get(r.personId)?.name ?? r.personId : '—',
      what: r.kind === 'sante' ? 'Fiche consultée avec ses données de santé'
        : `${r.health ? 'Pièce médicale' : 'Pièce jointe'} ouverte${r.attachmentId ? ` · ${files.get(r.attachmentId) ?? 'pièce retirée depuis'}` : ''}`,
    })),
  };
}
