import 'server-only';
import { getDb, schema as t } from '@/db';
import { addDays, daysBetween, today } from '../dates';
import { canOpen, type Tone } from '../domain';
import { actionColumn, controlStatus, eventView, isOpen, lcfirst, loadActions, loadControls, loadEvents, loadPeople, type EventRow } from '../queries';
import { currentSiteId, getSession, inSite } from '../session';
import { loadTodo } from './todo';

// ─── Tableau de bord ────────────────────────────────────────────────────────

export const TF1_TARGET = 4;

const fr = (n: number, digits: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export async function loadDashboard() {
  const db = await getDb();
  const now = today();
  const yearAgo = addDays(now, -365);
  const [people, events, actions, controls, allHours, reqs, site] = await Promise.all([
    loadPeople(), loadEvents(), loadActions(), loadControls(),
    db.select().from(t.hoursWorked),
    db.select().from(t.requirements),
    currentSiteId(),
  ]);
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
  const soon = ctrl.filter((x) => x.s.days <= 30);
  const overdue = ctrl.filter((x) => x.s.days < 0);
  const equipShort = (e: string) => e.split(' — ')[0];

  const ncOpen = open.filter((e) => e.type === 'NC' || e.type === 'RC');
  const ncBy = new Map<string, number>();
  ncOpen.forEach((e) => {
    const k = e.type === 'RC' ? 'Réclamation client' : e.ncOrigin ?? 'Autre';
    ncBy.set(k, (ncBy.get(k) ?? 0) + 1);
  });
  const ncTop = [...ncBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${k} ${n}`).join(' · ');

  const kpis: { label: string; value: string; sub: string; note: string; tone: Tone }[] = [
    { label: 'Jours sans accident avec arrêt', value: lastArret ? String(daysBetween(lastArret.occurredOn, now)) : '—', sub: '', note: lastArret ? `Dernier AT avec arrêt le ${fmtLongDate(lastArret.occurredOn)}` : 'Aucun accident avec arrêt enregistré', tone: 'ok' },
    { label: 'TF1 · 12 mois glissants', value: fr(tf1, 1), sub: `TG ${fr(tg, 2)}`, note: `Objectif ${now.slice(0, 4)} : TF1 < ${TF1_TARGET}`, tone: 'neutral' },
    { label: 'Événements ouverts', value: String(open.length), sub: `dont ${old} > 30 j`, note: `${recent} déclaré${recent > 1 ? 's' : ''} sur les 7 derniers jours`, tone: 'warn' },
    { label: 'Actions en retard', value: String(late.length), sub: `sur ${openActions} ouvertes`, note: `${late.filter((x) => x.a.eventId).length} liées à des événements`, tone: 'danger' },
    { label: 'Contrôles réglementaires < 30 j', value: String(soon.length), sub: `dont ${overdue.length} dépassé${overdue.length > 1 ? 's' : ''}`, note: overdue[0] ? `${overdue[0].c.controlType.split(' ')[0]} ${lcfirst(equipShort(overdue[0].c.equipment))} · +${-overdue[0].s.days} j` : 'Aucun contrôle dépassé', tone: overdue.length ? 'danger' : 'warn' },
    { label: 'Non-conformités', value: String(ncOpen.length), sub: 'ouvertes', note: ncTop || '—', tone: 'neutral' },
  ];

  // Pyramide des événements sécurité (12 mois glissants)
  const y = events.filter(last12);
  const pyramid = [
    { label: 'Accidents avec arrêt', n: y.filter((e) => e.type === 'AT' && e.injury === 'arret').length, color: 'var(--tone-danger-dot)' },
    { label: 'Accidents sans arrêt', n: y.filter((e) => e.type === 'AT' && (e.injury === 'sans_arret' || !e.injury)).length, color: 'var(--tone-warn-dot)' },
    { label: 'Soins', n: y.filter((e) => e.type === 'AT' && e.injury === 'soins').length, color: 'var(--color-accent-500)' },
    { label: 'Presque-accidents', n: y.filter((e) => e.type === 'PA').length, color: 'var(--color-accent-700)' },
    { label: 'Situations dangereuses', n: y.filter((e) => e.type === 'SD').length, color: 'var(--color-accent-800)' },
  ];
  const pyrMax = Math.max(1, ...pyramid.map((p) => p.n));

  const ncLabels: [string, string][] = [['Fournisseurs', 'Fournisseurs'], ['Fabrication', 'Fabrication'], ['Conception BE', 'Conception BE'], ['Mise en service', 'Mise en service'], ['Réclamation client', 'Réclamations client']];
  const ncMax = Math.max(1, ...ncBy.values());

  const { role } = await getSession();
  const todo = (await loadTodo()).filter((x) => canOpen(role, x.href));

  const featured = reqs.find((r) => r.featured);

  return {
    kpis,
    pyramid: pyramid.map((p) => ({ ...p, w: `${Math.max(5, Math.round((p.n / pyrMax) * 100))}%` })),
    ncOrigins: ncLabels.map(([key, label]) => ({ label, n: ncBy.get(key) ?? 0, w: `${Math.round(((ncBy.get(key) ?? 0) / ncMax) * 100)}%` })),
    ncOpen: ncOpen.length,
    todo,
    latest: events.slice(0, 6).map((e) => eventView(e, people, now)),
    featured: featured && featured.dueOn ? {
      id: featured.id,
      title: `${featured.text} — ${featured.domain.split(' — ')[0].toLowerCase()}`,
      lead: featured.summary.split(' : ')[0].replace(/\.?$/, '.'),
      dueOn: featured.dueOn,
      daysLeft: daysBetween(now, featured.dueOn),
      impact: featured.impact,
      projects: featured.keystoneProjects,
      actionId: featured.actionId,
    } : null,
  };
}

function fmtLongDate(iso: string) {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}
