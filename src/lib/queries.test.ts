import { describe, expect, it } from 'vitest';
import {
  actionBrief, actionColumn, actionView, certificationStatus, concernedCount, concernedProjects, controlStatus, eventView, isOpen,
  lastFullMonths, lcfirst, safetyRates, skillState, workforceAccident, type ActionRow, type EventRow, type Person,
} from './queries';

// Règles de calcul de src/lib/queries.ts (QUA-03) : statuts déduits des données et de la date du jour, jamais stockés.

const NOW = '2026-10-09';

const action = (over: Partial<ActionRow> = {}): ActionRow => ({
  id: 'A-1', title: 'Action', origin: 'ev', originRef: null, kind: 'C', pilotId: 'p1', dueOn: '2026-10-20', status: 'todo',
  siteId: 'ville-a', eventId: null, closedOn: null, efficacyNote: null, verifyDueOn: null,
  cancelledAt: null, cancelledById: null, cancelReason: null, ...over,
} as ActionRow);

const people = new Map<string, Person>([['p1', { id: 'p1', name: '[S. Benali]' } as Person]]);

describe('actionColumn : colonne du plan d’actions', () => {
  it('« en retard » est déduit de l’échéance dépassée pour une action à lancer ou en cours', () => {
    expect(actionColumn(action({ status: 'todo', dueOn: '2026-10-08' }), NOW)).toBe('late');
    expect(actionColumn(action({ status: 'doing', dueOn: '2026-10-08' }), NOW)).toBe('late');
    // L'échéance du jour n'est pas encore dépassée.
    expect(actionColumn(action({ status: 'doing', dueOn: NOW }), NOW)).toBe('doing');
    expect(actionColumn(action({ status: 'todo', dueOn: '2026-10-10' }), NOW)).toBe('todo');
  });
  it('les statuts terminaux ne passent jamais en retard', () => {
    for (const status of ['done', 'verify', 'cancelled'] as const) {
      expect(actionColumn(action({ status, dueOn: '2020-01-01' }), NOW)).toBe(status);
    }
  });
  it('vue et résumé : libellé, ton, pilote et initiales', () => {
    const v = actionView(action({ dueOn: '2026-10-01' }), people, NOW);
    expect(v).toMatchObject({ col: 'late', statusLabel: 'En retard', tone: 'danger', late: true, pilot: '[S. Benali]', pilotInitials: 'SB', due: '01/10', kindLabel: 'Corrective' });
    expect(v.origin).toMatchObject({ label: 'Événement' });
    expect(actionView(action({ pilotId: 'inconnu', origin: 'autre', kind: 'P' }), people, NOW)).toMatchObject({
      pilot: '—', origin: { label: 'autre', path: '/actions' }, kindLabel: 'Préventive',
    });
    expect(actionView(action({ status: 'cancelled' }), people, NOW)).toMatchObject({ statusLabel: 'Annulée', tone: 'neutral' });
    expect(actionBrief(undefined, people, NOW)).toBeNull();
    expect(actionBrief(action({ status: 'verify' }), people, NOW)).toMatchObject({ status: 'Efficacité à vérifier', tone: 'warn', pilot: '[S. Benali]' });
  });
});

describe('controlStatus : contrôles périodiques', () => {
  it('dépassé, sous 30 jours, planifié', () => {
    expect(controlStatus({ nextOn: '2026-10-01' }, NOW)).toEqual({ label: 'Dépassé · +8 j', tone: 'danger', days: -8 });
    expect(controlStatus({ nextOn: NOW }, NOW)).toEqual({ label: 'Sous 30 j', tone: 'warn', days: 0 });
    expect(controlStatus({ nextOn: '2026-11-08' }, NOW)).toEqual({ label: 'Sous 30 j', tone: 'warn', days: 30 });
    expect(controlStatus({ nextOn: '2026-11-09' }, NOW)).toEqual({ label: 'Planifié', tone: 'neutral', days: 31 });
  });
});

describe('skillState : case de la matrice des habilitations', () => {
  it('non requis, requis jamais suivi, sans échéance', () => {
    expect(skillState(false, '2020-01-01', true, NOW)).toBe('n');
    expect(skillState(true, null, false, NOW)).toBe('r');
    expect(skillState(true, null, true, NOW)).toBe('v');
  });
  it('l’échéance est le dernier jour de validité ; « expire bientôt » jusqu’à 60 jours', () => {
    expect(skillState(true, '2026-10-08', true, NOW)).toBe('x');
    expect(skillState(true, NOW, true, NOW)).toBe('s');
    expect(skillState(true, '2026-12-08', true, NOW)).toBe('s'); // J+60
    expect(skillState(true, '2026-12-09', true, NOW)).toBe('v'); // J+61
  });
});

