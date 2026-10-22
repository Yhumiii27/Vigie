import 'server-only';
import { inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  EVENT_DISMISSED, EVENT_STEPS, EVENT_TYPES, STEP_CLOSED, canSee, canSeeEventType, isEmployee, type EventType, type Tone,
} from '../domain';
import { getSession, inPerimeter } from '../session';

/**
 * Événement rattaché à une fiche d'un autre module (EVT-14 : contrôle périodique, document maîtrisé), sans aucune donnée
 * de santé : référence, type, intitulé, date, étape. `href` : fiche de l'événement, pour les rôles qui ouvrent l'écran.
 */
export type LinkedEvent = {
  id: string; type: string; typeLabel: string; tone: Tone; title: string; occurredOn: string; step: string; closed: boolean; href: string | null;
};

/**
 * Événements rattachés par `events.control_id` ou `events.document_id`, par identifiant de la fiche, le plus récent
 * d'abord. Cloisonnement : sites du périmètre de la personne ; maladies professionnelles réservées aux rôles habilités aux
 * données de santé (canSeeEventType) ; rien pour le Salarié (signalements nominatifs de collègues). Seules des colonnes
 * sans donnée de santé sont lues.
 */
export async function loadLinkedEvents(by: 'control' | 'document', ids: readonly (string | number)[]): Promise<Map<string, LinkedEvent[]>> {
  const out = new Map<string, LinkedEvent[]>();
  const session = await getSession();
  if (!ids.length || isEmployee(session.role)) return out;
  const db = await getDb();
  const where = by === 'control' ? inArray(t.events.controlId, [...new Set(ids.map(Number))]) : inArray(t.events.documentId, [...new Set(ids.map(String))]);
  const rows = await db.select({
    id: t.events.id, type: t.events.type, title: t.events.title, occurredOn: t.events.occurredOn, step: t.events.step, dismissedAt: t.events.dismissedAt,
    siteId: t.events.siteId, controlId: t.events.controlId, documentId: t.events.documentId,
  }).from(t.events).where(where);
  const link = canSee(session.role, 'events');
  rows
    .filter((e) => canSeeEventType(session.role, e.type) && inPerimeter(session.allowedSiteIds, e.siteId))
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id, 'fr', { numeric: true }))
    .forEach((e) => {
      const key = String(by === 'control' ? e.controlId : e.documentId);
      const def = EVENT_TYPES[e.type as EventType];
      const list = out.get(key) ?? [];
      list.push({
        id: e.id, type: e.type, typeLabel: def?.label ?? e.type, tone: def?.tone ?? 'neutral', title: e.title, occurredOn: e.occurredOn,
        step: e.dismissedAt ? EVENT_DISMISSED : EVENT_STEPS[e.step] ?? '', closed: !!e.dismissedAt || e.step >= STEP_CLOSED,
        href: link ? `/evenements?etat=tous&sel=${encodeURIComponent(e.id)}` : null,
      });
      out.set(key, list);
    });
  return out;
}
