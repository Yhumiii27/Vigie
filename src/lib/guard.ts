import 'server-only';
import { redirect } from 'next/navigation';
import { SCREENS, canApprove, canManage, canSee, homeOf, type ScreenKey } from './domain';
import { ALL_SITES as ALL_SITES_ID, activeSiteIds, getSession, inPerimeter, inSite } from './session';

/** Redirige vers l'écran d'accueil du rôle si l'écran ne lui est pas ouvert. */
export async function guard(screen: ScreenKey) {
  const session = await getSession();
  if (!canSee(session.role, screen)) redirect(SCREENS[homeOf(session.role)].path);
  return session;
}

/** Pour les server actions : renvoie la session si le rôle peut saisir/modifier, sinon un message d'erreur. */
export async function requireManager() {
  const session = await getSession();
  return canManage(session.role) ? { session, error: null } : { session, error: 'Votre rôle ne permet pas cette modification.' };
}

/** Pour les server actions de validation (animateur QHSE, direction). */
export async function requireApprover() {
  const session = await getSession();
  return canApprove(session.role) ? { session, error: null } : { session, error: "Réservé à l'animateur QHSE et à la direction." };
}

/**
 * Contrôle du site sélectionné pour les server actions qui modifient une donnée portant un siteId.
 * Renvoie un message d'erreur, ou null si la modification est permise :
 * - la donnée appartient au périmètre de la personne (sites autorisés, SEC-02) ;
 * - la donnée appartient au site sélectionné (ou vaut pour tous les sites), ou « Tous les sites » est sélectionné ;
 * - `create` : un nouvel enregistrement (ou un changement de site) ne peut viser qu'un site actif du périmètre ;
 *   « Tous les sites » (siteId absent) est réservé au périmètre complet, puisque l'élément paraît alors sur chaque site.
 * À appeler après le chargement de l'enregistrement, avec son siteId (et le nouveau siteId en cas de changement).
 */
export async function requireInSite(siteId: string | null | undefined, opts: { create?: boolean } = {}): Promise<string | null> {
  const { site, allowedSiteIds } = await getSession();
  if (!inPerimeter(allowedSiteIds, siteId)) return "Cet élément appartient à un site hors de votre périmètre.";
  const selected = site.id === ALL_SITES_ID ? null : site.id;
  if (!inSite(selected, siteId)) return "Cet élément appartient à un autre site que celui sélectionné : changez de site pour le modifier.";
  if (opts.create && !siteId && allowedSiteIds) return ALL_SITES_RESERVED;
  if (opts.create && siteId && !(await activeSiteIds()).includes(siteId)) return 'Site archivé ou inconnu : choisissez un site actif.';
  return null;
}

/** Refus d'un élément « Tous les sites » créé (ou transféré) par une personne au périmètre restreint (SEC-02). */
export const ALL_SITES_RESERVED = 'Élément commun à tous les sites : réservé à la direction et à l’animateur QHSE.';
