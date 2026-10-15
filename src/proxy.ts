import { NextResponse, type NextRequest } from 'next/server';
import { cookieAttributes, openSession, sealSession, sessionCookieName, sessionMaxAge, sessionNeedsRenewal } from './lib/auth/cookie';
import { AUTH_PREFIX, HEALTH_PATH, LOGIN_PATH, REPORT_PATH, REPORT_TOKEN_PARAM, accessHref, looksLikeReportToken } from './lib/auth/paths';
import { NOT_FOUND_PATH, demoRoleOf, routeDecision } from './lib/auth/route-access';
import { DEMO_ROLE_COOKIE } from './lib/demo';
import { ROLE_KEYS, type Role } from './lib/domain';
import { entraMissing, isDevServer, readConfig, secureCookies, type VigieConfig } from './lib/env';
import { HSTS_HEADER, REFUSAL_CSP, contentSecurityPolicy, cspNonce, isAllowedHost, originHost, requestHosts } from './lib/security';

// Proxy Next.js 16 (ex-middleware, exécuté avant le rendu, moteur Node.js) :
// 1. SEC-04 — refuse les hôtes inconnus (DNS rebinding) et, pour une requête qui modifie (POST…), une origine inconnue ;
// 2. SEC-01 — hors démonstration, renvoie vers la connexion Microsoft toute route applicative sans session valide,
//    et repousse l'expiration glissante de la session ;
// 3. SEC-05 — Content-Security-Policy à nonce (pages rendues dynamiquement) et HSTS en HTTPS ; les autres en-têtes
//    de sécurité sont posés par next.config.ts ;
// 4. SEC-14 — pour une page (GET, HEAD) d'un écran fermé au rôle de la session : redirection vers l'écran d'accueil du
//    rôle avant tout rendu (src/lib/auth/route-access.ts) ; aperçu mobile hors démonstration : page introuvable (404).
//    Les server actions (POST) gardent leurs propres contrôles.
// Les pages, routes et server actions vérifient quand même la session (getSession) et le rôle (guard) : le proxy n'est
// qu'une première barrière.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Routes ouvertes sans session : authentification, santé, signalement terrain avec jeton de poste. */
function isPublic(req: NextRequest): boolean {
  const { pathname, searchParams } = req.nextUrl;
  if (pathname.startsWith(AUTH_PREFIX) || pathname === HEALTH_PATH) return true;
  // Point d'extension du signalement sans compte (EVT-07) : la page /signaler et sa server action vérifient le jeton
  // (HMAC, version du QR code) et la limite de débit ; le proxy ne contrôle que sa présence et sa forme.
  return pathname === REPORT_PATH && looksLikeReportToken(searchParams.get(REPORT_TOKEN_PARAM));
}

