import { describe, expect, it } from 'vitest';
import {
  centroid, containingZone, detectConflicts, hoursOverlap, interferenceLine, parseGeometry, parseHourRanges, parseIds, permitTypeOn,
  pointInPolygon, polygonArea, polylineCrossesPolygon, polylineLength, polylineMidpoint, sameCompany, segmentsIntersect, shapeDistance,
  type CoActivity, type CoInput, type Pt,
} from './coactivity';

// Moteur de coactivité de la carte du site (QUA-03) : géométrie, plages horaires, détection des situations du jour.

const DATE = '2026-10-09';
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

describe('géométrie', () => {
  const sq = rect(0, 0, 1, 1);
  it('polygones : appartenance, aire, centre', () => {
    expect(pointInPolygon([0.5, 0.5], sq)).toBe(true);
    expect(pointInPolygon([1.5, 0.5], sq)).toBe(false);
    expect(pointInPolygon([0.5, 0.5], [[0, 0], [1, 1]])).toBe(false);
    expect(polygonArea(sq)).toBe(1);
    expect(centroid(sq)).toEqual([0.5, 0.5]);
    expect(centroid([[0, 0], [1, 0], [2, 0]])).toEqual([1, 0]); // dégénéré : moyenne des sommets
  });
  it('polylignes : longueur, milieu, intersections', () => {
    expect(polylineLength([[0, 0], [3, 4], [3, 6]])).toBe(7);
    expect(polylineMidpoint([[0, 0], [1, 0], [1, 1]])).toEqual([1, 0]);
    expect(segmentsIntersect([0, 0], [1, 1], [0, 1], [1, 0])).toBe(true);
    expect(segmentsIntersect([0, 0], [1, 0], [0, 1], [1, 1])).toBe(false);
    expect(segmentsIntersect([0, 0], [1, 0], [1, 0], [2, 0])).toBe(true); // extrémité commune
  });
  it('distance entre emprises et traversée de zone (tangence exclue)', () => {
    expect(shapeDistance({ kind: 'point', at: [0, 0] }, { kind: 'point', at: [3, 4] })).toBe(5);
    expect(shapeDistance({ kind: 'point', at: [0.5, 0.5] }, { kind: 'polygon', points: sq })).toBe(0);
    expect(shapeDistance({ kind: 'polygon', points: sq }, { kind: 'polygon', points: rect(1.2, 0, 2, 1) })).toBeCloseTo(0.2);
    expect(polylineCrossesPolygon([[-1, 0.5], [2, 0.5]], sq)).toBe(true);
    expect(polylineCrossesPolygon([[-1, 1], [2, 1]], sq)).toBe(false); // longe le côté
    expect(polylineCrossesPolygon([[-1, 2], [2, 2]], sq)).toBe(false);
  });
  it('zone la plus petite contenant le point (zones imbriquées)', () => {
    const zones = [{ id: 1, polygon: rect(0, 0, 1, 1) }, { id: 2, polygon: rect(0.2, 0.2, 0.4, 0.4) }];
    expect(containingZone(zones, [0.3, 0.3])?.id).toBe(2);
    expect(containingZone(zones, [0.8, 0.8])?.id).toBe(1);
    expect(containingZone(zones, [2, 2])).toBeNull();
  });
  it('lecture tolérante des colonnes jsonb', () => {
    expect(parseGeometry({ type: 'point', at: [0.1, 0.2] })).toEqual({ type: 'point', at: [0.1, 0.2] });
    expect(parseGeometry({ type: 'polygon', points: [[0, 0], [1, 0], 'x', [1, 1]] })).toEqual({ type: 'polygon', points: [[0, 0], [1, 0], [1, 1]] });
    expect(parseGeometry({ type: 'polygon', points: [[0, 0], [1, 0]] })).toBeNull();
    expect(parseGeometry({ type: 'point', at: [Number.NaN, 0] })).toBeNull();
    expect(parseIds([3, '3', 4, -1, 1.5, 'x'])).toEqual([3, 4]);
  });
});

describe('plages horaires', () => {
  it('lecture des formats usuels', () => {
    expect(parseHourRanges('7 h 30 – 12 h')).toEqual([[450, 720]]);
    expect(parseHourRanges('07:30-17:00')).toEqual([[450, 1020]]);
    expect(parseHourRanges('de 5 h à 7h30')).toEqual([[300, 450]]);
    expect(parseHourRanges('8 h – 12 h / 14 h – 18 h')).toEqual([[480, 720], [840, 1080]]);
    expect(parseHourRanges('Équipe 1 : 5 h – 13 h')).toEqual([[300, 780]]);
    expect(parseHourRanges('22 h – 6 h')).toEqual([[1320, 1800]]); // passe minuit
    expect(parseHourRanges('toute la journée')).toEqual([]);
  });
  it('chevauchement, y compris de nuit ; plage illisible : chevauchement supposé', () => {
    expect(hoursOverlap('8 h – 12 h', '13 h – 17 h')).toBe(false);
    expect(hoursOverlap('8 h – 12 h', '11 h – 17 h')).toBe(true);
    expect(hoursOverlap('8 h – 12 h / 14 h – 18 h', '12 h 30 – 13 h 30')).toBe(false);
    expect(hoursOverlap('22 h – 6 h', '5 h – 7 h')).toBe(true);
    expect(hoursOverlap(null, '8 h – 12 h')).toBe(true);
  });
});

