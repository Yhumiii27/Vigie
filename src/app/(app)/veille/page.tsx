import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { Icon, MissingNotice, hrefWith } from '@/components/ui';
import { AddControlButton, ControlsPanel, type ControlSuggestions } from '@/components/watch/ControlsPanel';
import { AddRequirementButton, RequirementsPanel } from '@/components/watch/RequirementsPanel';
import { AddSafetyNoticeButton, SafetyRegisterPanel } from '@/components/watch/SafetyRegisterPanel';
import { today } from '@/lib/today';
import { canCreateAction } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { REQUIREMENT_EVAL, REQUIREMENT_REVIEW_MONTHS, SCREENS, canApprove as canApproveRole, canManage as canManageRole } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadFormOptions } from '@/lib/data/options';
import { CONTROL_FILTERS, loadSafetyNotices, loadWatch, type ControlFilter } from '@/lib/data/watch';
import { ALL_SITES } from '@/lib/session';
import { ARCHIVES, canonicalHref, missingDetail, wantsArchives } from '@/lib/url-state';
import { TipButton } from '@/components/Tip';
import { FilterBar } from '@/components/FilterBar';
import {
  SORT_DUE, controlChoices, filterControls, filterRequirements, hasListFilters, parseControlFilters, parseRequirementFilters, requirementChoices,
} from '@/lib/watch-filters';

export const metadata: Metadata = { title: SCREENS.watch.title };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const uniq = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));

