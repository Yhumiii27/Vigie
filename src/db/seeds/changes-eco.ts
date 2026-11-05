import * as t from '../schema';
import { paris } from './actions';
import { rel } from './dates';
import type { SeedTx } from './types';

// Jeu de démonstration des modifications techniques (D12, lot 5 de M-02, migration 0029), d'après les articles, projets et
// machines des substituts de Keystone (src/db/seeds/foreign.ts) et les documents de Codex (src/db/seeds/documents.ts) :
// - ECO-2026-001 : arbre de malaxeur ARB-MAL-045 à l'indice C (NC EV-2026-130), en approbation — ingénierie approuvée par
//   Keystone (demande reçue), qualité et chefs de projet attendus (échéances dépassées), une disposition à décider ; née de
//   la demande ECR-2026-003 (Vigie) ;
// - ECO-2026-002 : vérin hydraulique VER-HYD-300, changement de fournisseur, libéré — mise à jour du projet K-2024-097 en
//   retard (échéance), rétrofit de la presse MCH-022 dans 25 jours, projet K-2026-003 mis à jour ; née de la demande de Codex
//   ECR-2026-002 (revue de conception), décision transmise à Codex et mise en œuvre (révision C) ;
// - ECO-2026-003 : capot de presse CAP-PRS-400 retiré (obsolescence), brouillon ;
// - ECR-2026-001 : demande de Codex sur la procédure « Maîtrise des documents », à décider (reçue par
//   vigie.pub_creer_demande_modification).
// Jeu neuf seulement (comme les demandes reçues du lot 3).

const QHSE = 'clefevre';
const SITE = 'site_a';
const at = (day: string, time = '10:00') => paris(day, time);

