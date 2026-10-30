import { describe, expect, it } from 'vitest';
import { ROLE_KEYS, SCREENS, canApprove, canEdit, canManage, type ScreenKey } from './domain';
import { APPROVER_ONLY, EDIT_DENIED, editorError } from './edit-rights';

const SCREEN_KEYS = Object.keys(SCREENS) as ScreenKey[];

describe('editorError (QUA-18)', () => {
  it('encadrement : refus du Salarié, puis de l’écran en consultation seule ; sinon permis', () => {
    expect(editorError('Salarié', 'events')).toBe(EDIT_DENIED);
    expect(editorError('Chef de projet', 'risks')).toBe(EDIT_DENIED);
    expect(editorError('Chef de service', 'risks')).toBeNull();
    expect(editorError('Chef de service', 'docs', { denied: 'Consultation seule.' })).toBe('Consultation seule.');
    expect(editorError('Salarié', 'docs', { denied: 'Consultation seule.' })).toBe(EDIT_DENIED);
  });

  it('validation : animateur QHSE et direction seulement, sur un écran qu’ils modifient', () => {
    expect(editorError('Chef de service', 'risks', { approver: true })).toBe(APPROVER_ONLY);
    expect(editorError('Animateur QHSE', 'risks', { approver: true })).toBeNull();
    expect(editorError('Direction', 'audits', { approver: true })).toBeNull();
  });

  it('équivaut, pour chaque rôle et écran, aux anciennes gardes par domaine (requireManager / requireApprover puis canEdit)', () => {
    for (const role of ROLE_KEYS) {
      for (const screen of SCREEN_KEYS) {
        const manager = !canManage(role) ? EDIT_DENIED : canEdit(role, screen) ? null : 'X';
        const approver = !canApprove(role) ? APPROVER_ONLY : canEdit(role, screen) ? null : 'X';
        expect(editorError(role, screen, { denied: 'X' }), `${role} ${screen}`).toBe(manager);
        expect(editorError(role, screen, { approver: true, denied: 'X' }), `${role} ${screen} validation`).toBe(approver);
      }
    }
  });
});
