import 'server-only';
import { cache } from 'react';
import { and, asc, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { SITE_OPEN_KINDS, type SiteOpenCounts, type SiteOpenKind } from '../rules/site-transfer';
import { today } from '@/lib/today';
import { STEP_CLOSED, canApprove, type TodoItem } from '../domain';
import { hasLeft } from '../people';
import { loadPeople } from '../queries';
import { getSession, siteFilter } from '../session';
import { loadQhseLeads } from './leads';
import type { Option } from './options';
import { parisDay } from '@/lib/dates';
import { MATRIX_SITE_STATES, unavailableMessage, type MatrixSiteState } from '@/lib/foreign/labels';
import { readMatrixSites } from '@/lib/foreign/matrix';

/** Site tel que la fenêtre « Gérer les sites » l'affiche (actifs et archivés). */
export type SiteAdminRow = {
  id: string; label: string; sort: number; seveso: string | null;
  /** État du site dans Matrix au dernier rafraîchissement (actif, fermé, absent) ; null : jamais lu. */
  matrixState: MatrixSiteState | null;
  /** Responsable QHSE (people.id) ; null = poste vacant. */
  qhseLeadId: string | null;
  /** Droit local d'Alsace-Moselle : Vendredi saint et 26 décembre fériés (délai de déclaration CPAM, EVT-03). */
  alsaceMoselle: boolean;
  /** Nom du responsable QHSE ; « (sorti de l'effectif) » s'il a quitté l'entreprise. */
  qhseLead: string | null;
  /** Date d'archivage (AAAA-MM-JJ), null pour un site actif. */
  archivedOn: string | null;
  /** Nom de la personne qui a archivé le site. */
  archivedBy: string | null;
  archiveReason: string | null;
  /** TDB-08 : éléments ouverts du site (avertissement et transfert en masse avant l'archivage). */
  openItems: SiteOpenCounts;
};

/**
 * TDB-08 : identifiants des éléments ouverts d'un site, par type — événements non clôturés ni classés sans suite, actions
 * QSE ni Vérifiées ni Abandonnées, contrôles périodiques non archivés, plans de prévention ni clos ni annulés, permis
 * demandés ou délivrés. Lu par « Gérer les sites » (décompte) et par le transfert (archiveSite), dans sa transaction.
 */
export async function siteOpenItems(db: DbOrTx, siteIds?: readonly string[]): Promise<Record<SiteOpenKind, { id: string; siteId: string }[]>> {
  const of = (col: AnyPgColumn) => (siteIds ? [inArray(col, [...siteIds])] : []);
  const [events, actions, controls, plans, permits] = await Promise.all([
    db.select({ id: t.events.id, siteId: t.events.siteId }).from(t.events)
      .where(and(isNull(t.events.dismissedAt), lt(t.events.step, STEP_CLOSED), ...of(t.events.siteId))),
    db.select({ id: t.actions.id, siteId: t.actions.siteId }).from(t.actions)
      .where(and(notInArray(t.actions.status, ['verifiee', 'abandonnee']), ...of(t.actions.siteId))),
    db.select({ id: t.controls.id, siteId: t.controls.siteId }).from(t.controls)
      .where(and(isNull(t.controls.archivedAt), ...of(t.controls.siteId))),
    db.select({ id: t.preventionPlans.id, siteId: t.preventionPlans.siteId }).from(t.preventionPlans)
      .where(and(notInArray(t.preventionPlans.status, ['clos', 'annule']), ...of(t.preventionPlans.siteId))),
    db.select({ id: t.permits.id, siteId: t.permits.siteId }).from(t.permits)
      .where(and(inArray(t.permits.status, ['demande', 'delivre']), ...of(t.permits.siteId))),
  ]);
  const keep = (rows: { id: string | number; siteId: string | null }[]) => rows.filter((r): r is { id: string | number; siteId: string } => !!r.siteId).map((r) => ({ id: String(r.id), siteId: r.siteId }));
  return { events: keep(events), actions: keep(actions), controls: keep(controls), plans: keep(plans), permits: keep(permits) };
}

/** Tous les sites, actifs d'abord puis archivés, dans l'ordre d'affichage (administration des sites, animateur QHSE et direction). */
export const loadSiteAdmin = cache(async (): Promise<SiteAdminRow[]> => {
  const db = await getDb();
  const now = today();
  const [sites, people, open] = await Promise.all([db.select().from(t.sites).orderBy(sql`${t.sites.archivedAt} asc nulls first`, asc(t.sites.sort)), loadPeople(), siteOpenItems(db)]);
  return sites.map((s) => {
    const lead = s.qhseLeadId ? people.get(s.qhseLeadId) : undefined;
    const openItems = Object.fromEntries(SITE_OPEN_KINDS.map((k) => [k, open[k].filter((r) => r.siteId === s.id).length])) as SiteOpenCounts;
    return {
      openItems,
      id: s.id, label: s.label, sort: s.sort, seveso: s.seveso, matrixState: s.matrixState as MatrixSiteState | null,
      qhseLeadId: s.qhseLeadId,
      alsaceMoselle: s.alsaceMoselle,
      qhseLead: lead ? `${lead.name}${hasLeft(lead, now) ? " (sorti de l'effectif)" : ''}` : null,
      archivedOn: s.archivedAt ? parisDay(s.archivedAt) : null,
      archivedBy: s.archivedById ? people.get(s.archivedById)?.name ?? s.archivedById : null,
      archiveReason: s.archiveReason,
    };
  });
});

/**
 * Sites de Matrix proposés au suivi (« Gérer les sites », amorçage) : actifs dans matrix.pub_sites et pas encore suivis
 * par Vigie (archivés compris : ils se réactivent). Source indisponible : `message`, aucun choix.
 */
export const loadMatrixSiteChoices = cache(async (): Promise<{ choices: Option[]; message: string | null }> => {
  const db = await getDb();
  const [read, followed] = await Promise.all([readMatrixSites(db), db.select({ id: t.sites.id }).from(t.sites)]);
  if (!read.ok) return { choices: [], message: unavailableMessage('sites') };
  const known = new Set(followed.map((s) => s.id));
  return {
    choices: read.rows.filter((s) => s.active && !known.has(s.code)).map((s) => [s.code, `${s.label} (${s.code})`] as Option),
    message: null,
  };
});

/** Personnes proposées comme responsable QHSE d'un site : présentes à l'effectif, animateurs QHSE d'abord. */
export const loadQhseLeadOptions = cache(async (): Promise<Option[]> => {
  const now = today();
  const people = [...(await loadPeople()).values()].filter((p) => !hasLeft(p, now));
  const rank = (p: { lastRole: string | null }) => (p.lastRole === 'Animateur QHSE' ? 0 : 1);
  return people.sort((a, b) => rank(a) - rank(b)).map((p) => [p.id, p.job ? `${p.name} — ${p.job}` : p.name] as Option);
});

/**
 * Échéance « responsable QHSE à désigner » (TDB-01) : un site actif du périmètre (TDB-05) sans responsable, ou dont le
 * responsable a quitté l'effectif. Pour l'animateur QHSE et la direction seulement (qui règlent le responsable dans
 * « Gérer les sites… »).
 */
export const loadSiteSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const { role } = await getSession();
  if (!canApprove(role)) return { todo: [] };
  const db = await getDb();
  const [sites, leads, keep] = await Promise.all([
    db.select({ id: t.sites.id, label: t.sites.label, matrixState: t.sites.matrixState }).from(t.sites).where(isNull(t.sites.archivedAt)).orderBy(asc(t.sites.sort)),
    loadQhseLeads(),
    siteFilter('perimeter'),
  ]);
  const now = today();
  const ownerIds = leads.approvers.map((p) => p.id);
  const mine = sites.filter((s) => keep(s.id));
  return {
    todo: [
      ...mine.filter((s) => !leads.lead(s.id)).map((s) => ({
        date: now, kind: 'Site', tone: 'warn', key: `site-lead|${s.id}`, ownerIds, siteId: s.id,
        title: `${s.label} — responsable QHSE à désigner (Gérer les sites…)`, who: 'Animateur QHSE / Direction',
      } satisfies TodoItem)),
      // D14 : site encore suivi par Vigie mais fermé dans Matrix (ou retiré de sa liste) — « ne plus suivre » à décider.
      ...mine.filter((s) => s.matrixState === 'ferme' || s.matrixState === 'absent').map((s) => ({
        date: now, kind: 'Site', tone: 'warn', key: `site-matrix|${s.id}|${s.matrixState}`, ownerIds, siteId: s.id,
        title: `${s.label} — ${MATRIX_SITE_STATES[s.matrixState as MatrixSiteState].label.toLowerCase()} : ne plus suivre ? (Gérer les sites…)`,
        who: 'Animateur QHSE / Direction',
      } satisfies TodoItem)),
    ],
  };
});
