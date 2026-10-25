// Référentiels métier partagés (serveur et client).

import { ACTION_AVANCEMENTS, OPEN_AVANCEMENTS, type ActionDomain, type ActionPriority, type Avancement, type FollowReason, type SourceKey, type VerifyMethod } from './action-keys';

export type Tone = 'danger' | 'warn' | 'ok' | 'neutral' | 'accent';

// Couleurs de statut : variables définies dans vigie.css.
export const TONE = {
  danger: { fg: 'var(--tone-danger-fg)', bg: 'var(--tone-danger-bg)', dot: 'var(--tone-danger-dot)' },
  warn: { fg: 'var(--tone-warn-fg)', bg: 'var(--tone-warn-bg)', dot: 'var(--tone-warn-dot)' },
  ok: { fg: 'var(--tone-ok-fg)', bg: 'var(--tone-ok-bg)', dot: 'var(--tone-ok-dot)' },
  neutral: { fg: 'var(--color-neutral-100)', bg: 'var(--color-neutral-800)', dot: 'var(--color-neutral-500)' },
  accent: { fg: 'var(--color-accent-100)', bg: 'var(--color-accent-800)', dot: 'var(--color-accent)' },
} as const satisfies Record<Tone, { fg: string; bg: string; dot: string }>;

export type EventType = 'AT' | 'PA' | 'SD' | 'NC' | 'RC' | 'ENV' | 'MP';

export const EVENT_TYPES: Record<EventType, { label: string; tone: Tone; icon: string }> = {
  AT: { label: 'Accident', tone: 'danger', icon: 'ph-first-aid' },
  PA: { label: 'Presque-accident', tone: 'warn', icon: 'ph-warning' },
  SD: { label: 'Situation dangereuse', tone: 'warn', icon: 'ph-warning-octagon' },
  NC: { label: 'Non-conformité', tone: 'accent', icon: 'ph-x-square' },
  RC: { label: 'Réclamation client', tone: 'accent', icon: 'ph-chat-centered-text' },
  ENV: { label: 'Environnement', tone: 'neutral', icon: 'ph-leaf' },
  // EVT-09 : maladie professionnelle (déclarée par la victime à la CPAM, L. 461-5 CSS) — donnée de santé : type réservé aux
  // rôles canSeeHealth (canSeeEventType), jamais signalé depuis le terrain.
  MP: { label: 'Maladie professionnelle', tone: 'danger', icon: 'ph-stethoscope' },
};
export const EVENT_TYPE_KEYS = Object.keys(EVENT_TYPES) as EventType[];
/** Types d'événement réservés aux rôles habilités aux données de santé (EVT-09) : listes, fiche, échéances, server actions. */
export const HEALTH_EVENT_TYPES: readonly EventType[] = ['MP'];
/** Le rôle peut-il voir un événement de ce type (maladie professionnelle : canSeeHealth) ? */
export const canSeeEventType = (role: Role, type: string) => !(HEALTH_EVENT_TYPES as readonly string[]).includes(type) || canSeeHealth(role);
/** Types proposés au signalement terrain (/signaler, createReport) : ni maladie professionnelle (déclarée par la victime). */
export const REPORT_TYPE_KEYS = EVENT_TYPE_KEYS.filter((k) => !(HEALTH_EVENT_TYPES as readonly string[]).includes(k));
/** Questionnaire de la caisse à l'employeur (maladie professionnelle, R. 461-9 CSS) : retour sous 30 jours francs. */
export const MP_QUESTIONNAIRE_DAYS = 30;

export const EVENT_STEPS = ['Déclaré', 'Qualifié', 'Analyse des causes', 'Actions', 'Efficacité vérifiée', 'Clôturé'] as const;
export const STEP_QUALIFIED = 1; // l'étape « Qualifié » exige un pilote désigné
export const STEP_ACTIONS = 3; // l'étape « Actions » exige au moins une action liée
export const STEP_CLOSED = EVENT_STEPS.length - 1;
/** Statut affiché d'un événement classé sans suite (remplace l'étape dans les listes). */
export const EVENT_DISMISSED = 'Classé sans suite';
/** Délais suivis par les échéances (jours calendaires). */
export const QUALIFY_DELAY_DAYS = 2; // qualification sous 48 h après la déclaration
/** Accident du travail (code de la sécurité sociale) : déclaration CPAM 48 h après la connaissance de l'accident, dimanches
 * et jours fériés non compris (R. 441-3) ; réserves motivées sous 10 jours francs après la déclaration (R. 441-6). */
export const CPAM_DELAY_HOURS = 48;
export const RESERVES_DELAY_DAYS = 10;
/** AT d'un intérimaire : l'entreprise utilisatrice informe l'entreprise de travail temporaire dans les 24 heures, copie à la
 * CARSAT et à l'inspection du travail (R. 412-2 CSS) ; délai décompté d'heure à heure. */
export const ETT_DELAY_HOURS = 24;

/** Victime d'un accident du travail (EVT-01). */
export type VictimKind = 'salarie' | 'interimaire' | 'externe';
export const VICTIM_KINDS: Record<VictimKind, string> = {
  salarie: "Salarié de l'effectif",
  interimaire: 'Intérimaire',
  externe: 'Personne extérieure (entreprise extérieure, visiteur…)',
};
export const VICTIM_KIND_KEYS = Object.keys(VICTIM_KINDS) as VictimKind[];

/** Événement environnemental : aspect et milieu concerné (EVT-05). */
export const ENV_ASPECTS = ['Déversement', 'Rejet aqueux', 'Émission atmosphérique', 'Déchets', 'Bruit', 'Odeur', 'Consommation de ressources', 'Autre'];
export const ENV_MEDIA = ['Eau', 'Sol', 'Air', 'Voisinage', 'Ressources naturelles'];

/** Données exigées au passage à « Qualifié » (en plus du pilote), puis tant que l'événement reste qualifié (EVT-05). */
export type QualificationField = 'victim' | 'circumstances' | 'location' | 'severity' | 'ncOrigin' | 'customer' | 'customerRef' | 'envAspect' | 'envMedium';
export const QUALIFICATION_LABELS: Record<QualificationField, string> = {
  victim: 'victime', circumstances: 'circonstances', location: 'lieu', severity: 'gravité potentielle', ncOrigin: 'origine',
  customer: 'client', customerRef: 'référence client (commande, affaire ou projet Keystone)', envAspect: 'aspect environnemental', envMedium: 'milieu concerné',
};
export const QUALIFICATION_FIELDS: Record<EventType, QualificationField[]> = {
  AT: ['victim', 'circumstances', 'location'],
  PA: ['location', 'severity'],
  SD: ['location', 'severity'],
  NC: ['ncOrigin'],
  RC: ['customer', 'customerRef'],
  ENV: ['envAspect', 'envMedium'],
  MP: ['victim'],
};

