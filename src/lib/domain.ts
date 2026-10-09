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
export const STEP_ACTIONS = 3; // l'étape « Actions » exige au moins une action liée
export const STEP_CLOSED = EVENT_STEPS.length - 1;

export const SEVERITY = ['', 'G1 · faible', 'G2 · modérée', 'G3 · grave', 'G4 · très grave'];
export const severityTone = (g: number): Tone => (g >= 3 ? 'danger' : g === 2 ? 'warn' : 'neutral');

export type AnalysisMethod = '5m' | 'tree' | 'why' | '8d';
export const METHODS: [AnalysisMethod, string][] = [['5m', '5M'], ['tree', 'Arbre des causes'], ['why', '5 pourquoi'], ['8d', '8D']];
export const D8_STEPS = ['D1 · Équipe', 'D2 · Description', 'D3 · Actions immédiates', 'D4 · Causes racines', 'D5 · Actions correctives', 'D6 · Mise en œuvre', 'D7 · Prévention', 'D8 · Clôture'];

export const NC_ORIGINS = ['Fournisseurs', 'Fabrication', 'Conception BE', 'Mise en service', 'Réclamation client'];

// Statuts d'action ; « late » est dérivé de l'échéance.
export type ActionColumn = 'todo' | 'doing' | 'late' | 'verify' | 'done';
export const ACTION_COLUMNS: { key: ActionColumn; label: string; status: string; tone: Tone }[] = [
  { key: 'todo', label: 'À lancer', status: 'À lancer', tone: 'neutral' },
  { key: 'doing', label: 'En cours', status: 'En cours', tone: 'accent' },
  { key: 'late', label: 'En retard', status: 'En retard', tone: 'danger' },
  { key: 'verify', label: 'Efficacité à vérifier', status: 'Efficacité à vérifier', tone: 'warn' },
  { key: 'done', label: 'Clôturées · 30 j', status: 'Clôturée', tone: 'ok' },
];
export const columnOf = (key: ActionColumn) => ACTION_COLUMNS.find((c) => c.key === key)!;

export const ORIGINS: Record<string, { label: string; icon: string }> = {
  ev: { label: 'Événement', icon: 'ph-warning' },
  audit: { label: 'Audit', icon: 'ph-certificate' },
  risk: { label: 'Risques', icon: 'ph-shield-check' },
  watch: { label: 'Veille', icon: 'ph-scales' },
  client: { label: 'Client', icon: 'ph-chat-centered-text' },
  rev: { label: 'Revue de direction', icon: 'ph-users-three' },
  skills: { label: 'Habilitations', icon: 'ph-identification-badge' },
  prevention: { label: 'Prévention', icon: 'ph-clipboard-text' },
  docs: { label: 'Documents', icon: 'ph-files' },
  env: { label: 'Environnement', icon: 'ph-leaf' },
};

// Cotation des risques : gravité 1–4 × probabilité 1–4.
export const RISK_LEVELS = [
  { bg: 'oklch(0.30 0.03 152)', dot: 'var(--tone-ok-dot)', label: 'Faible 1–3' },
  { bg: 'oklch(0.33 0.05 78)', dot: 'var(--tone-warn-dot)', label: 'Modéré 4–6' },
  { bg: 'oklch(0.35 0.07 40)', dot: 'oklch(0.72 0.14 40)', label: 'Élevé 8–9' },
  { bg: 'oklch(0.37 0.09 22)', dot: 'var(--tone-danger-dot)', label: 'Critique 12–16' },
];
export const riskLevel = (n: number) => (n >= 12 ? 3 : n >= 8 ? 2 : n >= 4 ? 1 : 0);
export const RISK_ACTION_THRESHOLD = 8;

export const REQUIREMENT_EVAL: Record<string, { label: string; tone: Tone }> = {
  conforme: { label: 'Conforme', tone: 'ok' },
  ecart: { label: 'Écart', tone: 'danger' },
  analyse: { label: "Analyse d'écart en cours", tone: 'accent' },
  a_evaluer: { label: 'À évaluer', tone: 'warn' },
};

export type SkillState = 'v' | 's' | 'x' | 'r' | 'n';
export const SKILL_STATES: Record<SkillState, { label: string; icon: string; bg: string; fg: string; border: string }> = {
  v: { label: 'Valide', icon: 'ph-check', bg: TONE.ok.bg, fg: TONE.ok.fg, border: '1px solid transparent' },
  s: { label: 'Expire sous 60 jours', icon: 'ph-clock', bg: TONE.warn.bg, fg: TONE.warn.fg, border: '1px solid transparent' },
  x: { label: 'Expiré', icon: 'ph-x', bg: TONE.danger.bg, fg: TONE.danger.fg, border: '1px solid transparent' },
  r: { label: 'Requis, jamais suivi', icon: 'ph-warning', bg: 'transparent', fg: TONE.danger.dot, border: `1px dashed ${TONE.danger.dot}` },
  n: { label: 'Non requis', icon: 'ph-minus', bg: 'transparent', fg: 'var(--color-neutral-700)', border: '1px solid transparent' },
};
export const SKILL_SOON_DAYS = 60;

export const FINDING_KINDS: Record<string, { label: string; tone: Tone }> = {
  ecart_mineur: { label: 'Écart mineur', tone: 'danger' },
  piste: { label: 'Piste de progrès', tone: 'warn' },
  point_fort: { label: 'Point fort', tone: 'ok' },
};

// ─── Navigation, écrans et rôles ────────────────────────────────────────────

export type ScreenKey =
  | 'dashboard' | 'events' | 'actions' | 'prevention' | 'risks' | 'skills'
  | 'watch' | 'audits' | 'docs' | 'env' | 'mobile';

export const SCREENS: Record<ScreenKey, { path: string; title: string; label: string; icon: string }> = {
  dashboard: { path: '/', title: 'Tableau de bord QHSE', label: 'Tableau de bord', icon: 'ph-gauge' },
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
  { label: 'Pilotage', items: ['dashboard'] },
  { label: 'Terrain', items: ['events', 'actions', 'prevention'] },
  { label: 'Prévention', items: ['risks', 'skills'] },
  { label: 'Système', items: ['watch', 'audits', 'docs', 'env'] },
];

export type Role = 'Animateur QHSE' | 'Direction' | 'Chef de service' | 'Chef de projet' | 'Salarié';

// Rôle → utilisateur de démonstration et écrans autorisés (null = tous).
export const ROLES: Record<Role, { personId: string; screens: ScreenKey[] | null }> = {
  'Animateur QHSE': { personId: 'clefevre', screens: null },
  Direction: { personId: 'hmarchand', screens: null },
  'Chef de service': { personId: 'sbenali', screens: ['dashboard', 'events', 'actions', 'prevention', 'risks', 'skills', 'watch'] },
  'Chef de projet': { personId: 'edubois', screens: ['dashboard', 'events', 'actions', 'prevention'] },
  Salarié: { personId: 'tnguyen', screens: ['events', 'actions', 'skills'] },
};
export const ROLE_KEYS = Object.keys(ROLES) as Role[];
export const DEFAULT_ROLE: Role = 'Animateur QHSE';

export const canSee = (role: Role, screen: ScreenKey) => {
  const allowed = ROLES[role].screens;
  return screen === 'mobile' || !allowed || allowed.includes(screen);
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

/** Échéance affichée dans « À traiter dans les 15 jours » et dans le panneau de notifications. */
export type TodoItem = { date: string; kind: string; tone: Tone; title: string; who: string; href?: string };

export const initials = (name: string) =>
  name.replace(/[[\].]/g, '').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
