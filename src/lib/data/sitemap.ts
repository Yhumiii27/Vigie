import 'server-only';
import { cache } from 'react';
import { asc, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t, type Db } from '@/db';
import { PERMIT_TYPES, PLAN_STATUS, isFullySigned, isMandatory, isPlanEnded, permitDays, planStatus, ruleBasis, toParisLocal } from '@/components/prevention/model';
import {
  activeOn, containingZone, detectConflicts, parseGeometry, parseIds, parsePoints,
  type CoInput, type Conflict,
} from '@/components/sitemap/coactivity';
import {
  COACTIVITY_HORIZON_DAYS, DEFAULT_PLANS, DEFAULT_PROXIMITY_METERS, ROUTE_KINDS, SITE_MAP_ATTACHMENT, ZONE_KINDS,
  type ActivityView, type Choice, type CoPermit, type MapConfig, type PositionCandidate, type RouteKind, type RouteView, type SitemapChoices, type ZoneKind, type ZoneView,
} from '@/components/sitemap/model';
import { addDays } from '../dates';
import { today } from '@/lib/today';
import type { TodoItem } from '../domain';
import { lcfirst, loadPeople } from '../queries';
import { currentSiteId, siteFilter } from '../session';
import { attachmentUrl } from '../uploads';
import { loadFormOptions } from './options';

// ─── Carte du site et coactivité ────────────────────────────────────────────

type Rows = Awaited<ReturnType<typeof fetchRows>>;
type Person = { name: string };

async function fetchRows(db: Db) {
  const [sites, maps, zones, routes, activities, contractors, plans, permits, mapFiles] = await Promise.all([
    // Sites actifs uniquement (un site archivé n'a plus de carte ni de coactivité).
    db.select().from(t.sites).where(isNull(t.sites.archivedAt)).orderBy(asc(t.sites.sort)),
    db.select().from(t.siteMaps),
    db.select().from(t.mapZones).orderBy(asc(t.mapZones.id)),
    db.select().from(t.mapRoutes).orderBy(asc(t.mapRoutes.id)),
    db.select().from(t.siteActivities).orderBy(asc(t.siteActivities.startOn), asc(t.siteActivities.id)),
    db.select().from(t.contractors),
    db.select().from(t.preventionPlans),
    db.select().from(t.permits),
    db.select({ id: t.attachments.id, fileName: t.attachments.fileName }).from(t.attachments).where(eq(t.attachments.entityType, SITE_MAP_ATTACHMENT)),
  ]);
  return { sites, maps, zones, routes, activities, contractors, plans, permits, mapFiles };
}

/** Lignes de toutes les cartes (mémorisées par requête). */
const loadRows = cache(async () => fetchRows(await getDb()));

const asZoneKind = (k: string): ZoneKind => (k in ZONE_KINDS ? (k as ZoneKind) : 'autre');
const asRouteKind = (k: string): RouteKind => (k in ROUTE_KINDS ? (k as RouteKind) : 'mixte');

/** Plan du site : fichier importé, sinon plan schématique par défaut, sinon fond quadrillé. */
function mapConfig(rows: Rows, siteId: string): MapConfig {
  const row = rows.maps.find((m) => m.siteId === siteId);
  const def = DEFAULT_PLANS[siteId];
  const width = row?.width ?? def?.width ?? 1600;
  const height = row?.height ?? def?.height ?? 1000;
  const file = row?.attachmentId ? rows.mapFiles.find((f) => f.id === row.attachmentId) : undefined;
  return {
    siteId,
    url: row?.attachmentId ? attachmentUrl(row.attachmentId) : def?.url ?? null,
    width,
    height,
    aspect: height / width,
    metersPerUnit: row ? row.metersPerUnit ?? null : def?.metersPerUnit ?? null,
    proximityMeters: row?.proximityMeters ?? DEFAULT_PROXIMITY_METERS,
    custom: !!row?.attachmentId,
    fileName: file?.fileName ?? null,
  };
}

