import { describe, expect, it } from 'vitest';
import {
  ACTION_LABEL_MAX, KANBAN_COLUMNS, MISSING_LABELS, MOVE_KINDS, NON_QSE_LINK_KINDS, NON_QSE_LINK_MESSAGE, PLAN_SCOPES, PLAN_VIEWS,
  QHSE_ONLY_CREATE_MESSAGE, REASON_REQUIRED, SITE_TO_COMPLETE_LABEL, SOURCE_TO_COMPLETE, VERIFIED_WINDOW_DAYS, VERIFY_BEFORE_DUE_WARNING,
  actionDateErrors, actionDateOrderErrors, actionFiltersParams, actionHref, actionLabel, actionRights, admissibleSources, canCreateAction,
  canReadAction, canReadPlan, canRemoveProof, canWithdrawComment, compareActions, followUpLinkMode, followUpProblem, formatActionNumber,
  isLate, isNonQseLinkKind, isQhse, isToComplete,
  isVerificationDueSoon, isVerificationLate, kanbanColumn, lateDays, matchesActionFilters, missingFields, moveTargets, parseActionFilters,
  parseActionNumber, sourceEditable, textTooLong, transitionKind, transitionSummary, inPlanScope, type ActionCompletion, type ActionFilters,
  type FilterableAction, type TransitionKind,
} from './action-rules';
import {
  ACTION_AVANCEMENTS, ACTION_SOURCES, OPEN_AVANCEMENTS, ROLE_KEYS, SOURCE_KEYS, SOURCE_LINK_KINDS, type Avancement, type Role,
} from './domain';

// Règles pures du plan d'actions (docs/specs/actions-qse.md § 4–16 ; plan du paquet 1 § 2.2, amendé le 15/10/2026).

const TODAY = '2026-10-09';
const OPEN = [...OPEN_AVANCEMENTS] as Avancement[];

describe('libellé court et numéro', () => {
  it('lien de la fiche, libellés « à compléter »', () => {
    expect(actionHref('A-215')).toBe('/actions?action=A-215');
    expect(actionHref('A 1&x')).toBe('/actions?action=A%201%26x');
    expect(SOURCE_TO_COMPLETE).toEqual({ label: 'À compléter', icon: 'ph-question' });
    expect(SITE_TO_COMPLETE_LABEL).toBe('Site à compléter');
  });
  it('actionLabel : première ligne non vide, espaces réduits, 90 caractères au plus', () => {
    expect(actionLabel('Remplacer le garde-corps\nDétail de la pose')).toBe('Remplacer le garde-corps');
    expect(actionLabel('\n\n  Ligne   avec\tespaces  \r\nsuite')).toBe('Ligne avec espaces');
    expect(actionLabel('Une\r\nDeux')).toBe('Une');
    expect(actionLabel('Une\rDeux')).toBe('Une');
    const ninety = 'x'.repeat(ACTION_LABEL_MAX);
    expect(actionLabel(ninety)).toBe(ninety);
    const label = actionLabel(`${'y'.repeat(ACTION_LABEL_MAX)}z`);
    expect(label).toHaveLength(ACTION_LABEL_MAX);
    expect(label.endsWith('y…')).toBe(true);
    expect(actionLabel(`${'a'.repeat(88)} bcd`)).toBe(`${'a'.repeat(88)}…`); // espace final retiré avant « … »
  });
  it('actionLabel : détail vide', () => {
    expect(actionLabel('')).toBe('Action sans détail');
    expect(actionLabel('  \n \t ')).toBe('Action sans détail');
    expect(actionLabel(null)).toBe('Action sans détail');
    expect(actionLabel(undefined)).toBe('Action sans détail');
  });
  it('formatActionNumber / parseActionNumber (A-n, 9 chiffres au plus comme la reprise R8)', () => {
    expect(formatActionNumber(221)).toBe('A-221');
    expect(parseActionNumber('A-221')).toBe(221);
    expect(parseActionNumber('A-123456789')).toBe(123456789);
    expect(parseActionNumber('A-1234567890')).toBeNull();
    expect(parseActionNumber('A-12345678901')).toBeNull();
    expect(['AC-26001', 'a-12', 'A-', 'A-12b', ' A-12', 'B-500'].map(parseActionNumber)).toEqual([null, null, null, null, null, null]);
  });
  it('followUpProblem : problème pré-rempli d’une action de suite, 4 000 caractères au plus', () => {
    expect(followUpProblem('A-170', '2026-09-29', 'Pas de baisse des incidents')).toBe('Action A-170 jugée non efficace le 29/09/2026 : Pas de baisse des incidents');
    expect(followUpProblem('A-170', '2026-09-29', 'x'.repeat(5000))).toHaveLength(4000);
  });
});

