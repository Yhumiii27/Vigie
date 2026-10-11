import type { NextRequest } from 'next/server';
import { OIDC_TRANSACTION_SECONDS, oidcCookieName, sealTransaction } from '@/lib/auth/cookie';
import { startLogin } from '@/lib/auth/oidc';
import { accessHref, safeReturnPath } from '@/lib/auth/paths';
import { clearAuthCookie, redirectTo, setAuthCookie } from '@/lib/auth/responses';
import { config, entraMissing, secureCookies } from '@/lib/config';

// Connexion Microsoft Entra ID (SEC-01) : /auth/connexion?retour=<chemin> → page de connexion Microsoft.
// Les contrôles (state, nonce, code_verifier PKCE) et la page à rouvrir voyagent dans un cookie chiffré de 10 min.

export async function GET(req: NextRequest) {
  const c = config();
  const retour = safeReturnPath(req.nextUrl.searchParams.get('retour'));
  // Démonstration : le rôle se choisit dans le sélecteur, pas de connexion.
  if (c.demo) return redirectTo(retour, req);
  if (entraMissing(c).length) return redirectTo(accessHref('configuration'), req);
  let login;
  try {
    login = await startLogin();
  } catch (err) {
    console.error('[vigie] Connexion Entra ID impossible (découverte OIDC) :', err instanceof Error ? err.message : err);
    return redirectTo(accessHref('echec'), req);
  }
  const res = redirectTo(login.url, req);
  const secure = secureCookies(c);
  // Connexions abandonnées qui s'accumulent (onglets, retours arrière) : à partir de 3, elles sont effacées.
  const prefix = oidcCookieName(secure, '');
  const pending = req.cookies.getAll().filter((k) => k.name.startsWith(prefix));
  if (pending.length >= 3) pending.forEach((k) => clearAuthCookie(res, k.name));
  const tx = await sealTransaction({ state: login.state, nonce: login.nonce, verifier: login.verifier, retour }, c.sessionSecret!);
  setAuthCookie(res, oidcCookieName(secure, login.state), tx, OIDC_TRANSACTION_SECONDS);
  return res;
}
