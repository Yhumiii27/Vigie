import { describe, expect, it } from 'vitest';
import { NEW_EVENT_SOURCES, newEventHref, prefillKey, prefillType, sourceParam } from './event-prefill';

// EVT-24 : « Nouvel événement » prérempli depuis la fiche d'un autre écran (liens et paramètres d'URL).

describe('« Nouvel événement » prérempli (EVT-24)', () => {
  it('lien de chaque source, identifiant encodé', () => {
    expect(newEventHref('controle', 12)).toBe('/evenements?nouveau=1&controle=12');
    expect(newEventHref('document', 'PR-QHSE 01')).toBe('/evenements?nouveau=1&document=PR-QHSE%2001');
    expect(newEventHref('type', 'ENV')).toBe('/evenements?nouveau=1&type=ENV');
    expect(NEW_EVENT_SOURCES).toEqual(['plan', 'permis', 'controle', 'risque', 'document']);
  });

  it('type proposé : types déclarables seulement, jamais une maladie professionnelle', () => {
    expect(prefillType('ENV')).toBe('ENV');
    expect(prefillType('NC')).toBe('NC');
    expect(prefillType('MP')).toBeUndefined();
    expect(prefillType('XYZ')).toBeUndefined();
    expect(prefillType(undefined)).toBeUndefined();
  });

  it('paramètre de source : texte non vide et court, sinon ignoré', () => {
    expect(sourceParam({ risque: ' 42 ' }, 'risque')).toBe('42');
    expect(sourceParam({ risque: '' }, 'risque')).toBeUndefined();
    expect(sourceParam({ risque: ['1', '2'] }, 'risque')).toBeUndefined();
    expect(sourceParam({ document: 'x'.repeat(61) }, 'document')).toBeUndefined();
  });

  it('clé du formulaire : change avec la source, « new » hors préremplissage', () => {
    expect(prefillKey({})).toBe('new');
    expect(prefillKey({ nouveau: '1', controle: '3' })).not.toBe(prefillKey({ nouveau: '1', controle: '4' }));
    expect(prefillKey({ nouveau: '1', type: 'MP' })).toBe(prefillKey({ nouveau: '1' }));
  });
});
