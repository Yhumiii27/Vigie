// Moteur de coactivité de la carte du site (pur, partagé serveur / client, sans dépendance).
// Coordonnées normalisées : x ∈ [0, 1] sur la largeur du plan, y ∈ [0, hauteur / largeur] ;
// une unité vaut `metersPerUnit` mètres (largeur réelle représentée par le plan).

export type Pt = [number, number];
export type Geometry = { type: 'point'; at: Pt } | { type: 'polygon'; points: Pt[] };
export type Team = 'interne' | 'externe';

export type CoZone = { id: number; name: string; kind: string; polygon: Pt[] };
export type CoRoute = { id: number; name: string; kind: string; polyline: Pt[]; shared: boolean };
/** Permis ouvert (demandé ou délivré) rattaché au plan de prévention d'une activité : jours de validité inclus. */
export type CoPermit = { id: string; type: string; from: string; to: string };
export type CoActivity = {
  id: number;
  title: string;
  team: Team;
  /** Raison sociale de l'entreprise extérieure (null pour une équipe interne). */
  contractor: string | null;
  /** Identifiant de l'entreprise extérieure : deux activités de la même entreprise ne sont pas en coactivité entre elles. */
  contractorId?: string | null;
  zoneId: number | null;
  geometry: Geometry | null;
  /** Dates « AAAA-MM-JJ » incluses. */
  startOn: string;
  endOn: string;
  /** Plage horaire libre (« 7 h 30 – 12 h ») ; deux plages disjointes lèvent la coactivité. */
  hours: string | null;
  routeIds: number[];
  vehicles: boolean;
  preventionPlanId: string | null;
  permitId: string | null;
  /** feu | essai | null */
  permitType: string | null;
  /** Permis ouverts du plan de prévention lié : leur type s'applique à l'activité les jours de validité (permis de feu du jour). */
  planPermits?: CoPermit[];
  /** Travaux dangereux au sens de l'arrêté du 19 mars 1993 (repris du plan de prévention). */
  dangerousWork: boolean;
  /** Plan lié signé par les deux entreprises. */
  planSigned?: boolean;
  /** Plan écrit obligatoire (règle du site ou R. 4512-7). */
  planMandatory?: boolean;
};
export type CoInput = {
  zones: CoZone[];
  routes: CoRoute[];
  activities: CoActivity[];
  /** Mètres pour toute la largeur du plan ; null = plan non étalonné (repli sur les zones contiguës). */
  metersPerUnit: number | null;
  proximityMeters: number;
  /**
   * Fondement de la règle « plan écrit et signé dès la première minute » quand le site l'applique
   * (« Établissement Seveso seuil haut », « Règle interne du site », voir ruleBasis) ; null ou absent sinon.
   */
  firstMinuteBasis?: string | null;
};

export type ConflictTone = 'danger' | 'warn';
export type ReasonCode = 'same_zone' | 'proximity' | 'shared_route' | 'zone_crossing';
export type ConflictReason = {
  code: ReasonCode;
  /** « Même zone », « Proximité (12 m) », « Voie d'accès commune », « Traversée de zone de travail ». */
  label: string;
  /** Zone ou voie concernée, avec précisions : « Voie de livraison · véhicules des deux équipes ». */
  detail: string;
  /** Nom de la zone ou de la voie concernée. */
  subject: string;
  /** Précision (véhicules, zones voisines…). */
  note: string;
  tone: ConflictTone;
  zoneId?: number;
  routeId?: number;
  meters?: number;
};
export type PairKind = 'interne_externe' | 'externe_externe';
export type Conflict = {
  /** Identifiant de la paire d'activités (stable d'un jour à l'autre) : « 12-15 ». */
  key: string;
  date: string;
  tone: ConflictTone;
  pair: PairKind;
  pairLabel: string;
  /** Activités concernées ; `a` est l'équipe interne pour une coactivité EU / EE. */
  a: number;
  b: number;
  /** Libellés distincts des motifs, dans l'ordre de gravité. */
  title: string;
  reasons: ConflictReason[];
  zoneIds: number[];
  routeIds: number[];
  /** Lieu affiché (zones et voies concernées), ex. « Atelier montage, voie de livraison ». */
  place: string;
  /** Point de centrage de la carte. */
  focus: Pt;
  /** Mesures recommandées : mesures de terrain, puis suites à donner aux plans de prévention (mise à jour, signatures). */
  measures: string[];
  /** Mesures de terrain seules (reprises dans les risques d'interférence du plan, indépendantes de son état de signature). */
  fieldMeasures: string[];
  /** Plans de prévention des entreprises extérieures concernées. */
  planIds: string[];
  /** Phrase de synthèse (fiche action, plan de prévention). */
  description: string;
};

