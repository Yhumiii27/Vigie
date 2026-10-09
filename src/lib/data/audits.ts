import 'server-only';
import { asc } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { addDays, addMonths, fmtDate, today, yearOf } from '../dates';
import { EVENT_STEPS, ORIGINS, REQUIREMENT_EVAL, ROLES, columnOf, type Tone } from '../domain';
import { actionColumn, isOpen, loadActions, loadEvents, loadPeople, type ActionRow, type Person } from '../queries';
import { getSession } from '../session';
import { TF1_TARGET, loadDashboard } from './dashboard';
import { loadSkillMatrix, type SkillAlert } from './skills';

// ─── Audits et certifications ───────────────────────────────────────────────

export type Certification = typeof t.certifications.$inferSelect;
export type ReviewItem = typeof t.reviewItems.$inferSelect;

/** Action du plan d'actions rattachée à un élément d'audit (statut calculé). */
export type ActionBrief = { id: string; title: string; status: string; tone: Tone; pilot: string; dueOn: string; closedOn: string | null; efficacyNote: string | null };

export type PlanItemView = {
  id: number; year: number; track: string; month: number; label: string;
  plannedOn: string | null; detail: string | null; ownerId: string | null; owner: string;
  done: boolean; actionId: string | null; action: ActionBrief | null;
};

export type FindingView = { id: number; audit: string; kind: string; text: string; sort: number; actionId: string | null; action: ActionBrief | null };
export type AuditGroup = { label: string; findings: FindingView[] };

/** Libellé proposé pour un nouveau constat quand aucun audit n'est encore saisi. */
export const DEFAULT_AUDIT = 'Audit interne production · juin 2026';

function actionBrief(a: ActionRow | undefined, people: Map<string, Person>, now: string): ActionBrief | null {
  if (!a) return null;
  const c = columnOf(actionColumn(a, now));
  return { id: a.id, title: a.title, status: c.status, tone: c.tone, pilot: people.get(a.pilotId)?.name ?? '—', dueOn: a.dueOn, closedOn: a.closedOn, efficacyNote: a.efficacyNote };
}

async function readAudits() {
  const db = await getDb();
  const [certs, plan, findings, review, actions, people] = await Promise.all([
    db.select().from(t.certifications).orderBy(asc(t.certifications.sort), asc(t.certifications.id)),
    db.select().from(t.auditPlanItems).orderBy(asc(t.auditPlanItems.id)),
    db.select().from(t.auditFindings).orderBy(asc(t.auditFindings.sort), asc(t.auditFindings.id)),
    db.select().from(t.reviewItems).orderBy(asc(t.reviewItems.sort), asc(t.reviewItems.id)),
    // Toutes les actions (sans filtre de site) : un constat ou une échéance garde son action liée quel que soit le site affiché.
    db.select().from(t.actions),
    loadPeople(),
  ]);
  const now = today();
  const actionsById = new Map(actions.map((a) => [a.id, a]));
  const brief = (id: string | null) => (id ? actionBrief(actionsById.get(id), people, now) : null);

  const planViews: PlanItemView[] = plan.map((p) => ({
    id: p.id, year: p.year, track: p.track, month: p.month, label: p.label, plannedOn: p.plannedOn, detail: p.detail,
    ownerId: p.ownerId, owner: p.ownerId ? people.get(p.ownerId)?.name ?? '' : '', done: p.done, actionId: p.actionId, action: brief(p.actionId),
  }));

  // Constats regroupés par audit ; le dernier audit est celui dont le premier constat a été saisi le plus récemment.
  const groups = new Map<string, FindingView[]>();
  findings.forEach((f) => {
    const list = groups.get(f.audit) ?? [];
    list.push({ id: f.id, audit: f.audit, kind: f.kind, text: f.text, sort: f.sort, actionId: f.actionId, action: brief(f.actionId) });
    groups.set(f.audit, list);
  });
  const auditGroups: AuditGroup[] = [...groups.entries()]
    .map(([label, list]) => ({ label, findings: list }))
    .sort((a, b) => Math.min(...b.findings.map((f) => f.id)) - Math.min(...a.findings.map((f) => f.id)));

  // Revue en préparation : la prochaine à venir, sinon la dernière tenue.
  const dates = [...new Set(review.map((r) => r.reviewOn))].sort();
  const reviewOn = dates.find((d) => d >= now) ?? dates.at(-1) ?? null;

  return { now, people, certs, plan: planViews, auditGroups, review: { reviewOn, items: review.filter((r) => r.reviewOn === reviewOn) }, actionsById };
}

/** Lignes du programme dans l'ordre de leur première apparition. */
const tracksOf = (items: { track: string }[]) => [...new Set(items.map((p) => p.track))];

