import { eq, inArray } from 'drizzle-orm';
import { monthName } from '../../lib/dates';
import * as t from '../schema';
import { pid } from './core';
import { rel } from './dates';
import type { SeedTx } from './types';

// Jeu de démonstration : certifications, programme d'audit, constats et revues de direction (QUA-26 : extrait de
// src/db/seed.ts).

// Le statut affiché est calculé (certificationStatus) : `status` n'est qu'une précision libre.
export const CERTS: (typeof t.certifications.$inferInsert)[] = [
  { id: 'iso9001', domain: 'Qualité', standard: 'ISO 9001:2015', status: '', tone: 'ok', note: 'Cycle de certification 2025–2028', organization: '[Organisme certificateur]', issuedOn: rel(-298), validUntil: rel(797) },
  { id: 'iso45001', domain: 'Santé-sécurité', standard: 'ISO 45001:2018', status: 'Déploiement en cours', tone: 'warn', note: 'Certification visée au second semestre 2027' },
  { id: 'iso14001', domain: 'Environnement', standard: 'ISO 14001:2015', status: '', tone: 'off', note: "Étude d'opportunité à la revue de direction du 10/12" },
];

// [ligne, mois, libellé, date, intitulé d'échéance, responsable, action] — index 13 et 14 : échéances des revues de direction
// (audit_plan_items.review_id, AUD-01) ; index 15 : élément annulé (AUD-03).
export const PLAN: [string, number, string, string?, string?, string?, string?][] = [
  ['Audits internes', 2, 'Achats', undefined, 'Processus Achats'], ['Audits internes', 4, 'BE', undefined, 'Processus Conception BE'], ['Audits internes', 6, 'Production', undefined, 'Processus Production'],
  ['Audits internes', 10, 'BE · 17/10', rel(8), 'Processus Conception BE', '[E. Dubois]'], ['Audits internes', 12, 'Mise en serv.'],
  ['Certification', 11, 'ISO 9001 17/11', rel(39), 'Audit de suivi ISO 9001', '[E. Dubois]'],
  ['Fournisseurs', 3, '[Fourn. F]'], ['Fournisseurs', 9, '[Fourn. G]'], ['Fournisseurs', 11, '[Fourn. F] · NC'],
  ['Visites sécurité', 1, 'Montage'], ['Visites sécurité', 4, 'Usinage'], ['Visites sécurité', 7, 'Magasin'],
  ['Visites sécurité', 10, 'Essais 12/10', rel(3), "Visite trimestrielle — zone d'essais", '[S. Benali]', 'A-181'],
  ['Revues de direction', 6, 'Interm. 18/06', rel(-113), 'Revue de direction intermédiaire', '[H. Marchand]'], ['Revues de direction', 12, 'Annuelle 10/12', rel(62), 'Revue de direction annuelle', '[H. Marchand]'],
  ['Audits internes', 8, 'Logistique', undefined, 'Processus Logistique et expédition'],
];
// Réalisation et périmètre des éléments du programme, par index de PLAN (un élément réalisé porte sa date de réalisation).
export const PLAN_EXTRA: Record<number, Partial<typeof t.auditPlanItems.$inferInsert>> = {
  0: { done: true, doneOn: rel(-239), auditor: '[L. Moreau]', scope: 'Achats et sous-traitance' },
  1: { done: true, doneOn: rel(-176), auditor: '[L. Moreau]' },
  2: { done: true, doneOn: rel(-120), auditor: '[L. Moreau]', scope: 'Usinage, montage, contrôle final' },
  // Reporté de septembre au 17/10 (AUD-03 : première date prévue conservée).
  3: { auditor: '[L. Moreau]', scope: 'Processus Conception BE', postponedFrom: rel(-22) },
  5: { certificationId: 'iso9001', auditor: '[Organisme certificateur]', scope: 'Conception, fabrication et mise en service de machines spéciales' },
  6: { done: true, doneOn: rel(-204) },
  // 7 : [Fourn. G] (septembre) non confirmé — échéance passée « à confirmer ».
  9: { done: true, doneOn: rel(-260) },
  10: { done: true, doneOn: rel(-183) },
  11: { done: true, doneOn: rel(-94) },
  13: { done: true, doneOn: rel(-113) },
  // Annulé (jamais supprimé), motif conservé : hors grille, échéances, constats et dossier.
  15: { cancelledAt: new Date(`${rel(-86)}T09:00:00+02:00`), cancelledById: 'clefevre', cancelReason: "Processus intégré au périmètre de l'audit Production de juin" },
};

