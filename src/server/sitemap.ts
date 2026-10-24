'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { isPlanEnded, permitActivityBlocker, planCovers, planStatus } from '@/components/prevention/model';
import { interferenceLine, parseIds, parsePoints, type Geometry, type Pt } from '@/components/sitemap/coactivity';
import { DEFAULT_PLANS, DEFAULT_PROXIMITY_METERS, ROUTE_KIND_KEYS, SITE_MAP_ATTACHMENT, ZONE_KIND_KEYS, isRealDate } from '@/components/sitemap/model';
import { findConflict, zoneAt } from '@/lib/data/sitemap';
import { fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { formReader, type FormState } from '@/lib/forms';
import { requireInSite, requireManager } from '@/lib/guard';
import { loadPeople } from '@/lib/queries';
import { checkUploadBatch, deleteAttachment, saveUpload } from '@/lib/uploads';
import { diffFields, logChange } from './changelog';

// Carte du site et coactivité : zones, voies, activités, plan de fond et échelle.
// Traçabilité (PRV-12) : chaque écriture est journalisée dans sa transaction — activités sur leur fiche
// (`site_activity`), zones, voies, plan de fond et échelle dans l'historique de la carte du site (`site_map`, identifiant
// du site). Une activité ne se supprime plus : elle s'annule avec un motif (retirée de la carte et de la coactivité).
// Une zone s'archive avec un motif (EVT-19 : ses événements et son QR code de poste la désignent) ; les voies (dessin du
// plan) restent supprimables, leur suppression est journalisée sur la carte. Site : contrôlé
// par requireInSite après chargement (création sur un site actif du périmètre seulement).

type Result = { error?: string };

const MAX_POINTS = 300;
/** Limite de saisie des risques d'interférence d'un plan de prévention (même règle que le formulaire du plan). */
const MAX_INTERFERENCE = 4000;
const PLAN_IMAGE = /^image\/(png|jpeg|webp)$/;

const done = (id?: string | number): FormState => {
  revalidatePath('/', 'layout');
  return { ok: true, id: id == null ? undefined : String(id) };
};
const ok = (): Result => {
  revalidatePath('/', 'layout');
  return {};
};

const round = (n: number) => Math.round(n * 1e5) / 1e5;
/** Points normalisés plausibles (le plan occupe x ∈ [0, 1] ; une marge est tolérée autour). */
function cleanPoints(raw: unknown, min: number): Pt[] | null {
  const pts = parsePoints(raw);
  if (pts.length < min || pts.length > MAX_POINTS) return null;
  if (pts.some(([x, y]) => x < -0.5 || x > 1.5 || y < -0.5 || y > 5)) return null;
  return pts.map(([x, y]) => [round(x), round(y)]);
}
function readJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Position d'une activité : point ou surface, coordonnées vérifiées comme celles des zones et des voies. */
function cleanGeometry(raw: unknown): Geometry | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as { type?: unknown; at?: unknown; points?: unknown };
  if (g.type === 'point') {
    const at = cleanPoints([g.at], 1);
    return at ? { type: 'point', at: at[0] } : null;
  }
  if (g.type === 'polygon') {
    const points = cleanPoints(g.points, 3);
    return points ? { type: 'polygon', points } : null;
  }
  return null;
}

async function siteExists(siteId: string) {
  const db = await getDb();
  const [row] = await db.select({ id: t.sites.id }).from(t.sites).where(eq(t.sites.id, siteId));
  return !!row;
}

/** Journal de la carte d'un site (zones, voies, plan de fond, échelle). */
const MAP = 'site_map';
const ACTIVITY = 'site_activity';

const ZONE_LABELS = { name: 'Nom', kind: 'Type', notes: 'Notes' } as const;
const ROUTE_LABELS = { name: 'Nom', kind: 'Type', shared: 'Voie commune', notes: 'Notes' } as const;
const ACTIVITY_LABELS = {
  title: 'Intitulé', team: 'Équipe', contractorId: 'Entreprise extérieure', ownerId: 'Responsable', keystoneProject: 'Projet Keystone', zoneId: 'Zone',
  startOn: 'Début', endOn: 'Fin', hours: 'Plage horaire', vehicles: 'Véhicules ou engins', notes: 'Notes', preventionPlanId: 'Plan de prévention',
  permitId: 'Permis', routeIds: 'Voies empruntées',
} as const;
const fmtLog = (v: unknown) =>
  v == null || v === '' ? null : typeof v === 'boolean' ? (v ? 'oui' : 'non') : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmtDate(String(v)) : String(v);

// ─── Zones ──────────────────────────────────────────────────────────────────

