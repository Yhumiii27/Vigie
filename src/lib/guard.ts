import 'server-only';
import { redirect } from 'next/navigation';
import { SCREENS, canApprove, canManage, canSee, homeOf, type ScreenKey } from './domain';
import { APPROVER_ONLY, EDIT_DENIED, editorError, type EditorOptions } from './edit-rights';
import { ALL_SITES as ALL_SITES_ID, activeSiteIds, getSession, inPerimeter, inSite, type SiteOption } from './session';

/**
 * Redirige vers l'écran d'accueil du rôle si l'écran ne lui est pas ouvert. Pour les chemins de ROLE_ROUTES
 * (src/lib/auth/route-access.ts), le proxy redirige déjà avant le rendu (SEC-14) ; guard() reste le contrôle qui fait foi
 * (server actions, rendus sans passage par le proxy).
 */
export async function guard(screen: ScreenKey) {
  const session = await getSession();
  if (!canSee(session.role, screen)) redirect(SCREENS[homeOf(session.role)].path);
  return session;
}

/** Pour les server actions : renvoie la session si le rôle peut saisir/modifier, sinon un message d'erreur. */
export async function requireManager() {
  const session = await getSession();
  return canManage(session.role) ? { session, error: null } : { session, error: EDIT_DENIED };
}

/** Pour les server actions de validation (animateur QHSE, direction). */
export async function requireApprover() {
  const session = await getSession();
  return canApprove(session.role) ? { session, error: null } : { session, error: APPROVER_ONLY };
}

/**
 * Garde commune des server actions d'un écran (QUA-18) : encadrement (ou validation avec `approver`) et écran modifiable
 * par le rôle (canEdit : ouvert et non limité à la consultation). Renvoie la session et le message de refus (editorError,
 * src/lib/edit-rights.ts), ou null.
 */
export async function requireEditor(screen: ScreenKey, opts: EditorOptions = {}) {
  const session = await getSession();
  return { session, error: editorError(session.role, screen, opts) };
}

/**
 * Contrôle du site sélectionné pour les server actions qui modifient une donnée portant un siteId.
 * Équivalent à writableSites() pour une création : les deux règles doivent rester identiques.
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

/**
 * Sites proposés par les formulaires (champ Site, SEC-02, EVT-23) : exactement ceux qu'accepte
 * requireInSite(siteId, { create: true }) — à garder équivalents.
 * - `sites` : sites actifs du périmètre (sélecteur de site sans « Tous les sites »), réduits au site sélectionné quand
 *   un site est sélectionné ;
 * - `allSites` : le choix « Tous les sites » (élément commun à tous les sites) est admis, c'est-à-dire périmètre complet.
 */
export async function writableSites(): Promise<{ sites: SiteOption[]; allSites: boolean }> {
  const { site, siteOptions, allowedSiteIds } = await getSession();
  const active = siteOptions.filter((s) => s.id !== ALL_SITES_ID);
  return { sites: site.id === ALL_SITES_ID ? active : active.filter((s) => s.id === site.id), allSites: !allowedSiteIds };
}
