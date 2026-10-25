import { addDays } from '../../lib/dates';
import * as t from '../schema';
import { PEOPLE, SITE_B_LOCATION, pid } from './core';
import { DEMO_REFERENCE_DAY, rel } from './dates';
import type { SeedTx } from './types';

// Jeu de démonstration : événements, étapes du workflow, analyses des causes et registre des accidents bénins (QUA-26 :
// extrait de src/db/seed.ts).

// [réf, date, type, intitulé, lieu, déclarant, projet, équipement, pilote, gravité, étape, description, mesures, méthode, origine NC, blessure, jours perdus]
export const EVENTS: [string, string, string, string, string, string, string, string, string, number, number, string, string, string, string?, string?, number?][] = [
  ['EV-2026-131', rel(-6), 'PA', "Chute de charge lors du retournement d'un bâti", 'Atelier montage · poste M3', '[T. Nguyen]', 'K-2025-042 · [Client A]', 'Pont roulant 10 t', '[S. Benali]', 3, 2, "Lors du retournement d'un bâti de 1,8 t au pont roulant, une élingue a glissé de l'oreille de levage. La charge a basculé et heurté le sol à 1,5 m d'un monteur.", 'Zone balisée, pont consigné, élingue isolée pour expertise, point sécurité équipe à 14 h.', 'tree'],
  ['EV-2026-130', rel(-7), 'NC', "Cotes hors tolérance sur l'arbre de malaxeur", 'Atelier usinage · CU-2', '[P. Roux]', 'K-2025-042 · [Client A]', "Centre d'usinage CU-2", '[L. Moreau]', 2, 3, "Contrôle final : Ø45 h7 mesuré à 45,06 sur 3 arbres du lot. Dérive de l'outil non détectée en cours de série.", 'Lot bloqué en zone NC, 3 arbres repris, contrôle à 100 % du lot suivant.', '8d', 'Fabrication'],
  ['EV-2026-129', rel(-8), 'SD', "Flexible hydraulique endommagé sur le banc d'essais", "Zone d'essais · BE-1", '[A. Martin]', 'K-2024-118 · [Client B]', "Banc d'essais BE-1", '[J. Petit]', 3, 1, 'Gaine extérieure fendue sur le flexible HP du vérin principal, tresse apparente. Pression de service 250 bar.', 'Banc arrêté, flexible remplacé, essais reportés de 48 h.', '5m'],
  ['EV-2026-128', rel(-10), 'RC', 'Fuite sur la presse à cartoucher livrée en juin', 'Mise en service · [Client C]', '[Client C]', 'K-2024-097 · [Client C]', 'Presse PC-400', '[L. Moreau]', 2, 2, "Le client signale une fuite d'huile au bloc hydraulique après 400 h de fonctionnement. Production ralentie.", 'Intervention sous garantie planifiée, joints de rechange expédiés.', '5m', 'Réclamation client'],
  ['EV-2026-127', rel(-13), 'AT', "Coupure à la main lors de l'ébavurage", 'Atelier usinage · T-4', '[M. Girard]', '', 'Tour T-4', '[S. Benali]', 2, 3, "Coupure superficielle à l'index gauche en ébavurant une bride ; gants anti-coupure non portés.", "Rappel du port des gants, outil d'ébavurage mis à disposition au poste.", 'why', undefined, 'sans_arret'],
  ['EV-2026-126', rel(-15), 'ENV', "Déversement d'huile sur rétention au magasin", 'Magasin', '[R. Fontaine]', '', 'Cuve huile hydraulique 1 000 L', '[C. Lefèvre]', 1, 3, "Fuite d'un raccord de la cuve : 20 L retenus dans le bac de rétention, aucun rejet au sol.", 'Raccord resserré, huile pompée, absorbant utilisé et éliminé en déchet dangereux.', '5m'],
  ['EV-2026-125', rel(-17), 'NC', 'Dossier technique incomplet à la revue de conception', "Bureau d'études", '[E. Dubois]', 'K-2026-007 · [Client D]', '', '[E. Dubois]', 1, 1, 'Analyse de risques machine (EN ISO 12100) absente du dossier présenté à la revue de conception du 22/09.', 'Revue reportée au 06/10, analyse en cours.', '5m', 'Conception BE'],
  ['EV-2026-124', rel(-20), 'SD', 'Bouteilles de gaz stockées sans arrimage', 'Atelier montage', '[T. Nguyen]', '', 'Poste soudure', '[S. Benali]', 2, 4, "Quatre bouteilles d'argon debout sans chaîne ni râtelier, à proximité du passage des chariots.", 'Bouteilles arrimées immédiatement, zone balisée.', 'why'],
  ['EV-2026-122', rel(-24), 'PA', "Démarrage intempestif d'un convoyeur en mise en service", 'Mise en service · [Client B]', '[J. Petit]', 'K-2024-118 · [Client B]', 'Convoyeur CV-12', '[J. Petit]', 4, 2, 'Redémarrage du convoyeur depuis le pupitre client pendant un réglage mécanique, technicien à 40 cm de la bande.', 'Consignation LOTO systématique, clé du pupitre retirée, point avec le chef de poste client.', 'tree'],
  ['EV-2026-121', rel(-27), 'NC', 'Traitement de surface non conforme sur pièces fournisseur', 'Magasin · réception', '[R. Fontaine]', 'K-2025-042 · [Client A]', 'Lot [Fournisseur F] n° 4471', '[L. Moreau]', 1, 3, 'Épaisseur de zingage mesurée à 6 µm pour 12 µm spécifiés, sur 40 supports.', 'Lot refusé, dérogation refusée, relance du fournisseur.', '8d', 'Fournisseurs'],
  ['EV-2026-120', rel(-29), 'AT', "Projection dans l'œil lors du meulage", 'Atelier usinage', '[M. Girard]', '', "Meuleuse d'angle", '[S. Benali]', 2, 4, "Particule métallique dans l'œil droit malgré les lunettes ; écran facial non porté.", 'Écran facial rendu obligatoire au poste meulage, affichage mis à jour.', 'why', undefined, 'soins'],
  ['EV-2026-119', rel(-31), 'AT', 'Entorse en descendant de la plateforme PIRL', "Zone d'essais", '[A. Martin]', '', 'Plateforme PIRL', '[S. Benali]', 2, 4, 'Faux pas sur la dernière marche de la plateforme, entorse de la cheville.', "Garde-corps et marche antidérapante vérifiés, sensibilisation de l'équipe.", 'tree', undefined, 'arret', 3],
  ['EV-2026-118', rel(-32), 'AT', "Pincement de doigt à la fermeture d'un carter", 'Mise en service · [Client A]', '[T. Nguyen]', 'K-2025-042 · [Client A]', '', '[S. Benali]', 1, 4, 'Pincement du majeur entre le carter et le bâti lors de la fermeture.', 'Poignées de manutention ajoutées sur les carters.', 'why', undefined, 'soins'],
  ['EV-2026-117', rel(-37), 'SD', "Éclairage défaillant dans l'allée centrale", 'Atelier usinage', '[P. Roux]', '', '', '[C. Lefèvre]', 1, 3, 'Trois luminaires hors service, éclairement mesuré à 90 lux pour 200 lux requis.', "Éclairage d'appoint mobile installé.", '5m'],
  ['EV-2026-115', rel(-42), 'PA', 'Chariot élévateur : angle mort au croisement', 'Magasin', '[R. Fontaine]', '', 'Chariot R489', '[C. Lefèvre]', 3, 3, "Un piéton a surgi au croisement des allées B et C ; freinage d'urgence à moins d'un mètre.", 'Vitesse limitée à 5 km/h, rappel des règles de circulation.', 'tree'],
  ['EV-2026-112', rel(-50), 'NC', 'Jeu excessif après montage du réducteur', 'Atelier montage', '[T. Nguyen]', 'K-2024-097 · [Client C]', 'Réducteur RD-7', '[L. Moreau]', 2, 4, 'Jeu axial de 0,8 mm mesuré pour 0,2 mm maxi à la fiche de réglage. Détecté au contrôle final.', 'Réducteur démonté et re-réglé, fiche de réglage en révision.', '8d', 'Fabrication'],
  ['EV-2026-109', rel(-59), 'SD', 'Prise électrique non conforme en zone ATEX', "Zone d'essais", '[J. Petit]', '', 'Armoire zone 2', '[C. Lefèvre]', 3, 3, "Prise standard installée dans la zone 2 du banc d'essais, hors matériel certifié ATEX.", 'Prise condamnée, alimentation reprise hors zone.', '5m'],
];

