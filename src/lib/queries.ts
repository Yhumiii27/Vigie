import 'server-only';
import { cache } from 'react';
import { and, asc, inArray, isNull, or, type AnyColumn, type SQL } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { workforceAccident } from './event-filters';
import { actionLabel, isLate, isVerificationLate, kanbanColumn, lateDays, missingFields } from './action-rules';
import { daysBetween, fmtDate, fmtDayMonth } from './dates';
import { today } from '@/lib/today';
import {
  ACTION_SOURCES, AVANCEMENT, CERT_SOON_DAYS, CONTROL_HORIZON_DAYS, EVENT_DISMISSED, EVENT_STEPS, EVENT_TYPES, SAFETY_WINDOW_MONTHS,
  SKILL_SOON_DAYS, STEP_CLOSED, canSeeEventType, initials, isClosedActionStatus, type EventType, type SkillState, type Tone,
} from './domain';
import { PERSON_COLUMNS, type Person } from './people';
import { getSession, siteFilter, siteScopeIds, type SiteScope } from './session';

export type { Person, SiteScope };
export type EventRow = typeof t.events.$inferSelect;
/** Action telle que stockée (modèle du plan d'actions QSE, migration 0005) ; insertion : ActionInsert. */
export type ActionRow = typeof t.actions.$inferSelect;
export type ActionInsert = typeof t.actions.$inferInsert;

export const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
export const lcfirst = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);

// ─── Chargements de base (mémorisés par requête) ────────────────────────────

export const loadPeople = cache(async () => {
  const db = await getDb();
  return byId(await db.select(PERSON_COLUMNS).from(t.people).orderBy(asc(t.people.sort)));
});

/**
 * Condition SQL d'un chargement filtré par site (QUA-17) : élément sans site, ou d'un des sites `ids` (siteScopeIds) ;
 * undefined sans filtre. Les chargements gardent aussi le filtre siteFilter en mémoire (mêmes résultats qu'avant).
 */
export const siteWhere = (col: AnyColumn, ids: string[] | null): SQL | undefined =>
  ids == null ? undefined : ids.length ? or(isNull(col), inArray(col, ids)) : isNull(col);

/** Sites de la base, archivés compris, dans l'ordre d'affichage : chargement partagé par les écrans et les échéances (QUA-17). */
export const loadSiteRows = cache(async () => {
  const db = await getDb();
  return db.select().from(t.sites).orderBy(asc(t.sites.sort));
});

// Les chargements ci-dessous sont filtrés sur le site sélectionné (cookie, scope 'site' par défaut ; « Tous les sites »
// consolide), ou sur tout le périmètre de la personne (scope 'perimeter' : échéances, TDB-05). cache() distingue les
// appels par leurs arguments : f() et f('site') sont deux entrées, sans conséquence.

/**
 * Tous les événements du site, classés sans suite compris (liste « Classés sans suite », fiche). Les maladies
 * professionnelles (données de santé, EVT-09) ne sont chargées que pour les rôles habilités (canSeeEventType) : absentes
 * de tous les écrans, indicateurs et échéances des autres rôles.
 */
export const loadSiteEvents = cache(async (scope: SiteScope = 'site') => {
  const [db, keep, ids, { role }] = await Promise.all([getDb(), siteFilter(scope), siteScopeIds(scope), getSession()]);
  const rows = (await db.select().from(t.events).where(siteWhere(t.events.siteId, ids))).filter((e) => keep(e.siteId) && canSeeEventType(role, e.type));
  return rows.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id, 'fr', { numeric: true }));
});

/** Événements du site hors classés sans suite : base des indicateurs (TF1/TG, pyramide, NC ouvertes…). */
export const loadEvents = cache(async (scope: SiteScope = 'site') => (await loadSiteEvents(scope)).filter((e) => !e.dismissedAt));

/**
 * Toutes les actions de la base, tous sites, abandonnées comprises : lecture unique par requête, partagée par les chargements
 * qui lisent tout le plan (DUERP, documents, et loadAllActions sans filtre de site) — QUA-17.
 */
