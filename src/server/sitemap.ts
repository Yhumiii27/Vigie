'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { isPlanEnded, planCovers, planStatus } from '@/components/prevention/model';
import { interferenceLine, parseIds, parsePoints, type Geometry, type Pt } from '@/components/sitemap/coactivity';
import { DEFAULT_PLANS, DEFAULT_PROXIMITY_METERS, ROUTE_KIND_KEYS, SITE_MAP_ATTACHMENT, ZONE_KIND_KEYS, isRealDate } from '@/components/sitemap/model';
import { findConflict, zoneAt } from '@/lib/data/sitemap';
import { fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { formReader, type FormState } from '@/lib/forms';
import { requireManager } from '@/lib/guard';
import { currentSiteId, inSite } from '@/lib/session';
import { checkUpload, deleteAttachment, saveUpload } from '@/lib/uploads';
import { logChange } from './changelog';

// Carte du site et coactivité : zones, voies, activités, plan de fond et échelle.

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

const OTHER_SITE = 'Élément hors du site sélectionné : choisissez ce site ou « Tous les sites » dans la barre latérale.';
/** Le site de l'élément est visible avec le site sélectionné (ou « Tous les sites »). */
const visible = async (siteId: string | null | undefined) => inSite(await currentSiteId(), siteId);

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
  if (!(await visible(siteId))) return { error: OTHER_SITE };

  const db = await getDb();
  if (id) {
    const [current] = await db.select({ siteId: t.mapZones.siteId }).from(t.mapZones).where(eq(t.mapZones.id, id));
    if (!current) return { error: 'Zone introuvable.' };
    if (current.siteId !== siteId) return { error: 'Une zone ne change pas de site.' };
    await db.update(t.mapZones).set({ name, kind: kind!, notes, ...(polygon ? { polygon } : {}) }).where(eq(t.mapZones.id, id));
    return done(id);
  }
  const [row] = await db.insert(t.mapZones).values({ siteId, name, kind: kind!, notes, polygon: polygon! }).returning({ id: t.mapZones.id });
  return done(row.id);
}

/** Supprime une zone ; les activités qui y étaient rattachées gardent leur position. */
export async function deleteZone(id: number): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const db = await getDb();
  const [zone] = await db.select({ siteId: t.mapZones.siteId }).from(t.mapZones).where(eq(t.mapZones.id, id));
  if (!zone) return { error: 'Zone introuvable.' };
  if (!(await visible(zone.siteId))) return { error: OTHER_SITE };
  const deleted = await db.transaction(async (tx) => {
    await tx.update(t.siteActivities).set({ zoneId: null }).where(eq(t.siteActivities.zoneId, id));
    return tx.delete(t.mapZones).where(eq(t.mapZones.id, id)).returning({ id: t.mapZones.id });
  });
  if (!deleted.length) return { error: 'Zone introuvable.' };
  return ok();
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
  if (!(await visible(siteId))) return { error: OTHER_SITE };

  const db = await getDb();
  if (id) {
    const [current] = await db.select({ siteId: t.mapRoutes.siteId }).from(t.mapRoutes).where(eq(t.mapRoutes.id, id));
    if (!current) return { error: 'Voie introuvable.' };
    if (current.siteId !== siteId) return { error: 'Une voie ne change pas de site.' };
    await db.update(t.mapRoutes).set({ name, kind: kind!, shared, notes, ...(polyline ? { polyline } : {}) }).where(eq(t.mapRoutes.id, id));
    return done(id);
  }
  const [row] = await db.insert(t.mapRoutes).values({ siteId, name, kind: kind!, shared, notes, polyline: polyline! }).returning({ id: t.mapRoutes.id });
  return done(row.id);
}

