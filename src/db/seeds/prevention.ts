import 'server-only';
import { PERMIT_TYPES, type PermitType } from '@/components/prevention/model';
import * as t from '../schema';
import type { SeedTx } from './types';

// Jeu de données initial du domaine « Plans de prévention et permis », relatif aux 07 et 08/10/2026.
// Les deux sites sont Seveso seuil haut avec la règle interne « plan écrit et signé dès la première minute »
// (sites.ppFromFirstMinute, voir seed.ts). Écarts les 07 et 08/10, à toute heure (interventions d'entreprises extérieures
// sans plan signé : plans en cours et permis demandés ou délivrés) : exactement deux, sur le site A — PP-2026-013
// (signature de l'entreprise extérieure manquante) et PP-2026-015 (brouillon, sans inspection commune) — repris dans
// la veille (R. 4512-6 · « 2 interventions sans plan signé »). La demande PF-2026-032 relève de l'intervention
// PP-2026-015 : elle est en écart, comptée avec son plan (« Écart · compté avec PP-2026-015 »), et sa délivrance est bloquée.
// Les autres permis d'entreprises extérieures sont rattachés à un plan signé couvrant leur validité (PF-2026-029, PE-2026-009) ;
// les autres permis sont réalisés par le personnel interne (sans entreprise extérieure ni intervenant d'une autre entreprise).
// PP-2026-017 (6 h, sans travaux dangereux) illustre la règle : non obligatoire au sens de R. 4512-7, exigé et signé au titre de Seveso.

// [id, raison sociale, corps de métier, contact, téléphone, e-mail]
const CONTRACTORS: [string, string, string, string, string, string][] = [
  ['EE-001', '[Entreprise Levage Ouest]', 'Maintenance des appareils de levage', '[M. Lebrun]', '02 61 91 10 20', 'planning@levage-ouest.example'],
  ['EE-002', '[Entreprise Élec Industrie]', 'Électricité industrielle', '[N. Carpentier]', '02 61 91 10 35', 'interventions@elec-industrie.example'],
  ['EE-003', '[Entreprise Nettoyage Atlantique]', 'Nettoyage industriel', '[F. Mercier]', '06 39 98 20 14', 'exploitation@nettoyage-atlantique.example'],
  ['EE-004', '[Entreprise Chaudronnerie Soudure]', 'Chaudronnerie et soudure', '[S. Garnier]', '06 39 98 31 07', 'atelier@chaudronnerie-soudure.example'],
  ['EE-005', '[Entreprise Contrôle ATEX]', 'Inspection et maintenance du matériel ATEX', '[V. Rousseau]', '02 61 91 44 60', 'contact@controle-atex.example'],
  ['EE-006', '[Entreprise Sécurité Incendie]', 'Maintenance des extincteurs et RIA', '[C. Perrin]', '02 61 91 52 75', 'maintenance@securite-incendie.example'],
];

type PlanSeed = {
  id: string; siteId: string; contractorId: string; title: string; location: string; startOn: string; endOn: string;
  estimatedHours: number; dangerousWork: boolean; keystoneProject?: string; inspectionOn?: string;
  interferenceRisks: string; measures: string; status: string; signedEuOn?: string; signedEeOn?: string; ownerId: string;
};

