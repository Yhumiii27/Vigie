import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { addDays, monthName } from '../lib/dates';
import * as t from './schema';
import { seedDocuments } from './seeds/documents';
import { seedEnvironment } from './seeds/environment';
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
  ['EV-2026-127', '2026-09-26', 'AT', "Coupure à la main lors de l'ébavurage", 'Atelier usinage · T-4', '[M. Girard]', '', 'Tour T-4', '[S. Benali]', 2, 3, "Coupure superficielle à l'index gauche en ébavurant une bride ; gants anti-coupure non portés. Accident sans arrêt, soins à l'infirmerie.", "Rappel du port des gants, outil d'ébavurage mis à disposition au poste.", 'why', undefined, 'sans_arret'],
  ['EV-2026-126', '2026-09-24', 'ENV', "Déversement d'huile sur rétention au magasin", 'Magasin', '[R. Fontaine]', '', 'Cuve huile hydraulique 1 000 L', '[C. Lefèvre]', 1, 3, "Fuite d'un raccord de la cuve : 20 L retenus dans le bac de rétention, aucun rejet au sol.", 'Raccord resserré, huile pompée, absorbant utilisé et éliminé en déchet dangereux.', '5m'],
  ['EV-2026-125', '2026-09-22', 'NC', 'Dossier technique incomplet à la revue de conception', "Bureau d'études", '[E. Dubois]', 'K-2026-007 · [Client D]', '', '[E. Dubois]', 1, 1, 'Analyse de risques machine (EN ISO 12100) absente du dossier présenté à la revue de conception du 22/09.', 'Revue reportée au 06/10, analyse en cours.', '5m', 'Conception BE'],
  ['EV-2026-124', '2026-09-19', 'SD', 'Bouteilles de gaz stockées sans arrimage', 'Atelier montage', '[T. Nguyen]', '', 'Poste soudure', '[S. Benali]', 2, 4, "Quatre bouteilles d'argon debout sans chaîne ni râtelier, à proximité du passage des chariots.", 'Bouteilles arrimées immédiatement, zone balisée.', 'why'],
  ['EV-2026-122', '2026-09-15', 'PA', "Démarrage intempestif d'un convoyeur en mise en service", 'Mise en service · [Client B]', '[J. Petit]', 'K-2024-118 · [Client B]', 'Convoyeur CV-12', '[J. Petit]', 4, 2, 'Redémarrage du convoyeur depuis le pupitre client pendant un réglage mécanique, technicien à 40 cm de la bande.', 'Consignation LOTO systématique, clé du pupitre retirée, point avec le chef de poste client.', 'tree'],
  ['EV-2026-121', '2026-09-12', 'NC', 'Traitement de surface non conforme sur pièces fournisseur', 'Magasin · réception', '[R. Fontaine]', 'K-2025-042 · [Client A]', 'Lot [Fournisseur F] n° 4471', '[L. Moreau]', 1, 3, 'Épaisseur de zingage mesurée à 6 µm pour 12 µm spécifiés, sur 40 supports.', 'Lot refusé, dérogation refusée, relance du fournisseur.', '8d', 'Fournisseurs'],
  ['EV-2026-120', '2026-09-10', 'AT', "Projection dans l'œil lors du meulage", 'Atelier usinage', '[M. Girard]', '', "Meuleuse d'angle", '[S. Benali]', 2, 4, "Particule métallique dans l'œil droit malgré les lunettes ; écran facial non porté. Soins et retour au poste.", 'Écran facial rendu obligatoire au poste meulage, affichage mis à jour.', 'why', undefined, 'soins'],
  ['EV-2026-119', '2026-09-08', 'AT', 'Entorse en descendant de la plateforme PIRL', "Zone d'essais", '[A. Martin]', '', 'Plateforme PIRL', '[S. Benali]', 2, 4, 'Faux pas sur la dernière marche de la plateforme, entorse de la cheville. Accident avec arrêt (3 jours).', "Garde-corps et marche antidérapante vérifiés, sensibilisation de l'équipe.", 'tree', undefined, 'arret', 3],
  ['EV-2026-118', '2026-09-07', 'AT', "Pincement de doigt à la fermeture d'un carter", 'Mise en service · [Client A]', '[T. Nguyen]', 'K-2025-042 · [Client A]', '', '[S. Benali]', 1, 4, 'Pincement du majeur entre le carter et le bâti lors de la fermeture. Soins, sans arrêt.', 'Poignées de manutention ajoutées sur les carters.', 'why', undefined, 'soins'],
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

