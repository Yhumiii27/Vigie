import { and, count, eq } from 'drizzle-orm';
import * as t from '../schema';
import { monthName } from '../../lib/dates';
import { rel } from './dates';
import type { SeedTx } from './types';
import { AUDITOR_TITLE } from './skills';

// Jeu de démonstration de la seconde moitié du paquet 13 (conformité et fonctions métier, migration 0021) :
// - AUD-27 : titre « Auditeur interne » (qualification de [L. Moreau]) et auditeur interne des audits internes ;
// - AUD-20, AUD-22 : audit client hors programme du site A (réalisé, constat d'observation sans action) ;
// - AUD-21 : second élément sur la ligne « Visites sécurité » en octobre ;
// - (DOC-15, DOC-17 : revue sans modification et document externe tenus par Codex depuis le lot 4 de M-02 : src/db/seeds/documents.ts) ;
// - CNF-08 : situations d'urgence du site A (exercice d'évacuation tenu, exercice de déversement en retard) ;
// - CNF-11 : demandes de changement (à évaluer, acceptée à mettre en œuvre, mise en œuvre).

const at = (day: string, time = '10:00') => new Date(`${day}T${time}:00+02:00`);
const CLIENT_AUDIT = 'Audit client [Client A]';

/**
 * Remplit (une seule fois) les données de la seconde moitié du paquet 13 : jeu neuf (dans sa transaction, après tous les
 * modules) ou base de démonstration antérieure à la migration 0021 (upgradeDemo). Marqueur : aucune situation d'urgence ni
 * demande de changement, et personnes du jeu présentes. Chaque complément vérifie la présence de ses éléments.
 */
