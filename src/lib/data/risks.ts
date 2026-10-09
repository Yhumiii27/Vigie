import 'server-only';
import { cache } from 'react';
import { asc, eq, isNotNull } from 'drizzle-orm';
import { getDb, schema as t, type Db } from '@/db';
import type { ChangeEntry } from '@/components/ChangeLog';
import { addMonths, daysBetween, fmtDayMonth, today, yearOf } from '../dates';
import {
  DUERP_REQUIREMENT_LINK, EVENT_DISMISSED, EVENT_STEPS, EVENT_TYPES, QHSE_LEAD, RISK_ACTION_THRESHOLD, RISK_LEVELS, RISK_TODO_KIND,
  STEP_CLOSED, TODO_HORIZON_DAYS, canSee, riskLevel, type EventType, type RiskFlag, type TodoItem, type Tone,
} from '../domain';
import { actionColumn, lcfirst, loadPeople } from '../queries';
import { currentSiteId, getSession, inSite } from '../session';
import { loadChangeLogs } from './changelog';

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

export type LinkedAction = {
  id: string; title: string; status: string; late: boolean; done: boolean;
  closedOn: string | null; cancelled: boolean; pilot: string; dueOn: string; tone: Tone;
};

/** Archivage d'un risque ou d'une unité de travail : date (AAAA-MM-JJ), auteur et motif. */
export type ArchiveInfo = { on: string; by: string; reason: string | null };

/** Événement rattaché au risque (events.riskId), le plus récent d'abord. */
export type RiskEvent = { id: string; type: string; typeLabel: string; title: string; occurredOn: string; step: string; closed: boolean };

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
  /** Dernière recotation du résiduel (null = jamais recoté depuis Vigie). */
  residualReviewedOn: string | null;
  /** Actions liées, annulées comprises (grisées, sans effet sur l'alerte). */
  actions: LinkedAction[];
  events: RiskEvent[];
  flag: RiskFlag | null;
  /** Dernière clôture parmi les actions liées, quand elles sont toutes clôturées. */
  lastClosedOn: string | null;
  /** Risque archivé (retiré du document unique en vigueur, filtre « Archivés ») ; null = en vigueur. */
  archived: ArchiveInfo | null;
  history: ChangeEntry[];
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
  /** Risques « À définir » ou au résiduel encore élevé. */
  alerts: number;
  /** Risques au résiduel à recoter. */
  toReview: number;
};

/** Unité de travail archivée (filtre « Archivés ») ; `count` = risques archivés qui y restent rattachés. */
export type ArchivedUnitView = Pick<WorkUnitView, 'id' | 'label' | 'siteId' | 'site' | 'originRef' | 'count'> & { archived: ArchiveInfo; history: ChangeEntry[] };

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

const STATUS_LABEL: Record<string, string> = { todo: 'À lancer', doing: 'En cours', verify: 'Efficacité à vérifier', done: 'Clôturée', cancelled: 'Annulée' };

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

type RiskRow = typeof t.risks.$inferSelect;

/** Jour (AAAA-MM-JJ, heure de Paris) d'un horodatage. */
const dayOf = (d: Date) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(d);

/**
 * Alerte calculée d'un risque, par ordre de priorité (RISK_FLAGS) ; `active` = actions liées non annulées.
 * - toDefine : cotation brute ≥ seuil sans aucune action ;
 * - residualHigh : toutes les actions clôturées, résiduel encore ≥ seuil ;
 * - toReview : toutes les actions clôturées, résiduel non recoté depuis la dernière clôture.
 */
export function riskFlag(
  r: Pick<RiskRow, 'gravity' | 'probability' | 'residualGravity' | 'residualProbability' | 'residualReviewedOn'>,
  active: { done: boolean; closedOn: string | null }[],
): { flag: RiskFlag | null; lastClosedOn: string | null } {
  if (!active.length) return { flag: r.gravity * r.probability >= RISK_ACTION_THRESHOLD ? 'toDefine' : null, lastClosedOn: null };
  if (!active.every((a) => a.done)) return { flag: null, lastClosedOn: null };
  const lastClosedOn = active.map((a) => a.closedOn ?? '').sort().at(-1) || null;
  if (r.residualGravity * r.residualProbability >= RISK_ACTION_THRESHOLD) return { flag: 'residualHigh', lastClosedOn };
  if (!r.residualReviewedOn || (lastClosedOn && r.residualReviewedOn < lastClosedOn)) return { flag: 'toReview', lastClosedOn };
  return { flag: null, lastClosedOn };
}