export const PAIR_LABEL: Record<PairKind, string> = {
  interne_externe: 'Coactivité EU / EE',
  externe_externe: 'Entre entreprises extérieures',
};

// ─── Géométrie ──────────────────────────────────────────────────────────────

const EPS = 1e-12;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function distPointSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < EPS) return dist(p, a);
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1);
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

/** Côtés d'un polygone (fermé). */
export const polygonEdges = (poly: Pt[]): [Pt, Pt][] => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
/** Segments d'une polyligne (ouverte). */
export const polylineSegments = (line: Pt[]): [Pt, Pt][] => line.slice(1).map((p, i) => [line[i], p]);

/** Point strictement ou non à l'intérieur (lancer de rayon). */
export function pointInPolygon(p: Pt, poly: Pt[]) {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: Pt[]) {
  let s = 0;
  polygonEdges(poly).forEach(([a, b]) => { s += a[0] * b[1] - b[0] * a[1]; });
  return Math.abs(s) / 2;
}

/** Centre de gravité d'un polygone (moyenne des sommets si dégénéré). */
export function centroid(poly: Pt[]): Pt {
  if (!poly.length) return [0, 0];
  let a = 0, cx = 0, cy = 0;
  polygonEdges(poly).forEach(([p, q]) => {
    const f = p[0] * q[1] - q[0] * p[1];
    a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
  });
  if (Math.abs(a) < EPS) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return [cx / (3 * a), cy / (3 * a)];
}

export function polylineLength(line: Pt[]) {
  return polylineSegments(line).reduce((s, [a, b]) => s + dist(a, b), 0);
}

