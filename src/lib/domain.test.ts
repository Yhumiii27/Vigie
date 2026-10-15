import { describe, expect, it } from 'vitest';
import {
  ACTION_COLUMNS, QUALIFICATION_FIELDS, ROLE_KEYS, ROLE_PRECEDENCE, byUrgency, canApprove, canEdit, canManage, canOpen, canReadReviewDossier,
  canSee, canSeeHealth, columnOf, homeOf, initials, isClosedActionStatus, isEmployee, isMine, isOpenActionStatus, isReadOnly, planTrackKind,
  riskLevel, screenOfHref, severityTone, todoKey, type Role, type ScreenKey, type TodoItem,
} from './domain';

// Référentiels et droits partagés (QUA-03) : cotation des risques, colonnes d'actions, écrans et droits par rôle, échéances.

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

describe('colonnes du plan d’actions', () => {
  it('colonne de chaque statut, « Annulée » hors Kanban', () => {
    expect(ACTION_COLUMNS.map((c) => c.key)).toEqual(['todo', 'doing', 'late', 'verify', 'done']);
    expect(columnOf('late')).toMatchObject({ status: 'En retard', tone: 'danger' });
    expect(columnOf('cancelled')).toMatchObject({ status: 'Annulée', tone: 'neutral' });
  });
  it('action ouverte : ni clôturée ni annulée', () => {
    expect(['todo', 'doing', 'verify'].map(isOpenActionStatus)).toEqual([true, true, true]);
    expect(['done', 'cancelled'].map(isClosedActionStatus)).toEqual([true, true]);
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
    expect(todoKey(item({ href: '/actions?action=A-1' }))).toBe('Action|/actions?action=A-1|T');
    expect(todoKey(item({ key: 'site-lead|ville-b' }))).toBe('site-lead|ville-b');
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
