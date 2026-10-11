// En-têtes de sécurité HTTP (SEC-05) et contrôle de l'hôte (SEC-04). Module sans dépendance serveur :
// utilisé par src/proxy.ts (CSP à nonce, HSTS, hôtes admis) et par next.config.ts (en-têtes fixes).

import { isLoopbackHost } from './env';

/** En-têtes fixes, sur toutes les réponses (next.config.ts). */
export const STATIC_SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Caméra : photo du signalement terrain ; le reste est fermé.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()' },
];

/** HSTS (1 an), envoyé quand Vigie est servi en HTTPS. */
export const HSTS_HEADER = 'max-age=31536000';

/** Nonce de CSP, nouveau à chaque requête (Next.js l'applique à ses scripts d'après l'en-tête de la requête). */
export function cspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Content-Security-Policy des pages : scripts par nonce ('strict-dynamic' pour les morceaux chargés par Next.js).
 * Styles : 'unsafe-inline', car l'interface utilise des attributs style (React) ; aucun script en ligne n'est admis.
 * Images et aperçus locaux en blob:/data: (photos avant envoi, plan de site) ; worker pdf.js servi par Vigie.
 */
export function contentSecurityPolicy(nonce: string, opts: { dev: boolean; https: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self'${opts.dev ? ' ws: wss:' : ''}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/**
 * CSP des réponses produites par le proxy lui-même (refus 400/401/403/503 en texte, redirections vers la connexion) :
 * rien à charger, rien à intégrer.
 */
export const REFUSAL_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Première valeur d'un en-tête à valeurs multiples (X-Forwarded-Host: a, b). */
const first = (v: string | null) => v?.split(',')[0].trim().toLowerCase() || null;

/**
 * Hôtes admis en plus de la liste : `loopback` = localhost (route de santé, sonde du conteneur) ; `local` = localhost,
 * adresse IP littérale ou nom mDNS en .local (démonstration : application Mac ouverte au réseau local, téléphone qui
 * ouvre /signaler). Une adresse IP ou un nom .local ne peut pas servir à un DNS rebinding depuis un site extérieur.
 */
export type ExtraHosts = 'none' | 'loopback' | 'local';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
function isLocalNetworkHost(host: string): boolean {
  if (isLoopbackHost(host)) return true;
  if (host.startsWith('[')) return /^\[[0-9a-f:.]+\](:\d+)?$/.test(host);
  const name = host.replace(/:\d+$/, '');
  return IPV4.test(name) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.local$/.test(name);
}

/** Hôte admis (anti DNS rebinding) : VIGIE_ALLOWED_HOSTS + hôte de VIGIE_PUBLIC_URL, plus `extra`. */
export function isAllowedHost(host: string | null, allowed: string[], extra: ExtraHosts = 'none'): boolean {
  const h = first(host);
  if (!h) return false;
  if (allowed.includes(h)) return true;
  if (extra === 'loopback') return isLoopbackHost(h);
  return extra === 'local' && isLocalNetworkHost(h);
}

/** Hôtes à contrôler : Host et, derrière un reverse proxy, X-Forwarded-Host (que Next.js prend pour l'origine). */
export function requestHosts(headers: Headers): (string | null)[] {
  const forwarded = headers.get('x-forwarded-host');
  return [headers.get('host'), ...(forwarded ? [forwarded] : [])];
}

/** Hôte de l'en-tête Origin (null si absent, « null » ou invalide). */
export function originHost(origin: string | null): string | null {
  if (!origin || origin === 'null') return null;
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}