/** Crée (avec son polygone) ou modifie une zone. */
export async function saveZone(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id');
  const siteId = f.str('siteId', { required: true });
  const name = f.str('name', { required: true, max: 80 });
  const kind = f.oneOf('kind', ZONE_KIND_KEYS, { required: true });
  const notes = f.str('notes', { max: 1000 }) || null;
  const rawPolygon = readJson(f.opt('polygon'));
  const polygon = rawPolygon == null ? null : cleanPoints(rawPolygon, 3);
  if (rawPolygon != null && !polygon) return { error: 'Contour de zone invalide : au moins trois sommets sur le plan.' };
  if (!id && !polygon) return { error: 'Dessinez le contour de la zone sur la carte.' };
  if (!f.ok) return f.state();
  if (!(await siteExists(siteId))) return { error: 'Site inconnu.' };

  const db = await getDb();
  if (id) {
    const current = await findZone(id);
    if (!current) return { error: 'Zone introuvable.' };
    if (current.archivedAt) return { error: 'Zone archivée : elle ne se modifie plus.' };
    if (current.siteId !== siteId) return { error: 'Une zone ne change pas de site.' };
    const blocked = await requireInSite(current.siteId);
    if (blocked) return { error: blocked };
    const details = diffFields(current, { name, kind: kind!, notes }, ZONE_LABELS, fmtLog);
    await db.transaction(async (tx) => {
      await tx.update(t.mapZones).set({ name, kind: kind!, notes, ...(polygon ? { polygon } : {}) }).where(eq(t.mapZones.id, id));
      if (details.length || polygon) {
        await logChange(tx, { entityType: MAP, entityId: siteId, action: 'update', summary: `Zone « ${name} » modifiée${polygon ? ' (contour redessiné)' : ''}`, details });
      }
    });
    return done(id);
  }
  const blocked = await requireInSite(siteId, { create: true });
  if (blocked) return { error: blocked };
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(t.mapZones).values({ siteId, name, kind: kind!, notes, polygon: polygon! }).returning({ id: t.mapZones.id });
    await logChange(tx, { entityType: MAP, entityId: siteId, action: 'create', summary: `Zone « ${name} » ajoutée à la carte` });
    return r;
  });
  return done(row.id);
}

/**
 * Archive une zone (EVT-19 : jamais supprimée) : retirée de la carte, des postes de signalement et de la coactivité, motif
 * obligatoire, journal de la carte du site. Les activités rattachées gardent leur position (sans zone, journal de
 * l'activité) ; les événements gardent leur zone. Son QR code de poste imprimé ouvre ensuite le formulaire terrain sur le
 * site du poste, sans lieu (« ce poste n'existe plus, choisissez le lieu »).
 */
export async function archiveZone(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok || id == null) return f.state();
  const db = await getDb();
  const [zone] = await db.select({ siteId: t.mapZones.siteId, name: t.mapZones.name, archivedAt: t.mapZones.archivedAt, qrVersion: t.mapZones.qrVersion })
    .from(t.mapZones).where(eq(t.mapZones.id, id));
  if (!zone) return { error: 'Zone introuvable.' };
  if (zone.archivedAt) return { error: 'Cette zone est déjà archivée.' };
  const blocked = await requireInSite(zone.siteId);
  if (blocked) return { error: blocked };
  const archived = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.mapZones).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason })
      .where(and(eq(t.mapZones.id, id), isNull(t.mapZones.archivedAt))).returning({ id: t.mapZones.id });
    if (!row) return false;
    const moved = await tx.update(t.siteActivities).set({ zoneId: null }).where(eq(t.siteActivities.zoneId, id)).returning({ id: t.siteActivities.id });
    for (const a of moved) {
      await logChange(tx, {
        entityType: ACTIVITY, entityId: a.id, action: 'update', byId: session.user.id,
        summary: `Zone « ${zone.name} » archivée : l'activité garde sa position`, details: [{ field: 'Zone', from: zone.name, to: null }],
      });
    }
    await logChange(tx, {
      entityType: MAP, entityId: zone.siteId, action: 'archive', byId: session.user.id, reason,
      summary: `Zone « ${zone.name} » archivée${moved.length ? ` (${moved.length} activité${moved.length > 1 ? 's' : ''} sans zone)` : ''} ; son QR code de poste (étiquette n° ${zone.qrVersion}) ne pré-remplit plus le lieu`,
    });
    return true;
  });
  if (!archived) return { error: 'Cette zone est déjà archivée.' };
  return done(id);
}

/** Zone de la carte (archivée comprise), pour une écriture. */
async function findZone(id: number) {
  const db = await getDb();
  const [row] = await db.select().from(t.mapZones).where(eq(t.mapZones.id, id));
  return row;
}

// ─── Voies de circulation ───────────────────────────────────────────────────