// Signalements ajoutés : à qualifier (dépassé, sous 48 h) et classé sans suite.
// [réf, date, type, intitulé, lieu, déclarant (people.id), gravité, description, mesures, déclaré le]
export const NEW_REPORTS: [string, string, string, string, string, string, number, string, string, string][] = [
  ['EV-2026-132', rel(-3), 'PA', "Câble du pont roulant déposé dans l'allée pendant la maintenance", 'Atelier montage · chemin de roulement du pont 10 t', 'kbernard', 2,
    "L'équipe de maintenance a déroulé l'ancien câble du pont en travers de l'allée piétonne, sans balisage ; un monteur a trébuché sans chute.",
    "Câble enroulé et zone balisée par l'entreprise extérieure.", `${rel(-3)}T08:30:00+02:00`],
  ['EV-2026-133', rel(-1), 'SD', "Projection d'étincelles hors de la zone protégée lors d'un meulage", 'Atelier montage · poste M3', 'tnguyen', 2,
    "Les étincelles du meulage sur le bâti passaient par-dessus l'écran ignifuge vers des cartons stockés à 3 m.",
    'Cartons évacués, écran rehaussé.', `${rel(-1)}T15:10:00+02:00`],
  ['EV-2026-123', rel(-20), 'SD', 'Bouteilles de gaz non arrimées au poste soudure', 'Atelier montage', 'tnguyen', 2,
    "Bouteilles d'argon debout sans chaîne au poste soudure.", 'Bouteilles arrimées.', `${rel(-20)}T16:00:00+02:00`],
];

