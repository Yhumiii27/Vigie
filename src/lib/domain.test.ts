import { describe, expect, it } from 'vitest';
import {
  ACTION_AVANCEMENTS, ACTION_DOMAINS, ACTION_PRIORITIES, ACTION_RISK_LEVELS, ACTION_SOURCES, AVANCEMENT, DOMAIN_KEYS, EVENT_AUDIT_LINK_KINDS,
  FOLLOW_REASONS, FOLLOW_REASON_KEYS, LEGACY_ORIGIN_LABELS, NOTIFICATION_KINDS, OPEN_AVANCEMENTS, PRIORITY_KEYS, QUALIFICATION_FIELDS, REVIEW_FOLLOW_UP, RISK_LEVEL_MAX,
  ROLE_KEYS, ROLE_PRECEDENCE, SOURCE_KEYS, SOURCE_LINK_KINDS, VERIFY_METHODS, VERIFY_METHOD_KEYS, byUrgency, canApprove, canEdit, canManage, canOpen,
  canReadReviewDossier, canSee, canSeeHealth, homeOf, initials, isAvancement, isClosedActionStatus, isEmployee, isMine, isOpenAvancement, isReadOnly, isReminderAvancement,
  matchListLabel, normalizeListLabel, planTrackKind, proposedDomain, riskLevel, screenOfHref, severityTone, sqlList, todoKey,
  type Role, type ScreenKey, type TodoItem,
} from './domain';

// Référentiels et droits partagés (QUA-03) : cotation des risques, listes du plan d'actions, écrans et droits par rôle, échéances.

describe('cotation des risques (gravité × probabilité)', () => {
  it('niveaux Faible 1–3, Modéré 4–6, Élevé 8–9, Critique 12–16', () => {
    expect([1, 2, 3].map(riskLevel)).toEqual([0, 0, 0]);
    expect([4, 6].map(riskLevel)).toEqual([1, 1]);
    expect([8, 9].map(riskLevel)).toEqual([2, 2]);
    expect([12, 16].map(riskLevel)).toEqual([3, 3]);
  });
  it('ton de la gravité d’un événement', () => {
    expect([1, 2, 3, 4].map(severityTone)).toEqual(['neutral', 'warn', 'danger', 'danger']);
  });
});

describe('avancement des actions (§ 5.1)', () => {
  it('dix valeurs dans l’ordre, libellés Vigie et Power Apps, groupes et tons', () => {
    expect(ACTION_AVANCEMENTS).toEqual(['a_faire', 'initiee', 'p20', 'p40', 'p60', 'p80', 'reportee', 'terminee', 'verifiee', 'abandonnee']);
    expect(Object.keys(AVANCEMENT)).toEqual([...ACTION_AVANCEMENTS]);
    expect(ACTION_AVANCEMENTS.map((k) => AVANCEMENT[k].label)).toEqual([
      'À faire', 'Budgétée ou initiée', '20 %', '40 %', '60 %', '80 %', 'Reportée', 'Terminée — à vérifier', 'Vérifiée', 'Abandonnée',
    ]);
    expect(ACTION_AVANCEMENTS.map((k) => AVANCEMENT[k].powerApps)).toEqual([
      'A faire', 'Budgétée ou initiée', '20 %', '40 %', '60 %', '80 %', 'Reportée', 'Terminée', 'Vérifiée', 'Abandonnée',
    ]);
    expect(ACTION_AVANCEMENTS.map((k) => AVANCEMENT[k].group)).toEqual([
      'ouverte', 'ouverte', 'ouverte', 'ouverte', 'ouverte', 'ouverte', 'en_attente', 'realisee', 'close', 'close',
    ]);
    expect(ACTION_AVANCEMENTS.map((k) => AVANCEMENT[k].tone)).toEqual([
      'neutral', 'accent', 'accent', 'accent', 'accent', 'accent', 'neutral', 'warn', 'ok', 'neutral',
    ]);
    expect(ACTION_AVANCEMENTS.filter((k) => AVANCEMENT[k].canBeLate)).toEqual([...OPEN_AVANCEMENTS]);
  });
  it('ouverte (À faire → 80 %) et close (Vérifiée, Abandonnée) pour les dix valeurs', () => {
    expect(ACTION_AVANCEMENTS.map(isOpenAvancement)).toEqual([true, true, true, true, true, true, false, false, false, false]);
    // Rappel du mercredi (A10) : ouvertes et Terminées ; ni Reportée, ni Vérifiée, ni Abandonnée.
    expect(ACTION_AVANCEMENTS.map(isReminderAvancement)).toEqual([true, true, true, true, true, true, false, true, false, false]);
    expect(ACTION_AVANCEMENTS.map(isClosedActionStatus)).toEqual([false, false, false, false, false, false, false, false, true, true]);
    expect(ACTION_AVANCEMENTS.every(isAvancement)).toBe(true);
    // anciennes valeurs (avant 0005) : inconnues
    expect(['todo', 'doing', 'verify', 'done', 'cancelled', ''].map(isAvancement)).toEqual([false, false, false, false, false, false]);
    expect(['done', 'cancelled'].map(isClosedActionStatus)).toEqual([false, false]);
  });
});

