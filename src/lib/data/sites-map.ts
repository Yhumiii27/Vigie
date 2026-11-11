import 'server-only';
import { getDb, schema as t } from '@/db';
import { readMatrixSiteCoordinates } from '@/lib/foreign/matrix';
import { unavailableMessage } from '@/lib/foreign/labels';
import { isLate } from '../action-rules';
import { daysBetween } from '../dates';
import { today } from '@/lib/today';
import { isOpen, loadActions, loadEvents, loadSiteRows, workforceAccident } from '../queries';
import { parseCoordinates, placeSites, type MapSite } from '../rules/sites-map';
import { currentSiteId, getSession, inPerimeter } from '../session';
import { shortSiteLabel } from './todo';

/**
 * Carte des sites (PRV-24) sous « Tous les sites » : sites suivis actifs du périmètre, placés d'après matrix.pub_sites
 * (latitude, longitude ; lues à l'affichage), avec leurs indicateurs calculés sur les mêmes données que le tableau de bord
 * (événements ouverts, actions en retard, jours sans accident de l'effectif avec arrêt, plans de prévention ouverts).
 * null quand un site précis est sélectionné. Matrix indisponible : tous les sites listés sous la carte, avec le message.
 */
export async function loadSitesMap() {
  const [site, { allowedSiteIds }] = await Promise.all([currentSiteId(), getSession()]);
  if (site !== null) return null;
  const db = await getDb();
  const now = today();
  const [sites, coords, events, actions, plans] = await Promise.all([
    loadSiteRows(),
    readMatrixSiteCoordinates(db),
    loadEvents(),
    loadActions(),
    db.select({ siteId: t.preventionPlans.siteId, status: t.preventionPlans.status }).from(t.preventionPlans),
  ]);
  const byCode = new Map(coords.ok ? coords.rows.map((c) => [c.code, parseCoordinates(c.latitude, c.longitude)]) : []);
  const followed = sites.filter((s) => !s.archivedAt && inPerimeter(allowedSiteIds, s.id));
  const rows: MapSite[] = followed.map((s) => {
    const lastArret = events.find((e) => e.siteId === s.id && workforceAccident(e) && e.injury === 'arret');
    return {
      id: s.id,
      label: shortSiteLabel(s.label),
      coordinates: byCode.get(s.id) ?? null,
      indicators: {
        openEvents: events.filter((e) => e.siteId === s.id && isOpen(e)).length,
        lateActions: actions.filter((a) => a.siteId === s.id && isLate(a, now)).length,
        daysWithoutAccident: lastArret ? daysBetween(lastArret.occurredOn, now) : null,
        openPlans: plans.filter((p) => p.siteId === s.id && p.status !== 'clos' && p.status !== 'annule').length,
      },
    };
  });
  return { ...placeSites(rows), all: rows, message: coords.ok ? null : unavailableMessage('sites') };
}
