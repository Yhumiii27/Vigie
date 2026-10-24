import 'server-only';
import { cache } from 'react';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { getDb, schema as t, type Db } from '@/db';
import type { ChangeEntry } from '@/components/ChangeLog';
import { addMonths, daysBetween, fmtDayMonth, yearOf, parisDay } from '../dates';
import { today } from '@/lib/today';
import {
  DUERP_ACCESS_CHANNELS, DUERP_REQUESTERS, DUERP_REQUIREMENT_LINK, EVENT_DISMISSED, EVENT_STEPS, EVENT_TYPES, PROGRAM_SHORT,
  RISK_ACTION_THRESHOLD, RISK_LEVELS, RISK_TODO_KIND, STEP_CLOSED, TODO_HORIZON_DAYS, AVANCEMENT, canApprove, canEdit, isClosedActionStatus,
  isEmployee, isMine, riskLevel, type DuerpAccessChannel, type DuerpRequester, type EventType, type ProgramState, type RiskFlag,
  type TodoItem, type Tone,
} from '../domain';
import type { Option } from '../form-options';
import { actionLabel, canCreateAction, isLate } from '../action-rules';
import { lcfirst, loadPeople, type ActionRow } from '../queries';
import { loadQhseLeads, type Recipients } from './leads';
import { ALL_SITES, allowedSiteIds, currentSiteId, getSession, inPerimeter, inSite, siteFilter, type SiteScope } from '../session';
import { loadChangeLog, loadChangeLogs } from './changelog';
import { loadEntityFiles } from './entity-files';
import type { AttachmentItem } from '../attachments';
import { fileSlug as slug, toCsv } from '@/lib/csv';
import { entityVersions } from '@/server/versions';

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

/**
 * Action du plan d'actions QSE rattachée au risque : `title` = libellé court (actionLabel du détail), `status` = avancement
 * affiché (« En retard » calculé) ; `done` = Vérifiée (close pour le risque : résiduel à recoter, spec § 7), `cancelled` =
 * Abandonnée (grisée, sans effet sur l'alerte). Une action Terminée attend sa vérification : elle reste ouverte.
 */
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
  /** Actions liées, abandonnées comprises (grisées, sans effet sur l'alerte). */
  actions: LinkedAction[];
  events: RiskEvent[];
  flag: RiskFlag | null;
  /** Dernière vérification (closed_on) parmi les actions liées, quand elles sont toutes Vérifiées. */
  lastClosedOn: string | null;
  /** Risque archivé (retiré du document unique en vigueur, filtre « Archivés ») ; null = en vigueur. */
  archived: ArchiveInfo | null;
  history: ChangeEntry[];
  /** Justificatifs du risque (DUE-09, pièces jointes 'risk'). */
  files: AttachmentItem[];
  /** Version de la fiche (QUA-12), pour qui la modifie. */
  version?: string;
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
  /** DUE-03 : transmission au SPST (L. 4121-3, R. 4121-4) et dépôt sur le portail numérique (L. 4121-3-1 V). */
  spstSentOn: string | null;
  portalDepositedOn: string | null;
  archivedOn: string | null;
  comment: string | null;
  /** Instantané des risques disponible dans Vigie (faux pour les versions archivées hors Vigie). */
  hasSnapshot: boolean;
  riskCount: number | null;
  /** DUERP signé de la version (DUE-09, pièces jointes 'duerp_version') ; rempli par loadRisks. */
  files: AttachmentItem[];
};

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

/**
 * Instantané réduit au périmètre de la personne (SEC-02) : l'archivage fige tous les sites, une personne limitée à
 * certains sites n'en consulte et n'en exporte que les unités et risques de ses sites (et ceux communs à tous les sites).
 */