// Analyse des causes de EV-2026-131 (seul événement dont l'analyse est saisie dans la maquette).
const ANALYSES: [string, string, unknown][] = [
  ['EV-2026-131', '5m', [['Matière', 'Élingue textile usée, étiquette CMU illisible'], ['Matériel', 'Oreille de levage sans linguet de sécurité'], ['Méthode', 'Aucun mode opératoire pour le retournement'], ["Main-d'œuvre", 'Monteur seul, formation élingage à renouveler'], ['Milieu', 'Zone encombrée, visibilité réduite']]],
  ['EV-2026-131', 'tree', [[0, 'Charge basculée à 1,5 m du monteur', true], [1, "L'élingue glisse de l'oreille de levage", false], [2, 'Oreille sans linguet de sécurité', false], [2, "Angle d'élingage supérieur à 90°", false], [1, 'Monteur présent dans la zone de basculement', false], [2, 'Périmètre de levage non matérialisé', false]]],
  ['EV-2026-131', 'why', ["Pourquoi la charge a-t-elle basculé ? — L'élingue a glissé de l'oreille.", 'Pourquoi a-t-elle glissé ? — Oreille sans linguet, angle trop ouvert.', 'Pourquoi cet angle ? — Élingue trop courte pour ce bâti.', 'Pourquoi cette élingue ? — La seule disponible au poste.', "Pourquoi ? — Aucune dotation d'élingage définie par type de bâti."]],
  ['EV-2026-131', '8d', { current: 3 }],
];