// [élément du programme (index de PLAN), date, type, exigence, constat, action] ; libellé d'audit : « intitulé · mois année ».
export const FINDINGS: [number, string, string, string | null, string, string | null][] = [
  [2, rel(-120), 'ecart_mineur', '§8.2.3', 'Revue des exigences client non formalisée pour 2 affaires (§8.2.3)', 'A-188'],
  [2, rel(-120), 'piste', '§8.5.1', 'Harmoniser les gammes de contrôle entre usinage et montage', 'A-212'],
  [2, rel(-120), 'point_fort', null, 'Traçabilité des composants critiques via Keystone', null],
  [2, rel(-120), 'ecart_mineur', '§7.2', 'Enregistrements de formation incomplets pour 3 intérimaires (§7.2)', 'A-205'],
  // Constat sans action : signal « constat sans action ».
  [0, rel(-239), 'piste', '§8.4.1', "Formaliser l'évaluation annuelle des sous-traitants", null],
];

// Check-list de la revue du 10/12/2026 [élément, fourni, source (REVIEW_SOURCES), contributeur, attendu le, complément] ;
// l'état des éléments automatiques est calculé. Les visites sécurité (attendues le 05/10) sont en retard : signal de la revue.
export const REVIEW: [label: string, done: boolean, source: string, ownerId: string | null, dueOn?: string, owner?: string][] = [
  ['Suivi des actions de la revue précédente', false, 'actions', null],
  ['Résultats des audits internes et de certification', true, 'manuel', 'edubois'],
  ['Satisfaction client et réclamations', true, 'manuel', 'lmoreau'],
  ['Indicateurs sécurité : TF1, TG, pyramide', false, 'safety', null],
  ['Non-conformités, événements et contrôles périodiques', false, 'events', null],
  ['Performance des fournisseurs', false, 'manuel', 'lmoreau', rel(42)],
  ['Veille réglementaire : impacts du règlement 2023/1230', false, 'manuel', 'edubois', rel(52)],
  ['Adéquation des ressources et des compétences', false, 'manuel', 'clefevre', rel(47)],
  ["Retour d'expérience des visites sécurité", false, 'manuel', 'sbenali', rel(-4)],
  ["Opportunités d'amélioration et objectifs 2027", false, 'manuel', 'clefevre', rel(42), 'A-184'],
];

