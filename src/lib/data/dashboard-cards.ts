import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { isLate } from '../action-rules';
import {
  CARD_PERIODS, CARD_SCOPES, DASHBOARD_CARDS, DASHBOARD_ROLES, effectiveLayout, isDashboardRole, parseLayout, periodMonths, periodRange,
  type CardConfig, type DashboardRole,
} from '../dashboard-cards';
import { daysBetween, parisDay, toParisLocal } from '../dates';
import { CONTROL_HORIZON_DAYS, canOpen, canSeeHealth, isOpenAvancement, type Role, type Tone } from '../domain';
import { controlStatus, isOpen, loadActions, loadControls, loadEvents, loadSiteEvents, safetyRates, workforceAccident } from '../queries';
import { canReadDgi } from '../rules/dgi';
import { skillIndicators } from '../rules/skills';
import { signatureRate } from '../rules/safety-talks';
import { currentSiteId, getSession, inPerimeter, siteFilter, type SiteScope } from '../session';
import { appliesToSite } from '../watch-rules';
import { today } from '@/lib/today';
import { loadSkillData } from './skills';
import { latestAssessments } from './self-assessment';
import { loadSiteDirectory, shortSiteLabel } from './todo';

// Tableaux de bord configurables (TDB-19) : disposition de la personne (animateur QHSE, direction), sinon celle de son rôle,
// sinon celle de Vigie ; chaque carte est calculée à l'affichage d'après les mêmes données que les écrans, sur le site
// sélectionné ou tout le périmètre de la personne (jamais au-delà), et pour la période choisie. Aucune donnée de santé :
// agrégats seulement (comme le tableau de bord fixe) ; registre des dangers graves et imminents pour ses lecteurs.

export type CardView = {
  id: CardConfig['id']; label: string; value: string; sub: string; note: string; tone: Tone; href: string | null;
  /** « 12 derniers mois complets · tous les sites de mon périmètre ». */
  options: string;
};