export const loadActionRows = cache(async () => {
  const db = await getDb();
  return db.select().from(t.actions);
});

/**
 * Toutes les actions du site, abandonnées comprises (affichage « Abandonnées », historique). Site sélectionné ou périmètre
 * restreint : filtrées en base (siteWhere, QUA-17) ; sinon lecture partagée (loadActionRows).
 */
export const loadAllActions = cache(async (scope: SiteScope = 'site') => {
  const [db, keep, ids] = await Promise.all([getDb(), siteFilter(scope), siteScopeIds(scope)]);
  const rows = ids == null ? await loadActionRows() : await db.select().from(t.actions).where(siteWhere(t.actions.siteId, ids));
  return rows.filter((a) => keep(a.siteId));
});

/** Actions du site hors abandonnées : base de tous les calculs transverses (retards, échéances, revues…). */
export const loadActions = cache(async (scope: SiteScope = 'site') => (await loadAllActions(scope)).filter((a) => a.status !== 'abandonnee'));

/** Contrôles périodiques actifs du site (les équipements réformés, archivés, sont exclus). */
export const loadControls = cache(async (scope: SiteScope = 'site') => {
  const [db, keep, ids] = await Promise.all([getDb(), siteFilter(scope), siteScopeIds(scope)]);
  return (await db.select().from(t.controls).where(and(isNull(t.controls.archivedAt), siteWhere(t.controls.siteId, ids))).orderBy(asc(t.controls.sort)))
    .filter((c) => !c.archivedAt && keep(c.siteId));
});

// ─── Règles de calcul ───────────────────────────────────────────────────────

export const isOpen = (e: EventRow) => e.step < STEP_CLOSED && !e.dismissedAt;

export function controlStatus(c: { nextOn: string }, now = today()): { label: string; tone: Tone; days: number } {
  const days = daysBetween(now, c.nextOn);
  if (days < 0) return { label: `Dépassé · +${-days} j`, tone: 'danger', days };
  if (days <= CONTROL_HORIZON_DAYS) return { label: `Sous ${CONTROL_HORIZON_DAYS} j`, tone: 'warn', days };
  return { label: 'Planifié', tone: 'neutral', days };
}

/**
 * Échéance d'une exigence de veille (VEI-03) : suivie par des contrôles périodiques (actifs, rattachés), celle du prochain
 * contrôle — calculée, jamais la date saisie, qui serait figée ; sinon sa date d'application saisie. `control` : le contrôle
 * qui la fixe (null : date saisie).
 */
export function requirementDue<C extends { requirementId: number | null; archivedAt: Date | null; nextOn: string }>(
  r: { id: number; dueOn: string | null }, controls: readonly C[],
): { on: string | null; control: C | null } {
  const next = controls.filter((c) => c.requirementId === r.id && !c.archivedAt).sort((a, b) => a.nextOn.localeCompare(b.nextOn))[0];
  return next ? { on: next.nextOn, control: next } : { on: r.dueOn, control: null };
}

export function skillState(required: boolean, expiresOn: string | null | undefined, has: boolean, now = today()): SkillState {
  if (!required) return 'n';
  if (!has) return 'r';
  if (!expiresOn) return 'v';
  if (expiresOn < now) return 'x';
  return daysBetween(now, expiresOn) <= SKILL_SOON_DAYS ? 's' : 'v';
}

// ─── Taux de fréquence et de gravité (TDB-04) ───────────────────────────────

/** Les `n` mois complets précédant `now` (mois en cours exclu), « AAAA-MM », du plus ancien au plus récent. */
export function lastFullMonths(now: string, n = SAFETY_WINDOW_MONTHS): string[] {
  const y = +now.slice(0, 4);
  const m = +now.slice(5, 7) - 1;
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - n + i, 1)).toISOString().slice(0, 7));
}