function actionTone(status: string, late: boolean): Tone {
  if (late) return 'danger';
  if (status === 'done') return 'ok';
  if (status === 'cancelled') return 'neutral';
  if (status === 'verify') return 'warn';
  return 'accent';
}

/** Lectures du DUERP communes à l'écran, aux échéances et aux listes de choix : une seule fois par requête. */
const loadRiskBase = cache(async () => {
  const db = await getDb();
  const [people, versions, allUnits, allRisks, links, actions, sites, site, events, requirements] = await Promise.all([
    loadPeople(),
    db.select().from(t.duerpVersions),
    db.select().from(t.workUnits).orderBy(asc(t.workUnits.sort), asc(t.workUnits.label)),
    db.select().from(t.risks).orderBy(asc(t.risks.sort), asc(t.risks.id)),
    db.select().from(t.riskActions),
    db.select().from(t.actions),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
    currentSiteId(),
    db.select({ id: t.events.id, type: t.events.type, title: t.events.title, occurredOn: t.events.occurredOn, step: t.events.step, riskId: t.events.riskId, dismissedAt: t.events.dismissedAt })
      .from(t.events).where(isNotNull(t.events.riskId)),
    db.select({ id: t.requirements.id, archivedAt: t.requirements.archivedAt }).from(t.requirements).where(eq(t.requirements.linkedTo, DUERP_REQUIREMENT_LINK)),
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
      const late = actionColumn(a, now) === 'late';
      return {
        id: a.id, title: a.title, status: late ? 'En retard' : STATUS_LABEL[a.status] ?? a.status, late, done: a.status === 'done',
        closedOn: a.closedOn, cancelled: a.status === 'cancelled', pilot: people.get(a.pilotId)?.name ?? '', dueOn: a.dueOn, tone: actionTone(a.status, late),
      };
    });

  const eventsOf = (riskId: number): RiskEvent[] => events
    .filter((e) => e.riskId === riskId)
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id, 'fr', { numeric: true }))
    .map((e) => ({
      id: e.id, type: e.type, typeLabel: EVENT_TYPES[e.type as EventType]?.label ?? e.type, title: e.title, occurredOn: e.occurredOn,
      step: e.dismissedAt ? EVENT_DISMISSED : EVENT_STEPS[e.step] ?? '', closed: !!e.dismissedAt || e.step === STEP_CLOSED,
    }));

  const archiveOf = (r: { archivedAt: Date | null; archivedById: string | null; archiveReason: string | null }): ArchiveInfo | null =>
    r.archivedAt ? { on: dayOf(r.archivedAt), by: r.archivedById ? people.get(r.archivedById)?.name ?? '' : '', reason: r.archiveReason } : null;
  const unitBase = (u: (typeof allUnits)[number]) => ({
    id: u.id, label: u.label, siteId: u.siteId, site: u.siteId ? siteLabel.get(u.siteId) ?? u.siteId : 'Tous les sites',
    originRef: `DUERP · ${lcfirst(u.label)}`,
  });

  // Site sélectionné ; les unités et risques archivés sont tenus à part (filtre « Archivés »), hors indicateurs et échéances.
  const siteUnits = allUnits.filter((u) => inSite(site, u.siteId));
  const units = siteUnits.filter((u) => !u.archivedAt);
  const unitIds = new Set(siteUnits.map((u) => u.id));
  const views: Omit<RiskView, 'history'>[] = allRisks.filter((r) => unitIds.has(r.unitId)).map((r) => {
    const actions = linked(r.id);
    return {
      id: r.id, unitId: r.unitId, hazard: r.hazard, situation: r.situation,
      gravity: r.gravity, probability: r.probability, existingMeasures: r.existingMeasures,
      residualGravity: r.residualGravity, residualProbability: r.residualProbability, residualReviewedOn: r.residualReviewedOn,
      actions, events: eventsOf(r.id),
      ...(r.archivedAt ? { flag: null, lastClosedOn: null } : riskFlag(r, actions.filter((a) => !a.cancelled))),
      archived: archiveOf(r),
    };
  });
  const risks = views.filter((r) => !r.archived);
  const archivedRisks = views.filter((r) => r.archived);
  const unitViews: WorkUnitView[] = units.map((u) => {
    const ur = risks.filter((r) => r.unitId === u.id);
    return {
      ...unitBase(u),
      count: ur.length,
      top: Math.max(0, ...ur.map((r) => riskLevel(r.gravity * r.probability))),
      alerts: ur.filter((r) => r.flag === 'toDefine' || r.flag === 'residualHigh').length,
      toReview: ur.filter((r) => r.flag === 'toReview').length,
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
  const daysToUpdate = current ? daysBetween(now, current.nextUpdateOn) : null;
  const requirement = requirements.find((r) => !r.archivedAt);
  const activeUnitIds = new Set(allUnits.filter((u) => !u.archivedAt).map((u) => u.id));
  return {
    now, people, site, versions, versionViews, current, daysToUpdate, units: unitViews, risks, archivedRisks,
    archivedUnits: siteUnits.filter((u) => u.archivedAt).map((u) => ({
      ...unitBase(u), count: archivedRisks.filter((r) => r.unitId === u.id).length, archived: archiveOf(u)!,
    })),
    // Contenu du prochain instantané (tous sites, éléments en vigueur).
    totals: { units: activeUnitIds.size, risks: allRisks.filter((r) => !r.archivedAt && activeUnitIds.has(r.unitId)).length },
    // Actions ouvertes du site sélectionné (« Rattacher une action existante ») ; la fiche ne garde que celles du site de l'unité.
    linkableActions: actions
      .filter((a) => a.status !== 'done' && a.status !== 'cancelled' && inSite(site, a.siteId))
      .sort((a, b) => b.id.localeCompare(a.id, 'fr', { numeric: true }))
      .map((a) => ({ id: a.id, label: `${a.id} · ${a.title}`, siteId: a.siteId })),
    duerpRequirement: requirement ? { id: requirement.id, href: `/veille?onglet=exigences&exigence=${requirement.id}` as const } : null,
  };
});

export async function loadRisks() {
  const base = await loadRiskBase();
  const { now, versions, versionViews, current, daysToUpdate } = base;
  const [history, unitHistory] = await Promise.all([
    loadChangeLogs('risk', [...base.risks, ...base.archivedRisks].map((r) => r.id)),
    loadChangeLogs('work_unit', base.archivedUnits.map((u) => u.id)),
  ]);
  const archived = versionViews.filter((v) => !v.current);
  const since = archived.length ? Math.min(...archived.map((v) => yearOf(v.updatedOn))) : null;
  // Couleur d'alerte dès 30 jours avant l'échéance ; rouge une fois la mise à jour annuelle dépassée.
  const updateTone: Tone | null = daysToUpdate == null ? null : daysToUpdate < 0 ? 'danger' : daysToUpdate <= 30 ? 'warn' : null;

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
    totals: base.totals,
    units: base.units,
    risks: base.risks.map((r): RiskView => ({ ...r, history: history.get(String(r.id)) ?? [] })),
    archivedRisks: base.archivedRisks.map((r): RiskView => ({ ...r, history: history.get(String(r.id)) ?? [] })),
    archivedUnits: base.archivedUnits.map((u): ArchivedUnitView => ({ ...u, history: unitHistory.get(u.id) ?? [] })),
    linkableActions: base.linkableActions,
    duerpRequirement: base.duerpRequirement,
  };
}
export type RisksData = Awaited<ReturnType<typeof loadRisks>>;

