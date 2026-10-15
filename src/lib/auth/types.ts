import type { Role } from '../domain';

// Contrat entre la session (src/lib/session.ts) et les fournisseurs d'identité : démonstration (cookie de rôle)
// ou Microsoft Entra ID (cookie de session chiffré). Lecture sans accès à la base : appelable dans une transaction.

/** Personne connectée, telle que le fournisseur d'identité l'établit. */
export type AuthIdentity = {
  /** people.id de la fiche rapprochée (objectId Entra, sinon e-mail) ou créée à la connexion. */
  personId: string;
  /** Rôle Vigie (le plus élevé des rôles applicatifs Entra). */
  role: Role;
  /**
   * Sites autorisés à la connexion (groupes Entra, VIGIE_SITE_GROUPS, + site de rattachement d'alors) ; null = tous
   * les sites (Direction, Animateur QHSE, démonstration). La session y ajoute le site de rattachement actuel de la fiche.
   */
  siteIds: string[] | null;
};

/** Raison d'un refus d'accès (page /auth/acces?motif=…). */
export type AccessDenial =
  /** Entra ID non configuré (variables manquantes) : jamais de rôle par défaut hors démonstration. */
  | { status: 'unconfigured'; missing: string[] }
  /** Connecté sans rôle applicatif Vigie, ou fiche introuvable. */
  | { status: 'forbidden'; reason: string };

export type AuthState =
  | { status: 'authenticated'; identity: AuthIdentity }
  /** Pas de session : connexion requise (redirection vers /auth/connexion). */
  | { status: 'anonymous' }
  | AccessDenial;
