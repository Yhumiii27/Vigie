import { describe, expect, it } from 'vitest';
import { ENTITY_FILE_KIND_KEYS, attachSummary, detachSummary, isEntityFileKind, validEntityId } from './entity-files';

// Pièces jointes génériques (paquet 6) : types admis, identifiants reçus du navigateur, phrases du journal.

describe('entity-files', () => {
  it('types admis', () => {
    expect(ENTITY_FILE_KIND_KEYS).toEqual(['duerp_version', 'risk', 'requirement', 'requirement_evaluation', 'control_record', 'review', 'review_item', 'waste_entry']);
    expect(isEntityFileKind('risk')).toBe(true);
    expect(isEntityFileKind('event')).toBe(false);
    expect(isEntityFileKind('action')).toBe(false);
  });
  it('identifiants', () => {
    expect(validEntityId('risk', '12')).toBe(true);
    expect(validEntityId('risk', '0')).toBe(false);
    expect(validEntityId('risk', '1; drop')).toBe(false);
    expect(validEntityId('duerp_version', '2026.1')).toBe(true);
    expect(validEntityId('duerp_version', '../x')).toBe(false);
  });
  it('journal', () => {
    expect(attachSummary('risk', 1)).toBe('Justificatif ajouté');
    expect(attachSummary('control_record', 2, 'enregistrement du 12/03/2026')).toBe('2 fichiers ajoutés (rapport de contrôle) · enregistrement du 12/03/2026');
    expect(detachSummary('duerp_version', 'signe.pdf')).toBe('DUERP signé « signe.pdf » retiré');
  });
});