/** Supprime une voie et la retire des voies empruntées par les activités. */
export async function deleteRoute(id: number): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const db = await getDb();
  const [route] = await db.select().from(t.mapRoutes).where(eq(t.mapRoutes.id, id));
  if (!route) return { error: 'Voie introuvable.' };
  if (!(await visible(route.siteId))) return { error: OTHER_SITE };
  await db.transaction(async (tx) => {
    const acts = await tx.select({ id: t.siteActivities.id, routeIds: t.siteActivities.routeIds }).from(t.siteActivities).where(eq(t.siteActivities.siteId, route.siteId));
    for (const a of acts) {
      const ids = parseIds(a.routeIds);
      if (ids.includes(id)) await tx.update(t.siteActivities).set({ routeIds: ids.filter((x) => x !== id) }).where(eq(t.siteActivities.id, a.id));
    }
    await tx.delete(t.mapRoutes).where(eq(t.mapRoutes.id, id));
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
    ? await db.select({ siteId: t.mapZones.siteId }).from(t.mapZones).where(eq(t.mapZones.id, id))
    : await db.select({ siteId: t.mapRoutes.siteId }).from(t.mapRoutes).where(eq(t.mapRoutes.id, id));
  if (current && !(await visible(current.siteId))) return { error: OTHER_SITE };
  const rows = kind === 'zone'
    ? await db.update(t.mapZones).set({ polygon: clean }).where(eq(t.mapZones.id, id)).returning({ id: t.mapZones.id })
    : await db.update(t.mapRoutes).set({ polyline: clean }).where(eq(t.mapRoutes.id, id)).returning({ id: t.mapRoutes.id });
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
    db.select({ id: t.mapZones.id, siteId: t.mapZones.siteId }).from(t.mapZones),
    db.select({ id: t.mapRoutes.id, siteId: t.mapRoutes.siteId }).from(t.mapRoutes),
    db.select({ id: t.contractors.id, archivedAt: t.contractors.archivedAt }).from(t.contractors),
    db.select({ id: t.people.id }).from(t.people),
    db.select({ id: t.keystoneProjects.id, client: t.keystoneProjects.client }).from(t.keystoneProjects),
    preventionPlanId ? db.select().from(t.preventionPlans).where(eq(t.preventionPlans.id, preventionPlanId)).then((r) => r[0]) : undefined,
    permitId ? db.select().from(t.permits).where(eq(t.permits.id, permitId)).then((r) => r[0]) : undefined,
    id ? db.select().from(t.siteActivities).where(eq(t.siteActivities.id, id)).then((r) => r[0]) : undefined,
  ]);
  if (id && !existing) return { error: 'Activité introuvable.' };
  if (!sites.some((s) => s.id === siteId)) return { error: 'Site inconnu.' };
  if (!(await visible(siteId))) return { error: OTHER_SITE };
  if (existing && existing.siteId !== siteId) return { error: "Une activité ne change pas de site : supprimez-la et créez-la sur l'autre site." };
  const contractor = contractors.find((c) => c.id === contractorId);
  if (contractorId && !contractor) f.fail('contractorId', 'Entreprise introuvable.');
  else if (contractor?.archivedAt && contractor.id !== existing?.contractorId) f.fail('contractorId', 'Entreprise archivée : réactivez-la dans l’onglet Entreprises extérieures.');
  if (ownerId && !people.some((p) => p.id === ownerId)) f.fail('ownerId', 'Personne inconnue.');
  if (keystoneProject && keystoneProject !== existing?.keystoneProject && !projects.some((p) => `${p.id} · ${p.client}` === keystoneProject)) f.fail('keystoneProject', 'Projet Keystone inconnu.');
  if (zoneId && !zones.some((z) => z.id === zoneId && z.siteId === siteId)) f.fail('zoneId', "Zone inconnue sur ce site.");
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
  }
  if (!f.ok) return f.state();

  // Zone déduite de la position quand elle n'est pas choisie.
  if (!zoneId && geometry?.type === 'point') zoneId = await zoneAt(siteId, geometry.at);
  const values = {
    title, team: team!, contractorId, ownerId, keystoneProject, zoneId: zoneId ?? null, geometry, startOn: startOn!, endOn: endOn!, hours,
    routeIds, vehicles, notes, preventionPlanId, permitId,
  };
  if (existing) {
    await db.update(t.siteActivities).set(values).where(eq(t.siteActivities.id, existing.id));
    return done(existing.id);
  }
  const [row] = await db.insert(t.siteActivities).values({ siteId, ...values }).returning({ id: t.siteActivities.id });
  return done(row.id);
}

