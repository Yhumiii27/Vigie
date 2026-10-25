import { describe, expect, it } from 'vitest';
import { dossierFindingActions } from './dossier-parts';

// AUD-28 : constat du dossier de revue avec plusieurs actions ; un dossier figé avant la migration 0016 garde son action
// unique (actionId, action) et reste lisible.

const base = { id: 1, kind: 'ecart_mineur', kindLabel: 'Écart mineur', tone: 'warn' as const, text: 'Constat', clause: null };
const brief = (id: string) => ({ id, title: 'Action', status: 'À faire', tone: 'neutral' as const, pilot: '[S. Benali]', dueOn: '2026-11-30', closedOn: null, efficacyNote: null, href: `/actions?action=${id}` });

describe('dossierFindingActions', () => {
  it('format courant : liste des actions', () => {
    expect(dossierFindingActions({ ...base, actions: [{ id: 'A-1', action: brief('A-1') }, { id: 'A-2', action: null }] }).map((a) => a.id)).toEqual(['A-1', 'A-2']);
    expect(dossierFindingActions({ ...base, actions: [] })).toEqual([]);
  });
  it('dossier figé avant AUD-28 : action unique, ou aucune', () => {
    expect(dossierFindingActions({ ...base, actionId: 'A-9', action: brief('A-9') })).toEqual([{ id: 'A-9', action: brief('A-9') }]);
    expect(dossierFindingActions({ ...base, actionId: 'A-9' })).toEqual([{ id: 'A-9', action: null }]);
    expect(dossierFindingActions({ ...base, actionId: null, action: null })).toEqual([]);
  });
});
