import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { ContractorsTable, NewContractorButton } from '@/components/prevention/ContractorDialogs';
import { NewPermitButton, PermitAlertActions, PermitsTable } from '@/components/prevention/PermitDialogs';
import { NewPlanButton, PlanAlertActions, PlansTable } from '@/components/prevention/PlanDialogs';
import { SiteRuleButton } from '@/components/prevention/SiteRuleDialogs';
import type { PreventionOptions } from '@/components/prevention/parts';
import { Icon, SegLinks, hrefWith } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { SCREENS, TONE, canApprove, canManage } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadFormOptions } from '@/lib/data/options';
import { loadPrevention, type PlanView, type SiteRuleView } from '@/lib/data/prevention';
import { lcfirst } from '@/lib/queries';

export const metadata: Metadata = { title: SCREENS.prevention.title };

const TABS = [['plans', 'Plans de prévention'], ['permis', 'Permis'], ['entreprises', 'Entreprises extérieures']] as const;
type Tab = (typeof TABS)[number][0];

// [paramètre, libellé, phase (null = tous), message si vide]
// « En cours » suit l'indicateur (début ≤ aujourd'hui ≤ fin) ; « À clore » (période échue, plan non clos) n'apparaît que s'il y a lieu.
const FILTERS = [
  ['en-cours', 'En cours', 'en_cours', 'Aucune intervention en cours sur ce site.'],
  ['a-venir', 'À venir', 'a_venir', 'Aucune intervention à venir sur ce site.'],
  ['a-clore', 'À clore', 'a_clore', 'Aucun plan à clore sur ce site.'],
  ['clos', 'Clos', 'clos', 'Aucun plan clos sur ce site.'],
  ['tous', 'Tous', null, 'Aucun plan de prévention sur ce site.'],
] as const;
const ALL_FILTER = FILTERS[FILTERS.length - 1];

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Classement commun des sites soumis à la règle « dès la première minute » (« Établissement Seveso seuil haut »). */
function ruleClass(rules: SiteRuleView[]) {
  if (rules.length && rules[0].seveso && rules.every((r) => r.seveso === rules[0].seveso)) return rules[0].classLabel;
  return rules.length > 1 ? 'Règle interne des sites' : 'Règle interne du site';
}

/** Ce qui manque au plan pour être en règle (alerte R. 4512-6). */
function missingLabel(p: PlanView) {
  const parts = [];
  if (!p.inspectionDone) parts.push('inspection commune préalable non réalisée');
  if (!p.signedEuOn && !p.signedEeOn) parts.push('aucune signature');
  else if (!p.signedEuOn) parts.push("signature de l'entreprise utilisatrice manquante");
  else if (!p.signedEeOn) parts.push("signature de l'entreprise extérieure manquante");
  return parts.join(', ');
}

