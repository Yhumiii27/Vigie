import 'server-only';
import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { DEMO_QHSE_LEAD } from '../lib/demo';
import { backfillActionLinks } from '../lib/origin-links';
import * as t from './schema';
import type { Db, Tx } from './types';
import { seedActions, upgradeDemoActions } from './seeds/actions';
import { seedAudits } from './seeds/audits';
import { seedCompliance } from './seeds/compliance';
import { seedControlCodes } from './seeds/controls-share';
import { DEMO_LAST_ROLES, DEMO_SIRET, PEOPLE, demoEmail, seedCore } from './seeds/core';
import { rel } from './seeds/dates';
import { seedDocuments } from './seeds/documents';
import { demoWasteStreamMentions, seedEnvironment } from './seeds/environment';
import { BENIGN, EVENTS, EVENT_DETAILS, seedEvents } from './seeds/events';
import { seedFieldMobile } from './seeds/field';
import { seedModuleFunctions } from './seeds/modules';
import { seedPrevention } from './seeds/prevention';
import { seedRisks } from './seeds/risks';
import { seedSitemap } from './seeds/sitemap';
import { FIRST_AID_TITLE, seedSkills } from './seeds/skills';
import { seedWatch } from './seeds/watch';
import { seedComplianceFunctions } from './seeds/paquet13';
import { seedManagementSystem } from './seeds/paquet13b';

// Jeu de données initial, repris de la maquette « Vigie UI mockups review » (design/Vigie.dc.html), par domaine dans
// src/db/seeds/ (QUA-26) : sites et personnes (core), événements (events), plan d'actions QSE (actions), DUERP (risks),
// veille et contrôles (watch), habilitations (skills), audits et revues (audits), prévention, documents, environnement,
// carte du site (sitemap), puis les compléments des paquets (compliance, modules, field, controls-share). Dates relatives
// à la date de référence du jeu (rel, src/db/seeds/dates.ts, QUA-20). Ce fichier orchestre le chargement d'une base vide
// et la mise à niveau unique d'un jeu de démonstration antérieur (upgradeDemo).

/**
 * Base de démonstration remplie par une version antérieure à la migration 0003 (cas courant : `.data/vigie` de
 * `npm run dev` et de l'application Mac) : responsable QHSE des sites, dernier rôle connu et e-mail y sont vides,
 * et toutes les alertes iraient au poste vacant. Complétés une seule fois, comme dans un jeu neuf : seulement pour le
 * jeu de démonstration (fiche de l'animatrice QHSE présente) et tant que rien n'est renseigné — un choix fait
 * ensuite dans « Gérer les sites » n'est jamais écrasé.
 */
async function upgradeDemo(db: Db, opts: { files?: boolean } = {}) {
  // Liens réels des actions (ACT-01) : reprise idempotente des références d'origine textuelles (src/lib/origin-links.ts,
  // depuis l'ancienne origine conservée par la migration 0005 : actions.legacy_origin).
  await backfillActionLinks(db, { apply: true });
  // Plan d'actions QSE (migration 0005) : champs « à compléter » du jeu d'avant complétés une fois (src/db/seeds/actions.ts).
  await upgradeDemoActions(db);
  // Lot 2 (migration 0004) : rubriques des AT, registre des accidents bénins, mentions du registre des déchets.
  await upgradeDemoAccidents(db);
  await upgradeDemoWasteMentions(db);
  // Paquet 5 (migration 0008) : données de conformité réglementaire, une seule fois (src/db/seeds/compliance.ts).
  await db.transaction((tx) => seedCompliance(tx));
  // Paquet 6 (migration 0011) : coactivité maîtrisée et pièces jointes de démonstration, une seule fois (src/db/seeds/modules.ts).
  await db.transaction((tx) => seedModuleFunctions(tx, opts));
  // Paquet 7 (migration 0012) : zones des événements et zone archivée, une seule fois (src/db/seeds/field.ts).
  await db.transaction((tx) => seedFieldMobile(tx));
  // Vue pub_controles (migration 0014) : code commun d'équipement du banc BE-1, une seule fois (src/db/seeds/controls-share.ts).
  await db.transaction((tx) => seedControlCodes(tx));
  // Paquet 13 (migration 0020) : conformité et fonctions métier, une seule fois (src/db/seeds/paquet13.ts).
  await db.transaction((tx) => seedComplianceFunctions(tx));
  // Paquet 13, seconde moitié (migration 0021), une seule fois (src/db/seeds/paquet13b.ts).
  await db.transaction((tx) => seedManagementSystem(tx));
  const [[lead], [withLead], [withRole]] = await Promise.all([
    db.select({ n: count() }).from(t.people).where(eq(t.people.id, DEMO_QHSE_LEAD)),
    db.select({ n: count() }).from(t.sites).where(isNotNull(t.sites.qhseLeadId)),
    db.select({ n: count() }).from(t.people).where(isNotNull(t.people.lastRole)),
  ]);
  if (lead.n === 0 || withLead.n > 0 || withRole.n > 0) return;
  await db.transaction(async (tx) => {
    for (const [id, lastRole] of DEMO_LAST_ROLES) {
      await tx.update(t.people).set({ lastRole }).where(and(eq(t.people.id, id), isNull(t.people.lastRole)));
    }
    // E-mail unique (insensible à la casse) : une adresse déjà attribuée à une autre fiche n'est pas reprise.
    const taken = new Set((await tx.select({ email: t.people.email }).from(t.people).where(isNotNull(t.people.email)))
      .map((p) => p.email!.toLowerCase()));
    for (const [id, name] of PEOPLE) {
      const email = demoEmail(name);
      if (taken.has(email)) continue;
      await tx.update(t.people).set({ email }).where(and(eq(t.people.id, id), isNull(t.people.email)));
    }
    await tx.update(t.sites).set({ qhseLeadId: DEMO_QHSE_LEAD })
      .where(and(inArray(t.sites.id, ['ville-a', 'ville-b']), isNull(t.sites.qhseLeadId)));
  });
}

