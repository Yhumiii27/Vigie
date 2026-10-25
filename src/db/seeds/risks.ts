import * as t from '../schema';
import { iso, rel } from './dates';
import type { SeedTx } from './types';

// Jeu de démonstration : DUERP (versions, unités, risques et leurs actions), registre des mises à disposition et programme
// annuel de prévention (QUA-26 : extrait de src/db/seed.ts).

export const UNITS: [string, string][] = [['montage', 'Atelier montage'], ['usinage', 'Atelier usinage'], ['essais', "Zone d'essais"], ['client', 'Mise en service chez le client'], ['be', "Bureau d'études"], ['magasin', 'Magasin'], ['bureaux', 'Bureaux'], ['deplacements', 'Déplacements']];

// [unité, danger, situation, G, P, mesures existantes, G résiduelle, P résiduelle, actions]
// A-222 (action de suite « nouveau risque » de A-176) porte le risque de A-176 : lien à plusieurs porteurs repris par la
// suite (plan du paquet 1, D21).
export const RISKS: [string, string, string, number, number, string, number, number, string[]][] = [
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

/** DUERP, registre des mises à disposition, PAPRIPACT 2026 ; renvoie l'identifiant d'un risque par unité et danger. */
export async function seedRisks(tx: SeedTx) {
  // Versions archivées avant Vigie (conservées hors application, sans instantané).
  const archived = ['2015.1', '2016.1', '2017.1', '2018.1', '2019.1', '2020.1', '2021.1', '2021.2', '2022.1', '2023.1', '2024.1', '2025.1'];
  await tx.insert(t.duerpVersions).values([
    ...archived.map((version, i) => {
      const y = +version.slice(0, 4), next = archived[i + 1] ?? '2026.1';
      const updatedOn = version.endsWith('.2') ? iso(y, 9, 15) : iso(y, 3, 15);
      const archivedOn = next.endsWith('.2') ? iso(+next.slice(0, 4), 9, 15) : iso(+next.slice(0, 4), 3, 15);
      return { version, current: false, updatedOn, nextUpdateOn: iso(y + 1, 3, 15), retention: '40 ans', validatedById: 'hmarchand', archivedOn, snapshot: null };
    }),
    { version: '2026.1', current: true, updatedOn: rel(-208), nextUpdateOn: rel(157), retention: '40 ans', validatedById: 'hmarchand', cseConsultedOn: rel(-203) },
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
    { requestedOn: rel(-203), requesterKind: 'cse', requesterName: 'CSE — réunion ordinaire de mars', siteId: null, version: '2026.1', communicatedOn: rel(-203), channel: 'sur_place', note: 'Présentation de la mise à jour annuelle et consultation du CSE.', createdById: 'clefevre', createdAt: new Date(`${rel(-203)}T16:00:00+01:00`) },
    { requestedOn: rel(-190), requesterKind: 'medecin', requesterName: 'Service de prévention et de santé au travail', siteId: 'ville-a', version: '2026.1', communicatedOn: rel(-189), channel: 'electronique', note: null, createdById: 'clefevre', createdAt: new Date(`${rel(-189)}T10:00:00+02:00`) },
    { requestedOn: rel(-4), requesterKind: 'ancien_salarie', requesterName: '[G. Vasseur]', siteId: 'ville-a', version: '2024.1', communicatedOn: null, channel: null, note: 'Ancien monteur (2019–2024) : versions en vigueur pendant son activité.', createdById: 'clefevre', createdAt: new Date(`${rel(-4)}T09:30:00+02:00`) },
  ]);
  // PAPRIPACT 2026 en préparation (DUE-02) : sans consultation du CSE ni lignes figées.
  await tx.insert(t.preventionPrograms).values({ year: 2026, duerpVersion: '2026.1', comment: 'Programme issu de la mise à jour 2026.1, à présenter au CSE.', createdById: 'clefevre', createdAt: new Date(`${rel(-38)}T10:00:00+02:00`) });
  await tx.insert(t.preventionProgramActions).values([
    { year: 2026, actionId: 'A-205', estimatedCost: 2400, resources: 'Organisme de formation agréé · 4 × 1 jour', indicator: '4 monteurs habilités BR à jour' },
    { year: 2026, actionId: 'A-201', estimatedCost: 1800, resources: 'Services généraux · marquage sous-traité', indicator: 'Aucun presque-accident chariot / piéton sur 6 mois' },
    { year: 2026, actionId: 'A-203', estimatedCost: 12000, resources: 'Électricien ATEX externe', indicator: 'Vérification ATEX sans écart' },
    { year: 2026, actionId: 'A-214', estimatedCost: 950, resources: 'Magasin · fournisseur levage', indicator: '100 % des élingues textiles remplacées' },
  ]);
  const riskId = (unit: string, hazard: string) => inserted[RISKS.findIndex((r) => r[0] === unit && r[1] === hazard)].id;
  return riskId;
}
