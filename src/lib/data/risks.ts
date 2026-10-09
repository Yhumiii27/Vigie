import 'server-only';
import { asc } from 'drizzle-orm';
import { getDb, schema as t, type Db } from '@/db';
import { addMonths, daysBetween, today, yearOf } from '../dates';
import { RISK_LEVELS, riskLevel, type Tone } from '../domain';
import { actionColumn, lcfirst, loadPeople } from '../queries';
import { currentSiteId, inSite } from '../session';

// ─── Évaluation des risques (DUERP) ─────────────────────────────────────────

/** Durée de conservation des versions successives du DUERP (Code du travail, R. 4121-4). */
export const DUERP_RETENTION = '40 ans';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Risque tel qu'exporté en CSV et figé dans l'instantané d'une version archivée. */
export type RiskRecord = {
  unitId: string;
  unit: string;
  siteId: string | null;
  site: string;
  hazard: string;
  situation: string;
  gravity: number;
  probability: number;
  existingMeasures: string;
  residualGravity: number;
  residualProbability: number;
  actions: string[];
};

/**
 * Contenu de la colonne `duerp_versions.snapshot` : unités et risques figés à l'archivage
 * (null pour la version en vigueur et pour les versions archivées hors Vigie).
 * Le commentaire de version est porté par la colonne `duerp_versions.comment` ; `comment` n'est lu ici
 * qu'en repli, pour les données antérieures à cette colonne (voir `versionComment`).
 */
export type DuerpSnapshot = {
  comment?: string | null;
  takenOn?: string;
  takenBy?: string | null;
  units?: { id: string; label: string; siteId: string | null; site: string }[];
  risks?: RiskRecord[];
};

export type LinkedAction = { id: string; title: string; status: string; late: boolean; done: boolean };

export type RiskView = {
  id: number;
  unitId: string;
  hazard: string;
  situation: string;
  gravity: number;
  probability: number;
  existingMeasures: string;
  residualGravity: number;
  residualProbability: number;
  actions: LinkedAction[];
};

export type WorkUnitView = {
  id: string;
  label: string;
  siteId: string | null;
  site: string;
  /** Référence d'origine des actions créées depuis l'unité (« DUERP · atelier montage »). */
  originRef: string;
  count: number;
  /** Niveau de cotation brute le plus élevé de l'unité (index RISK_LEVELS). */
  top: number;
};

export type DuerpVersionView = {
  version: string;
  current: boolean;
  updatedOn: string;
  nextUpdateOn: string;
  retention: string;
  validatedById: string | null;
  validatedBy: string;
  cseConsultedOn: string | null;
  archivedOn: string | null;
  comment: string | null;
  /** Instantané des risques disponible dans Vigie (faux pour les versions archivées hors Vigie). */
  hasSnapshot: boolean;
  riskCount: number | null;
};

const STATUS_LABEL: Record<string, string> = { todo: 'À lancer', doing: 'En cours', verify: 'Efficacité à vérifier', done: 'Clôturée' };

/** Lecture défensive du JSON stocké dans duerp_versions.snapshot. */
export function parseSnapshot(raw: unknown): DuerpSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const s = raw as Record<string, unknown>;
  return {
    comment: typeof s.comment === 'string' ? s.comment : null,
    takenOn: typeof s.takenOn === 'string' ? s.takenOn : undefined,
    takenBy: typeof s.takenBy === 'string' ? s.takenBy : null,
    units: Array.isArray(s.units) ? (s.units as DuerpSnapshot['units']) : undefined,
    risks: Array.isArray(s.risks) ? (s.risks as RiskRecord[]) : undefined,
  };
}

/** Commentaire (objet de la mise à jour) d'une version : colonne dédiée, sinon ancien emplacement dans l'instantané. */
export function versionComment(row: { comment: string | null; snapshot: unknown }): string | null {
  return row.comment ?? parseSnapshot(row.snapshot).comment ?? null;
}

/** « 2026.2 » → [2026, 2] ; null si le format n'est pas AAAA.n canonique (pas de « 2026.02 » ni de « 2027.0 »). */
export function parseVersion(v: string): [number, number] | null {
  const m = /^(\d{4})\.([1-9]\d*)$/.exec(v);
  return m ? [+m[1], +m[2]] : null;
}

/** Contrôle d'un nouveau numéro de version face aux versions existantes ; message d'erreur ou null. */
export function versionConflict(existing: string[], version: string) {
  const parsed = parseVersion(version);
  if (!parsed) return 'Format attendu : AAAA.n (ex. 2026.2).';
  if (existing.includes(version)) return 'Ce numéro de version existe déjà.';
  const latest = existing.map(parseVersion).filter((p): p is [number, number] => !!p)
    .sort((a, b) => b[0] - a[0] || b[1] - a[1])[0];
  if (latest && (parsed[0] < latest[0] || (parsed[0] === latest[0] && parsed[1] <= latest[1]))) {
    return `Doit suivre la dernière version (${latest.join('.')}).`;
  }
  return null;
}