describe('sources des actions (§ 12)', () => {
  it('24 sources dans l’ordre du QHSE (ses 22, plus Audit fournisseur et Déchets), avec leur cible', () => {
    expect(SOURCE_KEYS).toHaveLength(24);
    expect(Object.keys(ACTION_SOURCES)).toEqual([...SOURCE_KEYS]);
    expect(SOURCE_KEYS.map((k) => ACTION_SOURCES[k].label)).toEqual([
      'Analyse de risque (AST-EST)', 'Analyse de risque chimique', 'Analyse environnementale', 'Audit de certification ISO', 'Audit fournisseur',
      'Audit interne ISO', 'Audit terrain', 'Autorité publique', 'Causerie QSE', 'COMEX', 'Contrôle réglementaire', 'Déchets', 'DUERP',
      'Évènement QSE', 'Objectif QSE', 'Réclamation client', 'Réunion opérationnelle', 'Revue de direction', 'Revue documentaire',
      'Revue de processus', 'Veille réglementaire', 'HAZOP', 'Réserves', 'REX',
    ]);
    expect(Object.fromEntries(SOURCE_KEYS.map((k) => [k, ACTION_SOURCES[k].target]))).toEqual({
      analyse_risque: 'free', analyse_chimique: 'free', analyse_environnementale: 'free', audit_certification: 'audit', audit_fournisseur: 'audit',
      audit_interne: 'audit', audit_terrain: 'audit', autorite_publique: 'free', causerie: 'free', comex: 'free', controle_reglementaire: 'control',
      dechets: 'environment', duerp: 'risk', evenement: 'event', objectif: 'objective', reclamation_client: 'event', reunion_operationnelle: 'free',
      revue_direction: 'review', revue_documentaire: 'document', revue_processus: 'free', veille: 'requirement', hazop: 'free', reserves: 'free', rex: 'free',
    });
    for (const k of SOURCE_KEYS) expect(ACTION_SOURCES[k].path === null).toBe(ACTION_SOURCES[k].target === 'free');
    expect(ACTION_SOURCES.audit_fournisseur).toEqual({ label: 'Audit fournisseur', icon: 'ph-truck', target: 'audit', path: '/audits' });
    expect(ACTION_SOURCES.dechets).toEqual({ label: 'Déchets', icon: 'ph-recycle', target: 'environment', path: '/environnement' });
  });
  it('précisions affichées sous la liste des sources : AST-EST et Réserves seulement', () => {
    expect(SOURCE_KEYS.filter((k) => ACTION_SOURCES[k].hint)).toEqual(['analyse_risque', 'reserves']);
    expect(ACTION_SOURCES.analyse_risque.hint).toBe('AST : analyse de sécurité des tâches en contexte pyrotechnique ; EST : étude de sécurité technique.');
    expect(ACTION_SOURCES.reserves.hint).toBe("Réserves de réception d'un chantier ou d'une installation.");
  });
  it('types de lien de l’élément de la source ; événement ou audit unique', () => {
    expect(SOURCE_LINK_KINDS.event).toEqual(['event']);
    expect(SOURCE_LINK_KINDS.audit).toEqual(['finding', 'plan']);
    expect(SOURCE_LINK_KINDS.free).toEqual([]);
    expect(SOURCE_LINK_KINDS.environment).toEqual(['wastestream', 'wasteentry', 'requirement']); // action BSD (Déchets + exigence)
    expect(EVENT_AUDIT_LINK_KINDS).toEqual(['event', 'finding', 'plan']);
    expect(Object.keys(LEGACY_ORIGIN_LABELS).sort()).toEqual(['audit', 'client', 'docs', 'env', 'ev', 'prevention', 'rev', 'risk', 'skills', 'watch']);
  });
});

