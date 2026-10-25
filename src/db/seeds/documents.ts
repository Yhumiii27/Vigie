import 'server-only';
import * as t from '../schema';
import type { SeedTx } from './types';
import { rel } from './dates';

// Jeu de données initial du domaine « documents » : documents maîtrisés et historique de leurs versions.
// Dates relatives au 7 octobre 2026 : trois revues périodiques dépassées (PR-QHSE-002, PR-QHSE-005, FO-QHSE-010),
// une revue sous 15 jours (PR-QHSE-004), deux versions en revue, trois brouillons et un document obsolète.

// [version, statut, objet de la modification, auteur, approbateur, soumis le, approuvé le, action liée]
type V = [version: string, status: string, summary: string, author: string, approver: string | null, submittedOn: string | null, approvedOn: string | null, actionId?: string];
type D = { id: string; title: string; type: string; process: string; owner: string; reviewMonths: number; distribution: string; siteId?: string; versions: V[] };

const DOCUMENTS: D[] = [
  {
    id: 'POL-QHSE-001', title: 'Politique QHSE', type: 'politique', process: 'QHSE', owner: 'clefevre', reviewMonths: 12,
    distribution: "Tout le personnel · affichage accueil, ateliers et zone d'essais",
    versions: [
      ['A', 'archive', 'Création : politique qualité, sécurité et environnement unique', 'clefevre', 'hmarchand', rel(-1369), rel(-1362)],
      ['B', 'archive', 'Revue annuelle : engagements environnement (déchets, consommations)', 'clefevre', 'hmarchand', rel(-641), rel(-634)],
      ['C', 'approuve', 'Revue de direction 2025 : objectifs 2026 et engagement sur la remontée des presque-accidents', 'clefevre', 'hmarchand', rel(-277), rel(-270)],
    ],
  },
  {
    id: 'PR-QHSE-001', title: 'Maîtrise des documents', type: 'procedure', process: 'QHSE', owner: 'clefevre', reviewMonths: 36,
    distribution: 'Animatrice QHSE · responsables de processus · encadrement',
    versions: [
      ['A', 'archive', 'Création', 'clefevre', 'hmarchand', rel(-2720), rel(-2713)],
      ['B', 'archive', 'Codification des références par type et processus, périodicité de revue', 'clefevre', 'hmarchand', rel(-1677), rel(-1670)],
      ['C', 'approuve', 'Gestion dans Vigie : circuit brouillon, revue, approbation et archivage des versions', 'clefevre', 'hmarchand', rel(-620), rel(-613)],
    ],
  },
  {
    id: 'PR-QHSE-002', title: 'Traitement des non-conformités et réclamations', type: 'procedure', process: 'QHSE', owner: 'lmoreau', reviewMonths: 36,
    distribution: "Responsable qualité · chefs d'atelier · bureau d'études · commercial",
    versions: [
      ['A', 'archive', 'Création', 'lmoreau', 'hmarchand', rel(-2230), rel(-2223)],
      ['B', 'approuve', 'Intégration des réclamations client et de la méthode 8D', 'lmoreau', 'hmarchand', rel(-1222), rel(-1215)],
    ],
  },
  {
    id: 'PR-QHSE-003', title: 'Audits internes', type: 'procedure', process: 'QHSE', owner: 'edubois', reviewMonths: 36,
    distribution: 'Auditeurs internes · responsables de processus',
    versions: [
      ['A', 'archive', 'Création', 'edubois', 'hmarchand', rel(-2083), rel(-2076)],
      ['B', 'approuve', 'Programme annuel unique QHSE et qualification des auditeurs internes', 'edubois', 'clefevre', rel(-760), rel(-753)],
    ],
  },
  {
    id: 'PR-QHSE-004', title: 'Signalement et analyse des événements', type: 'procedure', process: 'QHSE', owner: 'clefevre', reviewMonths: 24,
    distribution: 'Tout le personnel · encadrement de proximité',
    versions: [
      ['A', 'archive', 'Création : déclaration des accidents, presque-accidents et situations dangereuses', 'clefevre', 'hmarchand', rel(-1467), rel(-1460)],
      ['B', 'approuve', 'Signalement terrain par QR code et grille de gravité potentielle G1 à G4', 'clefevre', 'hmarchand', rel(-732), rel(-725)],
      ['C', 'en_revue', "Workflow Vigie en 6 étapes et choix de la méthode d'analyse (5M, arbre des causes, 5 pourquoi, 8D)", 'clefevre', null, rel(-11), null],
    ],
  },
  {
    id: 'PR-QHSE-005', title: 'Plans de prévention et permis', type: 'procedure', process: 'QHSE', owner: 'clefevre', reviewMonths: 36,
    distribution: "Encadrement · magasin · zone d'essais · accueil des entreprises extérieures",
    versions: [
      ['A', 'archive', 'Création : plan de prévention et permis de feu', 'clefevre', 'hmarchand', rel(-2419), rel(-2412)],
      ['B', 'approuve', "Ajout du permis d'essai pour la zone d'essais", 'clefevre', 'hmarchand', rel(-1320), rel(-1313)],
    ],
  },
  {
    id: 'PR-ACH-001', title: 'Évaluation des fournisseurs', type: 'procedure', process: 'ACH', owner: 'lmoreau', reviewMonths: 36,
    distribution: 'Achats · responsable qualité · magasin (réception)',
    versions: [
      ['A', 'archive', 'Création', 'lmoreau', 'hmarchand', rel(-2937), rel(-2930)],
      ['B', 'archive', 'Grille de cotation qualité, délai, prix', 'lmoreau', 'hmarchand', rel(-1802), rel(-1796)],
      ['C', 'approuve', 'Audit fournisseur déclenché par les non-conformités répétées, seuil de déclassement', 'lmoreau', 'hmarchand', rel(-683), rel(-676)],
    ],
  },
  {
    id: 'PR-BE-001', title: 'Revue de conception (EN ISO 12100)', type: 'procedure', process: 'BE', owner: 'edubois', reviewMonths: 36,
    distribution: "Bureau d'études · chefs de projet · responsable qualité",
    versions: [
      ['A', 'archive', 'Création : revues de conception aux jalons du projet', 'edubois', 'hmarchand', rel(-1628), rel(-1621)],
      ['B', 'approuve', 'Appréciation du risque selon EN ISO 12100 à chaque jalon, contenu du dossier technique', 'edubois', 'hmarchand', rel(-557), rel(-550)],
      ['C', 'brouillon', "Exigences du règlement (UE) 2023/1230 sur les machines : analyse d'écart par projet", 'edubois', null, null, null, 'A-196'],
    ],
  },
  {
    id: 'IT-MON-012', title: 'Retournement des bâtis > 1 t', type: 'instruction', process: 'MON', owner: 'sbenali', reviewMonths: 24, siteId: 'ville-a',
    distribution: 'Atelier montage · poste M3 · pontiers',
    versions: [
      ['A', 'brouillon', "Création suite au presque-accident EV-2026-131 : dotation d'élingage par type de bâti, angle d'élingage, périmètre de basculement", 'tnguyen', null, null, null, 'A-215'],
    ],
  },
  {
    id: 'IT-USI-004', title: "Contrôle de l'arbre Ø45 h7", type: 'instruction', process: 'USI', owner: 'lmoreau', reviewMonths: 24, siteId: 'ville-a',
    distribution: 'Atelier usinage · centre CU-2 · contrôle final',
    versions: [
      ['A', 'archive', 'Création', 'lmoreau', 'clefevre', rel(-1425), rel(-1418)],
      ['B', 'approuve', 'Contrôle au micromètre à chaque changement de lot', 'lmoreau', 'clefevre', rel(-696), rel(-690)],
      ['C', 'en_revue', "Contrôle intermédiaire tous les 10 arbres et suivi de l'usure outil (NC EV-2026-130)", 'lmoreau', null, rel(-4), null, 'A-212'],
    ],
  },
  {
    id: 'IT-ESS-002', title: "Consignes zone d'essais ATEX", type: 'instruction', process: 'ESS', owner: 'jpetit', reviewMonths: 24, siteId: 'ville-b',
    distribution: "Zone d'essais · techniciens · entreprises extérieures intervenant en zone",
    versions: [
      ['A', 'archive', 'Création', 'jpetit', 'clefevre', rel(-1585), rel(-1579)],
      ['B', 'approuve', "Zonage ATEX zone 2, matériel certifié, permis d'essai obligatoire", 'jpetit', 'clefevre', rel(-676), rel(-669)],
    ],
  },
  {
    id: 'IT-MON-007', title: 'Montage du réducteur RD-5', type: 'instruction', process: 'MON', owner: 'sbenali', reviewMonths: 24, siteId: 'ville-a',
    distribution: 'Atelier montage',
    versions: [
      ['A', 'archive', 'Création', 'sbenali', 'clefevre', rel(-2783), rel(-2776)],
      ['B', 'archive', 'Remplacement du joint à lèvre par un joint V-ring', 'sbenali', 'clefevre', rel(-1957), rel(-1950)],
    ],
  },
  {
    id: 'FO-QHSE-010', title: 'Fiche de visite sécurité', type: 'formulaire', process: 'QHSE', owner: 'sbenali', reviewMonths: 36,
    distribution: 'Encadrement · animatrice QHSE',
    versions: [
      ['A', 'archive', 'Création', 'clefevre', 'hmarchand', rel(-2475), rel(-2468)],
      ['B', 'approuve', 'Ajout de la rubrique « situations dangereuses relevées » et du suivi des actions', 'sbenali', 'clefevre', rel(-1121), rel(-1114)],
    ],
  },
  {
    id: 'FO-MON-003', title: 'Fiche de réglage réducteur RD-7', type: 'formulaire', process: 'MON', owner: 'sbenali', reviewMonths: 36, siteId: 'ville-a',
    distribution: 'Atelier montage · poste de réglage des réducteurs',
    versions: [
      ['A', 'archive', 'Création', 'sbenali', 'clefevre', rel(-1838), rel(-1831)],
      ['B', 'approuve', 'Mise à jour des couples de serrage', 'sbenali', 'clefevre', rel(-949), rel(-942)],
      ['C', 'brouillon', 'Correction du couple de serrage du carter et ajout du contrôle du jeu axial (NC EV-2026-112)', 'lmoreau', null, null, null, 'A-190'],
    ],
  },
  {
    id: 'EN-QHSE-001', title: 'Registre des accueils sécurité', type: 'enregistrement', process: 'QHSE', owner: 'clefevre', reviewMonths: 36,
    distribution: 'Accueil · encadrement · animatrice QHSE',
    versions: [
      ['A', 'archive', 'Création', 'clefevre', 'hmarchand', rel(-1866), rel(-1859)],
      ['B', 'approuve', "Accueil des intérimaires et des nouveaux arrivants : signature de l'arrivant et du tuteur", 'clefevre', 'hmarchand', rel(-410), rel(-403)],
    ],
  },
];

export async function seedDocuments(tx: SeedTx) {
  await tx.insert(t.documents).values(DOCUMENTS.map((d) => {
    const [, , , , , submittedOn, approvedOn] = d.versions[0];
    const created = submittedOn ?? approvedOn ?? rel(-4);
    return {
      id: d.id, title: d.title, type: d.type, process: d.process, ownerId: d.owner, reviewMonths: d.reviewMonths,
      distribution: d.distribution, siteId: d.siteId ?? null, createdAt: new Date(`${created}T09:00:00+02:00`),
    };
  }));
  await tx.insert(t.documentVersions).values(DOCUMENTS.flatMap((d) => d.versions.map(([version, status, summary, authorId, approverId, submittedOn, approvedOn, actionId]) => ({
    documentId: d.id, version, status, summary, authorId, approverId, submittedOn, approvedOn, actionId: actionId ?? null,
  }))));
}
