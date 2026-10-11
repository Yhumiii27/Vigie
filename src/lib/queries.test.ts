import { describe, expect, it } from 'vitest';
import {
  actionBrief, actionColumn, actionView, certificationStatus, concernedCount, concernedProjects, controlStatus, eventView, isOpen,
  lcfirst, skillState, type ActionRow, type EventRow, type Person,
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