/** Point situé à mi-longueur d'une polyligne. */
export function polylineMidpoint(line: Pt[]): Pt {
  if (line.length === 0) return [0, 0];
  let rest = polylineLength(line) / 2;
  for (const [a, b] of polylineSegments(line)) {
    const l = dist(a, b);
    if (l >= rest && l > 0) return [a[0] + ((b[0] - a[0]) * rest) / l, a[1] + ((b[1] - a[1]) * rest) / l];
    rest -= l;
  }
  return line[line.length - 1];
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const onSegment = (p: Pt, a: Pt, b: Pt) =>
  Math.min(a[0], b[0]) - 1e-12 <= p[0] && p[0] <= Math.max(a[0], b[0]) + 1e-12 && Math.min(a[1], b[1]) - 1e-12 <= p[1] && p[1] <= Math.max(a[1], b[1]) + 1e-12;

/** Deux segments se coupent ou se touchent. */
export function segmentsIntersect(p1: Pt, p2: Pt, q1: Pt, q2: Pt) {
  const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (Math.abs(d1) < EPS && onSegment(p1, q1, q2)) return true;
  if (Math.abs(d2) < EPS && onSegment(p2, q1, q2)) return true;
  if (Math.abs(d3) < EPS && onSegment(q1, p1, p2)) return true;
  if (Math.abs(d4) < EPS && onSegment(q2, p1, p2)) return true;
  return false;
}

function segmentDistance(p1: Pt, p2: Pt, q1: Pt, q2: Pt) {
  if (segmentsIntersect(p1, p2, q1, q2)) return 0;
  return Math.min(distPointSegment(p1, q1, q2), distPointSegment(p2, q1, q2), distPointSegment(q1, p1, p2), distPointSegment(q2, p1, p2));
}

/** Emprise d'une activité : un point ou une surface. */
export type Shape = { kind: 'point'; at: Pt } | { kind: 'polygon'; points: Pt[] };

/** Distance entre deux emprises (0 si elles se recouvrent ou se touchent). */
export function shapeDistance(a: Shape, b: Shape): number {
  if (a.kind === 'point' && b.kind === 'point') return dist(a.at, b.at);
  if (a.kind === 'point' && b.kind === 'polygon') return pointInPolygon(a.at, b.points) ? 0 : Math.min(...polygonEdges(b.points).map(([p, q]) => distPointSegment(a.at, p, q)));
  if (a.kind === 'polygon' && b.kind === 'point') return shapeDistance(b, a);
  const pa = (a as { points: Pt[] }).points, pb = (b as { points: Pt[] }).points;
  if (pa.some((p) => pointInPolygon(p, pb)) || pb.some((p) => pointInPolygon(p, pa))) return 0;
  let best = Infinity;
  for (const [p1, p2] of polygonEdges(pa)) for (const [q1, q2] of polygonEdges(pb)) best = Math.min(best, segmentDistance(p1, p2, q1, q2));
  return best;
}

/** Distance d'une polyligne à un point. */
export function polylinePointDistance(line: Pt[], p: Pt) {
  if (line.length === 1) return dist(line[0], p);
  return Math.min(...polylineSegments(line).map(([a, b]) => distPointSegment(p, a, b)));
}

/** Distance d'un point au contour d'un polygone. */
const boundaryDistance = (p: Pt, poly: Pt[]) => Math.min(...polygonEdges(poly).map(([a, b]) => distPointSegment(p, a, b)));

/**
 * La polyligne passe à l'intérieur du polygone (au-delà d'une simple tangence) :
 * chaque segment est découpé aux intersections avec les côtés et le milieu de chaque tronçon est testé.
 */
export function polylineCrossesPolygon(line: Pt[], poly: Pt[], tolerance = 1e-4) {
  if (poly.length < 3 || line.length < 2) return false;
  const inside = (p: Pt) => pointInPolygon(p, poly) && boundaryDistance(p, poly) > tolerance;
  for (const [a, b] of polylineSegments(line)) {
    const ts = [0, 1];
    for (const [q1, q2] of polygonEdges(poly)) {
      const r: Pt = [b[0] - a[0], b[1] - a[1]], s: Pt = [q2[0] - q1[0], q2[1] - q1[1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < EPS) continue;
      const t = ((q1[0] - a[0]) * s[1] - (q1[1] - a[1]) * s[0]) / den;
      const u = ((q1[0] - a[0]) * r[1] - (q1[1] - a[1]) * r[0]) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] - ts[i - 1] < 1e-9) continue;
      const m = (ts[i] + ts[i - 1]) / 2;
      if (inside([a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m])) return true;
    }
  }
  return false;
}

/** Zone la plus petite contenant le point (zones imbriquées : la zone ATEX plutôt que le hall). */
export function containingZone<Z extends { polygon: Pt[] }>(zones: Z[], p: Pt): Z | null {
  return zones.filter((z) => pointInPolygon(p, z.polygon)).sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon))[0] ?? null;
}

// ─── Lecture tolérante des colonnes jsonb ───────────────────────────────────

const isPt = (v: unknown): v is Pt => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

export function parsePoints(raw: unknown): Pt[] {
  return Array.isArray(raw) ? raw.filter(isPt).map((p) => [p[0], p[1]] as Pt) : [];
}

export function parseGeometry(raw: unknown): Geometry | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as { type?: unknown; at?: unknown; points?: unknown };
  if (g.type === 'point' && isPt(g.at)) return { type: 'point', at: [g.at[0], g.at[1]] };
  if (g.type === 'polygon') {
    const points = parsePoints(g.points);
    return points.length >= 3 ? { type: 'polygon', points } : null;
  }
  return null;
}

