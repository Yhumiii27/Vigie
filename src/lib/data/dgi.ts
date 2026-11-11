import 'server-only';
import { cache } from 'react';
import { asc, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { fmtDayMonth, parisDay, toParisLocal } from '../dates';
import { ALL_SITES, type TodoItem } from '../domain';
import { DGI_STATES, canHandleDgi, canReadDgi, canRecordDgi, canSignDgi, dgiHref, dgiState, needsMeasures, type DgiStateKey } from '../rules/dgi';
import { loadPeople } from '../queries';
import { getSession, inPerimeter, siteFilter } from '../session';
import { today } from '@/lib/today';
import { loadQhseLeads } from './leads';

// Registre des dangers graves et imminents (CNF-01) : lecture réservée à l'animateur QHSE, à la direction et aux membres du
// CSE (canReadDgi) ; noms des travailleurs exposés montrés à ces seuls lecteurs. Échéances : avis sans mesures de
// l'employeur, au responsable QHSE du site et à la direction, dues le jour de l'alerte.

export type DgiNoticeView = {
  id: number; number: number; siteId: string;
  reportedAt: string; workstations: string; danger: string; exposedWorkers: string; representativeName: string;
  eventId: string | null;
  state: DgiStateKey; stateLabel: string; stateTone: (typeof DGI_STATES)[DgiStateKey]['tone'];
  signed: { at: string; by: string } | null;
  measures: { text: string; at: string; by: string } | null;
  closed: { at: string; by: string } | null;
  cancelled: { on: string; by: string; reason: string } | null;
  createdBy: string;
};

/**
 * Registre d'un site (`siteId`, sinon le site sélectionné) pour un lecteur du registre ; null si la personne n'est pas
 * lectrice. Sans site résolu (« Tous les sites ») : choix du registre parmi les sites du périmètre.
 */
export async function loadDgiRegister(siteId: string | null) {
  const session = await getSession();
  if (!canReadDgi(session)) return null;
  const sites = session.siteOptions.filter((s) => s.id !== ALL_SITES);
  const rights = { record: canRecordDgi(session), sign: canSignDgi(session), handle: canHandleDgi(session) };
  const wanted = siteId ?? (session.site.id !== ALL_SITES ? session.site.id : null);
  if (!wanted || !inPerimeter(session.allowedSiteIds, wanted)) return { site: null, sites, notices: [] as DgiNoticeView[], rights, unknown: !!siteId };
  const db = await getDb();
  const [[site], rows, people] = await Promise.all([
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites).where(eq(t.sites.id, wanted)),
    db.select().from(t.dgiNotices).where(eq(t.dgiNotices.siteId, wanted)).orderBy(asc(t.dgiNotices.number)),
    loadPeople(),
  ]);
  if (!site) return { site: null, sites, notices: [] as DgiNoticeView[], rights, unknown: true };
  const name = (id: string | null) => (id ? people.get(id)?.name ?? id : '—');
  const at = (d: Date) => toParisLocal(d);
  const notices = rows.map((n): DgiNoticeView => {
    const state = dgiState(n);
    return {
      id: n.id, number: n.number, siteId: n.siteId, reportedAt: at(n.reportedAt), workstations: n.workstations, danger: n.danger,
      exposedWorkers: n.exposedWorkers, representativeName: n.representativeName, eventId: n.eventId,
      state, stateLabel: DGI_STATES[state].label, stateTone: DGI_STATES[state].tone,
      signed: n.signedAt ? { at: at(n.signedAt), by: name(n.signedById) } : null,
      measures: n.measures && n.measuresAt ? { text: n.measures, at: at(n.measuresAt), by: name(n.measuresById) } : null,
      closed: n.closedAt ? { at: at(n.closedAt), by: name(n.closedById) } : null,
      cancelled: n.cancelledAt ? { on: parisDay(n.cancelledAt), by: name(n.cancelledById), reason: n.cancelReason ?? '' } : null,
      createdBy: name(n.createdById),
    };
  });
  return { site: { id: site.id, label: site.label.split(' — ')[0] }, sites, notices, rights, unknown: false };
}

/**
 * Échéances du registre (CNF-01), sur tout le périmètre (TDB-05) : avis ouvert sans mesures de l'employeur, en retard dès
 * le jour de l'alerte, au responsable QHSE du site et à la direction. Rien pour une personne qui ne lit pas le registre.
 * Intitulé sans nom ni description du danger ; clé `dgi|<id>`.
 */
export const loadDgiSignals = cache(async (): Promise<{ todo: TodoItem[] }> => {
  const session = await getSession();
  if (!canReadDgi(session)) return { todo: [] };
  const [db, keep, leads] = await Promise.all([getDb(), siteFilter('perimeter'), loadQhseLeads()]);
  const rows = await db.select().from(t.dgiNotices).where(isNull(t.dgiNotices.cancelledAt));
  const now = today();
  const todo: TodoItem[] = rows.filter((n) => keep(n.siteId) && needsMeasures(n)).map((n) => {
    const to = leads.forSite(n.siteId);
    const directors = leads.directors.filter((p) => !to.ownerIds.includes(p.id));
    const dueOn = parisDay(n.reportedAt);
    return {
      date: now, dueOn, overdue: true, tone: 'danger', kind: 'Danger grave et imminent', siteId: n.siteId,
      title: `Danger grave et imminent n° ${n.number} du ${fmtDayMonth(dueOn)} — mesures de l'employeur à consigner`,
      who: [to.who, ...directors.map((p) => p.name)].join(' · '),
      ownerIds: [...to.ownerIds, ...directors.map((p) => p.id)],
      href: dgiHref(n.siteId, n.id), key: `dgi|${n.id}`,
    };
  });
  return { todo };
});