function siteGeometry(rows: Rows, siteId: string) {
  const zones: ZoneView[] = rows.zones.filter((z) => z.siteId === siteId)
    .map((z) => ({ id: z.id, name: z.name, kind: asZoneKind(z.kind), polygon: parsePoints(z.polygon), notes: z.notes }))
    .filter((z) => z.polygon.length >= 3);
  const routes: RouteView[] = rows.routes.filter((r) => r.siteId === siteId)
    .map((r) => ({ id: r.id, name: r.name, kind: asRouteKind(r.kind), polyline: parsePoints(r.polyline), shared: r.shared, notes: r.notes }))
    .filter((r) => r.polyline.length >= 2);
  return { zones, routes };
}

const isOpenPermit = (p: { status: string }) => p.status === 'demande' || p.status === 'delivre';

function activityViews(rows: Rows, siteId: string, people: Map<string, Person>, routeIds: Set<number>, now: string): ActivityView[] {
  const contractor = new Map(rows.contractors.map((c) => [c.id, c.name]));
  const plans = new Map(rows.plans.map((p) => [p.id, p]));
  const permits = new Map(rows.permits.map((p) => [p.id, p]));
  const site = rows.sites.find((s) => s.id === siteId);
  // Permis ouverts par plan : un permis rattaché à un plan déjà positionné suit l'activité du plan (permis de feu du jour).
  const planPermits = new Map<string, CoPermit[]>();
  rows.permits.filter((p) => p.preventionPlanId && isOpenPermit(p)).forEach((p) => {
    const list = planPermits.get(p.preventionPlanId!) ?? [];
    list.push({ id: p.id, type: p.type, ...permitDays(p) });
    planPermits.set(p.preventionPlanId!, list);
  });
  return rows.activities.filter((a) => a.siteId === siteId).map((a) => {
    const plan = a.preventionPlanId ? plans.get(a.preventionPlanId) : undefined;
    const status = plan ? planStatus(plan, now) : null;
    return {
      id: a.id,
      title: a.title,
      team: a.team === 'externe' ? 'externe' : 'interne',
      contractorId: a.contractorId,
      contractor: a.contractorId ? contractor.get(a.contractorId) ?? a.contractorId : null,
      ownerId: a.ownerId,
      owner: a.ownerId ? people.get(a.ownerId)?.name ?? null : null,
      preventionPlanId: a.preventionPlanId,
      planStatus: status,
      planStatusLabel: status ? PLAN_STATUS[status].label : null,
      planClosed: !!plan && isPlanEnded(plan),
      planSigned: !!plan && isFullySigned(plan),
      planHasSignature: !!(plan?.signedEuOn || plan?.signedEeOn),
      planMandatory: !!plan && isMandatory(plan, site),
      planInterference: plan?.interferenceRisks ?? null,
      permitId: a.permitId,
      permitType: a.permitId ? permits.get(a.permitId)?.type ?? null : null,
      planPermits: (a.preventionPlanId ? planPermits.get(a.preventionPlanId) ?? [] : []).filter((p) => p.id !== a.permitId),
      dangerousWork: plan?.dangerousWork ?? false,
      keystoneProject: a.keystoneProject,
      zoneId: a.zoneId,
      geometry: parseGeometry(a.geometry),
      startOn: a.startOn,
      endOn: a.endOn,
      hours: a.hours,
      routeIds: parseIds(a.routeIds).filter((id) => routeIds.has(id)),
      vehicles: a.vehicles,
      notes: a.notes,
    };
  });
}

/** Données de coactivité d'un site (moteur partagé avec la page). */
function siteInput(rows: Rows, siteId: string, people: Map<string, Person>, now: string) {
  const site = rows.sites.find((s) => s.id === siteId);
  const map = mapConfig(rows, siteId);
  const { zones, routes } = siteGeometry(rows, siteId);
  const activities = activityViews(rows, siteId, people, new Set(routes.map((r) => r.id)), now);
  const input: CoInput = {
    zones, routes, activities,
    metersPerUnit: map.metersPerUnit,
    proximityMeters: map.proximityMeters,
    firstMinuteBasis: site?.ppFromFirstMinute ? ruleBasis(site) : null,
  };
  return { site, map, zones, routes, activities, input };
}