const text = (body: string, status: number) =>
  new NextResponse(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/** Adresse absolue d'un chemin : adresse publique (jamais l'en-tête Host), sinon origine de la requête (démonstration). */
const absolute = (path: string, req: NextRequest, c: VigieConfig) => new URL(path, c.publicUrl ?? req.nextUrl.origin);

function hostCheck(req: NextRequest, c: VigieConfig): NextResponse | null {
  // Démonstration : localhost, adresse IP ou nom .local en plus (application Mac ouverte au réseau local) ;
  // production : liste stricte, sauf localhost pour la route de santé (sonde du conteneur).
  const extra = c.demo ? 'local' : req.nextUrl.pathname === HEALTH_PATH ? 'loopback' : 'none';
  if (!requestHosts(req.headers).every((h) => isAllowedHost(h, c.allowedHosts, extra))) {
    return text('Hôte non autorisé (VIGIE_ALLOWED_HOSTS).', 400);
  }
  // Requête qui modifie (server action, formulaire) : l'origine du navigateur doit être un hôte admis.
  const origin = req.headers.get('origin');
  if (!SAFE_METHODS.has(req.method) && origin !== null && !isAllowedHost(originHost(origin), c.allowedHosts, c.demo ? 'local' : 'none')) {
    return text('Origine non autorisée.', 403);
  }
  return null;
}

type AuthCheck = {
  /** Réponse de refus (connexion, configuration incomplète, session expirée), ou null. */
  deny: NextResponse | null;
  /** Rôle de la session (ou du sélecteur de démonstration) ; absent pour une route publique. */
  role?: Role;
  /** Renouvellement de l'expiration glissante, à appliquer à la réponse. */
  renew?: (res: NextResponse) => Promise<void>;
};

/** Session Entra ID : null si elle est valide (et la réponse à renouveler éventuelle), sinon la réponse de refus. */
async function authCheck(req: NextRequest, c: VigieConfig): Promise<AuthCheck> {
  if (isPublic(req)) return { deny: null };
  if (c.demo) return { deny: null, role: demoRoleOf(req.cookies.get(DEMO_ROLE_COOKIE)?.value) };
  const safe = SAFE_METHODS.has(req.method);
  if (entraMissing(c).length) {
    return { deny: safe ? NextResponse.redirect(absolute(accessHref('configuration'), req, c)) : text('Authentification non configurée.', 503) };
  }
  const secure = secureCookies(c);
  const name = sessionCookieName(secure);
  const token = req.cookies.get(name)?.value;
  const now = Math.floor(Date.now() / 1000);
  const session = await openSession(token, c.sessionSecret!, now);
  if (!session) {
    const retour = new URL(req.nextUrl);
    retour.searchParams.delete('_rsc');
    const login = absolute(`${LOGIN_PATH}?retour=${encodeURIComponent(`${retour.pathname}${retour.search}`)}`, req, c);
    const deny = safe ? NextResponse.redirect(login) : text('Session expirée : rechargez la page pour vous reconnecter.', 401);
    if (token) deny.cookies.set(name, '', cookieAttributes(secure, 0));
    return { deny };
  }
  const role = (ROLE_KEYS as string[]).includes(session.role) ? session.role : undefined;
  if (!sessionNeedsRenewal(session, now)) return { deny: null, role };
  const renewed = { ...session, seen: now };
  return {
    deny: null,
    role,
    renew: async (res) => { res.cookies.set(name, await sealSession(renewed, c.sessionSecret!), cookieAttributes(secure, sessionMaxAge(renewed, now))); },
  };
}

/** Réponse de refus du proxy (hôte, origine, session) : jamais mise en cache, CSP fermée, HSTS en HTTPS. */
function refusal(res: NextResponse, https: boolean): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('Content-Security-Policy', REFUSAL_CSP);
  if (https) res.headers.set('Strict-Transport-Security', HSTS_HEADER);
  return res;
}

export async function proxy(req: NextRequest) {
  const c = readConfig();
  const https = secureCookies(c);
  const refused = hostCheck(req, c);
  if (refused) return refusal(refused, https);
  const { deny, renew, role } = await authCheck(req, c);
  if (deny) return refusal(deny, https);

  // Écran fermé au rôle (SEC-14) : décidé avant le rendu, pour les pages seulement (jamais les server actions).
  const decision = role && (req.method === 'GET' || req.method === 'HEAD') ? routeDecision(req.nextUrl.pathname, role, c.demo) : null;
  if (decision?.kind === 'redirect') {
    const res = refusal(NextResponse.redirect(absolute(decision.to, req, c)), https);
    await renew?.(res);
    return res;
  }

  let res: NextResponse;
  // Pièces jointes servies telles quelles (PDF affiché par le navigateur) : pas de CSP de page.
  if (req.nextUrl.pathname.startsWith('/fichiers/')) {
    res = NextResponse.next();
  } else {
    const nonce = cspNonce();
    const csp = contentSecurityPolicy(nonce, { dev: isDevServer(), https });
    const headers = new Headers(req.headers);
    headers.set('content-security-policy', csp);
    headers.set('x-nonce', nonce);
    // Page masquée : réécrite vers un chemin jamais routable, la page introuvable répond 404 (avec son nonce).
    res = decision?.kind === 'notFound'
      ? NextResponse.rewrite(new URL(NOT_FOUND_PATH, req.url), { request: { headers } })
      : NextResponse.next({ request: { headers } });
    res.headers.set('Content-Security-Policy', csp);
  }
  if (https) res.headers.set('Strict-Transport-Security', HSTS_HEADER);
  await renew?.(res);
  return res;
}

export const config = {
  // Tout sauf les ressources statiques de Next.js (hachées, publiques) et le rechargement à chaud.
  matcher: ['/((?!_next/static|_next/image|_next/webpack-hmr|favicon\\.ico).*)'],
};