describe('retards et vérifications (§ 6.3)', () => {
  it('isLate : avancement ouvert seulement, date cible passée (échue aujourd’hui : pas en retard)', () => {
    for (const status of ACTION_AVANCEMENTS) {
      const open = OPEN.includes(status);
      expect(isLate({ status, dueOn: '2026-10-08' }, TODAY)).toBe(open);
      expect(isLate({ status, dueOn: TODAY }, TODAY)).toBe(false);
    }
  });
  it('lateDays : jours depuis la date cible actuelle, 0 si pas en retard', () => {
    expect(lateDays({ status: 'p40', dueOn: '2026-10-08' }, TODAY)).toBe(1);
    expect(lateDays({ status: 'a_faire', dueOn: '2026-09-09' }, TODAY)).toBe(30);
    expect(lateDays({ status: 'terminee', dueOn: '2026-09-09' }, TODAY)).toBe(0);
    expect(lateDays({ status: 'p40', dueOn: '2026-10-10' }, TODAY)).toBe(0);
  });
  it('isVerificationLate / isVerificationDueSoon : Terminée seulement', () => {
    for (const status of ACTION_AVANCEMENTS) {
      expect(isVerificationLate({ status, verifyDueOn: '2026-10-02' }, TODAY)).toBe(status === 'terminee');
      expect(isVerificationDueSoon({ status, verifyDueOn: '2026-10-12' }, TODAY)).toBe(status === 'terminee');
    }
    expect(isVerificationLate({ status: 'terminee', verifyDueOn: TODAY }, TODAY)).toBe(false);
    expect(isVerificationLate({ status: 'terminee', verifyDueOn: null }, TODAY)).toBe(false);
    expect(isVerificationDueSoon({ status: 'terminee', verifyDueOn: TODAY }, TODAY)).toBe(true);
    expect(isVerificationDueSoon({ status: 'terminee', verifyDueOn: '2026-10-24' }, TODAY)).toBe(true); // 15 jours
    expect(isVerificationDueSoon({ status: 'terminee', verifyDueOn: '2026-10-25' }, TODAY)).toBe(false);
    expect(isVerificationDueSoon({ status: 'terminee', verifyDueOn: '2026-10-12' }, TODAY, 2)).toBe(false);
    expect(isVerificationDueSoon({ status: 'terminee', verifyDueOn: '2026-10-08' }, TODAY)).toBe(false);
    expect(isVerificationDueSoon({ status: 'terminee', verifyDueOn: null }, TODAY)).toBe(false);
  });
});

describe('Kanban (§ 16)', () => {
  it('six colonnes', () => {
    expect(KANBAN_COLUMNS.map((c) => c.key)).toEqual(['a_faire', 'en_cours', 'en_retard', 'reportee', 'terminee', 'verifiee']);
    expect(KANBAN_COLUMNS.map((c) => c.label)).toEqual(['À faire', 'En cours', 'En retard', 'Reportée', 'Terminée — à vérifier', 'Vérifiées · 30 j']);
  });
  it('colonne des dix avancements, en retard ou non ; Abandonnée hors Kanban', () => {
    const onTime = Object.fromEntries(ACTION_AVANCEMENTS.map((s) => [s, kanbanColumn({ status: s, dueOn: '2026-10-20' }, TODAY)]));
    expect(onTime).toEqual({
      a_faire: 'a_faire', initiee: 'en_cours', p20: 'en_cours', p40: 'en_cours', p60: 'en_cours', p80: 'en_cours',
      reportee: 'reportee', terminee: 'terminee', verifiee: 'verifiee', abandonnee: null,
    });
    const late = Object.fromEntries(ACTION_AVANCEMENTS.map((s) => [s, kanbanColumn({ status: s, dueOn: '2026-09-01' }, TODAY)]));
    expect(late).toEqual({
      a_faire: 'en_retard', initiee: 'en_retard', p20: 'en_retard', p40: 'en_retard', p60: 'en_retard', p80: 'en_retard',
      reportee: 'reportee', terminee: 'terminee', verifiee: 'verifiee', abandonnee: null,
    });
    expect(kanbanColumn({ status: 'done', dueOn: '2026-10-20' }, TODAY)).toBeNull();
  });
});

describe('affichage du plan (?etat=) et vues', () => {
  it('listes', () => {
    expect(PLAN_SCOPES.map((s) => s[0])).toEqual(['', 'historique', 'abandonnees']);
    expect(PLAN_VIEWS.map((v) => v[0])).toEqual(['liste', 'kanban', 'responsable']);
    expect(VERIFIED_WINDOW_DAYS).toBe(30);
  });
  it('inPlanScope : plan en cours (Vérifiées 30 j), historique, abandonnées', () => {
    const row = (status: string, closedOn: string | null = null, dueOn = '2026-06-01') => ({ status, closedOn, dueOn });
    expect(inPlanScope(row('a_faire'), '', TODAY)).toBe(true);
    expect(inPlanScope(row('reportee'), '', TODAY)).toBe(true);
    expect(inPlanScope(row('terminee'), '', TODAY)).toBe(true);
    expect(inPlanScope(row('verifiee', '2026-09-09'), '', TODAY)).toBe(true); // 30 jours tout juste
    expect(inPlanScope(row('verifiee', '2026-09-08'), '', TODAY)).toBe(false);
    expect(inPlanScope(row('verifiee', null, '2026-09-20'), '', TODAY)).toBe(true); // reprise sans date de vérification : date cible
    expect(inPlanScope(row('verifiee', null, '2026-01-20'), '', TODAY)).toBe(false);
    expect(inPlanScope(row('abandonnee'), '', TODAY)).toBe(false);
    expect(inPlanScope(row('verifiee', '2025-01-01'), 'historique', TODAY)).toBe(true);
    expect(inPlanScope(row('abandonnee'), 'historique', TODAY)).toBe(false);
    expect(inPlanScope(row('abandonnee'), 'abandonnees', TODAY)).toBe(true);
    expect(inPlanScope(row('a_faire'), 'abandonnees', TODAY)).toBe(false);
  });
});