/** Écran « Audits et certifications ». `year` vient du paramètre ?annee=. */
export async function loadAudits({ year: askedYear }: { year?: string | string[] }) {
  const { now, certs, plan, auditGroups, review } = await readAudits();
  const nowYear = yearOf(now);
  const years = [...new Set(plan.map((p) => p.year))];
  const asked = typeof askedYear === 'string' && /^\d{4}$/.test(askedYear) && +askedYear >= 2000 && +askedYear <= 2100 ? +askedYear : null;
  const year = asked ?? (years.includes(nowYear) || !years.length ? nowYear : Math.max(...years));
  const yearOptions = [...new Set([...years, nowYear, nowYear + 1, year])].sort((a, b) => a - b);

  // Lignes affichées : celles de l'année précédente (programme reconduit) puis celles propres à l'année.
  const prevYears = years.filter((y) => y < year);
  const refYear = prevYears.length ? Math.max(...prevYears) : null;
  const items = plan.filter((p) => p.year === year);
  const tracks = [...new Set([...(refYear ? tracksOf(plan.filter((p) => p.year === refYear)) : []), ...tracksOf(items)])];

  return {
    now,
    certs,
    year,
    yearOptions,
    tracks,
    allTracks: tracksOf(plan),
    plan: items,
    auditGroups,
    review,
  };
}

// ─── Dossier de revue de direction ──────────────────────────────────────────

const monthStart = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`;
/** Borne de fin de mois pour les comparaisons de chaînes ISO (le « 31 » vaut pour tous les mois). */
const monthEnd = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-31`;

/** État d'un titre au regard de l'affectation (même formulation que les alertes de l'écran Compétences). */
function lapseState(al: SkillAlert): { label: string; tone: Tone } {
  const on = al.expiresOn ? fmtDate(al.expiresOn) : '';
  switch (al.lapse) {
    case 'missing': return { label: 'Requis, jamais suivi', tone: 'danger' };
    case 'expired': return { label: `Expiré depuis le ${on}`, tone: 'danger' };
    case 'before': return { label: `Expire le ${on}, avant l'affectation`, tone: 'danger' };
    case 'during': return { label: `Expire le ${on}, pendant l'affectation`, tone: 'warn' };
  }
}

