import { describe, expect, it } from 'vitest';
import { pinchView, tapSlop, type MapView, type ScreenPt } from './gestures';

// UX-08 : pincement à deux doigts et seuil du toucher de la carte du site.

const size = { w: 400, h: 300 };
const bounds = { minS: 100, maxS: 10_000 };
const start: MapView = { cx: 0.5, cy: 0.3, s: 400 };
const pt = (x: number, y: number): ScreenPt => ({ x, y });
/** Point du plan affiché à un point de l'écran pour une vue. */
const unitAt = (v: MapView, p: ScreenPt) => [v.cx + (p.x - size.w / 2) / v.s, v.cy + (p.y - size.h / 2) / v.s];

describe('pincement', () => {
  it('doigts immobiles : vue inchangée', () => {
    const fingers: [ScreenPt, ScreenPt] = [pt(150, 120), pt(250, 180)];
    expect(pinchView(start, size, fingers, fingers, bounds)).toEqual(start);
  });

  it('écart doublé : échelle doublée, le point sous les doigts ne bouge pas', () => {
    const from: [ScreenPt, ScreenPt] = [pt(150, 150), pt(250, 150)];
    const to: [ScreenPt, ScreenPt] = [pt(100, 150), pt(300, 150)];
    const v = pinchView(start, size, from, to, bounds);
    expect(v.s).toBeCloseTo(800);
    const [ux, uy] = unitAt(start, pt(200, 150));
    const [vx, vy] = unitAt(v, pt(200, 150));
    expect(vx).toBeCloseTo(ux);
    expect(vy).toBeCloseTo(uy);
  });

  it('zoom hors du centre : le point du plan sous le milieu des doigts y reste', () => {
    const from: [ScreenPt, ScreenPt] = [pt(40, 40), pt(80, 80)];
    const to: [ScreenPt, ScreenPt] = [pt(20, 20), pt(100, 100)];
    const v = pinchView(start, size, from, to, bounds);
    const [ux, uy] = unitAt(start, pt(60, 60));
    const [vx, vy] = unitAt(v, pt(60, 60));
    expect(v.s).toBeCloseTo(800);
    expect(vx).toBeCloseTo(ux);
    expect(vy).toBeCloseTo(uy);
  });

  it('deux doigts déplacés ensemble : la carte suit (déplacement sans zoom)', () => {
    const from: [ScreenPt, ScreenPt] = [pt(150, 150), pt(250, 150)];
    const to: [ScreenPt, ScreenPt] = [pt(190, 110), pt(290, 110)];
    const v = pinchView(start, size, from, to, bounds);
    expect(v.s).toBe(400);
    expect(v.cx).toBeCloseTo(0.5 - 40 / 400);
    expect(v.cy).toBeCloseTo(0.3 + 40 / 400);
  });

  it('échelle bornée ; doigts confondus sans effet sur l’échelle', () => {
    const from: [ScreenPt, ScreenPt] = [pt(190, 150), pt(210, 150)];
    expect(pinchView(start, size, from, [pt(0, 150), pt(400, 150)], { minS: 100, maxS: 1000 }).s).toBe(1000);
    expect(pinchView(start, size, from, [pt(199, 150), pt(201, 150)], { minS: 300, maxS: 1000 }).s).toBe(300);
    expect(pinchView(start, size, [pt(200, 150), pt(200, 150)], [pt(100, 150), pt(300, 150)], bounds).s).toBe(400);
  });
});

describe('toucher ou déplacer', () => {
  it('souris inchangée (4 px) ; doigt et stylet plus tolérants', () => {
    expect(tapSlop('mouse')).toBe(4);
    expect(tapSlop('touch')).toBe(10);
    expect(tapSlop('pen')).toBe(10);
  });
});
