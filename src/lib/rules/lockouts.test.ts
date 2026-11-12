import { describe, expect, it } from 'vitest';
import {
  lockoutCloseBlocker, lockoutDeliverBlocker, lockoutPeopleError, lockoutSignal, lockoutStepError, parseIsolationPoints, pointsText, readPoints,
  stepTarget, verifyRightError,
} from './lockouts';

// PRV-22 : consignations et isolations d'un permis — règles pures.

describe('points d’isolement', () => {
  it('un par ligne « repère ; dispositif », lignes vides ignorées, bornes', () => {
    const { points, error } = parseIsolationPoints('Sectionneur Q1 ; cadenas 104\n\n  Vanne V3  \nPurge;  bouchon ; rouge ');
    expect(error).toBeNull();
    expect(points).toEqual([{ label: 'Sectionneur Q1', device: 'cadenas 104' }, { label: 'Vanne V3', device: '' }, { label: 'Purge', device: 'bouchon ; rouge' }]);
    expect(parseIsolationPoints(' \n ').error).toMatch(/au moins un point/);
    expect(parseIsolationPoints(Array.from({ length: 31 }, (_, i) => `P${i}`).join('\n')).error).toMatch(/30/);
    expect(pointsText(points)).toBe('Sectionneur Q1 ; cadenas 104\nVanne V3\nPurge ; bouchon ; rouge');
    expect(readPoints([{ label: 'A', device: 'x' }, { nope: 1 }, 'z'])).toEqual([{ label: 'A', device: 'x' }]);
    expect(readPoints(null)).toEqual([]);
  });
});

describe('poseur, vérificateur et étapes', () => {
  it('poseur ≠ vérificateur ; vérification par le vérificateur désigné ou le QHSE, jamais par le poseur', () => {
    expect(lockoutPeopleError('a', 'a')).toMatch(/autre personne/);
    expect(lockoutPeopleError('a', 'b')).toBeNull();
    const l = { applierId: 'a', verifierId: 'b' };
    expect(verifyRightError({ userId: 'b', qhse: false }, l)).toBeNull();
    expect(verifyRightError({ userId: 'c', qhse: true }, l)).toBeNull();
    expect(verifyRightError({ userId: 'c', qhse: false }, l)).toMatch(/vérificateur désigné/);
    expect(verifyRightError({ userId: 'a', qhse: true }, l)).toMatch(/poseur/);
  });
  it('préparée → posée → vérifiée → levée ; une consignation posée se lève aussi sans vérification', () => {
    expect(lockoutStepError('preparee', 'poser')).toBeNull();
    expect(lockoutStepError('posee', 'verifier')).toBeNull();
    expect(lockoutStepError('verifiee', 'lever')).toBeNull();
    expect(lockoutStepError('posee', 'lever')).toBeNull();
    expect(lockoutStepError('preparee', 'verifier')).toMatch(/posée avant/);
    expect(lockoutStepError('preparee', 'lever')).not.toBeNull();
    expect(lockoutStepError('levee', 'lever')).toMatch(/déjà levée/);
    expect(lockoutStepError('annulee', 'poser')).toMatch(/annulée/);
    expect([stepTarget('poser'), stepTarget('verifier'), stepTarget('lever')]).toEqual(['posee', 'verifiee', 'levee']);
  });
});

describe('délivrance et clôture du permis', () => {
  it('délivrance : toutes les consignations en vigueur vérifiées ; clôture : toutes levées ou annulées', () => {
    expect(lockoutDeliverBlocker([])).toBeNull();
    expect(lockoutDeliverBlocker([{ id: 'CSG-1', status: 'verifiee' }, { id: 'CSG-2', status: 'annulee' }])).toBeNull();
    expect(lockoutDeliverBlocker([{ id: 'CSG-1', status: 'posee' }, { id: 'CSG-2', status: 'preparee' }])).toMatch(/^Consignations CSG-1, CSG-2 non vérifiées/);
    expect(lockoutCloseBlocker([{ id: 'CSG-1', status: 'levee' }, { id: 'CSG-2', status: 'annulee' }])).toBeNull();
    expect(lockoutCloseBlocker([{ id: 'CSG-1', status: 'verifiee' }])).toMatch(/^Consignation CSG-1 non levée/);
    expect(lockoutCloseBlocker([{ id: 'CSG-3', status: 'preparee' }])).toMatch(/CSG-3/);
  });
  it('échéances : non vérifiée pendant la validité, non levée à la fin du permis', () => {
    const permit = { status: 'delivre', validFrom: new Date('2026-10-09T06:00:00Z'), validTo: new Date('2026-10-09T15:00:00Z') };
    const at = (iso: string) => new Date(iso).getTime();
    expect(lockoutSignal({ status: 'posee' }, permit, at('2026-10-09T05:00:00Z'))).toBeNull();
    expect(lockoutSignal({ status: 'posee' }, permit, at('2026-10-09T08:00:00Z'))).toBe('verification');
    expect(lockoutSignal({ status: 'verifiee' }, permit, at('2026-10-09T08:00:00Z'))).toBeNull();
    expect(lockoutSignal({ status: 'verifiee' }, permit, at('2026-10-09T16:00:00Z'))).toBe('levee');
    expect(lockoutSignal({ status: 'verifiee' }, { ...permit, status: 'annule' }, at('2026-10-09T08:00:00Z'))).toBe('levee');
    expect(lockoutSignal({ status: 'preparee' }, permit, at('2026-10-09T16:00:00Z'))).toBeNull();
    expect(lockoutSignal({ status: 'levee' }, permit, at('2026-10-09T16:00:00Z'))).toBeNull();
  });
});
