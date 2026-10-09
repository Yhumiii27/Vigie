// Référentiels métier partagés (serveur et client).

export type Tone = 'danger' | 'warn' | 'ok' | 'neutral' | 'accent';

// Couleurs de statut : variables définies dans vigie.css.
export const TONE = {
  danger: { fg: 'var(--tone-danger-fg)', bg: 'var(--tone-danger-bg)', dot: 'var(--tone-danger-dot)' },
  warn: { fg: 'var(--tone-warn-fg)', bg: 'var(--tone-warn-bg)', dot: 'var(--tone-warn-dot)' },
  ok: { fg: 'var(--tone-ok-fg)', bg: 'var(--tone-ok-bg)', dot: 'var(--tone-ok-dot)' },
  neutral: { fg: 'var(--color-neutral-100)', bg: 'var(--color-neutral-800)', dot: 'var(--color-neutral-500)' },
  accent: { fg: 'var(--color-accent-100)', bg: 'var(--color-accent-800)', dot: 'var(--color-accent)' },
} as const satisfies Record<Tone, { fg: string; bg: string; dot: string }>;

export type EventType = 'AT' | 'PA' | 'SD' | 'NC' | 'RC' | 'ENV';

export const EVENT_TYPES: Record<EventType, { label: string; tone: Tone; icon: string }> = {
  AT: { label: 'Accident', tone: 'danger', icon: 'ph-first-aid' },
  PA: { label: 'Presque-accident', tone: 'warn', icon: 'ph-warning' },
  SD: { label: 'Situation dangereuse', tone: 'warn', icon: 'ph-warning-octagon' },
  NC: { label: 'Non-conformité', tone: 'accent', icon: 'ph-x-square' },
  RC: { label: 'Réclamation client', tone: 'accent', icon: 'ph-chat-centered-text' },
  ENV: { label: 'Environnement', tone: 'neutral', icon: 'ph-leaf' },
};
export const EVENT_TYPE_KEYS = Object.keys(EVENT_TYPES) as EventType[];

export const EVENT_STEPS = ['Déclaré', 'Qualifié', 'Analyse des causes', 'Actions', 'Efficacité vérifiée', 'Clôturé'] as const;
export const STEP_QUALIFIED = 1; // l'étape « Qualifié » exige un pilote désigné
export const STEP_ACTIONS = 3; // l'étape « Actions » exige au moins une action liée
export const STEP_CLOSED = EVENT_STEPS.length - 1;
/** Statut affiché d'un événement classé sans suite (remplace l'étape dans les listes). */
export const EVENT_DISMISSED = 'Classé sans suite';
/** Délais suivis par les échéances (jours calendaires). */
export const QUALIFY_DELAY_DAYS = 2; // qualification sous 48 h après la déclaration
export const CPAM_DELAY_DAYS = 2; // déclaration d'accident du travail à la CPAM sous 48 h

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

