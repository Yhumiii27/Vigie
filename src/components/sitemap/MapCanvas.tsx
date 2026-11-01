'use client';

import {
  useEffect, useEffectEvent, useId, useImperativeHandle, useRef, useState, useSyncExternalStore,
  type PointerEvent as ReactPointerEvent, type ReactNode, type Ref,
} from 'react';
import { TONE } from '@/lib/domain';
import { centroid, dist, polylineSegments, type Conflict, type Pt } from '@/lib/rules/coactivity';
import { pinchView, tapSlop, type ScreenPt } from './gestures';
import { ROUTE_KINDS, TEAMS, ZONE_KINDS, type ActivityView, type MapConfig, type RouteView, type ZoneView } from '@/lib/rules/sitemap';
import styles from './sitemap.module.css';

// Carte : plan de fond + surcouche SVG en coordonnées normalisées (viewBox 0 0 1 aspect),
// déplacement (glisser), zoom (molette, boutons), dessin des zones et voies, placement des activités.
// Tactile (UX-08) : déplacement à un doigt, pincement à deux doigts (zoom et déplacement, gestures.ts), sélection d'une
// zone, d'une voie ou d'une activité au toucher (seuil de déplacement plus large qu'à la souris, fiche ouverte comme au
// clic), cibles agrandies sur écran tactile, pas d'infobulle de survol au doigt ; souris inchangée.

export type Layers = { plan: boolean; zones: boolean; routes: boolean; activities: boolean; conflicts: boolean };
export type Tool = 'select' | 'zone' | 'route' | 'activity' | 'measure';
export type Target = { kind: 'zone' | 'route' | 'activity'; id: number };
/** Activité affichée : position (point, centre de sa surface ou de sa zone) et ton de coactivité du jour. */
export type MapActivity = ActivityView & { pos: Pt | null; approx: boolean; tone: 'danger' | 'warn' | null };
export type MapHandle = { centerOn: (pt: Pt, zoom?: number) => void; fit: () => void; finishDrawing: () => void };
/** Tracé en cours (zone ou voie) : nombre de points et tracé suffisant pour être terminé. */
export type DrawState = { points: number; ready: boolean };