const fr = (n: number, digits: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Lecteur des dispositions (personne connectée, ou rôle par défaut pour l'éditeur de l'animateur QHSE). */
async function readLayouts(personId: string) {
  const db = await getDb();
  const rows = await db.select().from(t.dashboardLayouts)
    .where(inArray(t.dashboardLayouts.role, [...DASHBOARD_ROLES]));
  const [own] = await db.select().from(t.dashboardLayouts).where(eq(t.dashboardLayouts.personId, personId));
  const roleRows = new Map(rows.filter((r) => r.personId == null).map((r) => [r.role as DashboardRole, r.cards]));
  return { own: own?.cards ?? null, roleRows };
}

/**
 * Tableau de bord configurable de la personne connectée : null pour les rôles au tableau de bord fixe. `cards` : cartes
 * calculées dans l'ordre ; `layout` : disposition appliquée (éditeur) ; `roleLayouts` : dispositions par défaut des rôles,
 * pour l'animateur QHSE seulement.
 */
export async function loadDashboardCards() {
  const session = await getSession();
  const { role, user, allowedSiteIds } = session;
  if (!isDashboardRole(role)) return null;
  const viewer = { health: canSeeHealth(role), dgi: canReadDgi(session) };
  const { own, roleRows } = await readLayouts(user.id);
  const { cards: layout, origin } = effectiveLayout(own, roleRows.get(role) ?? null, viewer);
  const site = await currentSiteId();
  const cards = await Promise.all(layout.filter((c) => c.id !== 'carte_sites').map((c) => computeCard(c, { role, site, allowed: allowedSiteIds })));
  return {
    cards,
    layout,
    origin,
    showSitesMap: layout.some((c) => c.id === 'carte_sites'),
    roleLayouts: role === 'Animateur QHSE'
      ? Object.fromEntries(DASHBOARD_ROLES.map((r) => [r, roleRows.has(r) ? parseLayout(roleRows.get(r)).cards : null])) as Record<DashboardRole, CardConfig[] | null>
      : null,
  };
}

const scopeOf = (c: CardConfig): SiteScope => (c.scope === 'perimetre' ? 'perimeter' : 'site');

async function computeCard(c: CardConfig, ctx: { role: Role; site: string | null; allowed: string[] | null }): Promise<CardView> {
  const def = DASHBOARD_CARDS[c.id];
  const now = today();
  const scope = scopeOf(c);
  const link = (href: string) => (canOpen(ctx.role, href) ? href : null);
  const options = [c.period ? CARD_PERIODS[c.period].label : null, c.scope ? CARD_SCOPES[c.scope] : null].filter(Boolean).join(' · ');
  const base = { id: c.id, label: def.label, options };
  const range = c.period ? periodRange(now, c.period) : null;
  const inRange = (day: string | null | undefined) => !!day && !!range && day >= range.from && day <= range.to;
  switch (c.id) {
    case 'jours_sans_at': {
      const last = (await loadEvents(scope)).find((e) => workforceAccident(e) && e.injury === 'arret');
      return { ...base, value: last ? String(daysBetween(last.occurredOn, now)) : '—', sub: '', note: last ? `Dernier AT avec arrêt le ${fmtDay(last.occurredOn)}` : 'Aucun accident avec arrêt enregistré', tone: 'ok', href: link('/evenements?etat=tous&type=AT&effectif=1') };
    }
    case 'tf1': {
      const db = await getDb();
      const [directory, hours, events] = await Promise.all([loadSiteDirectory(), db.select().from(t.hoursWorked), loadEvents(scope)]);
      const months = periodMonths(now, c.period ?? 'annee');
      const sites = directory.filter((s) => (scope === 'site' && ctx.site ? s.id === ctx.site : inPerimeter(ctx.allowed, s.id)));
      const ids = new Set(sites.map((s) => s.id));
      const rates = safetyRates({
        months, sites: sites.map((s) => ({ id: s.id, archivedOn: s.archivedAt ? toParisLocal(s.archivedAt).slice(0, 10) : null })),
        hours: hours.filter((h) => ids.has(h.siteId)), events,
      });
      const missing = rates.missing.length;
      return {
        ...base, value: rates.tf1 == null ? '—' : fr(rates.tf1, 1), sub: rates.tg == null ? '' : `TG ${fr(rates.tg, 2)}`,
        note: rates.hours === 0 ? 'Heures travaillées non saisies' : missing ? `${plural(missing, 'mois sans heures saisies', 'mois sans heures saisies')} — taux sur les mois saisis` : `${months.length} mois complets`,
        tone: rates.hours === 0 || missing ? 'warn' : 'neutral', href: link('/evenements?etat=tous&type=AT&effectif=1'),
      };
    }
    case 'evenements_ouverts': {
      const open = (await loadEvents(scope)).filter(isOpen);
      const old = open.filter((e) => daysBetween(e.occurredOn, now) > 30).length;
      return { ...base, value: String(open.length), sub: `dont ${old} > 30 j`, note: 'Événements non clos', tone: old ? 'warn' : 'neutral', href: link('/evenements') };
    }
    case 'evenements_declares': {
      const events = (await loadSiteEvents(scope)).filter((e) => inRange(parisDay(e.createdAt)));
      const safety = events.filter((e) => e.type === 'PA' || e.type === 'SD').length;
      return { ...base, value: String(events.length), sub: `dont ${safety} PA / SD`, note: `Déclarés du ${fmtDay(range!.from)} au ${fmtDay(range!.to)}`, tone: 'neutral', href: link(`/evenements?etat=tous&du=${range!.from}&au=${range!.to}`) };
    }
    case 'actions_retard': {
      const actions = await loadActions(scope);
      const late = actions.filter((a) => isLate(a, now));
      return { ...base, value: String(late.length), sub: `sur ${actions.filter((a) => isOpenAvancement(a.status)).length} ouvertes`, note: `${late.filter((a) => a.eventId).length} liées à des événements`, tone: late.length ? 'danger' : 'ok', href: link('/actions?retard=1') };
    }
    case 'actions_soldees': {
      const verified = (await loadActions(scope)).filter((a) => a.status === 'verifiee' && inRange(a.closedOn));
      const effective = verified.filter((a) => a.effective === true).length;
      const rate = pct(effective, verified.length);
      return { ...base, value: String(verified.length), sub: rate == null ? '' : `${rate} % efficaces`, note: `Vérifiées du ${fmtDay(range!.from)} au ${fmtDay(range!.to)}`, tone: rate != null && rate < 70 ? 'warn' : 'neutral', href: link('/actions?vue=statistiques') };
    }
    case 'controles':
    case 'controles_a_jour': {
      const ctrl = (await loadControls(scope)).map((x) => controlStatus(x, now));
      const overdue = ctrl.filter((s) => s.days < 0).length;
      if (c.id === 'controles') {
        const soon = ctrl.filter((s) => s.days <= CONTROL_HORIZON_DAYS).length;
        return { ...base, value: String(soon), sub: `dont ${overdue} dépassé${overdue > 1 ? 's' : ''}`, note: `À réaliser sous ${CONTROL_HORIZON_DAYS} jours`, tone: overdue ? 'danger' : 'warn', href: link('/veille?onglet=controles') };
      }
      const rate = pct(ctrl.length - overdue, ctrl.length);
      return { ...base, value: rate == null ? '—' : `${rate} %`, sub: `${ctrl.length - overdue}/${ctrl.length}`, note: overdue ? `${plural(overdue, 'contrôle dépassé', 'contrôles dépassés')}` : 'Aucun contrôle dépassé', tone: overdue ? 'danger' : 'ok', href: link('/veille?onglet=controles') };
    }
    case 'habilitations': {
      const ind = skillIndicators((await loadSkillData(scope)).rows, now);
      return { ...base, value: ind.rate == null ? '—' : `${ind.rate} %`, sub: `${ind.compliant}/${ind.required}`, note: `${plural(ind.lateRenewals, 'recyclage en retard', 'recyclages en retard')} (d’après Cursus)`, tone: ind.rate == null ? 'neutral' : ind.rate >= 90 ? 'ok' : 'warn', href: link('/habilitations') };
    }
    case 'veille': {
      const db = await getDb();
      const keep = await siteFilter(scope);
      const reqs = (await db.select({ evaluation: t.requirements.evaluation, siteIds: t.requirements.siteIds }).from(t.requirements).where(isNull(t.requirements.archivedAt)))
        .filter((r) => (scope === 'site' && ctx.site ? appliesToSite(r.siteIds, ctx.site) : !r.siteIds.length || r.siteIds.some((s) => keep(s))));
      const ok = reqs.filter((r) => r.evaluation === 'conforme').length;
      const gaps = reqs.filter((r) => r.evaluation === 'ecart').length;
      const rate = pct(ok, reqs.length);
      return { ...base, value: rate == null ? '—' : `${rate} %`, sub: `${ok}/${reqs.length} conformes`, note: `${plural(gaps, 'écart', 'écarts')} · ${reqs.filter((r) => r.evaluation === 'a_evaluer').length} à évaluer`, tone: gaps ? 'danger' : rate != null && rate < 80 ? 'warn' : 'ok', href: link('/veille') };
    }
    case 'nc_ouvertes': {
      const open = (await loadEvents(scope)).filter((e) => isOpen(e) && (e.type === 'NC' || e.type === 'RC'));
      return { ...base, value: String(open.length), sub: 'ouvertes', note: `${open.filter((e) => e.type === 'RC').length} réclamations client`, tone: 'neutral', href: link('/evenements?type=NC,RC') };
    }
    case 'dgi_ouverts': {
      const db = await getDb();
      const keep = await siteFilter(scope);
      const rows = (await db.select({ siteId: t.dgiNotices.siteId, measuresAt: t.dgiNotices.measuresAt }).from(t.dgiNotices)
        .where(and(isNull(t.dgiNotices.cancelledAt), isNull(t.dgiNotices.closedAt)))).filter((n) => keep(n.siteId));
      const waiting = rows.filter((n) => !n.measuresAt).length;
      return { ...base, value: String(rows.length), sub: waiting ? `dont ${waiting} sans mesures` : '', note: 'Avis non clos du registre', tone: waiting ? 'danger' : rows.length ? 'warn' : 'ok', href: link('/evenements/registre-dgi') };
    }
    case 'causeries': {
      const db = await getDb();
      const keep = await siteFilter(scope);
      const talks = (await db.select({ id: t.safetyTalks.id, siteId: t.safetyTalks.siteId, heldOn: t.safetyTalks.heldOn }).from(t.safetyTalks).where(isNull(t.safetyTalks.cancelledAt)))
        .filter((x) => keep(x.siteId) && inRange(x.heldOn));
      const parts = talks.length ? await db.select({ signedAt: t.safetyTalkParticipants.signedAt }).from(t.safetyTalkParticipants).where(inArray(t.safetyTalkParticipants.talkId, talks.map((x) => x.id))) : [];
      const share = signatureRate(parts);
      const rate = share == null ? null : Math.round(share * 100);
      return { ...base, value: String(talks.length), sub: rate == null ? '' : `émargement ${rate} %`, note: `Tenues du ${fmtDay(range!.from)} au ${fmtDay(range!.to)}`, tone: rate != null && rate < 80 ? 'warn' : 'neutral', href: link('/prevention?vue=causeries') };
    }
    case 'auto_evaluation': {
      const list = await latestAssessments({ site: scope === 'site' ? ctx.site : null, allowed: ctx.allowed, asOf: now });
      const latest = [...list].sort((a, b) => b.assessedOn.localeCompare(a.assessedOn))[0];
      return {
        ...base, value: latest?.rate == null ? '—' : `${latest.rate} %`, sub: latest ? `${latest.standard} · ${shortSiteLabel(latest.site)}` : '',
        note: list.length ? list.map((a) => `${a.standard} ${a.rate == null ? '—' : `${a.rate} %`}`).join(' · ') : 'Aucune campagne clôturée',
        tone: latest?.rate == null ? 'neutral' : latest.rate >= 80 ? 'ok' : 'warn', href: link('/audits?vue=auto-evaluation'),
      };
    }
    case 'carte_sites':
      return { ...base, value: '', sub: '', note: '', tone: 'neutral', href: null };
  }
}

function fmtDay(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

