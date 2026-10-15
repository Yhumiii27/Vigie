import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { Icon, MissingNotice, hrefWith } from '@/components/ui';
import { AddControlButton, ControlsPanel, type ControlSuggestions } from '@/components/watch/ControlsPanel';
import { AddRequirementButton, RequirementsPanel } from '@/components/watch/RequirementsPanel';
import { today } from '@/lib/today';
import { REQUIREMENT_REVIEW_MONTHS, SCREENS, canApprove as canApproveRole, canManage as canManageRole } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadFormOptions } from '@/lib/data/options';
import { CONTROL_FILTERS, loadWatch, type ControlFilter } from '@/lib/data/watch';
import { ALL_SITES } from '@/lib/session';

export const metadata: Metadata = { title: SCREENS.watch.title };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const uniq = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));

export default async function WatchPage({ searchParams }: PageProps<'/veille'>) {
  const session = await guard('watch');
  const sp = await searchParams;
  const canManage = canManageRole(session.role);
  const canApprove = canApproveRole(session.role);
  const [{ requirements, controls }, allOptions] = await Promise.all([loadWatch(), loadFormOptions()]);
  const options = { people: allOptions.people, sites: allOptions.sites, origins: allOptions.origins, actions: allOptions.actions };
  const now = today();
  // Exigences et contrôles en vigueur : les archivés ne comptent ni dans le sous-titre ni dans les onglets.
  const activeReqs = requirements.filter((r) => !r.archived);
  const activeCtrls = controls.filter((c) => !c.archived);
  const requirementOptions = activeReqs.map((r) => [String(r.id), r.text] as const);

  // Liens profonds : ?exigence=<id> et ?controle=<id> ouvrent directement la fiche, archivée comprise.
  const reqParam = Number(str(sp.exigence));
  const ctrlParam = Number(str(sp.controle));
  const openRequirement = requirements.find((r) => r.id === reqParam);
  const openControl = controls.find((c) => c.id === ctrlParam);
  const tab = sp.onglet === 'controles' || (openControl && sp.onglet !== 'exigences') ? 'controles' : 'exigences';
  const archives = sp.archives === '1' || !!openRequirement?.archived;
  const reqParams = { archives: archives ? '1' : undefined };
  const filter = (openControl?.archived && !sp.statut ? 'archives' : CONTROL_FILTERS.find((f) => f.key === sp.statut)?.key) as ControlFilter | undefined;
  const ctrlParams = { onglet: 'controles', statut: filter };

  const tabs = [['exigences', 'Exigences', activeReqs.length], ['controles', 'Contrôles périodiques', activeCtrls.length]] as const;
  const counts = Object.fromEntries(CONTROL_FILTERS.map((f) => [f.key, controls.filter((c) => c.filter === f.key).length])) as Record<ControlFilter, number>;
  const chips = [{ key: undefined, label: 'Tous', n: activeCtrls.length }, ...CONTROL_FILTERS.map((f) => ({ key: f.key, label: f.label, n: counts[f.key] }))];
  const reqChips = [
    { on: !archives, label: 'Actives', n: activeReqs.length, href: '/veille' },
    { on: archives, label: 'Archivées', n: requirements.length - activeReqs.length, href: '/veille?archives=1' },
  ];

  const featured = activeReqs.find((r) => r.featured);
  const defaultSite = session.site.id === ALL_SITES ? options.sites[0]?.[0] ?? '' : session.site.id;
  const suggestions: ControlSuggestions = {
    types: uniq(controls.map((c) => c.controlType)),
    organizations: uniq([...controls.map((c) => c.organization), ...controls.flatMap((c) => c.records.map((r) => r.organization))]),
  };
  const gaps = activeReqs.filter((r) => r.evaluation === 'ecart').length;
  const s = (n: number) => (n > 1 ? 's' : '');
  const sub = [
    `${activeReqs.length} exigence${s(activeReqs.length)}${gaps ? ` dont ${gaps} en écart` : ''}`,
    `${activeCtrls.length} contrôle${s(activeCtrls.length)} périodique${s(activeCtrls.length)}${counts.depasses ? ` dont ${counts.depasses} dépassé${s(counts.depasses)}` : ''}`,
  ].join(' · ');

  return (
    <>
      <PageHeader title={SCREENS.watch.title} sub={sub} />
      <div className="vg-page">
        <div className="vg-tabs">
          {tabs.map(([key, label, n]) => (
            <Link key={key} href={key === 'exigences' ? '/veille' : '/veille?onglet=controles'} scroll={false} className={`vg-tab${tab === key ? ' is-on' : ''}`}>
              <span>{label}</span><span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{n}</span>
            </Link>
          ))}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, paddingBottom: 6 }}>
            <span title="Import à venir" style={{ display: 'inline-flex' }}>
              <button type="button" className="btn btn-secondary vg-btn-sm" disabled><Icon name="ph-upload-simple" size={13} />Importer (Excel)</button>
            </span>
            {canManage && (tab === 'exigences'
              ? <AddRequirementButton options={options} featured={featured ? { id: featured.id, text: featured.text } : null} />
              : <AddControlButton options={options} requirementOptions={requirementOptions} defaultSite={defaultSite} suggestions={suggestions} today={now} />)}
          </span>
        </div>

        {sp.exigence && !openRequirement && tab === 'exigences' && <MissingNotice text="Exigence introuvable." closeHref={hrefWith('/veille', reqParams, {})} />}
        {sp.controle && !openControl && tab === 'controles' && <MissingNotice text="Contrôle introuvable ou hors du site sélectionné." closeHref={hrefWith('/veille', ctrlParams, {})} />}
        {tab === 'exigences' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {reqChips.map((c) => (
                <Link key={c.label} href={c.href} scroll={false} className={`vg-chip${c.on ? ' is-on' : ''}`}>
                  {c.label}<span style={{ opacity: 0.6 }}>{c.n}</span>
                </Link>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                {`Réévaluation de la conformité tous les ${REQUIREMENT_REVIEW_MONTHS} mois`}
              </span>
            </div>
            <RequirementsPanel key={openRequirement?.id ?? 'list'} rows={requirements} archives={archives} canManage={canManage} canApprove={canApprove}
              options={options} today={now} initialId={openRequirement?.id} closeHref={openRequirement ? hrefWith('/veille', reqParams, {}) : undefined} />
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {chips.map((c) => (
                <Link key={c.label} href={hrefWith('/veille', ctrlParams, { statut: c.key })} scroll={false} className={`vg-chip${filter === c.key ? ' is-on' : ''}`}>
                  {c.label}<span style={{ opacity: 0.6 }}>{c.n}</span>
                </Link>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                Prochain contrôle = dernier contrôle + périodicité
              </span>
            </div>
            <ControlsPanel key={openControl?.id ?? 'list'} rows={controls} filter={filter} canManage={canManage} canApprove={canApprove}
              options={options} requirementOptions={requirementOptions} today={now}
              showSite={session.site.id === ALL_SITES} suggestions={suggestions}
              initialId={openControl?.id} closeHref={openControl ? hrefWith('/veille', ctrlParams, {}) : undefined} />
          </>
        )}
      </div>
    </>
  );
}