/** Crée (avec son tracé) ou modifie une voie de circulation. */
export async function saveRoute(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id');
  const siteId = f.str('siteId', { required: true });
  const name = f.str('name', { required: true, max: 80 });
  const kind = f.oneOf('kind', ROUTE_KIND_KEYS, { required: true });
  const shared = f.bool('shared');
  const notes = f.str('notes', { max: 1000 }) || null;
  const rawLine = readJson(f.opt('polyline'));
  const polyline = rawLine == null ? null : cleanPoints(rawLine, 2);
  if (rawLine != null && !polyline) return { error: 'Tracé de voie invalide : au moins deux points sur le plan.' };
  if (!id && !polyline) return { error: 'Tracez la voie sur la carte.' };
  if (!f.ok) return f.state();
  if (!(await siteExists(siteId))) return { error: 'Site inconnu.' };

  const db = await getDb();
  if (id) {
    const [current] = await db.select().from(t.mapRoutes).where(eq(t.mapRoutes.id, id));
    if (!current) return { error: 'Voie introuvable.' };
    if (current.siteId !== siteId) return { error: 'Une voie ne change pas de site.' };
    const blocked = await requireInSite(current.siteId);
    if (blocked) return { error: blocked };
    const details = diffFields(current, { name, kind: kind!, shared, notes }, ROUTE_LABELS, fmtLog);
    await db.transaction(async (tx) => {
      await tx.update(t.mapRoutes).set({ name, kind: kind!, shared, notes, ...(polyline ? { polyline } : {}) }).where(eq(t.mapRoutes.id, id));
      if (details.length || polyline) {
        await logChange(tx, { entityType: MAP, entityId: siteId, action: 'update', summary: `Voie « ${name} » modifiée${polyline ? ' (tracé redessiné)' : ''}`, details });
      }
    });
    return done(id);
  }
  const blocked = await requireInSite(siteId, { create: true });
  if (blocked) return { error: blocked };
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(t.mapRoutes).values({ siteId, name, kind: kind!, shared, notes, polyline: polyline! }).returning({ id: t.mapRoutes.id });
    await logChange(tx, { entityType: MAP, entityId: siteId, action: 'create', summary: `Voie « ${name} » ajoutée à la carte` });
    return r;
  });
  return done(row.id);
}

/** Supprime une voie et la retire des voies empruntées par les activités. */
export async function deleteRoute(id: number): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const db = await getDb();
  const [route] = await db.select().from(t.mapRoutes).where(eq(t.mapRoutes.id, id));
  if (!route) return { error: 'Voie introuvable.' };
  const blocked = await requireInSite(route.siteId);
  if (blocked) return { error: blocked };
  await db.transaction(async (tx) => {
    const acts = await tx.select({ id: t.siteActivities.id, routeIds: t.siteActivities.routeIds }).from(t.siteActivities).where(eq(t.siteActivities.siteId, route.siteId));
    let n = 0;
    for (const a of acts) {
      const ids = parseIds(a.routeIds);
      if (!ids.includes(id)) continue;
      await tx.update(t.siteActivities).set({ routeIds: ids.filter((x) => x !== id) }).where(eq(t.siteActivities.id, a.id));
      await logChange(tx, { entityType: ACTIVITY, entityId: a.id, action: 'update', summary: `Voie « ${route.name} » supprimée de la carte : retirée des voies empruntées` });
      n++;
    }
    await tx.delete(t.mapRoutes).where(eq(t.mapRoutes.id, id));
    await logChange(tx, { entityType: MAP, entityId: route.siteId, action: 'delete', summary: `Voie « ${route.name} » supprimée de la carte${n ? ` (retirée de ${n} activité${n > 1 ? 's' : ''})` : ''}` });
  });
  return ok();
}

/** Enregistre le contour d'une zone ou le tracé d'une voie après déplacement de ses sommets. */
export async function saveShape(kind: 'zone' | 'route', id: number, points: Pt[]): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const clean = cleanPoints(points, kind === 'zone' ? 3 : 2);
  if (!clean) return { error: kind === 'zone' ? 'Contour de zone invalide.' : 'Tracé de voie invalide.' };
  const db = await getDb();
  const [current] = kind === 'zone'
    ? await db.select({ siteId: t.mapZones.siteId, name: t.mapZones.name }).from(t.mapZones).where(and(eq(t.mapZones.id, id), isNull(t.mapZones.archivedAt)))
    : await db.select({ siteId: t.mapRoutes.siteId, name: t.mapRoutes.name }).from(t.mapRoutes).where(eq(t.mapRoutes.id, id));
  if (!current) return { error: kind === 'zone' ? 'Zone introuvable.' : 'Voie introuvable.' };
  const blocked = await requireInSite(current.siteId);
  if (blocked) return { error: blocked };
  const rows = await db.transaction(async (tx) => {
    const r = kind === 'zone'
      ? await tx.update(t.mapZones).set({ polygon: clean }).where(eq(t.mapZones.id, id)).returning({ id: t.mapZones.id })
      : await tx.update(t.mapRoutes).set({ polyline: clean }).where(eq(t.mapRoutes.id, id)).returning({ id: t.mapRoutes.id });
    if (r.length) {
      await logChange(tx, { entityType: MAP, entityId: current.siteId, action: 'update', summary: kind === 'zone' ? `Contour de la zone « ${current.name} » déplacé` : `Tracé de la voie « ${current.name} » déplacé` });
    }
    return r;
  });
  if (!rows.length) return { error: kind === 'zone' ? 'Zone introuvable.' : 'Voie introuvable.' };
  return ok();
}