export function parseIds(raw: unknown): number[] {
  return Array.isArray(raw) ? [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
}

// ─── Plages horaires ────────────────────────────────────────────────────────

/**
 * Heures lues dans une plage libre : « 7 h 30 », « 7h30 », « 12 h » ou « 07:30 ».
 * Le « h » peut être espacé du nombre ; le « : » doit être collé au nombre et suivi des minutes
 * (« Équipe 1 : 5 h – 13 h » ne lit pas « 1 : » comme une heure).
 */
const TIME = /(?<![\d:,.])(\d{1,2})(?:\s*[hH](?:\s*(\d{2})(?!\d))?|:(\d{2})(?!\d))/g;

/**
 * « 7 h 30 – 12 h », « 07:30-17:00 », « de 5 h à 7 h 30 », « 8 h – 12 h / 14 h – 18 h » → plages en minutes [début, fin]
 * (les heures sont lues par paires ; une fin avant le début passe minuit). Tableau vide si illisible.
 */
export function parseHourRanges(s: string | null | undefined): [number, number][] {
  if (!s) return [];
  const times = [...s.matchAll(TIME)]
    .map((m) => ({ h: Number(m[1]), min: Number(m[2] ?? m[3] ?? 0) }))
    .filter((t) => t.h <= 24 && t.min < 60 && (t.h < 24 || t.min === 0))
    .map((t) => t.h * 60 + t.min);
  const ranges: [number, number][] = [];
  for (let i = 0; i + 1 < times.length; i += 2) {
    const [from, to] = [times[i], times[i + 1]];
    ranges.push([from, to <= from ? to + 24 * 60 : to]);
  }
  return ranges;
}

/** Première plage lue (compatibilité). */
export function parseHours(s: string | null | undefined): [number, number] | null {
  return parseHourRanges(s)[0] ?? null;
}

/** Les plages horaires se chevauchent (plage illisible ou absente : chevauchement supposé). */
export function hoursOverlap(a: string | null | undefined, b: string | null | undefined) {
  const ra = parseHourRanges(a), rb = parseHourRanges(b);
  if (!ra.length || !rb.length) return true;
  const day = 24 * 60;
  return ra.some((ha) => rb.some((hb) => [-day, 0, day].some((shift) => ha[0] < hb[1] + shift && hb[0] + shift < ha[1])));
}

// ─── Détection ──────────────────────────────────────────────────────────────

export const activeOn = (a: { startOn: string; endOn: string }, date: string) => a.startOn <= date && date <= a.endOn;

const fmtDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const lcfirst = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);

/** Mesures recommandées, dans l'ordre d'affichage. */
const MEASURES = {
  balisage: 'Balisage et séparation physique des zones de travail',
  circulation: 'Plan de circulation et sens unique sur la voie commune',
  horaires: 'Horaires décalés pour les opérations incompatibles',
  signaleur: "Signaleur / guide pour les manœuvres de véhicules et d'engins",
  consignation: "Consignation de la zone traversée (accès interdit pendant l'intervention, voie déviée)",
  feu: 'Permis de feu : écarter les équipes voisines, écrans de protection et surveillance après travaux',
  atex: "Zone ATEX / essais : aucune source d'inflammation, essais suspendus pendant l'intervention",
  information: 'Information croisée des équipes (accueil sécurité, point de coactivité quotidien)',
} as const;
type MeasureKey = keyof typeof MEASURES;
const MEASURE_ORDER = Object.keys(MEASURES) as MeasureKey[];

const ROUTE_KIND_PHRASE: Record<string, string> = { pietons: 'voie piétonne', mixte: 'voie mixte', vehicules: 'voie véhicules', engins: 'voie engins' };
const HAZARD_ZONES = new Set(['atex', 'essais']);

const teamName = (a: CoActivity) => (a.team === 'interne' ? 'équipe interne' : a.contractor ?? 'entreprise extérieure');

/** Type de permis applicable le jour donné : celui de l'activité, sinon un permis ouvert de son plan valide ce jour-là. */
export const permitTypeOn = (a: Pick<CoActivity, 'permitType' | 'planPermits'>, date: string) =>
  a.permitType ?? a.planPermits?.find((p) => p.from <= date && date <= p.to)?.type ?? null;

/**
 * Deux activités de la même entreprise extérieure (même entreprise, ou même plan de prévention) :
 * leur coordination relève de l'entreprise elle-même, pas de la coactivité EU / EE ou entre entreprises.
 */
export function sameCompany(a: Pick<CoActivity, 'team' | 'contractorId' | 'contractor' | 'preventionPlanId'>, b: typeof a) {
  if (a.team !== 'externe' || b.team !== 'externe') return false;
  if (a.contractorId && b.contractorId) return a.contractorId === b.contractorId;
  if (a.preventionPlanId && b.preventionPlanId && a.preventionPlanId === b.preventionPlanId) return true;
  return !!a.contractor && a.contractor === b.contractor;
}

