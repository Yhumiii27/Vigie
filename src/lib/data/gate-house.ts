import 'server-only';
import { asc, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { addDays, parisDay } from '@/lib/dates';
import { readPlannedPresences } from '@/lib/foreign/cursus';
import { unavailableMessage } from '@/lib/foreign/labels';
import { gateHouseList, canReadGateHouse, type GateHouseList } from '@/lib/rules/gate-house';
import { getSession, siteFilter } from '@/lib/session';
import { today } from '@/lib/today';

// Liste du poste de garde (PRV-25, décision CV-10) : présences prévues de cursus.pub_presences_prevues sur le site
// sélectionné (ou tous les sites du périmètre), noms d'après le cache people (matricule Cursus, puis matricule de site :
// gatePersonResolver), plans de prévention et permis
// rapprochés (src/lib/rules/gate-house.ts). Lecteurs : canReadGateHouse (animateur QHSE, direction, encadrement) ;
// null pour les autres rôles. Source indisponible : liste vide et message (bandeau), jamais une erreur de page.

export type GateHouse = { list: GateHouseList; horizon: number; message: string | null; siteCount: number };

export async function loadGateHouse(horizon: number): Promise<GateHouse | null> {
  const session = await getSession();
  if (!canReadGateHouse(session.role)) return null;
  const db = await getDb();
  const now = today();
  const to = addDays(now, horizon);
  const [inSelected, inPerimeter, read] = await Promise.all([siteFilter('site'), siteFilter('perimeter'), readPlannedPresences(db, now, to)]);
  const sites = (await db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites).where(isNull(t.sites.archivedAt)).orderBy(asc(t.sites.sort)))
    .filter((s) => inSelected(s.id) && inPerimeter(s.id));
  const empty: GateHouseList = { arrivals: [], departures: [], cancelled: [], from: now, to };
  if (!read.ok) return { list: empty, horizon, message: unavailableMessage('presences'), siteCount: sites.length };
  const [people, plans, permits] = await Promise.all([
    db.select({ matricule: t.people.matricule, siteMatricule: t.people.siteMatricule, name: t.people.name }).from(t.people)
      .where(or(isNotNull(t.people.matricule), isNotNull(t.people.siteMatricule))),
    db.select({ id: t.preventionPlans.id, siteId: t.preventionPlans.siteId, company: t.contractors.name, from: t.preventionPlans.startOn, to: t.preventionPlans.endOn })
      .from(t.preventionPlans).innerJoin(t.contractors, eq(t.contractors.id, t.preventionPlans.contractorId)).where(ne(t.preventionPlans.status, 'annule')),
    db.select({ id: t.permits.id, siteId: t.permits.siteId, company: t.contractors.name, validFrom: t.permits.validFrom, validTo: t.permits.validTo })
      .from(t.permits).innerJoin(t.contractors, eq(t.contractors.id, t.permits.contractorId)).where(ne(t.permits.status, 'annule')),
  ]);
  const list = gateHouseList({
    presences: read.rows, today: now, to,
    sites: new Map(sites.map((s) => [s.id, s.label])),
    people,
    plans,
    permits: permits.map((p) => ({ id: p.id, siteId: p.siteId, company: p.company, from: parisDay(p.validFrom), to: parisDay(p.validTo) })),
  });
  return { list, horizon, message: null, siteCount: sites.length };
}
