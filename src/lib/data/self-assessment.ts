import 'server-only';
import { asc, eq, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { canSee, canEdit } from '../domain';
import { parisDay, toParisLocal } from '../dates';
import { hasLeft } from '../people';
import { actionBrief, loadAllActions, loadPeople, loadSiteRows, type ActionBrief } from '../queries';
import {
  ASSESSMENT_STANDARDS, ASSESSMENT_STATUSES, CONFORMITY_LEVELS, assessmentStatus, compareClauses, previousAssessment, rateDelta, synthesize,
  type AssessmentStandard, type ConformityLevel, type Synthesis,
} from '../rules/self-assessment';
import { currentSiteId, getSession } from '../session';
import { today } from '@/lib/today';
import { entityVersions } from '@/server/versions';
import type { AttachmentItem } from '../attachments';
import { auditVisible } from './audits';
import { loadEntityFiles } from './entity-files';
import { shortSiteLabel } from './todo';

// Auto-évaluation par référentiel (AUD-40) : vue « Auto-évaluation » de l'écran Audits (?vue=auto-evaluation&campagne=),
// fiche imprimable, synthèse du dossier de la revue de direction et carte du tableau de bord. Lecteurs de l'écran Audits ;
// campagnes du site sélectionné et du périmètre (campagnes d'entreprise sur tous les sites, auditVisible, comme le programme).
// Synthèse et comparaison avec la campagne précédente calculées à l'affichage (src/lib/rules/self-assessment.ts).

type AssessmentRow = typeof t.selfAssessments.$inferSelect;
type LineRow = typeof t.selfAssessmentLines.$inferSelect;

export type AssessmentLineView = {
  id: number; version: string; requirementId: number; clause: string; heading: string; main: boolean;
  level: ConformityLevel | null; levelLabel: string; levelTone: string;
  justification: string; finding: string; assessedBy: string | null; assessedAt: string | null;
  files: AttachmentItem[];
  /** Actions QSE de la ligne : décrites si la personne lit l'action (plan de son périmètre), sinon numéro seul. */
  actions: { id: string; action: ActionBrief | null }[];
  /** Niveau de la même exigence dans la campagne précédente. */
  previousLevel: ConformityLevel | null;
};

export type AssessmentSummary = {
  id: string; version: string; standard: AssessmentStandard; standardLabel: string; siteId: string | null; site: string;
  assessedOn: string; assessorId: string; assessor: string; scope: string; conclusion: string;
  status: keyof typeof ASSESSMENT_STATUSES; statusLabel: string; statusTone: string;
  synthesis: Synthesis;
  previous: { id: string; assessedOn: string; rate: number | null; clauses: Record<string, number | null> } | null;
  delta: number | null;
  closedOn: string | null; closedBy: string | null;
  cancelled: { on: string; by: string; reason: string } | null;
};

export type AssessmentDetail = AssessmentSummary & {
  lines: AssessmentLineView[];
  comments: { id: number; at: string; by: string; body: string }[];
};

async function readAll() {
  const db = await getDb();
  const [assessments, sites, people] = await Promise.all([
    db.select().from(t.selfAssessments).orderBy(asc(t.selfAssessments.assessedOn)),
    loadSiteRows(),
    loadPeople(),
  ]);
  return { db, assessments, sites, people };
}

async function linesOf(db: Awaited<ReturnType<typeof getDb>>, ids: string[]): Promise<Map<string, LineRow[]>> {
  const out = new Map<string, LineRow[]>();
  if (!ids.length) return out;
  const rows = await db.select().from(t.selfAssessmentLines).where(inArray(t.selfAssessmentLines.assessmentId, ids));
  rows.forEach((l) => out.set(l.assessmentId, [...(out.get(l.assessmentId) ?? []), l]));
  out.forEach((list) => list.sort((a, b) => compareClauses(a.clause, b.clause) || a.sort - b.sort));
  return out;
}

function summaryOf(a: AssessmentRow, all: AssessmentRow[], lines: Map<string, LineRow[]>, ctx: { siteName: (id: string | null) => string; name: (id: string | null) => string; version: string }): AssessmentSummary {
  const synthesis = synthesize(lines.get(a.id) ?? []);
  const prev = previousAssessment(all, a);
  const prevSynthesis = prev ? synthesize(lines.get(prev.id) ?? []) : null;
  const status = assessmentStatus(a);
  return {
    id: a.id, version: ctx.version, standard: a.standard as AssessmentStandard, standardLabel: ASSESSMENT_STANDARDS[a.standard as AssessmentStandard]?.short ?? a.standard,
    siteId: a.siteId, site: ctx.siteName(a.siteId), assessedOn: a.assessedOn, assessorId: a.assessorId, assessor: ctx.name(a.assessorId),
    scope: a.scope, conclusion: a.conclusion, status, statusLabel: ASSESSMENT_STATUSES[status].label, statusTone: ASSESSMENT_STATUSES[status].tone,
    synthesis,
    previous: prev && prevSynthesis ? { id: prev.id, assessedOn: prev.assessedOn, rate: prevSynthesis.overall.rate, clauses: Object.fromEntries(prevSynthesis.clauses.map((c) => [c.clause, c.rate])) } : null,
    delta: rateDelta(synthesis.overall.rate, prevSynthesis?.overall.rate),
    closedOn: a.closedAt ? parisDay(a.closedAt) : null, closedBy: a.closedById ? ctx.name(a.closedById) : null,
    cancelled: a.cancelledAt ? { on: parisDay(a.cancelledAt), by: ctx.name(a.cancelledById), reason: a.cancelReason ?? '' } : null,
  };
}

/** Campagnes visibles (site sélectionné et périmètre), avec leur synthèse ; null si l'écran Audits est fermé au rôle. */
export async function loadSelfAssessments(opts: { open?: string } = {}) {
  const [{ role, allowedSiteIds }, selected] = await Promise.all([getSession(), currentSiteId()]);
  if (!canSee(role, 'audits')) return null;
  const { db, assessments, sites, people } = await readAll();
  const visible = auditVisible(selected, allowedSiteIds);
  const shown = assessments.filter((a) => visible(a.siteId));
  const lines = await linesOf(db, assessments.map((a) => a.id));
  const labels = new Map(sites.map((s) => [s.id, shortSiteLabel(s.label)]));
  const siteName = (id: string | null) => (id ? labels.get(id) ?? id : 'Toute l’entreprise');
  const name = (id: string | null) => (id ? people.get(id)?.name ?? id : '');
  const versions = await entityVersions(db, 'self_assessment', shown.map((a) => a.id));
  const summaries = shown.map((a) => summaryOf(a, assessments, lines, { siteName, name, version: versions.get(a.id) ?? '0' }))
    .sort((a, b) => b.assessedOn.localeCompare(a.assessedOn) || b.id.localeCompare(a.id, 'fr', { numeric: true }));

  let detail: AssessmentDetail | null = null;
  const open = opts.open ? shown.find((a) => a.id === opts.open) : undefined;
  if (open) {
    const base = summaries.find((s) => s.id === open.id)!;
    const own = lines.get(open.id) ?? [];
    const prev = base.previous ? lines.get(base.previous.id) ?? [] : [];
    const prevLevel = new Map(prev.map((l) => [l.requirementId, l.level as ConformityLevel | null]));
    const ids = own.map((l) => l.id);
    const [lineVersions, files, links, comments, actions] = await Promise.all([
      entityVersions(db, 'self_assessment_line', ids),
      loadEntityFiles('self_assessment_line', ids),
      ids.length ? db.select().from(t.selfAssessmentLineActions).where(inArray(t.selfAssessmentLineActions.lineId, ids)) : [],
      db.select().from(t.selfAssessmentComments).where(eq(t.selfAssessmentComments.assessmentId, open.id)).orderBy(asc(t.selfAssessmentComments.createdAt)),
      loadAllActions('perimeter'),
    ]);
    const now = today();
    const byId = new Map(actions.map((x) => [x.id, x]));
    detail = {
      ...base,
      lines: own.map((l) => {
        const level = (l.level as ConformityLevel | null) ?? null;
        return {
          id: l.id, version: lineVersions.get(String(l.id)) ?? '0', requirementId: l.requirementId, clause: l.clause, heading: l.heading,
          main: !l.clause.includes('.'), level, levelLabel: level ? CONFORMITY_LEVELS[level].label : 'À évaluer', levelTone: level ? CONFORMITY_LEVELS[level].tone : 'neutral',
          justification: l.justification, finding: l.finding, assessedBy: l.assessedById ? name(l.assessedById) : null,
          assessedAt: l.assessedAt ? toParisLocal(l.assessedAt) : null,
          files: files.get(String(l.id)) ?? [],
          actions: links.filter((x) => x.lineId === l.id).map((x) => ({ id: x.actionId, action: actionBrief(byId.get(x.actionId), people, now) }))
            .sort((x, y) => x.id.localeCompare(y.id, 'fr', { numeric: true })),
          previousLevel: prevLevel.get(l.requirementId) ?? null,
        };
      }),
      comments: comments.map((c) => ({ id: c.id, at: toParisLocal(c.createdAt), by: name(c.authorId), body: c.body })),
    };
  }
  const now = today();
  const assessors = [...people.values()].filter((p) => !hasLeft(p, now)).sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((p) => [p.id, p.name] as const);
  return { summaries, detail, missing: !!opts.open && !open, canEdit: canEdit(role, 'audits'), assessors, now };
}

/** Catalogue des exigences par référentiel (archivées comprises), avec leur version (QUA-12). */
export async function loadAssessmentCatalogue() {
  const { role } = await getSession();
  if (!canSee(role, 'audits')) return null;
  const db = await getDb();
  const rows = await db.select().from(t.assessmentRequirements).orderBy(asc(t.assessmentRequirements.sort), asc(t.assessmentRequirements.id));
  const versions = await entityVersions(db, 'assessment_requirement', rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, version: versions.get(String(r.id)) ?? '0', standard: r.standard as AssessmentStandard, clause: r.clause, heading: r.heading,
    archived: r.archivedAt ? { on: parisDay(r.archivedAt), reason: r.archiveReason ?? '' } : null,
  })).sort((a, b) => a.standard.localeCompare(b.standard) || compareClauses(a.clause, b.clause));
}
export type CatalogueRow = NonNullable<Awaited<ReturnType<typeof loadAssessmentCatalogue>>>[number];