/** Données consolidées du dossier imprimable de revue de direction (/revue-de-direction). */
export async function loadReviewDossier() {
  const db = await getDb();
  const [audits, siteActions, events, dashboard, skills, session, reqs] = await Promise.all([
    readAudits(),
    loadActions(),
    loadEvents(),
    loadDashboard(),
    loadSkillMatrix(),
    getSession(),
    db.select().from(t.requirements).orderBy(asc(t.requirements.sort)),
  ]);
  const { now, people, certs, plan, auditGroups, review, actionsById } = audits;
  const from = addDays(now, -364);
  const name = (id: string | null | undefined) => (id ? people.get(id)?.name ?? '—' : '—');
  const brief = (a: ActionRow) => actionBrief(a, people, now)!;

  // 1. Actions issues de la revue précédente
  const reviewActions = siteActions
    .filter((a) => a.origin === 'rev')
    .map((a) => ({ ...brief(a), originRef: a.originRef }))
    .sort((a, b) => Number(!!a.closedOn) - Number(!!b.closedOn) || a.dueOn.localeCompare(b.dueOn));

  // 2. Indicateurs sécurité (calculés par le tableau de bord)
  const tfKpi = dashboard.kpis.find((k) => k.label.startsWith('TF1'));
  const daysKpi = dashboard.kpis.find((k) => k.label.startsWith('Jours sans'));
  const safety = {
    tf1: tfKpi?.value ?? '—',
    tg: tfKpi?.sub.replace(/^TG\s*/, '') || '—',
    target: TF1_TARGET,
    daysWithout: daysKpi?.value ?? '—',
    daysNote: daysKpi?.note ?? '',
    pyramid: dashboard.pyramid,
  };

  // 3. Audits et certifications
  // Programme : échéances de la période examinée (12 mois glissants jusqu'à la revue) puis celles à venir
  // jusqu'à la revue suivante (un an après), quelle que soit l'année civile de la revue.
  const progFrom = from;
  const reviewDay = review.reviewOn && review.reviewOn > now ? review.reviewOn : now;
  const progTo = addMonths(reviewDay, 12);
  const trackOrder = tracksOf(plan);
  const programme = plan
    .filter((p) => (p.plannedOn
      ? p.plannedOn >= progFrom && p.plannedOn <= progTo
      : monthEnd(p.year, p.month) >= progFrom && monthStart(p.year, p.month) <= progTo))
    .map((p) => {
      const state: { label: string; tone: Tone } = p.done
        ? { label: 'Réalisé', tone: 'ok' }
        : (p.plannedOn ?? monthEnd(p.year, p.month)) < now ? { label: 'À confirmer', tone: 'warn' } : { label: 'À venir', tone: 'neutral' };
      return { ...p, state };
    })
    .sort((a, b) => a.year - b.year || a.month - b.month || trackOrder.indexOf(a.track) - trackOrder.indexOf(b.track));
  const programmeCounts = {
    done: programme.filter((p) => p.state.tone === 'ok').length,
    pending: programme.filter((p) => p.state.tone === 'warn').length,
    upcoming: programme.filter((p) => p.state.tone === 'neutral').length,
  };

  // 4. Réclamations clients (12 mois glissants)
  const allActions = [...actionsById.values()];
  const complaints = events
    .filter((e) => e.type === 'RC' && e.occurredOn >= from)
    .map((e) => ({
      id: e.id, occurredOn: e.occurredOn, title: e.title, project: e.keystoneProject, step: EVENT_STEPS[e.step], open: isOpen(e), pilot: name(e.pilotId),
      actions: allActions.filter((a) => a.eventId === e.id).map(brief),
    }));

  // 5. Plan d'actions par origine
  const cols = siteActions.map((a) => ({ a, col: actionColumn(a, now) }));
  const byOrigin = Object.entries(ORIGINS)
    .map(([key, o]) => {
      const list = cols.filter((x) => x.a.origin === key);
      return {
        key,
        label: o.label,
        open: list.filter((x) => x.col !== 'done').length,
        late: list.filter((x) => x.col === 'late').length,
        verify: list.filter((x) => x.col === 'verify').length,
        closed: list.filter((x) => x.col === 'done' && (x.a.closedOn ?? x.a.dueOn) >= from).length,
      };
    })
    .filter((r) => r.open + r.closed > 0);
  const totals = byOrigin.reduce((s, r) => ({ open: s.open + r.open, late: s.late + r.late, verify: s.verify + r.verify, closed: s.closed + r.closed }), { open: 0, late: 0, verify: 0, closed: 0 });
  const lateActions = cols
    .filter((x) => x.col === 'late')
    .map((x) => ({ ...brief(x.a), origin: ORIGINS[x.a.origin]?.label ?? x.a.origin, originRef: x.a.originRef }))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  // 6. Veille réglementaire
  const requirements = reqs.map((r) => {
    const ev = REQUIREMENT_EVAL[r.evaluation] ?? { label: r.evaluation, tone: 'neutral' as Tone };
    const a = r.actionId ? actionsById.get(r.actionId) : undefined;
    return {
      id: r.id, text: r.text, domain: r.domain, evalLabel: ev.label, evalNote: r.evaluationNote, tone: ev.tone,
      dueOn: r.dueOn, dueNote: r.dueNote, pilot: name(r.pilotId), action: a ? brief(a) : null,
    };
  });
  const requirementCounts = Object.entries(REQUIREMENT_EVAL).map(([key, ev]) => ({ key, label: ev.label, tone: ev.tone, n: reqs.filter((r) => r.evaluation === key).length }));

  // 7. Ressources et compétences
  const cells = skills.rows.flatMap((r) => r.cells);
  const skillCounts = {
    people: skills.rows.length,
    expired: cells.filter((c) => c.state === 'x').length,
    soon: cells.filter((c) => c.state === 's').length,
    never: cells.filter((c) => c.state === 'r').length,
  };
  const skillAlerts = skills.alerts.map((al) => ({
    person: al.person.name,
    title: al.title,
    state: lapseState(al),
    assignment: `${al.assignment.project} · ${al.assignment.activity}`,
    startOn: al.assignment.startOn,
    endOn: al.assignment.endOn,
  }));

  const lead = people.get(ROLES['Animateur QHSE'].personId);
  const director = people.get(ROLES.Direction.personId);

  return {
    header: {
      reviewOn: review.reviewOn,
      from,
      to: now,
      site: session.site.label,
      lead: lead ? `${lead.name} — ${lead.job}` : '—',
      director: director ? `${director.name} — ${director.job}` : '—',
      author: session.user.name,
    },
    reviewActions,
    safety,
    certs,
    progFrom,
    progTo,
    programme,
    programmeCounts,
    auditGroups,
    complaints,
    byOrigin,
    totals,
    lateActions,
    requirements,
    requirementCounts,
    skillCounts,
    skillAlerts,
    checklist: review.items,
  };
}
export type ReviewDossier = Awaited<ReturnType<typeof loadReviewDossier>>;
