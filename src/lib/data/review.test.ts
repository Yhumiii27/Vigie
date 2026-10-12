import { describe, expect, it } from 'vitest';
import type { ActionRow, Person } from '../queries';
import { dossierAsOf, parseReviewSnapshot, reviewFollowUp, withRecordParts, type ReviewDecisionRow, type ReviewRecordOnly } from './review';

// Règles de la revue de direction (QUA-03) : date d'arrêt et instantanés du dossier (AUD-06), suivi des décisions et
// actions des revues précédentes (AUD-05).

describe('dossierAsOf : date d’arrêt des indicateurs', () => {
  it('la séance une fois passée, sinon la date du jour', () => {
    expect(dossierAsOf('2026-12-10', '2026-12-15')).toBe('2026-12-10');
    expect(dossierAsOf('2026-12-10', '2026-10-09')).toBe('2026-10-09');
    expect(dossierAsOf('2026-12-10', '2026-12-10')).toBe('2026-12-10');
  });
});

describe('parseReviewSnapshot : instantanés v1 et v2', () => {
  const dossier = { header: { reviewOn: '2026-06-18', to: '2026-06-25' }, record: {}, checklist: [], decisions: [], extraActions: [] };
  it('v1 (avant le lot 2) : phase « cloture », arrêté à la fin de la période examinée', () => {
    expect(parseReviewSnapshot({ version: 1, takenOn: '2026-06-25', takenBy: '[H. Marchand]', dossier })).toMatchObject({
      version: 2, phase: 'cloture', asOf: '2026-06-25', takenOn: '2026-06-25', takenBy: '[H. Marchand]',
    });
    expect(parseReviewSnapshot({ version: 1, takenOn: '2026-06-26', dossier: { ...dossier, header: {} } })?.asOf).toBe('2026-06-26');
  });
  it('v2 séance et clôture', () => {
    expect(parseReviewSnapshot({ version: 2, phase: 'seance', asOf: '2026-12-10', takenOn: '2026-12-15', takenBy: 'X', dossier })).toEqual({
      version: 2, phase: 'seance', asOf: '2026-12-10', takenOn: '2026-12-15', takenBy: 'X', dossier,
    });
    expect(parseReviewSnapshot({ version: 2, phase: 'cloture', asOf: '2026-12-10', takenOn: '2026-12-20', takenBy: 'Y', seance: { takenOn: '2026-12-15', takenBy: 'X' }, dossier }))
      .toMatchObject({ phase: 'cloture', seance: { takenOn: '2026-12-15', takenBy: 'X' } });
  });
  it('format inconnu : null', () => {
    expect(parseReviewSnapshot(null)).toBeNull();
    expect(parseReviewSnapshot('x')).toBeNull();
    expect(parseReviewSnapshot({ version: 3, dossier })).toBeNull();
    expect(parseReviewSnapshot({ version: 2, phase: 'autre', dossier })).toBeNull();
    expect(parseReviewSnapshot({ version: 2, phase: 'seance' })).toBeNull();
  });
});

describe('withRecordParts : dossier de séance et compte rendu courant', () => {
  it('sections et en-tête de la séance ; compte rendu, check-list, décisions, actions et statut courants', () => {
    const base = {
      header: { reviewOn: '2026-12-10', from: '2025-12-11', to: '2026-12-10', site: 'Tous les sites', status: 'tenue' },
      record: { minutes: 'ancien' }, checklist: [{ id: 1 }], decisions: [], extraActions: [], events: { openNc: [{ id: 'EV-1' }] },
    } as unknown as ReviewRecordOnly & { events: unknown };
    const live = {
      header: { reviewOn: '2026-12-10', from: '2025-12-20', to: '2026-12-19', site: 'Site A', status: 'cloturee' },
      record: { minutes: 'nouveau' }, checklist: [{ id: 2 }], decisions: [{ id: 3 }], extraActions: [{ id: 'A-1' }],
    } as unknown as ReviewRecordOnly;
    const d = withRecordParts(base, live);
    expect(d.header).toMatchObject({ from: '2025-12-11', to: '2026-12-10', site: 'Tous les sites', status: 'cloturee' });
    expect(d.record).toEqual({ minutes: 'nouveau' });
    expect([d.checklist, d.decisions, d.extraActions]).toEqual([[{ id: 2 }], [{ id: 3 }], [{ id: 'A-1' }]]);
    expect(d.events).toEqual({ openNc: [{ id: 'EV-1' }] });
  });
});