/**
 * Base de démonstration remplie avant la migration 0004 : accidents du travail sans les rubriques de la déclaration (EVT-01),
 * registre des accidents bénins vide (EVT-04), titre SST non signalé comme titre de secourisme. Sans cette reprise, modifier
 * un AT qualifié échoue tant que la victime et les circonstances ne sont pas saisies (EVT-05). Une seule fois : événement
 * EV-2026-119 présent, aucune victime renseignée sur les AT de démonstration et registre vide. Les intitulés et descriptions
 * ne sont remplacés que s'ils sont restés ceux du jeu d'origine.
 */
async function upgradeDemoAccidents(db: Db) {
  const demoAt = EVENTS.filter((e) => e[2] === 'AT').map((e) => e[0]);
  const [[marker], [withVictim], [benign]] = await Promise.all([
    db.select({ n: count() }).from(t.events).where(eq(t.events.id, 'EV-2026-119')),
    db.select({ n: count() }).from(t.events).where(and(inArray(t.events.id, demoAt), isNotNull(t.events.victimKind))),
    db.select({ n: count() }).from(t.benignAccidents),
  ]);
  if (marker.n === 0 || withVictim.n > 0 || benign.n > 0) return;
  await db.transaction(async (tx) => {
    const rows = await tx.select({ id: t.events.id, title: t.events.title, description: t.events.description })
      .from(t.events).where(inArray(t.events.id, Object.keys(EVENT_DETAILS)));
    for (const row of rows) {
      const original = EVENTS.find((e) => e[0] === row.id);
      const { title, description, ...details } = EVENT_DETAILS[row.id];
      await tx.update(t.events).set({
        ...details,
        ...(original && row.title === original[3] && title ? { title } : {}),
        ...(original && row.description === original[11] && description ? { description } : {}),
      }).where(eq(t.events.id, row.id));
    }
    const present = new Set(rows.map((r) => r.id));
    const people = new Set((await tx.select({ id: t.people.id }).from(t.people)).map((p) => p.id));
    const register = BENIGN.filter((b) => present.has(b.eventId) && (!b.caregiverId || people.has(b.caregiverId)));
    if (register.length) await tx.insert(t.benignAccidents).values(register);
    const [flagged] = await tx.select({ n: count() }).from(t.trainingTitles).where(eq(t.trainingTitles.firstAid, true));
    if (flagged.n === 0) await tx.update(t.trainingTitles).set({ firstAid: true }).where(eq(t.trainingTitles.id, FIRST_AID_TITLE));
  });
}