export default async function WatchPage({ searchParams }: PageProps<'/veille'>) {
  const session = await guard('watch');
  const sp = await searchParams;
  // UX-12 : anciens paramètres (?archives=1, ?statut=archives) lus puis réécrits en ?etat=archives.
  const canonical = canonicalHref('/veille', sp);
  if (canonical) redirect(canonical);
  const canManage = canManageRole(session.role);
  const canApprove = canApproveRole(session.role);
  const [{ requirements, controls, certifications }, allOptions, register] = await Promise.all([loadWatch(), loadFormOptions(), loadSafetyNotices()]);
  const now = today();
  // VEI-10 : sites où une exigence s'applique, fixés par le périmètre complet seulement (liste vide sinon).
  const applicableSites = session.allowedSiteIds ? [] : session.siteOptions.filter((s) => s.id !== ALL_SITES).map((s) => [s.id, s.label.split(' — ')[0]] as const);
  const options = { people: allOptions.people, sites: allOptions.sites, applicableSites, certifications };
  // Plan d'actions (ACT-22) : création et rattachements réservés au service QHSE ; les autres rôles ne reçoivent ni les
  // listes du formulaire d'action ni la liste des actions ouvertes.
  const qhse = canCreateAction(session.role);
  const actionOptions: ActionFormOptions | null = qhse ? { people: allOptions.people, sites: allOptions.sites, today: now } : null;
  const linkActions = qhse ? allOptions.actions : undefined;
  // Exigences et contrôles en vigueur : les archivés ne comptent ni dans le sous-titre ni dans les onglets.
  const activeReqs = requirements.filter((r) => !r.archived);
  const activeCtrls = controls.filter((c) => !c.archived);
  const requirementOptions = activeReqs.map((r) => [String(r.id), r.text] as const);

  // Liens profonds : ?exigence=<id> et ?controle=<id> ouvrent directement la fiche, archivée comprise.
  const reqParam = Number(str(sp.exigence));
  const ctrlParam = Number(str(sp.controle));
  const openRequirement = requirements.find((r) => r.id === reqParam);
  const openControl = controls.find((c) => c.id === ctrlParam);
  // VEI-15 : registre de sécurité (?onglet=registre, fiche ?observation=<id>).
  const noticeParam = Number(str(sp.observation));
  const openNotice = register.notices.find((n) => n.id === noticeParam);
  const tab = sp.onglet === 'registre' || (sp.observation && !sp.onglet) ? 'registre'
    : sp.onglet === 'controles' || (openControl && sp.onglet !== 'exigences') ? 'controles' : 'exigences';
  // Portée « archivés » (?etat=archives, UX-12) : exigences archivées, ou filtre « Archivés » des contrôles.
  const archives = (tab === 'exigences' && wantsArchives(sp)) || !!openRequirement?.archived;
  const reqParams = { etat: archives ? ARCHIVES : undefined };
  const askedStatus = CONTROL_FILTERS.find((f) => f.key !== ARCHIVES && f.key === sp.statut)?.key;
  const filter = ((tab === 'controles' && wantsArchives(sp)) || (openControl?.archived && !askedStatus) ? ARCHIVES : askedStatus) as ControlFilter | undefined;
  const ctrlParams = { onglet: 'controles', statut: filter === ARCHIVES ? undefined : filter, etat: filter === ARCHIVES ? ARCHIVES : undefined };
  const ctrlChipHref = (key: ControlFilter | undefined) =>
    // VEI-13 : la recherche, le responsable et le tri sont gardés d'une catégorie à l'autre.
    hrefWith('/veille', { onglet: 'controles', q: ctrlFilters.q, tri: ctrlFilters.tri }, key === ARCHIVES ? { etat: ARCHIVES } : { statut: key });

  // VEI-13 : filtres, recherche et tri des exigences et des contrôles (src/lib/watch-filters.ts), portés par l'URL ; la fiche
  // ouverte par lien profond reste affichée même si les filtres l'écartent.
  const reqScope = requirements.filter((r) => r.archived === archives);
  const reqChoices = requirementChoices(reqScope, REQUIREMENT_EVAL);
  const reqFilters = tab === 'exigences' ? parseRequirementFilters(sp, reqChoices) : {};
  const reqFiltered = filterRequirements(reqScope, reqFilters);
  const reqRows = openRequirement && !reqFiltered.includes(openRequirement) ? [...reqFiltered, openRequirement] : reqFiltered;
  const ctrlScope = controls.filter((c) => (filter ? c.filter === filter : !c.archived));
  const ctrlChoices = controlChoices(ctrlScope);
  const ctrlFilters = tab === 'controles' ? parseControlFilters(sp, ctrlChoices) : {};
  const ctrlFiltered = filterControls(controls, ctrlFilters);
  const ctrlRows = openControl && !ctrlFiltered.includes(openControl) ? [...ctrlFiltered, openControl] : ctrlFiltered;
  const sortOptions = [[SORT_DUE, 'Échéance la plus proche']] as const;

  const openNotices = register.notices.filter((n) => !n.cancelled && !n.answeredOn).length;
  const tabs = [['exigences', 'Exigences', activeReqs.length], ['controles', 'Contrôles périodiques', activeCtrls.length], ['registre', 'Registre de sécurité', openNotices]] as const;
  const tabHref = (key: string) => (key === 'exigences' ? '/veille' : `/veille?onglet=${key}`);
  const counts = Object.fromEntries(CONTROL_FILTERS.map((f) => [f.key, controls.filter((c) => c.filter === f.key).length])) as Record<ControlFilter, number>;
  const chips = [{ key: undefined, label: 'Tous', n: activeCtrls.length }, ...CONTROL_FILTERS.map((f) => ({ key: f.key, label: f.label, n: counts[f.key] }))];
  const reqChips = [
    { on: !archives, label: 'Actives', n: activeReqs.length, href: '/veille' },
    { on: archives, label: 'Archivées', n: requirements.length - activeReqs.length, href: `/veille?etat=${ARCHIVES}` },
  ];

  const featured = activeReqs.find((r) => r.featured);
  const noticeOptions = { sites: allOptions.sites, controls: canManage ? register.controlOptions : [] };
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
            <Link key={key} href={tabHref(key)} scroll={false} className={`vg-tab${tab === key ? ' is-on' : ''}`}>
              <span>{label}</span><span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{n}</span>
            </Link>
          ))}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, paddingBottom: 6 }}>
            <TipButton className="btn btn-secondary vg-btn-sm" disabled tip="Import à venir"><Icon name="ph-upload-simple" size={13} />Importer (Excel)</TipButton>
            {tab === 'registre' && (
              // Lien HTML simple, nouvel onglet : la feuille d'impression ne reste pas chargée dans l'application.
              <a href="/veille/registre-securite" target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm"><Icon name="ph-printer" size={13} />Imprimer le registre</a>
            )}
            {canManage && (tab === 'exigences'
              ? <AddRequirementButton options={options} featured={featured ? { id: featured.id, text: featured.text } : null} />
              : tab === 'registre'
                ? <AddSafetyNoticeButton options={noticeOptions} defaultSite={defaultSite} today={now} />
                : <AddControlButton options={options} requirementOptions={requirementOptions} defaultSite={defaultSite} suggestions={suggestions} today={now} />)}
          </span>
        </div>

        {missingDetail(sp.exigence, !!openRequirement) && tab === 'exigences' && <MissingNotice text="Exigence introuvable." closeHref={hrefWith('/veille', reqParams, {})} />}
        {missingDetail(sp.controle, !!openControl) && tab === 'controles' && <MissingNotice text="Contrôle introuvable ou hors du site sélectionné." closeHref={hrefWith('/veille', ctrlParams, {})} />}
        {missingDetail(sp.observation, !!openNotice) && tab === 'registre' && <MissingNotice text="Observation introuvable ou hors du site sélectionné." closeHref="/veille?onglet=registre" />}
        {tab === 'registre' ? (
          <>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
              Observations et mises en demeure de l&apos;inspection du travail, de la CARSAT ou des organismes de contrôle (L. 4711-1). Le registre imprimé y joint les vérifications périodiques du site.
            </p>
            <SafetyRegisterPanel key={openNotice?.id ?? 'list'} rows={register.notices} canManage={canManage} canApprove={canApprove} options={noticeOptions} today={now}
              showSite={session.site.id === ALL_SITES} initialId={openNotice?.id} closeHref={openNotice ? '/veille?onglet=registre' : undefined} />
          </>
        ) : tab === 'exigences' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {reqChips.map((c) => (
                <Link key={c.label} href={c.href} scroll={false} className={`vg-chip${c.on ? ' is-on' : ''}`}>
                  {c.label}<span style={{ opacity: 0.6 }}>{c.n}</span>
                </Link>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                {`Réévaluation de la conformité tous les ${REQUIREMENT_REVIEW_MONTHS} mois, sauf périodicité propre à l'exigence`}
              </span>
            </div>
            <FilterBar path="/veille" base={reqParams} detail={['exigence']} fields={[
              { name: 'q', label: 'Recherche', search: true, placeholder: 'Texte, domaine, exigence…', value: reqFilters.q },
              { name: 'evaluation', label: 'Évaluation', all: 'Toutes', options: reqChoices.evaluations, value: reqFilters.evaluation },
              { name: 'domaine', label: 'Domaine', options: reqChoices.domains, value: reqFilters.domaine },
              { name: 'pilote', label: 'Pilote', options: reqChoices.pilots, value: reqFilters.pilote },
              { name: 'tri', label: 'Tri', all: 'Ordre de la veille', options: sortOptions, value: reqFilters.tri },
            ]} />
            <RequirementsPanel key={openRequirement?.id ?? 'list'} rows={reqRows} archives={archives}
              emptyText={hasListFilters(reqFilters) ? 'Aucune exigence ne correspond aux filtres.' : undefined} canManage={canManage} canApprove={canApprove}
              options={options} actionOptions={actionOptions} linkActions={linkActions} today={now} initialId={openRequirement?.id} closeHref={openRequirement ? hrefWith('/veille', reqParams, {}) : undefined} />
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {chips.map((c) => (
                <Link key={c.label} href={ctrlChipHref(c.key)} scroll={false} className={`vg-chip${filter === c.key ? ' is-on' : ''}`}>
                  {c.label}<span style={{ opacity: 0.6 }}>{c.n}</span>
                </Link>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                Prochain contrôle = dernier contrôle + périodicité
              </span>
            </div>
            <FilterBar path="/veille" base={ctrlParams} detail={['controle']} fields={[
              { name: 'q', label: 'Recherche', search: true, placeholder: 'Équipement, nature, organisme…', value: ctrlFilters.q },
              { name: 'responsable', label: 'Responsable', options: ctrlChoices.responsibles, value: ctrlFilters.responsable },
              { name: 'tri', label: 'Tri', all: 'Ordre de la veille', options: sortOptions, value: ctrlFilters.tri },
            ]} />
            <ControlsPanel key={openControl?.id ?? 'list'} rows={ctrlRows} filter={filter}
              emptyText={hasListFilters(ctrlFilters) ? 'Aucun contrôle ne correspond aux filtres.' : undefined} canManage={canManage} canApprove={canApprove}
              options={options} actionOptions={actionOptions} linkActions={linkActions} requirementOptions={requirementOptions} today={now}
              showSite={session.site.id === ALL_SITES} suggestions={suggestions}
              initialId={openControl?.id} closeHref={openControl ? hrefWith('/veille', ctrlParams, {}) : undefined} />
          </>
        )}
      </div>
    </>
  );
}
