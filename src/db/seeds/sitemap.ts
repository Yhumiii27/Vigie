import 'server-only';
import * as t from '../schema';
import type { SeedTx } from './types';

// Carte du site et coactivité : zones, voies et activités de démonstration, relatives au 08/10/2026.
// Les coordonnées sont saisies en pixels des plans schématiques (public/plans/ville-*.svg, viewBox 1600 × 1000)
// puis normalisées sur la largeur (x / 1600, y / 1600), comme les objets dessinés dans l'application.
// Le 08/10 sur le site A : 4 situations de coactivité (pont roulant / équipe montage et permis de feu du poste M3,
// mezzanine du magasin — permis de feu PF-2026-032 du jour — / chariot élévateur et livraisons poids lourds sur la voie commune).
// La nacelle du pont roulant est amenée le 05/10 et reste dans l'atelier : le camion porte-engins ne circule qu'au repli
// du 09/10 (voie de livraison puis voie est), en coactivité avec les livraisons et avec le camion de la mezzanine (entre
// entreprises extérieures). Le 14/10, l'enlèvement des bennes ajoute deux situations sur la voie de livraison ; ses deux
// activités sous PP-2025-041 (même entreprise) ne sont pas en coactivité entre elles.
// PP-2026-016 (site A) et PP-2026-014 (site B) restent à positionner.

const W = 1600;
type Px = [number, number];
const norm = (p: Px): [number, number] => [Math.round((p[0] / W) * 1e5) / 1e5, Math.round((p[1] / W) * 1e5) / 1e5];
const rect = (x1: number, y1: number, x2: number, y2: number): Px[] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

const MAPS = [
  { siteId: 'ville-a', width: 1600, height: 1000, metersPerUnit: 320, proximityMeters: 15 },
  { siteId: 'ville-b', width: 1600, height: 1000, metersPerUnit: 200, proximityMeters: 15 },
];

// [site, clé, nom, type, polygone, notes]
const ZONES: [string, string, string, string, Px[], string | null][] = [
  ['ville-a', 'decoupe', 'Aire extérieure de découpe', 'exterieur', rect(80, 90, 240, 300), 'Découpe au chalumeau sous permis de feu.'],
  ['ville-a', 'usinage', 'Atelier usinage', 'atelier', rect(260, 90, 760, 420), "Centres d'usinage CU-1 et CU-2, tours T-3 et T-4."],
  ['ville-a', 'montage', 'Atelier montage', 'atelier', rect(800, 90, 1340, 420), 'Postes M1 à M5 sous le chemin de roulement du pont 10 t.'],
  ['ville-a', 'bennes', 'Bennes · déchets', 'stockage', rect(1370, 90, 1520, 230), 'Bacs à copeaux, bennes DIB et métaux.'],
  ['ville-a', 'bureaux', 'Bureaux', 'batiment', rect(260, 560, 560, 760), null],
  ['ville-a', 'be', "Bureau d'études", 'batiment', rect(580, 560, 780, 760), null],
  ['ville-a', 'magasin', 'Magasin', 'stockage', rect(900, 560, 1300, 800), 'Racks, préparation des commandes et mezzanine de stockage.'],
  ['ville-a', 'quai', 'Quai de chargement', 'quai', rect(1300, 600, 1360, 780), 'Trois portes à quai.'],
  ['ville-a', 'manoeuvre', 'Aire de manœuvre poids lourds', 'exterieur', rect(1380, 540, 1530, 840), null],
  ['ville-a', 'parking', 'Parking', 'parking', rect(260, 820, 760, 940), 'Véhicules légers du personnel et des visiteurs.'],
  ['ville-b', 'hall', "Hall d'essais", 'essais', rect(560, 140, 1180, 620), 'Bancs BE-1 et BE-2, plateforme PIRL, salle de contrôle.'],
  ['ville-b', 'atex', 'Zone ATEX 2 · banc BE-1', 'atex', rect(590, 170, 860, 420), 'Zone 2 : matériel certifié ATEX, outillage antiétincelles.'],
  ['ville-b', 'simulants', 'Local des simulants', 'atex', rect(1040, 460, 1160, 600), 'Produits inertes simulant les explosifs (zone 2).'],
  ['ville-b', 'stockage', 'Stockage produits inertes', 'stockage', rect(1240, 160, 1500, 400), null],
  ['ville-b', 'depotage', 'Aire de dépotage', 'quai', rect(1240, 460, 1500, 620), 'Livraison des produits inertes.'],
  ['ville-b', 'bureaux', 'Bureaux et vestiaires', 'batiment', rect(200, 140, 460, 360), null],
  ['ville-b', 'parking', 'Parking', 'parking', rect(160, 720, 480, 920), null],
];