export type SafetyRates = {
  /** Accidents avec arrêt × 10⁶ / heures travaillées ; null sans heures (jamais 0 par défaut). */
  tf1: number | null;
  /** Jours perdus × 10³ / heures travaillées ; null sans heures. */
  tg: number | null;
  hours: number;
  accidents: number;
  lostDays: number;
  /** Mois attendus sans heures saisies (site, « AAAA-MM »), par mois puis dans l'ordre des sites. */
  missing: { siteId: string; month: string }[];
};

/**
 * Accident du travail de l'effectif (salarié, ou victime non précisée) : seul compté dans TF1 / TG, les jours sans accident
 * avec arrêt et la pyramide des accidents — les heures travaillées (hours_worked, source RH) sont celles de l'effectif ;
 * l'accident d'un intérimaire relève de l'entreprise de travail temporaire, celui d'une personne extérieure de son employeur.
 * Un accident de trajet (L. 411-2 CSS, `commute`, EVT-09) n'est pas un accident du travail au sens des taux : exclu aussi.
 */
export { workforceAccident };

/**
 * TF1 / TG sur les mois donnés (lastFullMonths), sites de l'entrée seulement :
 * - mois d'une valeur = ses 7 premiers caractères (hours_worked.month vaut « AAAA-MM-01 ») ;
 * - un AT avec arrêt de la fenêtre prouve l'activité de son site ce mois-là : sa case est toujours attendue ;
 * - sites suivis : sites actifs, sites archivés ayant au moins une ligne d'heures (toute période) ou un AT avec arrêt
 *   dans la fenêtre ;
 * - cases attendues : (site, mois) à partir du premier mois saisi pour le site (toute période), avancé au premier AT
 *   avec arrêt de la fenêtre qui le précède (aucun mois saisi : toute la fenêtre), jusqu'au mois d'archivage, plus les
 *   cases des AT avec arrêt ; cases couvertes : lignes d'heures des mois et sites de l'entrée (une valeur 0 compte) ;
 * - accidents et jours perdus : AT avec arrêt de l'effectif (workforceAccident) du mois d'une case couverte (sans site :
 *   un mois couvert sur un site au moins) — un mois sans heures n'entre ni au numérateur ni au dénominateur, il est
 *   signalé dans `missing`.
 */
export function safetyRates(input: {
  months: string[];
  sites: { id: string; archivedOn: string | null }[];
  hours: { month: string; siteId: string; hours: number }[];
  events: { type: string; injury: string | null; lostDays: number | null; occurredOn: string; siteId: string | null; victimKind: string | null; commute?: boolean | null }[];
}): SafetyRates {
  const ym = (v: string) => v.slice(0, 7);
  const window = new Set(input.months);
  const siteIds = new Set(input.sites.map((s) => s.id));
  const firstEntered = new Map<string, string>();
  input.hours.forEach((h) => {
    const m = ym(h.month);
    const first = firstEntered.get(h.siteId);
    if (!first || m < first) firstEntered.set(h.siteId, m);
  });
  // AT avec arrêt de la fenêtre sur un site de l'entrée : preuve d'activité du site ce mois-là.
  const isArret = (e: (typeof input.events)[number]) => workforceAccident(e) && e.injury === 'arret' && window.has(ym(e.occurredOn));
  const proven = new Set<string>();
  const firstProven = new Map<string, string>();
  input.events.forEach((e) => {
    if (!isArret(e) || !e.siteId || !siteIds.has(e.siteId)) return;
    const m = ym(e.occurredOn);
    proven.add(`${e.siteId}|${m}`);
    const first = firstProven.get(e.siteId);
    if (!first || m < first) firstProven.set(e.siteId, m);
  });
  const tracked = input.sites.filter((s) => !s.archivedOn || firstEntered.has(s.id) || firstProven.has(s.id));
  const covered = new Set<string>();
  const coveredMonths = new Set<string>();
  let hours = 0;
  input.hours.forEach((h) => {
    const m = ym(h.month);
    if (!window.has(m) || !siteIds.has(h.siteId)) return;
    covered.add(`${h.siteId}|${m}`);
    coveredMonths.add(m);
    hours += h.hours;
  });
  const missing: SafetyRates['missing'] = [];
  input.months.forEach((m) => tracked.forEach((s) => {
    const key = `${s.id}|${m}`;
    if (covered.has(key)) return;
    const entered = firstEntered.get(s.id);
    const proof = firstProven.get(s.id);
    const first = entered && proof && proof < entered ? proof : entered;
    const expected = proven.has(key) || ((!first || m >= first) && (!s.archivedOn || m <= ym(s.archivedOn)));
    if (expected) missing.push({ siteId: s.id, month: m });
  }));
  const counted = input.events.filter((e) => {
    if (!isArret(e)) return false;
    const m = ym(e.occurredOn);
    return e.siteId ? covered.has(`${e.siteId}|${m}`) : coveredMonths.has(m);
  });
  const accidents = counted.length;
  const lostDays = counted.reduce((n, e) => n + (e.lostDays ?? 0), 0);
  return {
    tf1: hours ? (accidents * 1e6) / hours : null,
    tg: hours ? (lostDays * 1e3) / hours : null,
    hours, accidents, lostDays, missing,
  };
}

