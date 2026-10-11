import 'server-only';
import * as client from 'openid-client';
import { config } from '../config';
import { CALLBACK_PATH, SIGNED_OUT_PATH } from './paths';

// Client OpenID Connect de Microsoft Entra ID (openid-client v6) : Authorization Code + PKCE, state et nonce.
// Émetteur https://login.microsoftonline.com/<tenant>/v2.0, ou ENTRA_ISSUER (cloud souverain, fournisseur de test
// local scripts/oidc-mock.mjs — seul cas où http:// est admis, voir src/lib/env.ts).

/** Portées : identité (oid, nom), e-mail ; les rôles applicatifs et les groupes arrivent dans le jeton d'identité. */
const SCOPES = 'openid profile email';
/** Métadonnées de découverte gardées 24 h (clés de signature et points de terminaison). */
const DISCOVERY_TTL_MS = 24 * 3600 * 1000;

let discovered: { key: string; at: number; promise: Promise<client.Configuration> } | null = null;

function entra() {
  const c = config();
  if (!c.entra || !c.publicUrl) throw new Error('Microsoft Entra ID non configuré');
  return { ...c.entra, publicUrl: c.publicUrl };
}

/** Configuration du client (découverte de l'émetteur, mémorisée ; un échec n'est pas mémorisé). */
export function oidcConfiguration(): Promise<client.Configuration> {
  const e = entra();
  const key = `${e.issuer}\u0000${e.clientId}\u0000${e.clientSecret}`;
  if (!discovered || discovered.key !== key || Date.now() - discovered.at > DISCOVERY_TTL_MS) {
    const insecure = e.issuer.startsWith('http://');
    const promise = client.discovery(new URL(e.issuer), e.clientId, e.clientSecret, undefined,
      insecure ? { execute: [client.allowInsecureRequests] } : undefined);
    const entry = { key, at: Date.now(), promise };
    discovered = entry;
    promise.catch(() => { if (discovered === entry) discovered = null; });
  }
  return discovered.promise;
}

/** URI de retour inscrite dans l'application Entra (jamais tirée de l'en-tête Host). */
export const redirectUri = () => `${entra().publicUrl}${CALLBACK_PATH}`;

export type LoginStart = { url: URL; state: string; nonce: string; verifier: string };

/** Adresse de la page de connexion Microsoft et contrôles à conserver jusqu'au retour. */
export async function startLogin(): Promise<LoginStart> {
  const oidc = await oidcConfiguration();
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(oidc, {
    redirect_uri: redirectUri(),
    scope: SCOPES,
    response_mode: 'query',
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  return { url, state, nonce, verifier };
}

/**
 * Retour de Microsoft : échange du code (PKCE), contrôle du state, du nonce et du jeton d'identité (émetteur, audience,
 * expiration) ; renvoie les revendications du jeton d'identité.
 */
export async function finishLogin(search: string, checks: { state: string; nonce: string; verifier: string }) {
  const oidc = await oidcConfiguration();
  const tokens = await client.authorizationCodeGrant(oidc, new URL(`${redirectUri()}${search}`), {
    pkceCodeVerifier: checks.verifier,
    expectedState: checks.state,
    expectedNonce: checks.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error("Jeton d'identité absent");
  return claims as unknown as Record<string, unknown>;
}

/** Déconnexion Microsoft (end_session_endpoint), puis retour sur la page « Vous êtes déconnecté » ; null si indisponible. */
export async function endSessionUrl(loginHint?: string): Promise<URL | null> {
  try {
    const oidc = await oidcConfiguration();
    if (!oidc.serverMetadata().end_session_endpoint) return null;
    return client.buildEndSessionUrl(oidc, {
      post_logout_redirect_uri: `${entra().publicUrl}${SIGNED_OUT_PATH}`,
      ...(loginHint ? { logout_hint: loginHint } : {}),
    });
  } catch (err) {
    console.error('[vigie] Déconnexion Microsoft indisponible :', err instanceof Error ? err.message : err);
    return null;
  }
}