/** Déplace une activité sur la carte ; sa zone suit la nouvelle position. */
export async function moveActivity(id: number, at: Pt): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const point = cleanPoints([at], 1);
  if (!point) return { error: 'Position invalide.' };
  const db = await getDb();
  const [row] = await db.select({ siteId: t.siteActivities.siteId }).from(t.siteActivities).where(eq(t.siteActivities.id, id));
  if (!row) return { error: 'Activité introuvable.' };
  if (!(await visible(row.siteId))) return { error: OTHER_SITE };
  const zoneId = await zoneAt(row.siteId, point[0]);
  await db.update(t.siteActivities).set({ geometry: { type: 'point', at: point[0] }, zoneId }).where(eq(t.siteActivities.id, id));
  return ok();
}

export async function deleteActivity(id: number): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  const db = await getDb();
  const [row] = await db.select({ siteId: t.siteActivities.siteId }).from(t.siteActivities).where(eq(t.siteActivities.id, id));
  if (!row) return { error: 'Activité introuvable.' };
  if (!(await visible(row.siteId))) return { error: OTHER_SITE };
  await db.delete(t.siteActivities).where(eq(t.siteActivities.id, id));
  return ok();
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
  if (!(await visible(siteId))) return { error: OTHER_SITE };
  const db = await getDb();
  const values = { metersPerUnit: Math.round(metersPerUnit! * 100) / 100, proximityMeters: proximityMeters!, updatedAt: new Date() };
  await db.insert(t.siteMaps).values({ siteId, ...defaultSize(siteId), ...values }).onConflictDoUpdate({ target: t.siteMaps.siteId, set: values });
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
    const err = checkUpload(file);
    if (err) f.fail('file', err);
  }
  if (!f.ok) return f.state();
  if (!(await siteExists(siteId))) return { error: 'Site inconnu.' };
  if (!(await visible(siteId))) return { error: OTHER_SITE };

  const db = await getDb();
  const [current] = await db.select().from(t.siteMaps).where(eq(t.siteMaps.siteId, siteId));
  const att = await saveUpload(file!, SITE_MAP_ATTACHMENT, siteId, session.user.id);
  const values = { attachmentId: att.id, width: width!, height: height!, updatedAt: new Date() };
  await db.insert(t.siteMaps).values({ siteId, ...values, metersPerUnit: DEFAULT_PLANS[siteId]?.metersPerUnit ?? null, proximityMeters: DEFAULT_PROXIMITY_METERS })
    .onConflictDoUpdate({ target: t.siteMaps.siteId, set: values });
  if (current?.attachmentId) await deleteAttachment(current.attachmentId);
  return done(siteId);
}

/** Revient au plan schématique par défaut du site. */
export async function resetSitePlan(siteId: string): Promise<Result> {
  const { error } = await requireManager();
  if (error) return { error };
  if (!DEFAULT_PLANS[siteId]) return { error: "Ce site n'a pas de plan schématique par défaut." };
  if (!(await visible(siteId))) return { error: OTHER_SITE };
  const db = await getDb();
  const [current] = await db.select().from(t.siteMaps).where(eq(t.siteMaps.siteId, siteId));
  if (!current?.attachmentId) return { error: 'Le plan schématique est déjà affiché.' };
  await db.update(t.siteMaps).set({ attachmentId: null, ...defaultSize(siteId), updatedAt: new Date() }).where(eq(t.siteMaps.siteId, siteId));
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
  if (!(await visible(siteId))) return { error: OTHER_SITE };
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