/**
 * État de la version en vigueur du DUERP, pour l'exigence de veille rattachée (requirements.linkedTo = 'duerp') :
 * échéance de mise à jour annuelle, retard, consultation du CSE. Indépendant du site sélectionné.
 */
export const loadDuerpStatus = cache(async () => {
  const { current, daysToUpdate } = await loadRiskBase();
  return {
    version: current?.version ?? null,
    updatedOn: current?.updatedOn ?? null,
    nextUpdateOn: current?.nextUpdateOn ?? null,
    daysToUpdate,
    /** Pas de version en vigueur, ou mise à jour annuelle dépassée. */
    overdue: !current || (daysToUpdate != null && daysToUpdate < 0),
    cseConsultedOn: current?.cseConsultedOn ?? null,
    href: '/risques' as const,
  };
});
export type DuerpStatus = Awaited<ReturnType<typeof loadDuerpStatus>>;

// ─── Exports et instantanés ─────────────────────────────────────────────────

async function riskRecords(db: Db | Tx, unitFilter: (u: { id: string; siteId: string | null }) => boolean) {
  const [units, risks, links, sites] = await Promise.all([
    db.select().from(t.workUnits).orderBy(asc(t.workUnits.sort), asc(t.workUnits.label)),
    db.select().from(t.risks).orderBy(asc(t.risks.sort), asc(t.risks.id)),
    db.select().from(t.riskActions),
    db.select().from(t.sites),
  ]);
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));
  // Document unique en vigueur : unités et risques archivés exclus.
  const kept = units.filter((u) => !u.archivedAt && unitFilter(u)).map((u) => ({ id: u.id, label: u.label, siteId: u.siteId, site: u.siteId ? siteLabel.get(u.siteId) ?? u.siteId : 'Tous les sites' }));
  const order = new Map(kept.map((u, i) => [u.id, i]));
  const records: RiskRecord[] = risks
    .filter((r) => !r.archivedAt && order.has(r.unitId))
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