describe('événements', () => {
  const ev = (over: Partial<EventRow> = {}) => ({
    id: 'EV-1', type: 'AT', step: 2, dismissedAt: null, occurredOn: '2026-10-01', pilotId: 'p1', anonymous: false,
    declarant: null, declarantCompany: null, reportedVia: null, ...over,
  } as EventRow);
  it('ouvert tant qu’il n’est ni clôturé ni classé sans suite', () => {
    expect(isOpen(ev())).toBe(true);
    expect(isOpen(ev({ step: 5 }))).toBe(false);
    expect(isOpen(ev({ dismissedAt: new Date() }))).toBe(false);
  });
  it('vue : statut, ancienneté et déclarant (anonyme, nominatif sans compte)', () => {
    expect(eventView(ev(), people, NOW)).toMatchObject({ typeLabel: 'Accident', typeTone: 'danger', status: 'Analyse des causes', pilot: '[S. Benali]', days: 8, declarantLabel: '—' });
    expect(eventView(ev({ dismissedAt: new Date() }), people, NOW)).toMatchObject({ status: 'Classé sans suite', dismissed: true });
    expect(eventView(ev({ anonymous: true, declarant: 'X' }), people, NOW).declarantLabel).toBe('Anonyme');
    expect(eventView(ev({ declarant: 'J. Martin', declarantCompany: 'Levage Ouest', reportedVia: 'poste' }), people, NOW).declarantLabel)
      .toBe('J. Martin (Levage Ouest) · déclaré sans compte');
    expect(eventView(ev({ declarant: '[T. Nguyen]', reportedVia: 'session' }), people, NOW).declarantLabel).toBe('[T. Nguyen]');
  });
});

describe('veille : projets Keystone concernés', () => {
  const projects = [{ id: 'K3', deliveryOn: '2027-03-01' }, { id: 'K1', deliveryOn: '2026-06-01' }, { id: 'K2', deliveryOn: '2027-01-15' }, { id: 'K0', deliveryOn: null }];
  it('projets livrés après la date d’application, par livraison', () => {
    expect(concernedProjects({ dueOn: '2027-01-01', affectsProjects: true }, projects).map((p) => p.id)).toEqual(['K2', 'K3']);
    expect(concernedProjects({ dueOn: '2027-01-01', affectsProjects: false }, projects)).toEqual([]);
    expect(concernedProjects({ dueOn: null, affectsProjects: true }, projects)).toEqual([]);
  });
  it('le nombre saisi reste une surcharge du calcul ; null = non applicable', () => {
    expect(concernedCount({ dueOn: '2027-01-01', affectsProjects: true, keystoneProjects: null }, projects)).toBe(2);
    expect(concernedCount({ dueOn: '2027-01-01', affectsProjects: true, keystoneProjects: 7 }, projects)).toBe(7);
    expect(concernedCount({ dueOn: '2027-01-01', affectsProjects: false, keystoneProjects: null }, projects)).toBeNull();
  });
});

describe('certificationStatus : statut affiché d’un référentiel', () => {
  const cert = (over: Partial<{ tone: string; status: string; validUntil: string | null }> = {}) => ({ tone: 'ok', status: '', validUntil: '2028-05-01', ...over });
  it('non engagé, en cours', () => {
    expect(certificationStatus(cert({ tone: 'off' }), null, NOW)).toEqual({ label: 'Non engagé', tone: 'neutral' });
    expect(certificationStatus(cert({ tone: 'warn', status: 'Audit initial' }), '2026-11-20', NOW)).toEqual({ label: 'Audit initial · audit le 20/11/2026', tone: 'warn' });
  });
  it('certifié : expiré, bientôt expiré, audit à programmer, à confirmer, à venir', () => {
    expect(certificationStatus(cert({ validUntil: '2026-10-01' }), '2027-03-01', NOW)).toEqual({ label: 'Certificat expiré depuis le 01/10/2026', tone: 'danger' });
    expect(certificationStatus(cert({ validUntil: '2026-11-01' }), '2027-03-01', NOW)).toEqual({ label: "Certifié · valable jusqu'au 01/11/2026", tone: 'warn' });
    expect(certificationStatus(cert(), null, NOW)).toEqual({ label: 'Certifié · prochain audit à programmer', tone: 'warn' });
    expect(certificationStatus(cert(), '2026-10-01', NOW)).toEqual({ label: 'Certifié · audit du 01/10/2026 à confirmer', tone: 'warn' });
    expect(certificationStatus(cert(), '2026-10-30', NOW)).toEqual({ label: 'Certifié · suivi le 30/10/2026', tone: 'warn' });
    expect(certificationStatus(cert(), '2027-03-01', NOW)).toEqual({ label: 'Certifié · suivi le 01/03/2027', tone: 'ok' });
  });
});

