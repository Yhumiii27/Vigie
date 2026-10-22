import 'server-only';
import { getDb, schema as t } from '@/db';
import { addDays, daysBetween, toParisLocal } from '../dates';
import { today } from '@/lib/today';
import { isLate } from '../action-rules';
import { CONTROL_HORIZON_DAYS, NAV, SCREENS, TODO_HORIZON_DAYS, canOpen, canSeeHealth, isMine, isOpenAvancement, type ScreenKey, type Tone } from '../domain';
import {
  controlStatus, eventView, isOpen, lastFullMonths, lcfirst, loadActions, loadControls, loadEvents, loadPeople, safetyRates, workforceAccident,
  type EventRow, type SafetyRates,
} from '../queries';
import { currentSiteId, getSession, inPerimeter } from '../session';
import { loadReadKeys } from './notifications';
import { loadSiteDirectory, loadVisibleTodo, shortSiteLabel, type VisibleTodo } from './todo';
import { tf1Target } from './objectives';
import { requirementProjects } from './watch';

// ─── Tableau de bord ────────────────────────────────────────────────────────

/** Échéances affichées dans la carte « À traiter » ; la suite est sur la page À faire. */
export const MAX_TODO = 7;

const fr = (n: number, digits: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const MONTH_YEAR = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
/** « AAAA-MM » → « sept. 2026 ». */
const fmtMonthYear = (ym: string) => MONTH_YEAR.format(new Date(`${ym}-01T00:00:00Z`));
/** Mois sans heures saisies affichés dans la note du KPI TF1 ; la suite est résumée par « +n ». */
const MAX_MISSING_SHOWN = 2;

/** Indicateurs TF1 / TG du tableau de bord (repris par le dossier de la revue de direction). */
export type SafetySummary = {
  tf1: number | null;
  tg: number | null;
  /** Cible TF1 de l'objectif QHSE de l'année (AUD-13) ; null sans objectif. */
  target: number | null;
  /** Fenêtre de calcul : « oct. 2025 – sept. 2026 ». */
  period: string;
  /** Mois sans heures saisies (« sept. 2026 », avec le site si plusieurs sites sont consolidés), null s'il n'en manque pas. */
  missing: string | null;
  /** Heures saisies sur toute la fenêtre, pour tous les sites suivis. */
  complete: boolean;
};

/**
 * TF1 / TG des 12 derniers mois complets (TDB-04) : site sélectionné, ou tous les sites du périmètre (archivés compris)
 * sous « Tous les sites ». Un mois sans heures saisies est écarté du taux et signalé (safetyRates, src/lib/queries.ts).
 */
async function loadSafety(now: string, site: string | null, allowed: string[] | null, events: EventRow[]) {
  const db = await getDb();
  const [directory, allHours, target] = await Promise.all([loadSiteDirectory(), db.select().from(t.hoursWorked), tf1Target(+now.slice(0, 4), site)]);
  const months = lastFullMonths(now);
  const scope = directory.filter((s) => (site ? s.id === site : inPerimeter(allowed, s.id)));
  const ids = new Set(scope.map((s) => s.id));
  const rates = safetyRates({
    months,
    sites: scope.map((s) => ({ id: s.id, archivedOn: s.archivedAt ? toParisLocal(s.archivedAt).slice(0, 10) : null })),
    hours: allHours.filter((h) => ids.has(h.siteId)),
    events,
  });
  const labels = new Map(scope.map((s) => [s.id, shortSiteLabel(s.label)]));
  const several = scope.length > 1;
  // Mois les plus récents d'abord : le dernier mois non saisi est le plus probable.
  const gaps = [...rates.missing].reverse().map((m) => `${fmtMonthYear(m.month)}${several ? ` (${labels.get(m.siteId) ?? m.siteId})` : ''}`);
  const missing = gaps.length
    ? `${gaps.slice(0, MAX_MISSING_SHOWN).join(', ')}${gaps.length > MAX_MISSING_SHOWN ? ` +${gaps.length - MAX_MISSING_SHOWN}` : ''}`
    : null;
  const summary: SafetySummary = {
    tf1: rates.tf1, tg: rates.tg, target,
    period: `${fmtMonthYear(months[0])} – ${fmtMonthYear(months[months.length - 1])}`,
    missing, complete: rates.hours > 0 && !rates.missing.length,
  };
  return { rates, summary };
}

/** KPI « TF1 · 12 mois glissants » : « — » sans heures, avertissement si des mois manquent. */
function safetyKpi(rates: SafetyRates, s: SafetySummary, year: string) {
  const noHours = rates.hours === 0;
  const note = noHours ? 'Heures travaillées non saisies'
    : s.missing ? `Heures manquantes : ${s.missing} — taux sur les mois saisis`
      : s.target != null ? `Objectif ${year} : TF1 ≤ ${fr(s.target, 1)} · ${s.period}` : `Aucun objectif TF1 ${year} · ${s.period}`;
  return {
    value: s.tf1 == null ? '—' : fr(s.tf1, 1),
    sub: s.tg == null ? '' : `TG ${fr(s.tg, 2)}`,
    note,
    tone: (noHours || s.missing ? 'warn' : 'neutral') as Tone,
  };
}

export async function loadDashboard() {
  const db = await getDb();
  const now = today();
  const yearAgo = addDays(now, -365);
  const [{ role, allowedSiteIds }, people, events, actions, controls, reqs, site, todo] = await Promise.all([
    getSession(), loadPeople(), loadEvents(), loadActions(), loadControls(),
    db.select().from(t.requirements),
    currentSiteId(),
    loadVisibleTodo(),
  ]);
  // Lien d'une carte ou d'une barre, seulement si l'écran visé est ouvert au rôle.
  const link = (href: string) => (canOpen(role, href) ? href : null);

  // Indicateurs sécurité : TF1 / TG sur les 12 derniers mois complets (TDB-04) ; pyramide sur 365 jours. Accidents de
  // l'effectif seulement (workforceAccident : ni intérimaire, ni personne extérieure).
  const atArret = events.filter((e) => workforceAccident(e) && e.injury === 'arret');
  const lastArret = atArret[0];
  const last12 = (e: EventRow) => e.occurredOn > yearAgo;
  const safety = await loadSafety(now, site, allowedSiteIds, events);
  const tfKpi = safetyKpi(safety.rates, safety.summary, now.slice(0, 4));

  const open = events.filter(isOpen);
  const old = open.filter((e) => daysBetween(e.occurredOn, now) > 30).length;
  const recent = events.filter((e) => daysBetween(e.occurredOn, now) <= 7).length;

  // Actions en retard (§ 6.3) : ouvertes (À faire → 80 %) dont la date cible est passée, sur les ouvertes du site ; ni les
  // Reportées, ni les Terminées (en attente de vérification), ni les closes ne sont en retard.
  const late = actions.filter((a) => isLate(a, now));
  const openActions = actions.filter((a) => isOpenAvancement(a.status)).length;

  const ctrl = controls.map((c) => ({ c, s: controlStatus(c, now) }));
  const soon = ctrl.filter((x) => x.s.days <= CONTROL_HORIZON_DAYS);
  const overdue = ctrl.filter((x) => x.s.days < 0);
  const equipShort = (e: string) => e.split(' — ')[0];

  const ncOpen = open.filter((e) => e.type === 'NC' || e.type === 'RC');
  const ncBy = new Map<string, number>();
  ncOpen.forEach((e) => {
    const k = e.type === 'RC' ? 'Réclamation client' : e.ncOrigin ?? 'Autre';
    ncBy.set(k, (ncBy.get(k) ?? 0) + 1);
  });
  const ncTop = [...ncBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${k} ${n}`).join(' · ');

  // TDB-12 : listes filtrées (EVT-13). Accidents de l'effectif hors trajet (effectif=1, comme les taux et la pyramide) ;
  // filtre par blessure (donnée de santé) dans les liens des seuls rôles habilités, sinon liste des AT de l'effectif.
  const health = canSeeHealth(role);
  const atHref = link('/evenements?etat=tous&type=AT&effectif=1');
  const injuryHref = (blessure: string, du?: string) =>
    link(`/evenements?etat=tous&type=AT&effectif=1${health ? `&blessure=${blessure}` : ''}${du ? `&du=${du}` : ''}`);
  const since = addDays(yearAgo, 1);
  const kpis: { label: string; value: string; sub: string; note: string; tone: Tone; href: string | null; subHref?: string | null }[] = [
    { label: 'Jours sans accident avec arrêt', value: lastArret ? String(daysBetween(lastArret.occurredOn, now)) : '—', sub: '', note: lastArret ? `Dernier AT avec arrêt le ${fmtLongDate(lastArret.occurredOn)}` : 'Aucun accident avec arrêt enregistré', tone: 'ok', href: injuryHref('arret') },
    { label: 'TF1 · 12 mois glissants', ...tfKpi, href: atHref },
    {
      label: 'Événements ouverts', value: String(open.length), sub: `dont ${old} > 30 j`, note: `${recent} déclaré${recent > 1 ? 's' : ''} sur les 7 derniers jours`, tone: 'warn',
      href: link('/evenements'), subHref: link('/evenements?anciennete=30'),
    },
    { label: 'Actions en retard', value: String(late.length), sub: `sur ${openActions} ouvertes`, note: `${late.filter((a) => a.eventId).length} liées à des événements`, tone: 'danger', href: link('/actions?retard=1') },
    { label: `Contrôles réglementaires < ${CONTROL_HORIZON_DAYS} j`, value: String(soon.length), sub: `dont ${overdue.length} dépassé${overdue.length > 1 ? 's' : ''}`, note: overdue[0] ? `${overdue[0].c.controlType.split(' ')[0]} ${lcfirst(equipShort(overdue[0].c.equipment))} · +${-overdue[0].s.days} j` : 'Aucun contrôle dépassé', tone: overdue.length ? 'danger' : 'warn', href: link(`/veille?onglet=controles&statut=${overdue.length ? 'depasses' : 'sous-30-j'}`) },
    { label: 'Non-conformités', value: String(ncOpen.length), sub: 'ouvertes', note: ncTop || '—', tone: 'neutral', href: link('/evenements?type=NC,RC') },
  ];

  // Pyramide des événements sécurité (12 mois glissants)
  const y = events.filter(last12);
  const pyramid = [
    { label: 'Accidents avec arrêt', n: y.filter((e) => workforceAccident(e) && e.injury === 'arret').length, color: 'var(--tone-danger-dot)', href: injuryHref('arret', since) },
    { label: 'Accidents sans arrêt', n: y.filter((e) => workforceAccident(e) && (e.injury === 'sans_arret' || !e.injury)).length, color: 'var(--tone-warn-dot)', href: injuryHref('sans_arret', since) },
    { label: 'Soins', n: y.filter((e) => workforceAccident(e) && e.injury === 'soins').length, color: 'var(--color-accent-500)', href: injuryHref('soins', since) },
    { label: 'Presque-accidents', n: y.filter((e) => e.type === 'PA').length, color: 'var(--color-accent-700)', href: link(`/evenements?etat=tous&type=PA&du=${since}`) },
    { label: 'Situations dangereuses', n: y.filter((e) => e.type === 'SD').length, color: 'var(--color-accent-800)', href: link(`/evenements?etat=tous&type=SD&du=${since}`) },
  ];
  const pyrMax = Math.max(1, ...pyramid.map((p) => p.n));

  const ncLabels: [string, string][] = [['Fournisseurs', 'Fournisseurs'], ['Fabrication', 'Fabrication'], ['Conception BE', 'Conception BE'], ['Mise en service', 'Mise en service'], ['Réclamation client', 'Réclamations client']];
  const ncMax = Math.max(1, ...ncBy.values());

  const featured = reqs.find((r) => r.featured && !r.archivedAt);
  // Projets Keystone concernés : même calcul que la fiche de l'exigence sur /veille (surcharge manuelle comprise).
  const keystone = featured?.dueOn ? await requirementProjects(featured) : null;

  // Carte « À traiter dans les 15 jours » : dépassements et échéances de l'horizon ; les contrôles à 16-30 jours
  // restent sur la page À faire (groupe « Contrôles à 30 jours »).
  const todoHorizon = addDays(now, TODO_HORIZON_DAYS);
  const todoSoon = todo.filter((x) => x.overdue || x.date <= todoHorizon);

  return {
    kpis,
    /** TF1 / TG détaillés (dossier de la revue de direction : avertissement « heures manquantes »). */
    safety: safety.summary,
    pyramid: pyramid.map((p) => ({ ...p, w: `${Math.max(5, Math.round((p.n / pyrMax) * 100))}%` })),
    pyramidTotal: pyramid.reduce((s, p) => s + p.n, 0),
    // Barre d'une origine : NC ouvertes de cette origine (?origine=), réclamations client par leur type.
    ncOrigins: ncLabels.map(([key, label]) => ({ label, n: ncBy.get(key) ?? 0, w: `${Math.round(((ncBy.get(key) ?? 0) / ncMax) * 100)}%`, href: link(key === 'Réclamation client' ? '/evenements?type=RC' : `/evenements?type=NC&origine=${encodeURIComponent(key)}`) })),
    ncOpen: ncOpen.length,
    ncHref: link('/evenements?type=NC,RC'),
    todo: todoSoon,
    /** Échéances de la page À faire non affichées dans la carte (au-delà de MAX_TODO, ou contrôles à 16-30 jours). */
    todoMore: todo.length - Math.min(todoSoon.length, MAX_TODO),
    /** Un site précis est sélectionné (états vides « sur ce site »). */
    scoped: site !== null,
    latest: events.slice(0, 6).map((e) => eventView(e, people, now)),
    featured: featured && featured.dueOn ? {
      id: featured.id,
      title: `${featured.text} — ${featured.domain.split(' — ')[0].toLowerCase()}`,
      lead: featured.summary.split(' : ')[0].replace(/\.?$/, '.'),
      dueOn: featured.dueOn,
      daysLeft: daysBetween(now, featured.dueOn),
      impact: featured.impact,
      projects: keystone?.count ?? null,
      /** Identifiants des projets calculés ; vide si le nombre est saisi à la main (surcharge). */
      projectIds: keystone && !keystone.manual ? keystone.list.map((p) => p.id) : [],
      actionId: featured.actionId,
      // Lecture seule pour les rôles sans accès à la veille (chef de projet).
      href: link(`/veille?exigence=${featured.id}`),
    } : null,
  };
}

// ─── Page À faire ───────────────────────────────────────────────────────────

export type TodoRow = VisibleTodo & { read: boolean; screen: ScreenKey };

/**
 * Liste complète des échéances visibles (site sélectionné, plus les échéances de la personne sur les autres sites de son
 * périmètre), filtrée par domaine (écran source) et « Mes échéances », groupée par urgence.
 * Un domaine absent de la liste (paramètre d'URL invalide ou sans échéance) est ignoré : `domain` renvoie le filtre retenu.
 */
export async function loadTodoPage({ domain: wanted, mine }: { domain?: string; mine: boolean }) {
  const now = today();
  const [{ user }, todo, reads] = await Promise.all([getSession(), loadVisibleTodo(), loadReadKeys()]);
  // Domaine = écran source de l'échéance, même sans lien (écran fermé au rôle : TDB-02).
  const all: TodoRow[] = todo.map((x) => ({ ...x, read: reads.has(x.key), screen: x.source, overdue: !!x.overdue || x.date < now }));
  // « Mes échéances » : consolidées sur tous les sites du périmètre (loadVisibleTodo garde celles des autres sites, TDB-05).
  const mineRows = all.filter((x) => isMine(x, user));
  const scoped = mine ? mineRows : all;
  // Écrans de la navigation, puis « Mes contributions » (hors navigation, AUD-04) : chaque échéance a sa puce.
  const order: ScreenKey[] = [...NAV.flatMap((s) => s.items), 'contributions'];
  const domains = order
    .filter((k) => scoped.some((x) => x.screen === k))
    .map((k) => ({ key: k, label: SCREENS[k].label, icon: SCREENS[k].icon, n: scoped.filter((x) => x.screen === k).length }));
  const domain = domains.find((x) => x.key === wanted)?.key;
  const items = domain ? scoped.filter((x) => x.screen === domain) : scoped;

  const late = (x: TodoRow) => !!x.overdue; // renseigné ci-dessus : signalé par le domaine, ou date passée
  const week = addDays(now, 7);
  const horizon = addDays(now, TODO_HORIZON_DAYS);
  const ahead = items.filter((x) => !late(x));
  const groups: [string, TodoRow[]][] = [
    ['En retard', items.filter(late)],
    ['Cette semaine', ahead.filter((x) => x.date <= week)],
    [`D'ici ${TODO_HORIZON_DAYS} jours`, ahead.filter((x) => x.date > week && x.date <= horizon)],
    [`Contrôles à ${CONTROL_HORIZON_DAYS} jours`, ahead.filter((x) => x.date > horizon)],
  ];
  return {
    domain,
    items,
    domains,
    counts: {
      all: all.length, mine: mineRows.length, overdue: items.filter(late).length, unread: items.filter((x) => !x.read).length,
      /** Échéances de la liste affichée situées sur un autre site que le site sélectionné. */
      elsewhere: items.filter((x) => x.elsewhere).length,
    },
    groups: groups.filter(([, rows]) => rows.length > 0),
  };
}

function fmtLongDate(iso: string) {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}
