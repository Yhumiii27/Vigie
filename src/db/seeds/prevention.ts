import 'server-only';
import { PERMIT_TYPES, type PermitType } from '@/components/prevention/model';
import * as t from '../schema';
import type { SeedTx } from './types';
import { rel } from './dates';

// Jeu de données initial du domaine « Plans de prévention et permis », relatif aux 07 et 08/10/2026.
// Les deux sites sont Seveso seuil haut avec la règle interne « plan écrit et signé dès la première minute »
// (sites.ppFromFirstMinute, voir seed.ts). Écarts les 07 et 08/10, à toute heure (interventions d'entreprises extérieures
// sans plan signé : plans en cours et permis demandés ou délivrés) : exactement deux, sur le site A — PP-2026-013
// (signature de l'entreprise extérieure manquante) et PP-2026-015 (brouillon, sans inspection commune) — repris dans
// la veille (R. 4512-6 · « 2 interventions sans plan signé · 1 écart passé sur 12 mois »). Écart passé (PRV-01, indicateurs
// de la veille et de la revue, pas le badge) : PP-2026-008 (clos), signé le lendemain du démarrage de l'intervention (écart
// traité sur place, sans action QSE : réponses du service QHSE du 15/10/2026). La demande PF-2026-032 relève de l'intervention
// PP-2026-015 : elle est en écart, comptée avec son plan (« Écart · compté avec PP-2026-015 »), et sa délivrance est bloquée.
// Les autres permis d'entreprises extérieures sont rattachés à un plan signé couvrant leur validité (PF-2026-029, PE-2026-009) ;
// les autres permis sont réalisés par le personnel interne (sans entreprise extérieure ni intervenant d'une autre entreprise).
// PP-2026-017 (6 h, sans travaux dangereux) illustre la règle : non obligatoire au sens de R. 4512-7, exigé et signé au titre de Seveso.
// Traçabilité (jamais de suppression) : l'entreprise EE-007 est archivée avec son plan clos PP-2025-033 ; PP-2026-010 est annulé
// (intervention reportée, motif conservé) ; PF-2026-028 est annulé avec son motif. Échéances : PP-2026-011 est à clore (période
// terminée), PP-2026-018 a une inspection commune prévue le 15/10, PE-2026-009 est à délivrer. Ces plans sont signés, clos, annulés
// ou à venir : ils n'ajoutent aucun écart.
// Contenu réglementaire (PRV-02, R. 4511-10, R. 4512-8 1° à 5°, R. 4512-9) : renseigné pour les plans signés ou clos (CONTENT) ;
// PP-2026-015 et PP-2026-018 (brouillons) restent « contenu à compléter », PP-2026-010 (annulé) vide.

// [id, raison sociale, corps de métier, contact, téléphone, e-mail]
const CONTRACTORS: [string, string, string, string, string, string][] = [
  ['EE-001', '[Entreprise Levage Ouest]', 'Maintenance des appareils de levage', '[M. Lebrun]', '02 61 91 10 20', 'planning@levage-ouest.example'],
  ['EE-002', '[Entreprise Élec Industrie]', 'Électricité industrielle', '[N. Carpentier]', '02 61 91 10 35', 'interventions@elec-industrie.example'],
  ['EE-003', '[Entreprise Nettoyage Atlantique]', 'Nettoyage industriel', '[F. Mercier]', '06 39 98 20 14', 'exploitation@nettoyage-atlantique.example'],
  ['EE-004', '[Entreprise Chaudronnerie Soudure]', 'Chaudronnerie et soudure', '[S. Garnier]', '06 39 98 31 07', 'atelier@chaudronnerie-soudure.example'],
  ['EE-005', '[Entreprise Contrôle ATEX]', 'Inspection et maintenance du matériel ATEX', '[V. Rousseau]', '02 61 91 44 60', 'contact@controle-atex.example'],
  ['EE-006', '[Entreprise Sécurité Incendie]', 'Maintenance des extincteurs et RIA', '[C. Perrin]', '02 61 91 52 75', 'maintenance@securite-incendie.example'],
  ['EE-007', '[Entreprise Peinture Industrielle]', 'Peinture et revêtements de sols', '[R. Blanc]', '02 61 91 60 12', 'chantiers@peinture-industrielle.example'],
];
// Entreprises archivées (plus référencées, historique conservé).
const ARCHIVED: Record<string, { archivedAt: Date; archivedById: string; archiveReason: string }> = {
  'EE-007': { archivedAt: new Date(`${rel(-192)}T10:00:00+02:00`), archivedById: 'clefevre', archiveReason: 'Contrat de maintenance des sols terminé, entreprise plus référencée' },
};

