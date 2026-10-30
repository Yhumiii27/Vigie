import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import * as t from '../schema';
import { rel } from './dates';
import type { SeedTx } from './types';

// Jeu de démonstration de la première moitié du paquet 13 (conformité et fonctions métier, migration 0020) :
// - VEI-18 : périodicité de réévaluation propre (directive ATEX, 24 mois) ;
// - VEI-12 : exigence ISO 9001 rattachée à l'indicateur « certification » (certificat iso9001) ;
// - VEI-14 : équipement de mesure étalonné (pied à coulisse du contrôle qualité, métrologie) ;
// - VEI-15 : registre de sécurité du site A (observation de l'inspection du travail à traiter, observation de la CARSAT
//   répondue) ;
// - PRV-17 : contrat annuel de nettoyage PP-2025-041, réunion de coordination tous les 30 jours, séances tenues ;
// - DUE-19 : mesures de maîtrise liées (pont roulant et autorisation de conduite ; installations électriques, habilitation
//   électrique et procédure des permis) ;
// - DUE-20 : unités de travail reliées aux zones du plan de site ;
// - HAB-13 : accueil sécurité marqué « sensibilisation », formations évaluées à froid.

const METROLOGY = 'Pied à coulisse numérique 0–150 mm — contrôle qualité';
const at = (day: string, time = '10:00') => new Date(`${day}T${time}:00+02:00`);

/**
 * Remplit (une seule fois) les données du paquet 13 : jeu neuf (dans sa transaction, après tous les modules) ou base de
 * démonstration antérieure à la migration 0020 (upgradeDemo). Marqueur : registre de sécurité vide et aucune mesure liée,
 * et contrat annuel PP-2025-041 du jeu présent. Chaque complément vérifie la présence de ses éléments (base modifiée depuis).
 */