type View = { cx: number; cy: number; s: number };
type Size = { w: number; h: number };
type Gesture = {
  id: number; x: number; y: number; view: View; moved: boolean; mode: 'none' | 'pan' | 'vertex' | 'move';
  hit: Target | null; handle: { kind: 'zone' | 'route'; id: number; index: number } | null; points: Pt[] | null;
};
type Drag = { kind: 'zone' | 'route' | 'activity'; id: number; points: Pt[] };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 16;
/** Pointeur principal grossier (écran tactile) : cibles de sélection agrandies. */
const COARSE = '(pointer: coarse)';
const subscribeCoarse = (cb: () => void) => {
  const mq = window.matchMedia(COARSE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
type Pinch = { ids: [number, number]; view: View; from: [ScreenPt, ScreenPt] };
const fmtPts = (pts: Pt[]) => pts.map(([x, y]) => `${x},${y}`).join(' ');
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const parseTarget = (raw: string | null): Target | null => {
  const [kind, id] = (raw ?? '').split(':');
  return (kind === 'zone' || kind === 'route' || kind === 'activity') && Number(id) ? { kind, id: Number(id) } : null;
};
const sameTarget = (a: Target | null, b: Target | null) => !!a && !!b && a.kind === b.kind && a.id === b.id;
/** Rectangle d'emprise d'un libellé en coordonnées du plan : [x1, y1, x2, y2]. */
type Box = [number, number, number, number];
const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

type Props = {
  map: MapConfig;
  zones: ZoneView[];
  routes: RouteView[];
  activities: MapActivity[];
  conflicts: Conflict[];
  layers: Layers;
  /** Plan importé clair : couleurs inversées pour le thème sombre. */
  dimPlan: boolean;
  tool: Tool;
  editable: boolean;
  selection: Target | null;
  activeConflict: string | null;
  /** Vue initiale centrée sur un point (lien profond). */
  initialFocus: Pt | null;
  /** Surcouches (bandeau d'instructions…) ; en fonction, reçoit l'état du tracé en cours. */
  overlay?: ReactNode | ((draw: DrawState) => ReactNode);
  label: string;
  onSelect: (target: Target | null) => void;
  onDrawn: (kind: 'zone' | 'route', points: Pt[]) => void;
  onPlace: (at: Pt) => void;
  onMeasured: (a: Pt, b: Pt) => void;
  onCancelTool: () => void;
  onShapeEdited: (kind: 'zone' | 'route', id: number, points: Pt[]) => void;
  onActivityMoved: (id: number, at: Pt) => void;
  ref?: Ref<MapHandle>;
};

export function MapCanvas(props: Props) {
  const { map, zones, routes, activities, conflicts, layers, dimPlan, tool, editable, selection, activeConflict, initialFocus, overlay, label, ref } = props;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const box = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  // Doigts posés sur la carte (position relative au cadre) et pincement en cours (UX-08).
  const touches = useRef(new Map<number, ScreenPt>());
  const pinch = useRef<Pinch | null>(null);
  const coarse = useSyncExternalStore(subscribeCoarse, () => window.matchMedia(COARSE).matches, () => false);
  const [size, setSize] = useState<Size | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<{ tool: Tool; pts: Pt[] }>({ tool: 'select', pts: [] });
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [hover, setHover] = useState<{ target: Target; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [panning, setPanning] = useState(false);

  const aspect = map.aspect;
  const fitScale = size ? Math.min(size.w, size.h / aspect) * 0.94 : 1;
  const clampView = (v: View): View => {
    const s = Math.min(fitScale * MAX_ZOOM, Math.max(fitScale * MIN_ZOOM, v.s));
    return { s, cx: Math.min(1.2, Math.max(-0.2, v.cx)), cy: Math.min(aspect + 0.2, Math.max(-0.2, v.cy)) };
  };
  const fitView: View = { cx: 0.5, cy: aspect / 2, s: fitScale };
  const v: View = view ?? (initialFocus ? clampView({ cx: initialFocus[0], cy: initialFocus[1], s: fitScale * 2.2 }) : fitView);
  const w = size?.w ?? 0, h = size?.h ?? 0;
  const vb = { x: v.cx - w / 2 / v.s, y: v.cy - h / 2 / v.s, w: w / v.s, h: h / v.s };
  const px = (n: number) => n / v.s;
  const pts = draft.tool === tool ? draft.pts : [];

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toUnit = (clientX: number, clientY: number): Pt => {
    const r = box.current!.getBoundingClientRect();
    return [vb.x + (clientX - r.left) / v.s, vb.y + (clientY - r.top) / v.s];
  };
  const zoomAt = (mx: number, my: number, factor: number) => {
    const u: Pt = [vb.x + mx / v.s, vb.y + my / v.s];
    const s = Math.min(fitScale * MAX_ZOOM, Math.max(fitScale * MIN_ZOOM, v.s * factor));
    setView(clampView({ s, cx: u[0] - (mx - w / 2) / s, cy: u[1] - (my - h / 2) / s }));
  };

  const shapeOf = (kind: 'zone' | 'route', id: number) =>
    (kind === 'zone' ? zones.find((z) => z.id === id)?.polygon : routes.find((r) => r.id === id)?.polyline) ?? [];
  const resetDraft = () => { setDraft({ tool, pts: [] }); setCursor(null); };
  /** Points du tracé sans les doublons (double-clic). */
  const cleanDraft = (points: Pt[]) => points.filter((p, i) => i === 0 || dist(p, points[i - 1]) > px(4));
  const minPoints = tool === 'zone' ? 3 : tool === 'route' ? 2 : Infinity;
  const finish = (points: Pt[]) => {
    const clean = cleanDraft(points);
    if ((tool === 'zone' || tool === 'route') && clean.length >= minPoints) { resetDraft(); props.onDrawn(tool, clean); }
  };
  const drawState: DrawState = { points: pts.length, ready: cleanDraft(pts).length >= minPoints };

  useImperativeHandle(ref, () => ({
    centerOn: (pt, zoom = 2.2) => setView((cur) => {
      const base = cur ?? fitView;
      return clampView({ cx: pt[0], cy: pt[1], s: Math.max(base.s, fitScale * zoom) });
    }),
    fit: () => setView(fitView),
    finishDrawing: () => finish(pts),
  }));

  const onWheel = useEffectEvent((e: WheelEvent) => {
    if (!size || !box.current) return;
    e.preventDefault();
    const r = box.current.getBoundingClientRect();
    const k = e.ctrlKey ? 0.01 : e.deltaMode === 1 ? 0.05 : 0.0015;
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * k));
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const handler = (e: WheelEvent) => onWheel(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
    // Carte au clavier (focus sur la carte) : flèches pour se déplacer, + / − pour zoomer, 0 pour ajuster.
    if (target === box.current && size) {
      const step = 80 / v.s;
      const pan: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (pan[e.key]) { e.preventDefault(); setView(clampView({ ...v, cx: v.cx + pan[e.key][0], cy: v.cy + pan[e.key][1] })); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(w / 2, h / 2, 1.4); return; }
      if (e.key === '-') { e.preventDefault(); zoomAt(w / 2, h / 2, 1 / 1.4); return; }
      if (e.key === '0') { e.preventDefault(); setView(fitView); return; }
    }
    if (tool === 'zone' || tool === 'route' || tool === 'measure') {
      if (e.key === 'Escape') { e.preventDefault(); if (pts.length) resetDraft(); else props.onCancelTool(); }
      else if (e.key === 'Enter' && tool !== 'measure') { e.preventDefault(); finish(pts); }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && pts.length) { e.preventDefault(); setDraft({ tool, pts: pts.slice(0, -1) }); }
    } else if (tool === 'activity') {
      if (e.key === 'Escape') { e.preventDefault(); props.onCancelTool(); }
    } else if (e.key === 'Escape' && selection) {
      props.onSelect(null);
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── Pointeur ───────────────────────────────────────────────────────────

  const local = (e: ReactPointerEvent<HTMLDivElement>): ScreenPt => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const endPinch = () => { pinch.current = null; };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !size) return;
    const el = e.target as Element;
    if (el.closest('button, a, input, select, textarea, [data-overlay]')) return;
    if (e.pointerType !== 'mouse') {
      touches.current.set(e.pointerId, local(e));
      // Deuxième doigt : pincement ; le geste du premier (déplacement, poignée, activité) est abandonné sans rien enregistrer.
      if (touches.current.size >= 2) {
        if (!pinch.current) {
          const [a, b] = [...touches.current.entries()];
          pinch.current = { ids: [a[0], b[0]], view: v, from: [a[1], b[1]] };
          gesture.current = null;
          setDrag(null);
          setPanning(false);
          setHover(null);
        }
        box.current?.setPointerCapture(e.pointerId);
        return;
      }
    }
    const hit = parseTarget(el.closest('[data-hit]')?.getAttribute('data-hit') ?? null);
    const raw = editable && tool === 'select' ? el.closest('[data-handle]')?.getAttribute('data-handle') : null;
    const [hk, hid, hi] = raw?.split(':') ?? [];
    const handle = raw && (hk === 'zone' || hk === 'route') ? { kind: hk, id: Number(hid), index: Number(hi) } as const : null;
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, view: v, moved: false, mode: 'none', hit, handle, points: null };
    box.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, local(e));
    const p2 = pinch.current;
    if (p2) {
      if (!p2.ids.includes(e.pointerId) || !size) return;
      const [a, b] = p2.ids.map((id) => touches.current.get(id));
      if (!a || !b) return;
      setView(clampView(pinchView(p2.view, { w, h }, p2.from, [a, b], { minS: fitScale * MIN_ZOOM, maxS: fitScale * MAX_ZOOM })));
      return;
    }
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) {
      // Survol : souris (et stylet en survol) seulement ; au doigt, la fiche résumée s'ouvre au toucher (onPointerUp).
      if (e.pointerType === 'touch') return;
      if ((tool === 'zone' || tool === 'route' || tool === 'measure') && pts.length) setCursor(toUnit(e.clientX, e.clientY));
      const el = e.target as Element;
      const target = el.closest('[data-overlay]') ? null : parseTarget(el.closest('[data-hit]')?.getAttribute('data-hit') ?? null);
      const r = box.current!.getBoundingClientRect();
      setHover(target ? { target, x: e.clientX - r.left, y: e.clientY - r.top } : null);
      return;
    }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < tapSlop(e.pointerType)) return;
      g.moved = true;
      g.mode = g.handle ? 'vertex'
        : g.hit?.kind === 'activity' && editable && tool === 'select' && sameTarget(g.hit, selection) ? 'move' : 'pan';
      setHover(null);
      if (g.mode === 'pan') setPanning(true);
    }
    if (g.mode === 'pan') {
      setView(clampView({ cx: g.view.cx - dx / g.view.s, cy: g.view.cy - dy / g.view.s, s: g.view.s }));
    } else if (g.mode === 'vertex' && g.handle) {
      const p = toUnit(e.clientX, e.clientY);
      const { kind, id, index } = g.handle;
      g.points = shapeOf(kind, id).map((q, i) => (i === index ? p : q));
      setDrag({ kind, id, points: g.points });
    } else if (g.mode === 'move' && g.hit) {
      g.points = [toUnit(e.clientX, e.clientY)];
      setDrag({ kind: 'activity', id: g.hit.id, points: g.points });
    }
  };

  const click = (e: ReactPointerEvent<HTMLDivElement>, hit: Target | null) => {
    const p = toUnit(e.clientX, e.clientY);
    if (tool === 'select') props.onSelect(hit);
    else if (tool === 'zone' || tool === 'route') { setDraft({ tool, pts: [...pts, p] }); setCursor(p); }
    else if (tool === 'activity') props.onPlace(p);
    else if (tool === 'measure') {
      if (pts.length === 1) { const a = pts[0]; resetDraft(); props.onMeasured(a, p); }
      else { setDraft({ tool, pts: [p] }); setCursor(p); }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    if (pinch.current) {
      // Fin du pincement dès qu'un des deux doigts se lève ; le doigt restant ne déplace ni ne sélectionne rien.
      if (box.current?.hasPointerCapture(e.pointerId)) box.current.releasePointerCapture(e.pointerId);
      if (pinch.current.ids.includes(e.pointerId)) endPinch();
      return;
    }
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    setPanning(false);
    if (box.current?.hasPointerCapture(e.pointerId)) box.current.releasePointerCapture(e.pointerId);
    // Toucher (doigt, stylet : seuil tapSlop) comme clic : sélection et fiche de l'élément touché, point de tracé.
    if (!g.moved) { click(e, g.hit); return; }
    if (g.mode === 'vertex' && g.handle && g.points) props.onShapeEdited(g.handle.kind, g.handle.id, g.points);
    if (g.mode === 'move' && g.hit && g.points) props.onActivityMoved(g.hit.id, g.points[0]);
    setDrag(null);
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    if (pinch.current?.ids.includes(e.pointerId)) endPinch();
    gesture.current = null; setPanning(false); setDrag(null);
  };

  // ─── Rendu ──────────────────────────────────────────────────────────────

  const zoneTone = new Map<number, 'danger' | 'warn'>();
  const routeTone = new Map<number, 'danger' | 'warn'>();
  if (layers.conflicts) {
    conflicts.forEach((c) => c.reasons.forEach((r) => {
      if (r.code === 'same_zone' && r.zoneId != null && zoneTone.get(r.zoneId) !== 'danger') zoneTone.set(r.zoneId, r.tone);
      if (r.routeId != null && routeTone.get(r.routeId) !== 'danger') routeTone.set(r.routeId, r.tone);
    }));
  }
  const active = conflicts.find((c) => c.key === activeConflict) ?? null;
  const zoneShape = (z: ZoneView) => (drag?.kind === 'zone' && drag.id === z.id ? drag.points : z.polygon);
  const routeShape = (r: RouteView) => (drag?.kind === 'route' && drag.id === r.id ? drag.points : r.polyline);
  const actPos = (a: MapActivity) => (drag?.kind === 'activity' && drag.id === a.id ? drag.points[0] : a.pos);
  const posById = new Map(activities.map((a) => [a.id, actPos(a)]));
  const zoomed = v.s / fitScale;
  const selected = (kind: Target['kind'], id: number) => selection?.kind === kind && selection.id === id;
  const hoverTarget = hover?.target ?? null;
  const zoneLabels = !layers.plan || !map.url || map.custom || zoomed >= 1.6;

  // Échelle graphique
  let scaleBar: { width: number; label: string } | null = null;
  if (map.metersPerUnit) {
    const pxPerMeter = v.s / map.metersPerUnit;
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((m) => m * pxPerMeter >= 64) ?? 5000;
    scaleBar = { width: nice * pxPerMeter, label: `${nice.toLocaleString('fr-FR')} m` };
  }

  const tooltip = (() => {
    if (!hover || drag || panning) return null;
    const t = hover.target;
    if (t.kind === 'zone') {
      const z = zones.find((x) => x.id === t.id);
      return z && <><strong>{z.name}</strong><span>{ZONE_KINDS[z.kind].label}{z.notes ? ` · ${truncate(z.notes, 90)}` : ''}</span></>;
    }
    if (t.kind === 'route') {
      const r = routes.find((x) => x.id === t.id);
      return r && <><strong>{r.name}</strong><span>{ROUTE_KINDS[r.kind].label}{r.shared ? ' · voie commune' : ' · voie réservée'}</span></>;
    }
    const a = activities.find((x) => x.id === t.id);
    if (!a) return null;
    return (
      <>
        <strong>{a.title}</strong>
        <span>{a.team === 'externe' ? a.contractor ?? 'Entreprise extérieure' : 'Équipe interne'}{a.owner ? ` · ${a.owner}` : ''}</span>
        <span>{a.startOn === a.endOn ? `Le ${a.startOn.slice(8, 10)}/${a.startOn.slice(5, 7)}` : `Du ${a.startOn.slice(8, 10)}/${a.startOn.slice(5, 7)} au ${a.endOn.slice(8, 10)}/${a.endOn.slice(5, 7)}`}{a.hours ? ` · ${a.hours}` : ''}{a.vehicles ? ' · véhicules / engins' : ''}</span>
        {a.approx && <span style={{ color: 'var(--color-neutral-500)' }}>Position approximative (centre de la zone)</span>}
        {a.tone && <span style={{ color: TONE[a.tone].fg }}>Situation de coactivité ce jour</span>}
      </>
    );
  })();

  const cursorStyle = panning || drag ? 'grabbing'
    : tool === 'select' ? (hoverTarget ? (hoverTarget.kind === 'activity' && editable && sameTarget(hoverTarget, selection) ? 'move' : 'pointer') : 'grab')
      : 'crosshair';
  const preview = cursor && pts.length ? [...pts, cursor] : pts;
  const measured = tool === 'measure' && pts.length === 1 && cursor ? dist(pts[0], cursor) : null;
  const hatchKinds = ['atex', 'essais'] as const;

  // Libellés des voies et des activités, placés sans chevauchement (emprises approchées en coordonnées du plan).
  // À l'échelle de l'écran entier : voies communes ou en coactivité et activités en coactivité ; tous au zoom.
  const placed: Box[] = [];
  const free = (b: Box) => !placed.some((o) => overlaps(b, o));
  const routeLabels = !layers.routes ? [] : routes.flatMap((r) => {
    const tone = routeTone.get(r.id) ?? null;
    if (!(zoomed >= 1.15 || selected('route', r.id) || r.shared || tone)) return [];
    const segs = polylineSegments(routeShape(r));
    const longest = segs.reduce<[Pt, Pt] | null>((best, sg) => (!best || dist(sg[0], sg[1]) > dist(best[0], best[1]) ? sg : best), null);
    if (!longest || dist(longest[0], longest[1]) * v.s < 110) return [];
    const [a, b] = longest;
    let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle <= -90) angle += 180;
    const at: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const text = truncate(r.name, Math.floor((dist(a, b) * v.s) / 6));
    const dy = -px(ROUTE_KINDS[r.kind].width / 2 + 5);
    // Emprise du texte tourné : rectangle (largeur × 12 px) centré au-dessus du tracé.
    const rad = (angle * Math.PI) / 180, cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    const tw = px(text.length * 5.6), th = px(12), off = dy - px(3);
    const c: Pt = [at[0] - off * Math.sin(rad), at[1] + off * Math.cos(rad)];
    const hx = (cos * tw + sin * th) / 2, hy = (sin * tw + cos * th) / 2;
    const box: Box = [c[0] - hx, c[1] - hy, c[0] + hx, c[1] + hy];
    if (!selected('route', r.id) && !free(box)) return [];
    placed.push(box);
    return [{ id: r.id, at, angle, dy, text, tone }];
  });
  const markers = new Map<number, Box>();
  if (layers.activities) activities.forEach((a) => { const p = actPos(a); if (p) markers.set(a.id, [p[0] - px(9), p[1] - px(9), p[0] + px(9), p[1] + px(9)]); });
  const toneRank = (a: MapActivity) => (a.tone === 'danger' ? 0 : a.tone === 'warn' ? 1 : 2);
  const activityLabels = !layers.activities ? [] : activities
    .map((a) => {
      const inActive = !!active && (active.a === a.id || active.b === a.id);
      const forced = selected('activity', a.id) || inActive || (hoverTarget?.kind === 'activity' && hoverTarget.id === a.id);
      return { a, forced, shown: forced || zoomed >= 1.6 || (!!a.tone && layers.conflicts) };
    })
    .filter((x) => x.shown && actPos(x.a))
    .sort((x, y) => Number(y.forced) - Number(x.forced) || toneRank(x.a) - toneRank(y.a) || x.a.id - y.a.id)
    .flatMap(({ a, forced }) => {
      const p = actPos(a)!;
      const text = truncate(a.title, zoomed >= 1.6 || forced ? 38 : 30);
      const tw = px(text.length * 6.1);
      const right: Box = [p[0] + px(14), p[1] - px(8), p[0] + px(14) + tw, p[1] + px(5)];
      const left: Box = [p[0] - px(14) - tw, p[1] - px(8), p[0] - px(14), p[1] + px(5)];
      const clear = (b: Box) => free(b) && ![...markers].some(([id, m]) => id !== a.id && overlaps(b, m));
      const side = clear(right) ? 'right' : clear(left) ? 'left' : forced ? 'right' : null;
      if (!side) return [];
      placed.push(side === 'right' ? right : left);
      return [{
        id: a.id, text, tone: layers.conflicts ? a.tone : null,
        x: side === 'right' ? p[0] + px(14) : p[0] - px(14), y: p[1] + px(4), anchor: side === 'right' ? 'start' as const : 'end' as const,
      }];
    });

  return (
    <div ref={box} className={styles.map} tabIndex={0} role="application" aria-label={`${label}. Flèches pour se déplacer, + et − pour zoomer, 0 pour ajuster.`} aria-roledescription="carte"
      style={{ cursor: cursorStyle }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}
      onDoubleClick={() => { if (tool === 'zone' || tool === 'route') finish(pts); }}>
      {size && (
        <svg width={w} height={h} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="none" aria-hidden>
          <defs>
            {hatchKinds.map((k) => (
              <pattern key={k} id={`${uid}-hatch-${k}`} patternUnits="userSpaceOnUse" width={px(11)} height={px(11)} patternTransform="rotate(45)">
                <line x1={0} y1={0} x2={0} y2={px(11)} style={{ stroke: ZONE_KINDS[k].color, strokeOpacity: k === 'atex' ? 0.3 : 0.18, strokeWidth: px(2) }} />
              </pattern>
            ))}
            <pattern id={`${uid}-grid`} patternUnits="userSpaceOnUse" width={0.025} height={0.025}>
              <path d="M0.025 0H0V0.025" style={{ fill: 'none', stroke: 'var(--color-neutral-800)', strokeWidth: px(1) }} />
            </pattern>
          </defs>

          <rect x={0} y={0} width={1} height={aspect} style={{ fill: 'color-mix(in srgb, var(--color-surface) 40%, var(--color-bg))' }} />
          {map.url && layers.plan
            ? <image href={map.url} x={0} y={0} width={1} height={aspect} preserveAspectRatio="none"
              style={dimPlan ? { filter: 'invert(1) hue-rotate(180deg) brightness(0.8) contrast(0.9)' } : undefined} />
            : <rect x={0} y={0} width={1} height={aspect} fill={`url(#${uid}-grid)`} />}

          {layers.zones && zones.map((z) => {
            const spec = ZONE_KINDS[z.kind];
            const shape = zoneShape(z);
            const tone = zoneTone.get(z.id);
            const on = selected('zone', z.id);
            const hovered = hoverTarget?.kind === 'zone' && hoverTarget.id === z.id;
            return (
              <g key={z.id}>
                <polygon points={fmtPts(shape)} data-hit={`zone:${z.id}`} style={{
                  fill: `color-mix(in srgb, ${spec.color} ${on ? 24 : hovered ? 18 : 11}%, transparent)`,
                  stroke: on ? 'var(--color-accent)' : spec.color, strokeOpacity: on ? 1 : 0.7, strokeWidth: px(on ? 2.5 : 1.5), strokeLinejoin: 'round',
                }} />
                {spec.hatch && <polygon points={fmtPts(shape)} fill={`url(#${uid}-hatch-${z.kind})`} pointerEvents="none" />}
                {tone && <polygon points={fmtPts(shape)} pointerEvents="none" style={{ fill: 'none', stroke: TONE[tone].dot, strokeWidth: px(2.5), strokeDasharray: `${px(8)} ${px(5)}` }} />}
              </g>
            );
          })}

          {layers.routes && routes.map((r) => {
            const spec = ROUTE_KINDS[r.kind];
            const line = fmtPts(routeShape(r));
            const tone = routeTone.get(r.id);
            const on = selected('route', r.id);
            const inActive = !!active?.routeIds.includes(r.id);
            const base = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
            return (
              <g key={r.id}>
                {r.shared && <polyline points={line} pointerEvents="none" style={{ ...base, stroke: 'var(--color-accent)', strokeOpacity: 0.22, strokeWidth: px(spec.width + 9) }} />}
                {tone && <polyline points={line} pointerEvents="none" className={inActive ? styles.pulse : undefined}
                  style={{ ...base, stroke: TONE[tone].dot, strokeOpacity: inActive ? 0.75 : 0.45, strokeWidth: px(spec.width + (inActive ? 16 : 11)) }} />}
                {on && <polyline points={line} pointerEvents="none" style={{ ...base, stroke: 'var(--color-accent)', strokeWidth: px(spec.width + 5) }} />}
                <polyline points={line} pointerEvents="none" style={{
                  ...base, stroke: spec.color, strokeOpacity: 0.85, strokeWidth: px(spec.width),
                  strokeDasharray: spec.dash ? spec.dash.map(px).join(' ') : undefined, strokeLinecap: spec.dash ? 'butt' : 'round',
                }} />
                <polyline points={line} data-hit={`route:${r.id}`} pointerEvents="stroke" style={{ ...base, stroke: 'transparent', strokeWidth: px(Math.max(coarse ? 28 : 16, spec.width + 10)) }} />
              </g>
            );
          })}

          {layers.conflicts && layers.activities && conflicts.map((c) => {
            const a = posById.get(c.a), b = posById.get(c.b);
            if (!a || !b) return null;
            const on = c.key === activeConflict;
            return <line key={c.key} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} pointerEvents="none"
              style={{ stroke: TONE[c.tone].dot, strokeWidth: px(on ? 2.5 : 1.5), strokeDasharray: `${px(6)} ${px(4)}`, opacity: on ? 1 : 0.65 }} />;
          })}

          {layers.activities && activities.map((a) => {
            const p = actPos(a);
            if (!p) return null;
            const on = selected('activity', a.id);
            const inActive = !!active && (active.a === a.id || active.b === a.id);
            const fill = TEAMS[a.team].color;
            const mark = { stroke: 'var(--color-bg)', strokeWidth: px(2), fill, opacity: a.approx ? 0.6 : 1, strokeDasharray: a.approx ? `${px(2)} ${px(2)}` : undefined };
            return (
              <g key={a.id} data-hit={`activity:${a.id}`} transform={`translate(${p[0]} ${p[1]})`}>
                <circle r={px(coarse ? 22 : 15)} style={{ fill: 'transparent' }} />
                {a.tone && layers.conflicts && (
                  <circle r={px(inActive ? 16 : 13)} className={inActive ? styles.pulse : undefined}
                    style={{ fill: `color-mix(in srgb, ${TONE[a.tone].dot} 22%, transparent)`, stroke: TONE[a.tone].dot, strokeWidth: px(2.5) }} />
                )}
                {on && <circle r={px(18)} style={{ fill: 'none', stroke: 'var(--color-accent)', strokeWidth: px(2) }} />}
                {a.vehicles && <circle r={px(10.5)} style={{ fill: 'none', stroke: 'var(--color-neutral-200)', strokeWidth: px(1.3), strokeDasharray: `${px(2.5)} ${px(2)}` }} />}
                {a.team === 'interne'
                  ? <circle r={px(6.5)} style={mark} />
                  : <rect x={-px(5.5)} y={-px(5.5)} width={px(11)} height={px(11)} transform="rotate(45)" style={mark} />}
              </g>
            );
          })}

          {/* Libellés (sans interaction) */}
          <g pointerEvents="none" style={{ paintOrder: 'stroke', stroke: 'var(--color-bg)', strokeWidth: px(3), strokeLinejoin: 'round' }}>
            {layers.zones && zones.map((z) => {
              const shape = zoneShape(z);
              const xs = shape.map((p) => p[0]), ys = shape.map((p) => p[1]);
              const minX = Math.min(...xs), maxX = Math.max(...xs), maxY = Math.max(...ys);
              const on = selected('zone', z.id);
              const hovered = hoverTarget?.kind === 'zone' && hoverTarget.id === z.id;
              // Le plan schématique nomme déjà les bâtiments : libellés de zone au zoom, à la sélection ou sur un plan importé.
              if (!(on || hovered || zoneLabels) || (maxX - minX) * v.s < 70) return null;
              return (
                <text key={z.id} x={minX + px(6)} y={maxY - px(6)} fontSize={px(10.5)} style={{ fill: on ? 'var(--color-accent-200)' : ZONE_KINDS[z.kind].color, fontWeight: on ? 500 : 400, letterSpacing: '.02em' }}>
                  {truncate(z.name, Math.max(8, Math.floor(((maxX - minX) * v.s - 12) / 6)))}
                </text>
              );
            })}
            {routeLabels.map((l) => (
              <text key={l.id} x={l.at[0]} y={l.at[1]} dy={l.dy} fontSize={px(10)} textAnchor="middle" transform={`rotate(${l.angle} ${l.at[0]} ${l.at[1]})`}
                style={{ fill: l.tone ? TONE[l.tone].fg : 'var(--color-neutral-300)' }}>
                {l.text}
              </text>
            ))}
            {activityLabels.map((l) => (
              <text key={l.id} x={l.x} y={l.y} fontSize={px(11)} textAnchor={l.anchor} style={{ fill: l.tone ? TONE[l.tone].fg : 'var(--color-neutral-100)' }}>
                {l.text}
              </text>
            ))}
          </g>

          {/* Sommets déplaçables de la zone ou de la voie sélectionnée */}
          {editable && tool === 'select' && selection && selection.kind !== 'activity' && (selection.kind === 'zone' ? layers.zones : layers.routes) && (() => {
            const shape = selection.kind === 'zone'
              ? zones.find((z) => z.id === selection.id) && zoneShape(zones.find((z) => z.id === selection.id)!)
              : routes.find((r) => r.id === selection.id) && routeShape(routes.find((r) => r.id === selection.id)!);
            return (shape || []).map((p, i) => (
              <rect key={i} data-handle={`${selection.kind}:${selection.id}:${i}`} x={p[0] - px(coarse ? 9 : 5)} y={p[1] - px(coarse ? 9 : 5)}
                width={px(coarse ? 18 : 10)} height={px(coarse ? 18 : 10)} rx={px(2)}
                style={{ fill: 'var(--color-bg)', stroke: 'var(--color-accent)', strokeWidth: px(1.6), cursor: 'move' }} />
            ));
          })()}

          {/* Tracé en cours */}
          {pts.length > 0 && (tool === 'zone' || tool === 'route') && (
            <g pointerEvents="none">
              {tool === 'zone' && preview.length >= 3 && <polygon points={fmtPts(preview)} style={{ fill: 'color-mix(in srgb, var(--color-accent) 16%, transparent)', stroke: 'none' }} />}
              <polyline points={fmtPts(tool === 'zone' && preview.length >= 3 ? [...preview, preview[0]] : preview)}
                style={{ fill: 'none', stroke: 'var(--color-accent)', strokeWidth: px(2), strokeDasharray: `${px(6)} ${px(4)}`, strokeLinejoin: 'round' }} />
              {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={px(i === 0 ? 5 : 3.5)} style={{ fill: i === 0 ? 'var(--color-accent)' : 'var(--color-bg)', stroke: 'var(--color-accent)', strokeWidth: px(1.5) }} />)}
            </g>
          )}
          {tool === 'measure' && pts.length > 0 && (
            <g pointerEvents="none">
              {cursor && <line x1={pts[0][0]} y1={pts[0][1]} x2={cursor[0]} y2={cursor[1]} style={{ stroke: 'var(--tone-warn-dot)', strokeWidth: px(2), strokeDasharray: `${px(6)} ${px(4)}` }} />}
              <circle cx={pts[0][0]} cy={pts[0][1]} r={px(5)} style={{ fill: 'var(--tone-warn-dot)', stroke: 'var(--color-bg)', strokeWidth: px(1.5) }} />
              {measured != null && cursor && map.metersPerUnit && (
                <text x={cursor[0] + px(10)} y={cursor[1] - px(10)} fontSize={px(11.5)} style={{ fill: 'var(--tone-warn-fg)', paintOrder: 'stroke', stroke: 'var(--color-bg)', strokeWidth: px(3) }}>
                  ≈ {(measured * map.metersPerUnit).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} m (échelle actuelle)
                </text>
              )}
            </g>
          )}
          {/* Contour de la zone de la situation sélectionnée */}
          {active && layers.conflicts && active.zoneIds.map((id) => {
            const z = zones.find((x) => x.id === id);
            return z ? <polygon key={id} points={fmtPts(zoneShape(z))} pointerEvents="none" style={{ fill: 'none', stroke: TONE[active.tone].dot, strokeWidth: px(3) }} /> : null;
          })}
        </svg>
      )}

      <div className={styles.controls} data-overlay>
        <button type="button" className={styles.ctrl} aria-label="Zoom avant" title="Zoom avant" onClick={() => zoomAt(w / 2, h / 2, 1.4)} disabled={v.s >= fitScale * MAX_ZOOM - 1e-6}>
          <i className="ph ph-magnifying-glass-plus" style={{ fontSize: 15 }} aria-hidden />
        </button>
        <button type="button" className={styles.ctrl} aria-label="Zoom arrière" title="Zoom arrière" onClick={() => zoomAt(w / 2, h / 2, 1 / 1.4)} disabled={v.s <= fitScale * MIN_ZOOM + 1e-6}>
          <i className="ph ph-magnifying-glass-minus" style={{ fontSize: 15 }} aria-hidden />
        </button>
        <button type="button" className={styles.ctrl} aria-label="Ajuster le plan à l'écran" title="Ajuster le plan à l'écran" onClick={() => setView(fitView)}>
          <i className="ph ph-corners-out" style={{ fontSize: 15 }} aria-hidden />
        </button>
      </div>

      <div className={styles.scale} aria-live="polite">
        {scaleBar
          ? <><span>{scaleBar.label}</span><span className={styles.scaleBar} style={{ width: scaleBar.width }} /></>
          : <span>Échelle non étalonnée</span>}
      </div>

      {tooltip && hover && (
        <div className={styles.tooltip} style={{ left: Math.min(hover.x + 14, Math.max(0, w - 290)), top: hover.y + 16 > h - 90 ? hover.y - 80 : hover.y + 16 }}>
          {tooltip}
        </div>
      )}
      {typeof overlay === 'function' ? overlay(drawState) : overlay}
    </div>
  );
}

/** Position affichée d'une activité : son point, le centre de sa surface ou, à défaut, le centre de sa zone. */
export function activityPosition(a: ActivityView, zones: ZoneView[]): { pos: Pt | null; approx: boolean } {
  if (a.geometry?.type === 'point') return { pos: a.geometry.at, approx: false };
  if (a.geometry?.type === 'polygon') return { pos: centroid(a.geometry.points), approx: false };
  const z = a.zoneId != null ? zones.find((x) => x.id === a.zoneId) : undefined;
  return z ? { pos: centroid(z.polygon), approx: true } : { pos: null, approx: false };
}
