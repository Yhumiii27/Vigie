import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Segments, Toolbar } from '@/components/Segments';
import { PageHeader } from '@/components/PageHeader';
import { ContractorsTable, NewContractorButton } from '@/components/prevention/ContractorDialogs';
import {
  PERMIT_FILTERS, PERMIT_TYPE_FILTERS, PLAN_FILTERS, filterParam, interventionFilters, matchesIntervention, pickFilter, pickType, shownFilters,
} from '@/components/prevention/filters';
import { FilterBar } from '@/components/FilterBar';
import { NewPermitButton, PermitAlertActions, PermitsTable } from '@/components/prevention/PermitDialogs';
import { NewPlanButton, PlanAlertActions, PlansTable } from '@/components/prevention/PlanDialogs';
import { SiteRuleButton } from '@/components/prevention/SiteRuleDialogs';
import { ProcedureNote, type PreventionOptions } from '@/components/prevention/parts';
import { Icon, MissingNotice, SegLinks, hrefWith } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { SCREENS, TONE, canApprove, canManage } from '@/lib/domain';
import { isQhse } from '@/lib/action-rules';
import { SAFETY_TALKS_HREF, SAFETY_TALKS_VIEW } from '@/lib/rules/safety-talks';
import { loadSafetyTalks } from '@/lib/data/safety-talks';
import { SafetyTalksView } from '@/components/prevention/SafetyTalks';
import { guard } from '@/lib/guard';
import { loadFormOptions } from '@/lib/data/options';
import { loadPrevention, type PlanView, type SiteRuleView } from '@/lib/data/prevention';
import { lcfirst } from '@/lib/queries';
import { ARCHIVES, canonicalHref, missingDetail, wantsArchives } from '@/lib/url-state';
import { GateHouseView } from '@/components/prevention/GateHouse';
import { SimopsView } from '@/components/prevention/SimopsView';
import { loadSimops } from '@/lib/data/simops';
import { SIMOPS_VIEW, parseSimopsDay, simopsHref } from '@/lib/rules/simops';
import { today } from '@/lib/today';
import { loadGateHouse } from '@/lib/data/gate-house';
import { GATE_HOUSE_PATH, GATE_HOUSE_VIEW, canReadGateHouse, parseHorizon } from '@/lib/rules/gate-house';
import { getI18n } from '@/i18n/server';
import { fill, type T } from '@/i18n/translate';

export const metadata: Metadata = { title: SCREENS.prevention.title };

const TABS = [['plans', 'Prevention plans'], ['permis', 'Permits'], ['entreprises', 'External companies']] as const;
type Tab = (typeof TABS)[number][0];

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const plural = (n: number, one: string, many: string) => fill(n > 1 ? many : one, { n });

/** Classement commun des sites soumis à la règle « dès la première minute » (« Établissement Seveso seuil haut »). */
function ruleClass(rules: SiteRuleView[], t: T) {
  if (rules.length && rules[0].seveso && rules.every((r) => r.seveso === rules[0].seveso)) return rules[0].classLabel;
  return rules.length > 1 ? t('Internal rule of the sites') : t('Internal rule of the site');
}

/** Ce qui manque au plan pour être en règle (alerte R. 4512-6). */
function missingLabel(p: PlanView, t: T) {
  const parts = [];
  if (!p.inspectionDone) parts.push(t('prior joint inspection not carried out'));
  if (!p.signedEuOn && !p.signedEeOn) parts.push(t('no signature'));
  else if (!p.signedEuOn) parts.push(t('signature of the host company missing'));
  else if (!p.signedEeOn) parts.push(t('signature of the external company missing'));
  return parts.join(', ');
}