type PlanSeed = {
  id: string; siteId: string; contractorId: string; title: string; location: string; startOn: string; endOn: string;
  estimatedHours: number; dangerousWork: boolean; keystoneProject?: string; inspectionOn?: string;
  interferenceRisks: string; measures: string; status: string; signedEuOn?: string; signedEeOn?: string; ownerId: string;
  cancelledAt?: Date; cancelledById?: string; cancelReason?: string;
  firstSignedOn?: string;
};

/** Contenu réglementaire du plan (PRV-02) : colonnes dédiées de prevention_plans. */
type PlanContent = {
  eeHeadcount?: number; eeSupervisor?: string; subcontracting?: string; dangerousPhases?: string; equipment?: string;
  workerInstructions?: string; emergencyOrganisation?: string; coordination?: string; sirPosts?: string;
};

const EMERGENCY_A = 'évacuation selon le plan affiché, point de rassemblement parking nord ; secours 18/112, poste de garde 2222';
const EMERGENCY_B = "évacuation selon le plan affiché de la zone d'essais ; secours 18/112, poste de garde 2222";

const CONTENT: Record<string, PlanContent> = {
  'PP-2025-033': {
    eeHeadcount: 4, eeSupervisor: '[R. Blanc], conducteur de travaux revêtements de sols', subcontracting: 'Aucun sous-traitant',
    dangerousPhases: 'Ponçage du support (poussières) ; application de la résine (vapeurs de solvants) ; circulation pendant le séchage',
    equipment: "Ponceuse, aspirateur de chantier et ventilateurs d'extraction de l'entreprise extérieure ; aucun matériel prêté",
    workerInstructions: "Accueil sécurité du site Seveso ; aucune source d'ignition dans l'atelier ; FDS de la résine affichées à l'entrée ; masque A2P2 pendant l'application",
    emergencyOrganisation: `SST de l'atelier usinage, extincteurs CO2 et poudre à l'entrée de la zone ; ${EMERGENCY_A}`,
    coordination: "Points d'ouverture et de fin de chantier avec le chef d'atelier usinage ; accès aux zones sèches validé par [S. Benali]",
    sirPosts: 'Aucun poste',
  },
  'PP-2025-041': {
    eeHeadcount: 2, eeSupervisor: "[F. Mercier], chef d'équipe nettoyage industriel", subcontracting: 'Aucun sous-traitant',
    dangerousPhases: 'Lavage des fosses de rétention (sols glissants, fluides de coupe) ; vidage des bacs à copeaux près des convoyeurs ; détergents alcalins',
    equipment: "Autolaveuse et nettoyeur haute pression de l'entreprise extérieure ; convoyeurs à copeaux consignés par le personnel interne ; aucun matériel prêté",
    workerInstructions: 'Accueil sécurité du site Seveso pour chaque nouvel intervenant ; convoyeurs consignés avant intervention ; zones lavées balisées ; FDS des produits remises au service QHSE',
    emergencyOrganisation: `Intervention de 5 h à 8 h : poste de garde prévenu à l'arrivée ; douche de sécurité de l'atelier usinage ; ${EMERGENCY_A}`,
    coordination: 'Planning mensuel validé par [S. Benali] ; fiche de liaison au poste de garde à chaque intervention',
    sirPosts: 'Aucun poste',
  },
  'PP-2026-008': {
    eeHeadcount: 2, eeSupervisor: "[S. Garnier], chef d'équipe chaudronnerie", subcontracting: 'Aucun sous-traitant',
    dangerousPhases: "Soudage à l'arc dans la trémie (espace semi-confiné, fumées) ; meulage des cordons ; travail sur la passerelle de chargement",
    equipment: "Postes de soudage et extracteur de fumées de l'entreprise extérieure ; passerelle et garde-corps du poste de chargement (installations du site)",
    workerInstructions: 'Permis de feu journalier ; trémie vidée, nettoyée et consignée avant intervention ; surveillance de 2 h après les travaux par points chauds',
    emergencyOrganisation: `SST de l'atelier montage, extincteurs à poudre au pied de la trémie ; ${EMERGENCY_A}`,
    coordination: "Chargement suspendu pendant l'intervention ; point quotidien avec [S. Benali]",
    sirPosts: 'Aucun poste',
  },
  'PP-2026-009': {
    eeHeadcount: 2, eeSupervisor: "[N. Carpentier], chargé d'affaires électricité industrielle (habilité BR, BC)",
    subcontracting: 'Thermographie sous-traitée à [Cabinet Thermographie Ouest] (opérateur certifié)',
    dangerousPhases: 'Ouverture des armoires sous tension pour la thermographie ; resserrage des connexions après consignation',
    equipment: "Caméra thermique et outillage isolé de l'entreprise extérieure ; cadenas de consignation fournis par le site",
    workerInstructions: 'Accueil sécurité du site Seveso ; habilitations BR et BC vérifiées ; périmètre balisé devant les armoires ouvertes ; EPI arc électrique',
    emergencyOrganisation: `SST des ateliers, défibrillateur à l'accueil ; coupure d'urgence au TGBT ; ${EMERGENCY_A}`,
    coordination: "Coupures programmées avec les chefs d'atelier ; consignation par le chargé de consignation interne",
    sirPosts: 'Aucun poste',
  },
  'PP-2026-011': {
    eeHeadcount: 1, eeSupervisor: '[C. Perrin], technicien de maintenance incendie', subcontracting: 'Aucun sous-traitant',
    dangerousPhases: 'Circulation en zone ATEX 2 ; mise en eau des RIA',
    equipment: "Outillage de l'entreprise extérieure ; aucun matériel prêté",
    workerInstructions: "Accueil sécurité de la zone d'essais ; accompagnement par le chef de zone ; aucun appareil électrique non ATEX en zone 2",
    emergencyOrganisation: `SST de la zone d'essais ; ${EMERGENCY_B}`,
    coordination: "Intervention hors campagne d'essais, validée par [J. Petit]",
    sirPosts: 'Aucun poste',
  },
  'PP-2026-012': {
    eeHeadcount: 2, eeSupervisor: "[S. Garnier], chef d'équipe chaudronnerie", subcontracting: 'Aucun sous-traitant',
    dangerousPhases: 'Soudage par points chauds près du banc BE-1 ; travail en hauteur sur la plateforme ; levage des éléments de garde-corps',
    equipment: "Postes de soudage de l'entreprise extérieure ; ligne de vie provisoire installée par l'entreprise extérieure",
    workerInstructions: 'Permis de feu journalier ; essais suspendus pendant les points chauds ; harnais sur la plateforme',
    emergencyOrganisation: `SST de la zone d'essais, extincteurs à poudre au pied de la plateforme ; ${EMERGENCY_B}`,
    coordination: "Point quotidien avec [J. Petit] ; campagne d'essais décalée",
    sirPosts: 'Aucun poste',
  },
  'PP-2026-013': {
    eeHeadcount: 3, eeSupervisor: "[M. Lebrun], chef d'équipe maintenance levage", subcontracting: 'Aucun sous-traitant',
    dangerousPhases: 'Travail en nacelle sur le chemin de roulement ; dépose et levage du câble ; essais des fins de course pont déconsigné',
    equipment: "Nacelle de l'entreprise extérieure (VGP à jour) ; pont 5 t prêté par l'atelier pour les levages du poste M3, conduit par le personnel interne",
    workerInstructions: "Accueil sécurité du site Seveso avant l'intervention ; consignation du pont par le chargé de consignation ; zone balisée interdite sous la nacelle",
    emergencyOrganisation: "SST de l'atelier montage, alarme et évacuation selon le plan affiché, point de rassemblement parking nord ; secours 18/112, poste de garde 2222",
    coordination: "Point quotidien 7 h 30 avec le chef d'atelier montage ; levages coordonnés par [S. Benali]",
    sirPosts: 'Aucun poste',
  },
  'PP-2026-014': {
    eeHeadcount: 2, eeSupervisor: '[V. Rousseau], technicien ATEX (certification ISM-ATEX)', subcontracting: 'Aucun sous-traitant',
    dangerousPhases: "Ouverture d'enveloppes antidéflagrantes en zone 2 ; essais des matériels remis en état",
    equipment: "Explosimètre et outillage antiétincelles de l'entreprise extérieure ; bancs BE-1 et BE-2 (installations du site) arrêtés",
    workerInstructions: "Accueil sécurité de la zone d'essais ; mesure d'atmosphère avant ouverture ; permis d'essai suspendu pendant l'intervention",
    emergencyOrganisation: `SST de la zone d'essais ; arrêt d'urgence des bancs ; ${EMERGENCY_B}`,
    coordination: "Interventions planifiées hors campagnes d'essais avec [J. Petit]",
    sirPosts: 'Aucun poste',
  },
  'PP-2026-015': { eeHeadcount: 2, eeSupervisor: "[S. Garnier], chef d'équipe chaudronnerie" },
  'PP-2026-016': {
    eeHeadcount: 3, eeSupervisor: "[N. Carpentier], chargé d'affaires électricité industrielle (habilité B2V, BR)", subcontracting: 'Aucun sous-traitant',
    dangerousPhases: "Travaux au voisinage de pièces nues sous tension ; coupure générale de l'atelier montage le 20/10 ; raccordement du poste d'essais",
    equipment: "Outillage isolé et VAT de l'entreprise extérieure ; TGBT consigné par le chargé de consignation interne",
    workerInstructions: "Habilitations B2V et BR vérifiées ; consignation du TGBT avant intervention ; vérification d'absence de tension ; balisage et affichage",
    emergencyOrganisation: `SST de l'atelier montage, défibrillateur à l'accueil ; ${EMERGENCY_A}`,
    coordination: "Coupure du 20/10 programmée hors production avec [S. Benali] ; coordination avec le montage de la cellule [Client E] sur le poste voisin",
    sirPosts: 'Aucun poste',
  },
  'PP-2026-017': {
    eeHeadcount: 1, eeSupervisor: '[C. Perrin], technicien de maintenance incendie', subcontracting: 'Aucun sous-traitant',
    dangerousPhases: 'Circulation dans les ateliers en production et au magasin ; mise en eau des RIA',
    equipment: "Outillage et extincteurs de remplacement de l'entreprise extérieure ; aucun matériel prêté",
    workerInstructions: 'Accueil sécurité du site Seveso ; accompagnement par le service QHSE ; gilet haute visibilité et chaussures de sécurité',
    emergencyOrganisation: `SST des ateliers ; ${EMERGENCY_A}`,
    coordination: "Passage poste par poste annoncé aux chefs d'atelier par [C. Lefèvre]",
    sirPosts: 'Aucun poste',
  },
  'PP-2026-018': { dangerousPhases: "Travail en hauteur sur le chemin de roulement ; levage du moto-réducteur au-dessus des postes d'usinage" },
};