/** Tri décroissant des numéros de version (2026.2 avant 2026.1 avant 2025.1). */
export function compareVersionsDesc(a: string, b: string) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (pa && pb) return pb[0] - pa[0] || pb[1] - pa[1];
  return b.localeCompare(a, 'fr', { numeric: true });
}

/** Numéro proposé pour la prochaine version : même année → AAAA.(n+1), nouvelle année → AAAA.1. */
export function suggestNextVersion(existing: string[], now = today()) {
  const year = yearOf(now);
  const n = Math.max(0, ...existing.map(parseVersion).filter((p): p is [number, number] => !!p && p[0] === year).map((p) => p[1]));
  return `${year}.${n + 1}`;
}

/** Libellé court du niveau de cotation (« Faible », « Modéré », « Élevé », « Critique »). */
export const levelName = (n: number) => RISK_LEVELS[riskLevel(n)].label.replace(/\s.*$/, '');

export async function loadRisks() {
  const db = await getDb();
  const [people, versions, allUnits, allRisks, links, actions, sites, site] = await Promise.all([
    loadPeople(),
    db.select().from(t.duerpVersions),
    db.select().from(t.workUnits).orderBy(asc(t.workUnits.sort), asc(t.workUnits.label)),
    db.select().from(t.risks).orderBy(asc(t.risks.sort), asc(t.risks.id)),
    db.select().from(t.riskActions),
    db.select().from(t.actions),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
    currentSiteId(),
  ]);
  const now = today();
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));
  const actionById = new Map(actions.map((a) => [a.id, a]));

  const linked = (riskId: number): LinkedAction[] => links
    .filter((l) => l.riskId === riskId)
    .map((l) => actionById.get(l.actionId))
    .filter((a) => !!a)
    .sort((a, b) => a.id.localeCompare(b.id, 'fr', { numeric: true }))
    .map((a) => {
      const col = actionColumn(a, now);
      return { id: a.id, title: a.title, status: col === 'late' ? 'En retard' : STATUS_LABEL[a.status] ?? a.status, late: col === 'late', done: a.status === 'done' };
    });

  const units = allUnits.filter((u) => inSite(site, u.siteId));
  const unitIds = new Set(units.map((u) => u.id));
  const risks: RiskView[] = allRisks.filter((r) => unitIds.has(r.unitId)).map((r) => ({
    id: r.id, unitId: r.unitId, hazard: r.hazard, situation: r.situation,
    gravity: r.gravity, probability: r.probability, existingMeasures: r.existingMeasures,
    residualGravity: r.residualGravity, residualProbability: r.residualProbability,
    actions: linked(r.id),
  }));
  const unitViews: WorkUnitView[] = units.map((u) => {
    const ur = risks.filter((r) => r.unitId === u.id);
    return {
      id: u.id, label: u.label, siteId: u.siteId, site: u.siteId ? siteLabel.get(u.siteId) ?? u.siteId : 'Tous les sites',
      originRef: `DUERP · ${lcfirst(u.label)}`,
      count: ur.length,
      top: Math.max(0, ...ur.map((r) => riskLevel(r.gravity * r.probability))),
    };
  });

  const versionViews: DuerpVersionView[] = versions
    .map((v) => {
      const snap = parseSnapshot(v.snapshot);
      return {
        version: v.version, current: v.current, updatedOn: v.updatedOn, nextUpdateOn: v.nextUpdateOn, retention: v.retention,
        validatedById: v.validatedById, validatedBy: v.validatedById ? people.get(v.validatedById)?.name ?? '' : '',
        cseConsultedOn: v.cseConsultedOn, archivedOn: v.archivedOn, comment: v.comment ?? snap.comment ?? null,
        hasSnapshot: !v.current && !!snap.risks, riskCount: snap.risks ? snap.risks.length : null,
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || compareVersionsDesc(a.version, b.version));

  const current = versionViews.find((v) => v.current) ?? null;
  const archived = versionViews.filter((v) => !v.current);
  const since = archived.length ? Math.min(...archived.map((v) => yearOf(v.updatedOn))) : null;
  // Couleur d'alerte dès 30 jours avant l'échéance, et tant que la mise à jour annuelle est en retard.
  const daysToUpdate = current ? daysBetween(now, current.nextUpdateOn) : null;
  const updateTone: Tone | null = daysToUpdate == null ? null : daysToUpdate <= 30 ? 'warn' : null;

  return {
    version: current && {
      ...current,
      retentionLabel: since
        ? `${current.retention} · ${archived.length} ${archived.length > 1 ? 'versions archivées' : 'version archivée'} depuis ${since}`
        : current.retention,
      daysToUpdate,
      updateTone,
    },
    versions: versionViews,
    nextVersion: suggestNextVersion(versions.map((v) => v.version), now),
    nextUpdateOn: addMonths(now, 12),
    totals: { units: allUnits.length, risks: allRisks.length },
    units: unitViews,
    risks,
  };
}
export type RisksData = Awaited<ReturnType<typeof loadRisks>>;

// ─── Exports et instantanés ─────────────────────────────────────────────────

async function riskRecords(db: Db | Tx, unitFilter: (u: { id: string; siteId: string | null }) => boolean) {
  const [units, risks, links, sites] = await Promise.all([
    db.select().from(t.workUnits).orderBy(asc(t.workUnits.sort), asc(t.workUnits.label)),
    db.select().from(t.risks).orderBy(asc(t.risks.sort), asc(t.risks.id)),
    db.select().from(t.riskActions),
    db.select().from(t.sites),
  ]);
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));
  const kept = units.filter(unitFilter).map((u) => ({ id: u.id, label: u.label, siteId: u.siteId, site: u.siteId ? siteLabel.get(u.siteId) ?? u.siteId : 'Tous les sites' }));
  const order = new Map(kept.map((u, i) => [u.id, i]));
  const records: RiskRecord[] = risks
    .filter((r) => order.has(r.unitId))
    .sort((a, b) => order.get(a.unitId)! - order.get(b.unitId)! || a.sort - b.sort || a.id - b.id)
    .map((r) => {
      const u = kept[order.get(r.unitId)!];
      return {
        unitId: u.id, unit: u.label, siteId: u.siteId, site: u.site,
        hazard: r.hazard, situation: r.situation, gravity: r.gravity, probability: r.probability,
        existingMeasures: r.existingMeasures, residualGravity: r.residualGravity, residualProbability: r.residualProbability,
        actions: links.filter((l) => l.riskId === r.id).map((l) => l.actionId).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })),
      };
    });
  return { units: kept, risks: records };
}