describe('reviewFollowUp : suivi des revues précédentes (§9.3.2 a)', () => {
  const people = new Map<string, Person>([['p1', { id: 'p1', name: '[P. Un]' } as Person]]);
  const decision = (over: Partial<ReviewDecisionRow>): ReviewDecisionRow => ({
    id: 1, reviewId: 1, kind: 'decision', text: 'Décision', pilotId: 'p1', dueOn: '2026-06-30', actionId: null, sort: 0, ...over,
  });
  const action = (over: Partial<ActionRow>): ActionRow => ({
    id: 'A-1', title: 'Action', origin: 'rev', originRef: '', pilotId: 'p1', dueOn: '2026-06-30', status: 'doing', kind: 'P', reviewId: null,
    closedOn: null, cancelledAt: null, cancelledById: null, cancelReason: null, efficacyNote: null, siteId: null, createdAt: new Date('2026-01-01T10:00:00Z'),
    ...over,
  } as ActionRow);
  const prior = [{ id: 2, reviewOn: '2026-06-18' }, { id: 1, reviewOn: '2025-12-11' }, { id: 0, reviewOn: '2024-12-12' }];
  const base = { prior, people, asOf: '2026-12-10', from: '2025-12-11' };

  it('décision sans action (warn), objectif sans action (neutral), action annulée avec son motif', () => {
    const rows = reviewFollowUp({
      ...base,
      decisions: [
        decision({ id: 1, text: 'Recruter', kind: 'ressource' }),
        decision({ id: 2, text: 'Développer', kind: 'decision' }),
        decision({ id: 3, text: 'Étudier', actionId: 'A-2' }),
      ],
      actions: [action({ id: 'A-2', status: 'cancelled', cancelledAt: new Date('2026-09-24T09:00:00Z'), cancelReason: 'Doublon', reviewId: 1 })],
    });
    const by = new Map(rows.map((r) => [r.text, r]));
    expect(by.get('Recruter')).toMatchObject({ state: 'no_action', tone: 'neutral', review: 'Revue du 11/12/2025', pilot: '[P. Un]' });
    expect(by.get('Développer')).toMatchObject({ state: 'no_action', tone: 'warn', open: true });
    expect(by.get('Étudier')).toMatchObject({ state: 'cancelled', open: false, cancelled: { on: '2026-09-24', reason: 'Doublon' }, actionId: 'A-2' });
  });

  it('actions rattachées sans décision ; revue plus ancienne que la période : lignes ouvertes seulement ; ouvertes d’abord', () => {
    const rows = reviewFollowUp({
      ...base,
      decisions: [
        decision({ id: 10, reviewId: 0, text: 'Ancienne close', dueOn: '2025-03-31' }),
        decision({ id: 11, reviewId: 0, text: 'Ancienne encore due', dueOn: '2026-03-31' }),
        decision({ id: 12, reviewId: 2, text: 'Dernière, close', actionId: 'A-3' }),
      ],
      actions: [
        action({ id: 'A-3', status: 'done', closedOn: '2026-08-01', reviewId: 2 }),
        action({ id: 'A-4', title: 'Rattachée sans décision', status: 'todo', dueOn: '2026-11-30', reviewId: 2 }),
        action({ id: 'A-5', title: 'Ancienne action close', status: 'done', reviewId: 0 }),
        action({ id: 'A-6', title: 'Ancienne action ouverte', status: 'doing', reviewId: 0, dueOn: '2025-06-30' }),
      ],
    });
    expect(rows.map((r) => r.text)).toEqual(['Rattachée sans décision', 'Ancienne action ouverte', 'Ancienne encore due', 'Dernière, close']);
    expect(rows[0]).toMatchObject({ kind: 'action', state: 'action', open: true, action: { id: 'A-4' } });
    expect(rows.at(-1)).toMatchObject({ state: 'action', open: false, action: { id: 'A-3', status: expect.any(String) } });
  });
});
