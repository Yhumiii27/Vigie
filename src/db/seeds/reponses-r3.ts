import 'server-only';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import * as t from '../schema';
import { paris } from './actions';
import { rel } from './dates';
import type { SeedTx } from './types';

// Jeu de démonstration des réponses du service QHSE du 09/11/2026, paquet R3 (migration 0034) :
// - AUD-40 : deux campagnes d'auto-évaluation ISO 45001 du site A — AE-001 clôturée il y a quatre mois, AE-002 en cours
//   (quelques exigences encore à évaluer), comparée à AE-001 ;
// - PRV-22 : consignations — CSG-001 vérifiée et CSG-003 posée mais non vérifiée (échéance « non vérifiée ») sur PE-2026-008
//   (en cours, site B), CSG-002 vérifiée mais jamais levée sur PF-2026-030 (validité échue : échéance « non levée »).
// Une seule fois : jeu neuf, ou base de démonstration antérieure (marqueur : aucune campagne ni consignation, personnes du
// jeu présentes).

const QHSE = 'clefevre';

/** Niveau de démonstration d'une exigence (rang dans le catalogue), avec sa justification et son constat. */
function demoLevel(i: number, clause: string, second: boolean): { level: string | null; justification: string; finding: string } {
  if (second && i % 9 === 4) return { level: null, justification: '', finding: '' };
  if (clause === '8.1.4') return { level: second ? 'partiel' : 'non_conforme', justification: 'Accueil sécurité des intervenants extérieurs non tracé pour toutes les entreprises.', finding: 'Deux plans de prévention sans liste d’intervenants accueillis.' };
  if (clause === '6.1.2') return { level: second ? 'conforme' : 'partiel', justification: '', finding: second ? 'DUERP mis à jour après l’accident de la mezzanine.' : 'Unités de travail du magasin non réévaluées depuis 2024.' };
  if (clause === '9.2') return { level: second ? 'partiel' : 'non_conforme', justification: 'Programme d’audit interne SST non réalisé sur le semestre.', finding: 'Un audit sur trois réalisé.' };
  if (clause === '7.1.5' || clause === '8.3') return { level: 'non_applicable', justification: 'Sans objet pour le périmètre évalué.', finding: '' };
  return { level: i % 7 === 3 ? 'partiel' : 'conforme', justification: '', finding: '' };
}

