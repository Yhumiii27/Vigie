// Aide en ligne (UX-16) : aide contextuelle de chaque écran et glossaire des indicateurs — contenu statique en français,
// versionné dans le dépôt, sans service ni dépendance externe. Module pur (aucun import serveur) : lu par la fenêtre
// d'aide de la barre latérale (src/components/HelpDialog.tsx). Toute nouvelle page d'un écran reprend l'aide de l'écran
// (helpScreenOf : chemin le plus long de SCREENS) ; un nouvel écran ajoute son entrée ici (src/lib/help.test.ts vérifie que chaque écran de la navigation
// en a une).

import { SCREENS, type ScreenKey } from './domain';

export type HelpTopic = {
  /** Ce que l'écran permet, en une phrase. */
  intro: string;
  /** Repères d'utilisation (une idée par puce). */
  tips: readonly string[];
};

export const SCREEN_HELP: Partial<Record<ScreenKey, HelpTopic>> = {
  dashboard: {
    intro: 'Vue d’ensemble du site sélectionné : indicateurs de sécurité, échéances à traiter et activité récente.',
    tips: [
      'Chaque carte ouvre la liste filtrée correspondante (événements, actions, contrôles…).',
      'Le TF1 et le TG sont calculés sur les 12 derniers mois complets ; un mois sans heures travaillées est signalé.',
      'Le sélecteur de site, en haut de la barre latérale, change le périmètre de tous les écrans.',
    ],
  },
  todo: {
    intro: 'Échéances qui vous concernent : retards d’abord, puis ce qui arrive dans les 15 prochains jours.',
    tips: [
      'Ouvrir une échéance la marque comme lue et sélectionne son site.',
      'Les échéances calculées disparaissent d’elles-mêmes quand la situation est réglée (action vérifiée, contrôle réalisé…).',
    ],
  },
  events: {
    intro: 'Déclaration et suivi des événements : accidents, presque-accidents, situations dangereuses, non-conformités, réclamations, événements environnementaux.',
    tips: [
      'Un événement suit les étapes Déclaré → Qualifié → Analysé → Actions → Clos ; « Classer sans suite » demande un motif.',
      'Les filtres (étape, pilote, période, gravité, ancienneté) sont gardés dans l’adresse de la page : un lien partagé montre la même liste.',
      '« Signaler un événement » depuis un contrôle, un risque, un document, un plan de prévention ou l’environnement ouvre le formulaire prérempli.',
      'Les données de santé d’un accident du travail ne sont visibles que de l’animation QHSE et de la direction.',
    ],
  },
  actions: {
    intro: 'Plan d’actions unique : toutes les actions correctives, préventives et d’amélioration, quelle que soit leur origine.',
    tips: [
      'Le service QHSE crée, modifie et fait avancer les actions ; le responsable commente et joint ses preuves.',
      'Une action « Terminée » est ensuite vérifiée (efficacité) ; « Rouvrir » et « Abandonner » demandent un motif.',
      'Les vues Liste, Kanban et Statistiques sont accessibles par les onglets ; les filtres restent dans l’adresse.',
    ],
  },
  prevention: {
    intro: 'Plans de prévention des entreprises extérieures (R. 4512-6 et suivants), permis de feu et d’essai, carte de coactivité.',
    tips: [
      'Filtrez les plans et les permis par phase, entreprise extérieure ou projet Keystone.',
      'Le nom de l’entreprise, dans la fiche d’un plan ou d’un permis, ouvre la fiche de l’entreprise.',
      'Un plan écrit est obligatoire dès 400 h de travaux sur 12 mois ou pour des travaux dangereux (dès la première minute sur un site Seveso).',
    ],
  },
  risks: {
    intro: 'Document unique d’évaluation des risques professionnels (DUERP), par unité de travail.',
    tips: [
      'Cotation gravité (1–4) × probabilité (1–4) ; à partir de 8, une action de réduction est obligatoire.',
      'Une case de la matrice filtre le tableau des risques sur cette cotation ; un second clic retire le filtre.',
      'Le champ « Danger » propose les familles usuelles de l’INRS ; un autre libellé reste possible.',
      'Sous « Tous les sites », le site est indiqué sous le nom de chaque unité.',
    ],
  },
  skills: {
    intro: 'Matrice salariés × titres suivis (habilitations, CACES, formations), avec échéances de recyclage.',
    tips: [
      'Filtrez par service, par titre suivi ou sur les salariés « À traiter » ; la colonne des salariés reste visible en faisant défiler.',
      'Une case ouvre la formation en cours, ses attestations et son historique.',
      'L’ordre des colonnes se règle dans « Titres suivis » (service QHSE et direction).',
    ],
  },
  watch: {
    intro: 'Veille réglementaire (exigences et conformité), contrôles périodiques des équipements et registre de sécurité.',
    tips: [
      'Recherchez une exigence, filtrez par évaluation, domaine ou pilote, et triez par échéance.',
      'Un contrôle se filtre par responsable et se trie par prochaine échéance (prochain contrôle = dernier + périodicité).',
      'Une évaluation « Écart » appelle une action dans le plan d’actions unique.',
    ],
  },
  audits: {
    intro: 'Programme annuel d’audits, constats, certifications, objectifs QHSE, contexte, changements et revue de direction.',
    tips: [
      'La liste des constats se filtre par nature ; les audits réalisés sans constat y figurent aussi.',
      'Un lien vers un référentiel (échéance de certification) ouvre directement sa fiche.',
      'Le dossier de revue se consulte aussi sur téléphone : les tableaux défilent horizontalement.',
    ],
  },
  contributions: {
    intro: 'Vos contributions attendues pour la revue de direction : participations, éléments à préparer et décisions qui vous sont confiées.',
    tips: ['Les échéances de la revue vous mènent ici quand l’écran Audits ne vous est pas ouvert en saisie.'],
  },
  docs: {
    intro: 'Documents maîtrisés : procédures, modes opératoires, enregistrements, avec versions, approbation et revue périodique.',
    tips: [
      'Une nouvelle version suit le circuit de validation ; « Revue sans modification » prolonge la validité.',
      'Les événements liés au document et « Signaler un événement » figurent dans sa fiche.',
    ],
  },
  env: {
    intro: 'Environnement : registre des déchets, filières, bordereaux (BSD), consommations et événements environnementaux.',
    tips: [
      '« Signaler » ouvre un nouvel événement de type Environnement (déversement, fuite, rejet…).',
      'Chaque enlèvement porte sa filière, sa quantité et son bordereau ; les manques sont signalés dans les échéances.',
    ],
  },
  mobile: {
    intro: 'Aperçu du parcours terrain (démonstration) : signalement en quelques étapes et suivi de « Mes signalements ».',
    tips: ['Sur téléphone, le même parcours est accessible par « Nouveau signalement ».'],
  },
};