/** Activité d'entreprise extérieure dont le plan obligatoire n'est pas signé par les deux entreprises. */
export const lacksSignedPlan = (a: Pick<CoActivity, 'team' | 'preventionPlanId' | 'planMandatory' | 'planSigned'>) =>
  a.team === 'externe' && !!a.preventionPlanId && !!a.planMandatory && !a.planSigned;

/** Situations de coactivité du jour : paires d'activités actives (interne × externe, externe × externe). */
export function detectConflicts(input: CoInput, date: string): Conflict[] {
  const zones = new Map(input.zones.map((z) => [z.id, z]));
  const routes = new Map(input.routes.map((r) => [r.id, r]));
  const mpu = input.metersPerUnit && input.metersPerUnit > 0 ? input.metersPerUnit : null;
  const proximity = Math.max(0, input.proximityMeters);
  const acts = input.activities.filter((a) => activeOn(a, date)).sort((x, y) => x.id - y.id);

  const zoneOf = (a: CoActivity): CoZone | null => {
    if (a.zoneId != null) return zones.get(a.zoneId) ?? null;
    if (!a.geometry) return null;
    return containingZone(input.zones, a.geometry.type === 'point' ? a.geometry.at : centroid(a.geometry.points));
  };
  const shapeOf = (a: CoActivity): Shape | null => {
    if (a.geometry?.type === 'point') return { kind: 'point', at: a.geometry.at };
    if (a.geometry?.type === 'polygon') return { kind: 'polygon', points: a.geometry.points };
    const z = zoneOf(a);
    return z && z.polygon.length >= 3 ? { kind: 'polygon', points: z.polygon } : null;
  };
  const positionOf = (a: CoActivity): Pt | null => {
    if (a.geometry?.type === 'point') return a.geometry.at;
    if (a.geometry?.type === 'polygon') return centroid(a.geometry.points);
    const z = zoneOf(a);
    return z ? centroid(z.polygon) : null;
  };
  /** La voie traverse l'emprise de travail de l'activité (sa zone, sa surface, ou un rayon autour de son point). */
  const crosses = (route: CoRoute, b: CoActivity): string | null => {
    if (route.polyline.length < 2) return null;
    if (b.geometry?.type === 'polygon') return polylineCrossesPolygon(route.polyline, b.geometry.points) ? `la zone de travail de « ${b.title} »` : null;
    const z = zoneOf(b);
    if (z && z.polygon.length >= 3) return polylineCrossesPolygon(route.polyline, z.polygon) ? z.name : null;
    if (b.geometry?.type === 'point') {
      const radius = mpu ? proximity / 2 / mpu : 0.02;
      return polylinePointDistance(route.polyline, b.geometry.at) < radius ? `le poste de « ${b.title} »` : null;
    }
    return null;
  };

  const conflicts: Conflict[] = [];
  for (let i = 0; i < acts.length; i++) {
    for (let j = i + 1; j < acts.length; j++) {
      let a = acts[i], b = acts[j];
      if (a.team === 'interne' && b.team === 'interne') continue;
      if (sameCompany(a, b)) continue;
      if (b.team === 'interne') [a, b] = [b, a];
      if (!hoursOverlap(a.hours, b.hours)) continue;

      const reasons: ConflictReason[] = [];
      const measures = new Set<MeasureKey>();
      const za = zoneOf(a), zb = zoneOf(b);
      const pa = permitTypeOn(a, date), pb = permitTypeOn(b, date);
      const hazardous = (x: CoActivity) => x.vehicles || x.dangerousWork || permitTypeOn(x, date) === 'feu' || permitTypeOn(x, date) === 'essai';
      const hotWork = pa === 'feu' || pb === 'feu';

      // (1) Même zone
      if (za && zb && za.id === zb.id) {
        const sensitive = HAZARD_ZONES.has(za.kind);
        reasons.push({ code: 'same_zone', label: 'Même zone', detail: za.name, subject: za.name, note: '', tone: hazardous(a) || hazardous(b) || sensitive ? 'danger' : 'warn', zoneId: za.id });
        measures.add('balisage').add('horaires').add('information');
        if (a.vehicles || b.vehicles) measures.add('signaleur');
        if (hotWork) measures.add('feu');
        if (sensitive) measures.add('atex');
      } else {
        // (2) Proximité
        const sa = shapeOf(a), sb = shapeOf(b);
        if (mpu && sa && sb) {
          const meters = shapeDistance(sa, sb) * mpu;
          if (meters < proximity) {
            const m = Math.round(meters);
            const sensitive = (za && HAZARD_ZONES.has(za.kind)) || (zb && HAZARD_ZONES.has(zb.kind));
            const where = [za?.name, zb?.name].filter((n, k, all): n is string => !!n && all.indexOf(n) === k).join(' / ');
            reasons.push({ code: 'proximity', label: `Proximité (${m} m)`, detail: where, subject: where, note: '', tone: (hazardous(a) && hazardous(b)) || sensitive ? 'danger' : 'warn', meters: m, ...(zb ? { zoneId: zb.id } : za ? { zoneId: za.id } : {}) });
            measures.add('balisage').add('information');
            if (hotWork) measures.add('feu');
            if (sensitive) measures.add('atex');
          }
        } else if (!mpu && za && zb && shapeDistance({ kind: 'polygon', points: za.polygon }, { kind: 'polygon', points: zb.polygon }) < 1e-3) {
          reasons.push({ code: 'proximity', label: 'Proximité (zones contiguës)', detail: `${za.name} / ${zb.name}`, subject: `${za.name} / ${zb.name}`, note: '', tone: hazardous(a) && hazardous(b) ? 'danger' : 'warn', zoneId: zb.id });
          measures.add('balisage').add('information');
        }
      }

      // (3) Voie d'accès commune
      const sharedIds = a.routeIds.filter((id) => b.routeIds.includes(id) && routes.get(id)?.shared);
      for (const id of sharedIds) {
        const r = routes.get(id)!;
        const anyVehicle = a.vehicles || b.vehicles;
        const danger = (a.vehicles && b.vehicles) || (anyVehicle && (r.kind === 'mixte' || r.kind === 'pietons'));
        const note = a.vehicles && b.vehicles ? 'véhicules des deux équipes'
          : anyVehicle ? `véhicules ou engins sur une ${ROUTE_KIND_PHRASE[r.kind] ?? 'voie partagée'}` : '';
        reasons.push({ code: 'shared_route', label: "Voie d'accès commune", detail: note ? `${r.name} · ${note}` : r.name, subject: r.name, note, tone: danger ? 'danger' : 'warn', routeId: r.id });
        measures.add('circulation').add('horaires').add('information');
        if (anyVehicle) measures.add('signaleur');
      }

      // (4) Traversée de zone de travail : la voie empruntée par l'un traverse l'emprise de l'autre.
      for (const [user, other] of [[a, b], [b, a]] as const) {
        for (const id of user.routeIds) {
          if (other.routeIds.includes(id)) continue; // voie d'accès de l'autre équipe : motif (3)
          const r = routes.get(id);
          if (!r) continue;
          const area = crosses(r, other);
          if (!area) continue;
          const vehicles = user.vehicles || r.kind === 'vehicules' || r.kind === 'engins';
          reasons.push({ code: 'zone_crossing', label: 'Traversée de zone de travail', detail: `${r.name} (${teamName(user)}) traverse ${area}`, subject: r.name, note: `empruntée par ${teamName(user)}, traverse ${area}`, tone: vehicles ? 'danger' : 'warn', routeId: r.id, ...(other.zoneId != null ? { zoneId: other.zoneId } : {}) });
          measures.add('consignation').add('balisage');
          if (vehicles) measures.add('signaleur');
        }
      }

      if (!reasons.length) continue;

      // Dédoublonnage des motifs (même code, même zone ou voie).
      const unique = reasons.filter((r, k) => reasons.findIndex((x) => x.code === r.code && x.zoneId === r.zoneId && x.routeId === r.routeId) === k);
      const ORDER: ReasonCode[] = ['shared_route', 'zone_crossing', 'same_zone', 'proximity'];
      unique.sort((x, y) => Number(y.tone === 'danger') - Number(x.tone === 'danger') || ORDER.indexOf(x.code) - ORDER.indexOf(y.code));

      const pair: PairKind = a.team === 'externe' && b.team === 'externe' ? 'externe_externe' : 'interne_externe';
      const zoneIds = [...new Set(unique.map((r) => r.zoneId).filter((id): id is number => id != null))];
      const routeIds = [...new Set(unique.map((r) => r.routeId).filter((id): id is number => id != null))];
      const posA = positionOf(a), posB = positionOf(b);
      const focus: Pt = posA && posB ? [(posA[0] + posB[0]) / 2, (posA[1] + posB[1]) / 2]
        : posA ?? posB ?? (routeIds.length ? polylineMidpoint(routes.get(routeIds[0])!.polyline) : zoneIds.length ? centroid(zones.get(zoneIds[0])!.polygon) : [0.5, 0.3]);
      const places = [
        ...unique.filter((r) => r.code === 'same_zone' || r.code === 'proximity').map((r) => (r.zoneId != null ? zones.get(r.zoneId)?.name : undefined)),
        ...routeIds.map((id) => lcfirst(routes.get(id)!.name)),
      ].filter((n, k, all): n is string => !!n && all.indexOf(n) === k);

      const externals = [a, b].filter((x) => x.team === 'externe');
      const planIds = [...new Set(externals.map((x) => x.preventionPlanId).filter((id): id is string => !!id))];
      const withoutPlan = externals.filter((x) => !x.preventionPlanId);
      const unsigned = [...new Set(externals.filter(lacksSignedPlan).map((x) => x.preventionPlanId!))];
      const basis = input.firstMinuteBasis || null;
      const fieldMeasures: string[] = MEASURE_ORDER.filter((k) => measures.has(k)).map((k) => MEASURES[k]);
      const measureList = [...fieldMeasures];
      if (planIds.length) measureList.push(`Mise à jour des plans de prévention concernés (${planIds.join(', ')})`);
      if (unsigned.length) {
        measureList.push(`${unsigned.length > 1 ? 'Plans' : 'Plan'} ${unsigned.join(', ')} à faire signer par les deux entreprises avant toute intervention (${basis ? `${lcfirst(basis)} : plan écrit et signé dès la première minute` : 'plan obligatoire, R. 4512-7'})`);
      }
      if (withoutPlan.length) {
        measureList.push(basis
          ? `Plan de prévention écrit et signé à établir avant toute intervention (${withoutPlan.map(teamName).join(', ')}) : ${lcfirst(basis)}, dès la première minute`
          : `Plan de prévention à établir avec ${withoutPlan.map(teamName).join(', ')}`);
      }

      const phrases = unique.map((r) => {
        if (r.code === 'same_zone') return `même zone (${r.detail})`;
        if (r.code === 'proximity') return r.meters != null ? `à ${r.meters} m l'une de l'autre${r.detail ? ` (${r.detail})` : ''}` : `zones contiguës (${r.detail})`;
        if (r.code === 'shared_route') return `voie d'accès commune « ${r.subject} »${r.note ? ` (${r.note})` : ''}`;
        return `la voie « ${r.subject} », ${r.note}`;
      });
      const description = `${pair === 'externe_externe' ? 'Coactivité entre entreprises extérieures' : 'Coactivité EU / EE'} : « ${a.title} » (${teamName(a)}) et « ${b.title} » (${teamName(b)}) — ${phrases.join(' ; ')}.`;

      conflicts.push({
        key: `${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`,
        date,
        tone: unique.some((r) => r.tone === 'danger') ? 'danger' : 'warn',
        pair,
        pairLabel: PAIR_LABEL[pair],
        a: a.id,
        b: b.id,
        title: [...new Set(unique.map((r) => r.label))].join(' · '),
        reasons: unique,
        zoneIds,
        routeIds,
        place: places.join(', '),
        focus,
        measures: measureList,
        fieldMeasures,
        planIds,
        description,
      });
    }
  }
  return conflicts.sort((x, y) => Number(y.tone === 'danger') - Number(x.tone === 'danger') || x.key.localeCompare(y.key, 'fr', { numeric: true }));
}

/**
 * Ligne datée ajoutée aux risques d'interférence du plan de prévention (même texte côté serveur et client).
 * Seules les mesures de terrain y figurent : la ligne ne change pas quand le plan perd ses signatures en étant modifié,
 * ce qui permet de reconnaître une situation déjà reportée.
 */
export function interferenceLine(c: Conflict) {
  return `— ${fmtDate(c.date)} · ${c.description} Mesures : ${c.fieldMeasures.map(lcfirst).join(' ; ')}.`;
}
