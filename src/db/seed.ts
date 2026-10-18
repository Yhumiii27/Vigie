import 'server-only';
import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { addDays, monthName } from '../lib/dates';
import { DEMO_QHSE_LEAD, DEMO_ROLE_PEOPLE } from '../lib/demo';
import type { Role } from '../lib/domain';
import { backfillActionLinks } from '../lib/origin-links';
import * as t from './schema';
import type { Db } from './types';
import { seedActions, upgradeDemoActions } from './seeds/actions';
import { seedCompliance } from './seeds/compliance';
import { seedDocuments } from './seeds/documents';
import { demoWasteStreamMentions, seedEnvironment } from './seeds/environment';
import { seedPrevention } from './seeds/prevention';
import { seedSitemap } from './seeds/sitemap';

// Jeu de données initial, repris de la maquette « Vigie UI mockups review » (design/Vigie.dc.html).
// Les noms entre crochets sont des placeholders à remplacer par l'import du personnel.

// Site B = zone d'essais ; tous les autres salariés sont rattachés au site A.
const SITE_B_PEOPLE = new Set(['amartin', 'jpetit']);
const SITE_B_LOCATION = /zone d'essais|banc d'essais/i;

const PEOPLE: [id: string, name: string, job: string, matrix: boolean, service: string][] = [
  ['tnguyen', '[T. Nguyen]', 'Monteur · atelier montage', true, 'Atelier montage'],
  ['mgirard', '[M. Girard]', 'Usineur · atelier usinage', true, 'Atelier usinage'],
  ['proux', '[P. Roux]', 'Usineur · atelier usinage', true, 'Atelier usinage'],
  ['amartin', '[A. Martin]', "Technicien · zone d'essais", true, "Zone d'essais"],
  ['jpetit', '[J. Petit]', 'Chef de zone · essais', true, "Zone d'essais"],
  ['rfontaine', '[R. Fontaine]', 'Magasinier', true, 'Magasin'],
  ['edubois', '[E. Dubois]', "Ingénieur · bureau d'études", true, "Bureau d'études"],
  ['lmoreau', '[L. Moreau]', 'Responsable qualité', true, 'Qualité'],
  ['sbenali', '[S. Benali]', "Chef d'atelier montage", true, 'Atelier montage'],
  ['kbernard', '[K. Bernard]', 'Monteur · arrivé le 28/09', true, 'Atelier montage'],
  ['clefevre', '[C. Lefèvre]', 'Animatrice QHSE', false, 'QHSE'],
  ['hmarchand', '[H. Marchand]', 'Direction', false, 'Direction'],
  // Sorti de l'effectif (archivé) : filtre « Sortis » de la matrice, nom conservé dans l'historique.
  ['ylambert', '[Y. Lambert]', 'Usineur · atelier usinage', true, 'Atelier usinage'],
];
const LEFT: Record<string, { leftOn: string; leftReason: string }> = { ylambert: { leftOn: '2026-09-30', leftReason: 'Fin de contrat' } };
const pid = (name: string) => {
  const p = PEOPLE.find((x) => x[1] === name);
  if (!p) throw new Error(`Personne inconnue : ${name}`);
  return p[0];
};

// [réf, date, type, intitulé, lieu, déclarant, projet, équipement, pilote, gravité, étape, description, mesures, méthode, origine NC, blessure, jours perdus]
const EVENTS: [string, string, string, string, string, string, string, string, string, number, number, string, string, string, string?, string?, number?][] = [
  ['EV-2026-131', '2026-10-03', 'PA', "Chute de charge lors du retournement d'un bâti", 'Atelier montage · poste M3', '[T. Nguyen]', 'K-2025-042 · [Client A]', 'Pont roulant 10 t', '[S. Benali]', 3, 2, "Lors du retournement d'un bâti de 1,8 t au pont roulant, une élingue a glissé de l'oreille de levage. La charge a basculé et heurté le sol à 1,5 m d'un monteur.", 'Zone balisée, pont consigné, élingue isolée pour expertise, point sécurité équipe à 14 h.', 'tree'],
  ['EV-2026-130', '2026-10-02', 'NC', "Cotes hors tolérance sur l'arbre de malaxeur", 'Atelier usinage · CU-2', '[P. Roux]', 'K-2025-042 · [Client A]', "Centre d'usinage CU-2", '[L. Moreau]', 2, 3, "Contrôle final : Ø45 h7 mesuré à 45,06 sur 3 arbres du lot. Dérive de l'outil non détectée en cours de série.", 'Lot bloqué en zone NC, 3 arbres repris, contrôle à 100 % du lot suivant.', '8d', 'Fabrication'],
  ['EV-2026-129', '2026-10-01', 'SD', "Flexible hydraulique endommagé sur le banc d'essais", "Zone d'essais · BE-1", '[A. Martin]', 'K-2024-118 · [Client B]', "Banc d'essais BE-1", '[J. Petit]', 3, 1, 'Gaine extérieure fendue sur le flexible HP du vérin principal, tresse apparente. Pression de service 250 bar.', 'Banc arrêté, flexible remplacé, essais reportés de 48 h.', '5m'],
  ['EV-2026-128', '2026-09-29', 'RC', 'Fuite sur la presse à cartoucher livrée en juin', 'Mise en service · [Client C]', '[Client C]', 'K-2024-097 · [Client C]', 'Presse PC-400', '[L. Moreau]', 2, 2, "Le client signale une fuite d'huile au bloc hydraulique après 400 h de fonctionnement. Production ralentie.", 'Intervention sous garantie planifiée, joints de rechange expédiés.', '5m', 'Réclamation client'],
  ['EV-2026-127', '2026-09-26', 'AT', "Coupure à la main lors de l'ébavurage", 'Atelier usinage · T-4', '[M. Girard]', '', 'Tour T-4', '[S. Benali]', 2, 3, "Coupure superficielle à l'index gauche en ébavurant une bride ; gants anti-coupure non portés.", "Rappel du port des gants, outil d'ébavurage mis à disposition au poste.", 'why', undefined, 'sans_arret'],
  ['EV-2026-126', '2026-09-24', 'ENV', "Déversement d'huile sur rétention au magasin", 'Magasin', '[R. Fontaine]', '', 'Cuve huile hydraulique 1 000 L', '[C. Lefèvre]', 1, 3, "Fuite d'un raccord de la cuve : 20 L retenus dans le bac de rétention, aucun rejet au sol.", 'Raccord resserré, huile pompée, absorbant utilisé et éliminé en déchet dangereux.', '5m'],
  ['EV-2026-125', '2026-09-22', 'NC', 'Dossier technique incomplet à la revue de conception', "Bureau d'études", '[E. Dubois]', 'K-2026-007 · [Client D]', '', '[E. Dubois]', 1, 1, 'Analyse de risques machine (EN ISO 12100) absente du dossier présenté à la revue de conception du 22/09.', 'Revue reportée au 06/10, analyse en cours.', '5m', 'Conception BE'],
  ['EV-2026-124', '2026-09-19', 'SD', 'Bouteilles de gaz stockées sans arrimage', 'Atelier montage', '[T. Nguyen]', '', 'Poste soudure', '[S. Benali]', 2, 4, "Quatre bouteilles d'argon debout sans chaîne ni râtelier, à proximité du passage des chariots.", 'Bouteilles arrimées immédiatement, zone balisée.', 'why'],
  ['EV-2026-122', '2026-09-15', 'PA', "Démarrage intempestif d'un convoyeur en mise en service", 'Mise en service · [Client B]', '[J. Petit]', 'K-2024-118 · [Client B]', 'Convoyeur CV-12', '[J. Petit]', 4, 2, 'Redémarrage du convoyeur depuis le pupitre client pendant un réglage mécanique, technicien à 40 cm de la bande.', 'Consignation LOTO systématique, clé du pupitre retirée, point avec le chef de poste client.', 'tree'],
  ['EV-2026-121', '2026-09-12', 'NC', 'Traitement de surface non conforme sur pièces fournisseur', 'Magasin · réception', '[R. Fontaine]', 'K-2025-042 · [Client A]', 'Lot [Fournisseur F] n° 4471', '[L. Moreau]', 1, 3, 'Épaisseur de zingage mesurée à 6 µm pour 12 µm spécifiés, sur 40 supports.', 'Lot refusé, dérogation refusée, relance du fournisseur.', '8d', 'Fournisseurs'],
  ['EV-2026-120', '2026-09-10', 'AT', "Projection dans l'œil lors du meulage", 'Atelier usinage', '[M. Girard]', '', "Meuleuse d'angle", '[S. Benali]', 2, 4, "Particule métallique dans l'œil droit malgré les lunettes ; écran facial non porté.", 'Écran facial rendu obligatoire au poste meulage, affichage mis à jour.', 'why', undefined, 'soins'],
  ['EV-2026-119', '2026-09-08', 'AT', 'Entorse en descendant de la plateforme PIRL', "Zone d'essais", '[A. Martin]', '', 'Plateforme PIRL', '[S. Benali]', 2, 4, 'Faux pas sur la dernière marche de la plateforme, entorse de la cheville.', "Garde-corps et marche antidérapante vérifiés, sensibilisation de l'équipe.", 'tree', undefined, 'arret', 3],
  ['EV-2026-118', '2026-09-07', 'AT', "Pincement de doigt à la fermeture d'un carter", 'Mise en service · [Client A]', '[T. Nguyen]', 'K-2025-042 · [Client A]', '', '[S. Benali]', 1, 4, 'Pincement du majeur entre le carter et le bâti lors de la fermeture.', 'Poignées de manutention ajoutées sur les carters.', 'why', undefined, 'soins'],
  ['EV-2026-117', '2026-09-02', 'SD', "Éclairage défaillant dans l'allée centrale", 'Atelier usinage', '[P. Roux]', '', '', '[C. Lefèvre]', 1, 3, 'Trois luminaires hors service, éclairement mesuré à 90 lux pour 200 lux requis.', "Éclairage d'appoint mobile installé.", '5m'],
  ['EV-2026-115', '2026-08-28', 'PA', 'Chariot élévateur : angle mort au croisement', 'Magasin', '[R. Fontaine]', '', 'Chariot R489', '[C. Lefèvre]', 3, 3, "Un piéton a surgi au croisement des allées B et C ; freinage d'urgence à moins d'un mètre.", 'Vitesse limitée à 5 km/h, rappel des règles de circulation.', 'tree'],
  ['EV-2026-112', '2026-08-20', 'NC', 'Jeu excessif après montage du réducteur', 'Atelier montage', '[T. Nguyen]', 'K-2024-097 · [Client C]', 'Réducteur RD-7', '[L. Moreau]', 2, 4, 'Jeu axial de 0,8 mm mesuré pour 0,2 mm maxi à la fiche de réglage. Détecté au contrôle final.', 'Réducteur démonté et re-réglé, fiche de réglage en révision.', '8d', 'Fabrication'],
  ['EV-2026-109', '2026-08-11', 'SD', 'Prise électrique non conforme en zone ATEX', "Zone d'essais", '[J. Petit]', '', 'Armoire zone 2', '[C. Lefèvre]', 3, 3, "Prise standard installée dans la zone 2 du banc d'essais, hors matériel certifié ATEX.", 'Prise condamnée, alimentation reprise hors zone.', '5m'],
];

