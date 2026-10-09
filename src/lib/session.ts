import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { asc } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { DEFAULT_ROLE, ROLES, ROLE_KEYS, type Role } from './domain';

export const ROLE_COOKIE = 'vigie_role';
export const SITE_COOKIE = 'vigie_site';
export const ALL_SITES = 'all';

// Authentification Microsoft Entra ID à brancher : en attendant, le rôle de
// démonstration est choisi dans le menu utilisateur et conservé en cookie.
export const getSession = cache(async () => {
  const jar = await cookies();
  const raw = jar.get(ROLE_COOKIE)?.value;
  const role: Role = raw && (ROLE_KEYS as string[]).includes(raw) ? (raw as Role) : DEFAULT_ROLE;
  const db = await getDb();
  const [people, sites] = await Promise.all([
    db.select().from(t.people),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
  ]);
  const user = people.find((p) => p.id === ROLES[role].personId)!;
  const siteId = jar.get(SITE_COOKIE)?.value ?? sites[0]?.id ?? ALL_SITES;
  const siteOptions = [...sites.map((s) => ({ id: s.id, label: s.label })), { id: ALL_SITES, label: 'Tous les sites' }];
  const site = siteOptions.find((s) => s.id === siteId) ?? siteOptions[0];
  return { role, user, site, siteOptions };
});

/** Site sélectionné, ou null pour « Tous les sites ». */
export async function currentSiteId(): Promise<string | null> {
  const { site } = await getSession();
  return site.id === ALL_SITES ? null : site.id;
}

/** Vrai si l'élément appartient au site sélectionné (les éléments sans site valent pour tous les sites). */
export const inSite = (siteId: string | null, itemSite: string | null | undefined) => !siteId || !itemSite || itemSite === siteId;