export function snapshotInPerimeter<S extends DuerpSnapshot>(snapshot: S, allowed: string[] | null): S {
  if (!allowed) return snapshot;
  return {
    ...snapshot,
    ...(snapshot.units ? { units: snapshot.units.filter((u) => inPerimeter(allowed, u.siteId)) } : {}),
    ...(snapshot.risks ? { risks: snapshot.risks.filter((r) => inPerimeter(allowed, r.siteId)) } : {}),
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
const dayOf = parisDay;
const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Alerte calculée d'un risque, par ordre de priorité (RISK_FLAGS) ; `active` = actions liées non abandonnées, `done` =
 * Vérifiée (une action Terminée attend encore sa vérification d'efficacité : elle ne déclenche pas la recotation).
 * - toDefine : cotation brute ≥ seuil sans aucune action ;
 * - residualHigh : toutes les actions vérifiées, résiduel encore ≥ seuil ;
 * - toReview : toutes les actions vérifiées, résiduel non recoté depuis la dernière vérification.
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

/**
 * État affiché d'une action (§ 5.1, § 6.3) : avancement (« En retard » calculé, ton danger), retard, `done` = Vérifiée,
 * `cancelled` = Abandonnée.
 */
function actionState(a: Pick<ActionRow, 'status' | 'dueOn'>, now: string) {
  const late = isLate(a, now);
  const def = AVANCEMENT[a.status];
  return {
    status: late ? 'En retard' : def?.label ?? a.status, tone: (late ? 'danger' : def?.tone ?? 'neutral') as Tone, late,
    done: a.status === 'verifiee', cancelled: a.status === 'abandonnee',
  };
}

/**
 * Lectures du DUERP communes à l'écran, aux échéances et aux listes de choix : une seule fois par requête et par portée.
 * Unités du site sélectionné (scope 'site') ou de tout le périmètre (scope 'perimeter' : échéances, TDB-05).
 */
const loadRiskBase = cache(async (scope: SiteScope = 'site') => {
  const db = await getDb();
  const [people, versions, allUnits, allRisks, links, actions, sites, site, events, requirements, allowed, keep] = await Promise.all([
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
    allowedSiteIds(),
    siteFilter(scope),
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
      const { status, tone, late, done, cancelled } = actionState(a, now);
      return { id: a.id, title: actionLabel(a.detail), status, late, done, closedOn: a.closedOn, cancelled, pilot: people.get(a.pilotId)?.name ?? '', dueOn: a.dueOn, tone };
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

  // Site sélectionné (ou périmètre) ; les unités et risques archivés sont tenus à part (filtre « Archivés »), hors indicateurs et échéances.
  const siteUnits = allUnits.filter((u) => keep(u.siteId));
  const units = siteUnits.filter((u) => !u.archivedAt);
  const unitIds = new Set(siteUnits.map((u) => u.id));
  const views: Omit<RiskView, 'history' | 'files'>[] = allRisks.filter((r) => unitIds.has(r.unitId)).map((r) => {
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
      const snap = snapshotInPerimeter(parseSnapshot(v.snapshot), allowed);
      return {
        version: v.version, current: v.current, updatedOn: v.updatedOn, nextUpdateOn: v.nextUpdateOn, retention: v.retention,
        validatedById: v.validatedById, validatedBy: v.validatedById ? people.get(v.validatedById)?.name ?? '' : '',
        cseConsultedOn: v.cseConsultedOn, spstSentOn: v.spstSentOn, portalDepositedOn: v.portalDepositedOn,
        archivedOn: v.archivedOn, comment: v.comment ?? snap.comment ?? null,
        hasSnapshot: !v.current && !!snap.risks, riskCount: snap.risks ? snap.risks.length : null, files: [],
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || compareVersionsDesc(a.version, b.version));

  const current = versionViews.find((v) => v.current) ?? null;
  const daysToUpdate = current ? daysBetween(now, current.nextUpdateOn) : null;
  const requirement = requirements.find((r) => !r.archivedAt);
  const activeUnitIds = new Set(allUnits.filter((u) => !u.archivedAt).map((u) => u.id));
  return {
    now, people, site, versions, versionViews, current, daysToUpdate, units: unitViews, risks, archivedRisks,
    // Lectures brutes (impression, programme annuel de prévention) : tous sites, archivés compris.
    actions, links, allRisks, allUnits, siteLabel,
    archivedUnits: siteUnits.filter((u) => u.archivedAt).map((u) => ({
      ...unitBase(u), count: archivedRisks.filter((r) => r.unitId === u.id).length, archived: archiveOf(u)!,
    })),
    // Contenu du prochain instantané (tous sites, éléments en vigueur).
    totals: { units: activeUnitIds.size, risks: allRisks.filter((r) => !r.archivedAt && activeUnitIds.has(r.unitId)).length },
    // Actions non closes (ni Vérifiées ni Abandonnées) du site sélectionné (« Rattacher une action existante », service QHSE) ;
    // la fiche ne garde que celles du site de l'unité.
    linkableActions: actions
      .filter((a) => !isClosedActionStatus(a.status) && inSite(site, a.siteId))
      .sort((a, b) => b.id.localeCompare(a.id, 'fr', { numeric: true }))
      .map((a) => ({ id: a.id, label: clip(`${a.id} · ${actionLabel(a.detail)}`), siteId: a.siteId })),
    duerpRequirement: requirement ? { id: requirement.id, href: `/veille?onglet=exigences&exigence=${requirement.id}` as const } : null,
  };
});

/**
 * Écran DUERP, projeté selon le rôle (DUE-01) : le document unique est consultable par tous les rôles (R. 4121-4), saisi par
 * ceux qui le modifient (canEdit). En consultation : ni éléments archivés, ni actions à rattacher, ni historique ; pour le
 * Salarié, en plus, ni pilotes des actions ni événements liés (signalements nominatifs de collègues). Création d'action et
 * rattachement d'une action existante : service QHSE seulement (ACT-22, `actionsQhse`) ; les autres rôles lisent les
 * actions liées.
 */
export async function loadRisks() {
  const [base, { role }] = await Promise.all([loadRiskBase(), getSession()]);
  const { now, versions, versionViews, current, daysToUpdate } = base;
  const edit = canEdit(role, 'risks');
  const qhse = edit && canCreateAction(role);
  const employee = isEmployee(role);
  const [history, unitHistory] = edit
    ? await Promise.all([
      loadChangeLogs('risk', [...base.risks, ...base.archivedRisks].map((r) => r.id)),
      loadChangeLogs('work_unit', base.archivedUnits.map((u) => u.id)),
    ])
    : [new Map<string, ChangeEntry[]>(), new Map<string, ChangeEntry[]>()];
  // DUE-09 : DUERP signé par version et justificatifs des risques, lisibles par tous les rôles de l'écran (Salarié compris).
  const [versionFiles, riskFiles, riskVersions] = await Promise.all([
    loadEntityFiles('duerp_version', versionViews.map((v) => v.version)),
    loadEntityFiles('risk', [...base.risks, ...(edit ? base.archivedRisks : [])].map((r) => r.id)),
    edit ? entityVersions(await getDb(), 'risk', base.risks.map((r) => r.id)) : new Map<string, string>(),
  ]);
  const view = (r: Omit<RiskView, 'history' | 'files'>): RiskView => ({
    ...r,
    ...(employee ? { events: [], actions: r.actions.map((a) => ({ ...a, pilot: '' })) } : {}),
    history: history.get(String(r.id)) ?? [],
    files: riskFiles.get(String(r.id)) ?? [],
    ...(edit ? { version: riskVersions.get(String(r.id)) } : {}),
  });
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
    versions: versionViews.map((v) => ({ ...v, files: versionFiles.get(v.version) ?? [] })),
    nextVersion: suggestNextVersion(versions.map((v) => v.version), now),
    nextUpdateOn: addMonths(now, 12),
    totals: base.totals,
    units: base.units,
    risks: base.risks.map(view),
    archivedRisks: edit ? base.archivedRisks.map(view) : [],
    archivedUnits: edit ? base.archivedUnits.map((u): ArchivedUnitView => ({ ...u, history: unitHistory.get(u.id) ?? [] })) : [],
    linkableActions: qhse ? base.linkableActions : [],
    /** Service QHSE : crée les actions du DUERP et y rattache des actions existantes (ACT-22). */
    actionsQhse: qhse,
    duerpRequirement: base.duerpRequirement,
    /** Consultation seule (chef de projet, salarié) : aucune saisie, ni archives ni historique. */
    readOnly: !edit,
    /** Salarié : ni pilotes ni événements liés. */
    employee,
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
  // Lectures successives : dans une transaction, une seule connexion (pas de requêtes concurrentes sur un client pg).
  const units = await db.select().from(t.workUnits).orderBy(asc(t.workUnits.sort), asc(t.workUnits.label));
  const risks = await db.select().from(t.risks).orderBy(asc(t.risks.sort), asc(t.risks.id));
  const links = await db.select().from(t.riskActions);
  const sites = await db.select().from(t.sites);
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
  const [db, allowed] = await Promise.all([getDb(), allowedSiteIds()]);
  const [row] = (await db.select().from(t.duerpVersions)).filter((v) => v.version === version);
  if (!row) return null;
  const people = await loadPeople();
  // Le commentaire est exposé à part ; l'éventuelle copie héritée de l'instantané est retirée.
  const { comment: legacyComment, ...snapshot } = snapshotInPerimeter(parseSnapshot(row.snapshot), allowed);
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

/** Action de prévention citée dans la version imprimable : libellé court, date cible et avancement (« En retard » calculé), sans responsable. */
export type PrintAction = { title: string; dueOn: string; status: string };

/**
 * Version imprimable du DUERP en vigueur (DUE-01) : unités et risques en vigueur du site sélectionné (dans le périmètre),
 * version en vigueur et actions de prévention citées. Jamais de pilotes, d'événements liés ni d'historique.
 */
export async function loadDuerpPrint() {
  const [db, site, allowed, people] = await Promise.all([getDb(), currentSiteId(), allowedSiteIds(), loadPeople()]);
  const now = today();
  const [data, versions, sites, actions] = await Promise.all([
    riskRecords(db, (u) => inPerimeter(allowed, u.siteId) && inSite(site, u.siteId)),
    db.select().from(t.duerpVersions),
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
    db.select({ id: t.actions.id, detail: t.actions.detail, dueOn: t.actions.dueOn, status: t.actions.status }).from(t.actions),
  ]);
  const cited = new Set(data.risks.flatMap((r) => r.actions));
  const actionInfo: Record<string, PrintAction> = Object.fromEntries(actions
    .filter((a) => cited.has(a.id))
    .map((a) => [a.id, { title: actionLabel(a.detail), dueOn: a.dueOn, status: actionState(a, now).status }]));
  const v = versions.find((x) => x.current);
  return {
    version: v ? {
      version: v.version, updatedOn: v.updatedOn, nextUpdateOn: v.nextUpdateOn, retention: v.retention,
      validatedBy: v.validatedById ? people.get(v.validatedById)?.name ?? '' : '', cseConsultedOn: v.cseConsultedOn, comment: versionComment(v),
    } : null,
    siteLabel: site ? sites.find((s) => s.id === site)?.label ?? site : null,
    units: data.units,
    risks: data.risks,
    actionInfo,
  };
}
export type DuerpPrint = Awaited<ReturnType<typeof loadDuerpPrint>>;

// ─── Registre des mises à disposition du DUERP (R. 4121-4, DUE-01) ─────────

export type DuerpAccessRequestView = {
  id: number;
  requestedOn: string;
  requesterKind: string;
  requesterKindLabel: string;
  requesterName: string;
  siteId: string | null;
  site: string;
  version: string;
  communicatedOn: string | null;
  channel: string | null;
  channelLabel: string;
  note: string | null;
  /** Non communiquée et non annulée. */
  pending: boolean;
  cancelled: ArchiveInfo | null;
  history: ChangeEntry[];
};

/**
 * Registre des demandes d'accès au DUERP (anciens salariés, CSE, médecin du travail, inspection, CARSAT) : réservé à
 * l'animateur QHSE et à la direction (noms d'anciens salariés), en lecture comme en saisie. Site sélectionné, dans le
 * périmètre ; demandes les plus récentes d'abord ; versions proposées : toutes, la plus récente d'abord.
 */
export async function loadDuerpAccessRegister(): Promise<{ requests: DuerpAccessRequestView[]; versions: Option[]; pending: number }> {
  const session = await getSession();
  if (!canApprove(session.role) || !canEdit(session.role, 'risks')) return { requests: [], versions: [], pending: 0 };
  const db = await getDb();
  const site = session.site.id === ALL_SITES ? null : session.site.id;
  const [rows, versions, sites, people] = await Promise.all([
    db.select().from(t.duerpAccessRequests),
    db.select({ version: t.duerpVersions.version, current: t.duerpVersions.current }).from(t.duerpVersions),
    db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
    loadPeople(),
  ]);
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));
  const kept = rows
    .filter((r) => inPerimeter(session.allowedSiteIds, r.siteId) && inSite(site, r.siteId))
    .sort((a, b) => b.requestedOn.localeCompare(a.requestedOn) || b.id - a.id);
  const history = await loadChangeLogs('duerp_access_request', kept.map((r) => r.id));
  const requests = kept.map((r): DuerpAccessRequestView => ({
    id: r.id, requestedOn: r.requestedOn, requesterKind: r.requesterKind,
    requesterKindLabel: DUERP_REQUESTERS[r.requesterKind as DuerpRequester] ?? r.requesterKind, requesterName: r.requesterName,
    siteId: r.siteId, site: r.siteId ? siteLabel.get(r.siteId) ?? r.siteId : 'Tous les sites', version: r.version,
    communicatedOn: r.communicatedOn, channel: r.channel,
    channelLabel: r.channel ? DUERP_ACCESS_CHANNELS[r.channel as DuerpAccessChannel] ?? r.channel : '', note: r.note,
    pending: !r.cancelledAt && !r.communicatedOn,
    cancelled: r.cancelledAt ? { on: dayOf(r.cancelledAt), by: r.cancelledById ? people.get(r.cancelledById)?.name ?? '' : '', reason: r.cancelReason } : null,
    history: history.get(String(r.id)) ?? [],
  }));
  return {
    requests,
    versions: versions
      .sort((a, b) => compareVersionsDesc(a.version, b.version))
      .map((v) => [v.version, v.current ? `${v.version} (en vigueur)` : v.version] as Option),
    pending: requests.filter((r) => r.pending).length,
  };
}
export type DuerpAccessRegister = Awaited<ReturnType<typeof loadDuerpAccessRegister>>;

// ─── Programme annuel de prévention (PAPRIPACT, L. 4121-3-1, DUE-02) ─────────

/** Risque du DUERP en vigueur auquel une ligne du programme est rattachée (cotation brute). */
export type ProgramRiskRecord = { id?: number; unitId?: string; unit: string; hazard: string; cotation: number };

/** Ligne du programme, telle que figée à l'arrêt (instantané prevention_programs.snapshot) ou lue en préparation. */
export type ProgramLineRecord = {
  actionId: string;
  title: string;
  siteId: string | null;
  site: string;
  pilot: string;
  dueOn: string;
  /** Statut de l'action (« En retard » calculé) à la date de lecture, ou à la date d'arrêt dans l'instantané. */
  status: string;
  risks: ProgramRiskRecord[];
  /** Coût estimé (€ HT). */
  estimatedCost: number | null;
  resources: string | null;
  indicator: string | null;
};

/** Contenu de prevention_programs.snapshot : lignes du programme (tous sites) figées à la consultation du CSE. */
export type ProgramSnapshot = { takenOn: string; takenBy: string | null; duerpVersion: string; cseConsultedOn: string; lines: ProgramLineRecord[] };

type ProgramActionRow = typeof t.preventionProgramActions.$inferSelect;

/** Lectures nécessaires aux lignes du programme (plan d'actions, liens aux risques, DUERP, sites, personnes). */
export type ProgramSources = {
  actions: ActionRow[];
  links: { riskId: number; actionId: string }[];
  risks: Pick<RiskRow, 'id' | 'unitId' | 'hazard' | 'gravity' | 'probability' | 'archivedAt'>[];
  units: { id: string; label: string; archivedAt: Date | null }[];
  siteLabel: Map<string, string>;
  personName: (id: string) => string;
  now: string;
};

/**
 * Lectures du programme, dans une transaction ou hors transaction : personnes lues par la même connexion, requêtes
 * successives (une transaction n'a qu'une connexion : pas de requêtes concurrentes sur un client pg).
 */
export async function loadProgramSources(db: Db | Tx, now = today()): Promise<ProgramSources> {
  const actions = await db.select().from(t.actions);
  const links = await db.select().from(t.riskActions);
  const risks = await db.select({ id: t.risks.id, unitId: t.risks.unitId, hazard: t.risks.hazard, gravity: t.risks.gravity, probability: t.risks.probability, archivedAt: t.risks.archivedAt })
    .from(t.risks).orderBy(asc(t.risks.sort), asc(t.risks.id));
  const units = await db.select({ id: t.workUnits.id, label: t.workUnits.label, archivedAt: t.workUnits.archivedAt }).from(t.workUnits);
  const sites = await db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites);
  const people = await db.select({ id: t.people.id, name: t.people.name }).from(t.people);
  const names = new Map(people.map((p) => [p.id, p.name]));
  return { actions, links, risks, units, siteLabel: new Map(sites.map((s) => [s.id, s.label])), personName: (id) => names.get(id) ?? '', now };
}

/** Risques en vigueur (risque et unité non archivés) de chaque action rattachée, la cotation brute la plus forte d'abord. */
function inForceRisksByAction(s: Pick<ProgramSources, 'links' | 'risks' | 'units'>) {
  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const riskById = new Map(s.risks.map((r) => [r.id, r]));
  const map = new Map<string, ProgramRiskRecord[]>();
  for (const l of s.links) {
    const r = riskById.get(l.riskId);
    const u = r ? unitById.get(r.unitId) : undefined;
    if (!r || !u || r.archivedAt || u.archivedAt) continue;
    map.set(l.actionId, [...(map.get(l.actionId) ?? []), { id: r.id, unitId: u.id, unit: u.label, hazard: r.hazard, cotation: r.gravity * r.probability }]);
  }
  map.forEach((list) => list.sort((a, b) => b.cotation - a.cotation || (a.id ?? 0) - (b.id ?? 0)));
  return map;
}

/** Actions rattachées à un risque en vigueur du DUERP : seules admises au programme. */
export const riskLinkedActionIds = (s: Pick<ProgramSources, 'links' | 'risks' | 'units'>) => new Set(inForceRisksByAction(s).keys());

const byDue = (a: { dueOn: string; id: string }, b: { dueOn: string; id: string }) =>
  a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id, 'fr', { numeric: true });

/**
 * Actions reprises à la création du programme de l'année : rattachées à un risque en vigueur, non abandonnées, à date cible
 * dans l'année, ou encore non closes (ni Vérifiées ni Abandonnées : Reportée et Terminée comprises) avec une date cible
 * antérieure au 1er janvier (report). Par date cible, puis numéro.
 */
export function programDefaultIds(actions: Pick<ActionRow, 'id' | 'dueOn' | 'status'>[], riskLinked: Set<string>, year: number): string[] {
  const start = `${year}-01-01`;
  return actions
    .filter((a) => riskLinked.has(a.id) && a.status !== 'abandonnee'
      && (yearOf(a.dueOn) === year || (!isClosedActionStatus(a.status) && a.dueOn < start)))
    .sort(byDue)
    .map((a) => a.id);
}

/**
 * Actions proposées à l'ajout (« Ajouter une action ») : rattachées à un risque en vigueur, non abandonnées, pas encore au
 * programme, non closes, ou Vérifiées dans l'année (closed_on = date de la vérification d'efficacité).
 */
export function programCandidateIds(
  actions: Pick<ActionRow, 'id' | 'dueOn' | 'status' | 'closedOn'>[], riskLinked: Set<string>, inProgram: Set<string>, year: number,
): string[] {
  return actions
    .filter((a) => riskLinked.has(a.id) && a.status !== 'abandonnee' && !inProgram.has(a.id)
      && (!isClosedActionStatus(a.status) || (a.status === 'verifiee' && !!a.closedOn && yearOf(a.closedOn) === year)))
    .sort(byDue)
    .map((a) => a.id);
}

/** Totaux du programme : lignes, lignes chiffrées, coût estimé (€ HT, au centime), actions Vérifiées (`done`) et Abandonnées (`cancelled`). */
export function programTotals(lines: { estimatedCost: number | null; done?: boolean; cancelled?: boolean }[]) {
  const costed = lines.filter((l) => l.estimatedCost != null);
  return {
    count: lines.length,
    costed: costed.length,
    cost: Math.round(costed.reduce((n, l) => n + l.estimatedCost!, 0) * 100) / 100,
    done: lines.filter((l) => l.done).length,
    cancelled: lines.filter((l) => l.cancelled).length,
  };
}

/** Lecture défensive du JSON stocké dans prevention_programs.snapshot ; null si absent ou illisible. */
export function parseProgramSnapshot(raw: unknown): ProgramSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const opt = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const lines = (Array.isArray(s.lines) ? s.lines : []).filter(obj).filter((l) => typeof l.actionId === 'string' && !!l.actionId)
    .map((l): ProgramLineRecord => ({
      actionId: l.actionId as string, title: str(l.title), siteId: opt(l.siteId), site: str(l.site) || opt(l.siteId) || 'Tous les sites',
      pilot: str(l.pilot), dueOn: str(l.dueOn), status: str(l.status),
      risks: (Array.isArray(l.risks) ? l.risks : []).filter(obj).map((r) => ({
        ...(typeof r.id === 'number' ? { id: r.id } : {}), ...(typeof r.unitId === 'string' ? { unitId: r.unitId } : {}),
        unit: str(r.unit), hazard: str(r.hazard), cotation: num(r.cotation) ?? 0,
      })),
      estimatedCost: num(l.estimatedCost), resources: opt(l.resources), indicator: opt(l.indicator),
    }));
  return { takenOn: str(s.takenOn), takenBy: opt(s.takenBy), duerpVersion: str(s.duerpVersion), cseConsultedOn: str(s.cseConsultedOn), lines };
}

/** Lignes du programme (commun à tous les sites) dans le périmètre de la personne et le site sélectionné. */
export function programLinesInScope<L extends { siteId: string | null }>(lines: L[], allowed: string[] | null, site: string | null): L[] {
  return lines.filter((l) => inPerimeter(allowed, l.siteId) && inSite(site, l.siteId));
}

/** Lignes du programme en préparation (ou état actuel des lignes), tous sites, par échéance. */
function programRecords(rows: ProgramActionRow[], s: ProgramSources): ProgramLineRecord[] {
  const byAction = new Map(s.actions.map((a) => [a.id, a]));
  const risks = inForceRisksByAction(s);
  return rows.flatMap((row): ProgramLineRecord[] => {
    const a = byAction.get(row.actionId);
    if (!a) return [];
    return [{
      actionId: a.id, title: actionLabel(a.detail), siteId: a.siteId, site: a.siteId ? s.siteLabel.get(a.siteId) ?? a.siteId : 'Tous les sites',
      pilot: s.personName(a.pilotId), dueOn: a.dueOn, status: actionState(a, s.now).status, risks: risks.get(a.id) ?? [],
      estimatedCost: row.estimatedCost ?? null, resources: row.resources || null, indicator: row.indicator || null,
    }];
  }).sort((a, b) => byDue({ dueOn: a.dueOn, id: a.actionId }, { dueOn: b.dueOn, id: b.actionId }));
}

/** Instantané du programme de l'année (toutes lignes, tous sites), figé à l'arrêt après consultation du CSE. */
export async function buildProgramSnapshot(tx: Tx, year: number, takenBy: string | null, cseConsultedOn?: string): Promise<ProgramSnapshot> {
  const [program] = await tx.select().from(t.preventionPrograms).where(eq(t.preventionPrograms.year, year));
  const rows = await tx.select().from(t.preventionProgramActions).where(eq(t.preventionProgramActions.year, year));
  const sources = await loadProgramSources(tx);
  return {
    takenOn: today(), takenBy, duerpVersion: program?.duerpVersion ?? '',
    cseConsultedOn: cseConsultedOn ?? program?.cseConsultedOn ?? '', lines: programRecords(rows, sources),
  };
}

export type ProgramLineView = {
  actionId: string;
  title: string;
  siteId: string | null;
  site: string;
  /** Pilote de l'action ('' pour le Salarié). */
  pilot: string;
  dueOn: string;
  /** État actuel de l'action. */
  status: string;
  tone: Tone;
  late: boolean;
  done: boolean;
  cancelled: boolean;
  risks: { id: number | null; unitId: string | null; label: string; cotation: number }[];
  estimatedCost: number | null;
  resources: string | null;
  indicator: string | null;
  /** Programme arrêté : statut de l'action à la date d'arrêt (instantané) ; null en préparation. */
  frozenStatus: string | null;
};

/**
 * Programme annuel de prévention de l'année (DUE-02), consultable par tous les rôles ; saisie réservée à l'animateur QHSE
 * et à la direction. En préparation, lignes lues dans le plan d'actions ; arrêté, lignes de l'instantané avec l'état actuel
 * de chaque action. Lignes du site sélectionné (dans le périmètre) ; `hiddenCount` = lignes d'autres sites.
 */
export const loadPreventionProgram = cache(async (year: number) => {
  const [base, session, db] = await Promise.all([loadRiskBase(), getSession(), getDb()]);
  const { role, allowedSiteIds: allowed } = session;
  const edit = canEdit(role, 'risks');
  const approver = edit && canApprove(role);
  const employee = isEmployee(role);
  const thisYear = yearOf(base.now);
  const [programs, rows, history] = await Promise.all([
    db.select().from(t.preventionPrograms),
    db.select().from(t.preventionProgramActions).where(eq(t.preventionProgramActions.year, year)),
    edit ? loadChangeLog('prevention_program', String(year)) : Promise.resolve([] as ChangeEntry[]),
  ]);
  const sources: ProgramSources = {
    actions: base.actions, links: base.links, risks: base.allRisks, units: base.allUnits, siteLabel: base.siteLabel,
    personName: (id) => base.people.get(id)?.name ?? '', now: base.now,
  };
  const linked = riskLinkedActionIds(sources);
  const row = programs.find((p) => p.year === year) ?? null;
  const snapshot = row?.frozenAt ? parseProgramSnapshot(row.snapshot) : null;
  const actionById = new Map(base.actions.map((a) => [a.id, a]));
  const records = snapshot ? snapshot.lines : programRecords(rows, sources);
  const lines = records.map((r): ProgramLineView => {
    const a = actionById.get(r.actionId);
    const state = a ? actionState(a, base.now) : { status: r.status, tone: 'neutral' as Tone, late: false, done: false, cancelled: false };
    return {
      actionId: r.actionId, title: r.title, siteId: r.siteId, site: r.site, pilot: employee ? '' : r.pilot, dueOn: r.dueOn, ...state,
      risks: r.risks.map((k) => ({ id: k.id ?? null, unitId: k.unitId ?? null, label: `${k.unit} · ${k.hazard}`, cotation: k.cotation })),
      estimatedCost: r.estimatedCost, resources: r.resources, indicator: r.indicator, frozenStatus: snapshot ? r.status : null,
    };
  });
  const visible = programLinesInScope(lines, allowed, base.site);
  const name = (id: string | null) => (id ? base.people.get(id)?.name ?? '' : '');
  const state: ProgramState | null = row ? (row.frozenAt ? 'frozen' : 'draft') : null;
  const inScope = (siteId: string | null) => inPerimeter(allowed, siteId) && inSite(base.site, siteId);
  const candidateRows = approver && state === 'draft'
    ? programCandidateIds(base.actions, linked, new Set(rows.map((r) => r.actionId)), year).map((id) => actionById.get(id)!).filter((a) => inScope(a.siteId))
    : [];
  return {
    year,
    thisYear,
    years: [...new Set([...programs.map((p) => p.year), thisYear, ...(approver ? [thisYear + 1] : [])])].sort((a, b) => a - b),
    program: row && state ? {
      state, duerpVersion: row.duerpVersion, comment: row.comment, cseConsultedOn: row.cseConsultedOn,
      frozenOn: row.frozenAt ? dayOf(row.frozenAt) : null, frozenBy: name(row.frozenById), createdBy: name(row.createdById),
    } : null,
    lines: visible,
    totals: programTotals(visible),
    hiddenCount: lines.length - visible.length,
    candidates: candidateRows.map((a) => [a.id, clip(`${a.id} · ${actionLabel(a.detail)}`)] as Option),
    /**
     * Coût estimé de chaque action proposée (DUE-02, spec § 11) : la ligne ajoutée le propose, modifiable ; le coût de la
     * ligne reste figé avec le programme. Le plan d'actions saisit un montant TTC, le programme un montant HT (point ouvert).
     */
    candidateCosts: Object.fromEntries(candidateRows.filter((a) => a.estimatedCost != null).map((a) => [a.id, a.estimatedCost as number])) as Record<string, number>,
    prefillCount: approver && !row ? programDefaultIds(base.actions, linked, year).length : 0,
    /** Création possible : approbateur, pas encore de programme, année N-1 à N+1, version du DUERP en vigueur. */
    creatable: approver && !row && year >= thisYear - 1 && year <= thisYear + 1 && !!base.current,
    currentVersion: base.current?.version ?? null,
    history,
  };
});
export type PreventionProgramData = Awaited<ReturnType<typeof loadPreventionProgram>>;

// ─── CSV ─────────────────────────────────────────────────────────────────────

const CSV_HEADERS = ['Unité', 'Danger', 'Situation dangereuse', 'G', 'P', 'Cotation brute', 'Niveau', 'Mesures existantes', 'G résiduelle', 'P résiduelle', 'Risque résiduel', 'Actions'];

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
  return toCsv(lines);
}

/** Fragment de nom de fichier des exports du DUERP (points gardés : numéros de version). */
export const fileSlug = (s: string) => slug(s, 'duerp', { dots: true });

// ─── Échéances du domaine (tableau de bord, À faire, notifications, badge) ──

/**
 * Échéances des unités de travail (TDB-01) : risques ≥ 8 sans action ou au résiduel encore ≥ 8 (regroupés par unité),
 * résiduels à recoter (un par risque). Destinataires : le responsable QHSE du site de l'unité (`recipientsFor`, poste vacant :
 * animateurs QHSE, « Responsable QHSE à désigner » ; unité commune à tous les sites : responsables des sites actifs).
 */
export function unitRiskTodos(
  units: Pick<WorkUnitView, 'id' | 'label' | 'siteId'>[],
  risks: Pick<RiskView, 'id' | 'unitId' | 'hazard' | 'flag'>[],
  recipientsFor: (siteId: string | null) => Recipients,
  now: string,
): TodoItem[] {
  const todo: TodoItem[] = [];
  const groups: [RiskFlag, string][] = [['toDefine', `≥ ${RISK_ACTION_THRESHOLD} sans action de réduction`], ['residualHigh', `au résiduel encore ≥ ${RISK_ACTION_THRESHOLD}`]];
  for (const u of units) {
    const ur = risks.filter((r) => r.unitId === u.id);
    if (!ur.some((r) => r.flag)) continue;
    const { who, ownerIds } = recipientsFor(u.siteId);
    const base = { kind: RISK_TODO_KIND, who, ownerIds, siteId: u.siteId, date: now };
    for (const [flag, label] of groups) {
      const hit = ur.filter((r) => r.flag === flag);
      if (!hit.length) continue;
      todo.push({
        ...base, tone: 'danger', overdue: true, count: hit.length,
        title: `${u.label} · ${hit.length} risque${hit.length > 1 ? 's' : ''} ${label}`,
        href: hit.length === 1 ? `/risques?risque=${hit[0].id}` : `/risques?unite=${encodeURIComponent(u.id)}`,
      });
    }
    for (const r of ur.filter((r) => r.flag === 'toReview')) {
      todo.push({ ...base, tone: 'warn', title: `${u.label} · ${r.hazard} — résiduel à recoter (actions vérifiées)`, href: `/risques?risque=${r.id}` });
    }
  }
  return todo;
}

/** Demandes d'accès au DUERP en attente (ni communiquées ni annulées) : échéances de l'animateur QHSE et de la direction. */
async function pendingAccessRequests() {
  const db = await getDb();
  return db.select({
    id: t.duerpAccessRequests.id, requestedOn: t.duerpAccessRequests.requestedOn, requesterKind: t.duerpAccessRequests.requesterKind,
    siteId: t.duerpAccessRequests.siteId, createdById: t.duerpAccessRequests.createdById,
  }).from(t.duerpAccessRequests).where(and(isNull(t.duerpAccessRequests.cancelledAt), isNull(t.duerpAccessRequests.communicatedOn)));
}

/**
 * Échéances du DUERP (kind RISK_TODO_KIND), sur tout le périmètre (TDB-05) :
 * - document unique (siteId null ; validateur de la version et responsables QHSE des sites actifs) : version en vigueur
 *   absente, mise à jour annuelle (sous 15 jours ou dépassée), consultation du CSE, PAPRIPACT de l'année (consultation du
 *   CSE à renseigner, ou programme à établir quand l'année précédente en avait un) ;
 * - unités de travail (siteId de l'unité ; responsable QHSE de son site, TDB-01) : voir unitRiskTodos ;
 * - demandes d'accès en attente (animateur QHSE et direction seulement ; responsable du site et auteur de la saisie),
 *   sans le nom du demandeur.
 * Rôles en consultation (chef de projet, salarié) : leurs propres échéances seulement (isMine).
 */
export const loadRiskSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const { role, user, allowedSiteIds: allowed } = await getSession();
  const approver = canApprove(role);
  const db = await getDb();
  const [{ now, people, current, units, risks }, leads, programs, requests] = await Promise.all([
    loadRiskBase('perimeter'),
    loadQhseLeads(),
    db.select({ year: t.preventionPrograms.year, frozenAt: t.preventionPrograms.frozenAt }).from(t.preventionPrograms),
    approver ? pendingAccessRequests() : Promise.resolve([]),
  ]);
  // Document unique commun aux sites : son validateur, et les responsables QHSE des sites.
  const lead = leads.forSite(null);
  const validator = current?.validatedById ? people.get(current.validatedById) : undefined;
  const base = { kind: RISK_TODO_KIND, who: validator?.name ?? lead.who, ownerIds: [...new Set([...(validator ? [validator.id] : []), ...lead.ownerIds])], siteId: null };
  const todo: TodoItem[] = [];

  if (!current) {
    todo.push({ ...base, date: now, tone: 'danger', title: 'Aucune version du DUERP en vigueur', href: '/risques', overdue: true });
  } else {
    if (current.nextUpdateOn < now) {
      todo.push({ ...base, date: now, dueOn: current.nextUpdateOn, tone: 'danger', title: `Mise à jour annuelle du DUERP dépassée depuis le ${fmtDayMonth(current.nextUpdateOn)}`, href: '/risques', overdue: true });
    } else if (daysBetween(now, current.nextUpdateOn) <= TODO_HORIZON_DAYS) {
      todo.push({ ...base, date: current.nextUpdateOn, dueOn: current.nextUpdateOn, tone: 'warn', title: `Mise à jour annuelle du DUERP (version ${current.version})`, href: '/risques' });
    }
    if (!current.cseConsultedOn) {
      todo.push({ ...base, date: now, tone: 'warn', title: `Consultation du CSE à renseigner · DUERP ${current.version}`, href: '/risques' });
    }
    // DUE-03 : chaque mise à jour est transmise au service de prévention et de santé au travail (R. 4121-4).
    if (!current.spstSentOn) {
      todo.push({ ...base, date: now, tone: 'warn', title: `Transmission au SPST à renseigner · DUERP ${current.version}`, href: '/risques', key: `duerp|${current.version}|spst` });
    }
  }

  // PAPRIPACT : pas d'alerte « à établir » sans programme l'année précédente (entreprises de moins de 50 salariés).
  const year = yearOf(now);
  const program = programs.find((p) => p.year === year);
  if (program && !program.frozenAt) {
    todo.push({ ...base, date: now, tone: 'warn', title: `${PROGRAM_SHORT} ${year} : consultation du CSE à renseigner`, href: `/risques?programme=${year}`, key: `papripact|${year}|cse` });
  } else if (!program && programs.some((p) => p.year === year - 1)) {
    todo.push({ ...base, date: now, tone: 'warn', title: `${PROGRAM_SHORT} ${year} à établir`, href: `/risques?programme=${year}`, key: `papripact|${year}|missing` });
  }

  todo.push(...unitRiskTodos(units, risks, leads.forSite, now));

  for (const r of requests.filter((x) => inPerimeter(allowed, x.siteId))) {
    const site = leads.forSite(r.siteId);
    const author = r.createdById ? people.get(r.createdById) : undefined;
    const extra = author && !site.ownerIds.includes(author.id) ? author : undefined;
    todo.push({
      kind: RISK_TODO_KIND, siteId: r.siteId, date: r.requestedOn, tone: 'warn',
      who: extra ? `${site.who} · ${extra.name}` : site.who, ownerIds: [...site.ownerIds, ...(extra ? [extra.id] : [])],
      title: `Demande d'accès au DUERP à traiter · ${DUERP_REQUESTERS[r.requesterKind as DuerpRequester] ?? r.requesterKind}`,
      href: '/risques?registre=1', key: `duerp-access|${r.id}`,
    });
  }

  const visible = canEdit(role, 'risks') ? todo : todo.filter((i) => isMine(i, user));
  return { badge: visible.reduce((n, i) => n + (i.count ?? 1), 0), todo: visible };
});