export async function seedComplianceFunctions(tx: SeedTx) {
  const [[notices], [links], [plan]] = await Promise.all([
    tx.select({ n: count() }).from(t.safetyNotices),
    tx.select({ n: count() }).from(t.riskMeasureLinks),
    tx.select({ n: count() }).from(t.preventionPlans).where(eq(t.preventionPlans.id, 'PP-2025-041')),
  ]);
  if (notices.n > 0 || links.n > 0 || plan.n === 0) return;

  // VEI-18 et VEI-12 : exigences de la veille.
  await tx.update(t.requirements).set({ reviewMonths: 24 }).where(and(eq(t.requirements.text, 'Directive ATEX 2014/34/UE'), isNull(t.requirements.reviewMonths)));
  const [cert] = await tx.select({ id: t.certifications.id }).from(t.certifications).where(eq(t.certifications.id, 'iso9001'));
  const [linkedCert] = await tx.select({ n: count() }).from(t.requirements).where(eq(t.requirements.linkedTo, 'certification'));
  if (cert && linkedCert.n === 0) {
    await tx.update(t.requirements).set({ linkedTo: 'certification', certificationId: cert.id })
      .where(and(eq(t.requirements.text, 'ISO 9001:2015'), isNull(t.requirements.linkedTo), isNull(t.requirements.archivedAt)));
  }

  // VEI-14 : équipement de mesure étalonné (conforme), site A.
  const [{ m }] = await tx.select({ m: count() }).from(t.controls);
  const [gauge] = await tx.insert(t.controls).values({
    siteId: 'ville-a', equipment: METROLOGY, controlType: 'Étalonnage', category: 'metrologie', tolerance: '± 0,02 mm',
    periodMonths: 12, organization: '[Laboratoire accrédité COFRAC]', responsibleId: 'lmoreau', lastOn: rel(-200), nextOn: rel(165), sort: m,
  }).returning({ id: t.controls.id });
  await tx.insert(t.controlRecords).values({
    controlId: gauge.id, performedOn: rel(-200), organization: '[Laboratoire accrédité COFRAC]', result: 'favorable',
    notes: 'Écart maximal relevé 0,01 mm sur la plage 0–150 mm ; certificat d’étalonnage joint au dossier qualité.', recordedById: 'lmoreau', createdAt: at(rel(-199)),
  });

  // VEI-15 : registre de sécurité du site A.
  const [pont] = await tx.select({ id: t.controls.id }).from(t.controls).where(eq(t.controls.equipment, 'Pont roulant 10 t — atelier montage'));
  await tx.insert(t.safetyNotices).values([
    {
      siteId: 'ville-a', kind: 'observation', receivedOn: rel(-20), authority: 'Inspection du travail', reference: 'Courrier du contrôleur, visite du ' + rel(-27).split('-').reverse().join('/'),
      text: 'Vérification générale périodique du pont roulant 10 t à réaliser ; balisage de l’allée centrale de l’atelier montage à reprendre.',
      dueOn: rel(10), controlId: pont?.id ?? null, createdById: 'clefevre', createdAt: at(rel(-19)),
    },
    {
      siteId: 'ville-a', kind: 'observation', receivedOn: rel(-120), authority: 'CARSAT', reference: 'Rapport de visite',
      text: 'Signalisation des zones de circulation piétons au magasin à compléter.', dueOn: rel(-60),
      answeredOn: rel(-75), answer: 'Marquage au sol des allées piétonnes réalisé et photographié ; courrier de réponse adressé à la CARSAT.', answeredById: 'clefevre',
      createdById: 'clefevre', createdAt: at(rel(-118)),
    },
  ]);

  // PRV-17 : contrat annuel de nettoyage, réunions de coordination tous les 30 jours.
  await tx.update(t.preventionPlans).set({ meetingPeriodDays: 30 }).where(eq(t.preventionPlans.id, 'PP-2025-041'));
  await tx.insert(t.preventionPlanMeetings).values([
    [-247, 'inspection', 'Visite des fosses et des bacs à copeaux avant la première intervention de nuit.'],
    [-186, 'reunion', 'Bilan trimestriel : aucun incident ; horaires 5 h – 8 h confirmés.'],
    [-125, 'inspection', 'Contrôle des balisages pendant le lavage de l’atelier usinage.'],
    [-64, 'reunion', 'Nouveau produit dégraissant : fiche de données de sécurité remise.'],
    [-20, 'reunion', 'Point mensuel : convoyeur à copeaux CU-2 consigné avant chaque intervention.'],
  ].map(([d, kind, notes]) => ({
    planId: 'PP-2025-041', kind: kind as string, heldOn: rel(d as number), participants: '[S. Benali] (EU), chef d’équipe [EE-003]', notes: notes as string,
    recordedById: 'sbenali', createdAt: at(rel(d as number), '16:00'),
  })));

  // DUE-20 : unités de travail et zones du plan de site.
  const zones = await tx.select({ id: t.mapZones.id, name: t.mapZones.name, siteId: t.mapZones.siteId }).from(t.mapZones).where(isNull(t.mapZones.archivedAt));
  const units = new Set((await tx.select({ id: t.workUnits.id }).from(t.workUnits).where(isNull(t.workUnits.archivedAt))).map((u) => u.id));
  const ZONE_UNITS: [string, string, string][] = [
    ['ville-a', 'Atelier montage', 'montage'], ['ville-a', 'Atelier usinage', 'usinage'], ['ville-a', 'Magasin', 'magasin'],
    ['ville-b', "Hall d'essais", 'essais'], ['ville-b', 'Zone ATEX 2 · banc BE-1', 'essais'],
  ];
  for (const [siteId, name, unitId] of ZONE_UNITS) {
    const zone = zones.find((z) => z.siteId === siteId && z.name === name);
    if (zone && units.has(unitId)) await tx.update(t.mapZones).set({ workUnitId: unitId }).where(eq(t.mapZones.id, zone.id));
  }

  // DUE-19 : mesures de maîtrise liées aux contrôles, documents et habilitations.
  const risks = await tx.select({ id: t.risks.id, unitId: t.risks.unitId, hazard: t.risks.hazard }).from(t.risks).where(isNull(t.risks.archivedAt)).orderBy(asc(t.risks.id));
  const risk = (unitId: string, hazard: string) => risks.find((r) => r.unitId === unitId && r.hazard === hazard)?.id;
  const [elecControl] = await tx.select({ id: t.controls.id }).from(t.controls).where(eq(t.controls.equipment, 'Installations électriques'));
  const [doc] = await tx.select({ id: t.documents.id }).from(t.documents).where(eq(t.documents.id, 'PR-QHSE-005'));
  const titles = new Set((await tx.select({ id: t.trainingTitles.id }).from(t.trainingTitles).where(isNull(t.trainingTitles.archivedAt))).map((x) => x.id));
  const handling = risk('montage', 'Manutention mécanique');
  const electric = risk('montage', 'Électricité');
  const measures: (typeof t.riskMeasureLinks.$inferInsert)[] = [
    ...(handling && pont ? [{ riskId: handling, kind: 'control', controlId: pont.id }] : []),
    ...(handling && titles.has('conduite') ? [{ riskId: handling, kind: 'title', titleId: 'conduite' }] : []),
    ...(electric && elecControl ? [{ riskId: electric, kind: 'control', controlId: elecControl.id }] : []),
    ...(electric && titles.has('elec') ? [{ riskId: electric, kind: 'title', titleId: 'elec' }] : []),
    ...(electric && doc ? [{ riskId: electric, kind: 'document', documentId: doc.id }] : []),
  ];
  if (measures.length) await tx.insert(t.riskMeasureLinks).values(measures.map((x) => ({ ...x, createdById: 'clefevre', createdAt: at(rel(-30)) })));

  // HAB-13 : accueil sécurité = sensibilisation ; formations récentes évaluées à froid.
  if (titles.has('accueil')) await tx.update(t.trainingTitles).set({ awareness: true }).where(eq(t.trainingTitles.id, 'accueil'));
  const recent = await tx.select({ id: t.qualifications.id, obtainedOn: t.qualifications.obtainedOn, titleId: t.qualifications.titleId }).from(t.qualifications)
    .where(and(isNull(t.qualifications.cancelledAt), inArray(t.qualifications.titleId, ['elec', 'hauteur', 'sst'])))
    .orderBy(desc(t.qualifications.obtainedOn), desc(t.qualifications.id));
  const evaluated = recent.filter((q) => q.obtainedOn <= rel(-60)).slice(0, 3);
  for (const [i, q] of evaluated.entries()) {
    await tx.update(t.qualifications).set({
      effectiveness: i === 2 ? 'partielle' : 'efficace', effectivenessOn: rel(-30),
      effectivenessNote: i === 2 ? 'Consignation à revoir au poste : accompagnement par le tuteur pendant un mois.' : 'Pratique observée au poste, conforme.',
      effectivenessById: 'clefevre',
    }).where(eq(t.qualifications.id, q.id));
  }
}