/** Donneur de soins d'un accident bénin (D. 441-1 CSS) : secouriste du travail de l'effectif, ou professionnel de santé. */
export type BenignCaregiverKind = 'sst' | 'infirmier' | 'medecin' | 'pharmacien';
export const BENIGN_CAREGIVER_KINDS: Record<BenignCaregiverKind, string> = {
  sst: 'Sauveteur secouriste du travail (SST)', infirmier: 'Infirmier ou infirmière', medecin: 'Médecin', pharmacien: 'Pharmacien',
};
export const BENIGN_CAREGIVER_KEYS = Object.keys(BENIGN_CAREGIVER_KINDS) as BenignCaregiverKind[];

export type EventTransition = 'advance' | 'revert' | 'reopen' | 'dismiss' | 'restore';
export const EVENT_TRANSITIONS: Record<EventTransition, { label: string; icon: string }> = {
  advance: { label: 'Étape franchie', icon: 'ph-arrow-right' },
  revert: { label: 'Retour arrière', icon: 'ph-arrow-counter-clockwise' },
  reopen: { label: 'Réouverture', icon: 'ph-lock-open' },
  dismiss: { label: 'Classé sans suite', icon: 'ph-archive' },
  restore: { label: 'Classement annulé', icon: 'ph-arrow-u-up-left' },
};

export const SEVERITY = ['', 'G1 · faible', 'G2 · modérée', 'G3 · grave', 'G4 · très grave'];
export const severityTone = (g: number): Tone => (g >= 3 ? 'danger' : g === 2 ? 'warn' : 'neutral');

export type AnalysisMethod = '5m' | 'tree' | 'why' | '8d';
export const METHODS: [AnalysisMethod, string][] = [['5m', '5M'], ['tree', 'Arbre des causes'], ['why', '5 pourquoi'], ['8d', '8D']];
export const D8_STEPS = ['D1 · Équipe', 'D2 · Description', 'D3 · Actions immédiates', 'D4 · Causes racines', 'D5 · Actions correctives', 'D6 · Mise en œuvre', 'D7 · Prévention', 'D8 · Clôture'];

export const NC_ORIGINS = ['Fournisseurs', 'Fabrication', 'Conception BE', 'Mise en service', 'Réclamation client'];

/**
 * Traitement d'un produit non conforme (EVT-17, ISO 9001 §8.7.1) : décision, quantité concernée et coût de non-qualité.
 * Une dérogation (acceptation en l'état) exige l'autorité qui l'a accordée (client, donneur d'ordre).
 */
export type NcDisposition = 'retouche' | 'rebut' | 'derogation' | 'retour';
export const NC_DISPOSITIONS: Record<NcDisposition, string> = {
  retouche: 'Retouche ou reprise',
  rebut: 'Rebut',
  derogation: 'Acceptation par dérogation',
  retour: 'Retour au fournisseur',
};
export const NC_DISPOSITION_KEYS = Object.keys(NC_DISPOSITIONS) as NcDisposition[];

// ─── Plan d'actions (docs/specs/actions-qse.md § 5, § 12) ───────────────────
// Clés stockées : src/lib/action-keys.ts (contraintes CHECK de la base) ; règles pures (retard, transitions, droits,
// à compléter, filtres) : src/lib/action-rules.ts. Ici : libellés, tons et groupes.

export * from './action-keys';

/** Groupes d'avancement (§ 5.1) : ouverte (À faire → 80 %), en attente (Reportée), réalisée (Terminée), close. */
export type AvancementGroup = 'ouverte' | 'en_attente' | 'realisee' | 'close';
/** Avancement (§ 5.1) : libellé Vigie, libellé Power Apps (import, ACT-39), groupe, ton ; « en retard » est calculé (§ 6.3). */
export const AVANCEMENT: Record<Avancement, { label: string; powerApps: string; group: AvancementGroup; tone: Tone; canBeLate: boolean }> = {
  a_faire: { label: 'À faire', powerApps: 'A faire', group: 'ouverte', tone: 'neutral', canBeLate: true },
  initiee: { label: 'Budgétée ou initiée', powerApps: 'Budgétée ou initiée', group: 'ouverte', tone: 'accent', canBeLate: true },
  p20: { label: '20 %', powerApps: '20 %', group: 'ouverte', tone: 'accent', canBeLate: true },
  p40: { label: '40 %', powerApps: '40 %', group: 'ouverte', tone: 'accent', canBeLate: true },
  p60: { label: '60 %', powerApps: '60 %', group: 'ouverte', tone: 'accent', canBeLate: true },
  p80: { label: '80 %', powerApps: '80 %', group: 'ouverte', tone: 'accent', canBeLate: true },
  reportee: { label: 'Reportée', powerApps: 'Reportée', group: 'en_attente', tone: 'neutral', canBeLate: false },
  terminee: { label: 'Terminée — à vérifier', powerApps: 'Terminée', group: 'realisee', tone: 'warn', canBeLate: false },
  verifiee: { label: 'Vérifiée', powerApps: 'Vérifiée', group: 'close', tone: 'ok', canBeLate: false },
  abandonnee: { label: 'Abandonnée', powerApps: 'Abandonnée', group: 'close', tone: 'neutral', canBeLate: false },
};
export const isAvancement = (s: string): s is Avancement => (ACTION_AVANCEMENTS as readonly string[]).includes(s);
/** Groupe « ouverte » (À faire → 80 %) : seules actions qui peuvent être en retard (§ 6.3), taux de retard. */
export const isOpenAvancement = (s: string) => (OPEN_AVANCEMENTS as readonly string[]).includes(s);
/**
 * Actions du rappel du mercredi (ACT-32, § 15.2 révisé le 15/10/2026) : les ouvertes et les Terminées (en attente de
 * vérification) ; ni Reportées, ni closes.
 */
export const isReminderAvancement = (s: string) => isOpenAvancement(s) || s === 'terminee';
/** Close pour les écrans sources, rattachements et blocages : Vérifiée ou Abandonnée (Terminée et Reportée restent ouvertes). */
export const isClosedActionStatus = (s: string) => s === 'verifiee' || s === 'abandonnee';