// Compléments des événements (colonnes au-delà du tuple EVENTS), fusionnés à l'insertion :
// - AT : rubriques de la déclaration d'accident du travail (EVT-01) ; intitulé et description neutres, la lésion et les
//   soins vont dans les champs restreints (lesionNature, lesionSite, careGiven : données de santé, SEC-06) ;
// - réclamation client : client et référence (EVT-05) ; environnement : aspect et milieu (EVT-05).
// Pas de témoin pour EV-2026-118 et EV-2026-120, et le mot « arrêt » hors des champs de santé (tests d'isolement).
export const EVENT_DETAILS: Record<string, Partial<typeof t.events.$inferInsert>> = {
  'EV-2026-127': {
    title: "Accident à l'ébavurage au tour T-4",
    description: "Glissade de la main sur l'arête vive d'une bride pendant l'ébavurage ; gants anti-coupure non portés.",
    victimKind: 'salarie', victimId: 'mgirard', occurredTime: '10:40', workSchedule: '7 h 30 – 12 h · 13 h – 16 h 30',
    knownAt: new Date(`${rel(-13)}T10:55:00+02:00`),
    activity: "Ébavurage d'une bride au poste T-4",
    circumstances: "En ébavurant une bride à la lime, la main a glissé sur l'arête vive de la pièce. Gants anti-coupure non portés.",
    witnesses: '[P. Roux] (usineur, poste voisin)',
    lesionNature: 'Coupure superficielle', lesionSite: 'Index gauche', careGiven: 'Pansement au poste de secours, puis consultation du médecin (points de suture)',
  },
  'EV-2026-120': {
    title: 'Accident au poste de meulage',
    description: 'Particule métallique projetée lors du meulage malgré les lunettes ; écran facial non porté.',
    victimKind: 'salarie', victimId: 'mgirard', occurredTime: '14:10',
    activity: "Meulage d'un cordon de soudure",
    circumstances: "Particule projetée par la meuleuse d'angle, passée sous les lunettes de protection ; écran facial non porté.",
    lesionNature: 'Corps étranger superficiel', lesionSite: 'Œil droit', careGiven: 'Rinçage oculaire au poste de secours',
  },
  'EV-2026-119': {
    title: 'Chute en descendant de la plateforme PIRL',
    description: 'Faux pas sur la dernière marche de la plateforme.',
    victimKind: 'salarie', victimId: 'amartin', occurredTime: '15:45', knownAt: new Date(`${rel(-31)}T16:10:00+02:00`),
    activity: 'Descente de la plateforme individuelle roulante après un réglage',
    circumstances: 'Faux pas sur la dernière marche en descendant, sans charge en main.',
    witnesses: '[J. Petit]',
    lesionNature: 'Entorse', lesionSite: 'Cheville droite', careGiven: 'Accompagné aux urgences par un collègue',
  },
  'EV-2026-118': {
    title: "Accident à la fermeture d'un carter",
    description: 'Main prise entre le carter et le bâti lors de la fermeture.',
    victimKind: 'salarie', victimId: 'tnguyen', occurredTime: '10:50',
    activity: "Fermeture d'un carter en mise en service",
    circumstances: 'Main restée sur le bord du bâti pendant la fermeture du carter.',
    lesionNature: 'Pincement', lesionSite: 'Majeur droit', careGiven: 'Désinfection et pansement',
  },
  'EV-2026-128': { customer: '[Client C]', customerRef: 'Presse PC-400 · affaire K-2024-097' },
  'EV-2026-126': { envAspect: 'Déversement', envMedium: 'Sol' },
};