// Signalements ajoutés : à qualifier (dépassé, sous 48 h) et classé sans suite.
// [réf, date, type, intitulé, lieu, déclarant (people.id), gravité, description, mesures, déclaré le]
const NEW_REPORTS: [string, string, string, string, string, string, number, string, string, string][] = [
  ['EV-2026-132', '2026-10-06', 'PA', "Câble du pont roulant déposé dans l'allée pendant la maintenance", 'Atelier montage · chemin de roulement du pont 10 t', 'kbernard', 2,
    "L'équipe de maintenance a déroulé l'ancien câble du pont en travers de l'allée piétonne, sans balisage ; un monteur a trébuché sans chute.",
    "Câble enroulé et zone balisée par l'entreprise extérieure.", '2026-10-06T08:30:00+02:00'],
  ['EV-2026-133', '2026-10-08', 'SD', "Projection d'étincelles hors de la zone protégée lors d'un meulage", 'Atelier montage · poste M3', 'tnguyen', 2,
    "Les étincelles du meulage sur le bâti passaient par-dessus l'écran ignifuge vers des cartons stockés à 3 m.",
    'Cartons évacués, écran rehaussé.', '2026-10-08T15:10:00+02:00'],
  ['EV-2026-123', '2026-09-19', 'SD', 'Bouteilles de gaz non arrimées au poste soudure', 'Atelier montage', 'tnguyen', 2,
    "Bouteilles d'argon debout sans chaîne au poste soudure.", 'Bouteilles arrimées.', '2026-09-19T16:00:00+02:00'],
];