export const ACTION_PRIORITIES: Record<ActionPriority, { label: string; tone: Tone }> = {
  urgent: { label: 'Urgent', tone: 'danger' },
  moyen_terme: { label: 'Moyen terme', tone: 'warn' },
  long_terme: { label: 'Long terme', tone: 'neutral' },
};
export const ACTION_DOMAINS: Record<ActionDomain, string> = { qualite: 'Qualité', securite: 'Sécurité', sante: 'Santé', environnement: 'Environnement', surete: 'Sûreté' };
/** Niveau de risque d'une action (§ 5.4) — distinct de RISK_LEVELS / riskLevel (cotation G × P du DUERP). */
export const ACTION_RISK_LEVELS = ['Niveau 0 — Supprimé', 'Niveau 1 — Maîtrisé durablement', 'Niveau 2 — Maîtrisé ponctuellement', 'Niveau 3 — Maîtrise en cours', 'Niveau 4 — Non maîtrisé'] as const; // index = niveau
export const VERIFY_METHODS: Record<VerifyMethod, string> = { audit_visite: 'Audit / visite', ecrit: 'Écrit', reunion: 'Réunion', visuelle: 'Visuelle', autre: 'Autre' };
export const FOLLOW_REASONS: Record<FollowReason, string> = { non_efficace: 'Non efficace', nouveau_risque: 'Nouveau risque' };

/** Cible d'une source (§ 12) : type d'élément Vigie qui peut lui être lié (free : référence d'origine seulement). */
export type SourceTarget = 'event' | 'audit' | 'risk' | 'control' | 'requirement' | 'review' | 'objective' | 'document' | 'environment' | 'free';
/**
 * 24 sources (§ 12) dans l'ordre de la liste du QHSE : ses 22 sources, plus « Audit fournisseur » et « Déchets » (réponses
 * du service QHSE du 15/10/2026, ACT-37). `path` : écran d'arrivée sans élément lié (null : source libre, sans élément
 * Vigie) ; `hint` : précision affichée sous la liste des sources du formulaire.
 */
export const ACTION_SOURCES: Record<SourceKey, { label: string; icon: string; target: SourceTarget; path: string | null; hint?: string }> = {
  analyse_risque: {
    label: 'Analyse de risque (AST-EST)', icon: 'ph-magnifying-glass', target: 'free', path: null,
    hint: 'AST : analyse de sécurité des tâches en contexte pyrotechnique ; EST : étude de sécurité technique.',
  },
  analyse_chimique: { label: 'Analyse de risque chimique', icon: 'ph-flask', target: 'free', path: null },
  analyse_environnementale: { label: 'Analyse environnementale', icon: 'ph-leaf', target: 'free', path: null },
  audit_certification: { label: 'Audit de certification ISO', icon: 'ph-certificate', target: 'audit', path: '/audits' },
  audit_fournisseur: { label: 'Audit fournisseur', icon: 'ph-truck', target: 'audit', path: '/audits' },
  audit_interne: { label: 'Audit interne ISO', icon: 'ph-certificate', target: 'audit', path: '/audits' },
  audit_terrain: { label: 'Audit terrain', icon: 'ph-hard-hat', target: 'audit', path: '/audits' },
  autorite_publique: { label: 'Autorité publique', icon: 'ph-bank', target: 'free', path: null },
  causerie: { label: 'Causerie QSE', icon: 'ph-chats', target: 'free', path: null },
  comex: { label: 'COMEX', icon: 'ph-briefcase', target: 'free', path: null },
  controle_reglementaire: { label: 'Contrôle réglementaire', icon: 'ph-gauge', target: 'control', path: '/veille?onglet=controles' },
  dechets: { label: 'Déchets', icon: 'ph-recycle', target: 'environment', path: '/environnement' },
  duerp: { label: 'DUERP', icon: 'ph-shield-check', target: 'risk', path: '/risques' },
  evenement: { label: 'Évènement QSE', icon: 'ph-warning', target: 'event', path: '/evenements' },
  objectif: { label: 'Objectif QSE', icon: 'ph-target', target: 'objective', path: '/audits' },
  reclamation_client: { label: 'Réclamation client', icon: 'ph-chat-centered-text', target: 'event', path: '/evenements?type=RC' },
  reunion_operationnelle: { label: 'Réunion opérationnelle', icon: 'ph-users', target: 'free', path: null },
  revue_direction: { label: 'Revue de direction', icon: 'ph-users-three', target: 'review', path: '/audits' },
  revue_documentaire: { label: 'Revue documentaire', icon: 'ph-files', target: 'document', path: '/documents' },
  revue_processus: { label: 'Revue de processus', icon: 'ph-flow-arrow', target: 'free', path: null },
  veille: { label: 'Veille réglementaire', icon: 'ph-scales', target: 'requirement', path: '/veille' },
  hazop: { label: 'HAZOP', icon: 'ph-pipe', target: 'free', path: null },
  reserves: {
    label: 'Réserves', icon: 'ph-list-checks', target: 'free', path: null,
    hint: 'Réserves de réception d\'un chantier ou d\'une installation.',
  },
  rex: { label: 'REX', icon: 'ph-arrow-u-up-left', target: 'free', path: null },
};
/**
 * Types de lien (src/lib/action-links.ts) qui désignent l'élément de la source, par cible. Cohérent avec
 * admissibleSources (src/lib/action-rules.ts, testé) : Déchets admet aussi l'exigence (action BSD de l'écran
 * Environnement), Revue de direction l'élément du programme de la ligne « Revues de direction ».
 */
export const SOURCE_LINK_KINDS: Record<SourceTarget, readonly string[]> = {
  event: ['event'], audit: ['finding', 'plan'], risk: ['risk'], control: ['control'], requirement: ['requirement'],
  review: ['review', 'reviewdecision', 'plan'], objective: ['reviewdecision'], document: ['document', 'docversion'],
  environment: ['wastestream', 'wasteentry', 'requirement'], free: [],
};
/** L'unique événement ou audit d'une action : posé à la création seulement, jamais rattaché ni détaché ensuite (§ 12, D15). */
export const EVENT_AUDIT_LINK_KINDS = ['event', 'finding', 'plan'] as const;
/** Ancienne origine (avant 0005) → libellé : historique, indication d'une source à compléter (legacy_origin, D9). */
export const LEGACY_ORIGIN_LABELS: Record<string, string> = {
  ev: 'Événement', audit: 'Audit', risk: 'Risques', watch: 'Veille', client: 'Client', rev: 'Revue de direction',
  skills: 'Habilitations', prevention: 'Prévention', docs: 'Documents', env: 'Environnement',
};

/** Rapprochement de libellés sans accents, casse ni espaces (§ 5 ; import Power Apps ACT-39). */
export const normalizeListLabel = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, '');
/** Clé dont le libellé (ou le libellé Power Apps) correspond à `raw` (normalizeListLabel) ; null : valeur non reconnue. */
export function matchListLabel<K extends string>(labels: Record<K, string | { label: string; powerApps?: string }>, raw: string): K | null {
  const want = normalizeListLabel(raw);
  if (!want) return null;
  for (const [key, value] of Object.entries(labels) as [K, string | { label: string; powerApps?: string }][]) {
    const names = typeof value === 'string' ? [value] : [value.label, value.powerApps ?? value.label];
    if (names.some((n) => normalizeListLabel(n) === want)) return key;
  }
  return null;
}

