import 'server-only';
import { cache } from 'react';
import { asc, sql } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadPeople } from '../queries';

/** Site tel que la fenêtre « Gérer les sites » l'affiche (actifs et archivés). */
export type SiteAdminRow = {
  id: string; label: string; sort: number; seveso: string | null;
  /** Date d'archivage (AAAA-MM-JJ), null pour un site actif. */
  archivedOn: string | null;
  /** Nom de la personne qui a archivé le site. */
  archivedBy: string | null;
  archiveReason: string | null;
};

/** Tous les sites, actifs d'abord puis archivés, dans l'ordre d'affichage (administration des sites, animateur QHSE et direction). */
export const loadSiteAdmin = cache(async (): Promise<SiteAdminRow[]> => {
  const db = await getDb();
  const [sites, people] = await Promise.all([db.select().from(t.sites).orderBy(sql`${t.sites.archivedAt} asc nulls first`, asc(t.sites.sort)), loadPeople()]);
  return sites.map((s) => ({
    id: s.id, label: s.label, sort: s.sort, seveso: s.seveso,
    archivedOn: s.archivedAt ? s.archivedAt.toISOString().slice(0, 10) : null,
    archivedBy: s.archivedById ? people.get(s.archivedById)?.name ?? s.archivedById : null,
    archiveReason: s.archiveReason,
  }));
});