// Registre des accidents du travail bénins (EVT-04), un registre par site : soins sans arrêt ni soins médicaux donnés par
// un SST de l'effectif (titre SST valide dans MATRIX). L'inscription n° 1 attend encore les visas du registre papier.
export const BENIGN: (typeof t.benignAccidents.$inferInsert)[] = [
  { siteId: 'ville-a', number: 1, eventId: 'EV-2026-118', careGivenAt: new Date(`${rel(-32)}T11:05:00+02:00`), caregiverId: 'sbenali', caregiverQualification: 'sst',
    care: 'Désinfection, pansement compressif', signedOn: null, createdById: 'clefevre', createdAt: new Date(`${rel(-32)}T11:30:00+02:00`) },
  { siteId: 'ville-a', number: 2, eventId: 'EV-2026-120', careGivenAt: new Date(`${rel(-29)}T14:20:00+02:00`), caregiverId: 'proux', caregiverQualification: 'sst',
    care: 'Rinçage oculaire au sérum physiologique, contrôle visuel', signedOn: rel(-28), createdById: 'clefevre', createdAt: new Date(`${rel(-29)}T14:45:00+02:00`) },
];

// Analyse des causes de EV-2026-131 (seul événement dont l'analyse est saisie dans la maquette).
export const ANALYSES: [string, string, unknown][] = [
  ['EV-2026-131', '5m', [['Matière', 'Élingue textile usée, étiquette CMU illisible'], ['Matériel', 'Oreille de levage sans linguet de sécurité'], ['Méthode', 'Aucun mode opératoire pour le retournement'], ["Main-d'œuvre", 'Monteur seul, formation élingage à renouveler'], ['Milieu', 'Zone encombrée, visibilité réduite']]],
  ['EV-2026-131', 'tree', [[0, 'Charge basculée à 1,5 m du monteur', true], [1, "L'élingue glisse de l'oreille de levage", false], [2, 'Oreille sans linguet de sécurité', false], [2, "Angle d'élingage supérieur à 90°", false], [1, 'Monteur présent dans la zone de basculement', false], [2, 'Périmètre de levage non matérialisé', false]]],
  ['EV-2026-131', 'why', ["Pourquoi la charge a-t-elle basculé ? — L'élingue a glissé de l'oreille.", 'Pourquoi a-t-elle glissé ? — Oreille sans linguet, angle trop ouvert.', 'Pourquoi cet angle ? — Élingue trop courte pour ce bâti.', 'Pourquoi cette élingue ? — La seule disponible au poste.', "Pourquoi ? — Aucune dotation d'élingage définie par type de bâti."]],
  ['EV-2026-131', '8d', { current: 3 }],
];