const SAFETY_DOMAIN_LABELS = ['Santé-sécurité', 'Santé - sécurité', 'Santé et sécurité', 'Sécurité'].map(normalizeListLabel);
/**
 * Domaine proposé d'après la source ou l'élément lié (§ 12), modifiable ; null : aucune proposition. Événement AT, PA, SD →
 * Sécurité ; NC, RC → Qualité ; ENV → Environnement ; source DUERP → Sécurité ; Revue documentaire → Qualité ; Déchets ou
 * Analyse environnementale → Environnement ; exigence de veille : son domaine (texte libre) quand il correspond à un domaine —
 * texte entier, puis la partie avant « — » (thème : « Sécurité — machines » → Sécurité), puis la partie après
 * (« Code du travail — Santé-sécurité » → Sécurité) ; « Santé-sécurité » et « Sécurité » → Sécurité. Écart assumé au plan
 * du paquet 1 (§ 2.1 : partie après « — » seulement) : le domaine d'une exigence s'écrit « thème — précision ».
 */
export function proposedDomain(input: { eventType?: string | null; source?: SourceKey | null; requirementDomain?: string | null }): ActionDomain | null {
  const { eventType, source, requirementDomain } = input;
  if (eventType === 'AT' || eventType === 'PA' || eventType === 'SD') return 'securite';
  if (eventType === 'NC' || eventType === 'RC') return 'qualite';
  if (eventType === 'ENV') return 'environnement';
  if (source === 'duerp') return 'securite';
  if (source === 'revue_documentaire') return 'qualite';
  if (source === 'dechets' || source === 'analyse_environnementale') return 'environnement';
  if (requirementDomain) {
    const parts = requirementDomain.split('—').map((p) => p.trim()).filter(Boolean);
    for (const candidate of [requirementDomain, ...parts]) {
      if (SAFETY_DOMAIN_LABELS.includes(normalizeListLabel(candidate))) return 'securite';
      const hit = matchListLabel(ACTION_DOMAINS, candidate);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Notifications d'information stockées (table notifications) : type → libellé. Action confiée au responsable (ACT-30) ;
 * commentaire ou preuve ajoutés par le responsable, adressés à chaque animateur QHSE (ACT-31, une notification par
 * commentaire ou par preuve).
 */
export const NOTIFICATION_KINDS = {
  action_confiee: 'Action confiée',
  action_commentaire: 'Commentaire du responsable',
  action_preuve: 'Preuve ajoutée',
  signalement_suite: 'Suite de votre signalement', // TDB-06 : qualifié, classé sans suite ou clôturé, au déclarant
} as const;
export type NotificationType = keyof typeof NOTIFICATION_KINDS;
/** Clés d'état lu de la cloche : notification stockée « notification:<id> », rappel du mercredi « rappel-actions|2026-W42 ». */
export const STORED_NOTIFICATION_KEY_PREFIX = 'notification:';
export const REMINDER_KEY_PREFIX = 'rappel-actions|';
export const REMINDER_KIND = 'Rappel du mercredi';

/** Longueur maximale d'un motif (abandon, archivage, classement sans suite, réouverture). */
export const REASON_MAX = 1000;


// Cotation des risques : gravité 1–4 × probabilité 1–4.
export const RISK_LEVELS = [
  { bg: 'oklch(0.30 0.03 152)', dot: 'var(--tone-ok-dot)', label: 'Faible 1–3' },
  { bg: 'oklch(0.33 0.05 78)', dot: 'var(--tone-warn-dot)', label: 'Modéré 4–6' },
  { bg: 'oklch(0.35 0.07 40)', dot: 'oklch(0.72 0.14 40)', label: 'Élevé 8–9' },
  { bg: 'oklch(0.37 0.09 22)', dot: 'var(--tone-danger-dot)', label: 'Critique 12–16' },
];
export const riskLevel = (n: number) => (n >= 12 ? 3 : n >= 8 ? 2 : n >= 4 ? 1 : 0);
export const RISK_ACTION_THRESHOLD = 8;

/** Alertes calculées d'un risque du DUERP (tableau, fiche, échéances). Par ordre de priorité. */
export type RiskFlag = 'toDefine' | 'residualHigh' | 'toReview';
export const RISK_FLAGS: Record<RiskFlag, { label: string; tone: Tone; hint: string }> = {
  toDefine: { label: 'À définir', tone: 'danger', hint: `Cotation brute ≥ ${RISK_ACTION_THRESHOLD} : une action de réduction est obligatoire.` },
  residualHigh: { label: 'Résiduel encore élevé', tone: 'danger', hint: `Toutes les actions sont vérifiées mais le résiduel reste ≥ ${RISK_ACTION_THRESHOLD} : nouvelle action nécessaire.` },
  toReview: { label: 'Résiduel à recoter', tone: 'warn', hint: "Toutes les actions sont vérifiées : recotez le risque résiduel après vérification d'efficacité." },
};
/** Libellé « type » des échéances DUERP (tableau de bord, notifications, page À faire). */
export const RISK_TODO_KIND = 'DUERP';
/** Valeur de requirements.linkedTo pour l'exigence « Document unique » (R. 4121-1). */
export const DUERP_REQUIREMENT_LINK = 'duerp';

/**
 * Indicateurs calculés auxquels une exigence de veille se rattache explicitement (requirements.linkedTo, VEI-07) : échéance
 * et état de l'exigence lus dans le module (DUERP, plans de prévention), exigences reprises par l'écran Environnement
 * (registre, bordereaux). Une seule exigence en vigueur par indicateur (contrôle de saveRequirement) ; reprise des anciens
 * rapprochements par le texte dans la migration 0011.
 */
export const REQUIREMENT_LINKS = {
  duerp: { label: 'Document unique (DUERP) — version en vigueur', hint: 'Échéance et état repris de la version en vigueur du DUERP (écran Risques).' },
  prevention: { label: 'Plans de prévention (R. 4512-6) — interventions sans plan signé', hint: 'Écarts calculés des plans de prévention, sur tout le périmètre.' },
  waste_register: { label: 'Registre des déchets (R. 541-43)', hint: 'Exigence affichée sur l’écran Environnement (registre chronologique).' },
  waste_bsd: { label: 'Bordereaux de déchets dangereux (R. 541-45, Trackdéchets)', hint: 'Exigence de l’action « BSD manquants » et pilote des échéances du registre.' },
} as const satisfies Record<string, { label: string; hint: string }>;
export type RequirementLink = keyof typeof REQUIREMENT_LINKS;
export const REQUIREMENT_LINK_KEYS = Object.keys(REQUIREMENT_LINKS) as RequirementLink[];
export const isRequirementLink = (v: unknown): v is RequirementLink => typeof v === 'string' && v in REQUIREMENT_LINKS;

// ─── DUERP : mise à disposition et programme annuel ─────────────────────────

/** Demandeurs d'accès au DUERP (R. 4121-4) : registre des mises à disposition. */
export const DUERP_REQUESTERS = {
  salarie: 'Salarié',
  ancien_salarie: 'Ancien salarié',
  cse: 'CSE',
  medecin: 'Médecin du travail (SPST)',
  inspection: 'Inspection du travail',
  carsat: 'CARSAT (prévention de la sécurité sociale)',
  autre: 'Autre organisme habilité',
} as const;
export type DuerpRequester = keyof typeof DUERP_REQUESTERS;
export const DUERP_REQUESTER_KEYS = Object.keys(DUERP_REQUESTERS) as DuerpRequester[];

/** Modalité de mise à disposition du DUERP. */
export const DUERP_ACCESS_CHANNELS = {
  vigie: 'Consultation dans Vigie',
  sur_place: 'Consultation sur place',
  papier: 'Copie papier remise',
  electronique: 'Copie électronique transmise',
} as const;
export type DuerpAccessChannel = keyof typeof DUERP_ACCESS_CHANNELS;
export const DUERP_ACCESS_CHANNEL_KEYS = Object.keys(DUERP_ACCESS_CHANNELS) as DuerpAccessChannel[];

/** Programme annuel de prévention (PAPRIPACT, L. 4121-3-1) : états. */
export const PROGRAM_STATES = {
  draft: { label: 'En préparation', tone: 'warn' },
  frozen: { label: 'Arrêté', tone: 'ok' },
} as const satisfies Record<string, { label: string; tone: Tone }>;
export type ProgramState = keyof typeof PROGRAM_STATES;
/** Libellé court du programme annuel (échéances, navigation de l'écran DUERP). */
export const PROGRAM_SHORT = 'PAPRIPACT';

export const REQUIREMENT_EVAL: Record<string, { label: string; tone: Tone }> = {
  conforme: { label: 'Conforme', tone: 'ok' },
  ecart: { label: 'Écart', tone: 'danger' },
  analyse: { label: "Analyse d'écart en cours", tone: 'accent' },
  a_evaluer: { label: 'À évaluer', tone: 'warn' },
};
/**
 * Résultat d'un contrôle réalisé (VEI-11) : avis de l'organisme. Défavorable ou mise à l'arrêt : l'équipement est signalé
 * jusqu'à un nouveau contrôle favorable ; « avec réserves » exige les réserves.
 */
export type ControlResult = 'favorable' | 'reserves' | 'defavorable' | 'arret';
export const CONTROL_RESULTS: Record<ControlResult, { label: string; tone: Tone }> = {
  favorable: { label: 'Favorable', tone: 'ok' },
  reserves: { label: 'Favorable avec réserves', tone: 'warn' },
  defavorable: { label: 'Défavorable', tone: 'danger' },
  arret: { label: "Mise à l'arrêt", tone: 'danger' },
};
export const CONTROL_RESULT_KEYS = Object.keys(CONTROL_RESULTS) as ControlResult[];
/** Résultats qui interdisent l'usage de l'équipement tant qu'un nouveau contrôle n'est pas favorable. */
export const isBlockingControlResult = (r: string | null | undefined) => r === 'defavorable' || r === 'arret';

/** Contexte du système de management (CNF-05, ISO 9001 §4.1, §4.2, §6.1). */
export type ContextKind = 'enjeu_interne' | 'enjeu_externe' | 'partie_interessee' | 'risque' | 'opportunite';
export const CONTEXT_KINDS: Record<ContextKind, { label: string; plural: string; clause: string; tone: Tone; detail: string }> = {
  enjeu_externe: { label: 'Enjeu externe', plural: 'Enjeux externes', clause: '§4.1', tone: 'accent', detail: 'Description' },
  enjeu_interne: { label: 'Enjeu interne', plural: 'Enjeux internes', clause: '§4.1', tone: 'accent', detail: 'Description' },
  partie_interessee: { label: 'Partie intéressée', plural: 'Parties intéressées', clause: '§4.2', tone: 'neutral', detail: 'Exigences et attentes pertinentes' },
  risque: { label: 'Risque', plural: 'Risques', clause: '§6.1', tone: 'danger', detail: 'Description' },
  opportunite: { label: 'Opportunité', plural: 'Opportunités', clause: '§6.1', tone: 'ok', detail: 'Description' },
};
export const CONTEXT_KIND_KEYS = Object.keys(CONTEXT_KINDS) as ContextKind[];
/** Risques et opportunités : leur traitement (actions prévues) est attendu (§6.1.2). */
export const contextNeedsTreatment = (k: string) => k === 'risque' || k === 'opportunite';

/** Évaluations qui appellent une action dans le plan d'actions unique. */
export const REQUIREMENT_NEEDS_ACTION = ['ecart', 'analyse'] as const;
/** Périodicité de réévaluation de la conformité d'une exigence (alerte dans les échéances). */
export const REQUIREMENT_REVIEW_MONTHS = 12;

export type SkillState = 'v' | 's' | 'x' | 'r' | 'p' | 'n';
export const SKILL_STATES: Record<SkillState, { label: string; icon: string; bg: string; fg: string; border: string }> = {
  v: { label: 'Valide', icon: 'ph-check', bg: TONE.ok.bg, fg: TONE.ok.fg, border: '1px solid transparent' },
  s: { label: 'Expire sous 60 jours', icon: 'ph-clock', bg: TONE.warn.bg, fg: TONE.warn.fg, border: '1px solid transparent' },
  x: { label: 'Expiré', icon: 'ph-x', bg: TONE.danger.bg, fg: TONE.danger.fg, border: '1px solid transparent' },
  r: { label: 'Requis, jamais suivi', icon: 'ph-warning', bg: 'transparent', fg: TONE.danger.dot, border: `1px dashed ${TONE.danger.dot}` },
  // HAB-10 : titre détenu mais inopérant, un titre prérequis (CACES d'une autorisation de conduite, R. 4323-56) n'étant pas valide.
  p: { label: 'Prérequis non valide', icon: 'ph-link-break', bg: TONE.danger.bg, fg: TONE.danger.fg, border: `1px dashed ${TONE.danger.dot}` },
  n: { label: 'Non requis', icon: 'ph-minus', bg: 'transparent', fg: 'var(--color-neutral-700)', border: '1px solid transparent' },
};
export const SKILL_SOON_DAYS = 60;

/** Filtres de la matrice des habilitations. */
export const SKILL_FILTERS = [
  { key: 'a_traiter', label: 'À traiter' }, // au moins une case s, x ou r, ou un manque pendant une affectation
  { key: 'sortis', label: 'Sortis' }, // salariés sortis de l'effectif (archivés)
] as const;
export type SkillFilter = (typeof SKILL_FILTERS)[number]['key'];

/**
 * Types de constat (AUD-09) : écarts (majeur, mineur) avec un délai de réponse (plan d'actions attendu par l'organisme ou
 * l'auditeur), observation, piste de progrès, point fort. Ordre de la liste du formulaire.
 */
export const FINDING_KINDS: Record<string, { label: string; tone: Tone }> = {
  ecart_majeur: { label: 'Écart majeur', tone: 'danger' },
  ecart_mineur: { label: 'Écart mineur', tone: 'danger' },
  observation: { label: 'Observation', tone: 'warn' },
  piste: { label: 'Piste de progrès', tone: 'warn' },
  point_fort: { label: 'Point fort', tone: 'ok' },
};

/** Constats qui sont des écarts (AUD-09) : délai de réponse proposé, action attendue. */
export const FINDING_GAP_KINDS: readonly string[] = ['ecart_majeur', 'ecart_mineur'];

/** Nature d'un élément du programme annuel selon sa ligne (intitulé repris dans les échéances). */
export const PLAN_TRACK_KINDS: Record<string, string> = {
  'Audits internes': 'Audit interne', 'Visites sécurité': 'Visite sécurité', Certification: 'Certification', Fournisseurs: 'Audit fournisseur', 'Revues de direction': 'Revue de direction',
};
export const planTrackKind = (track: string) => PLAN_TRACK_KINDS[track] ?? track;

/** État calculé d'un élément du programme : réalisé, échéance passée non confirmée, à venir, annulé (AUD-03). */
export const PLAN_ITEM_STATES = {
  done: { label: 'Réalisé', tone: 'ok' },
  late: { label: 'À confirmer', tone: 'warn' },
  upcoming: { label: 'À venir', tone: 'neutral' },
  cancelled: { label: 'Annulé', tone: 'neutral' },
} as const satisfies Record<string, { label: string; tone: Tone }>;
export type PlanItemState = keyof typeof PLAN_ITEM_STATES;

/** Audit de suivi ou fin de validité du certificat considérés comme proches (jours). */
export const CERT_SOON_DAYS = 30;
/** Cycle de certification (ISO/IEC 17021-1) : un certificat vaut 3 ans au plus après son émission (AUD-08). */
export const CERT_CYCLE_MONTHS = 36;
/**
 * Renouvellement à préparer (AUD-08) : fin de validité dans moins de 6 mois sans audit de renouvellement programmé avant
 * cette date (proposition, délai à confirmer par le service QHSE).
 */
export const CERT_RENEWAL_NOTICE_DAYS = 180;

// ─── Revue de direction (ISO 9001 §9.3) ─────────────────────────────────────

export type ReviewKind = 'ordinaire' | 'intermediaire';
export const REVIEW_KINDS: Record<ReviewKind, { label: string; short: string }> = {
  ordinaire: { label: 'Revue annuelle', short: 'Annuelle' },
  intermediaire: { label: 'Revue intermédiaire', short: 'Interm.' },
};
export const REVIEW_KIND_KEYS = Object.keys(REVIEW_KINDS) as ReviewKind[];

export type ReviewStatus = 'planifiee' | 'tenue' | 'cloturee' | 'annulee';
export const REVIEW_STATUS: Record<ReviewStatus, { label: string; tone: Tone }> = {
  planifiee: { label: 'Planifiée', tone: 'neutral' },
  tenue: { label: 'Tenue · à clôturer', tone: 'warn' },
  cloturee: { label: 'Clôturée', tone: 'ok' },
  annulee: { label: 'Annulée', tone: 'neutral' },
};

/** Provenance d'un élément d'entrée (review_items.source) : un contributeur, ou Vigie (fourni d'office dès que ses données existent). */
export type ReviewSource = 'manuel' | 'actions' | 'safety' | 'events' | 'complaints' | 'suppliers' | 'audits' | 'watch' | 'risks' | 'prevention' | 'documents' | 'environment' | 'skills';
export const REVIEW_SOURCES: Record<ReviewSource, { label: string; auto: boolean }> = {
  manuel: { label: 'Contributeur', auto: false },
  actions: { label: 'Vigie · actions des revues précédentes', auto: true },
  safety: { label: 'Vigie · indicateurs sécurité', auto: true },
  events: { label: 'Vigie · non-conformités et événements', auto: true },
  complaints: { label: 'Vigie · réclamations client', auto: true },
  suppliers: { label: 'Vigie · fournisseurs', auto: true },
  audits: { label: 'Vigie · audits et certifications', auto: true },
  watch: { label: 'Vigie · veille et contrôles', auto: true },
  risks: { label: 'Vigie · DUERP', auto: true },
  prevention: { label: 'Vigie · prévention', auto: true },
  documents: { label: 'Vigie · maîtrise documentaire', auto: true },
  environment: { label: 'Vigie · environnement', auto: true },
  skills: { label: 'Vigie · compétences', auto: true },
};
export const REVIEW_SOURCE_KEYS = Object.keys(REVIEW_SOURCES) as ReviewSource[];
export const REVIEW_AUTO_OWNER = 'Vigie · automatique';

export type ReviewDecisionKind = 'decision' | 'objectif' | 'ressource';
export const REVIEW_DECISION_KINDS: Record<ReviewDecisionKind, { label: string; tone: Tone }> = {
  decision: { label: 'Décision', tone: 'accent' },
  objectif: { label: 'Objectif', tone: 'ok' },
  ressource: { label: 'Besoin en ressources', tone: 'warn' },
};
export const REVIEW_DECISION_KEYS = Object.keys(REVIEW_DECISION_KINDS) as ReviewDecisionKind[];

/** Revue tenue non clôturée : échéance « dossier à clôturer » au-delà de ce délai (jours). */
export const REVIEW_CLOSE_DAYS = 30;

/**
 * Suivi des décisions des revues précédentes (dossier § 1, ISO 9001 §9.3.2 a) : décision sans action au plan, action abandonnée.
 * Les autres avancements prennent leur libellé et leur ton (AVANCEMENT, « En retard ») ; un objectif ou un besoin en
 * ressources sans action prend le ton neutral (chargement).
 */
export const REVIEW_FOLLOW_UP = {
  no_action: { label: 'Sans action au plan', tone: 'warn' },
  cancelled: { label: 'Action abandonnée', tone: 'neutral' },
} as const satisfies Record<string, { label: string; tone: Tone }>;

// ─── Navigation, écrans et rôles ────────────────────────────────────────────

export type ScreenKey =
  | 'dashboard' | 'todo' | 'events' | 'actions' | 'prevention' | 'risks' | 'skills'
  | 'watch' | 'audits' | 'docs' | 'env' | 'mobile' | 'contributions';

export const SCREENS: Record<ScreenKey, { path: string; title: string; label: string; icon: string }> = {
  dashboard: { path: '/', title: 'Tableau de bord QHSE', label: 'Tableau de bord', icon: 'ph-gauge' },
  todo: { path: '/a-faire', title: 'À faire', label: 'À faire', icon: 'ph-check-square-offset' },
  events: { path: '/evenements', title: 'Signalements et événements', label: 'Signalements et événements', icon: 'ph-warning' },
  actions: { path: '/actions', title: "Plan d'actions unique", label: "Plan d'actions", icon: 'ph-list-checks' },
  prevention: { path: '/prevention', title: 'Plans de prévention et permis', label: 'Plans de prévention et permis', icon: 'ph-clipboard-text' },
  risks: { path: '/risques', title: 'Évaluation des risques', label: 'Évaluation des risques', icon: 'ph-shield-check' },
  skills: { path: '/habilitations', title: 'Habilitations et formations', label: 'Habilitations et formations', icon: 'ph-identification-badge' },
  watch: { path: '/veille', title: 'Veille réglementaire et contrôles', label: 'Veille et contrôles', icon: 'ph-scales' },
  audits: { path: '/audits', title: 'Audits et certifications', label: 'Audits et certifications', icon: 'ph-certificate' },
  docs: { path: '/documents', title: 'Documents maîtrisés', label: 'Documents maîtrisés', icon: 'ph-files' },
  env: { path: '/environnement', title: 'Environnement et déchets', label: 'Environnement et déchets', icon: 'ph-leaf' },
  mobile: { path: '/apercu-mobile', title: 'Signalement terrain', label: 'Aperçu mobile · signalement terrain', icon: 'ph-device-mobile' },
  // Hors navigation (AUD-04) : contributions, participations et décisions de la personne pour la revue de direction.
  contributions: { path: '/audits/contributions', title: 'Mes contributions à la revue de direction', label: 'Mes contributions', icon: 'ph-hand-arrow-up' },
};

export const NAV: { label: string; items: ScreenKey[] }[] = [
  { label: 'Pilotage', items: ['dashboard', 'todo'] },
  { label: 'Terrain', items: ['events', 'actions', 'prevention'] },
  { label: 'Prévention', items: ['risks', 'skills'] },
  { label: 'Système', items: ['watch', 'audits', 'docs', 'env'] },
];

export type Role = 'Animateur QHSE' | 'Direction' | 'Chef de service' | 'Chef de projet' | 'Salarié';

// Rôle → écrans autorisés (null = tous) et écrans en consultation seule.
// « docs » reste en dernier dans chaque liste : homeOf() prend le premier écran.
// Évaluation des risques : consultation par tous les rôles (DUERP, R. 4121-4, DUE-01) ; saisie : canEdit(role, 'risks').
// Audits et certifications : consultation par le chef de service et le chef de projet (AUD-02) ; saisie : canEdit(role, 'audits').
// Plan d'actions : consultation seule par l'encadrement hors QHSE (ACT-22 tranché le 15/10/2026 : lecture du plan de son
// périmètre) ; création, saisie et avancement réservés au service QHSE, donc canEdit(role, 'actions') === canApprove(role)
// pour tout rôle, depuis le plan comme depuis un écran source (canCreateAction, src/lib/action-rules.ts). Le Salarié ne
// voit que ses propres actions (canReadPlan, même module).
// Personnes de démonstration associées aux rôles : src/lib/demo.ts (mode démonstration seulement).
export const ROLES: Record<Role, { screens: ScreenKey[] | null; readOnly?: ScreenKey[] }> = {
  'Animateur QHSE': { screens: null },
  Direction: { screens: null },
  'Chef de service': { screens: ['dashboard', 'events', 'actions', 'prevention', 'risks', 'skills', 'watch', 'audits', 'docs'], readOnly: ['actions', 'audits', 'docs'] },
  'Chef de projet': { screens: ['dashboard', 'events', 'actions', 'prevention', 'risks', 'audits', 'docs'], readOnly: ['actions', 'risks', 'audits', 'docs'] },
  Salarié: { screens: ['events', 'actions', 'risks', 'skills', 'docs'], readOnly: ['risks', 'docs'] },
};
export const ROLE_KEYS = Object.keys(ROLES) as Role[];
/** Rôles du plus élevé au moins élevé : une personne qui porte plusieurs rôles Entra reçoit le premier de cette liste. */
export const ROLE_PRECEDENCE: Role[] = ['Direction', 'Animateur QHSE', 'Chef de service', 'Chef de projet', 'Salarié'];
/** Identifiant du choix « Tous les sites » (sélecteur de site, champ Site des formulaires). */
export const ALL_SITES = 'all';

// « À faire » est ouvert à tous. visibleTodo (src/lib/todo-visibility.ts) décide : échéances du site sélectionné sur les
// écrans que le rôle modifie, plus les échéances de la personne (ownerIds) sur tous les sites de son périmètre, sans lien
// quand l'écran source lui est fermé (TDB-02, TDB-05).
// « Mes contributions » (/audits/contributions) : ouvert à tous, la page ne montre que les contributions, participations
// et décisions de la personne (AUD-04).
export const canSee = (role: Role, screen: ScreenKey) => {
  const allowed = ROLES[role].screens;
  return screen === 'mobile' || screen === 'todo' || screen === 'contributions' || !allowed || allowed.includes(screen);
};
/** Écran correspondant à un lien interne (filtre des échéances selon les droits du rôle, badges) : le chemin le plus long l'emporte. */
export function screenOfHref(href: string): ScreenKey {
  const path = href.split(/[?#]/)[0];
  const hits = (Object.entries(SCREENS) as [ScreenKey, { path: string }][]).filter(([, s]) => s.path !== '/' && (path === s.path || path.startsWith(`${s.path}/`)));
  return hits.sort((a, b) => b[1].path.length - a[1].path.length)[0]?.[0] ?? 'dashboard';
}
export const canOpen = (role: Role, href?: string) => !href || canSee(role, screenOfHref(href));

export const homeOf = (role: Role): ScreenKey => ROLES[role].screens?.[0] ?? 'dashboard';

// Droits : l'encadrement saisit et modifie ; l'animateur QHSE et la direction valident
// (vérification d'efficacité, approbation des documents, versions du DUERP).
// Plan d'actions (docs/specs/actions-qse.md § 3, § 8) : « QHSE » = canApprove (animateur QHSE et direction, D6 § 22.17) :
// seul à créer une action (ACT-22) ; tous les droits sur les actions de son périmètre (champs, avancement, vérification,
// abandon, réouverture, rattachements). Le responsable d'une action (pilot_id), quel que soit son rôle, la consulte, la
// commente et y joint des preuves, sans transition (src/lib/action-rules.ts : actionRights).
export const canManage = (role: Role) => role !== 'Salarié';
export const canApprove = (role: Role) => role === 'Animateur QHSE' || role === 'Direction';
/** Visa de la revue de direction (clôture, dossier figé) : la direction seulement (AUD-15). */
export const canSignReview = (role: Role) => role === 'Direction';
/** Rôle Salarié : ne voit que ses propres données (habilitations, signalements, actions dont il est responsable). */
export const isEmployee = (role: Role) => role === 'Salarié';
/**
 * Données de santé d'un accident du travail (blessure, jours perdus, lésions, soins, déclaration CPAM, pièces médicales,
 * registre des accidents bénins, toute donnée médicale) : visibles et modifiables par l'animateur QHSE et la direction
 * seulement (SEC-06) ; les indicateurs agrégés restent visibles.
 */
export const canSeeHealth = (role: Role) => role === 'Animateur QHSE' || role === 'Direction';
/** Saisie sur un écran : encadrement, écran autorisé et non limité à la consultation. */
export const canEdit = (role: Role, screen: ScreenKey) =>
  canManage(role) && canSee(role, screen) && !(ROLES[role].readOnly ?? []).includes(screen);
/** Écran ouvert au rôle en consultation seule (ROLES[role].readOnly). */
export const isReadOnly = (role: Role, screen: ScreenKey) => (ROLES[role].readOnly ?? []).includes(screen);
/** Dossier consolidé de la revue (/revue-de-direction, données de tous les modules) : rôles qui saisissent sur l'écran Audits (animateur QHSE, direction). */
export const canReadReviewDossier = (role: Role) => canEdit(role, 'audits');

/** Destinataire affiché d'une alerte de site sans responsable QHSE (sites.qhse_lead_id vide ou sorti de l'effectif). */
export const VACANT_QHSE_LEAD = 'Responsable QHSE à désigner';

/** Procédure de référence (document maîtrisé) affichée en lien « Procédure » sur un écran. */
export const SCREEN_PROCEDURES: Partial<Record<ScreenKey, string>> = { prevention: 'PR-QHSE-005' };

// ─── Échéances (« À traiter », page À faire, notifications, badges) ─────────

/** Horizon des échéances (« À traiter dans les 15 jours », page À faire, badges). */
export const TODO_HORIZON_DAYS = 15;
/** Contrôles réglementaires : anticipés à 30 jours (KPI « Contrôles < 30 j », échéances, badge veille). */
export const CONTROL_HORIZON_DAYS = 30;
/** Panneau de notifications : dépassements + échéances des 7 prochains jours. */
export const NOTIFY_HORIZON_DAYS = 7;
/** TF1/TG : les 12 derniers mois complets (mois en cours exclu), base de « 12 mois glissants » (TDB-04). */
export const SAFETY_WINDOW_MONTHS = 12;

/** Échéance affichée dans « À traiter », la page À faire, les notifications et les badges. */
export type TodoItem = {
  date: string; kind: string; tone: Tone; title: string; who: string;
  /**
   * Site de l'élément (null : commun à tous les sites — version du DUERP, exigences, audits, revue). Les signaux sont
   * calculés sur tout le périmètre de la personne (TDB-05) ; visibleTodo le compare au site sélectionné.
   */
  siteId: string | null;
  /**
   * Lien vers l'élément (obligatoire en pratique) : filtre d'accès à l'écran et badge de l'écran (screenOfHref) ; pour un
   * responsable sans accès à l'écran, remplacé par readHref ou retiré (TDB-02).
   */
  href?: string;
  /**
   * Vue en lecture de l'élément pour ses responsables quand l'écran source est fermé à leur rôle (TDB-02). Elle doit pouvoir
   * être ouverte par toute personne de ownerIds, quel que soit son rôle (la vue vérifie elle-même que la personne est
   * concernée). Sans elle, un responsable sans accès reçoit l'échéance sans lien.
   */
  readHref?: string;
  /** Personnes concernées (pilote, responsable, salarié) : filtre « Mes échéances » et vue Salarié. */
  ownerIds?: string[];
  /** Échéance dépassée ou retard : en tête de liste, urgente dans les notifications. */
  overdue?: boolean;
  /**
   * Date d'échéance réelle (TDB-07) : un retard est daté du jour (`date` = aujourd'hui) mais garde ici la date dépassée ;
   * un élément à venir y reprend sa date. Tri des retards par ancienneté et clé d'état lu (une échéance récurrente, à une
   * nouvelle date, redevient non lue). Absente : élément sans date propre (écart sans action, fiche à compléter…).
   */
  dueOn?: string;
  /**
   * Base de la clé d'état lu ; par défaut type|lien|intitulé — ne pas mettre de durée relative (« dans 3 j ») dans
   * l'intitulé. todoKey y ajoute la gravité et la date d'échéance (TDB-07).
   */
  key?: string;
  /** Nombre d'éléments sous-jacents regroupés dans l'échéance (badge), 1 par défaut. */
  count?: number;
  /** Échéance qui révèle une donnée de santé (déclaration CPAM d'un AT) : réservée aux rôles canSeeHealth. */
  health?: boolean;
};
/**
 * Clé d'état lu (TDB-07) : base (`key`, ou type|lien|intitulé), gravité (`tone`) et date d'échéance (`dueOn`) — une
 * échéance aggravée (à venir → dépassée) ou récurrente (nouvelle date) redevient non lue ; un retard garde sa clé de jour
 * en jour (jamais `date`, qui vaut aujourd'hui pour un retard). Les états lus enregistrés avant le paquet 4 (sans gravité
 * ni date) ne correspondent plus : chaque échéance déjà lue réapparaît non lue une seule fois.
 */
export const todoKey = (t: TodoItem) => [t.key ?? [t.kind, t.href ?? '', t.title].join('|'), t.tone, ...(t.dueOn ? [t.dueOn] : [])].join('|');
/** Rapprochement par identifiant ; repli sur le nom tant qu'un signal ne renseigne pas ownerIds. */
export const isMine = (t: TodoItem, user: { id: string; name: string }) => (t.ownerIds ? t.ownerIds.includes(user.id) : !!user.name && t.who.includes(user.name));
/**
 * Tri des échéances : dépassements d'abord, du plus ancien au plus récent (date d'échéance réelle, TDB-07), puis les
 * échéances à venir par date.
 */
export const byUrgency = (a: TodoItem, b: TodoItem) =>
  Number(!!b.overdue) - Number(!!a.overdue) || (a.dueOn ?? a.date).localeCompare(b.dueOn ?? b.date) || a.date.localeCompare(b.date);

export const initials = (name: string) =>
  name.replace(/[[\].]/g, '').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
