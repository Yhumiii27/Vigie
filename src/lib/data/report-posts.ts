import 'server-only';
import { cache } from 'react';
import { and, asc, eq, gt, gte, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { today } from '@/lib/today';
import { config } from '../config';
import { canManage, type TodoItem } from '../domain';
import { REPORT_LIMITS, REPORT_LIMIT_RETENTION_MS, postTotalValue, reportLimitKey } from '../report-guard';
import { readReportToken, reportTokenMatches, reportTokenPath, signReportToken } from '../report-token';
import { currentSiteId, getSession, inSite } from '../session';
import { loadQhseLeads } from './leads';

// ─── Postes de signalement : QR codes des zones du plan de site (EVT-07) ────

const shortLabel = (label: string) => label.split(' — ')[0];

/**
 * Postes de signalement : zones du plan de site des sites sélectionnés (sites actifs), chacune avec le chemin encodé dans
 * son QR code. Avec VIGIE_REPORT_SECRET (toujours en démonstration), le chemin porte le jeton signé du poste et ouvre le
 * formulaire sans compte ; sans secret (`signed: false`), l'ancien chemin ?poste=&site= qui exige une session.
 */
export async function loadReportPosts(siteFilter?: string | null) {
  const db = await getDb();
  const site = siteFilter ?? (await currentSiteId());
  const secret = config().reportSecret;
  const [zones, sites] = await Promise.all([
    db.select({ id: t.mapZones.id, name: t.mapZones.name, siteId: t.mapZones.siteId, qrVersion: t.mapZones.qrVersion })
      .from(t.mapZones).orderBy(asc(t.mapZones.siteId), asc(t.mapZones.name)),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
  ]);
  const active = new Map(sites.filter((s) => !s.archivedAt).map((s) => [s.id, shortLabel(s.label)]));
  return zones
    .filter((z) => active.has(z.siteId) && inSite(site, z.siteId))
    .map((z) => ({
      zoneId: z.id, name: z.name, siteId: z.siteId, siteLabel: active.get(z.siteId)!, version: z.qrVersion, signed: !!secret,
      path: secret
        ? reportTokenPath(signReportToken(secret, { siteId: z.siteId, zoneId: z.id, version: z.qrVersion }))
        : `/signaler?poste=${z.id}&site=${encodeURIComponent(z.siteId)}`,
    }));
}
export type ReportPost = Awaited<ReturnType<typeof loadReportPosts>>[number];

/** Poste ouvert par un QR code : lieu et site pré-remplis du formulaire. */
export type ReportPostTarget = { zoneId: number; name: string; siteId: string; siteLabel: string };

/** Jeton de poste : valide (poste), « revoked » (QR code régénéré depuis l'impression) ou « invalid » (inconnu, falsifié, site archivé). */
export type ReportTokenCheck = { status: 'ok'; post: ReportPostTarget } | { status: 'revoked' | 'invalid' };

/** Vérifie le jeton d'un QR code de poste : signature (VIGIE_REPORT_SECRET), zone existante, site actif, version courante. */
export async function resolveReportToken(token: string | null | undefined): Promise<ReportTokenCheck> {
  const secret = config().reportSecret;
  const parsed = readReportToken(token);
  if (!secret || !parsed || !token) return { status: 'invalid' };
  const db = await getDb();
  const [row] = await db.select({ id: t.mapZones.id, name: t.mapZones.name, siteId: t.mapZones.siteId, qrVersion: t.mapZones.qrVersion, siteLabel: t.sites.label, archivedAt: t.sites.archivedAt })
    .from(t.mapZones).innerJoin(t.sites, eq(t.mapZones.siteId, t.sites.id)).where(eq(t.mapZones.id, parsed.zoneId));
  if (!row || row.archivedAt) return { status: 'invalid' };
  // Signature vérifiée avec la version annoncée : un QR code authentique mais d'une version antérieure est « remplacé ».
  if (!reportTokenMatches(secret, token, { siteId: row.siteId, zoneId: row.id, version: parsed.version })) return { status: 'invalid' };
  if (parsed.version !== row.qrVersion) return { status: 'revoked' };
  return { status: 'ok', post: { zoneId: row.id, name: row.name, siteId: row.siteId, siteLabel: shortLabel(row.siteLabel) } };
}

/** Ancien QR code (?poste=&site=, sans jeton) : la zone doit appartenir au site indiqué (site actif). Personnes connectées seulement. */
export async function resolveReportPost(poste: string | undefined, site: string | undefined): Promise<ReportPostTarget | null> {
  const id = Number(poste);
  if (!Number.isInteger(id) || !site) return null;
  const db = await getDb();
  const [row] = await db.select({ id: t.mapZones.id, name: t.mapZones.name, siteId: t.mapZones.siteId, siteLabel: t.sites.label, archivedAt: t.sites.archivedAt })
    .from(t.mapZones).innerJoin(t.sites, eq(t.mapZones.siteId, t.sites.id)).where(eq(t.mapZones.id, id));
  if (!row || row.siteId !== site || row.archivedAt) return null;
  return { zoneId: row.id, name: row.name, siteId: row.siteId, siteLabel: shortLabel(row.siteLabel) };
}

/**
 * Alerte « plafond de signalements sans compte atteint » (EVT-07) : poste dont le QR code actuel a reçu
 * REPORT_LIMITS.postTotal.max signalements dans une fenêtre des dernières 24 h (compteurs de report_rate_limits) — les
 * suivants sont refusés, l'étiquette circule peut-être hors du site. Adressée au responsable QHSE du site ; disparaît avec
 * « Régénérer le QR » (nouvelle version, nouveau compteur) ou après 24 h.
 */
export const loadReportPostSignals = cache(async (): Promise<{ todo: TodoItem[] }> => {
  const secret = config().reportSecret;
  const { role } = await getSession();
  if (!secret || !canManage(role)) return { todo: [] };
  const db = await getDb();
  const [zones, selected] = await Promise.all([
    db.select({ id: t.mapZones.id, name: t.mapZones.name, siteId: t.mapZones.siteId, qrVersion: t.mapZones.qrVersion, siteLabel: t.sites.label })
      .from(t.mapZones).innerJoin(t.sites, eq(t.mapZones.siteId, t.sites.id)).where(isNull(t.sites.archivedAt)),
    currentSiteId(),
  ]);
  const byKey = new Map(zones.filter((z) => inSite(selected, z.siteId))
    .map((z) => [reportLimitKey('postTotal', postTotalValue(z.id, z.qrVersion), secret), z]));
  if (!byKey.size) return { todo: [] };
  const full = await db.selectDistinct({ key: t.reportRateLimits.key }).from(t.reportRateLimits).where(and(
    inArray(t.reportRateLimits.key, [...byKey.keys()]),
    gte(t.reportRateLimits.hits, REPORT_LIMITS.postTotal.max),
    gt(t.reportRateLimits.windowStart, new Date(Date.now() - REPORT_LIMIT_RETENTION_MS)),
  ));
  if (!full.length) return { todo: [] };
  const leads = await loadQhseLeads();
  const now = today();
  return {
    todo: full.map(({ key }) => byKey.get(key)!).map((z) => {
      const to = leads.forSite(z.siteId);
      return {
        date: now, kind: 'QR code de poste', tone: 'danger', overdue: true, key: `report-ceiling|${z.id}|${z.qrVersion}`,
        title: `${z.name} (${shortLabel(z.siteLabel)}) — plafond de signalements sans compte atteint : régénérer le QR code s'il circule hors du site`,
        href: `/signaler/postes?site=${encodeURIComponent(z.siteId)}`, who: to.who, ownerIds: to.ownerIds,
      } satisfies TodoItem;
    }),
  };
});
