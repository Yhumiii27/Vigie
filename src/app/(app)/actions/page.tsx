import type { Metadata } from 'next';
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

export const metadata: Metadata = { title: SCREENS.actions.title };

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

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
      ? <>L&apos;action {requested} relève du {lcSite(link.elsewhere)} : sélectionnez ce site ou « Tous les sites » dans la barre latérale pour l&apos;ouvrir.</>
      : <>L&apos;action {requested} est introuvable dans le plan d&apos;actions.</>
    : null;

  return (
    <>
      <PageHeader title={SCREENS.actions.title} sub={filters.etat === 'abandonnees'
        ? `${plural(counts.abandoned, 'action')} abandonnée${counts.abandoned > 1 ? 's' : ''}`
        : `${plural(counts.open, 'action')} ouverte${counts.open > 1 ? 's' : ''} · ${counts.late} en retard`} />
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
            <Link href={hrefWith('/actions', params, {})} scroll={false} className="vg-link">Masquer</Link>
          </div>
        )}

        <ActionPlanProvider requestedId={requested} payload={link?.payload ?? null} options={options}
          currentUserId={session.user.id} today={now} verifyDefault={addDays(now, 30)}>
          {filtered && !stats && (
            <div style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
              {items.length === 0
                ? (filters.mes ? "Vous n'êtes responsable d'aucune action correspondant à ces critères." : 'Aucune action ne correspond à ces critères.')
                : plural(items.length, 'action')}
            </div>
          )}

          {stats ? (
            <ActionStatsView stats={stats} siteLabel={session.site.id === ALL_SITES ? 'tous les sites du périmètre' : session.site.label}
              today={now} href={(mois) => hrefWith('/actions', { vue: 'statistiques' }, { mois })} />
          ) : emptyPlan ? (
            <div className="card" style={{ alignItems: 'center', justifyItems: 'center', textAlign: 'center', gap: 10, padding: '28px 16px' }}>
              <Icon name="ph-list-checks" size={26} style={{ color: 'var(--color-neutral-500)' }} />
              <div style={{ fontSize: 13, color: 'var(--color-neutral-300)' }}>
                {employee ? 'Aucune action dont vous êtes responsable.' : 'Aucune action en cours sur ce site.'}
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
