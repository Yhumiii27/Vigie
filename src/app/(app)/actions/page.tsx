import Link from 'next/link';
import { NewActionButton } from '@/components/ActionFormDialog';
import { PageHeader } from '@/components/PageHeader';
import { ActionPlanProvider } from '@/components/actions/ActionPlanProvider';
import { KanbanBoard } from '@/components/actions/KanbanBoard';
import { ActionFiltersBar, hasFilters, planParams } from '@/components/actions/plan/ActionFilters';
import { AbandonedList, ActionList } from '@/components/actions/plan/ActionList';
import { ByResponsable } from '@/components/actions/plan/ByResponsable';
import { ActionStatsView } from '@/components/actions/plan/ActionStats';
import { Icon, hrefWith } from '@/components/ui';
import { KANBAN_COLUMNS, VERIFIED_ALL_LABEL, canCreateAction, canReadPlan, parseActionFilters } from '@/lib/action-rules';
import type { ActionDefaults } from '@/lib/action-view';
import { addDays } from '@/lib/dates';
import { SCREENS, TONE, isEmployee } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { ALL_SITES } from '@/lib/session';
import { loadActionDetail, loadActionFormOptions, loadActionPlan } from '@/lib/data/actions';
import { loadActionStats } from '@/lib/data/action-stats';
import { getI18n, screenMetadata } from '@/i18n/server';
import { fill } from '@/i18n/translate';

export const generateMetadata = () => screenMetadata('actions');

/** « Site de [Ville B] — zone d'essais » → « site de [Ville B] » (après « relève du »). */
const lcSite = (label: string) => {
  const short = label.split(' — ')[0];
  return short.startsWith('Site ') ? `s${short.slice(1)}` : short;
};

/**
 * Plan d'actions QSE unique (spec § 16) : vue Liste par défaut, Kanban, Par responsable ; filtres et affichage portés par
 * l'URL (parseActionFilters, alias ?etat=annulees, ?vue=pilote, ?pilote=) ; fiche ouverte par ?action=, rendue côté
 * serveur (loadActionDetail). Seul le service QHSE crée une action (ACT-22) : les autres lecteurs ne reçoivent aucune
 * liste de formulaire.
 */
export default async function ActionsPage({ searchParams }: PageProps<'/actions'>) {
  const session = await guard('actions');
  const { t } = await getI18n();
  const actionCount = (n: number) => fill(n > 1 ? t('{n} actions') : t('{n} action'), { n });
  const parsed = parseActionFilters(await searchParams);
  // Statistiques (ACT-29) : lecteurs du plan seulement ; le Salarié revient à la vue Liste de ses actions.
  const statsView = parsed.vue === 'statistiques' && canReadPlan(session.role);
  const filters = parsed.vue === 'statistiques' && !statsView ? { ...parsed, vue: 'liste' as const } : parsed;
  const create = canCreateAction(session.role);
  const [plan, options, link, stats] = await Promise.all([
    loadActionPlan(filters),
    loadActionFormOptions({ targets: create }),
    filters.action ? loadActionDetail(filters.action) : null,
    statsView ? loadActionStats(filters.mois) : null,
  ]);
  const { items, responsables, counts, totals, now } = plan;
  const employee = isEmployee(session.role);
  const filtered = hasFilters(filters);
  const params = planParams(filters);
  const emptyPlan = filters.etat === '' && items.length === 0 && !filtered;

  // Création (QHSE) : site sélectionné proposé (« Tous les sites » : le QHSE choisit), responsable et source des filtres.
  const newDefaults: ActionDefaults = {
    siteId: session.site.id === ALL_SITES ? undefined : session.site.id,
    ...(filters.responsable || filters.mes ? { pilotId: filters.mes ? session.user.id : filters.responsable! } : {}),
    ...(filters.source ? { source: filters.source } : {}),
  };
  const newButton = create ? <NewActionButton options={options} defaults={newDefaults} /> : null;

  const requested = filters.action;
  const banner = requested && !link?.payload
    ? link?.elsewhere
      ? <>{fill(t('Action {id} belongs to the {site}: select that site or “All sites” in the sidebar to open it.'), { id: requested, site: lcSite(link.elsewhere) })}</>
      : <>{fill(t('Action {id} cannot be found in the action plan.'), { id: requested })}</>
    : null;

  return (
    <>
      <PageHeader title={SCREENS.actions.title} sub={filters.etat === 'abandonnees'
        ? fill(counts.abandoned > 1 ? t('{n} abandoned actions') : t('{n} abandoned action'), { n: counts.abandoned })
        : `${fill(counts.open > 1 ? t('{n} open actions') : t('{n} open action'), { n: counts.open })} · ${fill(t('{n} overdue'), { n: counts.late })}`} />
      <div className="vg-page">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ActionFiltersBar filters={filters} responsables={employee ? [] : responsables} counts={counts}
              employee={employee} userName={session.user.name} mineCount={counts.mine} />
          </div>
          {newButton}
        </div>

        {banner && (
          <div className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: '10px 14px', fontSize: 12.5 }}>
            <Icon name="ph-info" size={15} style={{ color: TONE.warn.dot }} />
            <span style={{ flex: 1, minWidth: 0, textWrap: 'pretty' }}>{banner}</span>
            <Link href={hrefWith('/actions', params, {})} scroll={false} className="vg-link">{t('Hide')}</Link>
          </div>
        )}

        <ActionPlanProvider requestedId={requested} payload={link?.payload ?? null} options={options}
          currentUserId={session.user.id} today={now} verifyDefault={addDays(now, 30)}>
          {filtered && !stats && (
            <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
              {items.length === 0
                ? (filters.mes ? t('You are the owner of no action matching these criteria.') : t('No action matches these criteria.'))
                : actionCount(items.length)}
            </div>
          )}

          {stats ? (
            <ActionStatsView stats={stats} siteLabel={session.site.id === ALL_SITES ? t('all the sites of the scope') : session.site.label}
              today={now} href={(mois) => hrefWith('/actions', { vue: 'statistiques' }, { mois })} />
          ) : emptyPlan ? (
            <div className="card" style={{ alignItems: 'center', justifyItems: 'center', textAlign: 'center', gap: 10, padding: '28px 16px' }}>
              <Icon name="ph-list-checks" size={26} style={{ color: 'var(--color-neutral-500)' }} />
              <div style={{ fontSize: 13, color: 'var(--color-neutral-300)' }}>
                {employee ? t('No action of which you are the owner.') : t('No action in progress on this site.')}
              </div>
              {newButton}
            </div>
          ) : filters.etat === 'abandonnees' ? (
            <AbandonedList items={items} filtered={filtered} />
          ) : filters.vue === 'kanban' ? (
            <KanbanBoard columns={KANBAN_COLUMNS.map((c) => ({
              key: c.key, label: c.key === 'verifiee' && filters.etat === 'historique' ? VERIFIED_ALL_LABEL : c.label, tone: c.tone,
              cards: items.filter((a) => a.kanban === c.key),
            }))} />
          ) : filters.vue === 'responsable' ? (
            <ByResponsable items={items} />
          ) : (
            <ActionList items={items} totals={totals} filtered={filtered} />
          )}
        </ActionPlanProvider>
      </div>
    </>
  );
}
