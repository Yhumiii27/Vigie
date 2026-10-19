import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import * as t from '../schema';
import type { SeedTx } from './types';

// Jeu de démonstration du paquet 5 (conformité réglementaire, migration 0008) : maladie professionnelle et accident de
// trajet (EVT-09), traitement des produits non conformes (EVT-17), signataires des plans de prévention (PRV-07),
// transmission du DUERP au SPST (DUE-03), prérequis et catégories des titres (HAB-10), applicabilité et texte des
// exigences (VEI-10), résultat des contrôles (VEI-11), délai de réponse et observation d'audit (AUD-09), refus partiel
// d'un BSD (DOC-12), objectifs QHSE mesurables (AUD-13), contexte du système de management (CNF-05). Les autres éléments
// (bilan SSCT, synthèse DAT, cycle de certification) se calculent ou se saisissent à l'écran.

/** Événements ajoutés : maladie professionnelle et accident de trajet. */
const MP_ID = 'EV-2026-134';
const COMMUTE_ID = 'EV-2026-135';

/**
 * Remplit (une seule fois) les données du paquet 5 : jeu neuf (dans la transaction du jeu) ou base de démonstration
 * antérieure à la migration 0008 (upgradeDemo). Marqueur : aucun objectif QHSE ni élément de contexte, et événement
 * EV-2026-119 du jeu présent. Jamais d'écrasement d'une saisie : seules les valeurs encore vides sont complétées.
 */