/** Pour les server actions : situation de coactivité recalculée (non mémorisée) sur un site et une date. */
export async function findConflict(siteId: string, date: string, key: string): Promise<{ conflict: Conflict; activities: ActivityView[] } | null> {
  const db = await getDb();
  const [rows, people] = await Promise.all([fetchRows(db), loadPeople()]);
  const { input, activities } = siteInput(rows, siteId, people, today());
  const conflict = detectConflicts(input, date).find((c) => c.key === key);
  return conflict ? { conflict, activities } : null;
}

/** Zone contenant un point du site (zone la plus petite), pour l'enregistrement d'une activité. */
export async function zoneAt(siteId: string, at: [number, number]) {
  const db = await getDb();
  const zones = (await db.select().from(t.mapZones)).filter((z) => z.siteId === siteId).map((z) => ({ id: z.id, polygon: parsePoints(z.polygon) }));
  return containingZone(zones, at)?.id ?? null;
}

// ─── « À positionner » ──────────────────────────────────────────────────────

const hourLabel = (hhmm: string) => {
  const [h, m] = hhmm.split(':');
  return `${Number(h)} h${m === '00' ? '' : ` ${m}`}`;
};

function candidates(rows: Rows, siteId: string, activities: ActivityView[], now: string, horizon: string | null) {
  const contractor = new Map(rows.contractors.map((c) => [c.id, c.name]));
  const planned = new Set(activities.map((a) => a.preventionPlanId).filter(Boolean));
  const permitted = new Set(activities.map((a) => a.permitId).filter(Boolean));
  const inWindow = (start: string, end: string) => end >= now && (!horizon || start <= horizon);

  const fromPlans: PositionCandidate[] = rows.plans
    .filter((p) => p.siteId === siteId && !isPlanEnded(p) && !planned.has(p.id) && inWindow(p.startOn, p.endOn))
    .map((p) => {
      const name = contractor.get(p.contractorId) ?? p.contractorId;
      return {
        kind: 'plan', id: p.id, title: p.title, location: p.location, contractorId: p.contractorId, contractor: name, ownerId: p.ownerId,
        startOn: p.startOn, endOn: p.endOn, hours: null, keystoneProject: p.keystoneProject, preventionPlanId: p.id, permitId: null, permitType: null,
        label: `${p.id} · ${name}`,
      };
    });
  // Un permis rattaché à un plan déjà positionné est représenté par l'activité du plan (son type s'y applique les jours
  // de validité, voir planPermits) : il n'est pas proposé une seconde fois.
  const fromPermits: PositionCandidate[] = rows.permits
    .filter((p) => p.siteId === siteId && isOpenPermit(p) && !permitted.has(p.id) && !(p.preventionPlanId && planned.has(p.preventionPlanId)))
    .map((p) => {
      const from = toParisLocal(p.validFrom), to = toParisLocal(p.validTo);
      const name = p.contractorId ? contractor.get(p.contractorId) ?? p.contractorId : null;
      const type = p.type === 'essai' ? 'essai' : 'feu';
      return {
        kind: 'permit' as const, id: p.id, title: p.description, location: p.location, contractorId: p.contractorId, contractor: name, ownerId: p.issuerId,
        startOn: from.slice(0, 10), endOn: to.slice(0, 10), hours: `${hourLabel(from.slice(11, 16))} – ${hourLabel(to.slice(11, 16))}`,
        keystoneProject: p.keystoneProject, preventionPlanId: p.preventionPlanId, permitId: p.id, permitType: p.type,
        label: `${p.id} · ${PERMIT_TYPES[type].label}${name ? ` · ${name}` : ' · intervention interne'}`,
      };
    })
    .filter((c) => inWindow(c.startOn, c.endOn));
  return [...fromPlans, ...fromPermits].sort((a, b) => a.startOn.localeCompare(b.startOn) || a.id.localeCompare(b.id));
}

// ─── Écran ──────────────────────────────────────────────────────────────────

export type SitemapData = Awaited<ReturnType<typeof loadSitemap>>;

/**
 * Écran « Carte du site et coactivité » : un site à la fois (site sélectionné, ou onglet choisi avec « Tous les sites »).
 * Liens profonds : ?plan=PP-… / ?permis=PF-… sélectionnent l'activité liée ou proposent de la positionner.
 */
