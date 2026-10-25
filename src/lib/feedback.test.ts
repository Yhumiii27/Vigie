import { describe, expect, it } from 'vitest';
import { SAVED_MESSAGE, feedbackOf, savedMessage } from './feedback';

describe('feedbackOf (UX-14)', () => {
  it('erreur renvoyée par l’action', () => {
    expect(feedbackOf({ error: 'Site hors de votre périmètre.' })).toEqual({ tone: 'error', message: 'Site hors de votre périmètre.' });
    expect(feedbackOf({ ok: false, error: 'Refusé.' }, 'OK')).toEqual({ tone: 'error', message: 'Refusé.' });
  });
  it('succès : message demandé, sinon rien à annoncer', () => {
    expect(feedbackOf(undefined, 'Site sélectionné.')).toEqual({ tone: 'ok', message: 'Site sélectionné.' });
    expect(feedbackOf({ ok: true })).toEqual({ tone: 'ok', message: '' });
    expect(feedbackOf({ error: '' }, 'Fait.')).toEqual({ tone: 'ok', message: 'Fait.' });
    expect(feedbackOf({ error: undefined })).toEqual({ tone: 'ok', message: '' });
    expect(feedbackOf('A-12')).toEqual({ tone: 'ok', message: '' });
  });
});

describe('savedMessage', () => {
  it('message de l’action, puis message du formulaire, puis confirmation par défaut', () => {
    expect(savedMessage({ message: 'Action A-12 créée.' }, 'Enregistré.')).toBe('Action A-12 créée.');
    expect(savedMessage({}, 'Commentaire ajouté.')).toBe('Commentaire ajouté.');
    expect(savedMessage({})).toBe(SAVED_MESSAGE);
    expect(savedMessage({ message: '  ' })).toBe(SAVED_MESSAGE);
  });
  it('false : aucune annonce', () => {
    expect(savedMessage({ message: 'x' }, false)).toBeNull();
  });
});