// [réf, intitulé, origine, référence d'origine, pilote, échéance, statut, nature, événement, vérif. efficacité, clôture]
const ACTIONS: [string, string, string, string, string, string, string, string, string?, string?, string?][] = [
  ['A-214', 'Remplacer les élingues textiles par des élingues à œillets, étiquetage CMU', 'ev', 'EV-2026-131', '[S. Benali]', '2026-10-17', 'doing', 'C', 'EV-2026-131'],
  ['A-215', 'Rédiger le mode opératoire de retournement des bâtis > 1 t', 'ev', 'EV-2026-131', '[T. Nguyen]', '2026-10-31', 'todo', 'P', 'EV-2026-131'],
  ['A-212', "Mettre à jour la gamme de contrôle de l'arbre de malaxeur (Ø45 h7)", 'ev', 'EV-2026-130', '[L. Moreau]', '2026-10-10', 'doing', 'C', 'EV-2026-130'],
  ['A-209', 'Remplacer le flexible et contrôler les 12 flexibles du banc BE-1', 'ev', 'EV-2026-129', '[J. Petit]', '2026-10-08', 'doing', 'C', 'EV-2026-129'],
  ['A-205', 'Recyclage habilitation électrique BR pour 4 monteurs', 'risk', 'DUERP · atelier montage', '[C. Lefèvre]', '2026-09-30', 'todo', 'P'],
  ['A-203', "Mettre en conformité l'alimentation électrique de la zone ATEX", 'ev', 'EV-2026-109', '[C. Lefèvre]', '2026-09-15', 'doing', 'C', 'EV-2026-109'],
  ['A-201', 'Plan de circulation magasin : miroir et marquage au sol', 'ev', 'EV-2026-115', '[R. Fontaine]', '2026-09-26', 'doing', 'P', 'EV-2026-115'],
  ['A-198', "Remplacer les luminaires de l'allée centrale usinage", 'ev', 'EV-2026-117', '[P. Roux]', '2026-09-20', 'doing', 'C', 'EV-2026-117'],
  ['A-196', "Analyse d'écart Règlement 2023/1230 sur les 7 projets concernés", 'watch', 'Règlement (UE) 2023/1230', '[E. Dubois]', '2026-11-30', 'doing', 'P'],
  ['A-194', 'Contrôle du traitement de surface par lot à la réception', 'ev', 'EV-2026-121', '[L. Moreau]', '2026-10-24', 'doing', 'P', 'EV-2026-121'],
  ['A-190', "Corriger la fiche de réglage du réducteur RD-7 et former l'équipe", 'ev', 'EV-2026-112', '[L. Moreau]', '2026-09-05', 'verify', 'C', 'EV-2026-112', '2026-10-20'],
  ['A-188', 'Formaliser la revue des exigences client (écart mineur §8.2.3)', 'audit', 'Audit interne juin 2026', '[E. Dubois]', '2026-10-15', 'doing', 'C'],
  ['A-186', 'Remplacer les joints de la presse PC-400 sous garantie', 'client', 'EV-2026-128 · [Client C]', '[L. Moreau]', '2026-09-30', 'verify', 'C', 'EV-2026-128', '2026-10-30'],
  ['A-184', 'Objectifs QHSE 2027 et indicateurs pour la revue de direction', 'rev', 'Revue de direction 10/12', '[C. Lefèvre]', '2026-11-20', 'todo', 'P'],
  ['A-181', "Visite sécurité trimestrielle zone d'essais", 'audit', 'Programme 2026', '[S. Benali]', '2026-10-12', 'todo', 'P'],
  ['A-176', 'Remplacer le kit absorbant et former au déversement', 'ev', 'EV-2026-126', '[R. Fontaine]', '2026-09-15', 'done', 'C', 'EV-2026-126', undefined, '2026-09-18'],
  ['A-172', 'Arrimer les bouteilles de gaz : râteliers et chaînes', 'ev', 'EV-2026-124', '[S. Benali]', '2026-09-30', 'verify', 'C', 'EV-2026-124', '2026-10-28'],
  ['A-170', "Ranger les bouteilles vides sous l'abri extérieur", 'ev', 'EV-2026-124', '[S. Benali]', '2026-09-15', 'done', 'C', 'EV-2026-124', undefined, '2026-09-16'],
  ['A-165', 'Ajouter un garde-corps sur la plateforme PIRL', 'ev', 'EV-2026-119', '[S. Benali]', '2026-09-25', 'done', 'C', 'EV-2026-119', undefined, '2026-09-26'],
];

