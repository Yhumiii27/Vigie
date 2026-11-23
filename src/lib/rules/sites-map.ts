// Carte des sites suivis (PRV-24, réponse du 09/11/2026 : « Oui ») : sous « Tous les sites », sur le tableau de bord, les
// sites placés d'après la latitude et la longitude publiées par Matrix (matrix.pub_sites), avec leurs indicateurs. Aucune
// tuile ni service externe : contour simplifié de la France métropolitaine (Corse comprise) en projection équirectangulaire
// (longitudes réduites par le cosinus de la latitude moyenne), dessiné en SVG. Module pur : projection, placement et
// indicateurs, sans session ni base (src/lib/data/sites-map.ts les alimente).

/** Contour simplifié de la France métropolitaine, [longitude, latitude] (sens horaire depuis Dunkerque). */
const MAINLAND: readonly (readonly [number, number])[] = [
  [2.54, 51.09], [3.27, 50.53], [4.23, 49.96], [4.87, 50.15], [5.47, 49.5], [6.36, 49.47], [7.03, 49.19], [8.23, 48.96],
  [7.8, 48.5], [7.59, 47.58], [7.0, 47.45], [6.45, 46.95], [6.12, 46.56], [5.97, 46.13], [6.6, 46.4], [6.8, 46.4],
  [6.95, 45.85], [7.05, 45.45], [6.63, 45.12], [6.85, 44.5], [6.95, 44.25], [7.65, 44.15], [7.53, 43.78], [7.27, 43.7],
  [6.64, 43.27], [5.93, 43.1], [5.37, 43.3], [4.6, 43.4], [3.7, 43.4], [3.05, 42.95], [3.17, 42.44], [2.0, 42.4],
  [1.44, 42.6], [0.7, 42.8], [-0.3, 42.85], [-1.0, 43.05], [-1.78, 43.37], [-1.56, 43.48], [-1.25, 44.6], [-1.15, 45.6],
  [-1.15, 46.15], [-2.15, 46.9], [-2.2, 47.27], [-3.1, 47.5], [-3.4, 47.7], [-4.37, 47.8], [-4.7, 48.0], [-4.77, 48.38],
  [-4.6, 48.6], [-3.9, 48.72], [-3.0, 48.8], [-2.0, 48.65], [-1.5, 48.64], [-1.6, 49.2], [-1.95, 49.72], [-1.62, 49.65],
  [-1.25, 49.7], [-1.1, 49.35], [-0.2, 49.3], [0.1, 49.5], [1.2, 49.95], [1.6, 50.2], [1.6, 50.7], [1.85, 50.95],
];
const CORSICA: readonly (readonly [number, number])[] = [
  [9.4, 43.0], [9.55, 42.1], [9.25, 41.37], [8.8, 41.6], [8.6, 41.9], [8.75, 42.57], [9.3, 42.7],
];

/** Emprise de la carte (un peu de marge autour du contour). */
const BOUNDS = { west: -5.3, east: 9.9, south: 41.2, north: 51.3 };
/** Réduction des longitudes à la latitude moyenne (projection équirectangulaire). */
const LON_SCALE = Math.cos(((BOUNDS.south + BOUNDS.north) / 2) * (Math.PI / 180));
/** Largeur du dessin en unités SVG (hauteur déduite des proportions). */
export const MAP_WIDTH = 320;
const UNIT = MAP_WIDTH / ((BOUNDS.east - BOUNDS.west) * LON_SCALE);
export const MAP_HEIGHT = Math.round((BOUNDS.north - BOUNDS.south) * UNIT);

/** Point de la carte (unités SVG) d'une longitude et d'une latitude. */
export function project(lon: number, lat: number): { x: number; y: number } {
  return { x: Math.round((lon - BOUNDS.west) * LON_SCALE * UNIT * 10) / 10, y: Math.round((BOUNDS.north - lat) * UNIT * 10) / 10 };
}

const path = (points: readonly (readonly [number, number])[]) =>
  `${points.map(([lon, lat], i) => { const p = project(lon, lat); return `${i ? 'L' : 'M'}${p.x} ${p.y}`; }).join(' ')} Z`;

/** Tracé SVG du contour (France continentale et Corse). */
export const FRANCE_PATH = `${path(MAINLAND)} ${path(CORSICA)}`;

/** Coordonnées lues dans Matrix (texte numérique de la vue, ou nombre) ; null si absentes ou hors limites. */
export function parseCoordinates(lat: string | number | null | undefined, lon: string | number | null | undefined): { lat: number; lon: number } | null {
  if (lat == null || lon == null || lat === '' || lon === '') return null;
  const a = Number(lat);
  const o = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90 || Math.abs(o) > 180) return null;
  return { lat: a, lon: o };
}

/** Le point est-il dans l'emprise de la carte (France métropolitaine) ? */
export const onMap = (c: { lat: number; lon: number }) => c.lat >= BOUNDS.south && c.lat <= BOUNDS.north && c.lon >= BOUNDS.west && c.lon <= BOUNDS.east;

export type SiteIndicators = {
  /** Événements ouverts (hors classés sans suite). */
  openEvents: number;
  /** Actions en retard. */
  lateActions: number;
  /** Jours depuis le dernier accident de l'effectif avec arrêt (null : aucun). */
  daysWithoutAccident: number | null;
  /** Plans de prévention en cours ou à venir (ni clos ni annulés). */
  openPlans: number;
};

export type MapSite = { id: string; label: string; coordinates: { lat: number; lon: number } | null; indicators: SiteIndicators };

/** Répartition : sites placés sur la carte (point SVG) et sites sans coordonnées ou hors de la France métropolitaine. */
export function placeSites<T extends MapSite>(sites: readonly T[]): { placed: (T & { x: number; y: number })[]; unplaced: T[] } {
  const placed: (T & { x: number; y: number })[] = [];
  const unplaced: T[] = [];
  for (const s of sites) {
    if (s.coordinates && onMap(s.coordinates)) placed.push({ ...s, ...project(s.coordinates.lon, s.coordinates.lat) });
    else unplaced.push(s);
  }
  return { placed, unplaced };
}

/** Ton du point d'un site : danger (actions en retard), avertissement (événements ouverts), sinon neutre. */
export function siteTone(i: SiteIndicators): 'danger' | 'warn' | 'ok' {
  if (i.lateActions > 0) return 'danger';
  if (i.openEvents > 0) return 'warn';
  return 'ok';
}

/** Résumé textuel d'un site (libellé accessible du point, infobulle). */
export function siteSummary(label: string, i: SiteIndicators): string {
  const days = i.daysWithoutAccident == null ? 'aucun accident avec arrêt' : `${i.daysWithoutAccident} j sans accident avec arrêt`;
  return `${label} : ${i.openEvents} événement${i.openEvents > 1 ? 's' : ''} ouvert${i.openEvents > 1 ? 's' : ''}, `
    + `${i.lateActions} action${i.lateActions > 1 ? 's' : ''} en retard, ${days}, ${i.openPlans} plan${i.openPlans > 1 ? 's' : ''} de prévention ouvert${i.openPlans > 1 ? 's' : ''}`;
}