// Historique du workflow des événements : étape k franchie J+1, J+3, J+7, J+14, J+21 après les faits, à 10 h,
// sans dépasser la date de référence du jeu de données (DEMO_REFERENCE_DAY, src/db/seeds/dates.ts).
const STEP_DELAYS = [1, 3, 7, 14, 21];
function stepRows(eventId: string, occurredOn: string, step: number, pilotId: string | null) {
  const rows: (typeof t.eventSteps.$inferInsert)[] = [];
  let prev = 0;
  for (let k = 1; k <= step; k++) {
    const day = addDays(occurredOn, STEP_DELAYS[k - 1]);
    let at = new Date(`${day > DEMO_REFERENCE_DAY ? DEMO_REFERENCE_DAY : day}T10:00:00+02:00`).getTime();
    if (at <= prev) at = prev + 3_600_000;
    prev = at;
    rows.push({ eventId, kind: 'advance', fromStep: k - 1, toStep: k, byId: k === 1 ? 'clefevre' : pilotId ?? 'clefevre', at: new Date(at) });
  }
  return rows;
}

/** Événements (dont les signalements à qualifier et un classé sans suite), étapes, analyses, registre des accidents bénins. */
export async function seedEvents(tx: SeedTx) {
  // Déclarant rapproché par identifiant de personne (null pour un déclarant externe, ex. un client).
  const declarantId = (name: string) => PEOPLE.find((p) => p[1] === name)?.[0] ?? null;
  // Accidents du travail déclarés à la CPAM (hors soins inscrits au registre des accidents bénins).
  const CPAM: Record<string, string> = { 'EV-2026-127': rel(-12), 'EV-2026-119': rel(-30) };
  await tx.insert(t.events).values(EVENTS.map((e) => ({
    id: e[0], siteId: SITE_B_LOCATION.test(e[4]) ? 'ville-b' : 'ville-a', occurredOn: e[1], type: e[2], title: e[3], location: e[4], declarant: e[5], declarantId: declarantId(e[5]),
    keystoneProject: e[6] || null, equipment: e[7] || null, pilotId: pid(e[8]), severity: e[9], step: e[10],
    description: e[11], immediateMeasures: e[12], analysisMethod: e[13], ncOrigin: e[14] ?? null, injury: e[15] ?? null, lostDays: e[16] ?? null,
    cpamDeclaredOn: CPAM[e[0]] ?? null,
    createdAt: new Date(`${e[1]}T09:00:00+02:00`),
    ...EVENT_DETAILS[e[0]],
  })));
  await tx.insert(t.events).values(NEW_REPORTS.map(([id, occurredOn, type, title, location, declarant, severity, description, immediateMeasures, createdAt]) => ({
    id, siteId: 'ville-a', occurredOn, type, title, location, declarant: PEOPLE.find((p) => p[0] === declarant)![1], declarantId: declarant,
    pilotId: null, severity, step: 0, description, immediateMeasures, analysisMethod: '5m', createdAt: new Date(createdAt),
    ...(id === 'EV-2026-123' ? { dismissedAt: new Date(`${rel(-19)}T09:00:00+02:00`), dismissedById: 'clefevre', dismissReason: 'Doublon de EV-2026-124 (même constat, même déclarant).' } : {}),
  })));
  await tx.insert(t.eventSteps).values([
    ...EVENTS.flatMap((e) => stepRows(e[0], e[1], e[10], pid(e[8]))),
    { eventId: 'EV-2026-123', kind: 'dismiss', fromStep: 0, toStep: 0, reason: 'Doublon de EV-2026-124 (même constat, même déclarant).', byId: 'clefevre', at: new Date(`${rel(-19)}T09:00:00+02:00`) },
  ]);
  await tx.insert(t.eventAnalyses).values(ANALYSES.map(([eventId, method, content]) => ({ eventId, method, content })));
  await tx.insert(t.benignAccidents).values(BENIGN);
}