const PLANS: PlanSeed[] = [
  {
    // Écart passé (PRV-01) : plan signé par les deux entreprises le lendemain du démarrage (13/04) ; aucune action QSE.
    id: 'PP-2026-008', siteId: 'ville-a', contractorId: 'EE-004',
    title: 'Réparation par soudage de la trémie du poste de chargement',
    location: 'Atelier montage · poste de chargement', startOn: rel(-179), endOn: rel(-177), estimatedHours: 18, dangerousWork: true,
    inspectionOn: rel(-179), signedEuOn: rel(-178), signedEeOn: rel(-178), firstSignedOn: rel(-178), status: 'clos', ownerId: 'clefevre',
    interferenceRisks: 'Soudage dans la trémie du poste de chargement ; chargement des bâtis suspendu ; circulation du chariot élévateur au pied du poste.',
    measures: 'Trémie vidée et consignée ; permis de feu journalier ; balisage du pied de la trémie ; extracteur de fumées.',
  },
  {
    // Historique de l'entreprise archivée EE-007.
    id: 'PP-2025-033', siteId: 'ville-a', contractorId: 'EE-007',
    title: "Réfection de la résine de sol de l'atelier usinage",
    location: 'Atelier usinage', startOn: rel(-431), endOn: rel(-421), estimatedHours: 160, dangerousWork: false,
    inspectionOn: rel(-438), signedEuOn: rel(-437), signedEeOn: rel(-436), status: 'clos', ownerId: 'sbenali',
    interferenceRisks: "Vapeurs de solvants de la résine ; sols glissants pendant la pose ; circulation des chariots vers le magasin.",
    measures: "Atelier fermé pendant les travaux (congés d'été) ; ventilation forcée ; aucune source d'ignition ni point chaud dans la zone ; balisage des accès et circulation déviée.",
  },
  {
    id: 'PP-2026-010', siteId: 'ville-b', contractorId: 'EE-003',
    title: "Nettoyage haute pression des bacs de rétention de la zone d'essais",
    location: "Zone d'essais · bacs de rétention", startOn: rel(10), endOn: rel(11), estimatedHours: 14, dangerousWork: false,
    status: 'annule', ownerId: 'jpetit',
    cancelledAt: new Date(`${rel(-8)}T11:00:00+02:00`), cancelledById: 'jpetit',
    cancelReason: 'Intervention reportée à la campagne de printemps 2027 : un nouveau plan sera établi',
    interferenceRisks: "Projections d'eau sous pression près des armoires des bancs ; effluents chargés en huile ; coactivité avec les essais.",
    measures: '',
  },
  {
    // Période d'intervention terminée, plan signé non clos : échéance « Plan à clore ».
    id: 'PP-2026-011', siteId: 'ville-b', contractorId: 'EE-006',
    title: "Vérification annuelle des extincteurs et RIA de la zone d'essais",
    location: "Zone d'essais et bureaux", startOn: rel(-9), endOn: rel(-7), estimatedHours: 5, dangerousWork: false,
    inspectionOn: rel(-14), signedEuOn: rel(-11), signedEeOn: rel(-11), status: 'signe', ownerId: 'jpetit',
    interferenceRisks: "Circulation du technicien en zone ATEX 2 pendant les essais ; RIA mis en eau.",
    measures: "Intervention hors campagne d'essais ; accompagnement par le chef de zone ; accueil sécurité de la zone d'essais ; essais des RIA hors zones de passage.",
  },
  {
    // Inspection commune prévue le 15/10, démarrage au-delà de l'horizon des échéances.
    id: 'PP-2026-018', siteId: 'ville-a', contractorId: 'EE-001',
    title: 'Remplacement du moto-réducteur de translation du pont roulant 5 t',
    location: 'Atelier usinage · pont roulant 5 t', startOn: rel(17), endOn: rel(19), estimatedHours: 24, dangerousWork: true,
    inspectionOn: rel(6), status: 'brouillon', ownerId: 'sbenali',
    interferenceRisks: "Travail en hauteur sur le chemin de roulement au-dessus des postes d'usinage ; levage du moto-réducteur ; circulation dans l'allée centrale.",
    measures: '',
  },
  {
    id: 'PP-2025-041', siteId: 'ville-a', contractorId: 'EE-003',
    title: 'Nettoyage industriel des ateliers, des fosses de rétention et des bacs à copeaux (contrat annuel)',
    location: 'Ateliers montage et usinage', startOn: rel(-277), endOn: rel(70), estimatedHours: 520, dangerousWork: false,
    inspectionOn: rel(-305), signedEuOn: rel(-303), signedEeOn: rel(-301), status: 'signe', ownerId: 'sbenali',
    interferenceRisks: "Coactivité avec la production (chariot élévateur, pont roulant, usinage en cours) ; sols glissants pendant le lavage ; contact avec les fluides de coupe.",
    measures: "Interventions planifiées de 5 h à 8 h, hors présence des équipes ; zones lavées balisées ; convoyeurs à copeaux arrêtés et consignés ; fiches de données de sécurité des produits remises ; chaussures antidérapantes, gants nitrile et lunettes.",
  },
  {
    id: 'PP-2026-009', siteId: 'ville-a', contractorId: 'EE-002',
    title: 'Thermographie infrarouge et resserrage des armoires électriques',
    location: 'Ateliers montage et usinage · TGBT et armoires divisionnaires', startOn: rel(-116), endOn: rel(-112), estimatedHours: 32, dangerousWork: true,
    inspectionOn: rel(-123), signedEuOn: rel(-121), signedEeOn: rel(-120), status: 'clos', ownerId: 'clefevre',
    interferenceRisks: "Armoires ouvertes sous tension à proximité des postes de travail ; coupures partielles de l'alimentation des machines.",
    measures: "Intervenants habilités BR et BC ; périmètre balisé devant les armoires ouvertes ; coupures programmées avec les chefs d'atelier ; EPI arc électrique ; consignation avant resserrage.",
  },
  {
    id: 'PP-2026-012', siteId: 'ville-b', contractorId: 'EE-004',
    title: "Fabrication et pose d'un garde-corps soudé sur la plateforme PIRL",
    location: "Zone d'essais · plateforme PIRL", startOn: rel(-18), endOn: rel(-14), estimatedHours: 24, dangerousWork: true,
    inspectionOn: rel(-23), signedEuOn: rel(-22), signedEeOn: rel(-21), status: 'clos', ownerId: 'jpetit',
    interferenceRisks: "Soudage à proximité du banc BE-1 et du stockage des produits inertes ; travail en hauteur au-dessus du passage.",
    measures: "Permis de feu journalier ; essais suspendus pendant les travaux par points chauds ; balisage au sol sous la plateforme ; harnais et ligne de vie provisoire.",
  },
  {
    id: 'PP-2026-013', siteId: 'ville-a', contractorId: 'EE-001',
    title: 'Maintenance du pont roulant 10 t : réglage des fins de course et remplacement du câble',
    location: 'Atelier montage · chemin de roulement du pont 10 t', startOn: rel(-4), endOn: rel(0), estimatedHours: 140, dangerousWork: true,
    inspectionOn: rel(-7), signedEuOn: rel(-7), status: 'a_signer', ownerId: 'sbenali',
    interferenceRisks: "Postes de montage M2 et M3 sous le chemin de roulement ; retournement des bâtis K-2025-042 en cours ; circulation du chariot élévateur dans l'allée centrale.",
    measures: "Pont consigné pendant toute l'intervention ; nacelle conduite par un titulaire du CACES R486, harnais en nacelle ; zone balisée au sol sous la nacelle ; levages du poste M3 reportés sur le pont 5 t.",
  },
  {
    id: 'PP-2026-014', siteId: 'ville-b', contractorId: 'EE-005',
    title: "Inspection et maintenance du matériel ATEX de la zone d'essais (contrat annuel)",
    location: "Zone d'essais · bancs BE-1 et BE-2, local des simulants (zone 2)", startOn: rel(-270), endOn: rel(70), estimatedHours: 64, dangerousWork: true,
    keystoneProject: 'K-2024-118 · [Client B]',
    inspectionOn: rel(-276), signedEuOn: rel(-274), signedEeOn: rel(-273), status: 'signe', ownerId: 'jpetit',
    interferenceRisks: "Interventions en zone ATEX 2 pendant les campagnes d'essais ; ouverture d'enveloppes antidéflagrantes ; coactivité avec les techniciens d'essais.",
    measures: "Interventions sur banc arrêté, hors campagne d'essais ; mesure d'atmosphère avant ouverture des matériels ; outillage antiétincelles ; permis d'essai suspendu pendant l'intervention ; accueil sécurité de la zone d'essais.",
  },
  {
    id: 'PP-2026-015', siteId: 'ville-a', contractorId: 'EE-004',
    title: 'Renforcement de la charpente de la mezzanine de stockage (soudage de platines)',
    location: 'Magasin · mezzanine de stockage', startOn: rel(-3), endOn: rel(7), estimatedHours: 90, dangerousWork: true,
    status: 'brouillon', ownerId: 'clefevre',
    interferenceRisks: "Circulation du chariot élévateur sous la mezzanine ; cartons et palettes bois stockés à proximité ; préparation des commandes en cours.",
    measures: '',
  },
  {
    id: 'PP-2026-016', siteId: 'ville-a', contractorId: 'EE-002',
    title: "Extension du TGBT et raccordement du poste d'essais de la cellule de remplissage",
    location: "Atelier montage · TGBT et poste d'essais", startOn: rel(10), endOn: rel(14), estimatedHours: 60, dangerousWork: true,
    keystoneProject: 'K-2025-061 · [Client E]', inspectionOn: rel(-3), status: 'a_signer', ownerId: 'sbenali',
    interferenceRisks: "Coupure générale de l'atelier montage le 20/10 ; travaux au voisinage de pièces nues sous tension ; montage de la cellule [Client E] en cours sur le poste voisin.",
    measures: "Consignation du TGBT par le chargé de consignation interne ; intervenants habilités B2V et BR ; coupure programmée hors production ; balisage et affichage ; vérification d'absence de tension avant intervention.",
  },
  {
    // 6 h sans travaux dangereux : plan non requis par R. 4512-7, exigé dès la première minute sur ce site Seveso seuil haut.
    id: 'PP-2026-017', siteId: 'ville-a', contractorId: 'EE-006',
    title: "Vérification annuelle des extincteurs et des robinets d'incendie armés",
    location: 'Ateliers, magasin et bureaux', startOn: rel(4), endOn: rel(4), estimatedHours: 6, dangerousWork: false,
    inspectionOn: rel(-3), signedEuOn: rel(-2), signedEeOn: rel(-2), status: 'signe', ownerId: 'clefevre',
    interferenceRisks: "Circulation du technicien dans les ateliers en production et au magasin (chariot élévateur) ; RIA mis en eau pendant les essais.",
    measures: "Accompagnement par un membre du service QHSE ; essais des RIA hors zones de passage, sols essuyés aussitôt ; extincteurs déposés remplacés poste par poste ; gilet haute visibilité et chaussures de sécurité.",
  },
];