// ─── Activités ──────────────────────────────────────────────────────────────

/** Crée ou modifie une activité localisée (équipe interne ou entreprise extérieure). */
export async function saveActivity(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id');
  const siteId = f.str('siteId', { required: true });
  const title = f.str('title', { required: true, max: 160 });
  const team = f.oneOf('team', ['interne', 'externe'] as const, { required: true });
  const contractorId = team === 'externe' ? f.str('contractorId') || null : null;
  const ownerId = f.opt('ownerId');
  const keystoneProject = f.opt('keystoneProject');
  let zoneId = f.int('zoneId');
  const startOn = f.date('startOn', { required: true });
  const endOn = f.date('endOn', { required: true });
  const hours = f.str('hours', { max: 60 }) || null;
  const vehicles = f.bool('vehicles');
  const notes = f.str('notes', { max: 2000 }) || null;
  const preventionPlanId = f.opt('preventionPlanId');
  const permitId = f.opt('permitId');
  const routeIds = [...new Set(fd.getAll('routeIds').map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const rawGeometry = readJson(f.opt('geometry'));
  const geometry: Geometry | null = rawGeometry == null ? null : cleanGeometry(rawGeometry);
  if (rawGeometry != null && !geometry) return { error: 'Position sur la carte invalide.' };
  if (team === 'externe' && !contractorId) f.fail('contractorId', "Choisissez l'entreprise extérieure.");
  if (startOn && endOn && endOn < startOn) f.fail('endOn', 'La fin ne peut pas précéder le début.');

  const db = await getDb();
  const [sites, zones, routes, contractors, people, projects, plan, permit, existing] = await Promise.all([
    db.select({ id: t.sites.id }).from(t.sites),
    db.select({ id: t.mapZones.id, siteId: t.mapZones.siteId, name: t.mapZones.name, archivedAt: t.mapZones.archivedAt }).from(t.mapZones),
    db.select({ id: t.mapRoutes.id, siteId: t.mapRoutes.siteId, name: t.mapRoutes.name }).from(t.mapRoutes),
    db.select({ id: t.contractors.id, archivedAt: t.contractors.archivedAt }).from(t.contractors),
    db.select({ id: t.people.id }).from(t.people),
    db.select({ id: t.keystoneProjects.id, client: t.keystoneProjects.client }).from(t.keystoneProjects),
    preventionPlanId ? db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, preventionPlanId)).then((r) => r[0]) : undefined,
    permitId ? db.select().from(t.permits).where(eq(t.permits.id, permitId)).then((r) => r[0]) : undefined,
    id ? db.select().from(t.siteActivities).where(eq(t.siteActivities.id, id)).then((r) => r[0]) : undefined,
  ]);
  if (id && !existing) return { error: 'Activité introuvable.' };
  if (existing?.cancelledAt) return { error: 'Activité annulée : elle ne se modifie plus.' };
  if (!sites.some((s) => s.id === siteId)) return { error: 'Site inconnu.' };
  if (existing && existing.siteId !== siteId) return { error: "Une activité ne change pas de site : annulez-la et créez-la sur l'autre site." };
  const siteBlocked = await requireInSite(siteId, { create: !existing });
  if (siteBlocked) return { error: siteBlocked };
  const contractor = contractors.find((c) => c.id === contractorId);
  if (contractorId && !contractor) f.fail('contractorId', 'Entreprise introuvable.');
  else if (contractor?.archivedAt && contractor.id !== existing?.contractorId) f.fail('contractorId', 'Entreprise archivée : réactivez-la dans l’onglet Entreprises extérieures.');
  if (ownerId && !people.some((p) => p.id === ownerId)) f.fail('ownerId', 'Personne inconnue.');
  if (keystoneProject && keystoneProject !== existing?.keystoneProject && !projects.some((p) => `${p.id} · ${p.client}` === keystoneProject)) f.fail('keystoneProject', 'Projet Keystone inconnu.');
  if (zoneId && !zones.some((z) => z.id === zoneId && z.siteId === siteId)) f.fail('zoneId', "Zone inconnue sur ce site.");
  else if (zoneId && zoneId !== existing?.zoneId && zones.some((z) => z.id === zoneId && z.archivedAt)) f.fail('zoneId', 'Zone archivée : choisissez une zone de la carte.');
  if (routeIds.some((r) => !routes.some((x) => x.id === r && x.siteId === siteId))) f.fail('routeIds', 'Voie inconnue sur ce site.');
  if (preventionPlanId) {
    if (!plan || plan.siteId !== siteId) f.fail('preventionPlanId', 'Plan de prévention introuvable sur ce site.');
    else if (isPlanEnded(plan) && plan.id !== existing?.preventionPlanId) f.fail('preventionPlanId', `Le plan ${plan.id} est ${plan.status === 'annule' ? 'annulé' : 'clos'} : établissez un nouveau plan de prévention.`);
    else if (team === 'interne') f.fail('preventionPlanId', "Un plan de prévention concerne une entreprise extérieure : choisissez « Entreprise extérieure ».");
    else if (contractorId && plan.contractorId !== contractorId) f.fail('preventionPlanId', 'Ce plan concerne une autre entreprise extérieure.');
    else if (startOn && endOn && endOn >= startOn && !planCovers(plan, startOn, endOn)) {
      f.fail('preventionPlanId', `Le plan ${plan.id} couvre du ${fmtDate(plan.startOn)} au ${fmtDate(plan.endOn)} : ajustez les dates de l'activité ou la période du plan.`);
    }
  }
  if (permitId) {
    if (!permit || permit.siteId !== siteId) f.fail('permitId', 'Permis introuvable sur ce site.');
    else if (permit.contractorId && permit.contractorId !== contractorId) f.fail('permitId', 'Ce permis concerne une autre entreprise.');
    else {
      // PRV-11 : permis en vigueur et valable pendant l'activité (un rattachement existant reste admis s'il est clos).
      const blocked = permitActivityBlocker(permit, startOn, endOn, {
        keptLink: permit.id === existing?.permitId, datesChanged: !!existing && (existing.startOn !== startOn || existing.endOn !== endOn),
      });
      if (blocked) f.fail('permitId', blocked);
    }
  }
  if (!f.ok) return f.state();

  // Zone déduite de la position quand elle n'est pas choisie.
  if (!zoneId && geometry?.type === 'point') zoneId = await zoneAt(siteId, geometry.at);
  const values = {
    title, team: team!, contractorId, ownerId, keystoneProject, zoneId: zoneId ?? null, geometry, startOn: startOn!, endOn: endOn!, hours,
    routeIds, vehicles, notes, preventionPlanId, permitId,
  };
  if (existing) {
    const view = await activityLogView({ ...values, routeIds: parseIds(values.routeIds) }, zones, routes);
    const details = diffFields(await activityLogView({ ...existing, routeIds: parseIds(existing.routeIds) }, zones, routes), view, ACTIVITY_LABELS, fmtLog);
    const moved = JSON.stringify(existing.geometry ?? null) !== JSON.stringify(values.geometry ?? null);
    await db.transaction(async (tx) => {
      await tx.update(t.siteActivities).set(values).where(eq(t.siteActivities.id, existing.id));
      if (details.length || moved) {
        await logChange(tx, { entityType: ACTIVITY, entityId: existing.id, action: 'update', summary: `Activité modifiée${moved ? ' (position sur la carte)' : ''}`, details });
      }
    });
    return done(existing.id);
  }
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(t.siteActivities).values({ siteId, ...values }).returning({ id: t.siteActivities.id });
    await logChange(tx, { entityType: ACTIVITY, entityId: r.id, action: 'create', summary: `Activité « ${title} » ajoutée à la carte (${fmtDate(startOn!)} → ${fmtDate(endOn!)})` });
    return r;
  });
  return done(row.id);
}