const PLANS: PlanSeed[] = [
  {
    id: 'PP-2025-041', siteId: 'ville-a', contractorId: 'EE-003',
    title: 'Nettoyage industriel des ateliers, des fosses de rétention et des bacs à copeaux (contrat annuel)',
    location: 'Ateliers montage et usinage', startOn: '2026-01-05', endOn: '2026-12-18', estimatedHours: 520, dangerousWork: false,
    inspectionOn: '2025-12-08', signedEuOn: '2025-12-10', signedEeOn: '2025-12-12', status: 'signe', ownerId: 'sbenali',
    interferenceRisks: "Coactivité avec la production (chariot élévateur, pont roulant, usinage en cours) ; sols glissants pendant le lavage ; contact avec les fluides de coupe.",
    measures: "Interventions planifiées de 5 h à 8 h, hors présence des équipes ; zones lavées balisées ; convoyeurs à copeaux arrêtés et consignés ; fiches de données de sécurité des produits remises ; chaussures antidérapantes, gants nitrile et lunettes.",
  },
  {
    id: 'PP-2026-009', siteId: 'ville-a', contractorId: 'EE-002',
    title: 'Thermographie infrarouge et resserrage des armoires électriques',
    location: 'Ateliers montage et usinage · TGBT et armoires divisionnaires', startOn: '2026-06-15', endOn: '2026-06-19', estimatedHours: 32, dangerousWork: true,
    inspectionOn: '2026-06-08', signedEuOn: '2026-06-10', signedEeOn: '2026-06-11', status: 'clos', ownerId: 'clefevre',
    interferenceRisks: "Armoires ouvertes sous tension à proximité des postes de travail ; coupures partielles de l'alimentation des machines.",
    measures: "Intervenants habilités BR et BC ; périmètre balisé devant les armoires ouvertes ; coupures programmées avec les chefs d'atelier ; EPI arc électrique ; consignation avant resserrage.",
  },
  {
    id: 'PP-2026-012', siteId: 'ville-b', contractorId: 'EE-004',
    title: "Fabrication et pose d'un garde-corps soudé sur la plateforme PIRL",
    location: "Zone d'essais · plateforme PIRL", startOn: '2026-09-21', endOn: '2026-09-25', estimatedHours: 24, dangerousWork: true,
    inspectionOn: '2026-09-16', signedEuOn: '2026-09-17', signedEeOn: '2026-09-18', status: 'clos', ownerId: 'jpetit',
    interferenceRisks: "Soudage à proximité du banc BE-1 et du stockage des produits inertes ; travail en hauteur au-dessus du passage.",
    measures: "Permis de feu journalier ; essais suspendus pendant les travaux par points chauds ; balisage au sol sous la plateforme ; harnais et ligne de vie provisoire.",
  },
  {
    id: 'PP-2026-013', siteId: 'ville-a', contractorId: 'EE-001',
    title: 'Maintenance du pont roulant 10 t : réglage des fins de course et remplacement du câble',
    location: 'Atelier montage · chemin de roulement du pont 10 t', startOn: '2026-10-05', endOn: '2026-10-09', estimatedHours: 140, dangerousWork: true,
    inspectionOn: '2026-10-02', signedEuOn: '2026-10-02', status: 'a_signer', ownerId: 'sbenali',
    interferenceRisks: "Postes de montage M2 et M3 sous le chemin de roulement ; retournement des bâtis K-2025-042 en cours ; circulation du chariot élévateur dans l'allée centrale.",
    measures: "Pont consigné pendant toute l'intervention ; nacelle conduite par un titulaire du CACES R486, harnais en nacelle ; zone balisée au sol sous la nacelle ; levages du poste M3 reportés sur le pont 5 t.",
  },
  {
    id: 'PP-2026-014', siteId: 'ville-b', contractorId: 'EE-005',
    title: "Inspection et maintenance du matériel ATEX de la zone d'essais (contrat annuel)",
    location: "Zone d'essais · bancs BE-1 et BE-2, local des simulants (zone 2)", startOn: '2026-01-12', endOn: '2026-12-18', estimatedHours: 64, dangerousWork: true,
    keystoneProject: 'K-2024-118 · [Client B]',
    inspectionOn: '2026-01-06', signedEuOn: '2026-01-08', signedEeOn: '2026-01-09', status: 'signe', ownerId: 'jpetit',
    interferenceRisks: "Interventions en zone ATEX 2 pendant les campagnes d'essais ; ouverture d'enveloppes antidéflagrantes ; coactivité avec les techniciens d'essais.",
    measures: "Interventions sur banc arrêté, hors campagne d'essais ; mesure d'atmosphère avant ouverture des matériels ; outillage antiétincelles ; permis d'essai suspendu pendant l'intervention ; accueil sécurité de la zone d'essais.",
  },
  {
    id: 'PP-2026-015', siteId: 'ville-a', contractorId: 'EE-004',
    title: 'Renforcement de la charpente de la mezzanine de stockage (soudage de platines)',
    location: 'Magasin · mezzanine de stockage', startOn: '2026-10-06', endOn: '2026-10-16', estimatedHours: 90, dangerousWork: true,
    status: 'brouillon', ownerId: 'clefevre',
    interferenceRisks: "Circulation du chariot élévateur sous la mezzanine ; cartons et palettes bois stockés à proximité ; préparation des commandes en cours.",
    measures: '',
  },
  {
    id: 'PP-2026-016', siteId: 'ville-a', contractorId: 'EE-002',
    title: "Extension du TGBT et raccordement du poste d'essais de la cellule de remplissage",
    location: "Atelier montage · TGBT et poste d'essais", startOn: '2026-10-19', endOn: '2026-10-23', estimatedHours: 60, dangerousWork: true,
    keystoneProject: 'K-2025-061 · [Client E]', inspectionOn: '2026-10-06', status: 'a_signer', ownerId: 'sbenali',
    interferenceRisks: "Coupure générale de l'atelier montage le 20/10 ; travaux au voisinage de pièces nues sous tension ; montage de la cellule [Client E] en cours sur le poste voisin.",
    measures: "Consignation du TGBT par le chargé de consignation interne ; intervenants habilités B2V et BR ; coupure programmée hors production ; balisage et affichage ; vérification d'absence de tension avant intervention.",
  },
  {
    // 6 h sans travaux dangereux : plan non requis par R. 4512-7, exigé dès la première minute sur ce site Seveso seuil haut.
    id: 'PP-2026-017', siteId: 'ville-a', contractorId: 'EE-006',
    title: "Vérification annuelle des extincteurs et des robinets d'incendie armés",
    location: 'Ateliers, magasin et bureaux', startOn: '2026-10-13', endOn: '2026-10-13', estimatedHours: 6, dangerousWork: false,
    inspectionOn: '2026-10-06', signedEuOn: '2026-10-07', signedEeOn: '2026-10-07', status: 'signe', ownerId: 'clefevre',
    interferenceRisks: "Circulation du technicien dans les ateliers en production et au magasin (chariot élévateur) ; RIA mis en eau pendant les essais.",
    measures: "Accompagnement par un membre du service QHSE ; essais des RIA hors zones de passage, sols essuyés aussitôt ; extincteurs déposés remplacés poste par poste ; gilet haute visibilité et chaussures de sécurité.",
  },
];