/** Instantané de tout le DUERP en vigueur (toutes unités, tous sites, archivés exclus), figé à l'archivage d'une version. */
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

// ─── Échéances du domaine (tableau de bord, À faire, notifications, badge) ──

/**
 * Échéances du DUERP (kind RISK_TODO_KIND) : mise à jour annuelle (sous 15 jours ou dépassée), consultation du CSE,
 * risques ≥ 8 sans action ou au résiduel encore ≥ 8 (regroupés par unité), résiduels à recoter.
 * Unités du site sélectionné ; rien pour les rôles sans l'écran « risks ».
 */
export const loadRiskSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const { role } = await getSession();
  if (!canSee(role, 'risks')) return { badge: 0, todo: [] };
  const { now, people, current, units, risks } = await loadRiskBase();
  const ownerId = current?.validatedById ?? QHSE_LEAD;
  const base = { kind: RISK_TODO_KIND, who: people.get(ownerId)?.name ?? '', ownerIds: [...new Set([ownerId, QHSE_LEAD])] };
  const todo: TodoItem[] = [];

  if (!current) {
    todo.push({ ...base, date: now, tone: 'danger', title: 'Aucune version du DUERP en vigueur', href: '/risques', overdue: true });
  } else {
    if (current.nextUpdateOn < now) {
      todo.push({ ...base, date: now, tone: 'danger', title: `Mise à jour annuelle du DUERP dépassée depuis le ${fmtDayMonth(current.nextUpdateOn)}`, href: '/risques', overdue: true });
    } else if (daysBetween(now, current.nextUpdateOn) <= TODO_HORIZON_DAYS) {
      todo.push({ ...base, date: current.nextUpdateOn, tone: 'warn', title: `Mise à jour annuelle du DUERP (version ${current.version})`, href: '/risques' });
    }
    if (!current.cseConsultedOn) {
      todo.push({ ...base, date: now, tone: 'warn', title: `Consultation du CSE à renseigner · DUERP ${current.version}`, href: '/risques' });
    }
  }

  for (const u of units) {
    const ur = risks.filter((r) => r.unitId === u.id);
    const groups: [RiskFlag, string][] = [['toDefine', `≥ ${RISK_ACTION_THRESHOLD} sans action de réduction`], ['residualHigh', `au résiduel encore ≥ ${RISK_ACTION_THRESHOLD}`]];
    for (const [flag, label] of groups) {
      const hit = ur.filter((r) => r.flag === flag);
      if (!hit.length) continue;
      todo.push({
        ...base, date: now, tone: 'danger', overdue: true, count: hit.length,
        title: `${u.label} · ${hit.length} risque${hit.length > 1 ? 's' : ''} ${label}`,
        href: hit.length === 1 ? `/risques?risque=${hit[0].id}` : `/risques?unite=${encodeURIComponent(u.id)}`,
      });
    }
    for (const r of ur.filter((r) => r.flag === 'toReview')) {
      todo.push({ ...base, date: now, tone: 'warn', title: `${u.label} · ${r.hazard} — résiduel à recoter (actions clôturées)`, href: `/risques?risque=${r.id}` });
    }
  }
  return { badge: todo.reduce((n, i) => n + (i.count ?? 1), 0), todo };
});