describe('autres listes des actions (§ 5)', () => {
  it('priorités, domaines, niveaux de risque, natures de vérification, motifs de suite', () => {
    expect(PRIORITY_KEYS.map((k) => ACTION_PRIORITIES[k].label)).toEqual(['Urgent', 'Moyen terme', 'Long terme']);
    expect(PRIORITY_KEYS.map((k) => ACTION_PRIORITIES[k].tone)).toEqual(['danger', 'warn', 'neutral']);
    expect(DOMAIN_KEYS.map((k) => ACTION_DOMAINS[k])).toEqual(['Qualité', 'Sécurité', 'Santé', 'Environnement', 'Sûreté']);
    expect(ACTION_RISK_LEVELS).toHaveLength(RISK_LEVEL_MAX + 1);
    expect(ACTION_RISK_LEVELS[0]).toBe('Niveau 0 — Supprimé');
    expect(ACTION_RISK_LEVELS[4]).toBe('Niveau 4 — Non maîtrisé');
    expect(VERIFY_METHOD_KEYS.map((k) => VERIFY_METHODS[k])).toEqual(['Audit / visite', 'Écrit', 'Réunion', 'Visuelle', 'Autre']);
    expect(FOLLOW_REASON_KEYS.map((k) => FOLLOW_REASONS[k])).toEqual(['Non efficace', 'Nouveau risque']);
    expect(REVIEW_FOLLOW_UP.cancelled.label).toBe('Action abandonnée');
    expect(NOTIFICATION_KINDS).toEqual({
      action_confiee: 'Action confiée', action_commentaire: 'Commentaire du responsable', action_preuve: 'Preuve ajoutée',
      signalement_suite: 'Suite de votre signalement',
    });
    expect(sqlList(['a', 'b'])).toBe("'a', 'b'");
  });
  it('rapprochement des libellés sans accents, casse ni espaces (import Power Apps)', () => {
    expect(normalizeListLabel(' Budgétée  ou INITIÉE ')).toBe('budgeteeouinitiee');
    expect(matchListLabel(AVANCEMENT, 'a faire')).toBe('a_faire');
    expect(matchListLabel(AVANCEMENT, 'À FAIRE')).toBe('a_faire');
    expect(matchListLabel(AVANCEMENT, '20%')).toBe('p20');
    expect(matchListLabel(AVANCEMENT, 'Budgetee ou initiee')).toBe('initiee');
    expect(matchListLabel(AVANCEMENT, 'TERMINÉE')).toBe('terminee');
    expect(matchListLabel(AVANCEMENT, 'Terminée — à vérifier')).toBe('terminee');
    expect(matchListLabel(AVANCEMENT, 'En cours')).toBeNull();
    expect(matchListLabel(AVANCEMENT, '')).toBeNull();
    expect(matchListLabel(ACTION_DOMAINS, 'surete')).toBe('surete');
    expect(matchListLabel(VERIFY_METHODS, 'audit/visite')).toBe('audit_visite');
    expect(matchListLabel(ACTION_PRIORITIES, 'moyen terme')).toBe('moyen_terme');
    expect(matchListLabel(ACTION_SOURCES, 'Evenement QSE')).toBe('evenement');
    expect(matchListLabel(ACTION_SOURCES, 'DECHETS')).toBe('dechets');
  });
  it('domaine proposé d’après l’événement, la source ou l’exigence', () => {
    expect(['AT', 'PA', 'SD', 'NC', 'RC', 'ENV'].map((eventType) => proposedDomain({ eventType }))).toEqual([
      'securite', 'securite', 'securite', 'qualite', 'qualite', 'environnement',
    ]);
    expect(proposedDomain({ source: 'duerp' })).toBe('securite');
    expect(proposedDomain({ source: 'revue_documentaire' })).toBe('qualite');
    expect(proposedDomain({ source: 'analyse_environnementale' })).toBe('environnement');
    expect(proposedDomain({ source: 'dechets' })).toBe('environnement');
    expect(proposedDomain({ source: 'audit_fournisseur' })).toBeNull();
    expect(proposedDomain({ source: 'comex' })).toBeNull();
    expect(proposedDomain({ eventType: 'NC', source: 'duerp' })).toBe('qualite'); // l'événement l'emporte
    expect(proposedDomain({ source: 'veille', requirementDomain: 'Environnement' })).toBe('environnement');
    expect(proposedDomain({ source: 'veille', requirementDomain: 'Santé-sécurité' })).toBe('securite');
    expect(proposedDomain({ source: 'veille', requirementDomain: 'Sécurité — machines' })).toBe('securite');
    expect(proposedDomain({ source: 'veille', requirementDomain: 'ICPE — Environnement' })).toBe('environnement');
    expect(proposedDomain({ source: 'veille', requirementDomain: 'qualite' })).toBe('qualite');
    expect(proposedDomain({ source: 'veille', requirementDomain: 'Machines — conception et marquage CE' })).toBeNull();
    expect(proposedDomain({ source: 'veille', requirementDomain: 'Code du travail — Santé-sécurité' })).toBe('securite');
    // Thème avant « — » essayé avant la précision (écart assumé au plan § 2.1, src/lib/domain.ts).
    expect(proposedDomain({ source: 'veille', requirementDomain: 'Environnement — Santé-sécurité' })).toBe('environnement');
    expect(proposedDomain({ source: 'veille', requirementDomain: 'Déchets' })).toBeNull();
    expect(proposedDomain({})).toBeNull();
  });
});

