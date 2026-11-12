import { describe, expect, it } from 'vitest';
import { attendanceEmail, fmtRate, isMailAddress, sheetBlocker, signatureRate, talkDateError, talkStats } from './safety-talks';

describe('causeries sécurité (CNF-09)', () => {
  it('date : un an en arrière, 90 jours en avant au plus', () => {
    expect(talkDateError('2026-10-09', '2026-10-09')).toBeNull();
    expect(talkDateError('2025-09-01', '2026-10-09')).toMatch(/plus d’un an/);
    expect(talkDateError('2027-03-01', '2026-10-09')).toMatch(/90 jours/);
  });

  it('feuille d’émargement : causerie tenue, non annulée, avec participants', () => {
    expect(sheetBlocker({ heldOn: '2026-10-09', cancelled: false, participants: 2 }, '2026-10-09')).toBeNull();
    expect(sheetBlocker({ heldOn: '2026-10-10', cancelled: false, participants: 2 }, '2026-10-09')).toMatch(/une fois la causerie tenue/);
    expect(sheetBlocker({ heldOn: '2026-10-01', cancelled: true, participants: 2 }, '2026-10-09')).toMatch(/annulée/);
    expect(sheetBlocker({ heldOn: '2026-10-01', cancelled: false, participants: 0 }, '2026-10-09')).toMatch(/Aucun participant/);
  });

  it('indicateurs calculés : causeries par site et par mois, taux d’émargement (annulées exclues)', () => {
    const p = (signed: boolean) => ({ signedAt: signed ? 'x' : null });
    expect(signatureRate([])).toBeNull();
    expect(fmtRate(signatureRate([p(true), p(false)]))).toBe('50 %');
    expect(talkStats([
      { siteId: 'site_a', heldOn: '2026-10-02', cancelled: false, participants: [p(true), p(true)] },
      { siteId: 'site_a', heldOn: '2026-10-08', cancelled: false, participants: [p(false), p(true)] },
      { siteId: 'site_a', heldOn: '2026-10-05', cancelled: true, participants: [p(false)] },
      { siteId: 'site_b', heldOn: '2026-09-15', cancelled: false, participants: [] },
    ])).toEqual([
      { siteId: 'site_a', month: '2026-10', talks: 2, participants: 4, signed: 3, rate: 0.75 },
      { siteId: 'site_b', month: '2026-09', talks: 1, participants: 0, signed: 0, rate: null },
    ]);
  });

  it('e-mail : adresse unique contrôlée, texte et HTML échappé', () => {
    expect(isMailAddress('a.b@exemple.fr')).toBe(true);
    expect(isMailAddress('a@b.fr, c@d.fr')).toBe(false);
    expect(isMailAddress(null)).toBe(false);
    const m = attendanceEmail({ id: 'CS-001', theme: 'EPI <soudage>', heldOn: '2026-10-08', site: 'Site A', animator: '[S. Benali]', link: 'https://vigie.exemple.fr/signaler/mon-espace#causeries' });
    expect(m.subject).toBe("Feuille d'émargement à signer : EPI <soudage> (08/10/2026)");
    expect(m.text).toContain('https://vigie.exemple.fr/signaler/mon-espace#causeries');
    expect(m.html).toContain('EPI &lt;soudage&gt;');
  });
});
