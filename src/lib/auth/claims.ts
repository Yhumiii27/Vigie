// Revendications du jeton d'identité Entra ID → profil, rôle Vigie et sites accordés (SEC-02). Règles pures, testées
// dans claims.test.ts.

import { ROLE_PRECEDENCE, type Role } from '../domain';

/** Ce que Vigie retient du jeton d'identité. */
export type EntraProfile = {
  /** objectId de l'utilisateur dans le tenant (oid), identifiant stable du rapprochement. */
  oid: string;
  name: string;
  /** E-mail professionnel en minuscules (email, sinon preferred_username / upn s'il a la forme d'une adresse). */
  email: string | null;
  /** Rôles applicatifs attribués dans l'application d'entreprise Vigie (revendication roles). */
  roles: string[];
  /** Groupes (objectId) de la revendication groups. */
  groups: string[];
  /** Trop de groupes pour le jeton (« overage ») : la revendication groups est absente, les sites par groupe aussi. */
  groupsOverage: boolean;
  /** login_hint (revendication facultative), repris à la déconnexion. */
  loginHint?: string;
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Profil tiré des revendications ; null sans oid (portée « profile » absente ou jeton inattendu). */
export function profileFromClaims(c: Record<string, unknown>): EntraProfile | null {
  const oid = str(c.oid);
  if (!oid) return null;
  const email = [c.email, c.preferred_username, c.upn].map(str).find((v) => v && EMAIL.test(v))?.toLowerCase() ?? null;
  const claimNames = c._claim_names;
  const groupsOverage = c.hasgroups === true || c.hasgroups === 'true'
    || (!!claimNames && typeof claimNames === 'object' && 'groups' in claimNames);
  return {
    oid,
    name: (str(c.name) ?? str(c.preferred_username) ?? 'Utilisateur Microsoft').slice(0, 80),
    email,
    roles: strings(c.roles),
    groups: strings(c.groups),
    groupsOverage,
    ...(str(c.login_hint) ? { loginHint: str(c.login_hint) } : {}),
  };
}

/** Rôle Vigie : le plus élevé des rôles applicatifs reçus (ROLE_PRECEDENCE) ; null si aucun ne correspond. */
export function roleFromEntra(roles: string[], mapping: Record<Role, string>): Role | null {
  return ROLE_PRECEDENCE.find((r) => roles.includes(mapping[r])) ?? null;
}

/** Direction et animateur QHSE voient tous les sites ; les autres rôles, leur site de rattachement et les sites accordés. */
export const hasAllSites = (role: Role) => role === 'Direction' || role === 'Animateur QHSE';

/** Sites accordés par les groupes Entra (VIGIE_SITE_GROUPS), sans doublon, dans l'ordre de la configuration. */
export function sitesFromGroups(groups: string[], siteGroups: { groupId: string; siteId: string }[]): string[] {
  const mine = new Set(groups.map((g) => g.toLowerCase()));
  return [...new Set(siteGroups.filter((g) => mine.has(g.groupId.toLowerCase())).map((g) => g.siteId))];
}