type PermitSeed = {
  id: string; type: PermitType; siteId: string; location: string; description: string; contractorId?: string; performer: string;
  issuerId?: string; preventionPlanId?: string; keystoneProject?: string; validFrom: string; validTo: string; watchUntil?: string;
  checked: number; status: string; closedAt?: string;
};

const PERMITS: PermitSeed[] = [
  {
    id: 'PE-2026-007', type: 'essai', siteId: 'ville-b', location: "Zone d'essais · banc BE-1 (zone ATEX 2)",
    description: "Essais de réception usine de la ligne de convoyage, première série, avec produit inerte simulant l'émulsion",
    performer: '[A. Martin], [J. Petit]', issuerId: 'clefevre', keystoneProject: 'K-2024-118 · [Client B]',
    validFrom: '2026-09-14T08:00', validTo: '2026-09-18T18:00', checked: 6, status: 'clos', closedAt: '2026-09-18T18:20',
  },
  {
    id: 'PF-2026-028', type: 'feu', siteId: 'ville-a', location: 'Atelier montage · poste M5',
    description: 'Soudure de reprise sur le châssis du malaxeur MX-2 (reportée en cabine de soudage)',
    performer: '[T. Nguyen]', keystoneProject: 'K-2025-077 · [Client A]',
    validFrom: '2026-09-30T08:00', validTo: '2026-09-30T17:00', watchUntil: '2026-09-30T19:00', checked: 3, status: 'annule', closedAt: '2026-09-29T16:40',
  },
  {
    id: 'PF-2026-029', type: 'feu', siteId: 'ville-b', location: "Zone d'essais · plateforme PIRL",
    description: 'Soudage du garde-corps de la plateforme PIRL', contractorId: 'EE-004', performer: '[S. Garnier], [D. Leroy]',
    issuerId: 'jpetit', preventionPlanId: 'PP-2026-012',
    validFrom: '2026-09-22T08:00', validTo: '2026-09-22T16:30', watchUntil: '2026-09-22T18:30', checked: 6, status: 'clos', closedAt: '2026-09-22T18:35',
  },
  {
    id: 'PF-2026-030', type: 'feu', siteId: 'ville-a', location: 'Atelier usinage · aire extérieure de découpe',
    description: "Découpe au chalumeau d'un ancien support de convoyeur", performer: '[P. Roux]', issuerId: 'sbenali',
    validFrom: '2026-10-05T13:30', validTo: '2026-10-05T17:00', watchUntil: '2026-10-05T19:00', checked: 6, status: 'delivre',
  },
  {
    id: 'PE-2026-008', type: 'essai', siteId: 'ville-b', location: "Zone d'essais · banc BE-1 (zone ATEX 2)",
    description: "Essais d'endurance de la ligne de convoyage avec produit inerte simulant l'émulsion (seconde série)",
    performer: '[A. Martin]', issuerId: 'jpetit', keystoneProject: 'K-2024-118 · [Client B]',
    validFrom: '2026-10-06T08:00', validTo: '2026-10-09T18:00', checked: 6, status: 'delivre',
  },
  {
    id: 'PF-2026-031', type: 'feu', siteId: 'ville-a', location: 'Atelier montage · poste M3',
    description: 'Meulage et soudure de reprise sur le bâti du poste de retournement (reprise sur 3 jours)', performer: '[T. Nguyen]', issuerId: 'sbenali',
    keystoneProject: 'K-2025-042 · [Client A]',
    // Validité couvrant toute la journée de référence : « en cours » le 07/10 quelle que soit l'heure.
    validFrom: '2026-10-06T07:30', validTo: '2026-10-08T18:00', watchUntil: '2026-10-08T20:00', checked: 6, status: 'delivre',
  },
  {
    // Entreprise extérieure : plan PP-2026-014 signé, couvrant la validité ; délivrance possible une fois la check-list complète.
    id: 'PE-2026-009', type: 'essai', siteId: 'ville-b', location: "Zone d'essais · banc BE-2 (zone ATEX 2)",
    description: 'Essais de fonctionnement des matériels ATEX remis en état sur le banc BE-2, avec produit inerte', contractorId: 'EE-005',
    performer: '[V. Rousseau], [A. Martin]', preventionPlanId: 'PP-2026-014', keystoneProject: 'K-2024-118 · [Client B]',
    validFrom: '2026-10-12T08:00', validTo: '2026-10-12T12:00', checked: 4, status: 'demande',
  },
  {
    id: 'PF-2026-032', type: 'feu', siteId: 'ville-a', location: 'Magasin · mezzanine de stockage',
    description: 'Soudage de platines de renfort sur la charpente de la mezzanine', contractorId: 'EE-004', performer: '[S. Garnier], [D. Leroy]',
    preventionPlanId: 'PP-2026-015',
    validFrom: '2026-10-08T07:30', validTo: '2026-10-08T17:00', watchUntil: '2026-10-08T19:00', checked: 3, status: 'demande',
  },
];

// Toutes les dates du jeu de données sont en heure d'été (CEST, UTC+2), avant le 25/10/2026.
const at = (local: string) => new Date(`${local}:00+02:00`);
const atWinter = (local: string) => new Date(`${local}:00+01:00`);
const instant = (local: string) => (local < '2026-03-29' || local >= '2026-10-25' ? atWinter(local) : at(local));

export async function seedPrevention(tx: SeedTx) {
  await tx.insert(t.contractors).values(CONTRACTORS.map(([id, name, trade, contactName, contactPhone, contactEmail]) => ({ id, name, trade, contactName, contactPhone, contactEmail })));
  await tx.insert(t.preventionPlans).values(PLANS.map((p) => ({
    ...p,
    keystoneProject: p.keystoneProject ?? null,
    inspectionOn: p.inspectionOn ?? null,
    signedEuOn: p.signedEuOn ?? null,
    signedEeOn: p.signedEeOn ?? null,
  })));
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
  })));
}
