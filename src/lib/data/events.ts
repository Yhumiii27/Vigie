import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { advanceBlocker, type AttachmentItem } from '@/components/events/shared';
import { today } from '../dates';
import { EVENT_TYPES, type EventType } from '../domain';
import { actionView, eventView, loadEvents, loadPeople } from '../queries';
import { getSession } from '../session';
import { attachmentUrl } from '../uploads';

// ─── Signalements et événements ─────────────────────────────────────────────

/** Pièces jointes d'un événement (photos du signalement, constats, rapports…), les plus anciennes d'abord. */
export async function loadEventAttachments(eventId: string): Promise<AttachmentItem[]> {
  const db = await getDb();
  const rows = await db.select().from(t.attachments)
    .where(and(eq(t.attachments.entityType, 'event'), eq(t.attachments.entityId, eventId)))
    .orderBy(asc(t.attachments.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.fileName, mime: r.mimeType, size: r.size, url: attachmentUrl(r.id), isImage: r.mimeType.startsWith('image/') }));
}

/**
 * Fiche d'un événement du site sélectionné : vue, actions liées, contenus d'analyse, pièces jointes
 * et éventuel blocage du passage à l'étape suivante.
 */
export async function loadEventDetail(id: string) {
  const db = await getDb();
  const now = today();
  const [people, events] = await Promise.all([loadPeople(), loadEvents()]);
  const e = events.find((x) => x.id === id);
  if (!e) return null;
  // Les actions liées sont lues sans filtre de site : elles suivent l'événement.
  const [actions, analyses, attachments] = await Promise.all([
    db.select().from(t.actions).where(eq(t.actions.eventId, e.id)),
    db.select().from(t.eventAnalyses).where(eq(t.eventAnalyses.eventId, e.id)),
    loadEventAttachments(e.id),
  ]);
  return {
    event: eventView(e, people, now),
    actions: actions.sort((a, b) => a.id.localeCompare(b.id, 'fr', { numeric: true })).map((a) => ({ ...actionView(a, people, now), originKey: a.origin })),
    analyses: Object.fromEntries(analyses.map((a) => [a.method, a.content])) as Record<string, unknown>,
    attachments,
    blocker: advanceBlocker(e.step, actions),
  };
}
export type EventDetail = NonNullable<Awaited<ReturnType<typeof loadEventDetail>>>;

/**
 * Signalements nominatifs déclarés par l'utilisateur courant (site sélectionné).
 * Les signalements anonymes ne portent pas de déclarant : ils ne peuvent pas, par conception, être retrouvés ici.
 */
export async function loadMyReports() {
  const [{ user }, events] = await Promise.all([getSession(), loadEvents()]);
  return events
    .filter((e) => !e.anonymous && e.declarant === user.name)
    .map((e) => {
      const type = EVENT_TYPES[e.type as EventType];
      return { id: e.id, occurredOn: e.occurredOn, title: e.title, location: e.location, step: e.step, typeLabel: type.label, typeTone: type.tone, typeIcon: type.icon };
    });
}
export type MyReport = Awaited<ReturnType<typeof loadMyReports>>[number];