/** Certifications, programme 2026, constats et leurs actions, revues de direction (décisions, check-list). */
export async function seedAudits(tx: SeedTx) {
  await tx.insert(t.certifications).values(CERTS.map((c, sort) => ({ ...c, sort })));
  const planIds = (await tx.insert(t.auditPlanItems).values(PLAN.map(([track, month, label, plannedOn, detail, owner, actionId], i) => ({
    year: 2026, track, month, label, plannedOn: plannedOn ?? null, detail: detail ?? null, ownerId: owner ? pid(owner) : null, actionId: actionId ?? null, ...PLAN_EXTRA[i],
  }))).returning({ id: t.auditPlanItems.id })).map((p) => p.id);
  const findingIds = (await tx.insert(t.auditFindings).values(FINDINGS.map(([pi, foundOn, kind, clause, text], sort) => {
    const [, month, label, , detail] = PLAN[pi];
    return { audit: `${detail ?? label} · ${monthName(month)} 2026`, planItemId: planIds[pi], foundOn, clause, kind, text, sort };
  })).returning({ id: t.auditFindings.id })).map((f) => f.id);
  // Actions des constats (AUD-28 : table de liaison finding_actions).
  const findingActions = FINDINGS.flatMap(([, , , , , actionId], i) => (actionId ? [{ findingId: findingIds[i], actionId }] : []));
  if (findingActions.length) await tx.insert(t.findingActions).values(findingActions);

  // Revues de direction : deux revues clôturées (avant Vigie, sans dossier figé) et la revue annuelle en préparation.
  const [r2025, r2026i, r2026] = await tx.insert(t.reviews).values([
    { reviewOn: rel(-302), kind: 'ordinaire', status: 'cloturee', participantIds: ['hmarchand', 'clefevre', 'lmoreau', 'edubois', 'sbenali'],
      customerPerception: 'Enquête annuelle : 8,1/10 ; délais de livraison à surveiller sur les machines spéciales.', resourceNeeds: "Recrutement d'un technicien méthodes au premier semestre 2026.",
      minutes: 'Politique QHSE reconduite. Objectif 2026 : TF1 < 4. Développer la remontée des presque-accidents ; étudier la certification ISO 45001.',
      nextReviewOn: rel(-113), recordedById: 'clefevre', closedOn: rel(-295), closedById: 'hmarchand', snapshot: null, createdAt: new Date(`${rel(-340)}T10:00:00+01:00`) },
    { reviewOn: rel(-113), kind: 'intermediaire', status: 'cloturee', participantIds: ['hmarchand', 'clefevre', 'lmoreau', 'sbenali'],
      minutes: "Point d'étape : TF1 en baisse, engagement ISO 45001 au second semestre 2027. Renforcer l'animation sécurité terrain.",
      nextReviewOn: rel(62), recordedById: 'clefevre', closedOn: rel(-106), closedById: 'hmarchand', snapshot: null, createdAt: new Date(`${rel(-142)}T10:00:00+02:00`) },
    { reviewOn: rel(62), kind: 'ordinaire', status: 'planifiee', createdAt: new Date(`${rel(-106)}T10:00:00+02:00`) },
  ]).returning({ id: t.reviews.id });
  await tx.update(t.actions).set({ reviewId: r2025.id }).where(inArray(t.actions.id, ['A-152', 'A-158']));
  await tx.update(t.actions).set({ reviewId: r2026i.id }).where(eq(t.actions.id, 'A-174'));
  await tx.update(t.actions).set({ reviewId: r2026.id }).where(eq(t.actions.id, 'A-184'));
  // Échéances du programme portées par les revues (AUD-01) ; la revue du 11/12/2025 n'a pas d'élément au programme 2026.
  await tx.update(t.auditPlanItems).set({ reviewId: r2026i.id }).where(eq(t.auditPlanItems.id, planIds[13])); // 'Interm. 18/06'
  await tx.update(t.auditPlanItems).set({ reviewId: r2026.id }).where(eq(t.auditPlanItems.id, planIds[14])); // 'Annuelle 10/12'
  await tx.insert(t.reviewDecisions).values([
    { reviewId: r2025.id, kind: 'objectif', text: 'Politique QHSE reconduite ; objectif 2026 : TF1 < 4', pilotId: 'hmarchand', sort: 0 },
    { reviewId: r2025.id, kind: 'decision', text: 'Développer la remontée des presque-accidents', pilotId: 'clefevre', dueOn: rel(-192), actionId: 'A-152', sort: 1 },
    { reviewId: r2025.id, kind: 'decision', text: "Étudier l'opportunité d'une certification ISO 45001", pilotId: 'hmarchand', dueOn: rel(-101), actionId: 'A-158', sort: 2 },
    { reviewId: r2025.id, kind: 'ressource', text: 'Recruter un technicien méthodes au premier semestre 2026', pilotId: 'hmarchand', dueOn: rel(-101), sort: 3 },
    { reviewId: r2026i.id, kind: 'decision', text: "Former les chefs d'équipe à l'animation des quarts d'heure sécurité", pilotId: 'sbenali', dueOn: rel(-9), actionId: 'A-174', sort: 0 },
  ]);
  await tx.insert(t.reviewItems).values(REVIEW.map(([label, done, source, ownerId, dueOn, owner], sort) => ({
    reviewId: r2026.id, label, done, source, ownerId, dueOn: dueOn ?? null, owner: owner ?? '', sort,
  })));
}