// ─── Vues partagées ─────────────────────────────────────────────────────────

export function eventView(e: EventRow, people: Map<string, Person>, now = today()) {
  const type = EVENT_TYPES[e.type as EventType];
  return {
    ...e,
    typeLabel: type.label,
    typeTone: type.tone,
    dismissed: !!e.dismissedAt,
    status: e.dismissedAt ? EVENT_DISMISSED : EVENT_STEPS[e.step],
    pilot: e.pilotId ? people.get(e.pilotId)?.name ?? '—' : '—',
    // Signalement sans compte (QR code de poste) : nom et entreprise déclarés, non vérifiés.
    declarantLabel: e.anonymous ? 'Anonyme'
      : e.declarant ? `${e.declarant}${e.declarantCompany ? ` (${e.declarantCompany})` : ''}${e.reportedVia === 'poste' ? ' · déclaré sans compte' : ''}` : '—',
    days: daysBetween(e.occurredOn, now),
  };
}

/** Libellé et ton d'une action en retard (§ 6.3), à la place de son avancement. */
const LATE_STATUS = { label: 'En retard', tone: 'danger' as Tone };

/** Avancement affiché : « En retard » (danger) quand l'action l'est, sinon libellé et ton de AVANCEMENT (§ 5.1). */
function avancementOf(a: Pick<ActionRow, 'status' | 'dueOn'>, now: string) {
  const def = AVANCEMENT[a.status]; // valeur contrôlée par la base (actions_status_check)
  const late = isLate(a, now);
  return { def, late, avancement: def.label, statusLabel: late ? LATE_STATUS.label : def.label, tone: late ? LATE_STATUS.tone : def.tone };
}

/**
 * Vue calculée d'une action (écrans sources, revues, tableau de bord) : libellé court (actionLabel du détail), avancement
 * (libellé, groupe, colonne Kanban), retard (isLate, lateDays ; « En retard »/danger à la place de l'avancement),
 * vérification en retard, close (Vérifiée ou Abandonnée), définition de la source (null : à compléter), responsable,
 * date cible courte, champs à compléter (missingFields, D8). Rien n'est stocké : tout dépend de la date du jour.
 */
export function actionView(a: ActionRow, people: Map<string, Person>, now = today()) {
  const s = avancementOf(a, now);
  const pilot = people.get(a.pilotId)?.name ?? '—';
  const missing = missingFields(a);
  return {
    ...a,
    label: actionLabel(a.detail),
    avancement: s.avancement,
    statusLabel: s.statusLabel,
    tone: s.tone,
    group: s.def.group,
    kanban: kanbanColumn(a, now),
    late: s.late,
    lateDays: lateDays(a, now),
    verifyLate: isVerificationLate(a, now),
    closed: isClosedActionStatus(a.status),
    sourceDef: (a.source ? ACTION_SOURCES[a.source] ?? null : null) as (typeof ACTION_SOURCES)[keyof typeof ACTION_SOURCES] | null,
    pilot,
    pilotInitials: initials(pilot),
    due: fmtDayMonth(a.dueOn),
    missing,
    toComplete: missing.length > 0,
  };
}