// Statuts d'action ; « late » est dérivé de l'échéance. « cancelled » est un statut stocké (annulation tracée),
// sans colonne dans le Kanban.
export type ActionColumn = 'todo' | 'doing' | 'late' | 'verify' | 'done' | 'cancelled';
export const ACTION_COLUMNS: { key: ActionColumn; label: string; status: string; tone: Tone }[] = [
  { key: 'todo', label: 'À lancer', status: 'À lancer', tone: 'neutral' },
  { key: 'doing', label: 'En cours', status: 'En cours', tone: 'accent' },
  { key: 'late', label: 'En retard', status: 'En retard', tone: 'danger' },
  { key: 'verify', label: 'Efficacité à vérifier', status: 'Efficacité à vérifier', tone: 'warn' },
  { key: 'done', label: 'Clôturées · 30 j', status: 'Clôturée', tone: 'ok' },
];
export const ACTION_CANCELLED = { key: 'cancelled' as ActionColumn, label: 'Annulées', status: 'Annulée', tone: 'neutral' as Tone };
export const columnOf = (key: ActionColumn) => ACTION_COLUMNS.find((c) => c.key === key) ?? ACTION_CANCELLED;
/** Statuts stockés d'une action. */
export const ACTION_STATUSES = ['todo', 'doing', 'verify', 'done', 'cancelled'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
/** Action encore à mener (ni clôturée, ni annulée). */
export const isOpenActionStatus = (status: string) => status !== 'done' && status !== 'cancelled';
/** Action terminée pour les règles de rattachement (recyclage planifié, blocages) : clôturée ou annulée. */
export const isClosedActionStatus = (status: string) => !isOpenActionStatus(status);
/** Libellé de la colonne Clôturées selon le filtre d'historique. */
export const CLOSED_ALL_LABEL = 'Clôturées · toutes';
/** Filtre d'affichage du plan (?etat=…). */
export const PLAN_SCOPES = [
  ['', 'Plan en cours', 'ph-kanban'], // ouvertes + clôturées 30 j (défaut)
  ['historique', 'Historique complet', 'ph-clock-counter-clockwise'], // + toutes les clôturées
  ['annulees', 'Annulées', 'ph-prohibit'],
] as const;

// `path` : écran d'arrivée quand la source précise d'une action ne peut pas être résolue (origine toujours cliquable).
export const ORIGINS: Record<string, { label: string; icon: string; path: string }> = {
  ev: { label: 'Événement', icon: 'ph-warning', path: '/evenements' },
  audit: { label: 'Audit', icon: 'ph-certificate', path: '/audits' },
  risk: { label: 'Risques', icon: 'ph-shield-check', path: '/risques' },
  watch: { label: 'Veille', icon: 'ph-scales', path: '/veille' },
  client: { label: 'Client', icon: 'ph-chat-centered-text', path: '/evenements?type=RC' },
  rev: { label: 'Revue de direction', icon: 'ph-users-three', path: '/audits' },
  skills: { label: 'Habilitations', icon: 'ph-identification-badge', path: '/habilitations' },
  prevention: { label: 'Prévention', icon: 'ph-clipboard-text', path: '/prevention' },
  docs: { label: 'Documents', icon: 'ph-files', path: '/documents' },
  env: { label: 'Environnement', icon: 'ph-leaf', path: '/environnement' },
};
/** Origines dont l'action peut être rattachée à un événement (sélecteur « Événement lié »). */
export const EVENT_ORIGINS = ['ev', 'client'];

/** Longueur maximale d'un motif (annulation, archivage, classement sans suite, réouverture). */
export const REASON_MAX = 1000;
/** @deprecated alias de REASON_MAX (plan du domaine actions). */
export const CANCEL_REASON_MAX = REASON_MAX;

/** Lien vers la source d'une action d'origine « prevention » : plan (PP-…) ou permis (PF-… / PE-…). */
export const preventionRefHref = (ref: string) =>
  /^PP-/.test(ref) ? `/prevention?plan=${encodeURIComponent(ref)}`
    : /^P[FE]-/.test(ref) ? `/prevention?onglet=permis&permis=${encodeURIComponent(ref)}`
      : '/prevention';
/** Domaine d'exigence de veille relié aux écarts calculés des plans de prévention (R. 4512-6). */
export const PREVENTION_REQUIREMENT_DOMAIN = 'Plans de prévention';

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
  residualHigh: { label: 'Résiduel encore élevé', tone: 'danger', hint: `Toutes les actions sont clôturées mais le résiduel reste ≥ ${RISK_ACTION_THRESHOLD} : nouvelle action nécessaire.` },
  toReview: { label: 'Résiduel à recoter', tone: 'warn', hint: "Toutes les actions sont clôturées : recotez le risque résiduel après vérification d'efficacité." },
};
/** Libellé « type » des échéances DUERP (tableau de bord, notifications, page À faire). */
export const RISK_TODO_KIND = 'DUERP';
/** Valeur de requirements.linkedTo pour l'exigence « Document unique » (R. 4121-1). */
export const DUERP_REQUIREMENT_LINK = 'duerp';

export const REQUIREMENT_EVAL: Record<string, { label: string; tone: Tone }> = {
  conforme: { label: 'Conforme', tone: 'ok' },
  ecart: { label: 'Écart', tone: 'danger' },
  analyse: { label: "Analyse d'écart en cours", tone: 'accent' },
  a_evaluer: { label: 'À évaluer', tone: 'warn' },
};
/** Évaluations qui appellent une action dans le plan d'actions unique. */
export const REQUIREMENT_NEEDS_ACTION = ['ecart', 'analyse'] as const;
/** Périodicité de réévaluation de la conformité d'une exigence (alerte dans les échéances). */
export const REQUIREMENT_REVIEW_MONTHS = 12;

