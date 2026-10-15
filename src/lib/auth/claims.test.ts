import { describe, expect, it } from 'vitest';
import { parseConfig } from '../env';
import { TRUSTED_EMAIL_REFUSALS, hasAllSites, profileFromClaims, roleFromEntra, sitesFromGroups, trustedEmail } from './claims';

const roles = parseConfig({ VIGIE_DEMO: '1' }).entraRoles;

describe('revendications Entra ID', () => {
  it('profil : oid obligatoire, e-mail en minuscules (email, sinon preferred_username)', () => {
    expect(profileFromClaims({ name: 'Sans oid' })).toBeNull();
    expect(profileFromClaims({ oid: 'o1', name: 'A. B', email: 'A.B@Exemple.FR', roles: ['Vigie.Salarie', 3], groups: ['g1'] }))
      .toEqual({ oid: 'o1', name: 'A. B', email: 'a.b@exemple.fr', emailVerified: false, roles: ['Vigie.Salarie'], groups: ['g1'], groupsOverage: false });
    expect(profileFromClaims({ oid: 'o1', preferred_username: 'Pierre@Exemple.fr' })).toMatchObject({ name: 'Pierre@Exemple.fr', email: 'pierre@exemple.fr' });
    expect(profileFromClaims({ oid: 'o1', preferred_username: 'pas-une-adresse' })?.email).toBeNull();
    expect(profileFromClaims({ oid: 'o1', login_hint: 'h' })?.loginHint).toBe('h');
  });

  it('adresse vérifiée : revendication email avec xms_edov vrai seulement', () => {
    for (const edov of [true, 'true', 1, '1']) {
      expect(profileFromClaims({ oid: 'o', email: 'A.B@exemple.fr', xms_edov: edov })).toMatchObject({ email: 'a.b@exemple.fr', emailVerified: true });
    }
    for (const edov of [undefined, false, 'false', 0, 'oui']) {
      expect(profileFromClaims({ oid: 'o', email: 'a.b@exemple.fr', xms_edov: edov })?.emailVerified).toBe(false);
    }
    // preferred_username / upn : adresse candidate (journal, affichage), jamais vérifiée, même avec xms_edov.
    expect(profileFromClaims({ oid: 'o', preferred_username: 'a.b@exemple.fr', xms_edov: true })).toMatchObject({ email: 'a.b@exemple.fr', emailVerified: false });
    expect(profileFromClaims({ oid: 'o', email: 'pas-une-adresse', upn: 'a.b@exemple.fr', xms_edov: true })).toMatchObject({ email: 'a.b@exemple.fr', emailVerified: false });
  });

  it('adresse de confiance : vérifiée et d’un domaine exact de l’entreprise', () => {
    const verified = (email: string | null) => ({ email, emailVerified: true });
    expect(trustedEmail(verified('Anne.Dupont@EXEMPLE.fr'), ['exemple.fr'])).toEqual({ ok: true, email: 'anne.dupont@exemple.fr' });
    expect(trustedEmail(verified('a@epc2i.com'), ['exemple.fr', 'EPC2I.com'])).toEqual({ ok: true, email: 'a@epc2i.com' });
    expect(trustedEmail(verified('a@filiale.exemple.fr'), ['exemple.fr'])).toEqual({ ok: false, reason: 'domaine' });
    expect(trustedEmail(verified('a@exemple.fr.attaquant.example'), ['exemple.fr'])).toEqual({ ok: false, reason: 'domaine' });
    expect(trustedEmail(verified('a@autre.example'), ['exemple.fr'])).toEqual({ ok: false, reason: 'domaine' });
    expect(trustedEmail(verified('a@exemple.fr'), [])).toEqual({ ok: false, reason: 'domaines-non-configures' });
    expect(trustedEmail({ email: 'a@exemple.fr', emailVerified: false }, ['exemple.fr'])).toEqual({ ok: false, reason: 'non-verifiee' });
    expect(trustedEmail(verified(null), ['exemple.fr'])).toEqual({ ok: false, reason: 'absent' });
    expect(Object.keys(TRUSTED_EMAIL_REFUSALS).sort()).toEqual(['absent', 'domaine', 'domaines-non-configures', 'non-verifiee']);
  });

  it('groupes trop nombreux (overage) signalés', () => {
    expect(profileFromClaims({ oid: 'o', _claim_names: { groups: 'src1' } })?.groupsOverage).toBe(true);
    expect(profileFromClaims({ oid: 'o', hasgroups: true })?.groupsOverage).toBe(true);
  });

  it('rôle : le plus élevé des rôles applicatifs, aucun → null', () => {
    expect(roleFromEntra(['Vigie.Salarie', 'Vigie.Direction', 'Vigie.ChefProjet'], roles)).toBe('Direction');
    expect(roleFromEntra(['Vigie.ChefProjet', 'Vigie.ChefService'], roles)).toBe('Chef de service');
    expect(roleFromEntra(['Autre.Application'], roles)).toBeNull();
    expect(roleFromEntra([], roles)).toBeNull();
    const custom = parseConfig({ VIGIE_DEMO: '1', ENTRA_ROLE_SALARIE: 'QHSE.Employe' }).entraRoles;
    expect(roleFromEntra(['QHSE.Employe'], custom)).toBe('Salarié');
    expect(roleFromEntra(['Vigie.Salarie'], custom)).toBeNull();
  });

  it('sites accordés par groupe, sans doublon ; tous les sites pour direction et animateur', () => {
    const map = [{ groupId: 'G-A', siteId: 'ville-a' }, { groupId: 'g-b', siteId: 'ville-b' }, { groupId: 'g-b2', siteId: 'ville-b' }];
    expect(sitesFromGroups(['g-a', 'g-b', 'g-b2', 'autre'], map)).toEqual(['ville-a', 'ville-b']);
    expect(sitesFromGroups([], map)).toEqual([]);
    expect(hasAllSites('Direction') && hasAllSites('Animateur QHSE')).toBe(true);
    expect(hasAllSites('Chef de service') || hasAllSites('Chef de projet') || hasAllSites('Salarié')).toBe(false);
  });
});
