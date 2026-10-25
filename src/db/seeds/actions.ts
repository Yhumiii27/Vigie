import 'server-only';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { actionHref, actionLabel, followUpProblem, isQhse, parseActionNumber, transitionSummary, type TransitionKind } from '../../lib/action-rules';
import { addDays, fmtDate, parisDay } from '../../lib/dates';
import {
  ACTION_DOMAINS, ACTION_NUMBER_SCOPE, ACTION_PRIORITIES, ACTION_SOURCES, AVANCEMENT, FOLLOW_REASONS, LEGACY_ORIGIN_LABELS, VERIFY_METHODS,
  type Avancement, type Role,
} from '../../lib/domain';
import * as t from '../schema';
import type { Db } from '../types';
import type { SeedTx } from './types';
import { DEMO_REFERENCE_DAY, rel } from './dates';

// Jeu de démonstration du plan d'actions QSE (docs/specs/actions-qse.md, plan du paquet 1 § 1.5 amendé le 15/10/2026),
// sorti de src/db/seed.ts (QUA-26, en partie). Date de référence : 09/10/2026 (VIGIE_TODAY).
//
// - 31 actions : les 29 actions de démonstration d'avant 0005 qui restent des actions QSE (mêmes numéros, responsables,
//   événements et rattachements), plus deux actions de suite (A-221 : A-170 non efficace ; A-222 : nouveau risque de
//   A-176). A-206, A-207, A-216 et A-220 (Prévention, Habilitations) ne sont plus créées : elles ne sont pas des
//   actions QSE (réponses du service QHSE du 15/10/2026) ; leurs numéros ne sont jamais réattribués (compteur à 222).
// - Les dix avancements sont représentés ; en retard au 09/10 : A-205, A-209, A-198, A-203, A-201. « À compléter » :
//   A-150 seulement (site à compléter, ligne qui simule une action reprise : legacy_origin, entrée de reprise).
// - Dates cohérentes avec les règles du § 4 (actionDateOrderErrors vide) : A-170 et A-176 ont des dates postérieures à
//   leur événement (dans une base mise à niveau, elles gardent leurs dates d'avant, tolérées : D24).
// - Fil de commentaires (A-214, A-215, A-190, A-174, A-209 dont un commentaire retiré), preuves (fichiers écrits
//   seulement avec `files`), notifications datées (jamais defaultNow(), qui daterait après VIGIE_TODAY) : « Action
//   confiée » des actions créées après 0005 (A-215, A-221, A-222) et, pour l'animatrice QHSE, une par commentaire ou
//   preuve d'un responsable qui n'est pas du QHSE (ACT-31) — non lues : A-215 (confiée, commentaire), A-221 (confiée).
// - Actions de suite créées à l'instant de la vérification qui les décide (même transaction côté serveur).
// - Rien de A-215 (seule action de [T. Nguyen], Salarié de démonstration) ne cite un autre numéro d'action ni une autre
//   personne de l'effectif : test/e2e/employee-payload.test.ts parcourt la charge de la page du Salarié.
//
// Le jeu écrit ses lignes directement (jamais src/server/*, qui tirerait la session et next/headers dans db:check) ;
// les preuves passent par saveUpload (src/lib/uploads.ts, seul module qui écrit les fichiers).

type ActionSeed = typeof t.actions.$inferInsert;
type Row = Omit<ActionSeed, 'id' | 'detail' | 'openedOn' | 'initialDueOn' | 'createdAt' | 'legacyOrigin'> & {
  createdAt: Date; initialDueOn?: string;
};
type DemoAction = {
  /** Intitulé du jeu d'avant 0005 : première ligne du détail ; la mise à niveau ne complète que les lignes restées ainsi. */
  title: string;
  /** Suite du détail (seconde ligne) dans un jeu neuf. */
  more?: string;
  /** Origine du jeu d'avant 0005 (legacy_origin après la reprise) ; null : action créée après 0005 (actions de suite). */
  origin: string | null;
  /** Date du passage à l'avancement ouvert courant (journal), pour les actions engagées. */
  stepOn?: string;
  row: Row;
};

/** Date de référence du jeu (VIGIE_TODAY de la démonstration). */
const DEMO_DAY = DEMO_REFERENCE_DAY;
const paris = (iso: string, time = '10:00') => new Date(`${iso}T${time}:00${iso >= '2026-10-25' || iso < '2026-03-29' ? '+01:00' : '+02:00'}`);

const A170_NOTE = 'Abri extérieur saturé : trois bouteilles vides retrouvées au poste soudure le 29/09.';

