import type { NextRequest } from 'next/server';
import { openSession, sessionCookieName } from '@/lib/auth/cookie';
import { endSessionUrl } from '@/lib/auth/oidc';
import { SIGNED_OUT_PATH } from '@/lib/auth/paths';
import { clearAuthCookie, redirectTo } from '@/lib/auth/responses';
import { config, entraMissing, secureCookies } from '@/lib/config';

// Déconnexion (« Se déconnecter » de la barre latérale) : efface la session Vigie, puis termine la session Microsoft
// (end_session_endpoint) avec retour sur /auth/deconnecte.
// Lien GET : une navigation venue d'un autre site (Sec-Fetch-Site: cross-site ou same-site) ne déconnecte pas, elle
// ramène à l'accueil. Navigateur sans cet en-tête (ancien) ou adresse saisie : déconnexion.

const ALLOWED_FETCH_SITES = new Set(['same-origin', 'none']);

export async function GET(req: NextRequest) {
  const c = config();
  if (c.demo) return redirectTo('/', req);
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) return redirectTo('/', req);
  const name = sessionCookieName(secureCookies(c));
  const configured = !entraMissing(c).length;
  const session = configured ? await openSession(req.cookies.get(name)?.value, c.sessionSecret!) : null;
  const microsoft = configured ? await endSessionUrl(session?.hint) : null;
  const res = redirectTo(microsoft ?? SIGNED_OUT_PATH, req);
  clearAuthCookie(res, name);
  return res;
}