// Compléments des événements (colonnes au-delà du tuple EVENTS), fusionnés à l'insertion :
// - AT : rubriques de la déclaration d'accident du travail (EVT-01) ; intitulé et description neutres, la lésion et les
//   soins vont dans les champs restreints (lesionNature, lesionSite, careGiven : données de santé, SEC-06) ;
// - réclamation client : client et référence (EVT-05) ; environnement : aspect et milieu (EVT-05).
// Pas de témoin pour EV-2026-118 et EV-2026-120, et le mot « arrêt » hors des champs de santé (tests d'isolement).
const EVENT_DETAILS: Record<string, Partial<typeof t.events.$inferInsert>> = {
  'EV-2026-127': {
    title: "Accident à l'ébavurage au tour T-4",
    description: "Glissade de la main sur l'arête vive d'une bride pendant l'ébavurage ; gants anti-coupure non portés.",
    victimKind: 'salarie', victimId: 'mgirard', occurredTime: '10:40', workSchedule: '7 h 30 – 12 h · 13 h – 16 h 30',
    knownAt: new Date('2026-09-26T10:55:00+02:00'),
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
    victimKind: 'salarie', victimId: 'amartin', occurredTime: '15:45', knownAt: new Date('2026-09-08T16:10:00+02:00'),
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
const BENIGN: (typeof t.benignAccidents.$inferInsert)[] = [
  { siteId: 'ville-a', number: 1, eventId: 'EV-2026-118', careGivenAt: new Date('2026-09-07T11:05:00+02:00'), caregiverId: 'sbenali', caregiverQualification: 'sst',
    care: 'Désinfection, pansement compressif', signedOn: null, createdById: 'clefevre', createdAt: new Date('2026-09-07T11:30:00+02:00') },
  { siteId: 'ville-a', number: 2, eventId: 'EV-2026-120', careGivenAt: new Date('2026-09-10T14:20:00+02:00'), caregiverId: 'proux', caregiverQualification: 'sst',
    care: 'Rinçage oculaire au sérum physiologique, contrôle visuel', signedOn: '2026-09-11', createdById: 'clefevre', createdAt: new Date('2026-09-10T14:45:00+02:00') },
];

// Analyse des causes de EV-2026-131 (seul événement dont l'analyse est saisie dans la maquette).
const ANALYSES: [string, string, unknown][] = [
  ['EV-2026-131', '5m', [['Matière', 'Élingue textile usée, étiquette CMU illisible'], ['Matériel', 'Oreille de levage sans linguet de sécurité'], ['Méthode', 'Aucun mode opératoire pour le retournement'], ["Main-d'œuvre", 'Monteur seul, formation élingage à renouveler'], ['Milieu', 'Zone encombrée, visibilité réduite']]],
  ['EV-2026-131', 'tree', [[0, 'Charge basculée à 1,5 m du monteur', true], [1, "L'élingue glisse de l'oreille de levage", false], [2, 'Oreille sans linguet de sécurité', false], [2, "Angle d'élingage supérieur à 90°", false], [1, 'Monteur présent dans la zone de basculement', false], [2, 'Périmètre de levage non matérialisé', false]]],
  ['EV-2026-131', 'why', ["Pourquoi la charge a-t-elle basculé ? — L'élingue a glissé de l'oreille.", 'Pourquoi a-t-elle glissé ? — Oreille sans linguet, angle trop ouvert.', 'Pourquoi cet angle ? — Élingue trop courte pour ce bâti.', 'Pourquoi cette élingue ? — La seule disponible au poste.', "Pourquoi ? — Aucune dotation d'élingage définie par type de bâti."]],
  ['EV-2026-131', '8d', { current: 3 }],
];

// Actions du plan d'actions QSE : src/db/seeds/actions.ts (seedActions, upgradeDemoActions).

// Projets Keystone référencés : les 7 livrés après le 20/01/2027 sont concernés par le règlement 2023/1230 (calcul automatique,
// requirements.affectsProjects).
const PROJECTS: [id: string, client: string, title: string, deliveryOn: string][] = [
  ['K-2024-097', '[Client C]', 'Presse à cartoucher PC-400', '2026-06-12'],
  ['K-2024-118', '[Client B]', "Ligne de convoyage et banc d'essais", '2026-11-27'],
  ['K-2025-042', '[Client A]', 'Malaxeur et poste de retournement', '2026-10-17'],
  ['K-2025-061', '[Client E]', 'Cellule de remplissage automatisée', '2027-02-26'],
  ['K-2025-077', '[Client A]', 'Malaxeur MX-2 — seconde ligne', '2027-03-19'],
  ['K-2026-003', '[Client F]', 'Presse hydraulique 400 t', '2027-04-09'],
  ['K-2026-007', '[Client D]', 'Machine spéciale de sertissage', '2027-05-21'],
  ['K-2026-012', '[Client B]', 'Convoyeur à rouleaux CV-20', '2027-06-18'],
  ['K-2026-019', '[Client G]', 'Banc de test hydraulique', '2027-09-10'],
  ['K-2026-024', '[Client C]', 'Rétrofit presse PC-400', '2027-11-05'],
];

const UNITS: [string, string][] = [['montage', 'Atelier montage'], ['usinage', 'Atelier usinage'], ['essais', "Zone d'essais"], ['client', 'Mise en service chez le client'], ['be', "Bureau d'études"], ['magasin', 'Magasin'], ['bureaux', 'Bureaux'], ['deplacements', 'Déplacements']];

// [unité, danger, situation, G, P, mesures existantes, G résiduelle, P résiduelle, actions]
// A-222 (action de suite « nouveau risque » de A-176) porte le risque de A-176 : lien à plusieurs porteurs repris par la
// suite (plan du paquet 1, D21).
const RISKS: [string, string, string, number, number, string, number, number, string[]][] = [
  ['montage', 'Manutention mécanique', "Levage et retournement de bâtis jusqu'à 3 t au pont roulant", 4, 2, 'VGP semestrielle, élingues contrôlées, autorisation de conduite', 4, 1, ['A-214', 'A-215']],
  ['montage', 'Électricité', 'Essais sous tension des armoires en fin de montage', 4, 2, 'Habilitation BR / B2V, consignation, EPI isolants', 4, 1, ['A-205']],
  ['montage', 'Bruit', 'Meulage et perçage, 87 dB(A) mesurés', 2, 4, 'PICB, cloisonnement du poste', 2, 2, []],
  ['montage', 'Chute de plain-pied', 'Flexibles et câbles au sol en phase de montage', 2, 3, 'Chemins de câbles provisoires, rangement en fin de poste', 2, 2, []],
  ['montage', 'Postures contraignantes', 'Montage sous châssis, bras en élévation', 2, 3, 'Potence, table élévatrice', 2, 2, []],
  ['montage', 'Incendie / explosion', 'Stockage de bouteilles de gaz de soudage', 4, 1, 'Râteliers, arrimage, détecteur de fuite', 4, 1, ['A-172']],
  ['usinage', 'Mécanique (rotation)', 'Usinage sur tour T-4, carter ouvert', 3, 2, 'Carter asservi, formation au poste', 3, 1, []],
  ['usinage', 'Coupure', 'Ébavurage manuel des pièces', 2, 4, "Gants anti-coupure, outil d'ébavurage", 2, 2, []],
  ['usinage', 'Projection', 'Meulage sans écran facial', 3, 3, 'Écran facial obligatoire, lunettes', 3, 1, []],
  ['usinage', 'Chimique', "Fluides de coupe, brouillards d'huile", 2, 3, 'Aspiration à la source, FDS, suivi médical', 2, 2, []],
  ['usinage', 'Éclairage insuffisant', 'Allée centrale, 90 lux mesurés', 1, 3, "Éclairage d'appoint provisoire", 1, 2, ['A-198']],
  ['essais', 'Explosion / ATEX', 'Essais avec produits inertes simulant les explosifs, zone 2', 4, 2, "Matériel ATEX, permis d'essai, zonage", 4, 1, ['A-203']],
  ['essais', 'Hydraulique haute pression', 'Rupture de flexible à 250 bar', 3, 2, 'Contrôle visuel hebdomadaire, remplacement à 5 ans', 3, 1, ['A-209']],
  ['essais', 'Chute de hauteur', 'Accès à la plateforme PIRL', 3, 2, 'Garde-corps, formation travail en hauteur', 3, 1, ['A-165']],
  ['client', 'Co-activité', 'Intervention sur site client en production', 3, 3, 'Plan de prévention, accueil site, permis', 3, 1, []],
  ['client', 'Démarrage intempestif', 'Mise sous tension des convoyeurs en réglage', 4, 2, "Consignation LOTO, arrêt d'urgence testé", 4, 1, []],
  ['client', 'Risque routier', 'Trajets longs vers les sites clients', 3, 2, 'Politique déplacements, temps de repos', 3, 2, []],
  ['be', 'Travail sur écran', 'Postes prolongés sur écran, CAO', 1, 4, 'Postes réglables, pauses', 1, 3, []],
  ['be', 'Risques psychosociaux', 'Pics de charge avant livraison', 2, 3, 'Planification Keystone, entretiens', 2, 2, []],
  ['magasin', 'Circulation engins / piétons', "Chariot élévateur et piétons dans l'allée centrale", 4, 2, 'Plan de circulation, CACES R489, gilets', 4, 1, ['A-201']],
  ['magasin', 'Chimique / environnement', "Déversement d'huile ou de solvant", 2, 2, 'Rétentions, kit absorbant', 2, 1, ['A-176', 'A-222']],
  ['bureaux', 'Chute', 'Escaliers et sols', 2, 2, 'Nez de marche, éclairage', 2, 1, []],
  ['bureaux', 'Incendie', 'Locaux techniques et serveurs', 3, 1, 'Détection, extincteurs, exercice annuel', 3, 1, []],
  ['deplacements', 'Risque routier', 'Trajets en véhicule de service', 4, 2, 'Entretien des véhicules, téléphone interdit au volant', 4, 1, []],
  ['deplacements', 'Fatigue', 'Longue distance, décalage horaire', 2, 3, 'Repos obligatoire, hébergement sur place', 2, 2, []],
];

// [texte, domaine, exigence, échéance, note d'échéance, évaluation, note d'évaluation, pilote]
// R. 4512-6 : l'écart « interventions sans plan signé » est calculé depuis les plans de prévention (note vide).
const REQUIREMENTS: [string, string, string, string | null, string | null, string, string | null, string][] = [
  ['Règlement (UE) 2023/1230', 'Machines — conception et marquage CE', "Remplace la directive 2006/42/CE : cybersécurité, logiciels et IA, notice numérique, nouvelles procédures d'évaluation de la conformité.", '2027-01-20', null, 'analyse', null, '[E. Dubois]'],
  ['Directive ATEX 2014/34/UE', 'Équipements en atmosphères explosives', 'Conformité et marquage des matériels destinés aux zones ATEX, documentation technique, déclaration UE.', null, 'Permanent', 'conforme', null, '[J. Petit]'],
  ['Code du travail — R. 4512-6', 'Plans de prévention', "Plan de prévention écrit pour toute intervention d'entreprise extérieure de plus de 400 h/an ou comportant des travaux dangereux. Règle interne Seveso seuil haut : plan écrit et signé dès la première minute d'intervention.", null, 'Permanent', 'ecart', null, '[S. Benali]'],
  ['Code de l\'environnement — L. 515-32 et suivants (Seveso III)', 'Établissement Seveso seuil haut', "Étude de dangers révisée tous les 5 ans, système de gestion de la sécurité (SGS), plan d'opération interne (POI) testé, information des entreprises extérieures et maîtrise de la coactivité sur site.", '2027-06-30', 'révision de l\'étude de dangers', 'analyse', null, '[C. Lefèvre]'],
  ['Code du travail — R. 4121-1', 'Document unique (DUERP)', 'Mise à jour au moins annuelle, conservation 40 ans, mise à disposition des salariés et du CSE.', '2027-03-15', null, 'conforme', null, '[C. Lefèvre]'],
  ['Arrêté du 1er mars 2004', 'Appareils de levage', "Vérifications générales périodiques des appareils et accessoires de levage, tous les 6 ou 12 mois selon l'équipement.", '2026-10-02', null, 'ecart', 'VGP pont roulant dépassée', '[S. Benali]'],
  ["Code de l'environnement — R. 541-45 · Trackdéchets", 'Déchets', 'Traçabilité dématérialisée des déchets dangereux (BSD) et registre chronologique des déchets.', null, 'Permanent', 'a_evaluer', 'registre 2026 incomplet', '[R. Fontaine]'],
  ['ISO 9001:2015', 'Management de la qualité', 'Revue de direction, audits internes, maîtrise des non-conformités et des exigences client.', '2026-11-17', 'audit de suivi', 'conforme', null, '[E. Dubois]'],
];

// [équipement, contrôle, périodicité (mois), organisme, responsable, dernier, prochain, réserves]
// Dernière évaluation de chaque exigence (index) et historique des évaluations [date, évaluation, note, auteur].
const LAST_EVALUATED: (string | null)[] = ['2026-05-12', '2025-11-20', '2026-09-15', '2026-04-02', '2025-10-14', '2026-10-05', null, '2026-06-20'];
const EVALUATIONS: Record<number, [string, string, string | null, string][]> = {
  0: [['2026-05-12', 'analyse', null, 'edubois']],
  1: [['2024-11-18', 'conforme', null, 'clefevre'], ['2025-11-20', 'conforme', null, 'clefevre']],
  2: [['2026-03-10', 'analyse', 'interventions de maintenance à recenser', 'clefevre'], ['2026-09-15', 'ecart', null, 'sbenali']],
  3: [['2026-04-02', 'analyse', null, 'clefevre']],
  4: [['2025-10-14', 'conforme', null, 'clefevre']],
  5: [['2025-10-10', 'conforme', null, 'clefevre'], ['2026-10-05', 'ecart', 'VGP pont roulant dépassée', 'sbenali']],
  7: [['2025-06-24', 'conforme', null, 'clefevre'], ['2026-06-20', 'conforme', null, 'clefevre']],
};

const CONTROLS: [string, string, number, string, string | null, string, string, string | null][] = [
  ['Pont roulant 10 t — atelier montage', 'VGP levage', 6, '[Apave]', '[S. Benali]', '2026-04-02', '2026-10-02', '1 · fin de course à régler'],
  ['Chariot élévateur R489', 'VGP', 6, '[Apave]', null, '2026-04-15', '2026-10-15', null],
  ['Installations électriques', 'Vérification périodique', 12, '[Bureau Veritas]', null, '2025-10-20', '2026-10-20', '3 · 2 levées'],
  ['Extincteurs (42)', 'Maintenance annuelle', 12, '[Prestataire incendie]', null, '2025-10-28', '2026-10-28', null],
  ['Portes et portails motorisés', 'Vérification', 6, 'Interne — maintenance', null, '2026-04-30', '2026-10-30', null],
  ["Banc d'essais BE-1 — matériel ATEX", 'Inspection ATEX', 12, '[Organisme notifié]', null, '2025-11-03', '2026-11-03', '1 · presse-étoupe'],
  ['Compresseur et réseau air comprimé', 'Requalification périodique', 40, '[Apave]', null, '2024-06-12', '2027-10-12', null],
  ['EPI antichute (harnais, longes)', 'Contrôle annuel', 12, 'Interne — QHSE', null, '2026-02-05', '2027-02-05', null],
  // Équipement réformé (archivé) : historique conservé.
  ['Palan électrique 2 t — ancien poste de retournement', 'VGP levage', 6, '[Apave]', '[S. Benali]', '2026-01-14', '2026-07-14', null],
];
// Historique des contrôles réalisés, par index de CONTROLS [date, organisme, réserves, notes] ; le dernier correspond à lastOn.
const CONTROL_RECORDS: Record<number, [string, string, string | null, string | null][]> = {
  0: [['2025-10-02', '[Apave]', null, 'Aucune réserve.'], ['2026-04-02', '[Apave]', '1 · fin de course à régler', 'Fin de course haut à régler avant la prochaine VGP.']],
  1: [['2025-10-14', '[Apave]', null, null], ['2026-04-15', '[Apave]', null, null]],
  2: [['2024-10-21', '[Bureau Veritas]', '2 · repérage armoires', null], ['2025-10-20', '[Bureau Veritas]', '3 · 2 levées', 'Trois observations, deux levées sur place.']],
  3: [['2025-10-28', '[Prestataire incendie]', null, '42 appareils vérifiés, 2 remplacés.']],
  4: [['2026-04-30', 'Interne — maintenance', null, null]],
  5: [['2025-11-03', '[Organisme notifié]', '1 · presse-étoupe', null]],
  6: [['2024-06-12', '[Apave]', null, null]],
  7: [['2026-02-05', 'Interne — QHSE', null, '6 harnais, 8 longes contrôlés.']],
  8: [['2026-01-14', '[Apave]', null, null]],
};

// [id, libellé, validité (mois, 0 = sans échéance)]
const TITLES: [string, string, number][] = [
  ['accueil', 'Accueil sécurité', 0], ['elec', 'Habilitation électrique', 36], ['r484', 'CACES R484', 60], ['r489', 'CACES R489', 60],
  ['sst', 'SST', 24], ['hauteur', 'Travail en hauteur', 36], ['atex', 'ATEX', 36], ['conduite', 'Autorisation de conduite', 60],
];

// Matrice : v valide · s expire sous 60 j · x expiré · r requis jamais suivi · n non requis
const MATRIX: [string, string][] = [
  ['tnguyen', 'vvvnsxnv'], ['mgirard', 'vsnnvnnn'], ['proux', 'vnnvvnnv'], ['amartin', 'vvnnvvvn'], ['jpetit', 'vvnnvvvn'],
  ['rfontaine', 'vnnvvnnv'], ['edubois', 'vnnnvnnn'], ['lmoreau', 'vnnnvnnn'], ['sbenali', 'vvvvvvvv'], ['kbernard', 'rnnnnrnn'],
  ['ylambert', 'vnnvvnnv'],
];
// Échéances explicites des titres expirés ou proches de l'expiration.
const EXPIRIES: Record<string, string> = { 'tnguyen:hauteur': '2026-09-28', 'tnguyen:sst': '2026-11-20', 'mgirard:elec': '2026-11-28' };
// Organismes de formation par titre (formations en cours).
const PROVIDERS: Record<string, string> = { elec: '[Apave]', r484: '[AFPA]', r489: '[AFPA]', sst: 'Formation interne', hauteur: '[Apave]', atex: '[Organisme notifié]', conduite: 'Formation interne' };
// Formations antérieures (historique, jamais écrasé) [salarié, titre, obtention, échéance, organisme].
const PAST_TRAININGS: [string, string, string, string, string][] = [
  ['tnguyen', 'hauteur', '2020-09-28', '2023-09-28', '[Apave]'],
  ['sbenali', 'elec', '2022-10-11', '2025-10-11', '[Apave]'],
];

// Le statut affiché est calculé (certificationStatus) : `status` n'est qu'une précision libre.
const CERTS: (typeof t.certifications.$inferInsert)[] = [
  { id: 'iso9001', domain: 'Qualité', standard: 'ISO 9001:2015', status: '', tone: 'ok', note: 'Cycle de certification 2025–2028', organization: '[Organisme certificateur]', issuedOn: '2025-12-15', validUntil: '2028-12-14' },
  { id: 'iso45001', domain: 'Santé-sécurité', standard: 'ISO 45001:2018', status: 'Déploiement en cours', tone: 'warn', note: 'Certification visée au second semestre 2027' },
  { id: 'iso14001', domain: 'Environnement', standard: 'ISO 14001:2015', status: '', tone: 'off', note: "Étude d'opportunité à la revue de direction du 10/12" },
];

// [ligne, mois, libellé, date, intitulé d'échéance, responsable, action] — index 13 et 14 : échéances des revues de direction
// (audit_plan_items.review_id, AUD-01) ; index 15 : élément annulé (AUD-03).
const PLAN: [string, number, string, string?, string?, string?, string?][] = [
  ['Audits internes', 2, 'Achats', undefined, 'Processus Achats'], ['Audits internes', 4, 'BE', undefined, 'Processus Conception BE'], ['Audits internes', 6, 'Production', undefined, 'Processus Production'],
  ['Audits internes', 10, 'BE · 17/10', '2026-10-17', 'Processus Conception BE', '[E. Dubois]'], ['Audits internes', 12, 'Mise en serv.'],
  ['Certification', 11, 'ISO 9001 17/11', '2026-11-17', 'Audit de suivi ISO 9001', '[E. Dubois]'],
  ['Fournisseurs', 3, '[Fourn. F]'], ['Fournisseurs', 9, '[Fourn. G]'], ['Fournisseurs', 11, '[Fourn. F] · NC'],
  ['Visites sécurité', 1, 'Montage'], ['Visites sécurité', 4, 'Usinage'], ['Visites sécurité', 7, 'Magasin'],
  ['Visites sécurité', 10, 'Essais 12/10', '2026-10-12', "Visite trimestrielle — zone d'essais", '[S. Benali]', 'A-181'],
  ['Revues de direction', 6, 'Interm. 18/06', '2026-06-18', 'Revue de direction intermédiaire', '[H. Marchand]'], ['Revues de direction', 12, 'Annuelle 10/12', '2026-12-10', 'Revue de direction annuelle', '[H. Marchand]'],
  ['Audits internes', 8, 'Logistique', undefined, 'Processus Logistique et expédition'],
];
// Réalisation et périmètre des éléments du programme, par index de PLAN (un élément réalisé porte sa date de réalisation).
const PLAN_EXTRA: Record<number, Partial<typeof t.auditPlanItems.$inferInsert>> = {
  0: { done: true, doneOn: '2026-02-12', auditor: '[L. Moreau]', scope: 'Achats et sous-traitance' },
  1: { done: true, doneOn: '2026-04-16', auditor: '[L. Moreau]' },
  2: { done: true, doneOn: '2026-06-11', auditor: '[L. Moreau]', scope: 'Usinage, montage, contrôle final' },
  // Reporté de septembre au 17/10 (AUD-03 : première date prévue conservée).
  3: { auditor: '[L. Moreau]', scope: 'Processus Conception BE', postponedFrom: '2026-09-17' },
  5: { certificationId: 'iso9001', auditor: '[Organisme certificateur]', scope: 'Conception, fabrication et mise en service de machines spéciales' },
  6: { done: true, doneOn: '2026-03-19' },
  // 7 : [Fourn. G] (septembre) non confirmé — échéance passée « à confirmer ».
  9: { done: true, doneOn: '2026-01-22' },
  10: { done: true, doneOn: '2026-04-09' },
  11: { done: true, doneOn: '2026-07-07' },
  13: { done: true, doneOn: '2026-06-18' },
  // Annulé (jamais supprimé), motif conservé : hors grille, échéances, constats et dossier.
  15: { cancelledAt: new Date('2026-07-15T09:00:00+02:00'), cancelledById: 'clefevre', cancelReason: "Processus intégré au périmètre de l'audit Production de juin" },
};

// [élément du programme (index de PLAN), date, type, exigence, constat, action] ; libellé d'audit : « intitulé · mois année ».
const FINDINGS: [number, string, string, string | null, string, string | null][] = [
  [2, '2026-06-11', 'ecart_mineur', '§8.2.3', 'Revue des exigences client non formalisée pour 2 affaires (§8.2.3)', 'A-188'],
  [2, '2026-06-11', 'piste', '§8.5.1', 'Harmoniser les gammes de contrôle entre usinage et montage', 'A-212'],
  [2, '2026-06-11', 'point_fort', null, 'Traçabilité des composants critiques via Keystone', null],
  [2, '2026-06-11', 'ecart_mineur', '§7.2', 'Enregistrements de formation incomplets pour 3 intérimaires (§7.2)', 'A-205'],
  // Constat sans action : signal « constat sans action ».
  [0, '2026-02-12', 'piste', '§8.4.1', "Formaliser l'évaluation annuelle des sous-traitants", null],
];

// Check-list de la revue du 10/12/2026 [élément, fourni, source (REVIEW_SOURCES), contributeur, attendu le, complément] ;
// l'état des éléments automatiques est calculé. Les visites sécurité (attendues le 05/10) sont en retard : signal de la revue.
const REVIEW: [label: string, done: boolean, source: string, ownerId: string | null, dueOn?: string, owner?: string][] = [
  ['Suivi des actions de la revue précédente', false, 'actions', null],
  ['Résultats des audits internes et de certification', true, 'manuel', 'edubois'],
  ['Satisfaction client et réclamations', true, 'manuel', 'lmoreau'],
  ['Indicateurs sécurité : TF1, TG, pyramide', false, 'safety', null],
  ['Non-conformités, événements et contrôles périodiques', false, 'events', null],
  ['Performance des fournisseurs', false, 'manuel', 'lmoreau', '2026-11-20'],
  ['Veille réglementaire : impacts du règlement 2023/1230', false, 'manuel', 'edubois', '2026-11-30'],
  ['Adéquation des ressources et des compétences', false, 'manuel', 'clefevre', '2026-11-25'],
  ["Retour d'expérience des visites sécurité", false, 'manuel', 'sbenali', '2026-10-05'],
  ["Opportunités d'amélioration et objectifs 2027", false, 'manuel', 'clefevre', '2026-11-20', 'A-184'],
];

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** SIRET fictifs des sites de démonstration (clé de Luhn valide, jamais un SIRET réel). */
const DEMO_SIRET: Record<string, string> = { 'ville-a': '00000000000018', 'ville-b': '00000000000026' };
/** Titre de secourisme du jeu de démonstration (training_titles.first_aid). */
const FIRST_AID_TITLE = 'sst';

// Historique du workflow des événements : étape k franchie J+1, J+3, J+7, J+14, J+21 après les faits, à 10 h,
// sans dépasser la date de référence du jeu de données (09/10/2026).
const STEP_DELAYS = [1, 3, 7, 14, 21];
const SEED_TODAY = '2026-10-09';
function stepRows(eventId: string, occurredOn: string, step: number, pilotId: string | null) {
  const rows: (typeof t.eventSteps.$inferInsert)[] = [];
  let prev = 0;
  for (let k = 1; k <= step; k++) {
    const day = addDays(occurredOn, STEP_DELAYS[k - 1]);
    let at = new Date(`${day > SEED_TODAY ? SEED_TODAY : day}T10:00:00+02:00`).getTime();
    if (at <= prev) at = prev + 3_600_000;
    prev = at;
    rows.push({ eventId, kind: 'advance', fromStep: k - 1, toStep: k, byId: k === 1 ? 'clefevre' : pilotId ?? 'clefevre', at: new Date(at) });
  }
  return rows;
}

/** Dernier rôle connu des personnes de démonstration (destinataires par rôle : animateurs QHSE, direction). */
const DEMO_LAST_ROLES = new Map(Object.entries(DEMO_ROLE_PEOPLE).map(([role, id]) => [id, role as Role]));

/** E-mail de démonstration (domaine réservé .example) : « [C. Lefèvre] » → c.lefevre@epc2i.example. */
const demoEmail = (name: string) =>
  `${name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')}@epc2i.example`;

/**
 * Base de démonstration remplie par une version antérieure à la migration 0003 (cas courant : `.data/vigie` de
 * `npm run dev` et de l'application Mac) : responsable QHSE des sites, dernier rôle connu et e-mail y sont vides,
 * et toutes les alertes iraient au poste vacant. Complétés une seule fois, comme dans un jeu neuf : seulement pour le
 * jeu de démonstration (fiche de l'animatrice QHSE présente) et tant que rien n'est renseigné — un choix fait
 * ensuite dans « Gérer les sites » n'est jamais écrasé.
 */
async function upgradeDemo(db: Db) {
  // Liens réels des actions (ACT-01) : reprise idempotente des références d'origine textuelles (src/lib/origin-links.ts,
  // depuis l'ancienne origine conservée par la migration 0005 : actions.legacy_origin).
  await backfillActionLinks(db, { apply: true });
  // Plan d'actions QSE (migration 0005) : champs « à compléter » du jeu d'avant complétés une fois (src/db/seeds/actions.ts).
  await upgradeDemoActions(db);
  // Lot 2 (migration 0004) : rubriques des AT, registre des accidents bénins, mentions du registre des déchets.
  await upgradeDemoAccidents(db);
  await upgradeDemoWasteMentions(db);
  // Paquet 5 (migration 0008) : données de conformité réglementaire, une seule fois (src/db/seeds/compliance.ts).
  await db.transaction((tx) => seedCompliance(tx));
  const [[lead], [withLead], [withRole]] = await Promise.all([
    db.select({ n: count() }).from(t.people).where(eq(t.people.id, DEMO_QHSE_LEAD)),
    db.select({ n: count() }).from(t.sites).where(isNotNull(t.sites.qhseLeadId)),
    db.select({ n: count() }).from(t.people).where(isNotNull(t.people.lastRole)),
  ]);
  if (lead.n === 0 || withLead.n > 0 || withRole.n > 0) return;
  await db.transaction(async (tx) => {
    for (const [id, lastRole] of DEMO_LAST_ROLES) {
      await tx.update(t.people).set({ lastRole }).where(and(eq(t.people.id, id), isNull(t.people.lastRole)));
    }
    // E-mail unique (insensible à la casse) : une adresse déjà attribuée à une autre fiche n'est pas reprise.
    const taken = new Set((await tx.select({ email: t.people.email }).from(t.people).where(isNotNull(t.people.email)))
      .map((p) => p.email!.toLowerCase()));
    for (const [id, name] of PEOPLE) {
      const email = demoEmail(name);
      if (taken.has(email)) continue;
      await tx.update(t.people).set({ email }).where(and(eq(t.people.id, id), isNull(t.people.email)));
    }
    await tx.update(t.sites).set({ qhseLeadId: DEMO_QHSE_LEAD })
      .where(and(inArray(t.sites.id, ['ville-a', 'ville-b']), isNull(t.sites.qhseLeadId)));
  });
}

/**
 * Base de démonstration remplie avant la migration 0004 : accidents du travail sans les rubriques de la déclaration (EVT-01),
 * registre des accidents bénins vide (EVT-04), titre SST non signalé comme titre de secourisme. Sans cette reprise, modifier
 * un AT qualifié échoue tant que la victime et les circonstances ne sont pas saisies (EVT-05). Une seule fois : événement
 * EV-2026-119 présent, aucune victime renseignée sur les AT de démonstration et registre vide. Les intitulés et descriptions
 * ne sont remplacés que s'ils sont restés ceux du jeu d'origine.
 */
async function upgradeDemoAccidents(db: Db) {
  const demoAt = EVENTS.filter((e) => e[2] === 'AT').map((e) => e[0]);
  const [[marker], [withVictim], [benign]] = await Promise.all([
    db.select({ n: count() }).from(t.events).where(eq(t.events.id, 'EV-2026-119')),
    db.select({ n: count() }).from(t.events).where(and(inArray(t.events.id, demoAt), isNotNull(t.events.victimKind))),
    db.select({ n: count() }).from(t.benignAccidents),
  ]);
  if (marker.n === 0 || withVictim.n > 0 || benign.n > 0) return;
  await db.transaction(async (tx) => {
    const rows = await tx.select({ id: t.events.id, title: t.events.title, description: t.events.description })
      .from(t.events).where(inArray(t.events.id, Object.keys(EVENT_DETAILS)));
    for (const row of rows) {
      const original = EVENTS.find((e) => e[0] === row.id);
      const { title, description, ...details } = EVENT_DETAILS[row.id];
      await tx.update(t.events).set({
        ...details,
        ...(original && row.title === original[3] && title ? { title } : {}),
        ...(original && row.description === original[11] && description ? { description } : {}),
      }).where(eq(t.events.id, row.id));
    }
    const present = new Set(rows.map((r) => r.id));
    const people = new Set((await tx.select({ id: t.people.id }).from(t.people)).map((p) => p.id));
    const register = BENIGN.filter((b) => present.has(b.eventId) && (!b.caregiverId || people.has(b.caregiverId)));
    if (register.length) await tx.insert(t.benignAccidents).values(register);
    const [flagged] = await tx.select({ n: count() }).from(t.trainingTitles).where(eq(t.trainingTitles.firstAid, true));
    if (flagged.n === 0) await tx.update(t.trainingTitles).set({ firstAid: true }).where(eq(t.trainingTitles.id, FIRST_AID_TITLE));
  });
}

/**
 * Mentions du registre des déchets (DOC-02, arrêté du 31 mai 2021) d'une base de démonstration antérieure à la migration
 * 0004 : SIRET des sites de démonstration, mentions des filières FD-01 à FD-12 et de leurs enlèvements — seulement les
 * valeurs encore vides (idempotent, jamais d'écrasement d'une saisie).
 */
async function upgradeDemoWasteMentions(db: Db) {
  const [marker] = await db.select({ n: count() }).from(t.wasteStreams).where(eq(t.wasteStreams.id, 'FD-01'));
  if (marker.n === 0) return;
  const defaults = demoWasteStreamMentions();
  await db.transaction(async (tx) => {
    for (const [id, siret] of Object.entries(DEMO_SIRET)) {
      await tx.update(t.sites).set({ siret }).where(and(eq(t.sites.id, id), isNull(t.sites.siret)));
    }
    const streams = await tx.select().from(t.wasteStreams).where(inArray(t.wasteStreams.id, Object.keys(defaults)));
    for (const s of streams) {
      const d = defaults[s.id];
      if (s.collectorSiret || s.destinationSiret || s.qualification) continue;
      await tx.update(t.wasteStreams).set(d).where(eq(t.wasteStreams.id, s.id));
      const filled = { ...s, ...d };
      await tx.update(t.wasteEntries).set({ destinationSiret: filled.destinationSiret, destinationAddress: filled.destinationAddress, qualification: filled.qualification, pop: filled.pop })
        .where(and(eq(t.wasteEntries.streamId, s.id), isNull(t.wasteEntries.destinationSiret), isNull(t.wasteEntries.qualification)));
      await tx.update(t.wasteEntries).set({ transporterSiret: filled.collectorSiret, transporterAddress: filled.collectorAddress, transporterReceipt: filled.collectorReceipt })
        .where(and(eq(t.wasteEntries.streamId, s.id), eq(t.wasteEntries.transporter, s.collector), isNull(t.wasteEntries.transporterSiret)));
    }
  });
}

/**
 * Jeu de démonstration (VIGIE_DEMO=1 seulement, voir src/db/index.ts) : chargé dans une base vide (ni site ni personne) ;
 * base déjà remplie : mise à niveau unique d'un jeu de démonstration antérieur (upgradeDemo). `files` : écrit aussi les
 * fichiers des preuves des actions (VIGIE_UPLOAD_DIR) — ouverture de la base par src/db/index.ts ; db:check charge le
 * jeu sans fichiers (aucune écriture dans .data/uploads depuis une vérification en mémoire).
 */
export async function seed(db: Db, opts: { files?: boolean } = {}) {
  const [[sites], [people]] = await Promise.all([db.select({ n: count() }).from(t.sites), db.select({ n: count() }).from(t.people)]);
  if (sites.n > 0 || people.n > 0) return upgradeDemo(db);

  await db.transaction(async (tx) => {
    await tx.insert(t.sites).values([
      // Établissement Seveso seuil haut : plan de prévention écrit dès la première minute d'intervention.
      // SIRET fictifs (clé de Luhn valide) : registre des déchets (DOC-02).
      { id: 'ville-a', label: 'Site de [Ville A] — siège et ateliers', seveso: 'seuil_haut', ppFromFirstMinute: true, sort: 1, siret: DEMO_SIRET['ville-a'] },
      { id: 'ville-b', label: "Site de [Ville B] — zone d'essais", seveso: 'seuil_haut', ppFromFirstMinute: true, sort: 2, siret: DEMO_SIRET['ville-b'] },
    ]);
    await tx.insert(t.people).values(PEOPLE.map(([id, name, job, inSkillsMatrix, service], sort) => ({
      id, name, job, inSkillsMatrix, service, sort, siteId: SITE_B_PEOPLE.has(id) ? 'ville-b' : 'ville-a', ...LEFT[id],
      email: demoEmail(name), lastRole: DEMO_LAST_ROLES.get(id) ?? null,
    })));
    // Responsable QHSE des deux sites actifs : l'animatrice QHSE de démonstration.
    await tx.update(t.sites).set({ qhseLeadId: DEMO_QHSE_LEAD }).where(inArray(t.sites.id, ['ville-a', 'ville-b']));
    // Site archivé (fermé) : absent des sélecteurs, sans autre donnée rattachée.
    await tx.insert(t.sites).values({
      id: 'ville-c', label: 'Site de [Ville C] — ancien dépôt logistique', seveso: null, ppFromFirstMinute: false, sort: 3,
      archivedAt: new Date('2026-03-31T16:00:00Z'), archivedById: 'hmarchand', archiveReason: 'Dépôt fermé fin mars 2026 : activité regroupée sur le site de [Ville A].',
    });
    await tx.insert(t.keystoneProjects).values(PROJECTS.map(([id, client, title, deliveryOn]) => ({ id, client, title, deliveryOn })));

    // Heures travaillées sur 12 mois (≈ 200 ETP, dont ~10 % sur le site B) — à remplacer par la source RH.
    await tx.insert(t.hoursWorked).values(Array.from({ length: 12 }, (_, i) => {
      const m = ((8 + i) % 12) + 1, y = m >= 10 ? 2025 : 2026;
      const total = m === 8 ? 19_600 : 27_800, b = Math.round(total * 0.1);
      return [{ month: iso(y, m, 1), siteId: 'ville-a', hours: total - b }, { month: iso(y, m, 1), siteId: 'ville-b', hours: b }];
    }).flat());

    // Déclarant rapproché par identifiant de personne (null pour un déclarant externe, ex. un client).
    const declarantId = (name: string) => PEOPLE.find((p) => p[1] === name)?.[0] ?? null;
    // Accidents du travail déclarés à la CPAM (hors soins inscrits au registre des accidents bénins).
    const CPAM: Record<string, string> = { 'EV-2026-127': '2026-09-27', 'EV-2026-119': '2026-09-09' };
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
      ...(id === 'EV-2026-123' ? { dismissedAt: new Date('2026-09-20T09:00:00+02:00'), dismissedById: 'clefevre', dismissReason: 'Doublon de EV-2026-124 (même constat, même déclarant).' } : {}),
    })));
    await tx.insert(t.eventSteps).values([
      ...EVENTS.flatMap((e) => stepRows(e[0], e[1], e[10], pid(e[8]))),
      { eventId: 'EV-2026-123', kind: 'dismiss', fromStep: 0, toStep: 0, reason: 'Doublon de EV-2026-124 (même constat, même déclarant).', byId: 'clefevre', at: new Date('2026-09-20T09:00:00+02:00') },
    ]);
    await tx.insert(t.eventAnalyses).values(ANALYSES.map(([eventId, method, content]) => ({ eventId, method, content })));
    await tx.insert(t.benignAccidents).values(BENIGN);

    // Plan d'actions QSE (après les personnes et les événements) : actions, fil, journal, notifications, compteur, preuves.
    await seedActions(tx, { files: opts.files });

    // Versions archivées avant Vigie (conservées hors application, sans instantané).
    const archived = ['2015.1', '2016.1', '2017.1', '2018.1', '2019.1', '2020.1', '2021.1', '2021.2', '2022.1', '2023.1', '2024.1', '2025.1'];
    await tx.insert(t.duerpVersions).values([
      ...archived.map((version, i) => {
        const y = +version.slice(0, 4), next = archived[i + 1] ?? '2026.1';
        const updatedOn = version.endsWith('.2') ? iso(y, 9, 15) : iso(y, 3, 15);
        const archivedOn = next.endsWith('.2') ? iso(+next.slice(0, 4), 9, 15) : iso(+next.slice(0, 4), 3, 15);
        return { version, current: false, updatedOn, nextUpdateOn: iso(y + 1, 3, 15), retention: '40 ans', validatedById: 'hmarchand', archivedOn, snapshot: null };
      }),
      { version: '2026.1', current: true, updatedOn: '2026-03-15', nextUpdateOn: '2027-03-15', retention: '40 ans', validatedById: 'hmarchand', cseConsultedOn: '2026-03-20' },
    ]);
    await tx.insert(t.workUnits).values(UNITS.map(([id, label], sort) => ({ id, label, sort, siteId: id === 'essais' ? 'ville-b' : 'ville-a' })));
    const inserted = await tx.insert(t.risks).values(RISKS.map((r, sort) => ({
      unitId: r[0], hazard: r[1], situation: r[2], gravity: r[3], probability: r[4], existingMeasures: r[5],
      residualGravity: r[6], residualProbability: r[7], sort,
    }))).returning({ id: t.risks.id });
    const links = RISKS.flatMap((r, i) => r[8].map((actionId) => ({ riskId: inserted[i].id, actionId })));
    if (links.length) await tx.insert(t.riskActions).values(links);

    // Registre des mises à disposition du DUERP (DUE-01) : la demande de l'ancien salarié est encore à traiter.
    await tx.insert(t.duerpAccessRequests).values([
      { requestedOn: '2026-03-20', requesterKind: 'cse', requesterName: 'CSE — réunion ordinaire de mars', siteId: null, version: '2026.1', communicatedOn: '2026-03-20', channel: 'sur_place', note: 'Présentation de la mise à jour annuelle et consultation du CSE.', createdById: 'clefevre', createdAt: new Date('2026-03-20T16:00:00+01:00') },
      { requestedOn: '2026-04-02', requesterKind: 'medecin', requesterName: 'Service de prévention et de santé au travail', siteId: 'ville-a', version: '2026.1', communicatedOn: '2026-04-03', channel: 'electronique', note: null, createdById: 'clefevre', createdAt: new Date('2026-04-03T10:00:00+02:00') },
      { requestedOn: '2026-10-05', requesterKind: 'ancien_salarie', requesterName: '[G. Vasseur]', siteId: 'ville-a', version: '2024.1', communicatedOn: null, channel: null, note: 'Ancien monteur (2019–2024) : versions en vigueur pendant son activité.', createdById: 'clefevre', createdAt: new Date('2026-10-05T09:30:00+02:00') },
    ]);
    // PAPRIPACT 2026 en préparation (DUE-02) : sans consultation du CSE ni lignes figées.
    await tx.insert(t.preventionPrograms).values({ year: 2026, duerpVersion: '2026.1', comment: 'Programme issu de la mise à jour 2026.1, à présenter au CSE.', createdById: 'clefevre', createdAt: new Date('2026-09-01T10:00:00+02:00') });
    await tx.insert(t.preventionProgramActions).values([
      { year: 2026, actionId: 'A-205', estimatedCost: 2400, resources: 'Organisme de formation agréé · 4 × 1 jour', indicator: '4 monteurs habilités BR à jour' },
      { year: 2026, actionId: 'A-201', estimatedCost: 1800, resources: 'Services généraux · marquage sous-traité', indicator: 'Aucun presque-accident chariot / piéton sur 6 mois' },
      { year: 2026, actionId: 'A-203', estimatedCost: 12000, resources: 'Électricien ATEX externe', indicator: 'Vérification ATEX sans écart' },
      { year: 2026, actionId: 'A-214', estimatedCost: 950, resources: 'Magasin · fournisseur levage', indicator: '100 % des élingues textiles remplacées' },
    ]);
    const riskId = (unit: string, hazard: string) => inserted[RISKS.findIndex((r) => r[0] === unit && r[1] === hazard)].id;

    const reqIds = (await tx.insert(t.requirements).values(REQUIREMENTS.map((r, sort) => ({
      text: r[0], domain: r[1], summary: r[2], dueOn: r[3], dueNote: r[4], evaluation: r[5], evaluationNote: r[6], pilotId: pid(r[7]), sort,
      lastEvaluatedOn: LAST_EVALUATED[sort],
      // DUERP : échéance et état calculés depuis la version en vigueur (écran /risques).
      linkedTo: r[0].includes('R. 4121-1') ? 'duerp' : null,
      // Projets Keystone concernés calculés (livrés après le 20/01/2027) : plus de surcharge manuelle.
      ...(sort === 0 ? { featured: true, affectsProjects: true, keystoneProjects: null, actionId: 'A-196', impact: 'toute machine mise sur le marché après cette date doit y être conforme.' } : {}),
    }))).returning({ id: t.requirements.id })).map((r) => r.id);
    await tx.insert(t.requirementEvaluations).values(Object.entries(EVALUATIONS).flatMap(([i, rows]) => rows.map(([evaluatedOn, evaluation, note, by]) => ({
      requirementId: reqIds[+i], evaluatedOn, evaluation, note, evaluatedById: by, createdAt: new Date(`${evaluatedOn}T12:00:00+02:00`),
    }))));
    const controlIds = (await tx.insert(t.controls).values(CONTROLS.map((c, sort) => ({
      siteId: SITE_B_LOCATION.test(c[0]) ? 'ville-b' : 'ville-a',
      equipment: c[0], controlType: c[1], periodMonths: c[2], organization: c[3], responsibleId: c[4] ? pid(c[4]) : null,
      lastOn: c[5], nextOn: c[6], reserves: c[7], sort,
      // Appareils de levage : arrêté du 1er mars 2004 ; réserve du pont roulant portée par A-217.
      requirementId: sort === 0 || sort === 1 || sort === 8 ? reqIds[5] : null,
      actionId: sort === 0 ? 'A-217' : null,
      ...(sort === 8 ? { archivedAt: new Date('2026-06-30T10:00:00+02:00'), archivedById: 'clefevre', archiveReason: 'Équipement réformé : remplacé par le pont roulant 10 t' } : {}),
    }))).returning({ id: t.controls.id })).map((c) => c.id);
    await tx.insert(t.controlRecords).values(Object.entries(CONTROL_RECORDS).flatMap(([i, rows]) => rows.map(([performedOn, organization, reserves, notes]) => ({
      controlId: controlIds[+i], performedOn, organization, reserves, notes, recordedById: 'clefevre', createdAt: new Date(`${performedOn}T17:00:00+02:00`),
    }))));

    // Titre SST : ses titulaires valides donnent les soins du registre des accidents bénins (EVT-04).
    await tx.insert(t.trainingTitles).values(TITLES.map(([id, label, validityMonths], sort) => ({ id, label, validityMonths, sort, firstAid: id === FIRST_AID_TITLE })));
    // Titre retiré du suivi (archivé), sans exigence ni formation.
    await tx.insert(t.trainingTitles).values({
      id: 'pont-ancien', label: 'Pontier (ancien référentiel)', validityMonths: 60, sort: TITLES.length,
      archivedAt: new Date('2026-01-15T10:00:00+01:00'), archivedById: 'clefevre', archiveReason: 'Remplacé par le CACES R484',
    });
    const reqs: { personId: string; titleId: string }[] = [];
    // Formations antérieures d'abord (identifiants plus anciens), puis les formations en cours.
    const quals: (typeof t.qualifications.$inferInsert)[] = PAST_TRAININGS.map(([personId, titleId, obtainedOn, expiresOn, provider]) => ({ personId, titleId, obtainedOn, expiresOn, provider }));
    MATRIX.forEach(([personId, codes], pi) => {
      [...codes].forEach((code, ti) => {
        if (code === 'n') return;
        const [titleId, , validity] = TITLES[ti];
        reqs.push({ personId, titleId });
        if (code === 'r') return;
        const explicit = EXPIRIES[`${personId}:${titleId}`];
        const obtainedOn = iso(2025, ((pi + ti) % 12) + 1, 10 + ti);
        const expiresOn = explicit ?? (validity ? iso(2025 + Math.ceil(validity / 12), ((pi + ti) % 12) + 1, 10 + ti) : null);
        quals.push({ personId, titleId, obtainedOn: explicit ? iso(+explicit.slice(0, 4) - Math.round(validity / 12), +explicit.slice(5, 7), +explicit.slice(8, 10)) : obtainedOn, expiresOn, provider: PROVIDERS[titleId] ?? null });
      });
    });
    // Formation saisie par erreur puis annulée : sans effet sur l'état de la case.
    quals.push({
      personId: 'mgirard', titleId: 'elec', obtainedOn: '2026-10-01', expiresOn: '2029-10-01', provider: 'Formation interne', recordedById: 'clefevre',
      cancelledAt: new Date('2026-10-02T09:00:00Z'), cancelledById: 'clefevre', cancelReason: 'Saisie sur le mauvais salarié',
    });
    await tx.insert(t.qualificationRequirements).values(reqs);
    await tx.insert(t.qualifications).values(quals);
    // Recyclages : aucune action QSE (gérés par les RH, réponses du service QHSE du 15/10/2026) — plus de recyclage planifié
    // par une action (ancienne A-207).
    await tx.insert(t.keystoneAssignments).values({ personId: 'tnguyen', project: 'K-2025-042 · [Client A]', activity: 'Mise en service', startOn: '2026-10-13', endOn: '2026-10-17' });

    await tx.insert(t.certifications).values(CERTS.map((c, sort) => ({ ...c, sort })));
    const planIds = (await tx.insert(t.auditPlanItems).values(PLAN.map(([track, month, label, plannedOn, detail, owner, actionId], i) => ({
      year: 2026, track, month, label, plannedOn: plannedOn ?? null, detail: detail ?? null, ownerId: owner ? pid(owner) : null, actionId: actionId ?? null, ...PLAN_EXTRA[i],
    }))).returning({ id: t.auditPlanItems.id })).map((p) => p.id);
    await tx.insert(t.auditFindings).values(FINDINGS.map(([pi, foundOn, kind, clause, text, actionId], sort) => {
      const [, month, label, , detail] = PLAN[pi];
      return { audit: `${detail ?? label} · ${monthName(month)} 2026`, planItemId: planIds[pi], foundOn, clause, kind, text, actionId, sort };
    }));

    // Revues de direction : deux revues clôturées (avant Vigie, sans dossier figé) et la revue annuelle en préparation.
    const [r2025, r2026i, r2026] = await tx.insert(t.reviews).values([
      { reviewOn: '2025-12-11', kind: 'ordinaire', status: 'cloturee', participantIds: ['hmarchand', 'clefevre', 'lmoreau', 'edubois', 'sbenali'],
        customerPerception: 'Enquête annuelle : 8,1/10 ; délais de livraison à surveiller sur les machines spéciales.', resourceNeeds: "Recrutement d'un technicien méthodes au premier semestre 2026.",
        minutes: 'Politique QHSE reconduite. Objectif 2026 : TF1 < 4. Développer la remontée des presque-accidents ; étudier la certification ISO 45001.',
        nextReviewOn: '2026-06-18', recordedById: 'clefevre', closedOn: '2025-12-18', closedById: 'hmarchand', snapshot: null, createdAt: new Date('2025-11-03T10:00:00+01:00') },
      { reviewOn: '2026-06-18', kind: 'intermediaire', status: 'cloturee', participantIds: ['hmarchand', 'clefevre', 'lmoreau', 'sbenali'],
        minutes: "Point d'étape : TF1 en baisse, engagement ISO 45001 au second semestre 2027. Renforcer l'animation sécurité terrain.",
        nextReviewOn: '2026-12-10', recordedById: 'clefevre', closedOn: '2026-06-25', closedById: 'hmarchand', snapshot: null, createdAt: new Date('2026-05-20T10:00:00+02:00') },
      { reviewOn: '2026-12-10', kind: 'ordinaire', status: 'planifiee', createdAt: new Date('2026-06-25T10:00:00+02:00') },
    ]).returning({ id: t.reviews.id });
    await tx.update(t.actions).set({ reviewId: r2025.id }).where(inArray(t.actions.id, ['A-152', 'A-158']));
    await tx.update(t.actions).set({ reviewId: r2026i.id }).where(eq(t.actions.id, 'A-174'));
    await tx.update(t.actions).set({ reviewId: r2026.id }).where(eq(t.actions.id, 'A-184'));
    // Échéances du programme portées par les revues (AUD-01) ; la revue du 11/12/2025 n'a pas d'élément au programme 2026.
    await tx.update(t.auditPlanItems).set({ reviewId: r2026i.id }).where(eq(t.auditPlanItems.id, planIds[13])); // 'Interm. 18/06'
    await tx.update(t.auditPlanItems).set({ reviewId: r2026.id }).where(eq(t.auditPlanItems.id, planIds[14])); // 'Annuelle 10/12'
    await tx.insert(t.reviewDecisions).values([
      { reviewId: r2025.id, kind: 'objectif', text: 'Politique QHSE reconduite ; objectif 2026 : TF1 < 4', pilotId: 'hmarchand', sort: 0 },
      { reviewId: r2025.id, kind: 'decision', text: 'Développer la remontée des presque-accidents', pilotId: 'clefevre', dueOn: '2026-03-31', actionId: 'A-152', sort: 1 },
      { reviewId: r2025.id, kind: 'decision', text: "Étudier l'opportunité d'une certification ISO 45001", pilotId: 'hmarchand', dueOn: '2026-06-30', actionId: 'A-158', sort: 2 },
      { reviewId: r2025.id, kind: 'ressource', text: 'Recruter un technicien méthodes au premier semestre 2026', pilotId: 'hmarchand', dueOn: '2026-06-30', sort: 3 },
      { reviewId: r2026i.id, kind: 'decision', text: "Former les chefs d'équipe à l'animation des quarts d'heure sécurité", pilotId: 'sbenali', dueOn: '2026-09-30', actionId: 'A-174', sort: 0 },
    ]);
    await tx.insert(t.reviewItems).values(REVIEW.map(([label, done, source, ownerId, dueOn, owner], sort) => ({
      reviewId: r2026.id, label, done, source, ownerId, dueOn: dueOn ?? null, owner: owner ?? '', sort,
    })));

    await seedPrevention(tx);
    await seedDocuments(tx);
    await seedEnvironment(tx);
    await seedSitemap(tx);

    // Sources d'origine des actions Documents et Environnement (ACT-01), après l'insertion des documents et déchets.
    // A-178 (« Registre des déchets 2026 ») n'a pas de fiche source : elle reste repérée par sa référence. Plus d'action QSE
    // depuis la Prévention (anciennes A-206, A-216, A-220 : réponses du service QHSE du 15/10/2026).
    await tx.update(t.actions).set({ documentId: 'PR-QHSE-002' }).where(eq(t.actions.id, 'A-208'));
    await tx.update(t.actions).set({ wasteStreamId: 'FD-04' }).where(eq(t.actions.id, 'A-219'));
    const [fd11] = await tx.select({ id: t.wasteEntries.id }).from(t.wasteEntries)
      .where(and(eq(t.wasteEntries.streamId, 'FD-11'), eq(t.wasteEntries.removedOn, '2026-08-19')));
    await tx.update(t.actions).set({ wasteEntryId: fd11.id }).where(eq(t.actions.id, 'A-218'));

    // Rattachements facultatifs des événements (après l'insertion des contrôles, risques, documents, plans et permis).
    const EVENT_LINKS: [string, Partial<typeof t.events.$inferInsert>][] = [
      ['EV-2026-131', { controlId: controlIds[0], riskId: riskId('montage', 'Manutention mécanique'), documentId: 'IT-MON-012' }],
      ['EV-2026-130', { documentId: 'IT-USI-004' }],
      ['EV-2026-127', { riskId: riskId('usinage', 'Coupure') }],
      ['EV-2026-126', { riskId: riskId('magasin', 'Chimique / environnement') }],
      ['EV-2026-124', { riskId: riskId('montage', 'Incendie / explosion') }],
      ['EV-2026-120', { riskId: riskId('usinage', 'Projection') }],
      ['EV-2026-119', { riskId: riskId('essais', 'Chute de hauteur') }],
      ['EV-2026-115', { controlId: controlIds[1] }],
      ['EV-2026-112', { documentId: 'FO-MON-003' }],
      ['EV-2026-132', { preventionPlanId: 'PP-2026-013' }],
      ['EV-2026-133', { permitId: 'PF-2026-031' }],
    ];
    for (const [id, set] of EVENT_LINKS) await tx.update(t.events).set(set).where(eq(t.events.id, id));

    // Paquet 5 (conformité réglementaire) : après tous les modules dont il complète les données.
    await seedCompliance(tx);

    // Journal des modifications : quelques entrées de démonstration (annulations, archivages) ; celles des actions sont
    // écrites par seedActions.
    await tx.insert(t.changeLog).values([
      { entityType: 'event', entityId: 'EV-2026-123', action: 'dismiss', summary: 'Classé sans suite', reason: 'Doublon de EV-2026-124 (même constat, même déclarant).', byId: 'clefevre', at: new Date('2026-09-20T09:00:00+02:00') },
      { entityType: 'prevention_plan', entityId: 'PP-2026-010', action: 'cancel', summary: 'Plan annulé', reason: 'Intervention reportée à la campagne de printemps 2027 : un nouveau plan sera établi', byId: 'jpetit', at: new Date('2026-10-01T11:00:00+02:00') },
      { entityType: 'contractor', entityId: 'EE-007', action: 'archive', summary: 'Entreprise archivée', reason: 'Contrat de maintenance des sols terminé, entreprise plus référencée', byId: 'clefevre', at: new Date('2026-03-31T10:00:00+02:00') },
      { entityType: 'control', entityId: String(controlIds[8]), action: 'archive', summary: 'Contrôle archivé · équipement réformé', reason: 'Équipement réformé : remplacé par le pont roulant 10 t', byId: 'clefevre', at: new Date('2026-06-30T10:00:00+02:00') },
      { entityType: 'site', entityId: 'ville-c', action: 'archive', summary: 'Site archivé', reason: 'Dépôt fermé fin mars 2026 : activité regroupée sur le site de [Ville A].', byId: 'hmarchand', at: new Date('2026-03-31T16:00:00Z') },
    ]);
  });
}