export async function seedCompliance(tx: SeedTx) {
  const [[objectives], [context], [marker]] = await Promise.all([
    tx.select({ n: count() }).from(t.qhseObjectives),
    tx.select({ n: count() }).from(t.contextItems),
    tx.select({ n: count() }).from(t.events).where(eq(t.events.id, 'EV-2026-119')),
  ]);
  if (objectives.n > 0 || context.n > 0 || marker.n === 0) return;

  // EVT-09 : maladie professionnelle (données de santé) et accident de trajet (hors TF1 / TG).
  const existing = new Set((await tx.select({ id: t.events.id }).from(t.events).where(inArray(t.events.id, [MP_ID, COMMUTE_ID]))).map((e) => e.id));
  if (!existing.has(MP_ID)) {
    await tx.insert(t.events).values({
      id: MP_ID, siteId: 'ville-a', type: 'MP', title: 'Maladie professionnelle', occurredOn: '2026-06-24', location: 'Atelier montage',
      declarant: 'Caisse primaire d’assurance maladie', declarantId: null, pilotId: 'clefevre', severity: 2, step: 1,
      description: 'Déclaration transmise par la caisse. Poste de montage à analyser (manutentions répétées).', immediateMeasures: 'Aménagement du poste demandé au médecin du travail.',
      analysisMethod: '5m', victimKind: 'salarie', victimId: 'tnguyen',
      mpTable: '57', mpDisease: 'Tendinopathie de l’épaule', mpCertificateOn: '2026-06-24', mpInformedOn: '2026-07-08', mpQuestionnaireReceivedOn: '2026-10-02',
      createdAt: new Date('2026-07-08T10:00:00+02:00'),
    });
    await tx.insert(t.eventSteps).values({ eventId: MP_ID, kind: 'advance', fromStep: 0, toStep: 1, byId: 'clefevre', at: new Date('2026-07-09T10:00:00+02:00') });
  }
  if (!existing.has(COMMUTE_ID)) {
    await tx.insert(t.events).values({
      id: COMMUTE_ID, siteId: 'ville-b', type: 'AT', title: 'Accident de trajet · domicile – travail', occurredOn: '2026-09-30', occurredTime: '07:40',
      location: 'Trajet domicile – travail', declarant: '[A. Martin]', declarantId: 'amartin', pilotId: 'clefevre', severity: 2, step: 1,
      description: 'Chute à vélo sur le trajet habituel, avant la prise de poste.', immediateMeasures: '', analysisMethod: '5m',
      commute: true, victimKind: 'salarie', victimId: 'amartin', circumstances: 'Chute à vélo sur une chaussée glissante, sur le trajet habituel domicile – travail.',
      knownAt: new Date('2026-09-30T09:15:00+02:00'), injury: 'arret', lostDays: 4, cpamDeclaredOn: '2026-10-01',
      createdAt: new Date('2026-09-30T09:20:00+02:00'),
    });
    await tx.insert(t.eventSteps).values({ eventId: COMMUTE_ID, kind: 'advance', fromStep: 0, toStep: 1, byId: 'clefevre', at: new Date('2026-10-01T10:00:00+02:00') });
  }

  // EVT-17 : traitement des produits non conformes.
  const dispositions: [string, Partial<typeof t.events.$inferInsert>][] = [
    ['EV-2026-130', { ncDisposition: 'retouche', ncQuantity: 3, ncCostKeur: 1.45, ncDispositionNote: 'Reprise des 3 arbres sur CU-2, contrôle à 100 % du lot suivant' }],
    ['EV-2026-121', { ncDisposition: 'retour', ncQuantity: 40, ncCostKeur: 0.32, ncDispositionNote: 'Lot retourné à [Fournisseur F], dérogation refusée' }],
    ['EV-2026-112', { ncDisposition: 'retouche', ncQuantity: 1, ncCostKeur: 0.68 }],
  ];
  for (const [id, set] of dispositions) await tx.update(t.events).set(set).where(and(eq(t.events.id, id), isNull(t.events.ncDisposition)));

  // PRV-07 : signataires des plans déjà signés (nom et qualité).
  const plans = await tx.select({ id: t.preventionPlans.id, ownerId: t.preventionPlans.ownerId, signedEuOn: t.preventionPlans.signedEuOn, signedEeOn: t.preventionPlans.signedEeOn, contactName: t.contractors.contactName })
    .from(t.preventionPlans).innerJoin(t.contractors, eq(t.contractors.id, t.preventionPlans.contractorId));
  const people = new Map((await tx.select({ id: t.people.id, name: t.people.name, job: t.people.job }).from(t.people)).map((p) => [p.id, p]));
  for (const p of plans) {
    const owner = p.ownerId ? people.get(p.ownerId) : undefined;
    if (p.signedEuOn) {
      await tx.update(t.preventionPlans).set({ signedEuName: owner?.name ?? '[H. Marchand]', signedEuQuality: owner?.job || 'Représentant de l’entreprise utilisatrice' })
        .where(and(eq(t.preventionPlans.id, p.id), isNull(t.preventionPlans.signedEuName)));
    }
    if (p.signedEeOn) {
      await tx.update(t.preventionPlans).set({ signedEeName: p.contactName ?? 'Représentant de l’entreprise extérieure', signedEeQuality: 'Chef de chantier' })
        .where(and(eq(t.preventionPlans.id, p.id), isNull(t.preventionPlans.signedEeName)));
    }
  }

  // DUE-03 : version en vigueur transmise au SPST.
  await tx.update(t.duerpVersions).set({ spstSentOn: '2026-03-27' }).where(and(eq(t.duerpVersions.version, '2026.1'), isNull(t.duerpVersions.spstSentOn)));

  // HAB-10 : autorisation de conduite subordonnée à un CACES valide ; catégories et indices obtenus ; une autorisation
  // délivrée sans CACES (état « prérequis non valide »).
  await tx.update(t.trainingTitles).set({ prerequisiteIds: ['r484', 'r489'] }).where(eq(t.trainingTitles.id, 'conduite'));
  await tx.update(t.trainingTitles).set({ scopeLabel: 'Catégories CACES' }).where(inArray(t.trainingTitles.id, ['r484', 'r489']));
  await tx.update(t.trainingTitles).set({ scopeLabel: 'Indices d’habilitation' }).where(eq(t.trainingTitles.id, 'elec'));
  for (const [titleId, scope] of [['r489', '1A, 3, 5'], ['r484', '1'], ['elec', 'B1V, BR, H0V']] as const) {
    await tx.update(t.qualifications).set({ scope }).where(and(eq(t.qualifications.titleId, titleId), isNull(t.qualifications.cancelledAt), isNull(t.qualifications.scope)));
  }
  if (people.has('kbernard')) {
    await tx.insert(t.qualificationRequirements).values({ personId: 'kbernard', titleId: 'conduite' }).onConflictDoNothing();
    const [held] = await tx.select({ n: count() }).from(t.qualifications).where(and(eq(t.qualifications.personId, 'kbernard'), eq(t.qualifications.titleId, 'conduite')));
    if (held.n === 0) {
      await tx.insert(t.qualifications).values({ personId: 'kbernard', titleId: 'conduite', obtainedOn: '2026-10-01', expiresOn: '2031-10-01', provider: 'Formation interne', recordedById: 'clefevre' });
    }
  }

  // VEI-10 : lien vers le texte et applicabilité par site.
  const reqs = await tx.select({ id: t.requirements.id, text: t.requirements.text }).from(t.requirements);
  const reqId = (prefix: string) => reqs.find((r) => r.text.startsWith(prefix))?.id;
  const links: [string, Partial<typeof t.requirements.$inferInsert>][] = [
    ['Règlement (UE) 2023/1230', { legifranceUrl: 'https://eur-lex.europa.eu/eli/reg/2023/1230/oj' }],
    ['Code du travail — R. 4512-6', { legifranceUrl: 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006072050' }],
    ['Code du travail — R. 4121-1', { legifranceUrl: 'https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000006072050' }],
    // Zones ATEX : banc d'essais du site de [Ville B] seulement.
    ['Directive ATEX 2014/34/UE', { siteIds: ['ville-b'], legifranceUrl: 'https://eur-lex.europa.eu/eli/dir/2014/34/oj' }],
  ];
  for (const [prefix, set] of links) {
    const id = reqId(prefix);
    if (id != null) await tx.update(t.requirements).set(set).where(and(eq(t.requirements.id, id), isNull(t.requirements.legifranceUrl)));
  }

  // VEI-11 : résultat des contrôles enregistrés (avec réserves ou favorable) ; portail motorisé défavorable.
  await tx.update(t.controlRecords).set({ result: 'reserves' }).where(and(isNull(t.controlRecords.result), isNotNull(t.controlRecords.reserves)));
  await tx.update(t.controlRecords).set({ result: 'favorable' }).where(and(isNull(t.controlRecords.result), isNull(t.controlRecords.reserves)));
  const [gate] = await tx.select({ id: t.controls.id, lastOn: t.controls.lastOn }).from(t.controls).where(eq(t.controls.equipment, 'Portes et portails motorisés'));
  if (gate) {
    await tx.update(t.controlRecords).set({ result: 'defavorable', notes: 'Portail du quai : dispositif anti-écrasement défaillant, portail condamné en position ouverte.' })
      .where(and(eq(t.controlRecords.controlId, gate.id), eq(t.controlRecords.performedOn, gate.lastOn)));
  }

  // AUD-09 : délai de réponse des écarts, et une observation sans action.
  await tx.update(t.auditFindings).set({ responseDueOn: '2026-07-11' }).where(and(eq(t.auditFindings.kind, 'ecart_mineur'), isNull(t.auditFindings.responseDueOn)));
  const [production] = await tx.select({ id: t.auditFindings.planItemId, audit: t.auditFindings.audit }).from(t.auditFindings).where(eq(t.auditFindings.clause, '§8.2.3'));
  if (production?.id) {
    await tx.insert(t.auditFindings).values({
      audit: production.audit, planItemId: production.id, foundOn: '2026-06-11', kind: 'observation', clause: '§7.5.3',
      text: 'Affichage des consignes au poste de contrôle final : deux versions en circulation', sort: 10,
    });
  }

  // DOC-12 : refus partiel d'un enlèvement de déchets dangereux traité.
  const [hazardous] = await tx.select({ id: t.wasteEntries.id, quantity: t.wasteEntries.quantity }).from(t.wasteEntries)
    .innerJoin(t.wasteStreams, eq(t.wasteStreams.id, t.wasteEntries.streamId))
    .where(and(eq(t.wasteStreams.hazardous, true), eq(t.wasteEntries.bsdStatus, 'traite'), isNull(t.wasteEntries.cancelledAt)))
    .orderBy(t.wasteEntries.removedOn).limit(1);
  if (hazardous) {
    await tx.update(t.wasteEntries).set({
      bsdStatus: 'accepte_partiel', bsdRefusedQuantity: Math.max(0.01, Math.round(hazardous.quantity * 10) / 100),
      bsdRefusalReason: 'Deux fûts mal étiquetés refusés à la réception',
    }).where(eq(t.wasteEntries.id, hazardous.id));
  }

  // AUD-13 : objectifs QHSE mesurables 2026 ; le premier reprend l'objectif de la revue du 11/12/2025.
  const [decision] = await tx.select({ id: t.reviewDecisions.id }).from(t.reviewDecisions).where(and(eq(t.reviewDecisions.kind, 'objectif'))).limit(1);
  await tx.insert(t.qhseObjectives).values([
    { year: 2026, label: 'Réduire les accidents du travail avec arrêt', indicator: 'tf1', target: 4, siteId: null, pilotId: 'hmarchand', reviewDecisionId: decision?.id ?? null, sort: 0, createdById: 'clefevre' },
    { year: 2026, label: 'Développer la remontée des presque-accidents et situations dangereuses', indicator: 'remontees', target: 24, siteId: null, pilotId: 'clefevre', sort: 1, createdById: 'clefevre' },
    { year: 2026, label: 'Des actions efficaces dès la première vérification', indicator: 'actions_efficaces', target: 80, siteId: null, pilotId: 'clefevre', sort: 2, createdById: 'clefevre' },
    { year: 2026, label: 'Maîtriser le coût de non-qualité', indicator: 'cout_non_qualite', target: 15000, siteId: null, pilotId: 'lmoreau', sort: 3, createdById: 'clefevre' },
    { year: 2026, label: 'Aucun contrôle réglementaire dépassé', indicator: 'controles_depasses', target: 0, siteId: 'ville-a', pilotId: 'sbenali', sort: 4, createdById: 'clefevre' },
  ]);

  // CNF-05 : contexte du système de management.
  await tx.insert(t.contextItems).values([
    { kind: 'enjeu_externe', label: 'Règlement (UE) 2023/1230 sur les machines', detail: 'Applicable au 20/01/2027 : cybersécurité, notice numérique, nouvelles procédures de conformité.', sort: 0, createdById: 'clefevre' },
    { kind: 'enjeu_externe', label: 'Tension sur le recrutement de techniciens de mise en service', detail: 'Bassin d’emploi concurrentiel, délais de recrutement de 6 mois.', sort: 1, createdById: 'clefevre' },
    { kind: 'enjeu_interne', label: 'Dépendance à quelques grands clients industriels', detail: 'Trois clients représentent l’essentiel des affaires.', sort: 2, createdById: 'clefevre' },
    { kind: 'partie_interessee', label: 'Clients', detail: 'Délais de livraison, conformité CE des machines, documentation technique complète.', sort: 3, createdById: 'clefevre' },
    { kind: 'partie_interessee', label: 'Salariés et CSE', detail: 'Sécurité aux postes, information sur les risques, consultation sur le DUERP et le programme annuel.', sort: 4, createdById: 'clefevre' },
    { kind: 'partie_interessee', label: 'DREAL (établissement Seveso seuil haut)', detail: 'Étude de dangers à jour, système de gestion de la sécurité, maîtrise de la coactivité.', sort: 5, createdById: 'clefevre' },
    { kind: 'risque', label: 'Perte de compétences clés en mise en service', detail: 'Départs non anticipés de techniciens expérimentés.', treatment: 'Binômes de mise en service, plan de formation interne, suivi dans la matrice des habilitations.', sort: 6, createdById: 'clefevre' },
    { kind: 'opportunite', label: 'Certification ISO 45001', detail: 'Démarche santé-sécurité structurée, attendue par deux clients.', treatment: 'Étude d’opportunité présentée à la revue de direction du 10/12/2026.', sort: 7, createdById: 'clefevre' },
  ]);
}