describe('écrans et droits par rôle', () => {
  const screens: ScreenKey[] = ['dashboard', 'todo', 'events', 'actions', 'prevention', 'risks', 'skills', 'watch', 'audits', 'docs', 'env', 'mobile', 'contributions'];
  const visible = (role: Role) => screens.filter((s) => canSee(role, s));

  it('écrans ouverts', () => {
    expect(visible('Animateur QHSE')).toEqual(screens);
    expect(visible('Direction')).toEqual(screens);
    expect(visible('Chef de service')).toEqual(['dashboard', 'todo', 'events', 'actions', 'prevention', 'risks', 'skills', 'watch', 'audits', 'docs', 'mobile', 'contributions']);
    expect(visible('Chef de projet')).toEqual(['dashboard', 'todo', 'events', 'actions', 'prevention', 'risks', 'audits', 'docs', 'mobile', 'contributions']);
    expect(visible('Salarié')).toEqual(['todo', 'events', 'actions', 'risks', 'skills', 'docs', 'mobile', 'contributions']);
  });
  it('saisie, validation, données de santé', () => {
    expect(ROLE_KEYS.filter(canManage)).toEqual(['Animateur QHSE', 'Direction', 'Chef de service', 'Chef de projet']);
    expect(ROLE_KEYS.filter(canApprove)).toEqual(['Animateur QHSE', 'Direction']);
    expect(ROLE_KEYS.filter(canSeeHealth)).toEqual(['Animateur QHSE', 'Direction']);
    expect(ROLE_KEYS.filter(isEmployee)).toEqual(['Salarié']);
  });
  it('plan d’actions : saisie réservée au QHSE (canEdit = canApprove), consultation seule pour l’encadrement (ACT-22, D3)', () => {
    for (const r of ROLE_KEYS) expect(canEdit(r, 'actions')).toBe(canApprove(r));
    expect(isReadOnly('Chef de service', 'actions')).toBe(true);
    expect(isReadOnly('Chef de projet', 'actions')).toBe(true);
    expect(ROLE_KEYS.filter((r) => isReadOnly(r, 'actions'))).toEqual(['Chef de service', 'Chef de projet']);
    expect(ROLE_KEYS.filter((r) => canSee(r, 'actions'))).toEqual(ROLE_KEYS);
  });
  it('documents en consultation seule hors validation ; écrans fermés jamais modifiables', () => {
    expect(ROLE_KEYS.filter((r) => canEdit(r, 'docs'))).toEqual(['Animateur QHSE', 'Direction']);
    expect(ROLE_KEYS.filter((r) => canEdit(r, 'skills'))).toEqual(['Animateur QHSE', 'Direction', 'Chef de service']);
    expect(ROLE_KEYS.filter((r) => canEdit(r, 'events'))).toEqual(['Animateur QHSE', 'Direction', 'Chef de service', 'Chef de projet']);
  });
  it('DUERP en consultation pour tous (DUE-01), audits en consultation pour l’encadrement (AUD-02)', () => {
    expect(ROLE_KEYS.filter((r) => canSee(r, 'risks'))).toEqual(ROLE_KEYS);
    expect(ROLE_KEYS.filter((r) => canEdit(r, 'risks'))).toEqual(['Animateur QHSE', 'Direction', 'Chef de service']);
    expect(ROLE_KEYS.filter((r) => canSee(r, 'audits'))).toEqual(['Animateur QHSE', 'Direction', 'Chef de service', 'Chef de projet']);
    expect(ROLE_KEYS.filter((r) => canEdit(r, 'audits'))).toEqual(['Animateur QHSE', 'Direction']);
    expect(ROLE_KEYS.filter(canReadReviewDossier)).toEqual(['Animateur QHSE', 'Direction']);
    expect(ROLE_KEYS.filter((r) => isReadOnly(r, 'audits'))).toEqual(['Chef de service', 'Chef de projet']);
  });
  it('écran d’accueil et précédence des rôles Entra', () => {
    expect(ROLE_KEYS.map(homeOf)).toEqual(['dashboard', 'dashboard', 'dashboard', 'dashboard', 'events']);
    expect(ROLE_PRECEDENCE[0]).toBe('Direction');
    expect([...ROLE_PRECEDENCE].sort()).toEqual([...ROLE_KEYS].sort());
  });
  it('écran d’un lien interne (filtre des échéances par rôle)', () => {
    expect(screenOfHref('/habilitations?salarie=x&titre=y')).toBe('skills');
    expect(screenOfHref('/prevention/carte')).toBe('prevention');
    expect(screenOfHref('/')).toBe('dashboard');
    expect(screenOfHref('/inconnu')).toBe('dashboard');
    expect(canOpen('Salarié', '/veille')).toBe(false);
    expect(canOpen('Salarié', '/actions?action=A-1')).toBe(true);
    expect(canOpen('Salarié', undefined)).toBe(true);
    expect(canOpen('Chef de projet', '/risques')).toBe(true);
    expect(screenOfHref('/audits/contributions?revue=3')).toBe('contributions');
    expect(screenOfHref('/audits?annee=2026&revue=3#revue')).toBe('audits');
    expect(screenOfHref('/audits#revue')).toBe('audits');
    expect(canOpen('Salarié', '/audits/contributions')).toBe(true);
    expect(canOpen('Salarié', '/audits')).toBe(false);
  });
});

