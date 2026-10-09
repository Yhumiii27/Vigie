import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { addDays, daysBetween, fmtDate, today } from '../dates';
import { ACTION_COLUMNS, ORIGINS, type ActionColumn, type Tone } from '../domain';
import { actionView, loadActions, loadPeople, type ActionView, type Person } from '../queries';
import { loadFormOptions } from './options';

// ─── Plan d'actions ─────────────────────────────────────────────────────────

/** Action du plan, sérialisable pour les composants client (carte Kanban, fiche). */
export type PlanAction = {
  id: string;
  title: string;
  description: string | null;
  origin: { key: string; label: string; icon: string };
  originRef: string;
  eventId: string | null;
  siteId: string | null;
  /** Libellé complet du site (« Tous les sites » si l'action n'est pas rattachée à un site). */
  site: string;
  /** Libellé court pour les tableaux (« Site de [Ville A] »). */
  siteShort: string;
  pilotId: string;
  pilot: string;
  pilotInitials: string;
  dueOn: string;
  /** 03/10 */
  due: string;
  /** 03/10/2026 */
  dueLabel: string;
  late: boolean;
  lateDays: number;
  status: 'todo' | 'doing' | 'verify' | 'done';
  col: ActionColumn;
  statusLabel: string;
  tone: Tone;
  kind: 'C' | 'P';
  kindLabel: string;
  verifyDueOn: string | null;
  verifyDueLabel: string | null;
  /** Vérification d'efficacité attendue et dépassée. */
  verifyLate: boolean;
  efficacyNote: string | null;
  verifiedBy: string | null;
  closedOn: string | null;
  closedLabel: string | null;
};

const ALL_SITES_LABEL = 'Tous les sites';

// actionView remplace la clé d'origine par sa définition (libellé, icône) : on la retrouve par identité.
const originKey = (a: ActionView) => Object.entries(ORIGINS).find(([, o]) => o === a.origin)?.[0] ?? a.origin.label;

function toPlanAction(a: ActionView, people: Map<string, Person>, sites: Map<string, string>, now: string): PlanAction {
  const site = a.siteId ? sites.get(a.siteId) ?? a.siteId : ALL_SITES_LABEL;
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    origin: { key: originKey(a), label: a.origin.label, icon: a.origin.icon },
    originRef: a.originRef,
    eventId: a.eventId,
    siteId: a.siteId,
    site,
    siteShort: site.split(' — ')[0],
    pilotId: a.pilotId,
    pilot: a.pilot,
    pilotInitials: a.pilotInitials,
    dueOn: a.dueOn,
    due: a.due,
    dueLabel: fmtDate(a.dueOn),
    late: a.late,
    lateDays: a.late ? daysBetween(a.dueOn, now) : 0,
    status: a.status as PlanAction['status'],
    col: a.col,
    statusLabel: a.statusLabel,
    tone: a.tone,
    kind: a.kind === 'P' ? 'P' : 'C',
    kindLabel: a.kindLabel,
    verifyDueOn: a.verifyDueOn,
    verifyDueLabel: a.verifyDueOn ? fmtDate(a.verifyDueOn) : null,
    verifyLate: a.col === 'verify' && !!a.verifyDueOn && a.verifyDueOn < now,
    efficacyNote: a.efficacyNote,
    verifiedBy: a.verifiedById ? people.get(a.verifiedById)?.name ?? null : null,
    closedOn: a.closedOn,
    closedLabel: a.closedOn ? fmtDate(a.closedOn) : null,
  };
}

async function loadContext() {
  const [people, actions, options] = await Promise.all([loadPeople(), loadActions(), loadFormOptions()]);
  return { people, actions, sites: new Map(options.sites.map(([id, label]) => [id, label])), now: today() };
}

/**
 * Actions du site sélectionné : ouvertes, et clôturées depuis moins de 30 jours
 * (colonne « Clôturées · 30 j »). Triées de la plus récente à la plus ancienne.
 */
export async function loadActionPlan() {
  const { people, actions, sites, now } = await loadContext();
  const recentCut = addDays(now, -30);
  const all = actions
    .map((a) => actionView(a, people, now))
    .filter((a) => a.col !== 'done' || (a.closedOn ?? a.dueOn) >= recentCut)
    .sort((a, b) => b.id.localeCompare(a.id, 'fr', { numeric: true }))
    .map((a) => toPlanAction(a, people, sites, now));
  const pilots = [...new Map(all.map((a) => [a.pilotId, a.pilot])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  return { all, pilots, columns: ACTION_COLUMNS, now };
}

/**
 * Action ouverte par lien direct (/actions?action=A-214), y compris une action clôturée depuis plus de 30 jours.
 * `elsewhere` donne le site de l'action quand elle n'appartient pas au site sélectionné.
 */
export async function loadLinkedAction(id: string): Promise<{ action: PlanAction | null; elsewhere: string | null }> {
  const { people, actions, sites, now } = await loadContext();
  const row = actions.find((a) => a.id === id);
  if (row) return { action: toPlanAction(actionView(row, people, now), people, sites, now), elsewhere: null };
  const db = await getDb();
  const [other] = await db.select({ siteId: t.actions.siteId }).from(t.actions).where(eq(t.actions.id, id));
  return { action: null, elsewhere: other ? (other.siteId ? sites.get(other.siteId) ?? other.siteId : ALL_SITES_LABEL) : null };
}

// ─── Filtres ────────────────────────────────────────────────────────────────

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('fr');

export type PlanFilter = { origin?: string; pilotId?: string; q?: string };

/** Filtres communs aux trois vues : origine, pilote, recherche (référence, titre, référence d'origine). */
export function filterPlan(all: PlanAction[], { origin, pilotId, q }: PlanFilter) {
  const needle = q ? fold(q) : '';
  return all.filter((a) =>
    (!origin || a.origin.key === origin)
    && (!pilotId || a.pilotId === pilotId)
    && (!needle || [a.id, a.title, a.originRef].some((v) => fold(v).includes(needle))));
}