export async function seedReponsesR3(tx: SeedTx) {
  const [[assessments], [lockouts], [lead]] = await Promise.all([
    tx.select({ n: count() }).from(t.selfAssessments),
    tx.select({ n: count() }).from(t.lockouts),
    tx.select({ n: count() }).from(t.people).where(eq(t.people.id, QHSE)),
  ]);
  if (assessments.n > 0 || lockouts.n > 0 || lead.n === 0) return;

  const reqs = await tx.select().from(t.assessmentRequirements)
    .where(and(eq(t.assessmentRequirements.standard, 'iso45001'), isNull(t.assessmentRequirements.archivedAt)))
    .orderBy(asc(t.assessmentRequirements.sort), asc(t.assessmentRequirements.id));
  if (reqs.length) {
    await tx.insert(t.selfAssessments).values([
      {
        id: 'AE-001', standard: 'iso45001', siteId: 'site_a', assessedOn: rel(-120), assessorId: QHSE, scope: 'Ateliers montage et usinage, magasin',
        conclusion: 'Système globalement en place ; priorités : accueil des entreprises extérieures et programme d’audit interne.',
        status: 'cloturee', closedAt: paris(rel(-115), '17:00'), closedById: QHSE, createdById: QHSE, createdAt: paris(rel(-120), '09:00'),
      },
      { id: 'AE-002', standard: 'iso45001', siteId: 'site_a', assessedOn: rel(-3), assessorId: QHSE, scope: 'Ateliers montage et usinage, magasin', createdById: QHSE, createdAt: paris(rel(-3), '09:00') },
    ]);
    for (const [id, second, on] of [['AE-001', false, rel(-118)], ['AE-002', true, rel(-2)]] as const) {
      await tx.insert(t.selfAssessmentLines).values(reqs.map((r, i) => {
        const v = demoLevel(i, r.clause, second);
        return {
          assessmentId: id, requirementId: r.id, clause: r.clause, heading: r.heading, sort: r.sort, ...v,
          assessedById: v.level ? QHSE : null, assessedAt: v.level ? paris(on, '11:00') : null,
        };
      }));
    }
    await tx.insert(t.selfAssessmentComments).values({ assessmentId: 'AE-001', authorId: 'hmarchand', body: 'Résultats présentés au comité de direction ; plan d’actions à suivre en revue de direction.', createdAt: paris(rel(-100), '10:00') });
    await tx.insert(t.changeLog).values([
      { entityType: 'self_assessment', entityId: 'AE-001', action: 'create', summary: `Auto-évaluation ISO 45001 ouverte (${reqs.length} exigences)`, byId: QHSE, at: paris(rel(-120), '09:00') },
      { entityType: 'self_assessment', entityId: 'AE-001', action: 'status', summary: 'Campagne clôturée (figée)', byId: QHSE, at: paris(rel(-115), '17:00') },
      { entityType: 'self_assessment', entityId: 'AE-001', action: 'comment', summary: 'Commentaire ajouté', byId: 'hmarchand', at: paris(rel(-100), '10:00') },
      { entityType: 'self_assessment', entityId: 'AE-002', action: 'create', summary: `Auto-évaluation ISO 45001 ouverte (${reqs.length} exigences)`, byId: QHSE, at: paris(rel(-3), '09:00') },
    ]);
  }

  const permits = new Set((await tx.select({ id: t.permits.id }).from(t.permits)).map((p) => p.id));
  const rows = [
    {
      id: 'CSG-001', permitId: 'PE-2026-008', siteId: 'site_b', energy: 'electrique', equipment: 'Armoire d’alimentation du banc BE-1',
      points: [{ label: 'Sectionneur général Q1', device: 'cadenas 104' }, { label: 'Disjoncteur départ convoyeur Q7', device: 'cadenas 105' }],
      applierId: 'jpetit', verifierId: 'amartin', status: 'verifiee', appliedAt: paris(rel(-3), '07:40'), appliedById: 'jpetit', verifiedAt: paris(rel(-3), '07:50'), verifiedById: 'amartin',
      createdById: 'jpetit', createdAt: paris(rel(-4), '16:00'),
    },
    {
      id: 'CSG-002', permitId: 'PF-2026-030', siteId: 'site_a', energy: 'fluide', equipment: 'Réseau d’air comprimé de l’aire de découpe',
      points: [{ label: 'Vanne d’isolement V3', device: 'condamnation 7' }, { label: 'Purge du tronçon', device: '' }],
      applierId: 'proux', verifierId: 'sbenali', status: 'verifiee', appliedAt: paris(rel(-4), '13:10'), appliedById: 'sbenali', verifiedAt: paris(rel(-4), '13:20'), verifiedById: 'sbenali',
      createdById: 'sbenali', createdAt: paris(rel(-5), '15:00'),
    },
    {
      id: 'CSG-003', permitId: 'PE-2026-008', siteId: 'site_b', energy: 'pneumatique', equipment: 'Vérin de poussée du convoyeur',
      points: [{ label: 'Vanne de coupure pneumatique VP2', device: 'cadenas 112' }],
      applierId: 'amartin', verifierId: 'jpetit', status: 'posee', appliedAt: paris(rel(0), '07:45'), appliedById: 'jpetit', createdById: 'jpetit', createdAt: paris(rel(-1), '11:00'),
    },
  ].filter((l) => permits.has(l.permitId));
  if (rows.length) {
    await tx.insert(t.lockouts).values(rows);
    for (const l of rows) {
      const entries = [{ action: 'create', summary: 'préparée', at: l.createdAt }];
      if (l.appliedAt) entries.push({ action: 'status', summary: 'posée', at: l.appliedAt });
      if (l.verifiedAt) entries.push({ action: 'status', summary: 'vérifiée', at: l.verifiedAt });
      for (const e of entries) {
        await tx.insert(t.changeLog).values([
          { entityType: 'permit', entityId: l.permitId, action: e.action, summary: `Consignation ${l.id} : ${e.summary}`, byId: l.createdById, at: e.at },
          { entityType: 'lockout', entityId: l.id, action: e.action, summary: e.summary, byId: l.createdById, at: e.at },
        ]);
      }
    }
  }
}