/** Actions du jeu, par numéro (ordre d'insertion : numéros décroissants comme l'ancien jeu, actions de suite à la fin). */
export const DEMO_ACTIONS: Record<string, DemoAction> = {
  'A-214': {
    title: 'Remplacer les élingues textiles par des élingues à œillets, étiquetage CMU', origin: 'ev', stepOn: rel(-2),
    more: 'Retirer les élingues textiles du poste M3 et tenir le registre des accessoires de levage à jour.',
    row: {
      pilotId: 'sbenali', status: 'p40', priority: 'urgent', dueOn: rel(8), source: 'evenement', originRef: 'EV-2026-131', eventId: 'EV-2026-131',
      siteId: 'ville-a', domain: 'securite', problem: "Chute de charge au retournement d'un bâti : élingue textile usée, sans étiquette de charge maximale d'utilisation.",
      verifyDueOn: rel(37), riskLevel: 3, estimatedCost: 950, createdAt: paris(rel(-6)),
    },
  },
  'A-215': {
    title: 'Rédiger le mode opératoire de retournement des bâtis > 1 t', origin: 'ev',
    more: "Points d'élingage, angle d'élingage et périmètre de basculement par type de bâti.",
    row: {
      pilotId: 'tnguyen', status: 'a_faire', priority: 'moyen_terme', dueOn: rel(22), source: 'evenement', originRef: 'EV-2026-131', eventId: 'EV-2026-131',
      siteId: 'ville-a', domain: 'securite', problem: "Aucun mode opératoire écrit pour le retournement des bâtis de plus d'une tonne au pont roulant.",
      verifyDueOn: rel(52), riskLevel: 3, createdAt: paris(rel(-6)),
    },
  },
  'A-212': {
    title: "Mettre à jour la gamme de contrôle de l'arbre de malaxeur (Ø45 h7)", origin: 'ev', stepOn: rel(-3),
    row: {
      pilotId: 'lmoreau', status: 'p60', priority: 'moyen_terme', dueOn: rel(1), source: 'evenement', originRef: 'EV-2026-130', eventId: 'EV-2026-130',
      siteId: 'ville-a', domain: 'qualite', problem: "Cotes hors tolérance sur l'arbre de malaxeur : la gamme ne prévoit pas de contrôle intermédiaire de l'usure outil.",
      verifyDueOn: rel(32), createdAt: paris(rel(-7)),
    },
  },
  'A-209': {
    title: 'Remplacer le flexible et contrôler les 12 flexibles du banc BE-1', origin: 'ev', stepOn: rel(-4),
    row: {
      pilotId: 'jpetit', status: 'p20', priority: 'urgent', dueOn: rel(-1), source: 'evenement', originRef: 'EV-2026-129', eventId: 'EV-2026-129',
      siteId: 'ville-b', domain: 'securite', problem: "Flexible hydraulique endommagé sur le banc d'essais BE-1 : risque de rupture à 250 bar.",
      verifyDueOn: rel(21), riskLevel: 3, estimatedCost: 680, createdAt: paris(rel(-8)),
    },
  },
  'A-205': {
    title: 'Recyclage habilitation électrique BR pour 4 monteurs', origin: 'risk',
    row: {
      pilotId: 'clefevre', status: 'a_faire', priority: 'urgent', dueOn: rel(-9), source: 'duerp', originRef: 'DUERP · atelier montage',
      siteId: 'ville-a', domain: 'securite', problem: "Essais sous tension des armoires : quatre monteurs sans habilitation BR à jour (unité de travail atelier montage).",
      verifyDueOn: rel(52), riskLevel: 3, estimatedCost: 2400, createdAt: paris(rel(-38)),
    },
  },
  'A-203': {
    title: "Mettre en conformité l'alimentation électrique de la zone ATEX", origin: 'ev', stepOn: rel(-14),
    row: {
      pilotId: 'clefevre', status: 'p80', priority: 'urgent', dueOn: rel(-24), source: 'evenement', originRef: 'EV-2026-109', eventId: 'EV-2026-109',
      siteId: 'ville-b', domain: 'securite', problem: 'Prise électrique standard installée en zone ATEX 2 : source d’inflammation possible.',
      verifyDueOn: rel(21), riskLevel: 4, estimatedCost: 12000, createdAt: paris(rel(-59)),
    },
  },
  'A-201': {
    title: 'Plan de circulation magasin : miroir et marquage au sol', origin: 'ev', stepOn: rel(-21),
    row: {
      pilotId: 'rfontaine', status: 'p20', priority: 'moyen_terme', dueOn: rel(-13), source: 'evenement', originRef: 'EV-2026-115', eventId: 'EV-2026-115',
      siteId: 'ville-a', domain: 'securite', problem: 'Angle mort au croisement des allées du magasin : piéton surgi devant un chariot élévateur.',
      verifyDueOn: rel(37), riskLevel: 3, estimatedCost: 1800, createdAt: paris(rel(-42)),
    },
  },
  'A-198': {
    title: "Remplacer les luminaires de l'allée centrale usinage", origin: 'ev', stepOn: rel(-25),
    row: {
      pilotId: 'proux', status: 'p40', priority: 'moyen_terme', dueOn: rel(-19), source: 'evenement', originRef: 'EV-2026-117', eventId: 'EV-2026-117',
      siteId: 'ville-a', domain: 'securite', problem: "Trois luminaires hors service dans l'allée centrale de l'usinage : 90 lux mesurés.",
      verifyDueOn: rel(22), riskLevel: 2, estimatedCost: 1250, createdAt: paris(rel(-37)),
    },
  },
  'A-196': {
    title: "Analyse d'écart Règlement 2023/1230 sur les 7 projets concernés", origin: 'watch', stepOn: rel(-24),
    row: {
      pilotId: 'edubois', status: 'initiee', priority: 'moyen_terme', dueOn: rel(52), source: 'veille', originRef: 'Règlement (UE) 2023/1230',
      siteId: 'ville-a', domain: 'securite', problem: 'Le règlement machines (UE) 2023/1230 s’applique aux machines mises sur le marché après le 20/01/2027 : 7 projets livrés après cette date.',
      verifyDueOn: rel(67), createdAt: paris(rel(-38)),
    },
  },
  'A-194': {
    title: 'Contrôle du traitement de surface par lot à la réception', origin: 'ev', stepOn: rel(-8),
    row: {
      pilotId: 'lmoreau', status: 'p60', priority: 'moyen_terme', dueOn: rel(15), source: 'evenement', originRef: 'EV-2026-121', eventId: 'EV-2026-121',
      siteId: 'ville-a', domain: 'qualite', problem: 'Traitement de surface non conforme sur un lot fournisseur, détecté au montage et non à la réception.',
      verifyDueOn: rel(52), createdAt: paris(rel(-27)),
    },
  },
  'A-190': {
    title: "Corriger la fiche de réglage du réducteur RD-7 et former l'équipe", origin: 'ev',
    row: {
      pilotId: 'lmoreau', status: 'terminee', priority: 'moyen_terme', dueOn: rel(-34), doneOn: rel(-19), source: 'evenement', originRef: 'EV-2026-112',
      eventId: 'EV-2026-112', siteId: 'ville-a', domain: 'qualite', problem: 'Jeu axial excessif après montage du réducteur RD-7 : couple de serrage erroné sur la fiche de réglage.',
      verifyDueOn: rel(11), createdAt: paris(rel(-50)),
    },
  },
  'A-188': {
    title: 'Formaliser la revue des exigences client (écart mineur §8.2.3)', origin: 'audit', stepOn: rel(-9),
    row: {
      pilotId: 'edubois', status: 'p80', priority: 'moyen_terme', dueOn: rel(6), source: 'audit_interne', originRef: 'Audit interne juin 2026',
      siteId: 'ville-a', domain: 'qualite', problem: "Revue des exigences client non formalisée pour 2 affaires (écart mineur §8.2.3, audit interne de juin).",
      verifyDueOn: rel(39), createdAt: paris(rel(-38)),
    },
  },
  'A-186': {
    title: 'Remplacer les joints de la presse PC-400 sous garantie', origin: 'client',
    row: {
      pilotId: 'lmoreau', status: 'terminee', priority: 'urgent', dueOn: rel(-9), doneOn: rel(-3), source: 'reclamation_client', originRef: 'EV-2026-128 · [Client C]',
      eventId: 'EV-2026-128', siteId: 'ville-a', domain: 'qualite', problem: 'Fuite sur la presse à cartoucher livrée en juin : joints du vérin principal défectueux (réclamation client).',
      verifyDueOn: rel(21), actualCost: 430, createdAt: paris(rel(-10)),
    },
  },
  'A-184': {
    title: 'Objectifs QHSE 2027 et indicateurs pour la revue de direction', origin: 'rev',
    row: {
      pilotId: 'clefevre', status: 'a_faire', priority: 'long_terme', dueOn: rel(42), source: 'revue_direction', originRef: 'Revue de direction 10/12',
      siteId: 'ville-a', domain: 'qualite', problem: 'La revue de direction du 10/12/2026 doit arrêter les objectifs QHSE 2027 et leurs indicateurs.',
      verifyDueOn: rel(62), createdAt: paris(rel(-38)),
    },
  },
  'A-181': {
    title: "Visite sécurité trimestrielle zone d'essais", origin: 'audit',
    row: {
      pilotId: 'sbenali', status: 'a_faire', priority: 'moyen_terme', dueOn: rel(3), source: 'audit_terrain', originRef: 'Programme 2026',
      siteId: 'ville-b', domain: 'securite', problem: "Visite sécurité trimestrielle de la zone d'essais inscrite au programme 2026.",
      verifyDueOn: rel(21), createdAt: paris(rel(-38)),
    },
  },
  'A-176': {
    title: 'Remplacer le kit absorbant et former au déversement', origin: 'ev',
    row: {
      pilotId: 'rfontaine', status: 'verifiee', priority: 'moyen_terme', dueOn: rel(-9), doneOn: rel(-11), closedOn: rel(-7), source: 'evenement',
      originRef: 'EV-2026-126', eventId: 'EV-2026-126', siteId: 'ville-a', domain: 'environnement',
      problem: "Déversement d'huile sur rétention au magasin : kit absorbant incomplet, consigne de déversement inconnue de l'équipe.",
      verifyDueOn: rel(-7), verifyMethod: 'visuelle', efficacyNote: 'Kit complet au magasin, exercice de déversement réussi par les 3 magasiniers.',
      effective: true, newRisk: true, verifiedById: 'clefevre', riskLevel: 1, hours: 6, estimatedCost: 300, actualCost: 320, createdAt: paris(rel(-15)),
    },
  },
  'A-172': {
    title: 'Arrimer les bouteilles de gaz : râteliers et chaînes', origin: 'ev',
    row: {
      pilotId: 'sbenali', status: 'terminee', priority: 'urgent', dueOn: rel(-9), doneOn: rel(-10), source: 'evenement', originRef: 'EV-2026-124',
      eventId: 'EV-2026-124', siteId: 'ville-a', domain: 'securite', problem: "Bouteilles d'argon stockées debout sans chaîne au poste soudure.",
      verifyDueOn: rel(19), riskLevel: 2, actualCost: 540, createdAt: paris(rel(-20)),
    },
  },
  'A-170': {
    title: "Ranger les bouteilles vides sous l'abri extérieur", origin: 'ev',
    row: {
      pilotId: 'sbenali', status: 'verifiee', priority: 'moyen_terme', dueOn: rel(-14), doneOn: rel(-15), closedOn: rel(-10), source: 'evenement',
      originRef: 'EV-2026-124', eventId: 'EV-2026-124', siteId: 'ville-a', domain: 'securite', problem: "Bouteilles de gaz vides laissées dans l'atelier montage.",
      verifyDueOn: rel(-10), verifyMethod: 'visuelle', efficacyNote: A170_NOTE, effective: false, verifiedById: 'clefevre', riskLevel: 2, hours: 2,
      createdAt: paris(rel(-20)),
    },
  },
  'A-165': {
    title: 'Ajouter un garde-corps sur la plateforme PIRL', origin: 'ev',
    row: {
      pilotId: 'sbenali', status: 'verifiee', priority: 'urgent', dueOn: rel(-14), doneOn: rel(-15), closedOn: rel(-13), source: 'evenement',
      originRef: 'EV-2026-119', eventId: 'EV-2026-119', siteId: 'ville-b', domain: 'securite',
      problem: 'Dernière marche de la plateforme PIRL sans garde-corps ni main courante : risque de chute en descente.',
      verifyDueOn: rel(-13), verifyMethod: 'audit_visite', efficacyNote: 'Garde-corps posé et réceptionné lors de la visite du 26/09.',
      effective: true, verifiedById: 'clefevre', riskLevel: 1, hours: 12, estimatedCost: 1500, actualCost: 1450, createdAt: paris(rel(-31)),
    },
  },
  'A-178': {
    title: 'Afficher les consignes de tri au poste de lavage des pièces', origin: 'env',
    row: {
      pilotId: 'rfontaine', status: 'terminee', priority: 'long_terme', dueOn: rel(-27), doneOn: rel(-28), source: 'dechets', originRef: 'Registre des déchets 2026',
      siteId: 'ville-a', domain: 'environnement', problem: 'Erreurs de tri au poste de lavage des pièces : chiffons souillés mélangés aux déchets non dangereux.',
      verifyDueOn: rel(-7), createdAt: paris(rel(-38)),
    },
  },
  'A-180': {
    title: 'Acheter un second chariot élévateur pour le magasin', origin: 'ev',
    row: {
      pilotId: 'rfontaine', status: 'abandonnee', priority: 'long_terme', dueOn: rel(-4), source: 'evenement', originRef: 'EV-2026-115', eventId: 'EV-2026-115',
      siteId: 'ville-a', domain: 'securite', problem: 'Chariot élévateur unique au magasin : manœuvres répétées au croisement des allées.',
      cancelledAt: paris(rel(-15), '11:00'), cancelledById: 'clefevre',
      cancelReason: 'Doublon de A-201 : le plan de circulation (miroir, marquage) couvre le besoin, validé avec le chef de service.', createdAt: paris(rel(-41)),
    },
  },
  // Action « reprise » (simulée) : site à compléter, ancienne origine conservée (legacy_origin), entrée de reprise au journal.
  'A-150': {
    title: "Mettre à jour le livret d'accueil sécurité (sous-traitants)", origin: 'audit',
    row: {
      pilotId: 'clefevre', status: 'verifiee', priority: 'moyen_terme', dueOn: rel(-86), doneOn: rel(-49), closedOn: rel(-49), source: 'audit_interne',
      originRef: 'Audit interne production · juin 2026', siteId: null, domain: 'securite',
      problem: "Livret d'accueil sécurité des sous-traitants non mis à jour depuis 2023 (audit interne production de juin).",
      verifyDueOn: rel(-50), verifyMethod: 'ecrit', efficacyNote: "Livret remis aux 6 entreprises intervenues en août ; quiz d'accueil réussi par tous.",
      effective: true, verifiedById: 'hmarchand', hours: 8, createdAt: paris(rel(-116)),
    },
  },
  'A-208': {
    title: "Réviser PR-QHSE-002 après le retour d'expérience levage", origin: 'docs', stepOn: rel(-2),
    row: {
      pilotId: 'clefevre', status: 'initiee', priority: 'moyen_terme', dueOn: rel(37), source: 'revue_documentaire', originRef: 'PR-QHSE-002',
      siteId: 'ville-a', domain: 'qualite', problem: 'La procédure PR-QHSE-002 ne tient pas compte du retour d’expérience des opérations de levage.',
      verifyDueOn: rel(67), createdAt: paris(rel(-4)),
    },
  },
  'A-152': {
    title: 'Déployer la remontée des presque-accidents par QR code de poste', origin: 'rev',
    row: {
      pilotId: 'clefevre', status: 'verifiee', priority: 'moyen_terme', dueOn: rel(-192), doneOn: rel(-203), closedOn: rel(-196), source: 'revue_direction',
      originRef: 'Revue de direction 11/12/2025', siteId: 'ville-a', domain: 'securite', problem: 'Presque-accidents trop peu remontés par les ateliers (décision de la revue de direction du 11/12/2025).',
      verifyDueOn: rel(-196), verifyMethod: 'reunion', efficacyNote: 'Remontée des presque-accidents ×2,4 sur 6 mois.', effective: true, verifiedById: 'hmarchand',
      hours: 40, createdAt: paris(rel(-295)),
    },
  },
  'A-158': {
    title: "Étude d'opportunité de la certification ISO 45001", origin: 'rev',
    row: {
      pilotId: 'hmarchand', status: 'verifiee', priority: 'long_terme', dueOn: rel(-101), doneOn: rel(-121), closedOn: rel(-116), source: 'revue_direction',
      originRef: 'Revue de direction 11/12/2025', siteId: 'ville-a', domain: 'securite', problem: "Opportunité d'une certification ISO 45001 à étudier (revue de direction du 11/12/2025).",
      verifyDueOn: rel(-116), verifyMethod: 'reunion', efficacyNote: 'Engagement ISO 45001 décidé pour le second semestre 2027.', effective: true, verifiedById: 'clefevre',
      hours: 24, createdAt: paris(rel(-295)),
    },
  },
  'A-174': {
    title: "Former les chefs d'équipe à l'animation des quarts d'heure sécurité", origin: 'rev', stepOn: rel(-91),
    row: {
      pilotId: 'sbenali', status: 'reportee', priority: 'moyen_terme', initialDueOn: rel(-9), dueOn: rel(67), source: 'revue_direction',
      originRef: 'Revue de direction 18/06/2026', siteId: 'ville-a', domain: 'securite', problem: "Animation sécurité terrain à renforcer (revue de direction intermédiaire du 18/06/2026).",
      verifyDueOn: rel(98), estimatedCost: 3200, createdAt: paris(rel(-106)),
    },
  },
  'A-217': {
    title: 'Régler le fin de course du pont roulant 10 t (réserve VGP)', origin: 'watch',
    row: {
      pilotId: 'sbenali', status: 'a_faire', priority: 'urgent', dueOn: rel(11), source: 'controle_reglementaire', originRef: 'Pont roulant 10 t — atelier montage',
      siteId: 'ville-a', domain: 'securite', problem: 'Réserve de la VGP levage du pont roulant 10 t : fin de course à régler.',
      verifyDueOn: rel(21), riskLevel: 2, createdAt: paris(rel(-189)),
    },
  },
  'A-218': {
    title: 'Relancer la raffinerie pour le certificat de traitement du BSD-20260818-M3QX7TBC', origin: 'env',
    row: {
      pilotId: 'rfontaine', status: 'a_faire', priority: 'moyen_terme', dueOn: rel(11), source: 'dechets', originRef: 'FD-11 · 19/08/2026',
      siteId: 'ville-b', domain: 'environnement', problem: "Certificat de traitement de l'enlèvement du 19/08 non reçu : le bordereau reste ouvert.",
      verifyDueOn: rel(27), createdAt: paris(rel(-2)),
    },
  },
  'A-219': {
    title: "Contrôler l'habilitation ICPE de l'exutoire des fluides de coupe", origin: 'env',
    row: {
      pilotId: 'clefevre', status: 'a_faire', priority: 'long_terme', dueOn: rel(37), source: 'dechets', originRef: 'FD-04',
      siteId: 'ville-a', domain: 'environnement', problem: "Autorisation ICPE de l'exutoire des fluides de coupe (filière FD-04) non vérifiée depuis le changement de prestataire.",
      verifyDueOn: rel(67), createdAt: paris(rel(-2)),
    },
  },
  // Actions de suite (ACT-23) : A-221, A-170 jugée non efficace — l'événement EV-2026-124 est à « Efficacité vérifiée »
  // et refuse toute action (addActionBlocker) : rattachée par sa référence seulement (§ 22.12, échéance du QHSE) ;
  // A-222, nouveau risque de A-176, rattachée à l'événement EV-2026-126 (étape « Actions »).
  'A-221': {
    title: "Agrandir l'abri extérieur des bouteilles et afficher la consigne de retour des vides", origin: null,
    row: {
      pilotId: 'sbenali', status: 'a_faire', priority: 'moyen_terme', dueOn: rel(14), source: 'evenement', originRef: 'EV-2026-124',
      siteId: 'ville-a', domain: 'securite', problem: followUpProblem('A-170', rel(-10), A170_NOTE), verifyDueOn: rel(42), riskLevel: 2,
      followsActionId: 'A-170', followReason: 'non_efficace', createdAt: paris(rel(-10), '17:30'), // vérification de A-170
    },
  },
  'A-222': {
    title: 'Baliser la zone de stockage des absorbants usagés au magasin', origin: null,
    row: {
      pilotId: 'rfontaine', status: 'a_faire', priority: 'long_terme', dueOn: rel(21), source: 'evenement', originRef: 'EV-2026-126', eventId: 'EV-2026-126',
      siteId: 'ville-a', domain: 'environnement', problem: "Absorbants usagés stockés en vrac près de la rétention après l'exercice : risque de mélange avec les déchets non dangereux.",
      verifyDueOn: rel(42), riskLevel: 1, followsActionId: 'A-176', followReason: 'nouveau_risque', createdAt: paris(rel(-7), '17:30'), // vérification de A-176
    },
  },
};