/** Glossaire des indicateurs et sigles employés dans Vigie. */
export const GLOSSARY: readonly { term: string; definition: string }[] = [
  { term: 'TF1', definition: 'Taux de fréquence : nombre d’accidents du travail avec arrêt × 1 000 000 / heures travaillées, sur les 12 derniers mois complets (accidents de trajet exclus).' },
  { term: 'TG', definition: 'Taux de gravité : nombre de jours d’arrêt × 1 000 / heures travaillées, sur la même période.' },
  { term: 'AT', definition: 'Accident du travail : déclaration à la CPAM sous 48 h (dimanches et jours fériés non compris) ; par l’entreprise de travail temporaire pour un intérimaire.' },
  { term: 'MP', definition: 'Maladie professionnelle : dossier réservé à l’animation QHSE et à la direction (données de santé).' },
  { term: 'DUERP', definition: 'Document unique d’évaluation des risques professionnels (R. 4121-1), mis à jour au moins chaque année.' },
  { term: 'G × P', definition: 'Cotation d’un risque : gravité (1 à 4) multipliée par la probabilité (1 à 4) ; brute avant mesures, résiduelle après.' },
  { term: 'PP', definition: 'Plan de prévention : document établi avec une entreprise extérieure après l’inspection commune préalable (R. 4512-6).' },
  { term: 'Pyramide de Bird', definition: 'Répartition des événements par gravité (accidents graves, avec arrêt, sans arrêt, presque-accidents, situations dangereuses).' },
  { term: 'BSD', definition: 'Bordereau de suivi des déchets dangereux, émis pour chaque enlèvement (Trackdéchets).' },
  { term: 'NC', definition: 'Non-conformité : produit, service ou processus qui ne satisfait pas une exigence ; suivie comme un événement.' },
  { term: 'Écart majeur / mineur', definition: 'Constats d’audit appelant une réponse (plan d’actions) dans le délai fixé ; une observation ou une piste de progrès appelle une action facultative.' },
  { term: 'Revue de direction', definition: 'Revue périodique du système de management (ISO 9001, 14001, 45001 § 9.3) ; dossier figé au visa de la direction.' },
  { term: 'SST', definition: 'Sauveteur secouriste du travail : titulaires en cours de validité proposés comme donneurs de soins du registre des accidents bénins.' },
];

/**
 * Écran dont relève une page (aide contextuelle) : chemin d'écran (SCREENS) le plus long qui la contient — sous-pages
 * comprises (/prevention/carte, /audits/contributions…) ; la revue de direction relève de l'écran Audits.
 */
export function helpScreenOf(pathname: string): ScreenKey | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p === '/revue-de-direction' || p.startsWith('/revue-de-direction/')) return 'audits';
  const keys = (Object.keys(SCREENS) as ScreenKey[])
    .filter((k) => (SCREENS[k].path === '/' ? p === '/' : p === SCREENS[k].path || p.startsWith(`${SCREENS[k].path}/`)))
    .sort((a, b) => SCREENS[b].path.length - SCREENS[a].path.length);
  return keys[0] ?? null;
}
