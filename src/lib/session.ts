import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { asc } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { ALL_SITES, DEFAULT_ROLE, ROLES, ROLE_KEYS, type Role } from './domain';

export const ROLE_COOKIE = 'vigie_role';
export const SITE_COOKIE = 'vigie_site';
export { ALL_SITES };

// Authentification Microsoft Entra ID à brancher : en attendant, le rôle de
// démonstration est choisi dans le menu utilisateur et conservé en cookie.
/** Rôle de démonstration, lu dans le cookie seul (sans accès à la base). */
const getRole = cache(async (): Promise<Role> => {
  const raw = (await cookies()).get(ROLE_COOKIE)?.value;
  return raw && (ROLE_KEYS as string[]).includes(raw) ? (raw as Role) : DEFAULT_ROLE;
});

export const getSession = cache(async () => {
  const jar = await cookies();
  const role = await getRole();
  const db = await getDb();
  const [people, sites] = await Promise.all([
    db.select().from(t.people),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
  ]);
  const user = people.find((p) => p.id === ROLES[role].personId)!;
  // Sites archivés : absents du sélecteur ; un cookie qui les vise retombe sur le premier site actif.
  const active = sites.filter((s) => !s.archivedAt);
  const siteId = jar.get(SITE_COOKIE)?.value ?? active[0]?.id ?? ALL_SITES;
  const siteOptions = [...active.map((s) => ({ id: s.id, label: s.label })), { id: ALL_SITES, label: 'Tous les sites' }];
  const site = siteOptions.find((s) => s.id === siteId) ?? siteOptions[0];
  return { role, user, site, siteOptions };
});

/**
 * Identifiant de la personne connectée (people.id), sans accès à la base : appelable dans une transaction.
 * (Dans une server action, `cache()` ne mémorise pas : relire la session y attendrait la fin de la transaction.)
 */
export async function currentPersonId(): Promise<string> {
  return ROLES[await getRole()].personId;
}

/** Sites actifs (non archivés), dans l'ordre d'affichage : seuls admis pour un nouvel enregistrement. */
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