type PermitSeed = {
  id: string; type: PermitType; siteId: string; location: string; description: string; contractorId?: string; performer: string;
  issuerId?: string; preventionPlanId?: string; keystoneProject?: string; validFrom: string; validTo: string; watchUntil?: string;
  checked: number; status: string; closedAt?: string; cancelledById?: string; cancelReason?: string;
};

const PERMITS: PermitSeed[] = [
  {
    id: 'PE-2026-007', type: 'essai', siteId: 'ville-b', location: "Zone d'essais · banc BE-1 (zone ATEX 2)",
    description: "Essais de réception usine de la ligne de convoyage, première série, avec produit inerte simulant l'émulsion",
    performer: '[A. Martin], [J. Petit]', issuerId: 'clefevre', keystoneProject: 'K-2024-118 · [Client B]',
    validFrom: `${rel(-25)}T08:00`, validTo: `${rel(-21)}T18:00`, checked: 6, status: 'clos', closedAt: `${rel(-21)}T18:20`,
  },
  {
    id: 'PF-2026-028', type: 'feu', siteId: 'ville-a', location: 'Atelier montage · poste M5',
    description: 'Soudure de reprise sur le châssis du malaxeur MX-2 (reportée en cabine de soudage)',
    performer: '[T. Nguyen]', keystoneProject: 'K-2025-077 · [Client A]',
    validFrom: `${rel(-9)}T08:00`, validTo: `${rel(-9)}T17:00`, watchUntil: `${rel(-9)}T19:00`, checked: 3, status: 'annule', closedAt: `${rel(-10)}T16:40`,
    cancelledById: 'sbenali', cancelReason: 'Soudure reportée en cabine de soudage : permis de feu inutile',
  },
  {
    id: 'PF-2026-029', type: 'feu', siteId: 'ville-b', location: "Zone d'essais · plateforme PIRL",
    description: 'Soudage du garde-corps de la plateforme PIRL', contractorId: 'EE-004', performer: '[S. Garnier], [D. Leroy]',
    issuerId: 'jpetit', preventionPlanId: 'PP-2026-012',
    validFrom: `${rel(-17)}T08:00`, validTo: `${rel(-17)}T16:30`, watchUntil: `${rel(-17)}T18:30`, checked: 6, status: 'clos', closedAt: `${rel(-17)}T18:35`,
  },
  {
    id: 'PF-2026-030', type: 'feu', siteId: 'ville-a', location: 'Atelier usinage · aire extérieure de découpe',
    description: "Découpe au chalumeau d'un ancien support de convoyeur", performer: '[P. Roux]', issuerId: 'sbenali',
    validFrom: `${rel(-4)}T13:30`, validTo: `${rel(-4)}T17:00`, watchUntil: `${rel(-4)}T19:00`, checked: 6, status: 'delivre',
  },
  {
    id: 'PE-2026-008', type: 'essai', siteId: 'ville-b', location: "Zone d'essais · banc BE-1 (zone ATEX 2)",
    description: "Essais d'endurance de la ligne de convoyage avec produit inerte simulant l'émulsion (seconde série)",
    performer: '[A. Martin]', issuerId: 'jpetit', keystoneProject: 'K-2024-118 · [Client B]',
    validFrom: `${rel(-3)}T08:00`, validTo: `${rel(0)}T18:00`, checked: 6, status: 'delivre',
  },
  {
    id: 'PF-2026-031', type: 'feu', siteId: 'ville-a', location: 'Atelier montage · poste M3',
    description: 'Meulage et soudure de reprise sur le bâti du poste de retournement (reprise sur 3 jours)', performer: '[T. Nguyen]', issuerId: 'sbenali',
    keystoneProject: 'K-2025-042 · [Client A]',
    // Validité couvrant toute la journée de référence : « en cours » le 07/10 quelle que soit l'heure.
    validFrom: `${rel(-3)}T07:30`, validTo: `${rel(-1)}T18:00`, watchUntil: `${rel(-1)}T20:00`, checked: 6, status: 'delivre',
  },
  {
    // Entreprise extérieure : plan PP-2026-014 signé, couvrant la validité ; délivrance possible une fois la check-list complète.
    id: 'PE-2026-009', type: 'essai', siteId: 'ville-b', location: "Zone d'essais · banc BE-2 (zone ATEX 2)",
    description: 'Essais de fonctionnement des matériels ATEX remis en état sur le banc BE-2, avec produit inerte', contractorId: 'EE-005',
    performer: '[V. Rousseau], [A. Martin]', preventionPlanId: 'PP-2026-014', keystoneProject: 'K-2024-118 · [Client B]',
    validFrom: `${rel(3)}T08:00`, validTo: `${rel(3)}T12:00`, checked: 4, status: 'demande',
  },
  {
    id: 'PF-2026-032', type: 'feu', siteId: 'ville-a', location: 'Magasin · mezzanine de stockage',
    description: 'Soudage de platines de renfort sur la charpente de la mezzanine', contractorId: 'EE-004', performer: '[S. Garnier], [D. Leroy]',
    preventionPlanId: 'PP-2026-015',
    validFrom: `${rel(-1)}T07:30`, validTo: `${rel(-1)}T17:00`, watchUntil: `${rel(-1)}T19:00`, checked: 3, status: 'demande',
  },
];