/** Activité telle que le journal l'affiche : entreprise, responsable, zone et voies par leur nom. */
async function activityLogView(
  a: { title: string; team: string; contractorId: string | null; ownerId: string | null; keystoneProject: string | null; zoneId: number | null; startOn: string; endOn: string;
    hours: string | null; vehicles: boolean; notes: string | null; preventionPlanId: string | null; permitId: string | null; routeIds: number[] },
  zones: { id: number; name?: string }[], routes: { id: number; name?: string }[],
) {
  const db = await getDb();
  const [people, [contractor]] = await Promise.all([
    loadPeople(),
    a.contractorId ? db.select({ name: t.contractors.name }).from(t.contractors).where(eq(t.contractors.id, a.contractorId)) : Promise.resolve([]),
  ]);
  return {
    ...a,
    team: a.team === 'externe' ? 'Entreprise extérieure' : 'Équipe interne',
    contractorId: a.contractorId ? contractor?.name ?? a.contractorId : null,
    ownerId: a.ownerId ? people.get(a.ownerId)?.name ?? a.ownerId : null,
    zoneId: a.zoneId != null ? zones.find((z) => z.id === a.zoneId)?.name ?? String(a.zoneId) : null,
    routeIds: a.routeIds.length ? a.routeIds.map((r) => routes.find((x) => x.id === r)?.name ?? String(r)).join(', ') : null,
  };
}

