import { and, count, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import * as t from '../schema';
import type { SeedTx } from './types';
import { rel } from './dates';

// Jeu de démonstration du paquet 7 (terrain et mobile, migration 0012) : événements rattachés à leur zone de la carte
// (EVT-19 : lieu commençant par le nom d'une zone du même site) et une zone archivée avec son motif (aire de charge des
// batteries démontée : son QR code de poste ouvre le formulaire terrain avec « ce poste n'existe plus, choisissez le lieu »).

/** Lieux du jeu qui ne commencent pas par le nom de leur zone. */
const ALIASES: Record<string, string> = { "Zone d'essais": "Hall d'essais" };

/** Zone archivée du jeu (site A, hors du dessin des bâtiments) : coordonnées normalisées comme celles de seeds/sitemap.ts. */
const W = 1600;
const ARCHIVED_ZONE = {
  siteId: 'ville-a', name: 'Ancienne aire de charge des batteries', kind: 'autre',
  polygon: [[80, 560], [240, 560], [240, 760], [80, 760]].map(([x, y]) => [Math.round((x / W) * 1e5) / 1e5, Math.round((y / W) * 1e5) / 1e5]),
  notes: 'Charge des chariots électriques (bornes au sol).',
  archivedAt: new Date(`${rel(-9)}T10:00:00+02:00`),
  archivedById: 'clefevre',
  archiveReason: 'Charge des chariots déplacée au magasin (bornes murales) : aire démontée, étiquette du poste retirée.',
};

/**
 * Remplit (une seule fois) les données du paquet 7 : jeu neuf (dans sa transaction, après la carte et les événements) ou
 * base de démonstration antérieure à la migration 0012 (upgradeDemo). Marqueur : aucune zone archivée, et événement
 * EV-2026-119 du jeu présent.
 */
export async function seedFieldMobile(tx: SeedTx) {
  const [archived] = await tx.select({ n: count() }).from(t.mapZones).where(isNotNull(t.mapZones.archivedAt));
  const [marker] = await tx.select({ n: count() }).from(t.events).where(eq(t.events.id, 'EV-2026-119'));
  if (archived.n > 0 || marker.n === 0) return;

  // EVT-19 : zone de chaque événement d'après son lieu (« Atelier montage · poste M3 » → zone « Atelier montage »).
  const zones = await tx.select({ id: t.mapZones.id, siteId: t.mapZones.siteId, name: t.mapZones.name }).from(t.mapZones);
  const events = await tx.select({ id: t.events.id, siteId: t.events.siteId, location: t.events.location }).from(t.events)
    .where(and(isNull(t.events.zoneId), ne(t.events.type, 'MP')));
  for (const e of events) {
    const head = e.location.split(' · ')[0];
    const name = ALIASES[head] ?? head;
    const zone = zones.find((z) => z.siteId === e.siteId && z.name === name);
    if (zone) await tx.update(t.events).set({ zoneId: zone.id }).where(eq(t.events.id, e.id));
  }

  const [row] = await tx.insert(t.mapZones).values(ARCHIVED_ZONE).returning({ id: t.mapZones.id });
  await tx.insert(t.changeLog).values([
    {
      entityType: 'site_map', entityId: ARCHIVED_ZONE.siteId, action: 'create', byId: 'clefevre', at: new Date(`${rel(-339)}T09:00:00+01:00`),
      summary: `Zone « ${ARCHIVED_ZONE.name} » ajoutée à la carte`,
    },
    {
      entityType: 'site_map', entityId: ARCHIVED_ZONE.siteId, action: 'archive', byId: ARCHIVED_ZONE.archivedById, at: ARCHIVED_ZONE.archivedAt,
      reason: ARCHIVED_ZONE.archiveReason,
      summary: `Zone « ${ARCHIVED_ZONE.name} » archivée ; son QR code de poste (étiquette n° 1) ne pré-remplit plus le lieu`,
    },
  ]);
  return row.id;
}