export default async function PreventionPage({ searchParams }: PageProps<'/prevention'>) {
  const { role } = await guard('prevention');
  const sp = await searchParams;
  const [d, formOptions] = await Promise.all([loadPrevention(), loadFormOptions()]);
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
  const requested = FILTERS.find(([k]) => k === str(sp.filtre)) ?? FILTERS[0];
  const filter = openPlan && requested[2] && requested[2] !== openPlan.phase ? FILTERS.find((f) => f[2] === openPlan.phase) ?? ALL_FILTER : requested;
  const plans = filter[2] ? d.plans.filter((p) => p.phase === filter[2]) : d.plans;
  const phaseCount = (phase: string | null) => (phase ? d.plans.filter((p) => p.phase === phase).length : d.plans.length);
  const shownFilters = FILTERS.filter(([key, , phase]) => phase !== 'a_clore' || phaseCount(phase) > 0 || filter[0] === key);

  const options: PreventionOptions = {
    people: formOptions.people,
    sites: formOptions.sites,
    projects: formOptions.projects,
    origins: formOptions.origins,
    contractors: d.choices.contractors,
    plans: d.choices.plans,
    siteRules: d.siteRules,
    defaultSiteId: d.choices.defaultSiteId,
    recordSites: d.choices.recordSites,
    siteLocked: d.choices.siteLocked,
    today: d.now,
  };
  const tabHref = (k: Tab) => (k === 'plans' ? '/prevention' : `/prevention?onglet=${k}`);
  const tabCount: Record<Tab, number> = { plans: d.plans.length, permis: d.permits.length, entreprises: d.contractors.length };

  return (
    <>
      <PageHeader title={SCREENS.prevention.title}
        sub={`${plural(d.counts.inProgress, 'intervention en cours', 'interventions en cours')} · ${plural(d.counts.activePermits, 'permis actif', 'permis actifs')} · ${plural(d.counts.contractors, 'entreprise extérieure', 'entreprises extérieures')}`} />
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
                <span style={{ fontWeight: 500 }}>{plural(alertCount, "intervention d'entreprise extérieure sans plan de prévention signé", "interventions d'entreprises extérieures sans plan de prévention signé")}</span>
                <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                  {allRule
                    ? <>{ruleClass(ruleSites)} : plan de prévention écrit, établi après l&apos;inspection commune préalable et signé par les deux entreprises dès la première minute d&apos;intervention, quelles que soient la durée et la nature des travaux ; les permis de feu et d&apos;essai d&apos;une entreprise extérieure ne sont délivrés qu&apos;avec un plan signé couvrant leur validité.</>
                    : ruleSites.length
                      ? <>Selon la règle du site : plan écrit et signé dès la première minute d&apos;intervention sur les sites concernés ({ruleSites.map((r) => r.label).join(', ')}), ailleurs dès 400 h de travaux sur 12 mois ou pour des travaux dangereux (Code du travail R. 4512-6 et R. 4512-7).</>
                      : <>Code du travail R. 4512-6 et R. 4512-7 : plan écrit obligatoire dès 400 h de travaux sur 12 mois ou pour des travaux dangereux, établi après l&apos;inspection commune préalable et signé par les deux entreprises avant le début des travaux.</>}
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
                      {p.id} · {p.location} · depuis le {fmtDate(p.startOn)}, fin le {fmtDate(p.endOn)} · {p.mandatoryShort} · {missingLabel(p)}
                      {permits.length > 0 && ` · permis ${permits.map((x) => `${x.id} (${x.requested ? 'demandé' : 'délivré'})`).join(', ')} sur ce plan`}
                    </span>
                  </div>
                  {manage
                    ? <PlanAlertActions plan={p} options={options} />
                    : <Link href={`/prevention?plan=${encodeURIComponent(p.id)}`} scroll={false} className="btn btn-ghost vg-btn-sm">Voir le plan</Link>}
                </div>
              );
            })}
            {d.permitAlerts.map((p) => (
              <div key={p.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingLeft: 34 }}>
                <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 240 }}>
                  <span style={{ fontSize: 12.5 }}><span style={{ fontWeight: 500 }}>{p.contractor}</span> — {lcfirst(p.description)}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
                    {p.id} · {p.typeLabel.toLowerCase()} {p.status === 'demande' ? 'demandé' : 'délivré'} · {p.location} · {p.validity}
                    {p.planIssue && ` · ${lcfirst(p.planIssue.replace(/\.$/, ''))}`}
                  </span>
                </div>
                {manage
                  ? <PermitAlertActions permit={p} options={options} />
                  : <Link href={`/prevention?onglet=permis&permis=${encodeURIComponent(p.id)}`} scroll={false} className="btn btn-ghost vg-btn-sm">Voir le permis</Link>}
              </div>
            ))}
          </div>
        )}

        <div className="vg-tabs">
          {TABS.map(([key, label]) => (
            <Link key={key} href={tabHref(key)} scroll={false} className={`vg-tab${tab === key ? ' is-on' : ''}`}>
              <span>{label}</span><span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{tabCount[key]}</span>
            </Link>
          ))}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, paddingBottom: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Link href="/prevention/carte" className="btn btn-secondary vg-btn-sm"><Icon name="ph-map-trifold" size={13} />Carte et coactivité</Link>
            {manage && tab === 'plans' && <Link href="/prevention/import" className="btn btn-secondary vg-btn-sm"><Icon name="ph-file-arrow-up" size={13} />Importer un formulaire</Link>}
            {manage && tab === 'plans' && <NewPlanButton options={options} />}
            {manage && tab === 'permis' && <NewPermitButton options={options} />}
            {manage && tab === 'entreprises' && <NewContractorButton />}
          </span>
        </div>

        {tab === 'plans' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <SegLinks options={shownFilters.map(([key, label, phase]) => ({
                href: hrefWith('/prevention', {}, { filtre: key === 'en-cours' ? undefined : key }),
                label: <>{label}<span style={{ marginLeft: 6, opacity: 0.6 }}>{phaseCount(phase)}</span></>,
                on: filter[0] === key,
              }))} />
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
                {allRule
                  ? `${ruleClass(ruleSites)} : plan écrit et signé dès la première minute d'intervention, quelles que soient la durée et la nature des travaux`
                  : ruleSites.length
                    ? 'Plan écrit obligatoire dès la première minute sur les sites soumis à la règle, sinon dès 400 h sur 12 mois ou travaux dangereux (R. 4512-7)'
                    : "Plan écrit obligatoire (R. 4512-7) : 400 h sur 12 mois ou travaux dangereux (liste de l'arrêté du 19 mars 1993)"}
              </span>
            </div>
            <PlansTable key={openPlan?.id ?? 'liste'} plans={plans} options={options} canManage={manage} openId={openPlan?.id} emptyLabel={filter[3]} />
          </>
        )}

        {tab === 'permis' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="ph-fire" size={13} style={{ color: 'var(--tone-warn-dot)' }} />Permis de feu : travaux par points chauds, surveillance 2 h après la fin des travaux</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="ph-flask" size={13} style={{ color: 'var(--color-accent)' }} />Permis d&apos;essai : zone d&apos;essais (ATEX zone 2), produits inertes simulant les explosifs</span>
              {ruleSites.length > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="ph-shield-warning" size={13} style={{ color: 'var(--color-accent)' }} />
                  Entreprise extérieure : délivrance subordonnée à un plan de prévention signé couvrant la validité{allRule ? '' : ' (sites soumis à la règle)'}
                </span>
              )}
            </div>
            <PermitsTable key={openPermit?.id ?? 'liste'} permits={d.permits} options={options} canManage={manage} openId={openPermit?.id} />
          </>
        )}

        {tab === 'entreprises' && <ContractorsTable contractors={d.contractors} canManage={manage} />}
      </div>
    </>
  );
}