/** Numéros du jeu d'avant 0005 qui ne sont plus des actions QSE (Prévention, Habilitations) : jamais recréés ni complétés. */
export const RETIRED_DEMO_ACTIONS = ['A-206', 'A-207', 'A-216', 'A-220'] as const;

const detailOf = (d: DemoAction) => (d.more ? `${d.title}\n${d.more}` : d.title);
/** Ligne insérée d'une action du jeu neuf. */
export function demoActionRow(id: string): ActionSeed {
  const d = DEMO_ACTIONS[id];
  const { initialDueOn, ...row } = d.row;
  return {
    ...row, id, detail: detailOf(d), openedOn: parisDay(row.createdAt), initialDueOn: initialDueOn ?? row.dueOn,
    legacyOrigin: id === 'A-150' ? 'audit' : null,
  };
}

// ─── Fil de commentaires, preuves, notifications ────────────────────────────

type CommentSeed = {
  /** authorRole : rôle Vigie de l'auteur à l'écriture (null : aucun rôle de démonstration, comme [L. Moreau], [J. Petit]). */
  actionId: string; authorId: string; authorRole: Role | null; at: Date; body: string;
  withdrawn?: { at: Date; byId: string; reason: string };
  /** Preuve jointe au commentaire (fichier écrit seulement avec `files`). */
  file?: string;
  /** Notification ACT-31 laissée non lue (les autres : lues le lendemain matin). */
  unread?: boolean;
};
const COMMENTS: CommentSeed[] = [
  { actionId: 'A-214', authorId: 'sbenali', authorRole: 'Chef de service', at: paris(rel(-4), '16:20'), body: 'Commande des élingues à œillets passée, livraison prévue le 14/10.' },
  { actionId: 'A-214', authorId: 'clefevre', authorRole: 'Animateur QHSE', at: paris(rel(-2), '10:05'), body: "Prévoir l'étiquetage CMU à la réception et retirer les élingues textiles du poste M3 le jour même." },
  {
    actionId: 'A-215', authorId: 'tnguyen', authorRole: 'Salarié', at: paris(rel(-3), '09:12'), file: 'mode-operatoire-retournement-v0.pdf', unread: true,
    body: "Premier jet du mode opératoire joint : points d'élingage et angle de basculement pour les bâtis de la série 400.",
  },
  { actionId: 'A-215', authorId: 'clefevre', authorRole: 'Animateur QHSE', at: paris(rel(-2), '14:30'), body: 'Merci. À compléter avec le périmètre de basculement et la vérification du pont avant chaque manœuvre.' },
  { actionId: 'A-190', authorId: 'lmoreau', authorRole: null, at: paris(rel(-19), '15:45'), body: "Fiche de réglage corrigée (indice C) et équipe formée le 18/09 : feuille d'émargement jointe aux preuves." },
  { actionId: 'A-174', authorId: 'clefevre', authorRole: 'Animateur QHSE', at: paris(rel(-11), '11:00'), body: 'Formation reportée au 15/12 : organisme indisponible avant novembre, sessions réservées.' },
  { actionId: 'A-209', authorId: 'jpetit', authorRole: null, at: paris(rel(-4), '17:10'), body: 'Flexible remplacé le 05/10 ; contrôle des 11 autres flexibles du banc en cours.' },
  // Commentaire retiré (D23) : texte conservé en base, jamais renvoyé ; sa preuve n'est plus lisible que du QHSE.
  {
    actionId: 'A-209', authorId: 'jpetit', authorRole: null, at: paris(rel(-3), '08:40'), file: 'releve-flexibles-be2.pdf',
    body: 'Relevé des flexibles joint.', withdrawn: { at: paris(rel(-3), '09:05'), byId: 'jpetit', reason: 'Relevé du banc BE-2 joint par erreur : le relevé du BE-1 suivra.' },
  },
];
/** Preuves sans commentaire (fichiers écrits seulement avec `files`). */
const PROOFS: { actionId: string; uploadedBy: string; uploaderRole: Role | null; fileName: string; at: Date }[] = [
  { actionId: 'A-214', uploadedBy: 'sbenali', uploaderRole: 'Chef de service', fileName: 'bon-de-commande-elingues.pdf', at: paris(rel(-4), '16:25') },
  { actionId: 'A-190', uploadedBy: 'lmoreau', uploaderRole: null, fileName: 'emargement-formation-rd7.pdf', at: paris(rel(-19), '15:50') },
];

