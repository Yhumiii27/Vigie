import { describe, expect, it } from 'vitest';
import {
  STUDY_TYPE_KEYS, STUDY_TYPES, capexCodeError, projectCodeError, recommendationCounts, siteCodeError, studyClearsMilestone, studyFieldErrors,
  studyHref, studyStatus, studyTypeError, typesOfMilestone,
} from './process-safety';

// Études de sécurité des procédés (VG-01 à VG-05) : règles pures.

const TODAY = '2026-10-09';

describe('type et jalon (VG-01)', () => {
  it('un type relève d’un seul jalon', () => {
    expect(typesOfMilestone('HS2')).toEqual(['hazid']);
    expect(typesOfMilestone('HS3')).toEqual(['hazop', 'amdec']);
    expect(typesOfMilestone('HS4')).toEqual(['controle_chantier']);
    expect(typesOfMilestone('PSSR')).toEqual(['pssr', 'rspdi']);
    expect(typesOfMilestone('HS6')).toEqual(['aspd']);
    expect(STUDY_TYPE_KEYS.every((k) => studyTypeError(STUDY_TYPES[k].milestone, k) === null)).toBe(true);
    expect(studyTypeError('HS2', 'hazop')).toBe('Une étude HazOp relève du jalon HS 3.');
    expect(studyTypeError('HS6', 'pssr')).toBe('Une étude PSSR relève du jalon PSSR.');
  });
});

describe('codes saisis', () => {
  it('code CAPEX d’Arche, code projet, code commun du site (Matrix D14)', () => {
    expect(capexCodeError('CPX-APM-2026-01')).toBeNull();
    expect(capexCodeError(null)).toBeNull();
    expect(capexCodeError('cpx-apm-2026-01')).toMatch(/CPX-APM-2026-01/);
    expect(capexCodeError('CPX-')).not.toBeNull();
    expect(capexCodeError('APM-2026-01')).not.toBeNull();
    expect(projectCodeError('K-2025-042')).toBeNull();
    expect(projectCodeError('K 2025')).not.toBeNull();
    expect(siteCodeError('kenitra')).toBeNull();
    expect(siteCodeError('le_havre')).toBeNull();
    expect(siteCodeError(null)).toBeNull();
    expect(siteCodeError('all')).toMatch(/réservé/);
    expect(siteCodeError('ville-a')).not.toBeNull();
    expect(siteCodeError('2e_site')).not.toBeNull();
    expect(siteCodeError('x')).not.toBeNull();
  });
});

describe('statut, dates et conclusion', () => {
  it('séance obligatoire ; réalisée ou validée : séance passée ; validée : date et conclusion', () => {
    expect(studyFieldErrors({ status: 'planifiee', sessionOn: '2026-11-01', validatedOn: null, conclusion: null }, TODAY)).toEqual({});
    expect(studyFieldErrors({ status: 'planifiee', sessionOn: null, validatedOn: null, conclusion: null }, TODAY)).toHaveProperty('sessionOn');
    expect(studyFieldErrors({ status: 'realisee', sessionOn: '2026-11-01', validatedOn: null, conclusion: null }, TODAY)).toEqual({ sessionOn: 'Séance à venir : l’étude reste planifiée.' });
    // Valeur non modifiée : tolérée (AUD-31).
    expect(studyFieldErrors({ status: 'realisee', sessionOn: '2026-11-01', validatedOn: null, conclusion: null }, TODAY, { sessionOn: false })).toEqual({});
    expect(studyFieldErrors({ status: 'validee', sessionOn: '2026-10-01', validatedOn: null, conclusion: null }, TODAY)).toEqual({
      validatedOn: 'Indiquez la date de validation.', conclusion: 'Choisissez la conclusion de l’étude.',
    });
    expect(studyFieldErrors({ status: 'validee', sessionOn: '2026-10-01', validatedOn: '2026-09-30', conclusion: 'favorable' }, TODAY)).toEqual({ validatedOn: 'Validation antérieure à la séance.' });
    expect(studyFieldErrors({ status: 'validee', sessionOn: '2026-10-01', validatedOn: '2026-10-10', conclusion: 'favorable' }, TODAY)).toEqual({ validatedOn: 'Date postérieure à aujourd’hui.' });
    expect(studyFieldErrors({ status: 'validee', sessionOn: '2026-10-01', validatedOn: '2026-10-09', conclusion: 'reserves' }, TODAY)).toEqual({});
    expect(studyFieldErrors({ status: 'realisee', sessionOn: '2026-10-01', validatedOn: '2026-10-02', conclusion: 'favorable' }, TODAY)).toEqual({
      validatedOn: 'Date de validation réservée à une étude validée.', conclusion: 'Conclusion réservée à une étude validée.',
    });
  });
  it('« annulée » calculée d’après le triplet d’annulation', () => {
    expect(studyStatus({ status: 'validee', cancelled: true })).toBe('annulee');
    expect(studyStatus({ status: 'realisee', cancelled: false })).toBe('realisee');
  });
});

describe('recommandations et jalon (VG-02, règle d’Arche)', () => {
  const recs = [
    { status: 'p40', dueOn: '2026-10-29', blocking: true }, // ouverte, bloquante
    { status: 'initiee', dueOn: '2026-10-04', blocking: false }, // en retard
    { status: 'verifiee', dueOn: '2026-09-27', blocking: false },
    { status: 'abandonnee', dueOn: '2026-09-01', blocking: true }, // réserve abandonnée : levée
    { status: 'terminee', dueOn: '2026-10-01', blocking: false }, // ouverte, pas en retard (Terminée)
  ];
  it('ouvertes = ni vérifiées ni abandonnées ; retard = règle du plan ; réserves bloquantes ouvertes', () => {
    expect(recommendationCounts(recs, TODAY)).toEqual({ total: 5, open: 3, late: 1, blocking: 1 });
    expect(recommendationCounts([], TODAY)).toEqual({ total: 0, open: 0, late: 0, blocking: 0 });
  });
  it('jalon franchi : validée, non défavorable, sans réserve bloquante ; annulée : jamais', () => {
    expect(studyClearsMilestone({ status: 'validee', conclusion: 'favorable' }, 0)).toBe(true);
    expect(studyClearsMilestone({ status: 'validee', conclusion: 'reserves' }, 0)).toBe(true);
    expect(studyClearsMilestone({ status: 'validee', conclusion: 'reserves' }, 1)).toBe(false);
    expect(studyClearsMilestone({ status: 'validee', conclusion: 'defavorable' }, 0)).toBe(false);
    expect(studyClearsMilestone({ status: 'realisee', conclusion: null }, 0)).toBe(false);
    expect(studyClearsMilestone({ status: 'annulee', conclusion: 'favorable' }, 0)).toBe(false);
  });
  it('lien profond (VG-04)', () => {
    expect(studyHref('ES-002')).toBe('/risques?vue=etudes&etude=ES-002');
  });
});
