import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { config, secureCookies } from '../config';
import { cookieAttributes } from './cookie';

// Réponses des routes d'authentification (/auth/connexion, /auth/retour, /auth/deconnexion).

/**
 * Adresse absolue d'un chemin de Vigie : VIGIE_PUBLIC_URL, sinon (démonstration) l'origine de la requête.
 * Un chemin qui sortirait de cette origine (« //hote », URL absolue) est ramené à l'accueil.
 */
export function appUrl(path: string, req: NextRequest): URL {
  const base = new URL(config().publicUrl ?? req.nextUrl.origin);
  const url = new URL(path, base);
  return url.origin === base.origin ? url : new URL('/', base);
}

/** Redirection 303 (navigation GET), jamais mise en cache. */
export function redirectTo(url: URL | string, req: NextRequest): NextResponse {
  const res = NextResponse.redirect(typeof url === 'string' ? appUrl(url, req) : url, 303);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** Pose un cookie d'authentification (httpOnly, SameSite=Lax, Secure en HTTPS). */
export function setAuthCookie(res: NextResponse, name: string, value: string, maxAge: number) {
  res.cookies.set(name, value, cookieAttributes(secureCookies(), maxAge));
}

/** Efface un cookie d'authentification (mêmes attributs, exigés pour un cookie __Host-). */
export function clearAuthCookie(res: NextResponse, name: string) {
  res.cookies.set(name, '', cookieAttributes(secureCookies(), 0));
}