/**
 * Mentions du registre des déchets (DOC-02, arrêté du 31 mai 2021) d'une base de démonstration antérieure à la migration
 * 0004 : SIRET des sites de démonstration, mentions des filières FD-01 à FD-12 et de leurs enlèvements — seulement les
 * valeurs encore vides (idempotent, jamais d'écrasement d'une saisie).
 */
async function upgradeDemoWasteMentions(db: Db) {
  const [marker] = await db.select({ n: count() }).from(t.wasteStreams).where(eq(t.wasteStreams.id, 'FD-01'));
  if (marker.n === 0) return;
  const defaults = demoWasteStreamMentions();
  await db.transaction(async (tx) => {
    for (const [id, siret] of Object.entries(DEMO_SIRET)) {
      await tx.update(t.sites).set({ siret }).where(and(eq(t.sites.id, id), isNull(t.sites.siret)));
    }
    const streams = await tx.select().from(t.wasteStreams).where(inArray(t.wasteStreams.id, Object.keys(defaults)));
    for (const s of streams) {
      const d = defaults[s.id];
      if (s.collectorSiret || s.destinationSiret || s.qualification) continue;
      await tx.update(t.wasteStreams).set(d).where(eq(t.wasteStreams.id, s.id));
      const filled = { ...s, ...d };
      await tx.update(t.wasteEntries).set({ destinationSiret: filled.destinationSiret, destinationAddress: filled.destinationAddress, qualification: filled.qualification, pop: filled.pop })
        .where(and(eq(t.wasteEntries.streamId, s.id), isNull(t.wasteEntries.destinationSiret), isNull(t.wasteEntries.qualification)));
      await tx.update(t.wasteEntries).set({ transporterSiret: filled.collectorSiret, transporterAddress: filled.collectorAddress, transporterReceipt: filled.collectorReceipt })
        .where(and(eq(t.wasteEntries.streamId, s.id), eq(t.wasteEntries.transporter, s.collector), isNull(t.wasteEntries.transporterSiret)));
    }
  });
}

/**
 * Jeu de démonstration (VIGIE_DEMO=1 seulement, voir src/db/index.ts) : chargé dans une base vide (ni site ni personne) ;
 * base déjà remplie : mise à niveau unique d'un jeu de démonstration antérieur (upgradeDemo). `files` : écrit aussi les
 * fichiers des preuves des actions (VIGIE_UPLOAD_DIR) — ouverture de la base par src/db/index.ts ; db:check charge le
 * jeu sans fichiers (aucune écriture dans .data/uploads depuis une vérification en mémoire).
 */
