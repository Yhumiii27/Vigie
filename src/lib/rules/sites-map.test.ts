import { describe, expect, it } from 'vitest';
import { FRANCE_PATH, MAP_HEIGHT, MAP_WIDTH, onMap, parseCoordinates, placeSites, project, siteSummary, siteTone } from './sites-map';

const ind = { openEvents: 0, lateActions: 0, daysWithoutAccident: null, openPlans: 0 };

describe('carte des sites (PRV-24)', () => {
  it('projection équirectangulaire : ouest à gauche, nord en haut, dans le cadre', () => {
    const brest = project(-4.49, 48.39);
    const strasbourg = project(7.75, 48.58);
    const marseille = project(5.37, 43.3);
    expect(brest.x).toBeLessThan(strasbourg.x);
    expect(strasbourg.y).toBeLessThan(marseille.y);
    for (const p of [brest, strasbourg, marseille]) {
      expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(MAP_WIDTH);
      expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(MAP_HEIGHT);
    }
    expect(FRANCE_PATH.match(/Z/g)).toHaveLength(2);
  });

  it('coordonnées de Matrix : texte numérique accepté, absentes ou hors limites refusées', () => {
    expect(parseCoordinates('47.321600', '5.041500')).toEqual({ lat: 47.3216, lon: 5.0415 });
    expect(parseCoordinates(null, '5')).toBeNull();
    expect(parseCoordinates('abc', '5')).toBeNull();
    expect(parseCoordinates('95', '5')).toBeNull();
    expect(onMap({ lat: 14.6, lon: -61 })).toBe(false); // Martinique : listée sous la carte
  });

  it('sites placés ou listés sous la carte ; ton et résumé du point', () => {
    const { placed, unplaced } = placeSites([
      { id: 'a', label: 'A', coordinates: { lat: 47.3, lon: 5.0 }, indicators: ind },
      { id: 'b', label: 'B', coordinates: null, indicators: ind },
      { id: 'c', label: 'C', coordinates: { lat: 14.6, lon: -61 }, indicators: ind },
    ]);
    expect(placed.map((s) => s.id)).toEqual(['a']);
    expect(unplaced.map((s) => s.id)).toEqual(['b', 'c']);
    expect(siteTone({ ...ind, lateActions: 1, openEvents: 2 })).toBe('danger');
    expect(siteTone({ ...ind, openEvents: 2 })).toBe('warn');
    expect(siteTone(ind)).toBe('ok');
    expect(siteSummary('Site A', { openEvents: 2, lateActions: 1, daysWithoutAccident: 40, openPlans: 0 }))
      .toBe('Site A : 2 événements ouverts, 1 action en retard, 40 j sans accident avec arrêt, 0 plan de prévention ouvert');
  });
});
