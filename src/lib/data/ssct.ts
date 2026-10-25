import 'server-only';
import { and, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { computeActionStats } from '../action-stats';
import { actionLabel } from '../action-rules';
import { fmtDate, toParisLocal } from '../dates';
import { PROGRAM_SHORT, canSeeHealth, isBlockingControlResult } from '../domain';
import { elapsedMonths } from '../objective-values';
import { loadAllActions, loadControls, loadEvents, loadPeople, safetyRates, workforceAccident } from '../queries';
import { ALL_SITES, getSession, inSite } from '../session';
import { today } from '@/lib/today';
import { statsInput } from './action-stats';

// ─── Bilan annuel santé, sécurité et conditions de travail (CNF-03) ─────────
// Rapport annuel présenté au CSE (art. L. 2312-27 du code du travail, 1°) : bilan de la situation générale de la santé, de
// la sécurité et des conditions de travail et des actions menées pendant l'année écoulée, avec le programme annuel de
// prévention (2°, PAPRIPACT). Calculé à la demande d'après les données de Vigie, jamais stocké ; site sélectionné (« Tous
// les sites » : consolidé). Accidentologie et maladies professionnelles : animateur QHSE et direction seulement.

/** Domaines d'action relevant de la santé, de la sécurité et des conditions de travail. */
const SSCT_DOMAINS = new Set(['securite', 'sante']);
const fr = (n: number, digits: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (n: number | null) => (n == null ? '—' : `${fr(n * 100, 0)} %`);

export async function loadSsctReport(rawYear: string | undefined) {
  const { role, site } = await getSession();
  if (!canSeeHealth(role)) return null;
  const now = today();
  const currentYear = +now.slice(0, 4);
  const asked = rawYear && /^\d{4}$/.test(rawYear) ? +rawYear : null;
  // Par défaut l'année écoulée : le bilan porte sur l'année précédant sa présentation.
  const year = asked && asked >= 2000 && asked <= currentYear ? asked : currentYear - 1;
  const inYear = (d: string | null | undefined) => !!d && d.startsWith(`${year}-`) && d <= now;
  const siteId = site.id === ALL_SITES ? null : site.id;
  const db = await getDb();
  const [events, allActions, controls, hours, siteRows, versions, programs, plans, quals, titles, people] = await Promise.all([
    loadEvents('site'), loadAllActions('site'), loadControls('site'),
    db.select().from(t.hoursWorked),
    db.select({ id: t.sites.id, label: t.sites.label, archivedAt: t.sites.archivedAt }).from(t.sites),
    db.select().from(t.duerpVersions),
    db.select().from(t.preventionPrograms),
    db.select({ id: t.preventionPlans.id, siteId: t.preventionPlans.siteId, startOn: t.preventionPlans.startOn, status: t.preventionPlans.status }).from(t.preventionPlans),
    db.select({ personId: t.qualifications.personId, titleId: t.qualifications.titleId, obtainedOn: t.qualifications.obtainedOn }).from(t.qualifications).where(isNull(t.qualifications.cancelledAt)),
    db.select({ id: t.trainingTitles.id, label: t.trainingTitles.label }).from(t.trainingTitles),
    loadPeople(),
  ]);

  // 1. Accidents du travail, de trajet et maladies professionnelles de l'année (événements non classés sans suite).
  const yearEvents = events.filter((e) => inYear(e.occurredOn));
  const workforce = yearEvents.filter((e) => workforceAccident(e));
  const sites = siteRows.filter((s) => inSite(siteId, s.id)).map((s) => ({ id: s.id, archivedOn: s.archivedAt ? toParisLocal(s.archivedAt).slice(0, 10) : null }));
  const months = elapsedMonths(year, now);
  const rates = months.length ? safetyRates({ months, sites, hours: hours.filter((h) => inSite(siteId, h.siteId)), events }) : null;
  const accidents = {
    arret: workforce.filter((e) => e.injury === 'arret').length,
    sansArret: workforce.filter((e) => e.injury === 'sans_arret' || !e.injury).length,
    soins: workforce.filter((e) => e.injury === 'soins').length,
    lostDays: workforce.filter((e) => e.injury === 'arret').reduce((n, e) => n + (e.lostDays ?? 0), 0),
    commute: yearEvents.filter((e) => e.type === 'AT' && e.commute).length,
    temporary: yearEvents.filter((e) => e.type === 'AT' && !e.commute && e.victimKind === 'interimaire').length,
    external: yearEvents.filter((e) => e.type === 'AT' && !e.commute && e.victimKind === 'externe').length,
    occupationalDiseases: yearEvents.filter((e) => e.type === 'MP').length,
    nearMisses: yearEvents.filter((e) => e.type === 'PA').length,
    dangerous: yearEvents.filter((e) => e.type === 'SD').length,
    tf1: rates?.tf1 == null ? '—' : fr(rates.tf1, 1),
    tg: rates?.tg == null ? '—' : fr(rates.tg, 2),
    hours: rates?.hours ?? 0,
    missingMonths: rates ? new Set(rates.missing.map((m) => m.month)).size : 0,
  };

  // 2. Actions SSCT (domaines Sécurité et Santé) : statistiques du plan d'actions (ACT-29) à la fin de l'année.
  const ssctActions = allActions.filter((a) => a.domain && SSCT_DOMAINS.has(a.domain));
  const month = year === currentYear ? now.slice(0, 7) : `${year}-12`;
  const stats = computeActionStats({ ...(await statsInput(ssctActions)), month, today: now, pilotNames: new Map([...people.values()].map((p) => [p.id, p.name])) });
  const yearMonths = stats.evolution.filter((m) => m.month.startsWith(`${year}-`));
  const verified = ssctActions.filter((a) => a.status === 'verifiee' && inYear(a.closedOn));
  const actions = {
    opened: yearMonths.reduce((n, m) => n + m.opened, 0),
    closed: yearMonths.reduce((n, m) => n + m.closed, 0),
    abandoned: yearMonths.reduce((n, m) => n + m.abandoned, 0),
    openAtEnd: stats.open, lateAtEnd: stats.late, lateRate: pct(stats.lateRate),
    efficacy: verified.length ? pct(verified.filter((a) => a.effective).length / verified.length) : '—',
    asOf: stats.asOf,
    done: verified.sort((a, b) => (a.closedOn ?? '').localeCompare(b.closedOn ?? '')).map((a) => ({
      id: a.id, label: actionLabel(a.detail), closedOn: a.closedOn!, effective: a.effective,
    })),
  };

  // 3. Évaluation des risques : versions du DUERP mises à jour dans l'année, consultation du CSE, transmission au SPST.
  const duerp = versions.filter((v) => inYear(v.updatedOn)).sort((a, b) => a.updatedOn.localeCompare(b.updatedOn)).map((v) => ({
    version: v.version, updatedOn: v.updatedOn, cseConsultedOn: v.cseConsultedOn, spstSentOn: v.spstSentOn, current: v.current,
  }));

  // 4. Programme annuel de prévention (L. 2312-27 2°) : programme de l'année écoulée et de l'année suivante.
  const programOf = (y: number) => {
    const p = programs.find((x) => x.year === y);
    if (!p) return { year: y, label: `${PROGRAM_SHORT} ${y} non établi` };
    return { year: y, label: p.frozenAt ? `${PROGRAM_SHORT} ${y} arrêté${p.cseConsultedOn ? ` · CSE consulté le ${fmtDate(p.cseConsultedOn)}` : ''}` : `${PROGRAM_SHORT} ${y} en préparation` };
  };

  // 5. Prévention des entreprises extérieures, contrôles réglementaires et formations de l'année.
  const yearPlans = plans.filter((p) => inSite(siteId, p.siteId) && inYear(p.startOn) && p.status !== 'annule');
  const controlIds = controls.map((c) => c.id);
  const records = controlIds.length
    ? (await db.select({ performedOn: t.controlRecords.performedOn, reserves: t.controlRecords.reserves, result: t.controlRecords.result })
      .from(t.controlRecords).where(and(inArray(t.controlRecords.controlId, controlIds), isNull(t.controlRecords.cancelledAt)))).filter((r) => inYear(r.performedOn))
    : [];
  const sitePeople = new Set([...people.values()].filter((p) => inSite(siteId, p.siteId)).map((p) => p.id));
  const yearQuals = quals.filter((q) => sitePeople.has(q.personId) && inYear(q.obtainedOn));
  const titleLabel = new Map(titles.map((x) => [x.id, x.label]));
  const byTitle = [...yearQuals.reduce((m, q) => m.set(q.titleId, (m.get(q.titleId) ?? 0) + 1), new Map<string, number>())]
    .map(([id, n]) => ({ title: titleLabel.get(id) ?? id, n })).sort((a, b) => b.n - a.n || a.title.localeCompare(b.title, 'fr'));

  return {
    year, years: Array.from({ length: 5 }, (_, i) => currentYear - i), generatedOn: now,
    site: siteId ? (siteRows.find((s) => s.id === siteId)?.label ?? siteId) : 'Tous les sites',
    accidents, actions, duerp,
    programs: [programOf(year), programOf(year + 1)],
    prevention: { plans: yearPlans.length },
    controls: {
      performed: records.length, withReserves: records.filter((r) => r.reserves).length,
      blocking: records.filter((r) => isBlockingControlResult(r.result)).length,
    },
    trainings: { total: yearQuals.length, byTitle },
    /** Fin de l'année ou date du jour pour l'année en cours. */
    periodEnd: year === currentYear ? now : `${year}-12-31`,
  };
}