/**
 * Dernière campagne clôturée de chaque référentiel, à la date `asOf` (dossier de la revue de direction, tableau de bord) :
 * campagnes du site `site` (null : « Tous les sites », toutes celles du périmètre) et d'entreprise. Taux global et par
 * article, écart avec la précédente, nombre d'exigences non conformes ou partielles.
 */
export async function latestAssessments(o: { site: string | null; allowed: string[] | null; asOf: string }) {
  const { db, assessments, sites, people } = await readAll();
  const visible = auditVisible(o.site, o.allowed);
  const closed = assessments.filter((a) => visible(a.siteId) && assessmentStatus(a) === 'cloturee' && a.assessedOn <= o.asOf);
  const lines = await linesOf(db, assessments.map((a) => a.id));
  const labels = new Map(sites.map((s) => [s.id, shortSiteLabel(s.label)]));
  const siteName = (id: string | null) => (id ? labels.get(id) ?? id : 'Toute l’entreprise');
  const name = (id: string | null) => (id ? people.get(id)?.name ?? id : '');
  const latest = new Map<string, AssessmentRow>();
  for (const a of closed) {
    const key = `${a.standard}|${a.siteId ?? ''}`;
    const cur = latest.get(key);
    if (!cur || a.assessedOn > cur.assessedOn || (a.assessedOn === cur.assessedOn && a.createdAt > cur.createdAt)) latest.set(key, a);
  }
  return [...latest.values()].map((a) => {
    const s = summaryOf(a, assessments, lines, { siteName, name, version: '0' });
    return {
      id: s.id, standard: s.standardLabel, site: s.site, assessedOn: s.assessedOn, rate: s.synthesis.overall.rate, delta: s.delta,
      previousOn: s.previous?.assessedOn ?? null,
      gaps: s.synthesis.overall.counts.non_conforme + s.synthesis.overall.counts.partiel,
      clauses: s.synthesis.clauses.map((c) => ({ clause: c.clause, heading: c.heading, rate: c.rate, previous: s.previous?.clauses[c.clause] ?? null })),
    };
  }).sort((x, y) => x.standard.localeCompare(y.standard) || x.site.localeCompare(y.site, 'fr'));
}
