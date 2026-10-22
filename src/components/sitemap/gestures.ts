// Gestes tactiles de la carte du site (UX-08) : règles pures, sans DOM (testées dans gestures.test.ts).
// Vue de la carte : centre (cx, cy) en coordonnées normalisées du plan et échelle s (pixels par unité), comme MapCanvas.

export type MapView = { cx: number; cy: number; s: number };
/** Point de l'écran relatif au cadre de la carte (pixels). */
export type ScreenPt = { x: number; y: number };

/**
 * Déplacement en deçà duquel un appui reste un « toucher » (sélection, point de tracé) plutôt qu'un déplacement de la
 * carte : 4 px à la souris (inchangé), 10 px au doigt ou au stylet, qui bougent toujours un peu.
 */
export function tapSlop(pointerType: string): number {
  return pointerType === 'mouse' ? 4 : 10;
}

/**
 * Pincement à deux doigts : nouvelle vue à partir de la vue de départ et des positions de départ et actuelles des deux
 * doigts. Le point du plan sous le milieu des doigts au départ reste sous leur milieu actuel (zoom et déplacement à deux
 * doigts) ; l'échelle suit le rapport des écarts entre les doigts, bornée à [minS, maxS].
 */
export function pinchView(
  start: MapView,
  size: { w: number; h: number },
  from: [ScreenPt, ScreenPt],
  to: [ScreenPt, ScreenPt],
  bounds: { minS: number; maxS: number },
): MapView {
  const gap = (p: [ScreenPt, ScreenPt]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  const mid = (p: [ScreenPt, ScreenPt]): ScreenPt => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
  const g0 = gap(from), g1 = gap(to);
  const factor = g0 > 0 && g1 > 0 ? g1 / g0 : 1;
  const s = Math.min(bounds.maxS, Math.max(bounds.minS, start.s * factor));
  const m0 = mid(from), m1 = mid(to);
  // Point du plan sous le milieu de départ, puis centre qui le replace sous le milieu actuel à la nouvelle échelle.
  const ux = start.cx + (m0.x - size.w / 2) / start.s;
  const uy = start.cy + (m0.y - size.h / 2) / start.s;
  return { s, cx: ux - (m1.x - size.w / 2) / s, cy: uy - (m1.y - size.h / 2) / s };
}