describe('transitions (§ 6.2)', () => {
  // s step · r report · u resume · f finish · n unfinish · v verify · o reopen · a abandon · . aucune
  const CODES: Record<string, TransitionKind | null> = { s: 'step', r: 'report', u: 'resume', f: 'finish', n: 'unfinish', v: 'verify', o: 'reopen', a: 'abandon', '.': null };
  const EXPECTED: Record<Avancement, string> = {
    //          a_faire initiee p20 p40 p60 p80 reportee terminee verifiee abandonnee
    a_faire: '.sssssrf.a',
    initiee: 's.ssssrf.a',
    p20: 'ss.sssrf.a',
    p40: 'sss.ssrf.a',
    p60: 'ssss.srf.a',
    p80: 'sssss.rf.a',
    reportee: 'uuuuuu.f.a',
    terminee: 'nnnnnn..va',
    verifiee: '.......o..',
    abandonnee: '..........',
  };
  it('matrice complète 10 × 10', () => {
    for (const from of ACTION_AVANCEMENTS) {
      const got = ACTION_AVANCEMENTS.map((to) => transitionKind(from, to));
      expect({ from, got }).toEqual({ from, got: [...EXPECTED[from]].map((c) => CODES[c]) });
    }
  });
  it('transitions de moveAction et motifs obligatoires', () => {
    expect(MOVE_KINDS).toEqual(['step', 'report', 'resume', 'finish', 'unfinish']);
    expect(REASON_REQUIRED).toEqual(['reopen', 'abandon']);
  });
  it('moveTargets : choix de « Changer l’avancement »', () => {
    expect(moveTargets('a_faire')).toEqual(['initiee', 'p20', 'p40', 'p60', 'p80', 'reportee', 'terminee']);
    expect(moveTargets('p40')).toEqual(['a_faire', 'initiee', 'p20', 'p60', 'p80', 'reportee', 'terminee']);
    expect(moveTargets('reportee')).toEqual(['a_faire', 'initiee', 'p20', 'p40', 'p60', 'p80', 'terminee']);
    expect(moveTargets('terminee')).toEqual(['a_faire', 'initiee', 'p20', 'p40', 'p60', 'p80']);
    expect(moveTargets('verifiee')).toEqual([]);
    expect(moveTargets('abandonnee')).toEqual([]);
  });
  it('transitionSummary : résumés du journal', () => {
    expect(transitionSummary('step', 'a_faire', 'p40')).toBe('Avancement : À faire → 40 %');
    expect(transitionSummary('report', 'p40', 'reportee')).toBe('Reportée');
    expect(transitionSummary('resume', 'reportee', 'p40')).toBe('Reprise : 40 %');
    expect(transitionSummary('finish', 'p80', 'terminee', { doneOn: '2026-09-20' })).toBe('Terminée le 20/09/2026');
    expect(transitionSummary('finish', 'p80', 'terminee')).toBe('Terminée');
    expect(transitionSummary('unfinish', 'terminee', 'p80')).toBe('Retour à 80 % : date effective effacée');
    expect(transitionSummary('verify', 'terminee', 'verifiee', { effective: true })).toBe('Vérifiée : efficace');
    expect(transitionSummary('verify', 'terminee', 'verifiee', { effective: false })).toBe('Vérifiée : non efficace');
    expect(transitionSummary('verify', 'terminee', 'verifiee')).toBe('Vérifiée');
    expect(transitionSummary('reopen', 'verifiee', 'terminee')).toBe('Vérification rouverte : retour à Terminée — à vérifier');
    expect(transitionSummary('abandon', 'p20', 'abandonnee')).toBe('Abandonnée');
  });
});

describe('à compléter (D8, calculé)', () => {
  const empty = (status: string): ActionCompletion => ({
    status, source: null, problem: null, domain: null, priority: null, siteId: null, verifyDueOn: null, doneOn: null, closedOn: null,
    verifyMethod: null, efficacyNote: null, effective: null,
  });
  const full: ActionCompletion = {
    status: 'verifiee', source: 'evenement', problem: 'Chute', domain: 'securite', priority: 'urgent', siteId: 'ville-a', verifyDueOn: '2026-10-01',
    doneOn: '2026-09-20', closedOn: '2026-10-01', verifyMethod: 'visuelle', efficacyNote: 'RAS', effective: false,
  };
  const BASE = ['source', 'problem', 'domain', 'priority', 'siteId'];
  it('champs manquants selon l’avancement', () => {
    for (const s of [...OPEN, 'reportee']) expect(missingFields(empty(s))).toEqual([...BASE, 'verifyDueOn']);
    expect(missingFields(empty('terminee'))).toEqual([...BASE, 'verifyDueOn', 'doneOn']);
    expect(missingFields(empty('verifiee'))).toEqual([...BASE, 'doneOn', 'closedOn', 'verifyMethod', 'efficacyNote', 'effective']);
    expect(missingFields(empty('abandonnee'))).toEqual([]);
    for (const status of ACTION_AVANCEMENTS) expect(missingFields({ ...full, status })).toEqual([]);
    expect(missingFields({ ...full, status: 'p20', problem: '   ' })).toEqual(['problem']);
    expect(missingFields({ ...full, effective: true })).toEqual([]);
    expect(Object.keys(MISSING_LABELS)).toHaveLength(11);
  });
  it('isToComplete, sourceEditable', () => {
    expect(isToComplete(empty('a_faire'))).toBe(true);
    expect(isToComplete(full)).toBe(false);
    expect(isToComplete(empty('abandonnee'))).toBe(false);
    expect(sourceEditable({ source: null })).toBe(true);
    expect(sourceEditable({ source: 'veille' })).toBe(false);
  });
});

