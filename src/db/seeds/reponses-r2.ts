import 'server-only';
import { and, count, eq, isNull } from 'drizzle-orm';
import * as t from '../schema';
import { paris } from './actions';
import { rel } from './dates';
import type { SeedTx } from './types';

// Jeu de démonstration des réponses du service QHSE du 09/11/2026, paquet R2 (migration 0033) :
// - PRV-23 : titre « Accueil sécurité » marqué comme accueil des intervenants ; deux intervenants sur PP-2026-015 (en cours) :
//   [K. Bernard], accueil jamais suivi (avertissement et échéance au responsable QHSE du site), et [P. Roux], à jour ;
// - CNF-01 : registre des dangers graves et imminents du site A : avis n° 1 clos (mesures consignées), avis n° 2 signé par
//   le représentant du CSE ([T. Nguyen], membre du CSE de la démonstration) et sans mesures (échéance du jour) ;
// - CNF-09 : deux causeries du site A, l'une émargée par tous, l'autre envoyée et en attente de deux signatures (sans
//   notification de la cloche dans le jeu : la feuille se signe depuis « Mon espace »).
// Une seule fois : jeu neuf, ou base de démonstration antérieure (marqueur : aucun avis ni causerie, personnes du jeu
// présentes).

const QHSE = 'clefevre';

export async function seedReponsesR2(tx: SeedTx) {
  const [[dgi], [talks], [lead]] = await Promise.all([
    tx.select({ n: count() }).from(t.dgiNotices),
    tx.select({ n: count() }).from(t.safetyTalks),
    tx.select({ n: count() }).from(t.people).where(eq(t.people.id, QHSE)),
  ]);
  if (dgi.n > 0 || talks.n > 0 || lead.n === 0) return;

  await tx.update(t.trainingTitles).set({ safetyInduction: true }).where(and(eq(t.trainingTitles.id, 'formation.accueil'), isNull(t.trainingTitles.archivedAt)));

  const [plan] = await tx.select({ id: t.preventionPlans.id }).from(t.preventionPlans).where(eq(t.preventionPlans.id, 'PP-2026-015'));
  if (plan) {
    await tx.insert(t.preventionPlanWorkers).values([
      { planId: plan.id, personId: 'kbernard', addedById: QHSE, addedAt: paris(rel(-4)) },
      { planId: plan.id, personId: 'proux', addedById: QHSE, addedAt: paris(rel(-4)) },
    ]);
  }

  const notices = await tx.insert(t.dgiNotices).values([
    {
      siteId: 'site_a', number: 1, reportedAt: paris(rel(-40), '14:20'), workstations: 'Atelier usinage · tour T2',
      danger: 'Carter de protection du mandrin fissuré : risque de projection de pièces en rotation.',
      exposedWorkers: '[T. Nguyen], [P. Roux]', representativeName: '[T. Nguyen]', signedAt: paris(rel(-40), '14:30'), signedById: 'tnguyen',
      measures: 'Tour T2 consigné le jour même ; carter remplacé par le fournisseur, contrôle avant remise en service.', measuresAt: paris(rel(-39), '09:00'), measuresById: QHSE,
      closedAt: paris(rel(-35)), closedById: QHSE, createdById: 'tnguyen', createdAt: paris(rel(-40), '14:30'),
    },
    {
      siteId: 'site_a', number: 2, reportedAt: paris(rel(0), '08:15'), workstations: 'Magasin · mezzanine de stockage',
      danger: 'Garde-corps de la mezzanine déposé pour les travaux de soudage, sans balisage de la trémie.',
      exposedWorkers: '[A. Martin], préparateurs de commandes de l’équipe du matin', representativeName: '[T. Nguyen]', signedAt: paris(rel(0), '08:20'), signedById: 'tnguyen',
      createdById: 'tnguyen', createdAt: paris(rel(0), '08:20'),
    },
  ]).returning({ id: t.dgiNotices.id, number: t.dgiNotices.number });
  for (const n of notices) {
    await tx.insert(t.changeLog).values({ entityType: 'dgi_notice', entityId: String(n.id), action: 'create', summary: `Avis n° ${n.number} consigné au registre des dangers graves et imminents et signé par le représentant du CSE`, byId: 'tnguyen', at: paris(rel(n.number === 1 ? -40 : 0), '08:20') });
  }

  await tx.insert(t.safetyTalks).values([
    {
      id: 'CS-001', siteId: 'site_a', heldOn: rel(-21), theme: 'Port des EPI au poste de soudage', animatorId: 'sbenali', durationMinutes: 15,
      notes: 'Rappel des lunettes teintées et des gants manchettes ; démonstration de l’écran de soudage.', sheetSentAt: paris(rel(-21), '11:00'), sheetSentById: 'sbenali',
      createdById: 'sbenali', createdAt: paris(rel(-21), '10:40'),
    },
    {
      id: 'CS-002', siteId: 'site_a', heldOn: rel(-2), theme: 'Circulation des chariots sous la mezzanine', animatorId: QHSE, durationMinutes: 20,
      notes: 'Zone balisée pendant les travaux de soudage (PP-2026-015) ; priorité aux piétons.', sheetSentAt: paris(rel(-2), '09:30'), sheetSentById: QHSE,
      createdById: QHSE, createdAt: paris(rel(-2), '09:20'),
    },
  ]);
  await tx.insert(t.safetyTalkParticipants).values([
    { talkId: 'CS-001', personId: 'tnguyen', notifiedAt: paris(rel(-21), '11:00'), signedAt: paris(rel(-21), '11:20') },
    { talkId: 'CS-001', personId: 'proux', notifiedAt: paris(rel(-21), '11:00'), signedAt: paris(rel(-20), '08:05') },
    { talkId: 'CS-002', personId: 'proux', notifiedAt: paris(rel(-2), '09:30'), signedAt: paris(rel(-2), '10:02') },
    { talkId: 'CS-002', personId: 'tnguyen', notifiedAt: paris(rel(-2), '09:30') },
    { talkId: 'CS-002', personId: 'kbernard', notifiedAt: paris(rel(-2), '09:30') },
  ]);
  await tx.insert(t.changeLog).values([
    { entityType: 'safety_talk', entityId: 'CS-001', action: 'create', summary: `Causerie « Port des EPI au poste de soudage » enregistrée (2 participants)`, byId: 'sbenali', at: paris(rel(-21), '10:40') },
    { entityType: 'safety_talk', entityId: 'CS-002', action: 'create', summary: `Causerie « Circulation des chariots sous la mezzanine » enregistrée (3 participants)`, byId: QHSE, at: paris(rel(-2), '09:20') },
    { entityType: 'safety_talk', entityId: 'CS-002', action: 'send', summary: "Feuille d'émargement envoyée à 3 participants", byId: QHSE, at: paris(rel(-2), '09:30') },
  ]);
}