/** Déplace une activité sur la carte ; sa zone suit la nouvelle position. */
export async function moveActivity(id: number, at: Pt): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const point = cleanPoints([at], 1);
  if (!point) return { error: 'Position invalide.' };
  const db = await getDb();
  const [row] = await db.select({ siteId: t.siteActivities.siteId, zoneId: t.siteActivities.zoneId, cancelledAt: t.siteActivities.cancelledAt }).from(t.siteActivities).where(eq(t.siteActivities.id, id));
  if (!row) return { error: 'Activité introuvable.' };
  if (row.cancelledAt) return { error: 'Activité annulée : elle ne se modifie plus.' };
  const blocked = await requireInSite(row.siteId);
  if (blocked) return { error: blocked };
  const zoneId = await zoneAt(row.siteId, point[0]);
  const zoneName = async (zid: number | null) => (zid == null ? null
    : (await db.select({ name: t.mapZones.name }).from(t.mapZones).where(eq(t.mapZones.id, zid)))[0]?.name ?? String(zid));
  const details = zoneId !== row.zoneId ? [{ field: 'Zone', from: await zoneName(row.zoneId), to: await zoneName(zoneId) }] : [];
  await db.transaction(async (tx) => {
    await tx.update(t.siteActivities).set({ geometry: { type: 'point', at: point[0] }, zoneId }).where(eq(t.siteActivities.id, id));
    await logChange(tx, { entityType: ACTIVITY, entityId: id, action: 'update', summary: 'Activité déplacée sur la carte', details });
  });
  return ok();
}

/**
 * Annule une activité de la carte (saisie erronée, intervention annulée) : jamais supprimée (PRV-12), motif obligatoire ;
 * elle sort de la carte, de la coactivité et des rattachements qui bloquent l'annulation d'un plan de prévention.
 */
export async function cancelActivity(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [row] = await db.select({ siteId: t.siteActivities.siteId, title: t.siteActivities.title, cancelledAt: t.siteActivities.cancelledAt })
    .from(t.siteActivities).where(eq(t.siteActivities.id, id!));
  if (!row) return { error: 'Activité introuvable.' };
  if (row.cancelledAt) return { error: 'Cette activité est déjà annulée.' };
  const blocked = await requireInSite(row.siteId);
  if (blocked) return { error: blocked };
  const cancelled = await db.transaction(async (tx) => {
    const [r] = await tx.update(t.siteActivities).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason })
      .where(and(eq(t.siteActivities.id, id!), isNull(t.siteActivities.cancelledAt))).returning({ id: t.siteActivities.id });
    if (r) await logChange(tx, { entityType: ACTIVITY, entityId: id!, action: 'cancel', summary: `Activité « ${row.title} » annulée : retirée de la carte`, reason, byId: session.user.id });
    return !!r;
  });
  if (!cancelled) return { error: 'Cette activité est déjà annulée.' };
  return done(id!);
}

// ─── Plan de fond et échelle ────────────────────────────────────────────────

const defaultSize = (siteId: string) => ({ width: DEFAULT_PLANS[siteId]?.width ?? 1600, height: DEFAULT_PLANS[siteId]?.height ?? 1000 });

/** Échelle (largeur réelle représentée par le plan) et seuil de proximité. */
export async function saveMapSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const siteId = f.str('siteId', { required: true });
  const metersPerUnit = f.num('metersPerUnit', { required: true, min: 1 });
  const proximityMeters = f.int('proximityMeters', { required: true, min: 1, max: 500 });
  if (metersPerUnit != null && metersPerUnit > 100_000) f.fail('metersPerUnit', 'Maximum 100 000 m.');
  if (!f.ok) return f.state();
  if (!(await siteExists(siteId))) return { error: 'Site inconnu.' };
  const blocked = await requireInSite(siteId, { create: true });
  if (blocked) return { error: blocked };
  const db = await getDb();
  const values = { metersPerUnit: Math.round(metersPerUnit! * 100) / 100, proximityMeters: proximityMeters!, updatedAt: new Date() };
  const [before] = await db.select().from(t.siteMaps).where(eq(t.siteMaps.siteId, siteId));
  const details = diffFields(
    { metersPerUnit: before?.metersPerUnit ?? DEFAULT_PLANS[siteId]?.metersPerUnit ?? null, proximityMeters: before?.proximityMeters ?? DEFAULT_PROXIMITY_METERS },
    values, { metersPerUnit: 'Largeur représentée (m)', proximityMeters: 'Distance de coactivité (m)' },
  );
  await db.transaction(async (tx) => {
    await tx.insert(t.siteMaps).values({ siteId, ...defaultSize(siteId), ...values }).onConflictDoUpdate({ target: t.siteMaps.siteId, set: values });
    if (details.length) await logChange(tx, { entityType: MAP, entityId: siteId, action: 'update', summary: 'Échelle de la carte modifiée', details });
  });
  return done(siteId);
}

