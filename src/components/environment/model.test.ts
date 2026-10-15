import { describe, expect, it } from 'vitest';
import {
  QUALIFICATION_KEYS, REGISTER_MENTIONS, TRANSIT_CODES, TREATMENT_KEYS, defaultQualification, isQualification, isTransitCode,
  qualificationError, qualificationLabel, registerGaps, resolveMentions, streamGaps, toRegisterQuantity,
} from './model';

// Mentions du registre chronologique des déchets (arrêté du 31 mai 2021, DOC-02) : règles pures.

describe('qualification du traitement final', () => {
  it('cinq qualifications, libellés', () => {
    expect(QUALIFICATION_KEYS).toEqual(['reutilisation', 'recyclage', 'valorisation_energetique', 'autre_valorisation', 'elimination']);
    expect(qualificationLabel('valorisation_energetique')).toBe('Valorisation énergétique');
    expect(qualificationLabel(null)).toBeNull();
    expect(isQualification('recyclage')).toBe(true);
    expect(isQualification('toString')).toBe(false);
  });

  it('opérations de transit : R12, R13, D13 à D15', () => {
    expect(TRANSIT_CODES).toEqual(['R12', 'R13', 'D13', 'D14', 'D15']);
    expect(TREATMENT_KEYS.filter(isTransitCode)).toEqual(['R12', 'R13', 'D13', 'D14', 'D15']);
    expect(isTransitCode('R1')).toBe(false);
  });

  it('qualification proposée d’après le code de traitement', () => {
    expect(defaultQualification('R1')).toBe('valorisation_energetique');
    expect(['R2', 'R3', 'R4', 'R9'].map(defaultQualification)).toEqual(['recyclage', 'recyclage', 'recyclage', 'recyclage']);
    expect(defaultQualification('R10')).toBe('autre_valorisation');
    expect(defaultQualification('R11')).toBe('autre_valorisation');
    expect(defaultQualification('D1')).toBe('elimination');
    expect(defaultQualification('D10')).toBe('elimination');
    expect(defaultQualification('D12')).toBe('elimination');
    expect(TRANSIT_CODES.map(defaultQualification)).toEqual([null, null, null, null, null]);
    expect(defaultQualification('X1')).toBeNull();
    expect(defaultQualification('R0')).toBeNull();
  });

  it('cohérence avec le code (hors transit)', () => {
    expect(qualificationError('D9', 'recyclage')).toBe("Une opération d'élimination (D) se qualifie « Élimination ».");
    expect(qualificationError('D9', 'elimination')).toBeNull();
    expect(qualificationError('R9', 'elimination')).toBe('Une opération de valorisation (R) ne peut pas être qualifiée « Élimination ».');
    expect(qualificationError('R9', 'recyclage')).toBeNull();
    expect(qualificationError('R13', 'elimination')).toBeNull();
    expect(qualificationError('D15', 'recyclage')).toBeNull();
    expect(qualificationError('R4', null)).toBeNull();
  });
});

describe('quantité du registre', () => {
  it('tonnes pour une masse, m³ pour un volume', () => {
    expect(toRegisterQuantity(520, 'kg')).toEqual({ quantity: 0.52, unit: 't' });
    expect(toRegisterQuantity(2.4, 't')).toEqual({ quantity: 2.4, unit: 't' });
    expect(toRegisterQuantity(1500, 'L')).toEqual({ quantity: 1.5, unit: 'm³' });
    expect(toRegisterQuantity(3, 'm³')).toEqual({ quantity: 3, unit: 'm³' });
    expect(toRegisterQuantity(12.34, 'kg')).toEqual({ quantity: 0.01234, unit: 't' });
    expect(toRegisterQuantity(1, 'pièce')).toBeNull();
  });
});

describe('mentions manquantes', () => {
  const complete = {
    removedOn: '2026-03-04', siteSiret: '00000000000018', transporterSiret: '00000000000034', transporterAddress: 'ZI', transporterReceipt: 'R-1',
    destinationSiret: '00000000000075', destinationAddress: 'Ville C', qualification: 'recyclage',
  };

  it('enlèvement complet : aucune', () => {
    expect(registerGaps(complete)).toEqual([]);
  });

  it('chaque mention absente, dans l’ordre du registre', () => {
    expect(registerGaps({ ...complete, siteSiret: null, transporterSiret: '', transporterAddress: null, transporterReceipt: undefined, destinationSiret: null, destinationAddress: null, qualification: null }))
      .toEqual(Object.values(REGISTER_MENTIONS));
    expect(registerGaps({ ...complete, transporterReceipt: null })).toEqual(['Récépissé du transporteur']);
  });

  it('aucune exigence avant le 1er janvier 2022', () => {
    expect(registerGaps({ ...complete, removedOn: '2021-12-31', siteSiret: null })).toEqual([]);
    expect(registerGaps({ ...complete, removedOn: '2022-01-01', siteSiret: null })).toEqual(["SIRET de l'établissement"]);
  });

  it('filière : collecteur, installation, qualification (sauf transit)', () => {
    const stream = { treatmentCode: 'R9', collectorSiret: 'x', collectorAddress: 'x', collectorReceipt: 'x', destinationSiret: 'x', destinationAddress: 'x', qualification: 'recyclage' };
    expect(streamGaps(stream)).toEqual([]);
    expect(streamGaps({ ...stream, collectorSiret: null, collectorReceipt: '', qualification: null }))
      .toEqual(['SIRET du collecteur', 'Récépissé du collecteur', 'Qualification du traitement final']);
    expect(streamGaps({ ...stream, treatmentCode: 'R13', qualification: null })).toEqual([]);
  });
});

describe('copies d’un enlèvement', () => {
  const stream = {
    collector: '[Collecteur]', destination: '[Raffinerie]', treatmentCode: 'R9', pop: false, qualification: 'recyclage',
    collectorSiret: '00000000000034', collectorAddress: '[ZI]', collectorReceipt: '[Récépissé]', destinationSiret: '00000000000075', destinationAddress: '[Ville C]',
  };
  const none = {
    transporter: '[Collecteur]', destination: null, treatmentCode: null, pop: null, qualification: null,
    transporterSiret: null, transporterAddress: null, transporterReceipt: null, destinationSiret: null, destinationAddress: null,
  };

  it('copie de l’enlèvement prioritaire', () => {
    expect(resolveMentions({ ...none, destinationSiret: '00000000000083', qualification: 'reutilisation', pop: true }, stream))
      .toMatchObject({ destinationSiret: '00000000000083', qualification: 'reutilisation', pop: true });
  });

  it('à défaut, valeurs de la filière quand elles valent pour l’enlèvement', () => {
    expect(resolveMentions(none, stream)).toEqual({
      pop: false, qualification: 'recyclage', transporterSiret: '00000000000034', transporterAddress: '[ZI]', transporterReceipt: '[Récépissé]',
      destinationSiret: '00000000000075', destinationAddress: '[Ville C]',
    });
  });

  it('autre transporteur, autre installation, autre code : mentions à compléter', () => {
    expect(resolveMentions({ ...none, transporter: '[Transports Benne Express]', destination: '[Autre installation]', treatmentCode: 'R13' }, stream)).toEqual({
      pop: false, qualification: null, transporterSiret: null, transporterAddress: null, transporterReceipt: null, destinationSiret: null, destinationAddress: null,
    });
  });
});