describe('contrôles de dates (§ 4, D24)', () => {
  it('actionDateOrderErrors : règles d’ordre seules', () => {
    expect(actionDateOrderErrors({ openedOn: '2026-10-01', dueOn: '2026-10-01', verifyDueOn: '2026-10-02', doneOn: '2026-10-01', closedOn: '2026-10-01' })).toEqual({});
    expect(Object.keys(actionDateOrderErrors({ openedOn: '2026-10-01', dueOn: '2026-09-30', verifyDueOn: '2026-09-30', doneOn: '2026-09-30', closedOn: '2026-09-29' })))
      .toEqual(['dueOn', 'verifyDueOn', 'doneOn', 'closedOn']);
    expect(actionDateOrderErrors({ openedOn: '2026-10-01', doneOn: '2026-10-05', closedOn: '2026-10-04' })).toEqual({
      closedOn: 'La date de vérification ne peut pas précéder la date effective (05/10/2026).',
    });
    expect(actionDateOrderErrors({ openedOn: '2026-10-01', closedOn: '2026-09-30' })).toEqual({
      closedOn: 'La date de vérification ne peut pas précéder la date d\'ouverture (01/10/2026).',
    });
    expect(actionDateOrderErrors({ openedOn: '2026-10-01', dueOn: '2026-09-01' }).dueOn).toBe('La date cible ne peut pas précéder la date d\'ouverture (01/10/2026).');
  });
  const ALL = { dueOn: true, verifyDueOn: true, doneOn: true, closedOn: true };
  it('création : dates cibles et vérification ≥ aujourd’hui ; avertissement si vérification avant la date cible', () => {
    expect(actionDateErrors({ openedOn: TODAY, dueOn: '2026-10-20', verifyDueOn: '2026-11-01' }, TODAY, ALL)).toEqual({ fieldErrors: {}, warnings: [] });
    expect(actionDateErrors({ openedOn: TODAY, dueOn: '2026-10-20', verifyDueOn: '2026-10-15' }, TODAY, ALL)).toEqual({ fieldErrors: {}, warnings: [VERIFY_BEFORE_DUE_WARNING] });
    expect(actionDateErrors({ openedOn: TODAY, dueOn: TODAY, verifyDueOn: TODAY }, TODAY, ALL).fieldErrors).toEqual({});
    // date d'ouverture d'une modification (passée) : la date cible nouvelle reste ≥ aujourd'hui
    expect(actionDateErrors({ openedOn: '2026-09-01', dueOn: '2026-09-15', verifyDueOn: '2026-10-08' }, TODAY, ALL).fieldErrors).toEqual({
      dueOn: 'La date cible ne peut pas être dans le passé.',
      verifyDueOn: 'La vérification planifiée ne peut pas être dans le passé.',
    });
  });
  it('dates effective et de vérification : entre la date d’ouverture (ou effective) et aujourd’hui', () => {
    expect(actionDateErrors({ openedOn: '2026-09-01', doneOn: '2026-10-10' }, TODAY, { doneOn: true }).fieldErrors).toEqual({ doneOn: 'La date effective ne peut pas être dans le futur.' });
    expect(actionDateErrors({ openedOn: '2026-09-01', doneOn: '2026-08-31' }, TODAY, { doneOn: true }).fieldErrors.doneOn).toMatch(/précéder la date d'ouverture/);
    expect(actionDateErrors({ openedOn: '2026-09-01', doneOn: TODAY }, TODAY, { doneOn: true }).fieldErrors).toEqual({});
    expect(actionDateErrors({ openedOn: '2026-09-01', doneOn: '2026-09-20', closedOn: '2026-09-10' }, TODAY, { doneOn: true }).fieldErrors).toEqual({
      doneOn: 'La date effective ne peut pas suivre la date de vérification (10/09/2026).',
    });
    expect(actionDateErrors({ openedOn: '2026-09-01', doneOn: '2026-09-20', closedOn: '2026-09-19' }, TODAY, { closedOn: true }).fieldErrors).toEqual({
      closedOn: 'La date de vérification ne peut pas précéder la date effective (20/09/2026).',
    });
    expect(actionDateErrors({ openedOn: '2026-09-01', doneOn: '2026-09-20', closedOn: '2026-10-10' }, TODAY, { closedOn: true }).fieldErrors).toEqual({
      closedOn: 'La date de vérification ne peut pas être dans le futur.',
    });
    expect(actionDateErrors({ openedOn: '2026-09-01', doneOn: '2026-09-20', closedOn: TODAY }, TODAY, { doneOn: true, closedOn: true }).fieldErrors).toEqual({});
  });
  it('D24 : une valeur reprise incohérente non modifiée n’est jamais refusée', () => {
    // A-170 repris : ouverte le 19/09 (date de l'événement), échue le 15/09, vérifiée le 16/09.
    const legacy = { openedOn: '2026-09-19', dueOn: '2026-09-15', verifyDueOn: '2026-09-10', doneOn: null, closedOn: '2026-09-16' };
    expect(Object.keys(actionDateOrderErrors(legacy))).toEqual(['dueOn', 'verifyDueOn', 'closedOn']);
    expect(actionDateErrors(legacy, TODAY, {})).toEqual({ fieldErrors: {}, warnings: [] });
    expect(actionDateErrors({ ...legacy, dueOn: '2026-09-18' }, TODAY, { dueOn: true }).fieldErrors).toEqual({
      dueOn: 'La date cible ne peut pas précéder la date d\'ouverture (19/09/2026).',
    });
    expect(actionDateErrors({ ...legacy, dueOn: '2026-10-20' }, TODAY, { dueOn: true })).toEqual({ fieldErrors: {}, warnings: [VERIFY_BEFORE_DUE_WARNING] });
  });
  it('textTooLong : la limite de 4 000 caractères ne vaut que pour un texte modifié', () => {
    const legacy = 'x'.repeat(5000);
    expect(textTooLong(legacy, legacy)).toBe(false);
    expect(textTooLong(`${legacy}y`, legacy)).toBe(true);
    expect(textTooLong('x'.repeat(4000), null)).toBe(false);
    expect(textTooLong('x'.repeat(4001), null)).toBe(true);
    expect(textTooLong(null, legacy)).toBe(false);
    expect(textTooLong(null, undefined)).toBe(false);
  });
});

describe('droits (ACT-22 tranché le 15/10/2026, D19)', () => {
  it('QHSE = animateur QHSE et direction ; création réservée au QHSE', () => {
    expect(ROLE_KEYS.filter(isQhse)).toEqual(['Animateur QHSE', 'Direction']);
    expect(ROLE_KEYS.filter(canCreateAction)).toEqual(['Animateur QHSE', 'Direction']);
    expect(QHSE_ONLY_CREATE_MESSAGE).toBe('Les actions QSE sont créées par le service QHSE.');
  });
  it('canReadPlan : QHSE et encadrement ; le Salarié lit seulement ses actions', () => {
    expect(ROLE_KEYS.filter(canReadPlan)).toEqual(['Animateur QHSE', 'Direction', 'Chef de service', 'Chef de projet']);
  });
  it('canReadAction : ses actions de tout site ; les autres dans le périmètre', () => {
    const own = { pilotId: 'u1', siteId: 'ville-b' };
    const other = { pilotId: 'u2', siteId: 'ville-b' };
    expect(canReadAction('Chef de service', 'u1', own, ['ville-a'])).toBe(true);
    expect(canReadAction('Salarié', 'u1', own, ['ville-a'])).toBe(true);
    expect(canReadAction('Chef de service', 'u1', other, ['ville-a'])).toBe(false);
    expect(canReadAction('Chef de service', 'u1', other, ['ville-a', 'ville-b'])).toBe(true);
    expect(canReadAction('Chef de service', 'u1', { pilotId: 'u2', siteId: null }, ['ville-a'])).toBe(true);
    expect(canReadAction('Animateur QHSE', 'u1', other, null)).toBe(true);
    expect(canReadAction('Salarié', 'u1', other, null)).toBe(false);
    expect(canReadAction('Salarié', 'u1', { pilotId: 'u2', siteId: null }, null)).toBe(false);
  });
  it('actionRights : QHSE selon l’avancement', () => {
    const r = (status: Avancement) => actionRights('Animateur QHSE', 'q', { pilotId: 'p', status });
    const table = Object.fromEntries(ACTION_AVANCEMENTS.map((s) => {
      const x = r(s);
      return [s, [x.canEdit, x.canMove, x.canVerify, x.canReopen, x.canAbandon, x.canComment, x.canAttach].map((b) => (b ? 1 : 0)).join('')];
    }));
    expect(table).toEqual({
      a_faire: '1100111', initiee: '1100111', p20: '1100111', p40: '1100111', p60: '1100111', p80: '1100111',
      reportee: '1100111', terminee: '1110111', verifiee: '1001011', abandonnee: '0000010',
    });
    expect(r('p20')).toMatchObject({ qhse: true, responsible: false, elsewhere: null });
    // Liens complémentaires (ACT-22 : QHSE seulement) : rattacher à une action non close ; détacher, sauf Abandonnée.
    expect(Object.fromEntries(ACTION_AVANCEMENTS.map((s) => [s, [r(s).canLink, r(s).canUnlink].map((b) => (b ? 1 : 0)).join('')]))).toEqual({
      a_faire: '11', initiee: '11', p20: '11', p40: '11', p60: '11', p80: '11', reportee: '11', terminee: '11', verifiee: '01', abandonnee: '00',
    });
    for (const role of ['Salarié', 'Chef de service', 'Chef de projet'] as Role[]) {
      expect(actionRights(role, 'p', { pilotId: 'p', status: 'p40' })).toMatchObject({ canLink: false, canUnlink: false });
    }
    expect(actionRights('Direction', 'q', { pilotId: 'p', status: 'terminee' }, { elsewhere: 'Ville B' })).toMatchObject({ qhse: true, canVerify: true, elsewhere: 'Ville B' });
    // autovérification admise sans restriction (ACT-13) : le QHSE responsable vérifie son action
    expect(actionRights('Animateur QHSE', 'q', { pilotId: 'q', status: 'terminee' })).toMatchObject({ qhse: true, responsible: true, canVerify: true });
  });
  it('actionRights : responsable (tout rôle) consulte, commente, joint des preuves, sans transition', () => {
    for (const role of ['Salarié', 'Chef de service', 'Chef de projet'] as Role[]) {
      for (const status of ACTION_AVANCEMENTS) {
        const x = actionRights(role, 'u1', { pilotId: 'u1', status });
        expect(x).toMatchObject({ qhse: false, responsible: true, canEdit: false, canMove: false, canVerify: false, canReopen: false, canAbandon: false, canComment: true });
        expect(x.canAttach).toBe(status !== 'abandonnee');
      }
    }
  });
  it('actionRights : encadrement non responsable et autre Salarié : lecture seule', () => {
    for (const role of ['Chef de service', 'Chef de projet', 'Salarié'] as Role[]) {
      for (const status of ACTION_AVANCEMENTS) {
        const x = actionRights(role, 'u1', { pilotId: 'u2', status });
        expect(Object.values(x).filter((v) => v === true)).toEqual([]);
      }
    }
  });
  it('canRemoveProof : QHSE, ou le responsable actuel pour sa propre preuve ; jamais après Vérifiée', () => {
    const qhse = actionRights('Animateur QHSE', 'q', { pilotId: 'p', status: 'p40' });
    const resp = actionRights('Salarié', 'p', { pilotId: 'p', status: 'p40' });
    const former = actionRights('Salarié', 'old', { pilotId: 'p', status: 'p40' }); // ancien responsable après réaffectation
    const manager = actionRights('Chef de service', 'm', { pilotId: 'p', status: 'p40' });
    expect(canRemoveProof(qhse, 'p40', 'p', 'q')).toBe(true);
    expect(canRemoveProof(qhse, 'terminee', null, 'q')).toBe(true);
    expect(canRemoveProof(resp, 'p40', 'p', 'p')).toBe(true);
    expect(canRemoveProof(resp, 'p40', 'q', 'p')).toBe(false);
    expect(canRemoveProof(resp, 'p40', null, 'p')).toBe(false);
    expect(canRemoveProof(former, 'p40', 'old', 'old')).toBe(false);
    expect(canRemoveProof(manager, 'p40', 'm', 'm')).toBe(false);
    expect(canRemoveProof(qhse, 'verifiee', 'q', 'q')).toBe(false);
    expect(canRemoveProof(resp, 'verifiee', 'p', 'p')).toBe(false);
    expect(canRemoveProof(qhse, 'abandonnee', 'q', 'q')).toBe(false);
  });
  it('canWithdrawComment : auteur ou QHSE, une fois', () => {
    const qhse = actionRights('Animateur QHSE', 'q', { pilotId: 'p', status: 'p40' });
    const resp = actionRights('Salarié', 'p', { pilotId: 'p', status: 'p40' });
    const manager = actionRights('Chef de service', 'm', { pilotId: 'p', status: 'p40' });
    expect(canWithdrawComment(resp, { authorId: 'p', withdrawn: false }, 'p')).toBe(true);
    expect(canWithdrawComment(resp, { authorId: 'q', withdrawn: false }, 'p')).toBe(false);
    expect(canWithdrawComment(qhse, { authorId: 'p', withdrawn: false }, 'q')).toBe(true);
    expect(canWithdrawComment(qhse, { authorId: 'p', withdrawn: true }, 'q')).toBe(false);
    expect(canWithdrawComment(manager, { authorId: 'm', withdrawn: false }, 'm')).toBe(true); // ancien responsable, auteur
  });
});

describe('source imposée par l’élément lié (D20 révisée)', () => {
  it('un type de lien → ses sources', () => {
    expect(admissibleSources('event', { eventType: 'AT' })).toEqual(['evenement']);
    expect(admissibleSources('event', { eventType: 'ENV' })).toEqual(['evenement']);
    expect(admissibleSources('event', {})).toEqual(['evenement']);
    expect(admissibleSources('event', { eventType: 'RC' })).toEqual(['reclamation_client']);
    expect(admissibleSources('risk', {})).toEqual(['duerp']);
    expect(admissibleSources('requirement', {})).toEqual(['veille', 'dechets']);
    expect(admissibleSources('control', {})).toEqual(['controle_reglementaire']);
    expect(admissibleSources('document', {})).toEqual(['revue_documentaire']);
    expect(admissibleSources('docversion', {})).toEqual(['revue_documentaire']);
    expect(admissibleSources('review', {})).toEqual(['revue_direction']);
    expect(admissibleSources('reviewdecision', { decisionKind: 'objectif' })).toEqual(['objectif']);
    expect(admissibleSources('reviewdecision', { decisionKind: 'amelioration' })).toEqual(['revue_direction']);
    expect(admissibleSources('reviewdecision', {})).toEqual(['revue_direction']);
    expect(admissibleSources('wastestream', {})).toEqual(['dechets']);
    expect(admissibleSources('wasteentry', {})).toEqual(['dechets']);
  });
  it('constat ou élément du programme : selon la ligne ; sans ligne connue, les quatre sources d’audit', () => {
    for (const kind of ['finding', 'plan']) {
      expect(admissibleSources(kind, { track: 'Certification' })).toEqual(['audit_certification']);
      expect(admissibleSources(kind, { track: 'Visites sécurité' })).toEqual(['audit_terrain']);
      expect(admissibleSources(kind, { track: 'Audits internes' })).toEqual(['audit_interne']);
      expect(admissibleSources(kind, { track: 'Fournisseurs' })).toEqual(['audit_fournisseur']);
      expect(admissibleSources(kind, {})).toEqual(['audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain']);
      // Clé héritée d'Object : ligne inconnue (jamais une fonction du prototype).
      expect(admissibleSources(kind, { track: 'constructor' })).toEqual(['audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain']);
      expect(admissibleSources(kind, { track: 'toString' })).toEqual(['audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain']);
      expect(admissibleSources(kind, { track: null })).toEqual(['audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain']);
      expect(admissibleSources(kind, { track: 'Autre' })).toEqual(['audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain']);
    }
  });
  it('ligne « Revues de direction » : Revue de direction pour l’élément du programme ; un constat (base reprise) garde les sources d’audit', () => {
    expect(admissibleSources('plan', { track: 'Revues de direction' })).toEqual(['revue_direction']);
    expect(admissibleSources('finding', { track: 'Revues de direction' })).toEqual(['audit_certification', 'audit_fournisseur', 'audit_interne', 'audit_terrain']);
  });
  it('sans élément lié : les 24 sources', () => {
    expect(admissibleSources(null)).toEqual(SOURCE_KEYS);
    expect(admissibleSources(null, { eventType: 'RC' })).toHaveLength(24);
  });
  it('cohérence avec SOURCE_LINK_KINDS : le type de lien désigne l’élément de toute source qu’il admet', () => {
    const facts = [
      {}, { eventType: 'RC' }, { eventType: 'AT' }, { decisionKind: 'objectif' }, { decisionKind: 'amelioration' },
      ...['Certification', 'Visites sécurité', 'Audits internes', 'Fournisseurs', 'Revues de direction', 'Autre'].map((track) => ({ track })),
    ];
    const kinds = ['event', 'finding', 'plan', 'risk', 'requirement', 'control', 'document', 'docversion', 'review', 'reviewdecision', 'wastestream', 'wasteentry'];
    const incoherent: string[] = [];
    for (const kind of kinds) {
      for (const f of facts) {
        for (const s of admissibleSources(kind, f)) {
          if (!SOURCE_LINK_KINDS[ACTION_SOURCES[s].target].includes(kind)) incoherent.push(`${kind} ${JSON.stringify(f)} → ${s}`);
        }
      }
    }
    expect(incoherent).toEqual([]);
  });
  it('habilitations, plans de prévention, permis : pas d’action QSE ; type inconnu : aucune source', () => {
    expect(NON_QSE_LINK_KINDS).toEqual(['qualification', 'preventionplan', 'permit']);
    for (const kind of NON_QSE_LINK_KINDS) {
      expect(admissibleSources(kind, {})).toEqual([]);
      expect(isNonQseLinkKind(kind)).toBe(true);
    }
    expect(NON_QSE_LINK_MESSAGE).toBe('Ce type d\'élément ne donne pas lieu à une action QSE.');
    expect(['event', 'finding', 'wastestream', 'requirement'].some(isNonQseLinkKind)).toBe(false);
    expect(admissibleSources('papripact', {})).toEqual([]);
    expect(admissibleSources('', {})).toEqual([]);
  });
  it('toute source admise est une des 24 ; plus aucune source libre pour un élément lié', () => {
    const kinds = ['event', 'finding', 'plan', 'risk', 'requirement', 'control', 'document', 'docversion', 'review', 'reviewdecision', 'wastestream', 'wasteentry'];
    for (const kind of kinds) {
      const got = admissibleSources(kind, {});
      expect(got.length).toBeGreaterThan(0);
      for (const s of got) expect(SOURCE_KEYS).toContain(s);
    }
  });
});

describe('liens repris par une action de suite (D21, réponses du 15/10/2026)', () => {
  it('élément de la source, liens à plusieurs porteurs, liens à place unique ; jamais habilitation, plan de prévention, permis', () => {
    expect(['event', 'finding', 'plan'].map(followUpLinkMode)).toEqual(['source', 'source', 'source']);
    expect(['risk', 'review', 'document', 'wastestream', 'wasteentry'].map(followUpLinkMode)).toEqual(Array(5).fill('multi'));
    expect(['requirement', 'control', 'docversion', 'reviewdecision'].map(followUpLinkMode)).toEqual(Array(4).fill('single'));
    expect([...NON_QSE_LINK_KINDS, 'papripact', 'constructor', ''].map(followUpLinkMode)).toEqual(Array(6).fill('none'));
  });
});

describe('filtres de la vue générale (§ 16)', () => {
  const DEFAULTS: ActionFilters = {
    vue: 'liste', etat: '', avancement: null, retard: false, responsable: null, mes: false, source: null, priorite: null, completer: false, q: '', action: null,
  };
  it('lecture : valeurs par défaut, première valeur d’un tableau, valeurs invalides ignorées, alias', () => {
    expect(parseActionFilters({})).toEqual(DEFAULTS);
    expect(parseActionFilters({ vue: ['kanban', 'liste'], etat: 'historique' })).toMatchObject({ vue: 'kanban', etat: 'historique' });
    expect(parseActionFilters({ vue: 'pilote', etat: 'annulees' })).toMatchObject({ vue: 'responsable', etat: 'abandonnees' });
    expect(parseActionFilters({ pilote: 'tnguyen' }).responsable).toBe('tnguyen');
    expect(parseActionFilters({ responsable: 'sbenali', pilote: 'tnguyen' }).responsable).toBe('sbenali');
    expect(parseActionFilters({ vue: 'grille', etat: 'tout', avancement: 'done', source: 'skills', priorite: 'haute', retard: 'oui', mes: 'true', completer: '2' })).toEqual(DEFAULTS);
    expect(parseActionFilters({ avancement: 'ouvertes' }).avancement).toBe('ouvertes');
    expect(parseActionFilters({ avancement: 'en_retard' }).avancement).toBe('en_retard');
    expect(parseActionFilters({ avancement: 'p60' }).avancement).toBe('p60');
    expect(parseActionFilters({ source: 'dechets', priorite: 'urgent' })).toMatchObject({ source: 'dechets', priorite: 'urgent' });
    expect(parseActionFilters({ retard: '1', mes: '1', completer: '1' })).toMatchObject({ retard: true, mes: true, completer: true });
    expect(parseActionFilters({ q: `  ${'x'.repeat(150)}` }).q).toHaveLength(100);
    expect(parseActionFilters({ action: 'A-214' }).action).toBe('A-214');
    expect(parseActionFilters({ action: 'x'.repeat(65) }).action).toBeNull();
    expect(parseActionFilters({ responsable: 'x'.repeat(101) }).responsable).toBeNull();
  });
  it('écriture : valeurs par défaut omises ; aller-retour', () => {
    expect(Object.values(actionFiltersParams(DEFAULTS)).filter((v) => v !== undefined)).toEqual([]);
    const f: ActionFilters = {
      vue: 'kanban', etat: 'historique', avancement: 'terminee', retard: true, responsable: 'tnguyen', mes: true, source: 'audit_fournisseur',
      priorite: 'long_terme', completer: true, q: 'garde-corps', action: 'A-215',
    };
    const params = actionFiltersParams(f);
    expect(params).toEqual({
      vue: 'kanban', etat: 'historique', avancement: 'terminee', retard: '1', responsable: 'tnguyen', mes: '1', source: 'audit_fournisseur',
      priorite: 'long_terme', completer: '1', q: 'garde-corps', action: 'A-215',
    });
    expect(parseActionFilters(params)).toEqual(f);
    expect(actionFiltersParams({ vue: 'liste', etat: '' })).toMatchObject({ vue: undefined, etat: undefined });
  });
  const row = (over: Partial<FilterableAction> = {}): FilterableAction => ({
    id: 'A-214', status: 'p40', dueOn: '2026-10-20', pilotId: 'sbenali', source: 'evenement', priority: 'urgent', problem: 'Chute de plain-pied',
    detail: 'Poser un revêtement antidérapant', originRef: 'EV-2026-130', cancelReason: null, missing: [], ...over,
  });
  const ctx = { userId: 'sbenali', today: TODAY };
  const f = (over: Partial<ActionFilters>) => ({ ...DEFAULTS, ...over });
  it('matchesActionFilters : chaque filtre', () => {
    expect(matchesActionFilters(row(), DEFAULTS, ctx)).toBe(true);
    expect(matchesActionFilters(row(), f({ avancement: 'ouvertes' }), ctx)).toBe(true);
    expect(matchesActionFilters(row({ status: 'terminee' }), f({ avancement: 'ouvertes' }), ctx)).toBe(false);
    expect(matchesActionFilters(row({ status: 'reportee' }), f({ avancement: 'ouvertes' }), ctx)).toBe(false);
    expect(matchesActionFilters(row(), f({ avancement: 'en_retard' }), ctx)).toBe(false);
    expect(matchesActionFilters(row({ dueOn: '2026-10-01' }), f({ avancement: 'en_retard' }), ctx)).toBe(true);
    expect(matchesActionFilters(row({ dueOn: '2026-10-01' }), f({ retard: true }), ctx)).toBe(true);
    expect(matchesActionFilters(row(), f({ retard: true }), ctx)).toBe(false);
    expect(matchesActionFilters(row(), f({ avancement: 'p40' }), ctx)).toBe(true);
    expect(matchesActionFilters(row(), f({ avancement: 'p60' }), ctx)).toBe(false);
    expect(matchesActionFilters(row(), f({ responsable: 'sbenali' }), ctx)).toBe(true);
    expect(matchesActionFilters(row(), f({ responsable: 'tnguyen' }), ctx)).toBe(false);
    expect(matchesActionFilters(row(), f({ mes: true }), ctx)).toBe(true);
    expect(matchesActionFilters(row(), f({ mes: true }), { ...ctx, userId: 'clefevre' })).toBe(false);
    expect(matchesActionFilters(row(), f({ source: 'evenement' }), ctx)).toBe(true);
    expect(matchesActionFilters(row(), f({ source: 'duerp' }), ctx)).toBe(false);
    expect(matchesActionFilters(row({ source: null }), f({ source: 'duerp' }), ctx)).toBe(false);
    expect(matchesActionFilters(row(), f({ priorite: 'urgent' }), ctx)).toBe(true);
    expect(matchesActionFilters(row(), f({ priorite: 'long_terme' }), ctx)).toBe(false);
    expect(matchesActionFilters(row(), f({ completer: true }), ctx)).toBe(false);
    expect(matchesActionFilters(row({ missing: ['domain'] }), f({ completer: true }), ctx)).toBe(true);
  });
  it('matchesActionFilters : texte libre sans accents ni casse, jamais les commentaires', () => {
    expect(matchesActionFilters(row(), f({ q: 'antiderapant' }), ctx)).toBe(true);
    expect(matchesActionFilters(row(), f({ q: 'CHUTE' }), ctx)).toBe(true);
    expect(matchesActionFilters(row(), f({ q: 'a-214' }), ctx)).toBe(true);
    expect(matchesActionFilters(row(), f({ q: 'ev-2026-130' }), ctx)).toBe(true);
    expect(matchesActionFilters(row({ cancelReason: 'Doublon de A-212' }), f({ q: 'doublon' }), ctx)).toBe(true);
    expect(matchesActionFilters(row(), f({ q: '  ' }), ctx)).toBe(true);
    // Seuls numéro, problème, détail, référence d'origine et motif d'abandon sont cherchés : un texte présent seulement
    // dans un autre champ (responsable, source, avancement) n'est pas trouvé — les commentaires ne sont jamais lus.
    expect(matchesActionFilters(row({ pilotId: 'secretaire' }), f({ q: 'secret' }), ctx)).toBe(false);
    expect(matchesActionFilters(row({ source: 'evenement' }), f({ q: 'evenement' }), ctx)).toBe(false);
    expect(matchesActionFilters(row({ status: 'p40' }), f({ q: 'p40' }), ctx)).toBe(false);
    expect(matchesActionFilters(row({ problem: 'secret' }), f({ q: 'secret' }), ctx)).toBe(true);
  });
  it('compareActions : retards d’abord, puis date cible, puis numéro décroissant', () => {
    const list = [
      { id: 'A-9', status: 'p40', dueOn: '2026-10-20' },
      { id: 'A-201', status: 'p20', dueOn: '2026-09-01' }, // 38 j de retard
      { id: 'A-214', status: 'p40', dueOn: '2026-10-20' },
      { id: 'A-205', status: 'a_faire', dueOn: '2026-10-01' }, // 8 j de retard
      { id: 'A-190', status: 'terminee', dueOn: '2026-09-01' }, // pas en retard
      { id: 'X-1', status: 'p40', dueOn: '2026-10-20' },
    ];
    expect([...list].sort((a, b) => compareActions(a, b, TODAY)).map((a) => a.id)).toEqual(['A-201', 'A-205', 'A-190', 'X-1', 'A-214', 'A-9']);
  });
});