export async function loadSitemap(params: { site?: string; plan?: string; permit?: string }) {
  const [rows, people, selected, options] = await Promise.all([loadRows(), loadPeople(), currentSiteId(), loadFormOptions()]);
  const now = today();
  const plan = params.plan ? rows.plans.find((p) => p.id === params.plan) : undefined;
  const permit = params.permit ? rows.permits.find((p) => p.id === params.permit) : undefined;
  const linkedSite = plan?.siteId ?? permit?.siteId;
  // Site affiché : site sélectionné ; avec « Tous les sites », celui du lien profond, sinon l'onglet demandé, sinon le premier.
  const siteId = selected ?? linkedSite ?? (params.site && rows.sites.some((s) => s.id === params.site) ? params.site : rows.sites[0]?.id ?? '');
  const { site, map, zones, routes, activities, input } = siteInput(rows, siteId, people, now);

  // Lien profond vers un plan ou un permis : activité liée, sinon proposition de positionnement.
  let focusActivity: ActivityView | null = null;
  let focusCandidate: PositionCandidate | null = null;
  let notice: string | null = null;
  if ((plan || permit) && linkedSite !== siteId) {
    const label = rows.sites.find((s) => s.id === linkedSite)?.label ?? linkedSite;
    notice = `${plan?.id ?? permit?.id} concerne le ${lcfirst(label ?? '')} : choisissez ce site ou « Tous les sites » dans la barre latérale.`;
  } else if (plan || permit) {
    const linked = activities.filter((a) => (plan && a.preventionPlanId === plan.id) || (permit && (a.permitId === permit.id || (!!permit.preventionPlanId && a.preventionPlanId === permit.preventionPlanId))));
    const rank = (a: ActivityView) => (activeOn(a, now) ? 0 : a.startOn > now ? 1 : 2);
    focusActivity = linked.sort((a, b) => rank(a) - rank(b) || a.startOn.localeCompare(b.startOn))[0] ?? null;
    if (!focusActivity) {
      focusCandidate = candidates(rows, siteId, activities, '0000-01-01', null).find((c) => (plan ? c.kind === 'plan' && c.id === plan.id : c.kind === 'permit' && c.id === permit!.id)) ?? null;
      if (!focusCandidate) notice = `${plan?.id ?? permit?.id} est clos ou annulé : aucune activité à positionner.`;
    }
  }
  const focusDate = focusActivity
    ? (activeOn(focusActivity, now) ? null : focusActivity.startOn > now ? focusActivity.startOn : focusActivity.endOn)
    : focusCandidate && focusCandidate.startOn > now ? focusCandidate.startOn : null;

  // Listes de choix du formulaire d'activité : plans et permis du site, y compris ceux déjà liés à une activité.
  const used = (key: 'preventionPlanId' | 'permitId') => new Set(activities.map((a) => a[key]).filter(Boolean));
  const usedPlans = used('preventionPlanId'), usedPermits = used('permitId');
  const usedContractors = new Set(activities.map((a) => a.contractorId).filter(Boolean));
  const contractorName = new Map(rows.contractors.map((c) => [c.id, c.name]));
  const sitePlans = rows.plans.filter((p) => p.siteId === siteId && (!isPlanEnded(p) || usedPlans.has(p.id))).sort((a, b) => b.id.localeCompare(a.id, 'fr', { numeric: true }));
  const sitePermits = rows.permits.filter((p) => p.siteId === siteId && ((p.status !== 'clos' && p.status !== 'annule') || usedPermits.has(p.id))).sort((a, b) => b.id.localeCompare(a.id, 'fr', { numeric: true }));
  const choices: SitemapChoices = {
    // Entreprises archivées exclues, sauf celles des activités existantes (formulaire de modification).
    contractors: rows.contractors.filter((c) => !c.archivedAt || usedContractors.has(c.id))
      .sort((a, b) => a.name.replace(/^\[/, '').localeCompare(b.name.replace(/^\[/, ''), 'fr', { sensitivity: 'base' }))
      .map((c): Choice => [c.id, `${c.name} — ${c.trade}`]),
    people: options.people,
    projects: options.projects,
    plans: sitePlans.map((p): Choice => [p.id, `${p.id} · ${contractorName.get(p.contractorId) ?? p.contractorId} — ${p.title}`]),
    planContractor: Object.fromEntries(sitePlans.map((p) => [p.id, p.contractorId])),
    permits: sitePermits.map((p): Choice => [p.id, `${p.id} · ${PERMIT_TYPES[p.type === 'essai' ? 'essai' : 'feu'].label} — ${p.location}`]),
  };

  const tabs = selected ? null : rows.sites.map((s) => {
    const { input: si } = siteInput(rows, s.id, people, now);
    return { id: s.id, label: s.label, conflicts: detectConflicts(si, now).length };
  });

  return {
    now,
    site: {
      id: siteId, label: site?.label ?? siteId, seveso: site?.seveso ?? null, ppFromFirstMinute: site?.ppFromFirstMinute ?? false,
      /** Fondement de la règle « dès la première minute » (null si le site ne l'applique pas). */
      firstMinuteBasis: input.firstMinuteBasis ?? null,
    },
    tabs,
    map,
    zones,
    routes,
    activities,
    toPosition: candidates(rows, siteId, activities, now, addDays(now, COACTIVITY_HORIZON_DAYS)),
    choices,
    conflictsToday: detectConflicts(input, now),
    focus: { activityId: focusActivity?.id ?? null, candidate: focusCandidate, date: focusDate, notice },
  };
}

// ─── Signaux (badge, échéances) ─────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * Badge et échéances de coactivité sur tous les sites actifs du périmètre (TDB-05, siteId du site) ; le lien porte
 * toujours le site (&site=), la clé « lu » ne dépend donc pas du sélecteur.
 * badge = situations de coactivité distinctes aujourd'hui ;
 * todo = une échéance par jour (aujourd'hui et les 15 suivants) et par site ayant au moins une situation de coactivité ;
 * le titre signale les situations nouvelles par rapport à la veille.
 */
export const loadCoactivitySignals = cache(async (): Promise<{ badge: number; todo: TodoItem[] }> => {
  const [rows, people, keep] = await Promise.all([loadRows(), loadPeople(), siteFilter('perimeter')]);
  const now = today();
  let badge = 0;
  const todo: TodoItem[] = [];
  for (const site of rows.sites.filter((s) => keep(s.id))) {
    const { input, zones, routes } = siteInput(rows, site.id, people, now);
    if (!input.activities.length) continue;
    const zoneName = new Map(zones.map((z) => [z.id, z.name]));
    const routeName = new Map(routes.map((r) => [r.id, lcfirst(r.name)]));
    const places = (list: Conflict[]) => {
      const names = [...new Set(list.flatMap((c) => [
        ...c.reasons.filter((r) => r.code === 'same_zone' || r.code === 'proximity').map((r) => (r.zoneId != null ? zoneName.get(r.zoneId) : undefined)),
        ...c.routeIds.map((id) => routeName.get(id)),
      ]).filter((n): n is string => !!n))];
      return names.length > 3 ? `${names.slice(0, 3).join(', ')}…` : names.join(', ');
    };
    let previous = new Set(detectConflicts(input, addDays(now, -1)).map((c) => c.key));
    for (let i = 0; i <= COACTIVITY_HORIZON_DAYS; i++) {
      const date = addDays(now, i);
      const list = detectConflicts(input, date);
      if (i === 0) badge += list.length;
      const fresh = list.filter((c) => !previous.has(c.key));
      previous = new Set(list.map((c) => c.key));
      // Aujourd'hui, puis seulement les jours où apparaissent de nouvelles situations (évite une échéance par jour).
      if (!list.length || (i > 0 && !fresh.length)) continue;
      const count = plural(list.length, 'situation de coactivité', 'situations de coactivité');
      const head = !fresh.length || fresh.length === list.length ? count : `${count}, dont ${plural(fresh.length, 'nouvelle', 'nouvelles')}`;
      const where = places(list);
      todo.push({
        date,
        kind: 'Coactivité',
        tone: list.some((c) => c.tone === 'danger') ? 'danger' : 'warn',
        title: `${head}${where ? ` · ${where}` : ''}`,
        who: '',
        siteId: site.id,
        href: `/prevention/carte?date=${date}&site=${site.id}`,
        // Badge : situations distinctes d'aujourd'hui ; les jours suivants n'ajoutent rien au badge.
        count: i === 0 ? list.length : 0,
      });
    }
  }
  return { badge, todo };
});