// [site, clé, nom, type, polyligne, voie commune, notes]
const ROUTES: [string, string, string, string, Px[], boolean, string | null][] = [
  ['ville-a', 'livraison', 'Voie de livraison poids lourds', 'vehicules', [[180, 960], [180, 480], [1440, 480], [1440, 690], [1365, 690]], true, "Du portail au quai du magasin par l'allée centrale ; 20 km/h."],
  ['ville-a', 'pietons', 'Allée piétonne parking – ateliers', 'pietons', [[700, 880], [830, 880], [830, 425]], true, "Passage piéton marqué sur l'allée centrale."],
  ['ville-a', 'chariots', 'Allée chariots magasin – ateliers', 'engins', [[1000, 560], [1000, 480], [600, 480], [600, 425]], true, 'Chariot élévateur, 10 km/h ; priorité aux piétons.'],
  ['ville-a', 'est', 'Voie est · bennes et accès montage', 'vehicules', [[1440, 480], [1440, 270], [1342, 270]], true, "Accès pompiers, enlèvement des bennes, porte est de l'atelier montage."],
  ['ville-b', 'acces', "Voie d'accès principale", 'vehicules', [[40, 490], [520, 490], [520, 680], [1370, 680], [1370, 625]], true, "Du portail ouest à l'aire de dépotage."],
  ['ville-b', 'engins', 'Voie engins stockage – hall', 'engins', [[1240, 280], [1185, 280]], true, 'Chariot de manutention des produits inertes.'],
  ['ville-b', 'pietons', 'Cheminement piéton bureaux – hall', 'pietons', [[460, 250], [555, 250]], true, null],
];

type ActivitySeed = {
  site: string; title: string; team: 'interne' | 'externe'; contractorId?: string; ownerId: string;
  preventionPlanId?: string; permitId?: string; keystoneProject?: string; zone?: string; at: Px;
  startOn: string; endOn: string; hours: string; vehicles: boolean; routes: string[]; notes?: string;
};

const ACTIVITIES: ActivitySeed[] = [
  {
    site: 'ville-a', title: 'Maintenance du pont roulant 10 t (fins de course, câble)', team: 'externe', contractorId: 'EE-001', ownerId: 'sbenali',
    preventionPlanId: 'PP-2026-013', zone: 'montage', at: [1060, 200], startOn: '2026-10-05', endOn: '2026-10-09', hours: '7 h 30 – 17 h',
    vehicles: true, routes: [],
    notes: "Nacelle élévatrice sous le chemin de roulement (amenée le 05/10 par la voie de livraison et la voie est, laissée dans l'atelier jusqu'au repli) ; pont consigné, zone balisée au sol.",
  },
  {
    site: 'ville-a', title: 'Repli de la nacelle élévatrice (camion porte-engins)', team: 'externe', contractorId: 'EE-001', ownerId: 'sbenali',
    preventionPlanId: 'PP-2026-013', at: [1400, 270], startOn: '2026-10-09', endOn: '2026-10-09', hours: '7 h 30 – 9 h 30',
    vehicles: true, routes: ['livraison', 'est'], notes: "Chargement devant la porte est de l'atelier montage ; sortie par la voie de livraison.",
  },
  {
    site: 'ville-a', title: 'Montage du malaxeur et retournement des bâtis', team: 'interne', ownerId: 'sbenali', keystoneProject: 'K-2025-042 · [Client A]',
    zone: 'montage', at: [960, 330], startOn: '2026-09-14', endOn: '2026-10-16', hours: '7 h 30 – 16 h 30', vehicles: false, routes: ['pietons'],
    notes: 'Postes M2 et M3 ; levages du poste M3 reportés sur le pont 5 t pendant la maintenance du pont 10 t.',
  },
  {
    site: 'ville-a', title: 'Meulage et soudure de reprise sur le bâti du poste de retournement', team: 'interne', ownerId: 'sbenali', permitId: 'PF-2026-031',
    keystoneProject: 'K-2025-042 · [Client A]', zone: 'montage', at: [1080, 335], startOn: '2026-10-06', endOn: '2026-10-08', hours: '7 h 30 – 18 h',
    vehicles: false, routes: [], notes: 'Permis de feu ; surveillance 2 h après la fin des travaux.',
  },
  {
    site: 'ville-a', title: 'Renforcement de la charpente de la mezzanine (soudage de platines)', team: 'externe', contractorId: 'EE-004', ownerId: 'clefevre',
    preventionPlanId: 'PP-2026-015', zone: 'magasin', at: [1205, 640], startOn: '2026-10-06', endOn: '2026-10-16', hours: '7 h 30 – 17 h',
    vehicles: true, routes: ['livraison'], notes: 'Camion-plateau pour la livraison des platines, nacelle sous la mezzanine.',
  },
  {
    site: 'ville-a', title: 'Livraisons et expéditions poids lourds au quai du magasin', team: 'interne', ownerId: 'rfontaine',
    zone: 'quai', at: [1330, 690], startOn: '2026-01-05', endOn: '2026-12-18', hours: '6 h – 14 h', vehicles: true, routes: ['livraison'],
    notes: 'Quatre à six camions par jour ; manœuvres en marche arrière à quai.',
  },
  {
    site: 'ville-a', title: 'Chariot élévateur : approvisionnement des ateliers', team: 'interne', ownerId: 'rfontaine',
    zone: 'magasin', at: [1000, 700], startOn: '2026-01-05', endOn: '2026-12-18', hours: '7 h – 16 h', vehicles: true, routes: ['chariots'],
    notes: 'Cariste titulaire du CACES R489 ; vitesse limitée à 5 km/h dans le magasin.',
  },
  {
    site: 'ville-a', title: 'Nettoyage industriel des ateliers et des fosses de rétention', team: 'externe', contractorId: 'EE-003', ownerId: 'sbenali',
    preventionPlanId: 'PP-2025-041', zone: 'usinage', at: [510, 250], startOn: '2026-01-05', endOn: '2026-12-18', hours: '5 h – 7 h 30',
    vehicles: false, routes: ['pietons'], notes: 'Hors présence des équipes de production (horaires décalés).',
  },
  {
    site: 'ville-a', title: 'Enlèvement des bennes de copeaux (camion ampliroll)', team: 'externe', contractorId: 'EE-003', ownerId: 'rfontaine',
    preventionPlanId: 'PP-2025-041', zone: 'bennes', at: [1445, 160], startOn: '2026-10-14', endOn: '2026-10-14', hours: '9 h – 11 h',
    vehicles: true, routes: ['livraison', 'est'],
  },
  {
    site: 'ville-b', title: "Essais d'endurance de la ligne de convoyage (produit inerte)", team: 'interne', ownerId: 'jpetit', permitId: 'PE-2026-008',
    keystoneProject: 'K-2024-118 · [Client B]', zone: 'atex', at: [720, 290], startOn: '2026-10-06', endOn: '2026-10-09', hours: '8 h – 18 h',
    vehicles: false, routes: ['pietons'], notes: "Permis d'essai ; accès restreint à la zone d'essais pendant la campagne.",
  },
  {
    site: 'ville-b', title: 'Réception et préparation des produits inertes', team: 'interne', ownerId: 'amartin', keystoneProject: 'K-2024-118 · [Client B]',
    zone: 'stockage', at: [1370, 280], startOn: '2026-09-28', endOn: '2026-11-27', hours: '8 h – 12 h', vehicles: true, routes: ['engins', 'acces'],
  },
];

