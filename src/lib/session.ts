import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { authFailureHref, getAuthState } from './auth';
import { accessHref } from './auth/paths';
import { isDemo } from './config';
import { ALL_SITES, type Role } from './domain';
import { PERSON_COLUMNS, hasLeft, type Person } from './people';
import { today } from './today';

export const SITE_COOKIE = 'vigie_site';
export { ALL_SITES };

export type SiteOption = { id: string; label: string };

/** Session applicative : rôle, fiche de la personne connectée et site sélectionné dans son périmètre. */
export type Session = {
  role: Role;
  user: Person;
  /** Site sélectionné (cookie), sinon site de rattachement, sinon premier site du périmètre ; ALL_SITES = « Tous les sites ». */
  site: SiteOption;
  /** Sites actifs du périmètre, puis « Tous les sites » (périmètre complet seulement). */
  siteOptions: SiteOption[];
  /**
   * Périmètre : sites autorisés (site de rattachement actuel + sites accordés à la connexion par les groupes Entra),
   * ou null = tous les sites (Direction, Animateur QHSE, démonstration).
   */
  allowedSiteIds: string[] | null;
  /** Aucun site actif : base à amorcer (écran « Créer le premier site », src/components/Bootstrap.tsx). */
  bootstrap: boolean;
  /** Mode démonstration (VIGIE_DEMO=1) : sélecteur de rôle, aperçu mobile. */
  demo: boolean;
};

type Resolved = { session: Session; denied?: never } | { session: null; denied: string };

// Identité : fournisseur de démonstration ou Entra ID (src/lib/auth). Jamais de rôle par défaut hors démonstration.
const resolveSession = cache(async (): Promise<Resolved> => {
  const auth = await getAuthState();
  if (auth.status !== 'authenticated') return { session: null, denied: authFailureHref(auth) };
  const { role, personId, siteIds } = auth.identity;
  const db = await getDb();
  const [[user], sites] = await Promise.all([
    db.select(PERSON_COLUMNS).from(t.people).where(eq(t.people.id, personId)),
    db.select({ id: t.sites.id, label: t.sites.label, archivedAt: t.sites.archivedAt }).from(t.sites).orderBy(asc(t.sites.sort)),
  ]);
  if (!user) return { session: null, denied: accessHref('non-autorise') };
  const demo = isDemo();
  // Fiche sortie de l'effectif en cours de session : la session tombe (la connexion la refuse aussi).
  if (!demo && hasLeft(user, today())) return { session: null, denied: accessHref('non-autorise') };
  // Le site de rattachement fait toujours partie du périmètre, tel qu'il est dans la fiche (pas seulement à la connexion).
  const allowedSiteIds = siteIds ? [...new Set([...siteIds, ...(user.siteId ? [user.siteId] : [])])] : null;
  // Sites archivés : absents du sélecteur ; un cookie qui les vise retombe sur le site par défaut.
  const active = sites.filter((s) => !s.archivedAt);
  const allowed = allowedSiteIds ? active.filter((s) => allowedSiteIds.includes(s.id)) : active;
  if (active.length && !allowed.length) return { session: null, denied: accessHref('non-autorise') };
  // « Tous les sites » consolide toutes les données : périmètre complet seulement (ou base encore sans site).
  const siteOptions: SiteOption[] = [
    ...allowed.map((s) => ({ id: s.id, label: s.label })),
    ...(!allowedSiteIds || !allowed.length ? [{ id: ALL_SITES, label: 'Tous les sites' }] : []),
  ];
  const wanted = (await cookies()).get(SITE_COOKIE)?.value;
  const site = siteOptions.find((s) => s.id === wanted) ?? siteOptions.find((s) => s.id === user.siteId) ?? siteOptions[0];
  return { session: { role, user, site, siteOptions, allowedSiteIds, bootstrap: !active.length, demo } };
});

/**
 * Session de la requête. Sans identité valide, redirige (connexion, configuration incomplète, accès refusé) :
 * pages, server actions et routes peuvent compter sur une session.
 */
export const getSession = cache(async (): Promise<Session> => {
  const r = await resolveSession();
  if (!r.session) redirect(r.denied);
  return r.session;
});

/** Session de la requête, ou null sans identité valide (formulaire public, routes qui répondent 401/404). */
export const getOptionalSession = cache(async (): Promise<Session | null> => (await resolveSession()).session);

/**
 * Identifiant de la personne connectée (people.id), sans accès à la base : appelable dans une transaction.
 * (Dans une server action, `cache()` ne mémorise pas : relire la session y attendrait la fin de la transaction.)
 */
export async function currentPersonId(): Promise<string> {
  const auth = await getAuthState();
  if (auth.status !== 'authenticated') redirect(authFailureHref(auth));
  return auth.identity.personId;
}

/** Périmètre de la personne connectée : sites autorisés, ou null pour tous les sites (archivés compris). */
export async function allowedSiteIds(): Promise<string[] | null> {
  return (await getSession()).allowedSiteIds;
}

/** Vrai si le site (ou un élément sans site) est dans le périmètre `allowed` (null = tous les sites). */
export const inPerimeter = (allowed: string[] | null, siteId: string | null | undefined) => !allowed || !siteId || allowed.includes(siteId);

/** Sites actifs du périmètre, dans l'ordre d'affichage : seuls admis pour un nouvel enregistrement. */
export async function activeSiteIds(): Promise<string[]> {
  const { siteOptions } = await getSession();
  return siteOptions.filter((s) => s.id !== ALL_SITES).map((s) => s.id);
}

/** Site sélectionné, ou null pour « Tous les sites ». */
export async function currentSiteId(): Promise<string | null> {
  const { site } = await getSession();
  return site.id === ALL_SITES ? null : site.id;
}

/** Vrai si l'élément appartient au site sélectionné (les éléments sans site valent pour tous les sites). */
export const inSite = (siteId: string | null, itemSite: string | null | undefined) => !siteId || !itemSite || itemSite === siteId;

/** Portée d'un chargement : site sélectionné (écrans), ou tout le périmètre de la personne (échéances, TDB-05). */
export type SiteScope = 'site' | 'perimeter';

/**
 * Sites d'un chargement filtré en base (QUA-17) : null = aucun filtre (« Tous les sites », ou périmètre complet) ; sinon
 * les sites admis par siteFilter(scope) — l'élément sans site passe toujours (condition SQL : site vide ou dans la liste,
 * siteWhere de src/lib/queries.ts).
 */
export async function siteScopeIds(scope: SiteScope = 'site'): Promise<string[] | null> {
  if (scope === 'perimeter') return allowedSiteIds();
  const site = await currentSiteId();
  return site ? [site] : null;
}

/**
 * Filtre de site d'un chargement : 'site' = site sélectionné (inSite ; « Tous les sites » = tout) ; 'perimeter' = tous les
 * sites de la personne (inPerimeter(allowedSiteIds, id), archivés compris). Les éléments sans site passent toujours.
 */
export async function siteFilter(scope: SiteScope = 'site'): Promise<(siteId: string | null | undefined) => boolean> {
  if (scope === 'perimeter') {
    const allowed = await allowedSiteIds();
    return (siteId) => inPerimeter(allowed, siteId);
  }
  const site = await currentSiteId();
  return (siteId) => inSite(site, siteId);
}