export type SkillState = 'v' | 's' | 'x' | 'r' | 'n';
export const SKILL_STATES: Record<SkillState, { label: string; icon: string; bg: string; fg: string; border: string }> = {
  v: { label: 'Valide', icon: 'ph-check', bg: TONE.ok.bg, fg: TONE.ok.fg, border: '1px solid transparent' },
  s: { label: 'Expire sous 60 jours', icon: 'ph-clock', bg: TONE.warn.bg, fg: TONE.warn.fg, border: '1px solid transparent' },
  x: { label: 'Expiré', icon: 'ph-x', bg: TONE.danger.bg, fg: TONE.danger.fg, border: '1px solid transparent' },
  r: { label: 'Requis, jamais suivi', icon: 'ph-warning', bg: 'transparent', fg: TONE.danger.dot, border: `1px dashed ${TONE.danger.dot}` },
  n: { label: 'Non requis', icon: 'ph-minus', bg: 'transparent', fg: 'var(--color-neutral-700)', border: '1px solid transparent' },
};
export const SKILL_SOON_DAYS = 60;

/** Filtres de la matrice des habilitations. */
export const SKILL_FILTERS = [
  { key: 'a_traiter', label: 'À traiter' }, // au moins une case s, x ou r, ou un manque pendant une affectation
  { key: 'sortis', label: 'Sortis' }, // salariés sortis de l'effectif (archivés)
] as const;
export type SkillFilter = (typeof SKILL_FILTERS)[number]['key'];

export const FINDING_KINDS: Record<string, { label: string; tone: Tone }> = {
  ecart_mineur: { label: 'Écart mineur', tone: 'danger' },
  piste: { label: 'Piste de progrès', tone: 'warn' },
  point_fort: { label: 'Point fort', tone: 'ok' },
};

/** Nature d'un élément du programme annuel selon sa ligne (intitulé repris dans les échéances). */
export const PLAN_TRACK_KINDS: Record<string, string> = {
  'Audits internes': 'Audit interne', 'Visites sécurité': 'Visite sécurité', Certification: 'Certification', Fournisseurs: 'Audit fournisseur', 'Revues de direction': 'Revue de direction',
};
export const planTrackKind = (track: string) => PLAN_TRACK_KINDS[track] ?? track;

/** État calculé d'un élément du programme : réalisé, échéance passée non confirmée, à venir. */
export const PLAN_ITEM_STATES = {
  done: { label: 'Réalisé', tone: 'ok' },
  late: { label: 'À confirmer', tone: 'warn' },
  upcoming: { label: 'À venir', tone: 'neutral' },
} as const satisfies Record<string, { label: string; tone: Tone }>;
export type PlanItemState = keyof typeof PLAN_ITEM_STATES;

/** Audit de suivi ou fin de validité du certificat considérés comme proches (jours). */
export const CERT_SOON_DAYS = 30;

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

// ─── Navigation, écrans et rôles ────────────────────────────────────────────

export type ScreenKey =
  | 'dashboard' | 'todo' | 'events' | 'actions' | 'prevention' | 'risks' | 'skills'
  | 'watch' | 'audits' | 'docs' | 'env' | 'mobile';

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
};

export const NAV: { label: string; items: ScreenKey[] }[] = [
  { label: 'Pilotage', items: ['dashboard', 'todo'] },
  { label: 'Terrain', items: ['events', 'actions', 'prevention'] },
  { label: 'Prévention', items: ['risks', 'skills'] },
  { label: 'Système', items: ['watch', 'audits', 'docs', 'env'] },
];

export type Role = 'Animateur QHSE' | 'Direction' | 'Chef de service' | 'Chef de projet' | 'Salarié';

// Rôle → utilisateur de démonstration, écrans autorisés (null = tous) et écrans en consultation seule.
// « docs » reste en dernier dans chaque liste : homeOf() prend le premier écran.
export const ROLES: Record<Role, { personId: string; screens: ScreenKey[] | null; readOnly?: ScreenKey[] }> = {
  'Animateur QHSE': { personId: 'clefevre', screens: null },
  Direction: { personId: 'hmarchand', screens: null },
  'Chef de service': { personId: 'sbenali', screens: ['dashboard', 'events', 'actions', 'prevention', 'risks', 'skills', 'watch', 'docs'], readOnly: ['docs'] },
  'Chef de projet': { personId: 'edubois', screens: ['dashboard', 'events', 'actions', 'prevention', 'docs'], readOnly: ['docs'] },
  Salarié: { personId: 'tnguyen', screens: ['events', 'actions', 'skills', 'docs'], readOnly: ['docs'] },
};
export const ROLE_KEYS = Object.keys(ROLES) as Role[];
export const DEFAULT_ROLE: Role = 'Animateur QHSE';
/** Identifiant du choix « Tous les sites » (sélecteur de site, champ Site des formulaires). */
export const ALL_SITES = 'all';