export async function seedChangesEco(tx: SeedTx) {
  await tx.insert(t.ecos).values([
    {
      id: 'ECO-2026-001', title: 'Arbre de malaxeur Ø45 h7 : passage à l’indice C (traitement thermique et contrôle renforcés)', ecoType: 'rev', status: 'in_approval',
      interchangeability: 'yes', fromRevision: 'B', toRevision: 'C', costEur: 1850, scheduleDays: 10,
      stockImpact: '12 arbres à l’indice B en stock : à écouler sur les machines du parc conservées à l’indice actuel.',
      requestedByName: '[S. Benali]', requestedByMatricule: 'EMP-9009', raisedOn: rel(-20), pilotId: QHSE, siteId: SITE, source: 'vigie',
      description: 'Suite de la NC EV-2026-130 (cotes hors tolérance) : traitement thermique avant rectification, contrôle à 100 % du Ø45 h7.',
      approvalRequestedOn: rel(-12), createdById: QHSE, createdAt: at(rel(-20)), updatedAt: at(rel(-6), '14:20'),
    },
    {
      id: 'ECO-2026-002', title: 'Vérin hydraulique 300 t : nouveau fournisseur qualifié', ecoType: 'sup', status: 'released',
      interchangeability: 'yes', fromRevision: 'D', toRevision: 'E', costEur: 4200, scheduleDays: 21,
      stockImpact: 'Aucun stock du fournisseur précédent.', requestedByName: '[L. Moreau]', requestedByMatricule: 'EMP-9008', raisedOn: rel(-70),
      pilotId: 'lmoreau', siteId: SITE, source: 'codex', description: 'Arrêt de fabrication chez le fournisseur actuel ; revue de conception mise à jour.',
      approvalRequestedOn: rel(-50), releasedAt: at(rel(-30), '16:00'), createdById: QHSE, createdAt: at(rel(-70)), updatedAt: at(rel(-10)),
    },
    {
      id: 'ECO-2026-003', title: 'Capot de presse PC-400 : retrait (obsolescence)', ecoType: 'obs', status: 'draft',
      fromRevision: 'A', toRevision: '—', requestedByName: '[C. Lefèvre]', requestedByMatricule: 'EMP-9011', raisedOn: rel(-2), pilotId: QHSE, siteId: SITE,
      source: 'vigie', createdById: QHSE, createdAt: at(rel(-2)), updatedAt: at(rel(-2)),
    },
  ]);
  await tx.insert(t.ecrs).values([
    {
      id: 'ECR-2026-001', kind: 'modification', subject: 'document', title: 'Modification de PRO-QUA-0001 · Maîtrise des documents',
      reason: 'Intégrer le circuit de validation des ordres de modification (ECO) tenus par Vigie.', source: 'codex', codexDocId: 'PRO-QUA-0001',
      requesterName: '[J. Wagner]', requesterRef: 'jwagner', status: 'submitted', createdAt: at(rel(-3), '11:05'), updatedAt: at(rel(-3), '11:05'),
    },
    {
      id: 'ECR-2026-002', kind: 'modification', subject: 'document', title: 'Modification de PRO-QUA-0005 · Revue de conception (EN ISO 12100)',
      reason: 'Ajouter la qualification d’un second fournisseur de vérins à la revue de conception.', source: 'codex', codexDocId: 'PRO-QUA-0005',
      requesterName: '[L. Moreau]', requesterRef: 'lmoreau', requesterMatricule: 'EMP-9008', status: 'implemented', ecoId: 'ECO-2026-002', modifierRef: 'lmoreau',
      decisionNote: 'Acceptée avec l’ordre ECO-2026-002.', decidedById: QHSE, decidedAt: at(rel(-60)), implementedAt: at(rel(-30), '16:10'), codexRevision: 'C',
      notifyStatus: 'sent', notifyAttempts: 1, siteId: null, createdAt: at(rel(-72)), updatedAt: at(rel(-30), '16:10'),
    },
    {
      id: 'ECR-2026-003', kind: 'modification', subject: 'part', title: 'Arbre de malaxeur ARB-MAL-045 : fiabiliser le Ø45 h7',
      reason: 'NC répétée sur les cotes du Ø45 h7 (EV-2026-130).', source: 'vigie', partRef: 'ARB-MAL-045', eventId: 'EV-2026-130',
      requesterName: '[S. Benali]', requesterMatricule: 'EMP-9009', status: 'accepted', ecoId: 'ECO-2026-001', decidedById: QHSE, decidedAt: at(rel(-20), '09:30'),
      siteId: SITE, createdById: 'sbenali', createdAt: at(rel(-24)), updatedAt: at(rel(-20), '09:30'),
    },
  ]);
  await tx.insert(t.ecoParts).values([
    { ecoId: 'ECO-2026-001', partRef: 'ARB-MAL-045', position: 1 },
    { ecoId: 'ECO-2026-002', partRef: 'VER-HYD-300', position: 1 },
    { ecoId: 'ECO-2026-003', partRef: 'CAP-PRS-400', position: 1 },
  ]);
  await tx.insert(t.ecoProjects).values([
    { ecoId: 'ECO-2026-001', keystoneProjectCode: 'K-2025-077', position: 1 },
    { ecoId: 'ECO-2026-002', keystoneProjectCode: 'K-2024-097', position: 1 },
  ]);
  await tx.insert(t.ecoDocuments).values([
    { ecoId: 'ECO-2026-001', position: 1, refLabel: 'Plan ARB-MAL-045 indice C', codexDocId: null },
    { ecoId: 'ECO-2026-001', position: 2, refLabel: 'PRO-QUA-0006', codexDocId: 'PRO-QUA-0006' },
    { ecoId: 'ECO-2026-002', position: 1, refLabel: 'PRO-QUA-0005', codexDocId: 'PRO-QUA-0005', ecrId: 'ECR-2026-002' },
  ]);
  await tx.insert(t.ecoApprovals).values([
    {
      ecoId: 'ECO-2026-001', approvalKey: 'englead', approverText: '[E. Dubois]', decision: 'ok', decidedByName: '[E. Dubois]', decidedAt: at(rel(-6), '14:20'),
      comment: 'Plan à l’indice C diffusé au bureau d’études.', via: 'keystone',
    },
    { ecoId: 'ECO-2026-001', approvalKey: 'quality', approverText: '[C. Lefèvre]', approverId: QHSE },
    { ecoId: 'ECO-2026-001', approvalKey: 'pm', approverText: '[E. Dubois]', approverId: 'edubois' },
    ...(['englead', 'quality', 'pm'] as const).map((k) => ({
      ecoId: 'ECO-2026-002', approvalKey: k, approverText: k === 'quality' ? '[C. Lefèvre]' : '[E. Dubois]', decision: 'ok', decidedByName: k === 'quality' ? '[C. Lefèvre]' : '[E. Dubois]',
      decidedById: k === 'quality' ? QHSE : 'edubois', decidedAt: at(rel(k === 'pm' ? -30 : -40), '15:30'), via: 'vigie',
    })),
    { ecoId: 'ECO-2026-003', approvalKey: 'englead', approverText: 'Responsable ingénierie' },
    { ecoId: 'ECO-2026-003', approvalKey: 'quality', approverText: '[C. Lefèvre]', approverId: QHSE },
    { ecoId: 'ECO-2026-003', approvalKey: 'pm', approverText: 'Chefs des projets visés' },
  ]);
  await tx.insert(t.ecoEffectivity).values([
    { ecoId: 'ECO-2026-001', targetType: 'project', targetRef: 'K-2025-042', label: 'K-2025-042 · [Client A]', disposition: 'update', isAutomatic: true, position: 1 },
    { ecoId: 'ECO-2026-001', targetType: 'project', targetRef: 'K-2025-077', label: 'K-2025-077 · [Client A]', disposition: 'update', isAutomatic: false, position: 2 },
    {
      ecoId: 'ECO-2026-001', targetType: 'machine', targetRef: 'MCH-031', label: 'MCH-031 · Malaxeur MX-1', disposition: 'retrofit', isAutomatic: true,
      fittedPartRef: 'ARB-MAL-045', fittedRevision: 'A', note: 'Au prochain arrêt programmé du client.', position: 3,
    },
    { ecoId: 'ECO-2026-001', targetType: 'machine', targetRef: 'MCH-035', label: 'MCH-035 · Malaxeur MX-1 (seconde machine)', isAutomatic: true, fittedPartRef: 'ARB-MAL-045', fittedRevision: 'A', position: 4 },
    { ecoId: 'ECO-2026-002', targetType: 'project', targetRef: 'K-2024-097', label: 'K-2024-097 · [Client C]', disposition: 'update', isAutomatic: false, dueOn: rel(-5), position: 1 },
    { ecoId: 'ECO-2026-002', targetType: 'project', targetRef: 'K-2026-003', label: 'K-2026-003 · [Client F]', disposition: 'update', isAutomatic: true, dueOn: rel(20), doneOn: rel(-10), position: 2 },
    {
      ecoId: 'ECO-2026-002', targetType: 'machine', targetRef: 'MCH-022', label: 'MCH-022 · Presse à cartoucher PC-400', disposition: 'retrofit', isAutomatic: true,
      fittedPartRef: 'VER-HYD-300', fittedRevision: 'C', dueOn: rel(25), position: 3,
    },
  ]);
  // Demandes reçues déjà traitées (vigie.pub_creer_demande_modification de Codex, vigie.pub_signaler_avancement_eco de Keystone).
  const [codex, keystone] = await tx.insert(t.inboundRequests).values([
    {
      caller: 'codex_app', tool: 'codex', kind: 'ecr_create', externalId: 'demo-codex-0001', targetRef: 'ECR-2026-001', projectCode: null,
      payload: { kind: 'modification', documentId: 'PRO-QUA-0001', reason: 'Intégrer le circuit de validation des ordres de modification (ECO) tenus par Vigie.', requester: { ref: 'jwagner', name: '[J. Wagner]' } },
      receivedAt: at(rel(-3), '11:00'), status: 'applied', processedAt: at(rel(-3), '11:05'), result: 'Demande ECR-2026-001 créée, à décider par le QHSE de Vigie.', ecrId: 'ECR-2026-001',
    },
    {
      caller: 'keystone_app', tool: 'keystone', kind: 'eco_approval', externalId: 'demo-keystone-0003', targetRef: 'ECO-2026-001', projectCode: null,
      payload: { kind: 'approval', approvalKey: 'englead', decision: 'ok', comment: 'Plan à l’indice C diffusé au bureau d’études.', actor: { name: '[E. Dubois]', role: 'englead' } },
      receivedAt: at(rel(-6), '14:10'), status: 'applied', processedAt: at(rel(-6), '14:20'), result: 'Décision enregistrée dans Vigie.', ecoId: 'ECO-2026-001',
    },
  ]).returning({ id: t.inboundRequests.id });
  // Décision transmise à Codex par son webhook (file d'envoi), réponse 200 : révision C ouverte.
  await tx.insert(t.outboundMessages).values({
    target: 'codex', kind: 'ecr_decision', entityType: 'ecr', entityId: 'ECR-2026-002',
    payload: { requestId: 'ECR-2026-002', accepted: true, ecoRef: 'ECO-2026-002', modifierId: 'lmoreau', note: 'Acceptée avec l’ordre ECO-2026-002.' },
    status: 'sent', attempts: 1, lastStatus: 200, createdAt: at(rel(-30), '16:00'), nextAttemptAt: at(rel(-30), '16:00'), sentAt: at(rel(-30), '16:10'),
  });
  await tx.insert(t.changeLog).values([
    { entityType: 'ecr', entityId: 'ECR-2026-003', action: 'create', summary: 'Demande de modification créée : Modification · ARB-MAL-045', byId: 'sbenali', at: at(rel(-24)) },
    {
      entityType: 'ecr', entityId: 'ECR-2026-003', action: 'decide', summary: 'Demande acceptée : ordre ECO-2026-001', byId: QHSE, at: at(rel(-20), '09:30'),
      details: [{ field: 'État', from: 'À décider', to: 'Acceptée' }, { field: 'Ordre de modification', from: null, to: 'ECO-2026-001' }],
    },
    { entityType: 'eco', entityId: 'ECO-2026-001', action: 'create', summary: 'Ordre créé d’après la demande ECR-2026-003', byId: QHSE, at: at(rel(-20), '09:30') },
    {
      entityType: 'eco', entityId: 'ECO-2026-001', action: 'status', summary: 'étape « En approbation »', byId: QHSE, at: at(rel(-12)),
      details: [{ field: 'Étape', from: 'Analyse d’impact', to: 'En approbation' }],
    },
    {
      entityType: 'eco', entityId: 'ECO-2026-001', action: 'approval', summary: 'Keystone (keystone_app) : Responsable ingénierie : approuvé', byId: null, at: at(rel(-6), '14:20'),
      details: [
        { field: 'Responsable ingénierie', from: 'En attente', to: 'Approuvé' }, { field: 'Décidé par', from: null, to: '[E. Dubois]' },
        { field: 'Demande reçue', from: null, to: `Keystone (keystone_app) · n° ${keystone.id} · Approbation d’un ordre` },
      ],
    },
    {
      entityType: 'ecr', entityId: 'ECR-2026-001', action: 'create', summary: 'Codex (codex_app) : demande de modification reçue', byId: null, at: at(rel(-3), '11:05'),
      details: [{ field: 'Demande reçue', from: null, to: `Codex (codex_app) · n° ${codex.id} · Demande de modification` }],
    },
    { entityType: 'eco', entityId: 'ECO-2026-002', action: 'create', summary: 'Ordre créé d’après la demande ECR-2026-002', byId: QHSE, at: at(rel(-60)) },
    { entityType: 'ecr', entityId: 'ECR-2026-002', action: 'create', summary: 'Codex (codex_app) : demande de modification reçue', byId: null, at: at(rel(-72)) },
    { entityType: 'ecr', entityId: 'ECR-2026-002', action: 'decide', summary: 'Demande acceptée : ordre ECO-2026-002', byId: QHSE, at: at(rel(-60)) },
    {
      entityType: 'eco', entityId: 'ECO-2026-002', action: 'release', summary: 'Ordre libéré d’office : approbations et dispositions acquises', byId: QHSE, at: at(rel(-30), '16:00'),
      details: [{ field: 'Étape', from: 'En approbation', to: 'Libéré' }],
    },
    {
      entityType: 'ecr', entityId: 'ECR-2026-002', action: 'status', summary: 'Codex : décision appliquée, révision C ouverte', byId: null, at: at(rel(-30), '16:10'),
      details: [{ field: 'État', from: 'Acceptée', to: 'Mise en œuvre' }],
    },
    { entityType: 'eco', entityId: 'ECO-2026-003', action: 'create', summary: 'Ordre de modification créé : Obsolescence', byId: QHSE, at: at(rel(-2)) },
  ]);
}
