// Accès aux écrans selon le rôle, décidé avant le rendu par src/proxy.ts (SEC-14) : redirection vers l'écran d'accueil
// du rôle, ou page introuvable (404) pour l'aperçu mobile hors démonstration. Module sans 'server-only' ni dépendance
// serveur (utilisable par proxy.ts). Les pages gardent leur contrôle (guard(), src/lib/guard.ts), qui fait foi : la table
// ci-dessous doit lui correspondre — src/lib/auth/route-access.test.ts compare ROLE_ROUTES aux appels guard() des pages.

import { DEMO_DEFAULT_ROLE } from '../demo';
import { REPORT_POSTS_PATH } from './paths';
import { ROLE_KEYS, SCREENS, canManage, canSee, canSeeHealth, homeOf, type Role, type ScreenKey } from '../domain';

/**
 * Chemins des écrans gardés par rôle (page.tsx avec guard('<écran>')) : le chemin le plus long l'emporte.
 * - `subpaths` : les sous-chemins relèvent du même écran (impressions, carte, import…) ;
 * - `except` : sous-chemins exclus — route handlers qui répondent eux-mêmes 403 (export CSV), jamais redirigés.
 */
export const ROLE_ROUTES: readonly { path: string; screen: ScreenKey; subpaths: boolean; except?: readonly string[] }[] = [
  { path: '/', screen: 'dashboard', subpaths: false },
  { path: '/a-faire', screen: 'todo', subpaths: true },
  { path: '/evenements', screen: 'events', subpaths: true },
  { path: '/actions', screen: 'actions', subpaths: true },
  { path: '/prevention', screen: 'prevention', subpaths: true },
  { path: '/risques', screen: 'risks', subpaths: true, except: ['/risques/export'] },
  { path: '/habilitations', screen: 'skills', subpaths: true },
  { path: '/veille', screen: 'watch', subpaths: true },
  { path: '/audits', screen: 'audits', subpaths: true },
  { path: '/audits/contributions', screen: 'contributions', subpaths: true },
  { path: '/revue-de-direction', screen: 'audits', subpaths: true },
  { path: '/documents', screen: 'docs', subpaths: true },
  { path: '/environnement', screen: 'env', subpaths: true, except: ['/environnement/registre'] },
];

/**
 * Cible de réécriture d'une page à masquer (404) : dossier privé « _… », jamais routable — la page introuvable racine
 * (src/app/not-found.tsx) répond alors avec le statut 404, avant tout rendu de la page masquée.
 */
export const NOT_FOUND_PATH = '/_introuvable';

/** Gestion des QR codes de poste (REPORT_POSTS_PATH) : encadrement seulement, sinon vers le signalement. */
const REPORT_PATH = '/signaler';
/**
 * Pages d'un écran ouvert réservées aux rôles habilités aux données de santé (canSeeHealth) : vers la page de l'écran.
 * Registre des accidents bénins (EVT-04, BENIGN_REGISTER_PATH de src/components/events/shared.ts), synthèse de la DAT
 * (EVT-10) et bilan annuel SSCT (CNF-03).
 */
export const HEALTH_PAGES: readonly { path: string; back: string }[] = [
  { path: '/evenements/registre-benin', back: '/evenements' },
  // Synthèse imprimable de la DAT et feuille d'accident (EVT-10, DAT_PRINT_PATH).
  { path: '/evenements/imprimer', back: '/evenements' },
  // Bilan annuel santé, sécurité et conditions de travail (CNF-03, BILAN_SSCT_PATH) : accidents, maladies professionnelles.
  { path: '/risques/bilan-ssct', back: '/risques' },
];

const under = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);
const normalize = (pathname: string) => (pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname);

/** Écran gardé d'un chemin (ROLE_ROUTES), ou null s'il n'en relève pas (routes publiques, route handlers exclus…). */
export function screenOfPath(pathname: string): ScreenKey | null {
  const p = normalize(pathname);
  const route = ROLE_ROUTES
    .filter((r) => (r.subpaths ? under(p, r.path) : p === r.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!route || route.except?.some((e) => under(p, e))) return null;
  return route.screen;
}

/** Rôle de démonstration (cookie du sélecteur) : valeur reconnue, sinon le rôle par défaut (src/lib/auth/demo.ts aussi). */
export function demoRoleOf(raw: string | undefined): Role {
  return raw && (ROLE_KEYS as string[]).includes(raw) ? (raw as Role) : DEMO_DEFAULT_ROLE;
}

export type RouteDecision = { kind: 'pass' } | { kind: 'redirect'; to: string } | { kind: 'notFound' };

/**
 * Décision du proxy pour une page demandée (GET, HEAD) par une personne de rôle `role` :
 * - aperçu mobile (/apercu-mobile…) : introuvable hors démonstration ;
 * - QR codes des postes (/signaler/postes) sans droit de gestion : vers /signaler ;
 * - écran fermé au rôle : vers l'écran d'accueil du rôle (même règle que guard()) ;
 * - page réservée aux données de santé (HEALTH_PAGES) sans habilitation : vers la page de l'écran.
 */
export function routeDecision(pathname: string, role: Role, demo: boolean): RouteDecision {
  const p = normalize(pathname);
  if (under(p, SCREENS.mobile.path)) return demo ? { kind: 'pass' } : { kind: 'notFound' };
  if (under(p, REPORT_POSTS_PATH) && !canManage(role)) return { kind: 'redirect', to: REPORT_PATH };
  const screen = screenOfPath(p);
  if (screen && !canSee(role, screen)) return { kind: 'redirect', to: SCREENS[homeOf(role)].path };
  const health = HEALTH_PAGES.find((h) => under(p, h.path));
  if (health && !canSeeHealth(role)) return { kind: 'redirect', to: health.back };
  return { kind: 'pass' };
}