// Actions complémentaires (champs au-delà du tuple ACTIONS) : historique, annulation, efficacité dépassée, origines
// cliquables de chaque type, actions de la revue de direction, de la prévention, de la veille et de l'environnement.
// Prochain numéro libre après ces ajouts : A-220.
const MORE_ACTIONS: (typeof t.actions.$inferInsert)[] = [
  // Efficacité à vérifier, vérification dépassée depuis le 02/10.
  { id: 'A-178', title: 'Afficher les consignes de tri au poste de lavage des pièces', origin: 'env', originRef: 'Registre des déchets 2026', pilotId: 'rfontaine', dueOn: '2026-09-12', status: 'verify', kind: 'P', verifyDueOn: '2026-10-02', siteId: 'ville-a', createdAt: new Date('2026-09-01T10:00:00+02:00') },
  // Annulée (jamais supprimée) : qui, quand, pourquoi.
  { id: 'A-180', title: 'Acheter un second chariot élévateur pour le magasin', origin: 'ev', originRef: 'EV-2026-115', eventId: 'EV-2026-115', siteId: 'ville-a', pilotId: 'rfontaine', dueOn: '2026-10-05', status: 'cancelled', kind: 'C',
    cancelledAt: new Date('2026-09-24T11:00:00+02:00'), cancelledById: 'clefevre', cancelReason: 'Doublon de A-201 : le plan de circulation (miroir, marquage) couvre le besoin, validé avec le chef de service.', createdAt: new Date('2026-08-29T10:00:00+02:00') },
  // Clôturée depuis plus de 30 jours : visible avec le filtre « Historique complet ».
  { id: 'A-150', title: "Mettre à jour le livret d'accueil sécurité (sous-traitants)", origin: 'audit', originRef: 'Audit interne production · juin 2026', pilotId: 'clefevre', dueOn: '2026-07-15', status: 'done', kind: 'C', verifyDueOn: '2026-08-20',
    efficacyNote: "Livret remis aux 6 entreprises intervenues en août ; quiz d'accueil réussi par tous.", verifiedById: 'hmarchand', closedOn: '2026-08-21', siteId: null, createdAt: new Date('2026-06-15T10:00:00+02:00') },
  { id: 'A-206', title: 'Faire signer le plan de prévention PP-2026-012 par les deux entreprises', origin: 'prevention', originRef: 'PP-2026-012', siteId: 'ville-b', pilotId: 'jpetit', dueOn: '2026-10-14', status: 'todo', kind: 'P', createdAt: new Date('2026-09-15T10:00:00+02:00') },
  { id: 'A-207', title: 'Recyclage habilitation électrique — [M. Girard]', origin: 'skills', originRef: 'Habilitations · [M. Girard]', siteId: 'ville-a', pilotId: 'clefevre', dueOn: '2026-11-06', status: 'todo', kind: 'P', createdAt: new Date('2026-10-01T10:00:00+02:00') },
  { id: 'A-208', title: "Réviser PR-QHSE-002 après le retour d'expérience levage", origin: 'docs', originRef: 'PR-QHSE-002', pilotId: 'clefevre', dueOn: '2026-11-15', status: 'doing', kind: 'P', siteId: null, createdAt: new Date('2026-10-05T10:00:00+02:00') },
  // Revue de direction : décisions des revues du 11/12/2025 et du 18/06/2026 (reviewId renseigné après l'insertion des revues).
  { id: 'A-152', title: 'Déployer la remontée des presque-accidents par QR code de poste', origin: 'rev', originRef: 'Revue de direction 11/12/2025', pilotId: 'clefevre', dueOn: '2026-03-31', status: 'done', kind: 'P', efficacyNote: 'Remontée des presque-accidents ×2,4 sur 6 mois.', verifiedById: 'hmarchand', closedOn: '2026-03-27', siteId: null, createdAt: new Date('2025-12-18T10:00:00+01:00') },
  { id: 'A-158', title: "Étude d'opportunité de la certification ISO 45001", origin: 'rev', originRef: 'Revue de direction 11/12/2025', pilotId: 'hmarchand', dueOn: '2026-06-30', status: 'done', kind: 'P', efficacyNote: 'Engagement ISO 45001 décidé pour le second semestre 2027.', verifiedById: 'clefevre', closedOn: '2026-06-15', siteId: null, createdAt: new Date('2025-12-18T10:00:00+01:00') },
  { id: 'A-174', title: "Former les chefs d'équipe à l'animation des quarts d'heure sécurité", origin: 'rev', originRef: 'Revue de direction 18/06/2026', pilotId: 'sbenali', dueOn: '2026-09-30', status: 'doing', kind: 'P', siteId: null, createdAt: new Date('2026-06-25T10:00:00+02:00') },
  // Action issue d'un permis de feu (prévention).
  { id: 'A-216', title: 'Installer un écran de soudage mobile et une couverture anti-projections au poste M3', origin: 'prevention', originRef: 'PF-2026-031', siteId: 'ville-a', pilotId: 'sbenali', dueOn: '2026-10-14', status: 'todo', kind: 'P', createdAt: new Date('2026-10-08T17:00:00+02:00') },
  // Levée de la réserve de la VGP du pont roulant 10 t (controls.actionId).
  { id: 'A-217', title: 'Régler le fin de course du pont roulant 10 t (réserve VGP)', origin: 'watch', originRef: 'Pont roulant 10 t — atelier montage', siteId: 'ville-a', pilotId: 'sbenali', dueOn: '2026-10-20', status: 'todo', kind: 'C', createdAt: new Date('2026-04-03T10:00:00+02:00') },
  // Environnement : action liée à un enlèvement, puis à une filière.
  { id: 'A-218', title: 'Relancer la raffinerie pour le certificat de traitement du BSD-20260818-M3QX7TBC', origin: 'env', originRef: 'FD-11 · 19/08/2026', siteId: 'ville-b', pilotId: 'rfontaine', dueOn: '2026-10-20', status: 'todo', kind: 'C', createdAt: new Date('2026-10-07T10:00:00+02:00') },
  { id: 'A-219', title: "Contrôler l'habilitation ICPE de l'exutoire des fluides de coupe", origin: 'env', originRef: 'FD-04', siteId: 'ville-a', pilotId: 'clefevre', dueOn: '2026-11-15', status: 'todo', kind: 'P', createdAt: new Date('2026-10-07T10:00:00+02:00') },
];

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
  ['magasin', 'Chimique / environnement', "Déversement d'huile ou de solvant", 2, 2, 'Rétentions, kit absorbant', 2, 1, ['A-176']],
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