/** PDF d'une page (texte ASCII) : preuve de démonstration lisible par un navigateur. */
export function demoPdf(text: string): string {
  const safe = text.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '');
  const stream = `BT /F1 14 Tf 72 760 Td (${safe}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
const demoFile = (name: string, actionId: string) => new File([demoPdf(`Vigie - preuve de demonstration - ${actionId} - ${name}`)], name, { type: 'application/pdf' });

type NotificationSeed = typeof t.notifications.$inferInsert;
/** Notification lue le lendemain matin (08:30, Paris). */
const readNextMorning = (at: Date) => paris(addDays(parisDay(at), 1), '08:30');
/** Écrit par le responsable de l'action, hors QHSE : notifié à chaque animateur QHSE (ACT-31, réponse du 15/10/2026). */
const byResponsible = (actionId: string, authorId: string, role: Role | null) => DEMO_ACTIONS[actionId].row.pilotId === authorId && !(role && isQhse(role));

/**
 * Notifications de la cloche (ACT-30, ACT-31), datées dans le jeu (jamais après le 09/10/2026) : « Action confiée » des
 * actions créées après 0005 par l'animatrice QHSE pour un autre responsable (A-215, A-221, A-222) ; commentaire ou preuve
 * d'un responsable hors QHSE, une notification par commentaire ou par preuve et par animateur QHSE (preuves : seulement
 * avec `files`, comme leurs fichiers) ; la notification d'un commentaire retiré a le titre sans extrait (D23).
 */
async function notificationRows(tx: SeedTx, names: Map<string, string>, commentIds: Map<CommentSeed, number>, files: boolean): Promise<NotificationSeed[]> {
  const animators = (await tx.select({ id: t.people.id, leftOn: t.people.leftOn }).from(t.people)
    .where(eq(t.people.lastRole, 'Animateur QHSE')).orderBy(asc(t.people.sort)))
    .filter((p) => !p.leftOn || p.leftOn > DEMO_DAY).map((p) => p.id);
  const base = (actionId: string, byId: string, at: Date, readAt: Date | null) => ({
    entityType: 'action', entityId: actionId, href: actionHref(actionId), byId, createdAt: at, readAt,
  });
  const confiee = (id: string, readAt: Date | null): NotificationSeed => {
    const d = DEMO_ACTIONS[id];
    return {
      ...base(id, 'clefevre', id === 'A-215' ? paris(rel(-6), '10:00') : d.row.createdAt, readAt),
      personId: d.row.pilotId, type: 'action_confiee', title: `Action ${id} confiée par ${names.get('clefevre')} : ${actionLabel(detailOf(d))}`,
    };
  };
  const rows: NotificationSeed[] = [confiee('A-215', null), confiee('A-221', null), confiee('A-222', readNextMorning(DEMO_ACTIONS['A-222'].row.createdAt))];
  for (const c of COMMENTS) {
    if (!byResponsible(c.actionId, c.authorId, c.authorRole)) continue;
    const author = names.get(c.authorId)!;
    const title = c.withdrawn ? demoCommentWithdrawnTitle(c.actionId, author) : demoCommentTitle(c.actionId, author, c.body, c.file && files ? [c.file] : []);
    for (const personId of animators.filter((id) => id !== c.authorId)) {
      rows.push({ ...base(c.actionId, c.authorId, c.at, c.unread ? null : readNextMorning(c.at)), personId, type: 'action_commentaire', title, commentId: commentIds.get(c) });
    }
  }
  if (files) {
    for (const p of PROOFS) {
      if (!byResponsible(p.actionId, p.uploadedBy, p.uploaderRole)) continue;
      const title = `${p.actionId} : preuve « ${p.fileName} » ajoutée par ${names.get(p.uploadedBy)}`; // = actionProofTitle
      for (const personId of animators.filter((id) => id !== p.uploadedBy)) {
        rows.push({ ...base(p.actionId, p.uploadedBy, p.at, readNextMorning(p.at)), personId, type: 'action_preuve', title });
      }
    }
  }
  return rows.sort((x, y) => (x.createdAt as Date).getTime() - (y.createdAt as Date).getTime());
}
/** Même libellé que actionCommentTitle (src/server/notify.ts, que le jeu n'importe pas) ; égalité vérifiée par seed-actions. */
function demoCommentTitle(id: string, author: string, body: string, files: string[]) {
  const line = body.replace(/\s+/g, ' ').trim();
  const excerpt = line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
  return `${id} : commentaire de ${author} — ${excerpt}${files.length ? ` · ${files.length > 1 ? 'preuves' : 'preuve'} ${files.map((f) => `« ${f} »`).join(', ')}` : ''}`;
}
/** Même libellé que actionCommentWithdrawnTitle (src/server/notify.ts). */
const demoCommentWithdrawnTitle = (id: string, author: string) => `${id} : commentaire de ${author} — (commentaire retiré)`;

// ─── Journal ────────────────────────────────────────────────────────────────

type LogSeed = typeof t.changeLog.$inferInsert;
/** Détail d'une entrée (même forme que ChangeDetail de src/server/changelog.ts, que le jeu n'importe pas). */
type DetailSeed = { field: string; from: string | null; to: string | null; fromKey?: string | null; toKey?: string | null };
const av = (from: Avancement, to: Avancement): DetailSeed => ({ field: 'Avancement', from: AVANCEMENT[from].label, to: AVANCEMENT[to].label, fromKey: from, toKey: to });
const status = (
  id: string, kind: TransitionKind, from: Avancement, to: Avancement, at: Date, byId: string,
  extra: Omit<Partial<LogSeed>, 'details'> & { details?: DetailSeed[]; doneOn?: string; effective?: boolean } = {},
): LogSeed => {
  const { doneOn, effective, details = [], ...rest } = extra;
  return {
    entityType: 'action', entityId: id, action: 'status', summary: transitionSummary(kind, from, to, { doneOn, effective }), byId, at,
    details: [av(from, to), ...details], ...rest,
  };
};

/** Journal du jeu neuf : création, avancements (détail structuré D11), vérifications, report, abandon, fil, preuves, reprise. */
function journalRows(names: Map<string, string>, files: boolean): LogSeed[] {
  const rows: LogSeed[] = [];
  const name = (id: string | null | undefined) => (id ? names.get(id) ?? id : null);
  for (const [id, d] of Object.entries(DEMO_ACTIONS)) {
    const a = demoActionRow(id);
    const created = d.row.createdAt;
    if (id === 'A-150') {
      // Action reprise (simulée) : entrée de la migration 0005 (by_id vide), puis complément par le QHSE ; site à compléter.
      rows.push({
        entityType: 'action', entityId: id, action: 'reprise', summary: 'Reprise du modèle Power Apps', byId: null, at: paris(rel(-8), '06:00'),
        details: [
          { field: 'Avancement', from: 'Clôturée', to: AVANCEMENT.verifiee.label, fromKey: 'done', toKey: 'verifiee' },
          { field: 'Nature', from: 'Corrective', to: null, fromKey: 'C' },
          { field: 'Origine', from: LEGACY_ORIGIN_LABELS.audit, to: null, fromKey: 'audit' },
          { field: 'Source', from: null, to: ACTION_SOURCES.audit_interne.label, toKey: 'audit_interne' },
          { field: 'Intitulé', from: d.title, to: null },
          { field: 'Détail de l\'action', from: null, to: 'Intitulé et précisions fusionnés' },
          { field: 'Date d\'ouverture', from: null, to: fmtDate(a.openedOn) },
          { field: 'Date cible initiale', from: null, to: fmtDate(a.initialDueOn) },
          { field: 'Date effective', from: null, to: fmtDate(a.doneOn!) },
          { field: 'Résultat', from: null, to: 'Efficace' },
        ],
      }, {
        entityType: 'action', entityId: id, action: 'update', summary: 'Action complétée après la reprise', byId: 'clefevre', at: paris(rel(-7), '09:30'),
        details: [
          { field: 'Description du problème', from: null, to: '(texte saisi)' },
          { field: 'Domaine', from: null, to: ACTION_DOMAINS[a.domain!] },
          { field: 'Priorité', from: null, to: ACTION_PRIORITIES[a.priority!].label },
          { field: 'Nature de la vérification', from: null, to: VERIFY_METHODS[a.verifyMethod!] },
        ],
      });
      continue;
    }
    rows.push({
      entityType: 'action', entityId: id, action: 'create', summary: 'Action créée', byId: 'clefevre', at: created,
      details: [
        { field: 'Source', from: null, to: ACTION_SOURCES[a.source!].label },
        { field: 'Responsable', from: null, to: name(a.pilotId) },
        { field: 'Date cible', from: null, to: fmtDate(a.initialDueOn) },
        ...(a.followsActionId ? [{ field: 'Action précédente', from: null, to: `${a.followsActionId} (${FOLLOW_REASONS[a.followReason!].toLowerCase()})` }] : []),
      ],
    });
    const s = a.status as Avancement;
    if (d.stepOn && s !== 'reportee') rows.push(status(id, 'step', 'a_faire', s, paris(d.stepOn, '09:00'), 'clefevre'));
    if (s === 'reportee') {
      rows.push(status(id, 'step', 'a_faire', 'initiee', paris(d.stepOn!, '09:00'), 'clefevre'));
      const reason = COMMENTS.find((c) => c.actionId === id)!.body;
      rows.push(status(id, 'report', 'initiee', 'reportee', paris(rel(-11), '11:00'), 'clefevre', {
        reason, details: [{ field: 'Date cible', from: fmtDate(a.initialDueOn), to: fmtDate(a.dueOn) }],
      }));
    }
    if (s === 'terminee' || s === 'verifiee') {
      rows.push(status(id, 'finish', 'a_faire', 'terminee', paris(a.doneOn!, '17:00'), 'clefevre', {
        doneOn: a.doneOn!, details: [{ field: 'Date effective', from: null, to: fmtDate(a.doneOn!) }],
      }));
    }
    if (s === 'verifiee') {
      rows.push(status(id, 'verify', 'terminee', 'verifiee', paris(a.closedOn!, '17:30'), a.verifiedById!, {
        effective: a.effective!,
        details: [
          { field: 'Date de vérification', from: null, to: fmtDate(a.closedOn!) },
          { field: 'Nature de la vérification', from: null, to: VERIFY_METHODS[a.verifyMethod!] },
          { field: 'Résultat', from: null, to: a.effective ? 'Efficace' : 'Non efficace' },
          ...(a.newRisk ? [{ field: 'Nouveau risque généré', from: null, to: 'Oui' }] : []),
        ],
      }));
    }
    if (s === 'abandonnee') {
      rows.push(status(id, 'abandon', 'a_faire', 'abandonnee', a.cancelledAt as Date, a.cancelledById!, { reason: a.cancelReason }));
    }
  }
  // Actions de suite créées à la vérification (ACT-23), notées sur l'action vérifiée.
  for (const [id, d] of Object.entries(DEMO_ACTIONS)) {
    if (!d.row.followsActionId) continue;
    rows.push({
      entityType: 'action', entityId: d.row.followsActionId, action: 'follow_up', byId: 'clefevre', at: d.row.createdAt,
      summary: `Action de suite ${id} créée (${FOLLOW_REASONS[d.row.followReason!].toLowerCase()})`,
    });
  }
  for (const c of COMMENTS) {
    rows.push({ entityType: 'action', entityId: c.actionId, action: 'comment', summary: 'Commentaire ajouté', byId: c.authorId, at: c.at });
    if (c.file && files) {
      rows.push({ entityType: 'action', entityId: c.actionId, action: 'attach', summary: '1 preuve ajoutée', byId: c.authorId, at: c.at, details: [{ field: 'Fichier', from: null, to: c.file }] });
    }
    if (c.withdrawn) {
      rows.push({ entityType: 'action', entityId: c.actionId, action: 'comment_withdraw', summary: 'Commentaire retiré', reason: c.withdrawn.reason, byId: c.withdrawn.byId, at: c.withdrawn.at });
    }
  }
  if (files) {
    for (const p of PROOFS) {
      rows.push({ entityType: 'action', entityId: p.actionId, action: 'attach', summary: '1 preuve ajoutée', byId: p.uploadedBy, at: p.at, details: [{ field: 'Fichier', from: null, to: p.fileName }] });
    }
  }
  return rows.sort((x, y) => (x.at as Date).getTime() - (y.at as Date).getTime());
}

// ─── Chargement ─────────────────────────────────────────────────────────────

/**
 * Actions du jeu neuf, dans la transaction du jeu (après les personnes et les événements ; les revues, documents et
 * déchets les rattachent ensuite, src/db/seed.ts) : lignes, fil, journal, notifications, compteur (222) et, avec
 * `files`, les preuves (fichiers écrits dans VIGIE_UPLOAD_DIR ; un fichier écrit reste si la transaction est annulée).
 */
export async function seedActions(tx: SeedTx, opts: { files?: boolean } = {}) {
  const files = !!opts.files;
  const ids = Object.keys(DEMO_ACTIONS);
  // Actions de suite après leur action précédente (clé étrangère follows_action_id).
  await tx.insert(t.actions).values(ids.filter((id) => !DEMO_ACTIONS[id].row.followsActionId).map(demoActionRow));
  await tx.insert(t.actions).values(ids.filter((id) => DEMO_ACTIONS[id].row.followsActionId).map(demoActionRow));
  const names = new Map((await tx.select({ id: t.people.id, name: t.people.name }).from(t.people)).map((p) => [p.id, p.name]));

  const saveUpload = files ? (await import('../../lib/uploads')).saveUpload : null;
  const commentIds = new Map<CommentSeed, number>();
  for (const c of COMMENTS) {
    const [row] = await tx.insert(t.actionComments).values({
      actionId: c.actionId, authorId: c.authorId, authorRole: c.authorRole, body: c.body, createdAt: c.at,
      ...(c.withdrawn ? { withdrawnAt: c.withdrawn.at, withdrawnById: c.withdrawn.byId, withdrawReason: c.withdrawn.reason } : {}),
    }).returning({ id: t.actionComments.id });
    commentIds.set(c, row.id);
    if (c.file && saveUpload) {
      const a = await saveUpload(demoFile(c.file, c.actionId), 'action', c.actionId, c.authorId, { db: tx, commentId: row.id, quota: false });
      await tx.update(t.attachments).set({ createdAt: c.at }).where(eq(t.attachments.id, a.id));
    }
  }
  if (saveUpload) {
    for (const p of PROOFS) {
      const a = await saveUpload(demoFile(p.fileName, p.actionId), 'action', p.actionId, p.uploadedBy, { db: tx, quota: false });
      await tx.update(t.attachments).set({ createdAt: p.at }).where(eq(t.attachments.id, a.id));
    }
  }
  await tx.insert(t.changeLog).values(journalRows(names, files));
  await tx.insert(t.notifications).values(await notificationRows(tx, names, commentIds, files));
  // Compteur (ACT-35) : au-delà du plus grand numéro du jeu, numéros retirés compris (jamais réattribués).
  const last = Math.max(...[...ids, ...RETIRED_DEMO_ACTIONS].map((id) => parseActionNumber(id) ?? 0));
  await tx.insert(t.actionCounters).values({ scope: ACTION_NUMBER_SCOPE, last })
    .onConflictDoUpdate({ target: t.actionCounters.scope, set: { last: sql`greatest(${t.actionCounters.last}, excluded.last)` } });
}

// ─── Mise à niveau d'une base de démonstration d'avant 0005 ─────────────────

/** Champs que la mise à niveau complète quand ils sont vides (jamais l'avancement, les dates, les liens ni la vérification). */
const UPGRADE_FIELDS = ['problem', 'domain', 'priority', 'riskLevel', 'estimatedCost', 'actualCost', 'hours', 'siteId', 'source'] as const;

/**
 * Base de démonstration remplie avant la migration 0005 (appelée par upgradeDemo, après la reprise des liens) : la
 * reprise y laisse « à compléter » la description du problème, le domaine, la priorité, la vérification planifiée… Une
 * seule fois, pour le jeu de démonstration seulement (fiche de l'animatrice QHSE et action A-214 présentes), et seulement
 * pour une action restée telle que le jeu l'avait créée (ancienne origine et détail identiques à l'intitulé d'origine)
 * et jamais complétée : description du problème vide — le jeu la définit pour chaque action et toute modification
 * l'exige (§ 18), elle n'est donc vide qu'avant la première mise à niveau ; un champ facultatif vidé ensuite par le QHSE
 * n'est jamais rempli de nouveau. Complète, là où ils sont vides, les champs que le jeu neuf définit
 * (problème, domaine, priorité, vérification planifiée sauf Abandonnée, nature de la vérification d'une Vérifiée,
 * niveau de risque, coûts, pointage, site, source). Jamais l'avancement, les dates, les liens ni le résultat de
 * vérification ; aucun journal (comme upgradeDemoAccidents). A-206, A-207, A-216, A-220 (plus des actions QSE) restent
 * telles que la reprise les a laissées (source à compléter). Écarts restants avec un jeu neuf (documentés, vérifiés par
 * test/integration/migration-0005.test.ts) : ni fil, ni preuves, ni notifications, ni actions de suite A-221/A-222 ;
 * avancements repris (initiee au lieu de 20 % à 80 %, A-174 non reportée) ; dates d'avant (A-170, A-176, D24 ; dates
 * effectives des Terminées sans journal) ; constats et résultats de vérification d'avant ; compteur à 220.
 */
export async function upgradeDemoActions(db: Db) {
  const [[lead], [marker]] = await Promise.all([
    db.select({ n: count() }).from(t.people).where(eq(t.people.id, 'clefevre')),
    db.select({ n: count() }).from(t.actions).where(eq(t.actions.id, 'A-214')),
  ]);
  if (lead.n === 0 || marker.n === 0) return;
  const legacyIds = Object.keys(DEMO_ACTIONS).filter((id) => DEMO_ACTIONS[id].origin);
  const rows = await db.select().from(t.actions).where(inArray(t.actions.id, legacyIds));
  const updates: [string, Partial<ActionSeed>][] = [];
  for (const r of rows) {
    const d = DEMO_ACTIONS[r.id];
    if (r.problem !== null || r.legacyOrigin !== d.origin || r.detail !== d.title) continue;
    const fresh = demoActionRow(r.id);
    const set: Partial<ActionSeed> = {};
    for (const k of UPGRADE_FIELDS) if (r[k] == null && fresh[k] != null) Object.assign(set, { [k]: fresh[k] });
    if (r.status !== 'abandonnee' && r.verifyDueOn == null && fresh.verifyDueOn) set.verifyDueOn = fresh.verifyDueOn;
    if (r.status === 'verifiee' && r.verifyMethod == null && fresh.verifyMethod) set.verifyMethod = fresh.verifyMethod;
    if (Object.keys(set).length) updates.push([r.id, set]);
  }
  if (!updates.length) return;
  await db.transaction(async (tx) => {
    // Même garde dans l'écriture : une modification faite entre la lecture et la mise à niveau l'emporte.
    for (const [id, set] of updates) await tx.update(t.actions).set(set).where(and(eq(t.actions.id, id), isNull(t.actions.problem)));
  });
}