export async function seedSitemap(tx: SeedTx) {
  await tx.insert(t.siteMaps).values(MAPS);
  const zoneRows = await tx.insert(t.mapZones).values(ZONES.map(([siteId, , name, kind, polygon, notes]) => ({ siteId, name, kind, polygon: polygon.map(norm), notes })))
    .returning({ id: t.mapZones.id });
  const routeRows = await tx.insert(t.mapRoutes).values(ROUTES.map(([siteId, , name, kind, polyline, shared, notes]) => ({ siteId, name, kind, polyline: polyline.map(norm), shared, notes })))
    .returning({ id: t.mapRoutes.id });
  const zoneId = new Map(ZONES.map(([site, key], i) => [`${site}:${key}`, zoneRows[i].id]));
  const routeId = new Map(ROUTES.map(([site, key], i) => [`${site}:${key}`, routeRows[i].id]));
  const ref = (map: Map<string, number>, site: string, key: string) => {
    const id = map.get(`${site}:${key}`);
    if (id == null) throw new Error(`Carte du site : référence inconnue ${site}:${key}`);
    return id;
  };
  await tx.insert(t.siteActivities).values(ACTIVITIES.map((a) => ({
    siteId: a.site,
    title: a.title,
    team: a.team,
    contractorId: a.contractorId ?? null,
    ownerId: a.ownerId,
    preventionPlanId: a.preventionPlanId ?? null,
    permitId: a.permitId ?? null,
    keystoneProject: a.keystoneProject ?? null,
    zoneId: a.zone ? ref(zoneId, a.site, a.zone) : null,
    geometry: { type: 'point', at: norm(a.at) },
    startOn: a.startOn,
    endOn: a.endOn,
    hours: a.hours,
    routeIds: a.routes.map((k) => ref(routeId, a.site, k)),
    vehicles: a.vehicles,
    notes: a.notes ?? null,
    createdAt: new Date('2026-10-02T09:00:00+02:00'),
  })));
}