/**
 * Action du plan d'actions rattachée à un élément (audit, revue…), avancement calculé. Clés inchangées depuis l'ancien
 * modèle (les dossiers de revue figés les relisent tels quels) : `title` = libellé court (actionLabel du détail),
 * `status` = avancement affiché (« En retard » le cas échéant) ; `effective` : résultat de la vérification.
 */
export type ActionBrief = {
  id: string; title: string; status: string; tone: Tone; pilot: string; dueOn: string; closedOn: string | null; efficacyNote: string | null;
  effective?: boolean | null;
};

export function actionBrief(a: ActionRow | undefined, people: Map<string, Person>, now: string): ActionBrief | null {
  if (!a) return null;
  const s = avancementOf(a, now);
  return {
    id: a.id, title: actionLabel(a.detail), status: s.statusLabel, tone: s.tone, pilot: people.get(a.pilotId)?.name ?? '—',
    dueOn: a.dueOn, closedOn: a.closedOn, efficacyNote: a.efficacyNote, effective: a.effective,
  };
}

// ─── Veille : projets Keystone concernés ────────────────────────────────────

type ConcernReq = { dueOn: string | null; affectsProjects: boolean; keystoneProjects: number | null };

/** Projets Keystone livrés après la date d'application d'une exigence qui les concerne (affectsProjects), par livraison. */
export const concernedProjects = <P extends { deliveryOn: string | null }>(req: Omit<ConcernReq, 'keystoneProjects'>, projects: P[]) =>
  req.affectsProjects && req.dueOn
    ? projects.filter((p) => !!p.deliveryOn && p.deliveryOn > req.dueOn!).sort((a, b) => a.deliveryOn!.localeCompare(b.deliveryOn!))
    : [];

/** Nombre de projets concernés : le champ manuel `keystoneProjects` reste une surcharge du calcul (null = non applicable). */
export const concernedCount = (req: ConcernReq, projects: { deliveryOn: string | null }[]) =>
  req.keystoneProjects ?? (req.affectsProjects && req.dueOn ? concernedProjects(req, projects).length : null);

// ─── Audits : statut calculé d'une certification ────────────────────────────

/** Statut affiché d'un référentiel : engagement, validité du certificat et prochain audit au programme. */
export function certificationStatus(c: { tone: string; status: string; validUntil: string | null; suspendedOn?: string | null }, nextAuditOn: string | null, now: string): { label: string; tone: Tone } {
  const audit = nextAuditOn && (nextAuditOn < now ? `audit du ${fmtDate(nextAuditOn)} à confirmer` : `${c.tone === 'ok' ? 'suivi' : 'audit'} le ${fmtDate(nextAuditOn)}`);
  if (c.tone === 'off') return { label: c.status || 'Non engagé', tone: 'neutral' };
  if (c.tone === 'warn') return { label: [c.status || 'Certification en cours', audit].filter(Boolean).join(' · '), tone: 'warn' };
  // AUD-08 : certificat suspendu par l'organisme, jusqu'à la levée de la suspension.
  if (c.suspendedOn) return { label: `Certificat suspendu depuis le ${fmtDate(c.suspendedOn)}`, tone: 'danger' };
  if (c.validUntil && c.validUntil < now) return { label: `Certificat expiré depuis le ${fmtDate(c.validUntil)}`, tone: 'danger' };
  if (c.validUntil && daysBetween(now, c.validUntil) <= CERT_SOON_DAYS) return { label: `Certifié · valable jusqu'au ${fmtDate(c.validUntil)}`, tone: 'warn' };
  if (!nextAuditOn) return { label: 'Certifié · prochain audit à programmer', tone: 'warn' };
  return { label: `Certifié · ${audit}`, tone: nextAuditOn < now || daysBetween(now, nextAuditOn) <= CERT_SOON_DAYS ? 'warn' : 'ok' };
}