describe('échéances', () => {
  const item = (over: Partial<TodoItem>): TodoItem => ({ date: '2026-10-09', kind: 'Action', tone: 'warn', title: 'T', who: '', siteId: null, ...over });
  it('« mes échéances » : par identifiant, repli sur le nom sans ownerIds', () => {
    const user = { id: 'tnguyen', name: '[T. Nguyen]' };
    expect(isMine(item({ ownerIds: ['tnguyen'] }), user)).toBe(true);
    expect(isMine(item({ ownerIds: ['autre'], who: '[T. Nguyen]' }), user)).toBe(false);
    expect(isMine(item({ who: '[T. Nguyen] · [C. Lefèvre]' }), user)).toBe(true);
    expect(isMine(item({ who: 'x' }), { id: 'u', name: '' })).toBe(false);
  });
  it('tri : dépassements d’abord, puis par date ; clé stable', () => {
    const list = [item({ date: '2026-10-12' }), item({ date: '2026-10-20', overdue: true }), item({ date: '2026-10-10' })];
    expect(list.sort(byUrgency).map((t) => t.date)).toEqual(['2026-10-20', '2026-10-10', '2026-10-12']);
    expect(todoKey(item({ href: '/actions?action=A-1' }))).toBe('Action|/actions?action=A-1|T|warn');
    expect(todoKey(item({ key: 'site-lead|ville-b' }))).toBe('site-lead|ville-b|warn');
  });
  it('TDB-07 : retards triés par ancienneté (date d’échéance réelle), tous datés du jour', () => {
    const late = (dueOn: string, title: string) => item({ date: '2026-10-09', overdue: true, tone: 'danger', dueOn, title });
    const list = [late('2026-10-01', 'récent'), item({ date: '2026-10-11', dueOn: '2026-10-11', title: 'à venir' }), late('2026-08-15', 'ancien'), late('2026-09-20', 'moyen')];
    expect(list.sort(byUrgency).map((t) => t.title)).toEqual(['ancien', 'moyen', 'récent', 'à venir']);
  });
  it('TDB-07 : clé d’état lu avec gravité et date d’échéance ; un retard garde sa clé de jour en jour', () => {
    const upcoming = item({ href: '/veille?controle=1', title: 'VGP', tone: 'warn', date: '2026-10-20', dueOn: '2026-10-20' });
    expect(todoKey(upcoming)).toBe('Action|/veille?controle=1|VGP|warn|2026-10-20');
    // Aggravée (dépassée) : nouvelle clé, l'échéance redevient non lue.
    const overdue = { ...upcoming, tone: 'danger' as const, overdue: true, date: '2026-10-21' };
    expect(todoKey(overdue)).not.toBe(todoKey(upcoming));
    // Le lendemain, même retard : même clé (la date du jour n'y figure pas).
    expect(todoKey({ ...overdue, date: '2026-10-22' })).toBe(todoKey(overdue));
    // Récurrente (contrôle suivant) : nouvelle date, nouvelle clé.
    expect(todoKey({ ...upcoming, dueOn: '2027-04-20', date: '2027-04-20' })).not.toBe(todoKey(upcoming));
    // Élément sans date propre : clé sans date, stable.
    expect(todoKey(item({ key: 'papripact|2026|cse', date: '2026-10-09' }))).toBe(todoKey(item({ key: 'papripact|2026|cse', date: '2026-10-10' })));
  });
});

describe('qualification des événements (EVT-05)', () => {
  it('données exigées par type', () => {
    expect(QUALIFICATION_FIELDS.AT).toEqual(['victim', 'circumstances', 'location']);
    expect(QUALIFICATION_FIELDS.RC).toEqual(['customer', 'customerRef']);
    expect(QUALIFICATION_FIELDS.ENV).toEqual(['envAspect', 'envMedium']);
  });
});

describe('libellés', () => {
  it('initiales, nature d’un élément du programme', () => {
    expect(initials('[C. Lefèvre]')).toBe('CL');
    expect(initials('Jean-Paul Martin Durand')).toBe('JM');
    expect(planTrackKind('Audits internes')).toBe('Audit interne');
    expect(planTrackKind('Autre ligne')).toBe('Autre ligne');
  });
});