describe('lcfirst', () => {
  it('minuscule initiale, sigles conservés', () => {
    expect(lcfirst('Habilitation électrique')).toBe('habilitation électrique');
    expect(lcfirst('CACES R489')).toBe('CACES R489');
    expect(lcfirst('A')).toBe('A');
  });
});

describe('TF1 / TG : 12 derniers mois complets (TDB-04)', () => {
  const months = lastFullMonths(NOW);
  const year = (siteId: string, value = 10_000, from = months) => from.map((m) => ({ month: `${m}-01`, siteId, hours: value }));
  const at = (occurredOn: string, siteId: string | null = 'a', lostDays: number | null = 5, injury = 'arret', victimKind: string | null = 'salarie') =>
    ({ type: 'AT', injury, lostDays, occurredOn, siteId, victimKind });
  const A = { id: 'a', archivedOn: null };
  const B = { id: 'b', archivedOn: null };

  it('fenêtre : mois en cours exclu, 12e mois en arrière inclus, jamais de 13e mois', () => {
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2025-10');
    expect(months[11]).toBe('2026-09');
    expect(lastFullMonths('2026-01-31', 2)).toEqual(['2025-11', '2025-12']);
    const r = safetyRates({ months, sites: [A], hours: [...year('a'), { month: '2025-09-01', siteId: 'a', hours: 99 }, { month: '2026-10-01', siteId: 'a', hours: 99 }], events: [at('2025-09-30'), at('2026-10-01'), at('2025-10-01')] });
    expect(r.hours).toBe(120_000);
    expect(r.accidents).toBe(1);
    expect(r.tf1).toBeCloseTo(1e6 / 120_000);
    expect(r.tg).toBeCloseTo(5e3 / 120_000);
    expect(r.missing).toEqual([]);
  });

  it('mois manquant : signalé, et l’accident de ce mois sort du taux', () => {
    const hours = year('a').filter((h) => h.month !== '2026-03-01');
    const r = safetyRates({ months, sites: [A], hours, events: [at('2026-03-12'), at('2026-04-02', 'a', null)] });
    expect(r.missing).toEqual([{ siteId: 'a', month: '2026-03' }]);
    expect(r.accidents).toBe(1);
    expect(r.lostDays).toBe(0); // jours perdus non renseignés : 0
    expect(r.hours).toBe(110_000);
  });

  it('site créé en cours de fenêtre, site archivé en mars : pas de faux manquant', () => {
    const late = months.filter((m) => m >= '2026-05');
    const early = months.filter((m) => m <= '2026-03');
    const r = safetyRates({
      months, sites: [A, { id: 'c', archivedOn: '2026-03-20' }, { id: 'd', archivedOn: '2025-06-30' }],
      hours: [...year('a', 1000, late), ...year('c', 1000, early)], events: [],
    });
    expect(r.missing).toEqual([]);
    expect(r.hours).toBe(1000 * (late.length + early.length));
  });

  it('sans heures : taux nuls (null), site actif sans heures entièrement manquant', () => {
    const r = safetyRates({ months, sites: [A, B], hours: year('a', 0), events: [at('2026-05-05')] });
    expect(r.tf1).toBeNull();
    expect(r.tg).toBeNull();
    expect(r.missing).toHaveLength(12);
    expect(r.missing.every((m) => m.siteId === 'b')).toBe(true);
    expect(safetyRates({ months, sites: [], hours: [], events: [] })).toMatchObject({ tf1: null, tg: null, hours: 0, missing: [] });
  });

  it('AT avec arrêt avant le premier mois saisi : son mois est attendu, jamais un 0 silencieux', () => {
    // Heures du site B à partir de mai 2026, accident en mars : mars et avril manquent (B seul ou consolidé).
    const late = months.filter((m) => m >= '2026-05');
    const only = safetyRates({ months, sites: [B], hours: year('b', 1000, late), events: [at('2026-03-12', 'b')] });
    expect(only).toMatchObject({ tf1: 0, accidents: 0 });
    expect(only.missing).toEqual([{ siteId: 'b', month: '2026-03' }, { siteId: 'b', month: '2026-04' }]);
    const both = safetyRates({ months, sites: [A, B], hours: [...year('a'), ...year('b', 1000, late)], events: [at('2026-03-12', 'b')] });
    expect(both.missing).toEqual([{ siteId: 'b', month: '2026-03' }, { siteId: 'b', month: '2026-04' }]);
    // Seule ligne d'heures du site B : le mois en cours ; accidents dans la fenêtre → à partir du premier, tout manque.
    const current = safetyRates({
      months, sites: [A, B], hours: [...year('a'), { month: '2026-10-01', siteId: 'b', hours: 500 }],
      events: [at('2026-06-03', 'b'), at('2026-08-20', 'b')],
    });
    expect(current.accidents).toBe(0);
    expect(current.missing).toEqual(months.filter((m) => m >= '2026-06').map((month) => ({ siteId: 'b', month })));
    // Accident d'un mois couvert : compté, rien ne manque.
    expect(safetyRates({ months, sites: [B], hours: year('b', 1000, late), events: [at('2026-06-03', 'b')] })).toMatchObject({ accidents: 1, missing: [] });
  });

  it('site archivé sans heures mais avec un AT avec arrêt dans la fenêtre : suivi, mois manquants signalés', () => {
    const C = { id: 'c', archivedOn: '2026-03-20' };
    const r = safetyRates({ months, sites: [A, C], hours: year('a'), events: [at('2026-02-10', 'c')] });
    expect(r.accidents).toBe(0);
    expect(r.missing).toEqual(months.filter((m) => m <= '2026-03').map((month) => ({ siteId: 'c', month })));
    // Accident postérieur à l'archivage (donnée incohérente) : sa case reste attendue.
    const after = safetyRates({ months, sites: [A, { id: 'd', archivedOn: '2025-06-30' }], hours: year('a'), events: [at('2026-04-01', 'd')] });
    expect(after.missing).toEqual([{ siteId: 'd', month: '2026-04' }]);
    // AT sans arrêt : pas une preuve, le site archivé sans heures reste hors suivi.
    expect(safetyRates({ months, sites: [A, C], hours: year('a'), events: [at('2026-02-10', 'c', 0, 'sans_arret')] }).missing).toEqual([]);
  });

  it('accident sans site : compté si son mois est couvert sur un site ; sites hors entrée ignorés', () => {
    const r = safetyRates({ months, sites: [A], hours: [...year('a'), ...year('b')], events: [at('2026-06-01', null), at('2026-06-02', 'b'), at('2026-06-03', 'a', 2, 'sans_arret')] });
    expect(r.accidents).toBe(1);
    expect(r.hours).toBe(120_000);
  });

  it('accidents de l’effectif seulement : ni intérimaire, ni personne extérieure (heures de l’effectif)', () => {
    const events = [
      at('2026-06-01', 'a', 4), at('2026-06-02', 'a', 3, 'arret', null),
      at('2026-06-03', 'a', 20, 'arret', 'externe'), at('2026-06-04', 'a', 10, 'arret', 'interimaire'),
    ];
    expect(safetyRates({ months, sites: [A], hours: year('a'), events })).toMatchObject({ accidents: 2, lostDays: 7 });
    // AT avec arrêt d'une personne extérieure : pas une preuve d'activité d'un site archivé sans heures.
    const C = { id: 'c', archivedOn: '2026-03-20' };
    expect(safetyRates({ months, sites: [A, C], hours: year('a'), events: [at('2026-02-10', 'c', 5, 'arret', 'externe')] }).missing).toEqual([]);
    expect(workforceAccident({ type: 'AT', victimKind: 'salarie' })).toBe(true);
    expect(workforceAccident({ type: 'AT', victimKind: null })).toBe(true);
    expect(workforceAccident({ type: 'AT', victimKind: 'externe' })).toBe(false);
    expect(workforceAccident({ type: 'AT', victimKind: 'interimaire' })).toBe(false);
    expect(workforceAccident({ type: 'PA', victimKind: null })).toBe(false);
  });
});
