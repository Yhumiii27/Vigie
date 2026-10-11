import { describe, expect, it } from 'vitest';
import { parseConfig } from '../env';
import { hasAllSites, profileFromClaims, roleFromEntra, sitesFromGroups } from './claims';

const roles = parseConfig({ VIGIE_DEMO: '1' }).entraRoles;

describe('revendications Entra ID', () => {
  it('profil : oid obligatoire, e-mail en minuscules (email, sinon preferred_username)', () => {
    expect(profileFromClaims({ name: 'Sans oid' })).toBeNull();
    expect(profileFromClaims({ oid: 'o1', name: 'A. B', email: 'A.B@Exemple.FR', roles: ['Vigie.Salarie', 3], groups: ['g1'] }))
      .toEqual({ oid: 'o1', name: 'A. B', email: 'a.b@exemple.fr', roles: ['Vigie.Salarie'], groups: ['g1'], groupsOverage: false });
    expect(profileFromClaims({ oid: 'o1', preferred_username: 'Pierre@Exemple.fr' })).toMatchObject({ name: 'Pierre@Exemple.fr', email: 'pierre@exemple.fr' });
    expect(profileFromClaims({ oid: 'o1', preferred_username: 'pas-une-adresse' })?.email).toBeNull();
    expect(profileFromClaims({ oid: 'o1', login_hint: 'h' })?.loginHint).toBe('h');
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