export default async function PreventionPage({ searchParams }: PageProps<'/prevention'>) {
  const { role } = await guard('prevention');
  const { t } = await getI18n();
  const sp = await searchParams;
  // UX-12 : ancien ?filtre=archivees (entreprises) lu puis réécrit en ?etat=archives.
  const canonical = canonicalHref('/prevention', sp);
  if (canonical) redirect(canonical);
  // PRV-25 : liste du poste de garde (?vue=poste-de-garde&horizon=), lecteurs canReadGateHouse.
  const gateOn = str(sp.vue) === GATE_HOUSE_VIEW && canReadGateHouse(role);
  // CNF-09 : causeries et quarts d'heure sécurité (?vue=causeries&causerie=CS-001).
  const talksOn = !gateOn && str(sp.vue) === SAFETY_TALKS_VIEW;
  // PRV-22 : opérations simultanées par zone et par heure (?vue=simops&jour=AAAA-MM-JJ), en lecture.
  const simopsOn = !gateOn && !talksOn && str(sp.vue) === SIMOPS_VIEW;
  const [d, formOptions, gate, talks, simops] = await Promise.all([
    loadPrevention(), loadFormOptions(), gateOn ? loadGateHouse(parseHorizon(str(sp.horizon))) : null, talksOn ? loadSafetyTalks() : null,
    simopsOn ? loadSimops(parseSimopsDay(str(sp.jour), today())) : null,
  ]);
  const alt = !!gate || !!talks || !!simops;
  const manage = canManage(role);
  const approve = canApprove(role);

  // Règle des sites affichés : plan « dès la première minute » (établissements Seveso) ou règle légale R. 4512-7.
  const ruleSites = d.siteRules.filter((r) => r.ppFromFirstMinute);
  const allRule = ruleSites.length > 0 && ruleSites.length === d.siteRules.length;
  const alertCount = d.alerts.length + d.permitAlerts.length;

  // Lien direct vers une fiche (notifications, tableau de bord) : ?plan=PP-2026-013 · ?permis=PF-2026-030
  const openPlan = d.plans.find((p) => p.id === str(sp.plan));
  const openPermit = d.permits.find((p) => p.id === str(sp.permis));
  const tab: Tab = openPlan ? 'plans' : openPermit ? 'permis' : TABS.find(([k]) => k === str(sp.onglet))?.[0] ?? 'plans';

  // Plans : filtre par phase (?filtre=) ; une fiche ouverte par lien direct bascule sur le filtre qui la contient.
  // PRV-14 : filtres par entreprise extérieure (?entreprise=) et par projet Keystone (?projet=), sur l'onglet affiché ;
  // sur l'onglet Entreprises, ?entreprise= ouvre la fiche de l'entreprise.
  const asked = { entreprise: str(sp.entreprise), projet: str(sp.projet) };
  const planSel = interventionFilters(d.plans, tab === 'plans' ? asked : {}, openPlan);
  const permitSel = interventionFilters(d.permits, tab === 'permis' ? asked : {}, openPermit);
  const planFilter = pickFilter(PLAN_FILTERS, tab === 'plans' ? str(sp.filtre) : undefined, openPlan?.phase);
  const planScope = d.plans.filter((p) => matchesIntervention(p, planSel.filters));
  const plans = planScope.filter((p) => planFilter.states.includes(p.phase));
  const planCount = (f: (typeof PLAN_FILTERS)[number]) => planScope.filter((p) => f.states.includes(p.phase)).length;
  const planParams = { filtre: filterParam(PLAN_FILTERS, planFilter), ...planSel.filters };

  // Permis : filtre par état (?filtre=) puis par type (?type=), compteurs des types après le filtre d'état.
  const permitFilter = pickFilter(PERMIT_FILTERS, tab === 'permis' ? str(sp.filtre) : undefined, openPermit?.state);
  const permitType = pickType(str(sp.type), openPermit?.type);
  const permitScope = d.permits.filter((p) => matchesIntervention(p, permitSel.filters));
  const byState = permitScope.filter((p) => permitFilter.states.includes(p.state));
  const permits = permitType ? byState.filter((p) => p.type === permitType) : byState;
  const permitCount = (f: (typeof PERMIT_FILTERS)[number]) => permitScope.filter((p) => f.states.includes(p.state) && (!permitType || p.type === permitType)).length;
  const permitParams = { filtre: filterParam(PERMIT_FILTERS, permitFilter), type: permitType ?? undefined, ...permitSel.filters };
  const registerHref = hrefWith('/prevention/imprimer/permis', {}, permitParams);

  // Entreprises : actives (par défaut) ou archivées.
  // Entreprises archivées : ?etat=archives (UX-12 ; l'ancien ?filtre=archivees est réécrit par le proxy et ci-dessus).
  // PRV-14 : fiche d'une entreprise ouverte par lien direct (?onglet=entreprises&entreprise=<id>), archivée comprise.
  const openContractor = tab === 'entreprises' ? d.contractors.find((c) => c.id === str(sp.entreprise)) : undefined;
  const showArchived = tab === 'entreprises' && (wantsArchives(sp) || !!openContractor?.archived);
  const contractors = d.contractors.filter((c) => c.archived === showArchived);
  const archivedCount = d.contractors.filter((c) => c.archived).length;

  const options: PreventionOptions = {
    people: formOptions.people,
    sites: formOptions.sites,
    projects: formOptions.projects,
    projectsMessage: formOptions.projectsMessage,
    contractors: d.choices.contractors,
    plans: d.choices.plans,
    siteRules: d.siteRules,
    defaultSiteId: d.choices.defaultSiteId,
    recordSites: d.choices.recordSites,
    siteLocked: d.choices.siteLocked,
    today: d.now,
    procedure: d.procedure,
    workers: manage ? d.choices.workers : [],
    canVeto: isQhse(role),
  };
  const tabHref = (k: Tab) => (k === 'plans' ? '/prevention' : `/prevention?onglet=${k}`);
  // Lien direct (?plan=, ?permis=) sans fiche sur le site sélectionné (brouillon supprimé, autre site) : bandeau au-dessus de la liste.
  const missingPlan = !!str(sp.plan) && !openPlan;
  const missingPermit = !!str(sp.permis) && !openPermit;
  // Annulés et archivés hors compteurs des onglets (visibles par leur filtre).
  const tabCount: Record<Tab, number> = {
    plans: d.plans.filter((p) => p.status !== 'annule').length,
    permis: d.permits.filter((p) => p.state !== 'annule').length,
    entreprises: d.counts.contractors,
  };

  return (
    <>
      <PageHeader title={SCREENS.prevention.title}
        sub={`${plural(d.counts.inProgress, t('{n} intervention in progress'), t('{n} interventions in progress'))} · ${plural(d.counts.activePermits, t('{n} active permit'), t('{n} active permits'))} · ${plural(d.counts.contractors, t('{n} external company'), t('{n} external companies'))}`} />
      <div className="vg-page">
        <div className="card" style={{ gap: 2, padding: '6px 14px' }}>
          {d.siteRules.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 30, flexWrap: 'wrap' }}>
              <Icon name={r.ppFromFirstMinute ? 'ph-shield-warning' : 'ph-scales'} size={16} style={{ color: r.ppFromFirstMinute ? 'var(--color-accent)' : 'var(--color-neutral-500)', flex: 'none' }} />
              <span style={{ fontSize: 12.5, flex: 1, minWidth: 220, textWrap: 'pretty' }}>
                {d.siteRules.length > 1 && <span style={{ color: 'var(--color-neutral-400)' }}>{r.label} · </span>}
                <span style={{ fontWeight: 500 }}>{r.classLabel}</span>
                <span style={{ color: 'var(--color-neutral-300)' }}> · {r.ruleLabel}</span>
              </span>
              {approve && <SiteRuleButton site={r} />}
            </div>
          ))}
          {d.procedure && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', minHeight: 26, alignItems: 'center' }}>
              <ProcedureNote procedure={d.procedure} />
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          {d.kpis.map((k) => (
            <div key={k.label} className="card" style={{ gap: 5, padding: '12px 14px' }}>
              <div className="vg-eyebrow" style={{ color: 'var(--color-neutral-500)' }}>{k.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-.02em', lineHeight: 1.1 }}>{k.value}</span>
                <span style={{ fontSize: 12, color: k.tone === 'neutral' ? 'var(--color-neutral-400)' : TONE[k.tone].dot }}>{k.sub}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{k.note}</div>
            </div>
          ))}
        </div>

        {alertCount > 0 && (
          <div className="card" style={{ gap: 10, padding: '12px 14px', border: `1px solid ${TONE.danger.dot}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Icon name="ph-warning" size={22} style={{ color: TONE.danger.dot, flex: 'none' }} />
              <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 500 }}>{plural(alertCount, t('{n} external company intervention without a signed prevention plan'), t('{n} external company interventions without a signed prevention plan'))}</span>
                <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                  {allRule
                    ? fill(t('{rule}: written prevention plan, drawn up after the prior joint inspection and signed by both companies from the first minute of the intervention, whatever the duration and nature of the work; the fire and test permits of an external company are issued only with a signed plan covering their validity.'), { rule: ruleClass(ruleSites, t) })
                    : ruleSites.length
                      ? fill(t('Under the site rule: written plan signed from the first minute of the intervention on the sites concerned ({sites}), elsewhere from 400 h of work over 12 months or for dangerous work (French Labour Code R. 4512-6 and R. 4512-7).'), { sites: ruleSites.map((r) => r.label).join(', ') })
                      : t('French Labour Code R. 4512-6 and R. 4512-7: written plan required from 400 h of work over 12 months or for dangerous work, drawn up after the prior joint inspection and signed by both companies before the work starts.')}
                </span>
              </div>
            </div>
            {d.alerts.map((p) => {
              const permits = p.permits.filter((x) => x.gap);
              return (
                <div key={p.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingLeft: 34 }}>
                  <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 240 }}>
                    <span style={{ fontSize: 12.5 }}><span style={{ fontWeight: 500 }}>{p.contractor}</span> — {lcfirst(p.title)}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
                      {p.id} · {p.location} · {fill(t('since {start}, ends on {end}'), { start: fmtDate(p.startOn), end: fmtDate(p.endOn) })} · {p.mandatoryShort} · {missingLabel(p, t)}
                      {permits.length > 0 && fill(t(' · permits {list} on this plan'), { list: permits.map((x) => `${x.id} (${x.requested ? t('requested') : t('issued')})`).join(', ') })}
                    </span>
                  </div>
                  {manage
                    ? <PlanAlertActions plan={p} options={options} />
                    : <Link href={`/prevention?plan=${encodeURIComponent(p.id)}`} scroll={false} className="btn btn-ghost vg-btn-sm">{t('See the plan')}</Link>}
                </div>
              );
            })}
            {d.permitAlerts.map((p) => (
              <div key={p.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingLeft: 34 }}>
                <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 240 }}>
                  <span style={{ fontSize: 12.5 }}><span style={{ fontWeight: 500 }}>{p.contractor}</span> — {lcfirst(p.description)}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
                    {p.id} · {p.typeLabel.toLowerCase()} {p.status === 'demande' ? t('requested') : t('issued')} · {p.location} · {p.validity}
                    {p.planIssue && ` · ${lcfirst(p.planIssue.replace(/\.$/, ''))}`}
                  </span>
                </div>
                {manage
                  ? <PermitAlertActions permit={p} options={options} />
                  : <Link href={`/prevention?onglet=permis&permis=${encodeURIComponent(p.id)}`} scroll={false} className="btn btn-ghost vg-btn-sm">{t('See the permit')}</Link>}
              </div>
            ))}
          </div>
        )}

        <Toolbar end={(
          <>
            <Link href="/prevention/carte" className="btn btn-secondary vg-btn-sm"><Icon name="ph-map-trifold" size={13} />{t('Map and co-activity')}</Link>
            {!alt && manage && tab === 'plans' && <Link href="/prevention/import" className="btn btn-secondary vg-btn-sm"><Icon name="ph-file-arrow-up" size={13} />{t('Import a form')}</Link>}
            {!alt && manage && tab === 'plans' && <NewPlanButton options={options} />}
            {!alt && tab === 'permis' && (
              // Lien HTML simple (nouvel onglet) : la feuille d'impression ne reste pas chargée dans l'application.
              <a href={registerHref} target="_blank" rel="noreferrer" className="btn btn-secondary vg-btn-sm"><Icon name="ph-printer" size={13} />{t('Print the register')}</a>
            )}
            {!alt && manage && tab === 'permis' && <NewPermitButton options={options} />}
            {!alt && manage && tab === 'entreprises' && <NewContractorButton suppliers={d.suppliers} />}
          </>
        )}>
          <Segments label={t('Prevention views')} items={[
            ...TABS.map(([key, label]) => ({ key, label: t(label), count: tabCount[key], href: tabHref(key), on: tab === key && !alt })),
            ...(canReadGateHouse(role) ? [{ key: 'poste-de-garde', label: t('Gatehouse'), href: GATE_HOUSE_PATH, on: !!gate }] : []),
            { key: 'causeries', label: t('Safety talks'), href: SAFETY_TALKS_HREF, on: !!talks },
            { key: 'simops', label: t('Simultaneous operations'), href: simopsHref(), on: !!simops },
          ]} />
        </Toolbar>

        {gate ? <GateHouseView gate={gate} /> : simops ? <SimopsView data={simops} today={d.now} /> : talks ? (
          <SafetyTalksView data={talks} canManage={manage} openId={str(sp.causerie)} sites={formOptions.sites} defaultSite={d.choices.defaultSiteId} />
        ) : (
          <>
        {missingPlan && <MissingNotice text={t('Prevention plan not found or outside the selected site.')} closeHref={tabHref(tab)} />}
        {missingPermit && <MissingNotice text={t('Permit not found or outside the selected site.')} closeHref={tabHref(tab)} />}
        {tab === 'entreprises' && missingDetail(sp.entreprise, !!openContractor) && <MissingNotice text={t('External company not found.')} closeHref={tabHref(tab)} />}

        {tab === 'plans' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <SegLinks options={shownFilters(PLAN_FILTERS, planFilter, planCount).map((f) => ({
                href: hrefWith('/prevention', planParams, { filtre: filterParam(PLAN_FILTERS, f) }),
                label: <>{t(f.label)}<span style={{ marginLeft: 6, opacity: 0.6 }}>{planCount(f)}</span></>,
                on: f === planFilter,
              }))} />
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
                {allRule
                  ? fill(t('{rule}: written plan signed from the first minute of the intervention, whatever the duration and nature of the work'), { rule: ruleClass(ruleSites, t) })
                  : ruleSites.length
                    ? t('Written plan required from the first minute on the sites under the rule, otherwise from 400 h over 12 months or dangerous work (R. 4512-7)')
                    : t('Written plan required (R. 4512-7): 400 h over 12 months or dangerous work (list of the order of 19 March 1993)')}
              </span>
            </div>
            <FilterBar path="/prevention" base={{ filtre: planParams.filtre }} detail={['plan']} fields={[
              { name: 'entreprise', label: t('External company'), all: t('Any'), options: planSel.contractors, value: planSel.filters.entreprise },
              { name: 'projet', label: t('Keystone project'), options: planSel.projects, value: planSel.filters.projet },
            ]} />
            <PlansTable key={openPlan?.id ?? 'liste'} plans={plans} options={options} canManage={manage} openId={openPlan?.id} emptyLabel={t(planFilter.empty)} />
          </>
        )}

        {tab === 'permis' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <SegLinks options={shownFilters(PERMIT_FILTERS, permitFilter, permitCount).map((f) => ({
                href: hrefWith('/prevention', { ...permitParams, onglet: 'permis' }, { filtre: filterParam(PERMIT_FILTERS, f) }),
                label: <>{t(f.label)}<span style={{ marginLeft: 6, opacity: 0.6 }}>{permitCount(f)}</span></>,
                on: f === permitFilter,
              }))} />
              <SegLinks options={PERMIT_TYPE_FILTERS.map((f) => ({
                href: hrefWith('/prevention', { ...permitParams, onglet: 'permis' }, { type: f.key ?? undefined }),
                label: <>{t(f.label)}<span style={{ marginLeft: 6, opacity: 0.6 }}>{f.key ? byState.filter((p) => p.type === f.key).length : byState.length}</span></>,
                on: f.key === permitType,
              }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="ph-fire" size={13} style={{ color: 'var(--tone-warn-dot)' }} />{t('Fire permit: hot work, watch for 2 h after the end of the work')}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="ph-flask" size={13} style={{ color: 'var(--color-accent)' }} />{t('Test permit: test area (ATEX zone 2), inert products simulating explosives')}</span>
              {ruleSites.length > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="ph-shield-warning" size={13} style={{ color: 'var(--color-accent)' }} />
                  {t('External company: issue subject to a signed prevention plan covering the validity')}{allRule ? '' : t(' (sites under the rule)')}
                </span>
              )}
            </div>
            <FilterBar path="/prevention" base={{ onglet: 'permis', filtre: permitParams.filtre, type: permitParams.type }} detail={['permis']} fields={[
              { name: 'entreprise', label: t('External company'), all: t('Any'), options: permitSel.contractors, value: permitSel.filters.entreprise },
              { name: 'projet', label: t('Keystone project'), options: permitSel.projects, value: permitSel.filters.projet },
            ]} />
            <PermitsTable key={openPermit?.id ?? 'liste'} permits={permits} options={options} canManage={manage} openId={openPermit?.id}
              emptyLabel={permitType ? `${t(permitFilter.empty).replace(/\.$/, '')} (${permitType === 'feu' ? t('fire permit') : t('test permit')}).` : t(permitFilter.empty)} />
          </>
        )}

        {tab === 'entreprises' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <SegLinks options={[
                { href: '/prevention?onglet=entreprises', label: <>{t('Active#fplural')}<span style={{ marginLeft: 6, opacity: 0.6 }}>{d.counts.contractors}</span></>, on: !showArchived },
                { href: `/prevention?onglet=entreprises&etat=${ARCHIVES}`, label: <>{t('Archived#fplural')}<span style={{ marginLeft: 6, opacity: 0.6 }}>{archivedCount}</span></>, on: showArchived },
              ]} />
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{t('Plans and permits counted on the selected site')}</span>
            </div>
            <ContractorsTable key={openContractor?.id ?? 'liste'} contractors={contractors} suppliers={manage ? d.suppliers : { options: [], message: null }} canManage={manage} openId={openContractor?.id}
              emptyLabel={showArchived ? t('No archived company.') : t('No external company recorded.')} />
          </>
        )}
          </>
        )}
      </div>
    </>
  );
}