/** Instantané de tout le DUERP (toutes unités, tous sites), figé à l'archivage d'une version. */
export async function buildDuerpSnapshot(tx: Tx, takenBy: string | null): Promise<DuerpSnapshot> {
  const { units, risks } = await riskRecords(tx, () => true);
  return { takenOn: today(), takenBy, units, risks };
}

/** Risques à exporter : une unité, ou toutes les unités du site sélectionné. */
export async function loadRiskExport(scope: { unitId: string } | { all: true }) {
  const [db, site] = await Promise.all([getDb(), currentSiteId()]);
  const filter = 'unitId' in scope
    ? (u: { id: string; siteId: string | null }) => u.id === scope.unitId && inSite(site, u.siteId)
    : (u: { id: string; siteId: string | null }) => inSite(site, u.siteId);
  const [data, versions, sites] = await Promise.all([
    riskRecords(db, filter),
    db.select({ version: t.duerpVersions.version, current: t.duerpVersions.current }).from(t.duerpVersions),
    db.select().from(t.sites),
  ]);
  return {
    ...data,
    version: versions.find((v) => v.current)?.version ?? null,
    siteLabel: site ? sites.find((s) => s.id === site)?.label ?? site : null,
  };
}

/** Version du DUERP et son instantané (null si la version n'existe pas). */
export async function loadDuerpVersion(version: string) {
  const db = await getDb();
  const [row] = (await db.select().from(t.duerpVersions)).filter((v) => v.version === version);
  if (!row) return null;
  const people = await loadPeople();
  // Le commentaire est exposé à part ; l'éventuelle copie héritée de l'instantané est retirée.
  const { comment: legacyComment, ...snapshot } = parseSnapshot(row.snapshot);
  return {
    version: row.version,
    current: row.current,
    updatedOn: row.updatedOn,
    archivedOn: row.archivedOn,
    validatedBy: row.validatedById ? people.get(row.validatedById)?.name ?? '' : '',
    cseConsultedOn: row.cseConsultedOn,
    comment: row.comment ?? legacyComment ?? null,
    snapshot,
  };
}
export type DuerpVersionDetail = NonNullable<Awaited<ReturnType<typeof loadDuerpVersion>>>;

// ─── CSV ─────────────────────────────────────────────────────────────────────

const CSV_HEADERS = ['Unité', 'Danger', 'Situation dangereuse', 'G', 'P', 'Cotation brute', 'Niveau', 'Mesures existantes', 'G résiduelle', 'P résiduelle', 'Risque résiduel', 'Actions'];

function csvCell(v: string | number) {
  if (typeof v === 'number') return String(v);
  // Neutralise les formules à l'ouverture dans un tableur (=, +, @, -x).
  const s = /^[=+@\t\r]|^-(?=\S)/.test(v) ? `'${v}` : v;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV « tableur français » : UTF-8 avec BOM, séparateur « ; », fins de ligne CRLF.
 * Les libellés d'unité ne sont uniques que par site : sur plusieurs sites, la colonne Unité porte aussi le site.
 */
export function risksCsv(rows: RiskRecord[]) {
  const multiSite = new Set(rows.map((r) => r.siteId)).size > 1;
  const lines = [CSV_HEADERS, ...rows.map((r) => {
    const b = r.gravity * r.probability;
    return [
      multiSite ? `${r.unit} · ${r.site}` : r.unit, r.hazard, r.situation, r.gravity, r.probability, b, levelName(b), r.existingMeasures,
      r.residualGravity, r.residualProbability, r.residualGravity * r.residualProbability, r.actions.join(', '),
    ];
  })];
  return `﻿${lines.map((l) => l.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

/** Fragment de nom de fichier sans accents ni espaces. */
export function fileSlug(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9.]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'duerp';
}
