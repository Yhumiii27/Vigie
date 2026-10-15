// Cookies d'authentification Entra ID : session et transaction OIDC, chiffrés et authentifiés (JWE « dir » + A256GCM,
// jose), clés dérivées de VIGIE_SESSION_SECRET. Module sans 'server-only' ni accès à la base : utilisé par proxy.ts
// (contrôle et renouvellement de la session avant le rendu) et par src/lib/auth/entra.ts.

import { hkdfSync } from 'node:crypto';
import { EncryptJWT, jwtDecrypt, type JWTPayload } from 'jose';
import type { Role } from '../domain';

/** Expiration glissante : sans activité pendant 8 h, la session tombe. */
export const SESSION_IDLE_SECONDS = 8 * 3600;
/** Expiration absolue : 12 h après la connexion, nouvelle connexion Microsoft obligatoire. */
export const SESSION_ABSOLUTE_SECONDS = 12 * 3600;
/** Le cookie n'est réémis (expiration repoussée) qu'après 5 min, pas à chaque requête. */
export const SESSION_RENEW_AFTER_SECONDS = 5 * 60;
/** Durée de vie d'une connexion en cours (aller-retour par la page Microsoft). */
export const OIDC_TRANSACTION_SECONDS = 10 * 60;

/** Contenu de la session (cookie chiffré) : établi à la connexion, sans données personnelles au-delà de l'identifiant. */
export type SessionClaims = {
  /** people.id de la fiche rapprochée ou créée à la connexion. */
  pid: string;
  /** Rôle Vigie : le plus élevé des rôles applicatifs Entra à la connexion. */
  role: Role;
  /** Sites accordés à la connexion (groupes Entra + site de rattachement d'alors) ; null = tous les sites. */
  sites: string[] | null;
  /** objectId Entra (oid). */
  oid: string;
  /** Revendication login_hint (facultative) : déconnexion Microsoft sans sélecteur de compte. */
  hint?: string;
  /** Début de la session (secondes epoch). */
  auth: number;
  /** Dernière activité constatée (secondes epoch). */
  seen: number;
};

/** Connexion en cours : contrôles PKCE, state et nonce, page à rouvrir ensuite. */
export type OidcTransaction = { state: string; nonce: string; verifier: string; retour: string };

const ENC = { alg: 'dir', enc: 'A256GCM' } as const;
const DECRYPT_OPTIONS = { keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'] };

const keys = new Map<string, Uint8Array>();
/** Clé de 256 bits propre à chaque usage (HKDF-SHA256 du secret de session). */
function key(secret: string, usage: 'session' | 'oidc'): Uint8Array {
  const id = `${usage}\u0000${secret}`;
  let k = keys.get(id);
  if (!k) {
    k = new Uint8Array(hkdfSync('sha256', secret, 'vigie', `vigie-${usage}-v1`, 32));
    keys.set(id, k);
  }
  return k;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Noms des cookies : préfixe __Host- en HTTPS (cookie lié à l'hôte, Secure, chemin /). */
export const sessionCookieName = (secure: boolean) => (secure ? '__Host-vigie_session' : 'vigie_session');
/** Un cookie par connexion en cours, nommé d'après son state : deux onglets peuvent se connecter en même temps. */
export const oidcCookieName = (secure: boolean, state: string) =>
  `${secure ? '__Host-' : ''}vigie_oidc_${state.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16)}`;

/** Attributs communs : httpOnly, SameSite=Lax (retour de Microsoft par navigation GET), Secure en HTTPS. */
export const cookieAttributes = (secure: boolean, maxAge: number) =>
  ({ httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge }) as const;

/** Fin de validité de la session : la plus proche des deux expirations. */
export const sessionExpiresAt = (c: Pick<SessionClaims, 'auth' | 'seen'>) =>
  Math.min(c.seen + SESSION_IDLE_SECONDS, c.auth + SESSION_ABSOLUTE_SECONDS);

/** Secondes restantes (max-age du cookie). */
export const sessionMaxAge = (c: SessionClaims, now = nowSeconds()) => Math.max(0, sessionExpiresAt(c) - now);

/** Vrai si le cookie doit être réémis (activité constatée depuis plus de 5 min). */
export const sessionNeedsRenewal = (c: SessionClaims, now = nowSeconds()) => now - c.seen >= SESSION_RENEW_AFTER_SECONDS;

export async function sealSession(claims: SessionClaims, secret: string): Promise<string> {
  return new EncryptJWT({ ...claims } as JWTPayload)
    .setProtectedHeader(ENC)
    .setIssuedAt(claims.seen)
    .setExpirationTime(sessionExpiresAt(claims))
    .encrypt(key(secret, 'session'));
}

/** Session valide (déchiffrée, intègre, non expirée), sinon null. */
export async function openSession(token: string | undefined, secret: string, now = nowSeconds()): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload: p } = await jwtDecrypt(token, key(secret, 'session'), { ...DECRYPT_OPTIONS, currentDate: new Date(now * 1000) });
    const sites = p.sites;
    const valid = typeof p.pid === 'string' && p.pid && typeof p.role === 'string' && typeof p.oid === 'string'
      && typeof p.auth === 'number' && typeof p.seen === 'number'
      && (sites === null || (Array.isArray(sites) && sites.every((s) => typeof s === 'string')))
      && (p.hint === undefined || typeof p.hint === 'string');
    if (!valid) return null;
    const claims: SessionClaims = {
      pid: p.pid as string, role: p.role as Role, sites: sites as string[] | null, oid: p.oid as string,
      ...(p.hint ? { hint: p.hint as string } : {}), auth: p.auth as number, seen: p.seen as number,
    };
    // Horloges : une session « du futur » (au-delà d'une minute) est refusée.
    if (claims.auth > now + 60 || claims.seen > now + 60 || sessionExpiresAt(claims) <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function sealTransaction(tx: OidcTransaction, secret: string, now = nowSeconds()): Promise<string> {
  return new EncryptJWT({ ...tx })
    .setProtectedHeader(ENC)
    .setIssuedAt(now)
    .setExpirationTime(now + OIDC_TRANSACTION_SECONDS)
    .encrypt(key(secret, 'oidc'));
}

export async function openTransaction(token: string | undefined, secret: string): Promise<OidcTransaction | null> {
  if (!token) return null;
  try {
    const { payload: p } = await jwtDecrypt(token, key(secret, 'oidc'), DECRYPT_OPTIONS);
    if (typeof p.state !== 'string' || typeof p.nonce !== 'string' || typeof p.verifier !== 'string' || typeof p.retour !== 'string') return null;
    return { state: p.state, nonce: p.nonce, verifier: p.verifier, retour: p.retour };
  } catch {
    return null;
  }
}
