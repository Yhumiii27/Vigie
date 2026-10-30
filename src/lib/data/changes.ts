import 'server-only';
import { cache } from 'react';
import { asc } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { today } from '@/lib/today';
import { addDays, fmtDate, parisDay } from '../dates';
import { CHANGE_KINDS, CHANGE_STATUS, TODO_HORIZON_DAYS, type ChangeKind, type ChangeStatus, type TodoItem, type Tone } from '../domain';
import { hasLeft } from '../people';
import { loadPeople, loadSiteRows } from '../queries';
import { siteFilter } from '../session';
import { entityVersions } from '@/server/versions';
import { loadQhseLeads } from './leads';

// Gestion des changements (CNF-11, ISO 9001 §6.3 et §8.5.6, ISO 45001 §8.1.3) : demandes de changement, décision du
// service QHSE, mise en œuvre. Carte de l'écran Audits (lecteurs de l'écran ; saisie : canEdit(role, 'audits')).

export type ChangeView = {
  id: string; siteId: string | null; siteLabel: string; kind: ChangeKind; kindLabel: string; title: string; description: string;
  rationale: string; impacts: string; pilotId: string | null; pilot: string; plannedOn: string | null;
  status: ChangeStatus; statusLabel: string; tone: Tone;
  decided: { on: string; by: string; note: string } | null;
  done: { on: string; note: string } | null;
  createdOn: string; createdBy: string;
  cancelled: { on: string; by: string; reason: string } | null;
  /** Mise en œuvre prévue dépassée (acceptée, non réalisée). */
  late: boolean;
};

const readChanges = cache(async () => {
  const db = await getDb();
  const [rows, people, sites] = await Promise.all([
    db.select().from(t.changeRequests).orderBy(asc(t.changeRequests.createdAt), asc(t.changeRequests.id)),
    loadPeople(),
    loadSiteRows(),
  ]);
  const now = today();
  const name = (id: string | null) => (id ? people.get(id)?.name ?? '' : '');
  const siteLabel = new Map(sites.map((s) => [s.id, s.label.split(' — ')[0]]));
  const views: ChangeView[] = rows.map((r) => {
    const status = (Object.hasOwn(CHANGE_STATUS, r.status) ? r.status : 'demandee') as ChangeStatus;
    const kind = (Object.hasOwn(CHANGE_KINDS, r.kind) ? r.kind : 'autre') as ChangeKind;
    const late = !r.cancelledAt && status === 'acceptee' && !!r.plannedOn && r.plannedOn < now;
    return {
      id: r.id, siteId: r.siteId, siteLabel: r.siteId ? siteLabel.get(r.siteId) ?? r.siteId : 'Tous les sites', kind, kindLabel: CHANGE_KINDS[kind].label,
      title: r.title, description: r.description, rationale: r.rationale, impacts: r.impacts, pilotId: r.pilotId, pilot: name(r.pilotId), plannedOn: r.plannedOn,
      status, statusLabel: r.cancelledAt ? 'Annulée' : late ? 'Mise en œuvre en retard' : CHANGE_STATUS[status].label,
      tone: r.cancelledAt ? 'neutral' : late ? 'danger' : CHANGE_STATUS[status].tone,
      decided: r.decidedOn ? { on: r.decidedOn, by: name(r.decidedById), note: r.decisionNote ?? '' } : null,
      done: r.doneOn ? { on: r.doneOn, note: r.doneNote ?? '' } : null,
      createdOn: parisDay(r.createdAt), createdBy: name(r.createdById),
      cancelled: r.cancelledAt ? { on: parisDay(r.cancelledAt), by: name(r.cancelledById), reason: r.cancelReason ?? '' } : null,
      late,
    };
  });
  return { now, views, people };
});

/** Demandes de changement du site sélectionné (les demandes communes à l'entreprise valent pour tous les sites), la plus récente d'abord. */
export async function loadChanges() {
  const [{ views, now }, keep, db] = await Promise.all([readChanges(), siteFilter('site'), getDb()]);
  const rows = views.filter((v) => keep(v.siteId)).reverse();
  const versions = Object.fromEntries(await entityVersions(db, 'change_request', rows.map((r) => r.id)));
  return { now, rows, versions };
}

/**
 * Échéances des changements (CNF-11), sur tout le périmètre (TDB-05) : demande à évaluer (responsables QHSE du site, datée
 * de la demande) ; changement accepté dont la mise en œuvre prévue tombe dans l'horizon ou est dépassée (pilote présent,
 * sinon responsable QHSE du site). Clé `changement|<id>|<état>`.
 */
export const loadChangeSignals = cache(async (): Promise<{ todo: TodoItem[] }> => {
  const [{ views, now, people }, keep, leads] = await Promise.all([readChanges(), siteFilter('perimeter'), loadQhseLeads()]);
  const horizon = addDays(now, TODO_HORIZON_DAYS);
  const href = (id: string) => `/audits?changement=${encodeURIComponent(id)}#changements`;
  const todo: TodoItem[] = [];
  views.filter((v) => !v.cancelled && keep(v.siteId)).forEach((v) => {
    if (v.status === 'demandee') {
      const to = leads.forSite(v.siteId);
      todo.push({
        date: v.createdOn, dueOn: v.createdOn, kind: 'Gestion des changements', tone: 'warn', title: `${v.id} · ${v.title} — demande de changement à évaluer`,
        key: `changement|${v.id}|demandee`, who: to.who, ownerIds: to.ownerIds, siteId: v.siteId, href: href(v.id),
      });
    } else if (v.status === 'acceptee' && v.plannedOn && v.plannedOn <= horizon) {
      const pilot = v.pilotId ? people.get(v.pilotId) : undefined;
      const to = pilot && !hasLeft(pilot, now) ? { who: pilot.name, ownerIds: [pilot.id] } : leads.forSite(v.siteId);
      todo.push({
        date: v.late ? now : v.plannedOn, dueOn: v.plannedOn, kind: 'Gestion des changements', tone: v.late ? 'danger' : 'warn', overdue: v.late,
        title: `${v.id} · ${v.title} — ${v.late ? `mise en œuvre prévue le ${fmtDate(v.plannedOn)}, à constater` : `mise en œuvre prévue le ${fmtDate(v.plannedOn)}`}`,
        key: `changement|${v.id}|acceptee`, who: to.who, ownerIds: to.ownerIds, siteId: v.siteId, href: href(v.id),
      });
    }
  });
  return { todo };
});