// « À faire » est ouvert à tous : chaque rôle n'y voit que les échéances qu'il peut ouvrir (loadVisibleTodo).
export const canSee = (role: Role, screen: ScreenKey) => {
  const allowed = ROLES[role].screens;
  return screen === 'mobile' || screen === 'todo' || !allowed || allowed.includes(screen);
};
/** Écran correspondant à un lien interne (pour filtrer les échéances selon les droits du rôle). */
export function screenOfHref(href: string): ScreenKey {
  const path = href.split('?')[0];
  const hit = (Object.entries(SCREENS) as [ScreenKey, { path: string }][]).find(([, s]) => s.path !== '/' && (path === s.path || path.startsWith(`${s.path}/`)));
  return hit?.[0] ?? 'dashboard';
}
export const canOpen = (role: Role, href?: string) => !href || canSee(role, screenOfHref(href));

export const homeOf = (role: Role): ScreenKey => ROLES[role].screens?.[0] ?? 'dashboard';

// Droits : l'encadrement saisit et modifie ; l'animateur QHSE et la direction valident
// (vérification d'efficacité, approbation des documents, versions du DUERP).
export const canManage = (role: Role) => role !== 'Salarié';
export const canApprove = (role: Role) => role === 'Animateur QHSE' || role === 'Direction';
/** Rôle Salarié : ne voit que ses propres données (habilitations, signalements, actions dont il est pilote). */
export const isEmployee = (role: Role) => role === 'Salarié';
/** Saisie sur un écran : encadrement, écran autorisé et non limité à la consultation. */
export const canEdit = (role: Role, screen: ScreenKey) =>
  canManage(role) && canSee(role, screen) && !(ROLES[role].readOnly ?? []).includes(screen);

/** Animateur QHSE responsable des alertes transverses (habilitations, constats…), en attendant un responsable par site. */
export const QHSE_LEAD = ROLES['Animateur QHSE'].personId;
/** @deprecated alias de QHSE_LEAD (plan du domaine habilitations). */
export const SKILL_ALERT_OWNER = QHSE_LEAD;

/** Procédure de référence (document maîtrisé) affichée en lien « Procédure » sur un écran. */
export const SCREEN_PROCEDURES: Partial<Record<ScreenKey, string>> = { prevention: 'PR-QHSE-005' };

// ─── Échéances (« À traiter », page À faire, notifications, badges) ─────────

/** Horizon des échéances (« À traiter dans les 15 jours », page À faire, badges). */
export const TODO_HORIZON_DAYS = 15;
/** Contrôles réglementaires : anticipés à 30 jours (KPI « Contrôles < 30 j », échéances, badge veille). */
export const CONTROL_HORIZON_DAYS = 30;
/** Panneau de notifications : dépassements + échéances des 7 prochains jours. */
export const NOTIFY_HORIZON_DAYS = 7;

/** Échéance affichée dans « À traiter », la page À faire, les notifications et les badges. */
export type TodoItem = {
  date: string; kind: string; tone: Tone; title: string; who: string;
  /** Lien vers l'élément (obligatoire en pratique : filtre par rôle et badge de l'écran, via screenOfHref). */
  href?: string;
  /** Personnes concernées (pilote, responsable, salarié) : filtre « Mes échéances » et vue Salarié. */
  ownerIds?: string[];
  /** Échéance dépassée ou retard : en tête de liste, urgente dans les notifications. */
  overdue?: boolean;
  /** Clé stable (état lu) ; par défaut type|lien|intitulé — ne pas mettre de durée relative (« dans 3 j ») dans l'intitulé. */
  key?: string;
  /** Nombre d'éléments sous-jacents regroupés dans l'échéance (badge), 1 par défaut. */
  count?: number;
};
export const todoKey = (t: TodoItem) => t.key ?? [t.kind, t.href ?? '', t.title].join('|');
/** Rapprochement par identifiant ; repli sur le nom tant qu'un signal ne renseigne pas ownerIds. */
export const isMine = (t: TodoItem, user: { id: string; name: string }) => (t.ownerIds ? t.ownerIds.includes(user.id) : !!user.name && t.who.includes(user.name));
/** Tri des échéances : dépassements d'abord, puis par date. */
export const byUrgency = (a: TodoItem, b: TodoItem) => Number(!!b.overdue) - Number(!!a.overdue) || a.date.localeCompare(b.date);

export const initials = (name: string) =>
  name.replace(/[[\].]/g, '').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