/**
 * Remplace le plan de fond par une image (PNG, JPEG, WebP ; un PDF est converti en image côté navigateur).
 * Les zones, voies et activités sont en coordonnées normalisées : elles sont conservées telles quelles.
 */
export async function replaceSitePlan(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const siteId = f.str('siteId', { required: true });
  const width = f.int('width', { required: true, min: 50, max: 30_000 });
  const height = f.int('height', { required: true, min: 50, max: 30_000 });
  const [file] = f.files('file');
  if (!file) f.fail('file', 'Choisissez une image ou un PDF.');
  else if (!PLAN_IMAGE.test(file.type)) f.fail('file', 'Image PNG, JPEG ou WebP attendue (un PDF est converti automatiquement).');
  else {
    const err = await checkUploadBatch([file], session.user.id);
    if (err) f.fail('file', err);
  }
  if (!f.ok) return f.state();
  if (!(await siteExists(siteId))) return { error: 'Site inconnu.' };
  const blocked = await requireInSite(siteId, { create: true });
  if (blocked) return { error: blocked };

  const db = await getDb();
  const [current] = await db.select().from(t.siteMaps).where(eq(t.siteMaps.siteId, siteId));
  const att = await saveUpload(file!, SITE_MAP_ATTACHMENT, siteId, session.user.id);
  const values = { attachmentId: att.id, width: width!, height: height!, updatedAt: new Date() };
  await db.transaction(async (tx) => {
    await tx.insert(t.siteMaps).values({ siteId, ...values, metersPerUnit: DEFAULT_PLANS[siteId]?.metersPerUnit ?? null, proximityMeters: DEFAULT_PROXIMITY_METERS })
      .onConflictDoUpdate({ target: t.siteMaps.siteId, set: values });
    await logChange(tx, {
      entityType: MAP, entityId: siteId, action: 'update', byId: session.user.id, summary: 'Plan de fond remplacé',
      details: [{ field: 'Plan de fond', from: current?.attachmentId ? 'plan importé' : 'plan schématique', to: att.fileName }],
    });
  });
  if (current?.attachmentId) await deleteAttachment(current.attachmentId);
  return done(siteId);
}

/** Revient au plan schématique par défaut du site. */
export async function resetSitePlan(siteId: string): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  if (!DEFAULT_PLANS[siteId]) return { error: "Ce site n'a pas de plan schématique par défaut." };
  const blocked = await requireInSite(siteId);
  if (blocked) return { error: blocked };
  const db = await getDb();
  const [current] = await db.select().from(t.siteMaps).where(eq(t.siteMaps.siteId, siteId));
  if (!current?.attachmentId) return { error: 'Le plan schématique est déjà affiché.' };
  await db.transaction(async (tx) => {
    await tx.update(t.siteMaps).set({ attachmentId: null, ...defaultSize(siteId), updatedAt: new Date() }).where(eq(t.siteMaps.siteId, siteId));
    await logChange(tx, { entityType: MAP, entityId: siteId, action: 'update', summary: 'Retour au plan schématique par défaut' });
  });
  await deleteAttachment(current.attachmentId);
  return ok();
}

// ─── Report dans le plan de prévention ──────────────────────────────────────

/**
 * Ajoute une ligne datée décrivant la coactivité aux risques d'interférence du plan de prévention.
 * La situation est recalculée côté serveur. Comme dans la fiche du plan (savePlan), les risques d'interférence
 * sont un champ essentiel : leur modification annule les signatures recueillies (R. 4512-6 / R. 4512-7 :
 * le plan mis à jour est à nouveau arrêté et signé par les deux entreprises) et le statut est recalculé.
 */
export async function addConflictToPlan(siteId: string, date: string, key: string, planId: string): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  if (!isRealDate(date)) return { error: 'Date invalide.' };
  const blocked = await requireInSite(siteId);
  if (blocked) return { error: blocked };
  const found = await findConflict(siteId, date, key);
  if (!found) return { error: "Cette situation de coactivité n'est plus détectée : rechargez la carte." };
  if (!found.conflict.planIds.includes(planId)) return { error: `Le plan ${planId} ne concerne pas cette situation.` };
  const db = await getDb();
  const [plan] = await db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, planId));
  if (!plan) return { error: 'Plan de prévention introuvable.' };
  if (isPlanEnded(plan)) return { error: `Le plan ${planId} est ${plan.status === 'annule' ? 'annulé' : 'clos'}.` };
  const line = interferenceLine(found.conflict);
  const current = plan.interferenceRisks.trim();
  if (current.includes(line)) return { error: `Déjà reporté dans le plan ${planId}.` };
  const next = current ? `${current}\n${line}` : line;
  if (next.length > MAX_INTERFERENCE) return { error: `Les risques d'interférence du plan ${planId} dépasseraient ${MAX_INTERFERENCE.toLocaleString('fr-FR')} caractères : complétez le plan depuis sa fiche.` };
  const values = { interferenceRisks: next, signedEuOn: null, signedEeOn: null };
  const unsigned = !!(plan.signedEuOn || plan.signedEeOn);
  await db.transaction(async (tx) => {
    await tx.update(t.preventionPlans).set({ ...values, status: planStatus({ ...plan, ...values }, today()) }).where(eq(t.preventionPlans.id, planId));
    await logChange(tx, {
      entityType: 'prevention_plan', entityId: planId, action: 'update',
      summary: `Coactivité du ${fmtDate(date)} reportée depuis la carte${unsigned ? ', signatures effacées' : ''}`,
      details: [{ field: "Risques d'interférence", from: current || null, to: next }],
    });
  });
  return ok();
}

