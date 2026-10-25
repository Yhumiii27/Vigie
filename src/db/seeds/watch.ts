import * as t from '../schema';
import { SITE_B_LOCATION, pid } from './core';
import { rel } from './dates';
import type { SeedTx } from './types';

// Jeu de démonstration : veille réglementaire (exigences et évaluations) et contrôles périodiques (QUA-26 : extrait de
// src/db/seed.ts).

// [texte, domaine, exigence, échéance, note d'échéance, évaluation, note d'évaluation, pilote]
// R. 4512-6 : l'écart « interventions sans plan signé » est calculé depuis les plans de prévention (note vide).
export const REQUIREMENTS: [string, string, string, string | null, string | null, string, string | null, string][] = [
  ['Règlement (UE) 2023/1230', 'Machines — conception et marquage CE', "Remplace la directive 2006/42/CE : cybersécurité, logiciels et IA, notice numérique, nouvelles procédures d'évaluation de la conformité.", rel(103), null, 'analyse', null, '[E. Dubois]'],
  ['Directive ATEX 2014/34/UE', 'Équipements en atmosphères explosives', 'Conformité et marquage des matériels destinés aux zones ATEX, documentation technique, déclaration UE.', null, 'Permanent', 'conforme', null, '[J. Petit]'],
  ['Code du travail — R. 4512-6', 'Plans de prévention', "Plan de prévention écrit pour toute intervention d'entreprise extérieure de plus de 400 h/an ou comportant des travaux dangereux. Règle interne Seveso seuil haut : plan écrit et signé dès la première minute d'intervention.", null, 'Permanent', 'ecart', null, '[S. Benali]'],
  ['Code de l\'environnement — L. 515-32 et suivants (Seveso III)', 'Établissement Seveso seuil haut', "Étude de dangers révisée tous les 5 ans, système de gestion de la sécurité (SGS), plan d'opération interne (POI) testé, information des entreprises extérieures et maîtrise de la coactivité sur site.", rel(264), 'révision de l\'étude de dangers', 'analyse', null, '[C. Lefèvre]'],
  ['Code du travail — R. 4121-1', 'Document unique (DUERP)', 'Mise à jour au moins annuelle, conservation 40 ans, mise à disposition des salariés et du CSE.', rel(157), null, 'conforme', null, '[C. Lefèvre]'],
  ['Arrêté du 1er mars 2004', 'Appareils de levage', "Vérifications générales périodiques des appareils et accessoires de levage, tous les 6 ou 12 mois selon l'équipement.", rel(-7), null, 'ecart', 'VGP pont roulant dépassée', '[S. Benali]'],
  ["Code de l'environnement — R. 541-45 · Trackdéchets", 'Déchets', 'Traçabilité dématérialisée des déchets dangereux (BSD) et registre chronologique des déchets.', null, 'Permanent', 'a_evaluer', 'registre 2026 incomplet', '[R. Fontaine]'],
  ['ISO 9001:2015', 'Management de la qualité', 'Revue de direction, audits internes, maîtrise des non-conformités et des exigences client.', rel(39), 'audit de suivi', 'conforme', null, '[E. Dubois]'],
];

// [équipement, contrôle, périodicité (mois), organisme, responsable, dernier, prochain, réserves]
// Dernière évaluation de chaque exigence (index) et historique des évaluations [date, évaluation, note, auteur].
export const LAST_EVALUATED: (string | null)[] = [rel(-150), rel(-323), rel(-24), rel(-190), rel(-360), rel(-4), null, rel(-111)];
export const EVALUATIONS: Record<number, [string, string, string | null, string][]> = {
  0: [[rel(-150), 'analyse', null, 'edubois']],
  1: [[rel(-690), 'conforme', null, 'clefevre'], [rel(-323), 'conforme', null, 'clefevre']],
  2: [[rel(-213), 'analyse', 'interventions de maintenance à recenser', 'clefevre'], [rel(-24), 'ecart', null, 'sbenali']],
  3: [[rel(-190), 'analyse', null, 'clefevre']],
  4: [[rel(-360), 'conforme', null, 'clefevre']],
  5: [[rel(-364), 'conforme', null, 'clefevre'], [rel(-4), 'ecart', 'VGP pont roulant dépassée', 'sbenali']],
  7: [[rel(-472), 'conforme', null, 'clefevre'], [rel(-111), 'conforme', null, 'clefevre']],
};

