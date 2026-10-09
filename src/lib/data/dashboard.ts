import 'server-only';
import { getDb, schema as t } from '@/db';
import { addDays, daysBetween, today } from '../dates';
import { CONTROL_HORIZON_DAYS, NAV, SCREENS, TODO_HORIZON_DAYS, canOpen, isMine, screenOfHref, todoKey, type ScreenKey, type TodoItem, type Tone } from '../domain';
import { actionColumn, controlStatus, eventView, isOpen, lcfirst, loadActions, loadControls, loadEvents, loadPeople, type EventRow } from '../queries';
import { currentSiteId, getSession, inSite } from '../session';
import { loadReadKeys } from './notifications';
import { loadVisibleTodo } from './todo';
import { requirementProjects } from './watch';

// ─── Tableau de bord ────────────────────────────────────────────────────────

export const TF1_TARGET = 4;
/** Échéances affichées dans la carte « À traiter » ; la suite est sur la page À faire. */
export const MAX_TODO = 7;

const fr = (n: number, digits: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export async function loadDashboard() {
  const db = await getDb();
  const now = today();
  const yearAgo = addDays(now, -365);
  const [{ role }, people, events, actions, controls, allHours, reqs, site, todo] = await Promise.all([
    getSession(), loadPeople(), loadEvents(), loadActions(), loadControls(),
    db.select().from(t.hoursWorked),
    db.select().from(t.requirements),
    currentSiteId(),
    loadVisibleTodo(),
  ]);
  // Lien d'une carte ou d'une barre, seulement si l'écran visé est ouvert au rôle.
  const link = (href: string) => (canOpen(role, href) ? href : null);
  const hours = allHours.filter((h) => inSite(site, h.siteId));

  // Indicateurs sécurité
  const atArret = events.filter((e) => e.type === 'AT' && e.injury === 'arret');
  const lastArret = atArret[0];
  const last12 = (e: EventRow) => e.occurredOn > yearAgo;
  const hours12 = hours.filter((h) => h.month > yearAgo.slice(0, 7)).reduce((s, h) => s + h.hours, 0);
  const tf1 = hours12 ? (atArret.filter(last12).length * 1e6) / hours12 : 0;
  const tg = hours12 ? (atArret.filter(last12).reduce((s, e) => s + (e.lostDays ?? 0), 0) * 1e3) / hours12 : 0;

  const open = events.filter(isOpen);
  const old = open.filter((e) => daysBetween(e.occurredOn, now) > 30).length;
  const recent = events.filter((e) => daysBetween(e.occurredOn, now) <= 7).length;

  const cols = actions.map((a) => ({ a, col: actionColumn(a, now) }));
  const late = cols.filter((x) => x.col === 'late');
  const openActions = cols.filter((x) => x.col !== 'done').length;

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

  const atHref = link('/evenements?etat=tous&type=AT');
  const kpis: { label: string; value: string; sub: string; note: string; tone: Tone; href: string | null }[] = [
    { label: 'Jours sans accident avec arrêt', value: lastArret ? String(daysBetween(lastArret.occurredOn, now)) : '—', sub: '', note: lastArret ? `Dernier AT avec arrêt le ${fmtLongDate(lastArret.occurredOn)}` : 'Aucun accident avec arrêt enregistré', tone: 'ok', href: atHref },
    { label: 'TF1 · 12 mois glissants', value: fr(tf1, 1), sub: `TG ${fr(tg, 2)}`, note: `Objectif ${now.slice(0, 4)} : TF1 < ${TF1_TARGET}`, tone: 'neutral', href: atHref },
    { label: 'Événements ouverts', value: String(open.length), sub: `dont ${old} > 30 j`, note: `${recent} déclaré${recent > 1 ? 's' : ''} sur les 7 derniers jours`, tone: 'warn', href: link('/evenements') },
    { label: 'Actions en retard', value: String(late.length), sub: `sur ${openActions} ouvertes`, note: `${late.filter((x) => x.a.eventId).length} liées à des événements`, tone: 'danger', href: link('/actions') },
    { label: `Contrôles réglementaires < ${CONTROL_HORIZON_DAYS} j`, value: String(soon.length), sub: `dont ${overdue.length} dépassé${overdue.length > 1 ? 's' : ''}`, note: overdue[0] ? `${overdue[0].c.controlType.split(' ')[0]} ${lcfirst(equipShort(overdue[0].c.equipment))} · +${-overdue[0].s.days} j` : 'Aucun contrôle dépassé', tone: overdue.length ? 'danger' : 'warn', href: link(`/veille?onglet=controles&statut=${overdue.length ? 'depasses' : 'sous-30-j'}`) },
    { label: 'Non-conformités', value: String(ncOpen.length), sub: 'ouvertes', note: ncTop || '—', tone: 'neutral', href: link('/evenements?type=NC,RC') },
  ];

  // Pyramide des événements sécurité (12 mois glissants)
  const y = events.filter(last12);
  const pyramid = [
    { label: 'Accidents avec arrêt', n: y.filter((e) => e.type === 'AT' && e.injury === 'arret').length, color: 'var(--tone-danger-dot)', href: atHref },
    { label: 'Accidents sans arrêt', n: y.filter((e) => e.type === 'AT' && (e.injury === 'sans_arret' || !e.injury)).length, color: 'var(--tone-warn-dot)', href: atHref },
    { label: 'Soins', n: y.filter((e) => e.type === 'AT' && e.injury === 'soins').length, color: 'var(--color-accent-500)', href: atHref },
    { label: 'Presque-accidents', n: y.filter((e) => e.type === 'PA').length, color: 'var(--color-accent-700)', href: link('/evenements?etat=tous&type=PA') },
    { label: 'Situations dangereuses', n: y.filter((e) => e.type === 'SD').length, color: 'var(--color-accent-800)', href: link('/evenements?etat=tous&type=SD') },
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

export type TodoRow = TodoItem & { key: string; read: boolean; screen: ScreenKey };

/**
 * Liste complète des échéances visibles, filtrée par domaine (écran) et « Mes échéances », groupée par urgence.
 * Un domaine absent de la liste (paramètre d'URL invalide ou sans échéance) est ignoré : `domain` renvoie le filtre retenu.
 */
export async function loadTodoPage({ domain: wanted, mine }: { domain?: string; mine: boolean }) {
  const now = today();
  const [{ user }, todo, reads] = await Promise.all([getSession(), loadVisibleTodo(), loadReadKeys()]);
  const all: TodoRow[] = todo.map((x) => {
    const key = todoKey(x);
    return { ...x, key, read: reads.has(key), screen: screenOfHref(x.href ?? '/'), overdue: !!x.overdue || x.date < now };
  });
  const mineRows = all.filter((x) => isMine(x, user));
  const scoped = mine ? mineRows : all;
  const order = NAV.flatMap((s) => s.items);
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
    counts: { all: all.length, mine: mineRows.length, overdue: items.filter(late).length, unread: items.filter((x) => !x.read).length },
    groups: groups.filter(([, rows]) => rows.length > 0),
  };
}

function fmtLongDate(iso: string) {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}
