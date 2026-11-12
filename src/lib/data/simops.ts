import 'server-only';
import { isNull } from 'drizzle-orm';
import { schema as t } from '@/db';
import { activeOn } from '../rules/coactivity';
import { LOCKOUT_STATUSES, isLockoutStatus } from '../rules/lockouts';
import { PERMIT_TYPES, toParisLocal, type PermitType } from '../rules/prevention';
import { activitySlot, fmtHourRanges, fmtSlot, overlapHours, permitSlot, simultaneous, type Slot } from '../rules/simops';
import type { Tone } from '../domain';
import { loadRows } from './prevention-rows';
import { shortSiteLabel } from './todo';

// Opérations simultanées (SIMOPS, PRV-22) : vue en lecture « ?vue=simops&jour= » de l'écran Prévention. Pour le jour demandé,
// sur le site sélectionné (périmètre sous « Tous les sites ») : permis valables ce jour-là (demandés, délivrés ou clos ; les
// annulés exclus) avec leurs consignations, et activités de la carte actives, par zone de la carte (zone de l'activité ;
// permis : zone de ses activités rattachées, sinon « sans zone »), puis heures où au moins deux opérations se recouvrent.
// Lecteurs de l'écran Prévention ; aucune écriture.

export type SimopsOp = {
  key: string; kind: 'permit' | 'activity'; ref: string; label: string; detail: string | null; slot: Slot; slotLabel: string;
  stateLabel: string | null; href: string;
  lockouts: { id: string; label: string; statusLabel: string; tone: Tone }[];
  /** Références des autres opérations de la zone dont le créneau recoupe celui-ci. */
  with: string[];
};
export type SimopsZone = { key: string; zoneId: number | null; label: string; ops: SimopsOp[]; overlaps: string | null };

export async function loadSimops(day: string) {
  const rows = await loadRows('site');
  const { db, permits, contractors, sites, selectedSite } = rows;
  const keep = new Set(selectedSite ? [selectedSite] : sites.map((s) => s.id));
  const [zones, activities] = await Promise.all([
    db.select({ id: t.mapZones.id, siteId: t.mapZones.siteId, name: t.mapZones.name }).from(t.mapZones),
    db.select().from(t.siteActivities).where(isNull(t.siteActivities.cancelledAt)),
  ]);
  const shown = new Set(permits.map((p) => p.siteId));
  const acts = activities.filter((a) => (keep.has(a.siteId) || shown.has(a.siteId)) && activeOn(a, day));
  const contractorName = (id: string | null) => (id ? contractors.find((c) => c.id === id)?.name ?? id : 'Intervention interne');
  const siteLabel = new Map(sites.map((s) => [s.id, shortSiteLabel(s.label)]));
  const zoneOf = new Map(zones.map((z) => [z.id, z]));

  const ops: (SimopsOp & { zoneId: number | null; siteId: string })[] = [];
  const permitIds = new Set<string>();
  for (const p of permits) {
    if (p.status === 'annule') continue;
    const slot = permitSlot(toParisLocal(p.validFrom), toParisLocal(p.validTo), day);
    if (!slot) continue;
    permitIds.add(p.id);
    const linked = acts.filter((a) => a.permitId === p.id);
    const zoneId = linked.find((a) => a.zoneId != null)?.zoneId ?? null;
    const type: PermitType = p.type === 'essai' ? 'essai' : 'feu';
    ops.push({
      key: `permit:${p.id}`, kind: 'permit', ref: p.id, label: `${PERMIT_TYPES[type].label} · ${p.description}`,
      detail: [contractorName(p.contractorId), p.location, ...linked.map((a) => a.title)].filter(Boolean).join(' · '),
      slot, slotLabel: fmtSlot(slot), stateLabel: p.status === 'demande' ? 'Demandé' : p.status === 'clos' ? 'Clos' : 'Délivré',
      href: `/prevention?onglet=permis&permis=${encodeURIComponent(p.id)}`,
      lockouts: rows.lockoutsOf(p.id).filter((l) => l.status !== 'annulee').map((l) => ({
        id: l.id, label: l.equipment, statusLabel: isLockoutStatus(l.status) ? LOCKOUT_STATUSES[l.status].label : l.status,
        tone: isLockoutStatus(l.status) ? LOCKOUT_STATUSES[l.status].tone : 'neutral',
      })),
      with: [], zoneId, siteId: p.siteId,
    });
  }
  for (const a of acts) {
    if (a.permitId && permitIds.has(a.permitId)) continue; // reprise par l'opération du permis
    if (!keep.has(a.siteId)) continue;
    const slot = activitySlot(a.hours);
    ops.push({
      key: `activity:${a.id}`, kind: 'activity', ref: `Activité ${a.id}`, label: a.title,
      detail: [a.team === 'externe' ? contractorName(a.contractorId) : 'Équipe interne', a.vehicles ? 'véhicules ou engins' : null].filter(Boolean).join(' · '),
      slot, slotLabel: a.hours ? `${fmtSlot(slot)}${slot.from === 0 && slot.to === 1440 ? ` (${a.hours})` : ''}` : fmtSlot(slot), stateLabel: null,
      href: `/prevention/carte?date=${day}`, lockouts: [], with: [], zoneId: a.zoneId, siteId: a.siteId,
    });
  }
  const pairs = simultaneous(ops.map((o) => ({ key: o.key, zoneId: o.zoneId, slot: o.slot })));
  const refOf = new Map(ops.map((o) => [o.key, o.ref]));
  ops.forEach((o) => { o.with = (pairs.get(o.key) ?? []).map((k) => refOf.get(k) ?? k); });

  const several = !selectedSite;
  type Op = (typeof ops)[number];
  const groups = new Map<string, Omit<SimopsZone, 'ops'> & { ops: Op[] }>();
  for (const o of ops.sort((x, y) => x.slot.from - y.slot.from || x.ref.localeCompare(y.ref, 'fr', { numeric: true }))) {
    const zone = o.zoneId != null ? zoneOf.get(o.zoneId) : undefined;
    const key = zone ? `zone:${zone.id}` : `site:${o.siteId}`;
    const label = zone ? `${zone.name}${several ? ` · ${siteLabel.get(zone.siteId) ?? zone.siteId}` : ''}` : `Sans zone de la carte${several ? ` · ${siteLabel.get(o.siteId) ?? o.siteId}` : ''}`;
    const g = groups.get(key) ?? { key, zoneId: zone?.id ?? null, label, ops: [], overlaps: null };
    g.ops.push(o);
    groups.set(key, g);
  }
  const list: SimopsZone[] = [...groups.values()].map((g) => {
    const ranges = g.zoneId == null ? [] : overlapHours(g.ops.map((o) => o.slot));
    return { ...g, ops: g.ops.map((o): SimopsOp => ({ key: o.key, kind: o.kind, ref: o.ref, label: o.label, detail: o.detail, slot: o.slot, slotLabel: o.slotLabel, stateLabel: o.stateLabel, href: o.href, lockouts: o.lockouts, with: o.with })), overlaps: ranges.length ? fmtHourRanges(ranges) : null };
  }).sort((a, b) => Number(!!b.overlaps) - Number(!!a.overlaps) || Number(a.zoneId == null) - Number(b.zoneId == null) || a.label.localeCompare(b.label, 'fr'));
  return { day, zones: list, simultaneousZones: list.filter((z) => z.overlaps).length, operations: ops.length };
}
export type SimopsData = Awaited<ReturnType<typeof loadSimops>>;