// ─── Situations de coactivité maîtrisées (PRV-10) ───────────────────────────

const MEASURE_MAX = 1000;
const PAIR_KEY = /^(\d{1,9})-(\d{1,9})$/;

/** Violation de clé unique (maîtrise déjà enregistrée pour la paire, par une autre soumission). */
const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: unknown } | null;
  return !!e && (e.code === '23505' || (e.cause != null && isUniqueViolation(e.cause)));
};

/**
 * Marque une situation de coactivité détectée comme maîtrisée (champs `siteId`, `date`, `key`, `measure`) : mesure prise
 * obligatoire ; la paire d'activités n'est plus signalée (badge, échéances), une seule maîtrise en cours par paire.
 * Journal de la carte du site. Aucune action QSE (prévention : actions immédiates, réponses du 15/10/2026).
 */
export async function controlConflict(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const siteId = f.str('siteId', { required: true });
  const date = f.str('date', { required: true });
  const key = f.str('key', { required: true });
  const measure = f.str('measure', { required: true, max: MEASURE_MAX });
  if (!f.ok) return f.state();
  const pair = PAIR_KEY.exec(key);
  if (!isRealDate(date) || !pair) return { error: 'Situation de coactivité introuvable.' };
  if (!(await siteExists(siteId))) return { error: 'Site inconnu.' };
  const blocked = await requireInSite(siteId);
  if (blocked) return { error: blocked };
  const found = await findConflict(siteId, date, key);
  if (!found) return { error: "Cette situation de coactivité n'est plus détectée : rechargez la carte." };
  const [a, b] = [Number(pair[1]), Number(pair[2])];
  const title = (id: number) => found.activities.find((x) => x.id === id)?.title ?? `activité ${id}`;
  const db = await getDb();
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx.insert(t.coactivityControls).values({ siteId, pairKey: key, activityA: a, activityB: b, measure, controlledById: session.user.id })
        .returning({ id: t.coactivityControls.id });
      await logChange(tx, {
        entityType: MAP, entityId: siteId, action: 'control', byId: session.user.id,
        summary: `Coactivité maîtrisée : « ${title(a)} » et « ${title(b)} » (${found.conflict.title.toLowerCase()}, situation du ${fmtDate(date)})`,
        details: [{ field: 'Mesure prise', from: null, to: measure }, { field: 'Maîtrise', from: null, to: `n° ${row.id}` }],
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { error: 'Cette situation est déjà marquée maîtrisée.' };
    throw err;
  }
  return done(key);
}

/**
 * Lève la maîtrise d'une situation de coactivité (mesure levée, situation à reprendre) : motif obligatoire, jamais de
 * suppression ; la situation est de nouveau signalée si elle est toujours détectée.
 */
export async function releaseConflictControl(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [row] = await db.select().from(t.coactivityControls).where(eq(t.coactivityControls.id, id!));
  if (!row) return { error: 'Maîtrise introuvable.' };
  if (row.cancelledAt) return { error: 'Cette maîtrise est déjà levée.' };
  const blocked = await requireInSite(row.siteId);
  if (blocked) return { error: blocked };
  const released = await db.transaction(async (tx) => {
    const [r] = await tx.update(t.coactivityControls).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason })
      .where(and(eq(t.coactivityControls.id, row.id), isNull(t.coactivityControls.cancelledAt))).returning({ id: t.coactivityControls.id });
    if (r) {
      await logChange(tx, {
        entityType: MAP, entityId: row.siteId, action: 'release', byId: session.user.id, reason,
        summary: `Maîtrise de coactivité levée (activités ${row.activityA} et ${row.activityB}) : situation de nouveau signalée`,
        details: [{ field: 'Mesure prise', from: row.measure, to: null }],
      });
    }
    return !!r;
  });
  if (!released) return { error: 'Cette maîtrise est déjà levée.' };
  return done(row.id);
}