describe('detectConflicts : situations de coactivité du jour', () => {
  const zones = [
    { id: 1, name: 'Atelier montage', kind: 'atelier', polygon: rect(0, 0, 0.4, 0.3) },
    { id: 2, name: 'Zone ATEX', kind: 'atex', polygon: rect(0.5, 0, 0.8, 0.3) },
  ];
  const routes = [
    { id: 1, name: 'Voie de livraison', kind: 'vehicules', polyline: [[0, 0.4], [1, 0.4]] as Pt[], shared: true },
    { id: 2, name: 'Allée piétonne', kind: 'pietons', polyline: [[0.2, -0.1], [0.2, 0.5]] as Pt[], shared: false },
  ];
  let next = 1;
  const act = (over: Partial<CoActivity>): CoActivity => ({
    id: next++, title: `Activité ${next}`, team: 'externe', contractor: '[Entreprise Levage Ouest]', contractorId: 'EE-001', zoneId: null, geometry: null,
    startOn: '2026-10-05', endOn: '2026-10-16', hours: null, routeIds: [], vehicles: false, preventionPlanId: null, permitId: null, permitType: null,
    dangerousWork: false, ...over,
  });
  const input = (activities: CoActivity[], over: Partial<CoInput> = {}): CoInput => ({ zones, routes, activities, metersPerUnit: 100, proximityMeters: 15, ...over });
  const internal = (over: Partial<CoActivity> = {}) => act({ team: 'interne', contractor: null, contractorId: null, title: 'Montage du bâti', zoneId: 1, ...over });

  it('même zone : coactivité EU / EE, mesures et synthèse', () => {
    const a = internal({ id: 10 });
    const b = act({ id: 12, title: 'Remplacement du câble', zoneId: 1, preventionPlanId: 'PP-2026-013' });
    const [c] = detectConflicts(input([b, a]), DATE);
    expect(c).toMatchObject({
      key: '10-12', a: 10, b: 12, pair: 'interne_externe', pairLabel: 'Coactivité EU / EE', tone: 'warn', title: 'Même zone',
      zoneIds: [1], place: 'Atelier montage', planIds: ['PP-2026-013'],
    });
    expect(c.fieldMeasures).toEqual([
      'Balisage et séparation physique des zones de travail', 'Horaires décalés pour les opérations incompatibles',
      'Information croisée des équipes (accueil sécurité, point de coactivité quotidien)',
    ]);
    expect(c.measures.at(-1)).toBe('Mise à jour des plans de prévention concernés (PP-2026-013)');
    expect(c.description).toBe('Coactivité EU / EE : « Montage du bâti » (équipe interne) et « Remplacement du câble » ([Entreprise Levage Ouest]) — même zone (Atelier montage).');
    expect(interferenceLine(c)).toBe(`— 09/10/2026 · ${c.description} Mesures : balisage et séparation physique des zones de travail ; horaires décalés pour les opérations incompatibles ; information croisée des équipes (accueil sécurité, point de coactivité quotidien).`);
  });

  it('aucune situation : activités internes, même entreprise, horaires disjoints, hors période', () => {
    expect(detectConflicts(input([internal(), internal()]), DATE)).toEqual([]);
    expect(detectConflicts(input([act({ zoneId: 1 }), act({ zoneId: 1 })]), DATE)).toEqual([]);
    expect(detectConflicts(input([internal({ hours: '7 h – 12 h' }), act({ zoneId: 1, hours: '13 h – 17 h' })]), DATE)).toEqual([]);
    expect(detectConflicts(input([internal(), act({ zoneId: 1, startOn: '2026-10-10' })]), DATE)).toEqual([]);
  });

  it('danger : permis de feu du jour dans la zone, travaux dangereux', () => {
    const feu = act({ zoneId: 1, preventionPlanId: 'PP-1', planPermits: [{ id: 'PF-1', type: 'feu', from: DATE, to: DATE }] });
    expect(permitTypeOn(feu, DATE)).toBe('feu');
    expect(permitTypeOn(feu, '2026-10-10')).toBeNull();
    const [c] = detectConflicts(input([internal(), feu]), DATE);
    expect(c.tone).toBe('danger');
    expect(c.fieldMeasures).toContain('Permis de feu : écarter les équipes voisines, écrans de protection et surveillance après travaux');
    expect(detectConflicts(input([internal(), { ...feu, id: 99 }]), '2026-10-10')[0].tone).toBe('warn');
  });

  it('proximité mesurée (plan étalonné) d’une zone ATEX ; zones contiguës sans étalonnage', () => {
    const [c] = detectConflicts(input([internal(), act({ zoneId: 2, title: 'Contrôle ATEX' })]), DATE);
    expect(c.reasons).toMatchObject([{ code: 'proximity', label: 'Proximité (10 m)', meters: 10, tone: 'danger', detail: 'Atelier montage / Zone ATEX' }]);
    expect(c.fieldMeasures).toContain("Zone ATEX / essais : aucune source d'inflammation, essais suspendus pendant l'intervention");
    expect(detectConflicts(input([internal(), act({ zoneId: 2 })], { proximityMeters: 5 }), DATE)).toEqual([]);
    const touching = [...zones, { id: 3, name: 'Magasin', kind: 'stockage', polygon: rect(0.4, 0, 0.5, 0.3) }];
    const [d] = detectConflicts(input([internal(), act({ zoneId: 3 })], { zones: touching, metersPerUnit: null }), DATE);
    expect(d.reasons[0]).toMatchObject({ code: 'proximity', label: 'Proximité (zones contiguës)', tone: 'warn' });
  });

  it('voie d’accès commune et traversée de zone de travail', () => {
    const [shared] = detectConflicts(input([internal({ routeIds: [1] }), act({ zoneId: 2, routeIds: [1], vehicles: true })], { proximityMeters: 1 }), DATE);
    expect(shared.reasons).toMatchObject([{ code: 'shared_route', subject: 'Voie de livraison', note: 'véhicules ou engins sur une voie véhicules', tone: 'warn' }]);
    expect(shared.fieldMeasures).toContain("Signaleur / guide pour les manœuvres de véhicules et d'engins");
    expect(shared.place).toBe('voie de livraison');
    const [both] = detectConflicts(input([internal({ routeIds: [1], vehicles: true }), act({ zoneId: 2, routeIds: [1], vehicles: true })], { proximityMeters: 1 }), DATE);
    expect(both.reasons[0]).toMatchObject({ note: 'véhicules des deux équipes', tone: 'danger' });

    const [crossing] = detectConflicts(input([internal(), act({ zoneId: 2, routeIds: [2], contractor: '[Entreprise Nettoyage]' })], { proximityMeters: 1 }), DATE);
    expect(crossing.reasons).toMatchObject([{ code: 'zone_crossing', detail: 'Allée piétonne ([Entreprise Nettoyage]) traverse Atelier montage', tone: 'warn' }]);
    expect(crossing.fieldMeasures[0]).toBe('Balisage et séparation physique des zones de travail');
    expect(crossing.fieldMeasures).toContain("Consignation de la zone traversée (accès interdit pendant l'intervention, voie déviée)");
  });

  it('entre entreprises extérieures ; plan non signé ou absent sur un site « dès la première minute »', () => {
    const a = act({ id: 1, zoneId: 1, contractorId: 'EE-001', preventionPlanId: 'PP-1', planMandatory: true, planSigned: false });
    const b = act({ id: 2, zoneId: 1, contractorId: 'EE-002', contractor: '[Entreprise Élec Industrie]' });
    const [c] = detectConflicts(input([a, b], { firstMinuteBasis: 'Établissement Seveso seuil haut' }), DATE);
    expect(c).toMatchObject({ pair: 'externe_externe', pairLabel: 'Entre entreprises extérieures', planIds: ['PP-1'] });
    expect(c.measures.slice(-2)).toEqual([
      'Plan PP-1 à faire signer par les deux entreprises avant toute intervention (établissement Seveso seuil haut : plan écrit et signé dès la première minute)',
      'Plan de prévention écrit et signé à établir avant toute intervention ([Entreprise Élec Industrie]) : établissement Seveso seuil haut, dès la première minute',
    ]);
    expect(detectConflicts(input([a, b]), DATE)[0].measures.at(-1)).toBe('Plan de prévention à établir avec [Entreprise Élec Industrie]');
  });

  it('même entreprise : par identifiant, par plan, par raison sociale', () => {
    const x = { team: 'externe' as const, contractorId: null, contractor: 'X', preventionPlanId: null };
    expect(sameCompany({ ...x, contractorId: 'EE-1' }, { ...x, contractorId: 'EE-1' })).toBe(true);
    expect(sameCompany({ ...x, contractorId: 'EE-1' }, { ...x, contractorId: 'EE-2' })).toBe(false);
    expect(sameCompany({ ...x, contractor: 'A', preventionPlanId: 'PP-1' }, { ...x, contractor: 'B', preventionPlanId: 'PP-1' })).toBe(true);
    expect(sameCompany(x, { ...x })).toBe(true);
    expect(sameCompany({ ...x, team: 'interne' }, x)).toBe(false);
  });
});