export async function seed(db: Db, opts: { files?: boolean } = {}) {
  const empty = async (q: Db | Tx) => {
    const [[sites], [people]] = await Promise.all([q.select({ n: count() }).from(t.sites), q.select({ n: count() }).from(t.people)]);
    return sites.n === 0 && people.n === 0;
  };
  if (!(await empty(db))) return upgradeDemo(db, opts);

  await db.transaction(async (tx) => {
    // Recompté en première instruction de la transaction : sur PostgreSQL, deux instances qui démarrent ensemble ont pu
    // compter toutes deux une base vide ; le verrou d'écriture (src/db/index.ts) fait attendre la seconde, qui voit ici
    // le jeu déjà chargé par la première et ne le charge pas une deuxième fois.
    // Jeu chargé entre-temps par une autre instance : rien à faire (sa mise à niveau est sans objet sur un jeu neuf).
    if (!(await empty(tx))) return false;
    await seedCore(tx);
    await seedEvents(tx);

    // Plan d'actions QSE (après les personnes et les événements) : actions, fil, journal, notifications, compteur, preuves.
    await seedActions(tx, { files: opts.files });

    const riskId = await seedRisks(tx);
    const controlIds = await seedWatch(tx);
    await seedSkills(tx);
    await seedAudits(tx);

    await seedPrevention(tx);
    await seedDocuments(tx);
    await seedEnvironment(tx);
    await seedSitemap(tx);

    // Sources d'origine des actions Documents et Environnement (ACT-01), après l'insertion des documents et déchets.
    // A-178 (« Registre des déchets 2026 ») n'a pas de fiche source : elle reste repérée par sa référence. Plus d'action QSE
    // depuis la Prévention (anciennes A-206, A-216, A-220 : réponses du service QHSE du 15/10/2026).
    await tx.update(t.actions).set({ documentId: 'PR-QHSE-002' }).where(eq(t.actions.id, 'A-208'));
    await tx.update(t.actions).set({ wasteStreamId: 'FD-04' }).where(eq(t.actions.id, 'A-219'));
    const [fd11] = await tx.select({ id: t.wasteEntries.id }).from(t.wasteEntries)
      .where(and(eq(t.wasteEntries.streamId, 'FD-11'), eq(t.wasteEntries.removedOn, rel(-51))));
    await tx.update(t.actions).set({ wasteEntryId: fd11.id }).where(eq(t.actions.id, 'A-218'));

    // Rattachements facultatifs des événements (après l'insertion des contrôles, risques, documents, plans et permis).
    const EVENT_LINKS: [string, Partial<typeof t.events.$inferInsert>][] = [
      ['EV-2026-131', { controlId: controlIds[0], riskId: riskId('montage', 'Manutention mécanique'), documentId: 'IT-MON-012' }],
      ['EV-2026-130', { documentId: 'IT-USI-004' }],
      ['EV-2026-127', { riskId: riskId('usinage', 'Coupure') }],
      ['EV-2026-126', { riskId: riskId('magasin', 'Chimique / environnement') }],
      ['EV-2026-124', { riskId: riskId('montage', 'Incendie / explosion') }],
      ['EV-2026-120', { riskId: riskId('usinage', 'Projection') }],
      ['EV-2026-119', { riskId: riskId('essais', 'Chute de hauteur') }],
      ['EV-2026-115', { controlId: controlIds[1] }],
      ['EV-2026-112', { documentId: 'FO-MON-003' }],
      ['EV-2026-132', { preventionPlanId: 'PP-2026-013' }],
      ['EV-2026-133', { permitId: 'PF-2026-031' }],
    ];
    for (const [id, set] of EVENT_LINKS) await tx.update(t.events).set(set).where(eq(t.events.id, id));

    // Paquet 5 (conformité réglementaire) : après tous les modules dont il complète les données.
    await seedCompliance(tx);
    // Paquet 6 (fonctions des modules) : coactivité maîtrisée, pièces jointes ajoutées après la saisie.
    await seedModuleFunctions(tx, opts);
    // Paquet 7 (terrain et mobile) : zones des événements, zone archivée (après la carte et les événements).
    await seedFieldMobile(tx);
    // Vue pub_controles (demande de Crucible) : code commun d'équipement du banc BE-1.
    await seedControlCodes(tx);
    // Paquet 13 (conformité et fonctions métier) : registre de sécurité, métrologie, mesures liées, zones des unités…
    await seedComplianceFunctions(tx);
    // Paquet 13, seconde moitié : audits hors programme et par site, situations d'urgence, changements, revue documentaire.
    await seedManagementSystem(tx);

    // Journal des modifications : quelques entrées de démonstration (annulations, archivages) ; celles des actions sont
    // écrites par seedActions.
    await tx.insert(t.changeLog).values([
      { entityType: 'event', entityId: 'EV-2026-123', action: 'dismiss', summary: 'Classé sans suite', reason: 'Doublon de EV-2026-124 (même constat, même déclarant).', byId: 'clefevre', at: new Date(`${rel(-19)}T09:00:00+02:00`) },
      { entityType: 'prevention_plan', entityId: 'PP-2026-010', action: 'cancel', summary: 'Plan annulé', reason: 'Intervention reportée à la campagne de printemps 2027 : un nouveau plan sera établi', byId: 'jpetit', at: new Date(`${rel(-8)}T11:00:00+02:00`) },
      { entityType: 'contractor', entityId: 'EE-007', action: 'archive', summary: 'Entreprise archivée', reason: 'Contrat de maintenance des sols terminé, entreprise plus référencée', byId: 'clefevre', at: new Date(`${rel(-192)}T10:00:00+02:00`) },
      { entityType: 'control', entityId: String(controlIds[8]), action: 'archive', summary: 'Contrôle archivé · équipement réformé', reason: 'Équipement réformé : remplacé par le pont roulant 10 t', byId: 'clefevre', at: new Date(`${rel(-101)}T10:00:00+02:00`) },
      { entityType: 'site', entityId: 'ville-c', action: 'archive', summary: 'Site archivé', reason: 'Dépôt fermé fin mars 2026 : activité regroupée sur le site de [Ville A].', byId: 'hmarchand', at: new Date(`${rel(-192)}T16:00:00Z`) },
    ]);
    return true;
  });
}
