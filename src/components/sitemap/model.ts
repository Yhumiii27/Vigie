// Carte du site et coactivité : référentiels et vues sérialisables (partagés serveur / client).

import type { Conflict, CoPermit, Geometry, Pt, Team } from './coactivity';

export type { Conflict, CoPermit, Geometry, Pt, Team };

/** Horizon de la liste « À positionner » et des échéances de coactivité. */
export const COACTIVITY_HORIZON_DAYS = 15;
export const DEFAULT_PROXIMITY_METERS = 15;
/** Entité des pièces jointes « plan du site ». */
export const SITE_MAP_ATTACHMENT = 'site_map';

export type ZoneKind = 'batiment' | 'atelier' | 'stockage' | 'atex' | 'essais' | 'quai' | 'parking' | 'exterieur' | 'autre';
export type RouteKind = 'vehicules' | 'pietons' | 'mixte' | 'engins';

/** Types de zones : libellé et teinte (remplissage / contour) sur le thème Nocturne. */
export const ZONE_KINDS: Record<ZoneKind, { label: string; color: string; hatch?: boolean }> = {
  batiment: { label: 'Bâtiment', color: 'var(--color-neutral-400)' },
  atelier: { label: 'Atelier', color: 'var(--color-accent)' },
  stockage: { label: 'Stockage', color: 'oklch(0.74 0.09 215)' },
  atex: { label: 'Zone ATEX', color: 'var(--tone-danger-dot)', hatch: true },
  essais: { label: "Zone d'essais", color: 'var(--tone-warn-dot)', hatch: true },
  quai: { label: 'Quai', color: 'oklch(0.74 0.1 255)' },
  parking: { label: 'Parking', color: 'var(--color-neutral-500)' },
  exterieur: { label: 'Aire extérieure', color: 'var(--tone-ok-dot)' },
  autre: { label: 'Autre', color: 'var(--color-neutral-500)' },
};
export const ZONE_KIND_KEYS = Object.keys(ZONE_KINDS) as ZoneKind[];

/** Types de voies : largeur (px à l'écran), tirets et couleur. */
export const ROUTE_KINDS: Record<RouteKind, { label: string; width: number; dash: number[] | null; color: string; icon: string }> = {
  vehicules: { label: 'Véhicules', width: 8, dash: null, color: 'var(--color-neutral-300)', icon: 'ph-truck' },
  mixte: { label: 'Mixte véhicules / piétons', width: 7, dash: [10, 6], color: 'var(--tone-warn-dot)', icon: 'ph-traffic-sign' },
  engins: { label: 'Engins (chariots, nacelles)', width: 6, dash: [3, 4], color: 'oklch(0.75 0.14 45)', icon: 'ph-crane' },
  pietons: { label: 'Piétons', width: 4, dash: [2, 5], color: 'var(--tone-ok-dot)', icon: 'ph-person-simple-walk' },
};
export const ROUTE_KIND_KEYS = Object.keys(ROUTE_KINDS) as RouteKind[];

export const TEAMS: Record<Team, { label: string; icon: string; color: string }> = {
  interne: { label: 'Équipe interne', icon: 'ph-users-three', color: 'var(--color-accent)' },
  externe: { label: 'Entreprise extérieure', icon: 'ph-hard-hat', color: 'oklch(0.8 0.12 75)' },
};

/** Plans schématiques par défaut (public/plans) : dimensions du viewBox et largeur réelle représentée. */
export const DEFAULT_PLANS: Record<string, { url: string; width: number; height: number; metersPerUnit: number }> = {
  'ville-a': { url: '/plans/ville-a.svg', width: 1600, height: 1000, metersPerUnit: 320 },
  'ville-b': { url: '/plans/ville-b.svg', width: 1600, height: 1000, metersPerUnit: 200 },
};

// ─── Vues sérialisables ─────────────────────────────────────────────────────

export type MapConfig = {
  siteId: string;
  /** Image du plan (fichier importé ou plan schématique) ; null = fond quadrillé. */
  url: string | null;
  width: number;
  height: number;
  /** Hauteur normalisée (hauteur / largeur) : viewBox 0 0 1 aspect. */
  aspect: number;
  metersPerUnit: number | null;
  proximityMeters: number;
  /** Plan importé (et non le plan schématique par défaut). */
  custom: boolean;
  fileName: string | null;
};

export type ZoneView = { id: number; name: string; kind: ZoneKind; polygon: Pt[]; notes: string | null };
export type RouteView = { id: number; name: string; kind: RouteKind; polyline: Pt[]; shared: boolean; notes: string | null };

export type ActivityView = {
  id: number;
  title: string;
  team: Team;
  contractorId: string | null;
  contractor: string | null;
  ownerId: string | null;
  owner: string | null;
  preventionPlanId: string | null;
  /** Statut du plan lié (brouillon, à signer, signé, clos). */
  planStatus: string | null;
  planStatusLabel: string | null;
  planClosed: boolean;
  /** Plan lié signé par les deux entreprises (EU et EE). */
  planSigned: boolean;
  /** Au moins une signature recueillie sur le plan lié (annulée si le plan est modifié). */
  planHasSignature: boolean;
  /** Plan écrit obligatoire selon la règle du site (dès la première minute) ou R. 4512-7. */
  planMandatory: boolean;
  /** Texte actuel des risques d'interférence du plan lié (pour savoir si une coactivité y est déjà reportée). */
  planInterference: string | null;
  permitId: string | null;
  permitType: string | null;
  /** Permis ouverts (demandés ou délivrés) du plan lié, hors permis de l'activité : appliqués les jours de validité. */
  planPermits: CoPermit[];
  dangerousWork: boolean;
  keystoneProject: string | null;
  zoneId: number | null;
  geometry: Geometry | null;
  startOn: string;
  endOn: string;
  hours: string | null;
  routeIds: number[];
  vehicles: boolean;
  notes: string | null;
};

/** Plan de prévention ou permis du site, actif ou débutant sous 15 jours, sans activité sur la carte. */
export type PositionCandidate = {
  kind: 'plan' | 'permit';
  id: string;
  /** Nature des travaux (plan) ou description (permis). */
  title: string;
  location: string;
  contractorId: string | null;
  contractor: string | null;
  ownerId: string | null;
  startOn: string;
  endOn: string;
  hours: string | null;
  keystoneProject: string | null;
  preventionPlanId: string | null;
  permitId: string | null;
  permitType: string | null;
  /** Libellé court : « PP-2026-016 · [Entreprise Élec Industrie] ». */
  label: string;
};

export type Choice = readonly [value: string, label: string];

export type SitemapChoices = {
  contractors: Choice[];
  people: Choice[];
  projects: Choice[];
  /** Plans de prévention du site (non clos) ; `planContractor` donne l'entreprise de chacun. */
  plans: Choice[];
  planContractor: Record<string, string>;
  /** Permis du site non clos ni annulés. */
  permits: Choice[];
};

/** Activité vide pour le formulaire de création (préremplie depuis « À positionner »). */
export type ActivityDraft = Partial<Omit<ActivityView, 'id'>> & { geometry?: Geometry | null; source?: string };

export const isoDate = /^\d{4}-\d{2}-\d{2}$/;
/** Date « AAAA-MM-JJ » existante (rejette 2026-13-45 ou 2026-02-30). */
export const isRealDate = (s: string | null | undefined): s is string => {
  if (!s || !isoDate.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
