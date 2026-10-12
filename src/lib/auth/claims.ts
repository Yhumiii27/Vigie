// Revendications du jeton d'identité Entra ID → profil, rôle Vigie et sites accordés (SEC-02). Règles pures, testées
// dans claims.test.ts.

import { ROLE_PRECEDENCE, type Role } from '../domain';

/** Ce que Vigie retient du jeton d'identité. */
export type EntraProfile = {
  /** objectId de l'utilisateur dans le tenant (oid), identifiant stable du rapprochement. */
  oid: string;
  name: string;
  /**
   * Adresse candidate en minuscules (email, sinon preferred_username / upn s'il a la forme d'une adresse), pour le
   * journal et l'affichage seulement : seule une adresse de confiance (trustedEmail) rapproche ou crée une fiche.
   */
  email: string | null;
  /** L'adresse vient de la revendication `email` et Microsoft l'a vérifiée (revendication facultative xms_edov). */
  emailVerified: boolean;
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
  const claimed = str(c.email);
  const fromEmailClaim = !!claimed && EMAIL.test(claimed);
  const email = [c.email, c.preferred_username, c.upn].map(str).find((v) => v && EMAIL.test(v))?.toLowerCase() ?? null;
  // xms_edov (« email domain owner verified ») : booléen, ou chaîne selon la version du jeton.
  const edov = c.xms_edov === true || c.xms_edov === 'true' || c.xms_edov === 1 || c.xms_edov === '1';
  const claimNames = c._claim_names;
  const groupsOverage = c.hasgroups === true || c.hasgroups === 'true'
    || (!!claimNames && typeof claimNames === 'object' && 'groups' in claimNames);
  return {
    oid,
    name: (str(c.name) ?? str(c.preferred_username) ?? 'Utilisateur Microsoft').slice(0, 80),
    email,
    emailVerified: fromEmailClaim && edov,
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

/** Motif de refus d'une adresse pour une première connexion (trustedEmail). */
export type EmailRefusal = 'absent' | 'non-verifiee' | 'domaine' | 'domaines-non-configures';

/** Motifs en clair, pour le journal du serveur (la page « Compte Microsoft non rattaché » reste générique). */
export const TRUSTED_EMAIL_REFUSALS: Record<EmailRefusal, string> = {
  absent: "aucune adresse e-mail dans le jeton d'identité (revendication facultative email à déclarer dans l'application Entra)",
  'non-verifiee': "adresse non vérifiée par Microsoft (revendication email absente, ou xms_edov absente ou fausse)",
  domaine: "adresse d'un domaine hors de VIGIE_EMAIL_DOMAINS",
  'domaines-non-configures': 'VIGIE_EMAIL_DOMAINS non renseignée : aucune première connexion admise',
};

/**
 * Adresse de confiance pour une première connexion (SEC-01, SEC-03) : revendication `email` vérifiée par Microsoft
 * (xms_edov) et domaine exact de l'entreprise (`domains`, VIGIE_EMAIL_DOMAINS ; sous-domaines refusés). Seule une telle
 * adresse rapproche une fiche existante ou en crée une ; preferred_username et upn, modifiables, ne suffisent jamais.
 */
export function trustedEmail(profile: Pick<EntraProfile, 'email' | 'emailVerified'>, domains: readonly string[]):
  { ok: true; email: string } | { ok: false; reason: EmailRefusal } {
  const email = profile.email?.trim().toLowerCase();
  if (!email) return { ok: false, reason: 'absent' };
  if (!profile.emailVerified) return { ok: false, reason: 'non-verifiee' };
  if (!domains.length) return { ok: false, reason: 'domaines-non-configures' };
  const domain = email.slice(email.lastIndexOf('@') + 1);
  return domains.some((d) => d.toLowerCase() === domain) ? { ok: true, email } : { ok: false, reason: 'domaine' };
}