export const CONTROLS: [string, string, number, string, string | null, string, string, string | null][] = [
  ['Pont roulant 10 t — atelier montage', 'VGP levage', 6, '[Apave]', '[S. Benali]', rel(-190), rel(-7), '1 · fin de course à régler'],
  ['Chariot élévateur R489', 'VGP', 6, '[Apave]', null, rel(-177), rel(6), null],
  ['Installations électriques', 'Vérification périodique', 12, '[Bureau Veritas]', null, rel(-354), rel(11), '3 · 2 levées'],
  ['Extincteurs (42)', 'Maintenance annuelle', 12, '[Prestataire incendie]', null, rel(-346), rel(19), null],
  ['Portes et portails motorisés', 'Vérification', 6, 'Interne — maintenance', null, rel(-162), rel(21), null],
  ["Banc d'essais BE-1 — matériel ATEX", 'Inspection ATEX', 12, '[Organisme notifié]', null, rel(-340), rel(25), '1 · presse-étoupe'],
  ['Compresseur et réseau air comprimé', 'Requalification périodique', 40, '[Apave]', null, rel(-849), rel(368), null],
  ['EPI antichute (harnais, longes)', 'Contrôle annuel', 12, 'Interne — QHSE', null, rel(-246), rel(119), null],
  // Équipement réformé (archivé) : historique conservé.
  ['Palan électrique 2 t — ancien poste de retournement', 'VGP levage', 6, '[Apave]', '[S. Benali]', rel(-268), rel(-87), null],
];
// Historique des contrôles réalisés, par index de CONTROLS [date, organisme, réserves, notes] ; le dernier correspond à lastOn.
export const CONTROL_RECORDS: Record<number, [string, string, string | null, string | null][]> = {
  0: [[rel(-372), '[Apave]', null, 'Aucune réserve.'], [rel(-190), '[Apave]', '1 · fin de course à régler', 'Fin de course haut à régler avant la prochaine VGP.']],
  1: [[rel(-360), '[Apave]', null, null], [rel(-177), '[Apave]', null, null]],
  2: [[rel(-718), '[Bureau Veritas]', '2 · repérage armoires', null], [rel(-354), '[Bureau Veritas]', '3 · 2 levées', 'Trois observations, deux levées sur place.']],
  3: [[rel(-346), '[Prestataire incendie]', null, '42 appareils vérifiés, 2 remplacés.']],
  4: [[rel(-162), 'Interne — maintenance', null, null]],
  5: [[rel(-340), '[Organisme notifié]', '1 · presse-étoupe', null]],
  6: [[rel(-849), '[Apave]', null, null]],
  7: [[rel(-246), 'Interne — QHSE', null, '6 harnais, 8 longes contrôlés.']],
  8: [[rel(-268), '[Apave]', null, null]],
};

/** Exigences, évaluations, contrôles et enregistrements ; renvoie les identifiants des contrôles (ordre de CONTROLS). */
export async function seedWatch(tx: SeedTx) {
  const reqIds = (await tx.insert(t.requirements).values(REQUIREMENTS.map((r, sort) => ({
    text: r[0], domain: r[1], summary: r[2], dueOn: r[3], dueNote: r[4], evaluation: r[5], evaluationNote: r[6], pilotId: pid(r[7]), sort,
    lastEvaluatedOn: LAST_EVALUATED[sort],
    // Indicateur rattaché (VEI-07) : DUERP (version en vigueur, écran /risques), plans de prévention (R. 4512-6),
    // bordereaux de déchets dangereux (R. 541-45, écran Environnement).
    linkedTo: r[0].includes('R. 4121-1') ? 'duerp' : r[0].includes('R. 4512-6') ? 'prevention' : r[0].includes('R. 541-45') ? 'waste_bsd' : null,
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
    ...(sort === 8 ? { archivedAt: new Date(`${rel(-101)}T10:00:00+02:00`), archivedById: 'clefevre', archiveReason: 'Équipement réformé : remplacé par le pont roulant 10 t' } : {}),
  }))).returning({ id: t.controls.id })).map((c) => c.id);
  await tx.insert(t.controlRecords).values(Object.entries(CONTROL_RECORDS).flatMap(([i, rows]) => rows.map(([performedOn, organization, reserves, notes]) => ({
    controlId: controlIds[+i], performedOn, organization, reserves, notes, recordedById: 'clefevre', createdAt: new Date(`${performedOn}T17:00:00+02:00`),
  }))));
  return controlIds;
}