// Toutes les dates du jeu de données sont en heure d'été (CEST, UTC+2), avant le 25/10/2026.
const at = (local: string) => new Date(`${local}:00+02:00`);
const atWinter = (local: string) => new Date(`${local}:00+01:00`);
const instant = (local: string) => (local < rel(-194) || local >= rel(16) ? atWinter(local) : at(local));

export async function seedPrevention(tx: SeedTx) {
  await tx.insert(t.contractors).values(CONTRACTORS.map(([id, name, trade, contactName, contactPhone, contactEmail]) => ({ id, name, trade, contactName, contactPhone, contactEmail, ...ARCHIVED[id] })));
  await tx.insert(t.preventionPlans).values(PLANS.map((p) => {
    const c = CONTENT[p.id] ?? {};
    return {
      ...p,
      eeHeadcount: c.eeHeadcount ?? null,
      eeSupervisor: c.eeSupervisor ?? '',
      subcontracting: c.subcontracting ?? '',
      dangerousPhases: c.dangerousPhases ?? '',
      equipment: c.equipment ?? '',
      workerInstructions: c.workerInstructions ?? '',
      emergencyOrganisation: c.emergencyOrganisation ?? '',
      coordination: c.coordination ?? '',
      sirPosts: c.sirPosts ?? '',
      // Première signature complète (la plus tardive des deux), comme la reprise de la migration 0004.
      firstSignedOn: p.firstSignedOn ?? (p.signedEuOn && p.signedEeOn ? [p.signedEuOn, p.signedEeOn].sort()[1] : null),
      keystoneProject: p.keystoneProject ?? null,
      inspectionOn: p.inspectionOn ?? null,
      signedEuOn: p.signedEuOn ?? null,
      signedEeOn: p.signedEeOn ?? null,
      cancelledAt: p.cancelledAt ?? null,
      cancelledById: p.cancelledById ?? null,
      cancelReason: p.cancelReason ?? null,
    };
  }));
  await tx.insert(t.permits).values(PERMITS.map((p) => ({
    id: p.id,
    type: p.type,
    siteId: p.siteId,
    location: p.location,
    description: p.description,
    contractorId: p.contractorId ?? null,
    performer: p.performer,
    issuerId: p.issuerId ?? null,
    preventionPlanId: p.preventionPlanId ?? null,
    keystoneProject: p.keystoneProject ?? null,
    validFrom: instant(p.validFrom),
    validTo: instant(p.validTo),
    watchUntil: p.watchUntil ? instant(p.watchUntil) : null,
    checklist: PERMIT_TYPES[p.type].checklist.map((label, i) => ({ label, checked: i < p.checked })),
    status: p.status,
    closedAt: p.closedAt ? instant(p.closedAt) : null,
    cancelledById: p.cancelledById ?? null,
    cancelReason: p.cancelReason ?? null,
  })));
  // Délivrance des permis en cours (PRV-03) : date affichée sur la fiche imprimée (« Délivré par X le … »).
  await tx.insert(t.changeLog).values(PERMITS.filter((p) => p.status === 'delivre' && p.issuerId).map((p) => ({
    entityType: 'permit', entityId: p.id, action: 'status', summary: 'Permis délivré', byId: p.issuerId!,
    at: new Date(instant(p.validFrom).getTime() - 15 * 60_000),
  })));
}