export async function seedManagementSystem(tx: SeedTx) {
  const [[situations], [changes], [lead]] = await Promise.all([
    tx.select({ n: count() }).from(t.emergencySituations),
    tx.select({ n: count() }).from(t.changeRequests),
    tx.select({ n: count() }).from(t.people).where(eq(t.people.id, 'clefevre')),
  ]);
  if (situations.n > 0 || changes.n > 0 || lead.n === 0) return;

  // AUD-27 : titre qualifiant un auditeur interne suivi par Vigie ([L. Moreau] le détient d'après Cursus : substitut
  // src/db/seeds/foreign.ts) ; auditeur interne des audits internes.
  const [title] = await tx.select({ id: t.trainingTitles.id }).from(t.trainingTitles).where(eq(t.trainingTitles.id, AUDITOR_TITLE));
  if (!title) {
    const [{ n: sort }] = await tx.select({ n: count() }).from(t.trainingTitles);
    await tx.insert(t.trainingTitles).values({ id: AUDITOR_TITLE, label: 'Auditeur interne (ISO 19011)', validityMonths: 0, sort, internalAuditor: true });
  }
  await tx.update(t.auditPlanItems).set({ auditorId: 'lmoreau', auditor: null })
    .where(and(eq(t.auditPlanItems.auditor, '[L. Moreau]'), eq(t.auditPlanItems.track, 'Audits internes')));

  // AUD-20, AUD-22 : audit client hors programme du site A, réalisé, avec un constat d'observation.
  const [audit] = await tx.insert(t.auditPlanItems).values({
    year: +rel(-45).slice(0, 4), month: +rel(-45).slice(5, 7), track: 'Audits clients', label: 'Client A', plannedOn: rel(-45), detail: CLIENT_AUDIT,
    done: true, doneOn: rel(-45), auditor: '[Auditeur qualité du Client A]', scope: 'Fabrication et contrôle final des réducteurs', siteId: 'site_a', unplanned: true, ownerId: 'lmoreau', auditKind: 'autre',
  }).returning({ id: t.auditPlanItems.id, year: t.auditPlanItems.year, month: t.auditPlanItems.month });
  const [{ n: findings }] = await tx.select({ n: count() }).from(t.auditFindings);
  await tx.insert(t.auditFindings).values({
    audit: `${CLIENT_AUDIT} · ${monthName(audit.month)} ${audit.year}`,
    planItemId: audit.id, siteId: 'site_a', clause: '§8.6', foundOn: rel(-45), kind: 'observation', sort: findings,
    text: 'Libération des réducteurs RD-7 : signature du contrôle final à rendre visible sur le bon de livraison',
  });

  // AUD-21 : second élément sur la ligne « Visites sécurité » le même mois que la visite de la zone d'essais.
  const [visit] = await tx.select({ year: t.auditPlanItems.year, month: t.auditPlanItems.month }).from(t.auditPlanItems)
    .where(and(eq(t.auditPlanItems.track, 'Visites sécurité'), eq(t.auditPlanItems.label, 'Essais 12/10')));
  if (visit) {
    await tx.insert(t.auditPlanItems).values({
      year: visit.year, month: visit.month, track: 'Visites sécurité', label: 'Magasin · 29/10', plannedOn: rel(20), detail: 'Visite sécurité — magasin et quais', ownerId: 'sbenali', siteId: 'site_a', auditKind: 'terrain',
    });
  }

  // CNF-08 : situations d'urgence du site A.
  const [fire, spill] = await tx.insert(t.emergencySituations).values([
    {
      siteId: 'site_a', label: "Incendie de l'atelier montage", drillMonths: 12, ownerId: 'sbenali', createdById: 'clefevre', createdAt: at(rel(-700)),
      scenario: 'Départ de feu au poste de soudure ou dans le stock de cartons ; fumées dans l’atelier et le magasin voisin.',
      response: 'Extincteurs CO2 et eau pulvérisée, RIA à l’entrée, guides et serre-files désignés, point de rassemblement parking nord ; appel du 18.',
    },
    {
      siteId: 'site_a', label: 'Déversement de produit chimique au magasin', drillMonths: 12, ownerId: 'rfontaine', createdById: 'clefevre', createdAt: at(rel(-700)),
      scenario: 'Fût d’huile de coupe ou de dégraissant percé lors d’une manutention ; écoulement vers le caniveau des quais.',
      response: 'Kit antipollution au quai 2, obturateur de caniveau, absorbants ; fiche réflexe affichée ; évacuation par la filière des déchets souillés.',
    },
  ]).returning({ id: t.emergencySituations.id });
  await tx.insert(t.emergencyDrills).values([
    { situationId: fire.id, heldOn: rel(-300), participants: 'Atelier montage et magasin (24 personnes), deux guides, un serre-file', findings: 'Évacuation en 3 min 40 ; une porte coupe-feu calée ouverte au magasin, retirée le jour même.', createdById: 'clefevre', createdAt: at(rel(-300), '15:00') },
    { situationId: spill.id, heldOn: rel(-372), participants: 'Magasiniers (3), chef d’atelier', findings: 'Kit mis en place en 6 min ; obturateur rangé trop loin du quai : déplacé.', createdById: 'clefevre', createdAt: at(rel(-372), '15:00') },
  ]);

  // CNF-11 : demandes de changement.
  await tx.insert(t.changeRequests).values([
    {
      id: 'MC-001', siteId: 'site_a', kind: 'equipement', title: 'Nouvelle cabine de peinture à l’atelier montage', status: 'acceptee', pilotId: 'sbenali', plannedOn: rel(10),
      description: 'Remplacement de la cabine de retouche par une cabine ventilée avec filtration.', rationale: 'Exposition aux solvants (DUERP, atelier montage) et capacité insuffisante.',
      impacts: 'Risque chimique réduit ; nouvelle formation des peintres ; consignes du poste et plan de prévention de l’installateur à mettre à jour.',
      decidedOn: rel(-20), decidedById: 'hmarchand', decisionNote: 'Acceptée : budget validé, installation pendant l’arrêt de fin octobre.', createdById: 'sbenali', createdAt: at(rel(-35)),
    },
    {
      id: 'MC-002', siteId: 'site_a', kind: 'organisation', title: 'Réorganisation des allées du magasin', status: 'demandee', pilotId: 'rfontaine',
      description: 'Déplacement des racks de la zone 3 pour créer une allée piétonne dédiée.', rationale: 'Observation de la CARSAT sur la circulation des piétons.',
      impacts: 'Coactivité chariots / piétons réduite ; plan de circulation à mettre à jour.', createdById: 'rfontaine', createdAt: at(rel(-6)),
    },
    {
      id: 'MC-003', siteId: null, kind: 'exigence', title: 'Prise en compte du règlement machines 2023/1230', status: 'realisee', pilotId: 'edubois',
      description: 'Mise à jour du dossier technique et des notices des machines livrées.', rationale: 'Entrée en application du règlement (UE) 2023/1230.',
      impacts: 'Procédure de conception PR-BE à réviser ; formation du bureau d’études.', decidedOn: rel(-160), decidedById: 'clefevre', decisionNote: 'Acceptée.',
      doneOn: rel(-50), doneNote: 'Procédure révisée et bureau d’études formé.', createdById: 'edubois', createdAt: at(rel(-170)),
    },
  ]);
}