// [ligne, mois, libellé, date, intitulé d'échéance, responsable, action]
const PLAN: [string, number, string, string?, string?, string?, string?][] = [
  ['Audits internes', 2, 'Achats', undefined, 'Processus Achats'], ['Audits internes', 4, 'BE', undefined, 'Processus Conception BE'], ['Audits internes', 6, 'Production', undefined, 'Processus Production'],
  ['Audits internes', 10, 'BE · 17/10', '2026-10-17', 'Processus Conception BE', '[E. Dubois]'], ['Audits internes', 12, 'Mise en serv.'],
  ['Certification', 11, 'ISO 9001 17/11', '2026-11-17', 'Audit de suivi ISO 9001', '[E. Dubois]'],
  ['Fournisseurs', 3, '[Fourn. F]'], ['Fournisseurs', 9, '[Fourn. G]'], ['Fournisseurs', 11, '[Fourn. F] · NC'],
  ['Visites sécurité', 1, 'Montage'], ['Visites sécurité', 4, 'Usinage'], ['Visites sécurité', 7, 'Magasin'],
  ['Visites sécurité', 10, 'Essais 12/10', '2026-10-12', "Visite trimestrielle — zone d'essais", '[S. Benali]', 'A-181'],
  ['Revues de direction', 6, 'Interm. 18/06', '2026-06-18', 'Revue de direction intermédiaire', '[H. Marchand]'], ['Revues de direction', 12, 'Annuelle 10/12', '2026-12-10', 'Revue de direction annuelle', '[H. Marchand]'],
];
// Réalisation et périmètre des éléments du programme, par index de PLAN (un élément réalisé porte sa date de réalisation).
const PLAN_EXTRA: Record<number, Partial<typeof t.auditPlanItems.$inferInsert>> = {
  0: { done: true, doneOn: '2026-02-12', auditor: '[L. Moreau]', scope: 'Achats et sous-traitance' },
  1: { done: true, doneOn: '2026-04-16', auditor: '[L. Moreau]' },
  2: { done: true, doneOn: '2026-06-11', auditor: '[L. Moreau]', scope: 'Usinage, montage, contrôle final' },
  3: { auditor: '[L. Moreau]', scope: 'Processus Conception BE' },
  5: { certificationId: 'iso9001', auditor: '[Organisme certificateur]', scope: 'Conception, fabrication et mise en service de machines spéciales' },
  6: { done: true, doneOn: '2026-03-19' },
  // 7 : [Fourn. G] (septembre) non confirmé — échéance passée « à confirmer ».
  9: { done: true, doneOn: '2026-01-22' },
  10: { done: true, doneOn: '2026-04-09' },
  11: { done: true, doneOn: '2026-07-07' },
  13: { done: true, doneOn: '2026-06-18' },
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

export async function seed(db: PgliteDatabase<typeof t>) {
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from sites`)).rows;
  if (n > 0) return;

  await db.transaction(async (tx) => {
    await tx.insert(t.sites).values([
      // Établissement Seveso seuil haut : plan de prévention écrit dès la première minute d'intervention.
      { id: 'ville-a', label: 'Site de [Ville A] — siège et ateliers', seveso: 'seuil_haut', ppFromFirstMinute: true, sort: 1 },
      { id: 'ville-b', label: "Site de [Ville B] — zone d'essais", seveso: 'seuil_haut', ppFromFirstMinute: true, sort: 2 },
    ]);
    await tx.insert(t.people).values(PEOPLE.map(([id, name, job, inSkillsMatrix, service], sort) => ({
      id, name, job, inSkillsMatrix, service, sort, siteId: SITE_B_PEOPLE.has(id) ? 'ville-b' : 'ville-a', ...LEFT[id],
    })));
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

    const eventSite = new Map(EVENTS.map((e) => [e[0], SITE_B_LOCATION.test(e[4]) ? 'ville-b' : 'ville-a']));
    await tx.insert(t.actions).values(ACTIONS.map((a) => ({
      id: a[0], title: a[1], origin: a[2], originRef: a[3], pilotId: pid(a[4]), dueOn: a[5], status: a[6], kind: a[7],
      eventId: a[8] ?? null, verifyDueOn: a[9] ?? null, closedOn: a[10] ?? null,
      siteId: a[8] ? eventSite.get(a[8])! : a[3].startsWith('DUERP') ? 'ville-a' : null,
      createdAt: new Date(`${a[8] ? EVENTS.find((e) => e[0] === a[8])![1] : '2026-09-01'}T10:00:00+02:00`),
    })));
    await tx.insert(t.actions).values(MORE_ACTIONS);

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

    await tx.insert(t.trainingTitles).values(TITLES.map(([id, label, validityMonths], sort) => ({ id, label, validityMonths, sort })));
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
    // Recyclage planifié de l'habilitation électrique de [M. Girard] (expire le 28/11).
    await tx.update(t.qualificationRequirements).set({ renewalActionId: 'A-207' })
      .where(and(eq(t.qualificationRequirements.personId, 'mgirard'), eq(t.qualificationRequirements.titleId, 'elec')));
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

    // Journal des modifications : quelques entrées de démonstration (créations, annulations, archivages).
    await tx.insert(t.changeLog).values([
      { entityType: 'action', entityId: 'A-214', action: 'create', summary: 'Action créée', byId: 'clefevre', at: new Date('2026-10-03T10:00:00+02:00') },
      { entityType: 'action', entityId: 'A-190', action: 'status', summary: 'Déclarée réalisée · vérification d’efficacité prévue le 20/10/2026', byId: 'lmoreau', at: new Date('2026-09-20T16:00:00+02:00') },
      { entityType: 'action', entityId: 'A-180', action: 'cancel', summary: 'Action annulée', reason: 'Doublon de A-201 : le plan de circulation (miroir, marquage) couvre le besoin, validé avec le chef de service.', byId: 'clefevre', at: new Date('2026-09-24T11:00:00+02:00') },
      { entityType: 'event', entityId: 'EV-2026-123', action: 'dismiss', summary: 'Classé sans suite', reason: 'Doublon de EV-2026-124 (même constat, même déclarant).', byId: 'clefevre', at: new Date('2026-09-20T09:00:00+02:00') },
      { entityType: 'prevention_plan', entityId: 'PP-2026-010', action: 'cancel', summary: 'Plan annulé', reason: 'Intervention reportée à la campagne de printemps 2027 : un nouveau plan sera établi', byId: 'jpetit', at: new Date('2026-10-01T11:00:00+02:00') },
      { entityType: 'contractor', entityId: 'EE-007', action: 'archive', summary: 'Entreprise archivée', reason: 'Contrat de maintenance des sols terminé, entreprise plus référencée', byId: 'clefevre', at: new Date('2026-03-31T10:00:00+02:00') },
      { entityType: 'control', entityId: String(controlIds[8]), action: 'archive', summary: 'Contrôle archivé · équipement réformé', reason: 'Équipement réformé : remplacé par le pont roulant 10 t', byId: 'clefevre', at: new Date('2026-06-30T10:00:00+02:00') },
      { entityType: 'site', entityId: 'ville-c', action: 'archive', summary: 'Site archivé', reason: 'Dépôt fermé fin mars 2026 : activité regroupée sur le site de [Ville A].', byId: 'hmarchand', at: new Date('2026-03-31T16:00:00Z') },
    ]);
  });
}
