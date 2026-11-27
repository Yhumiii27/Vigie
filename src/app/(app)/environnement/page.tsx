import Link from 'next/link';
import { newEventHref } from '@/lib/event-prefill';
import { NewActionButton } from '@/components/ActionFormDialog';
import { Segments, Toolbar } from '@/components/Segments';
import { PageHeader } from '@/components/PageHeader';
import { Aside, CardHead, Dot, Icon, MissingNotice, SegLinks, ToneTag, hrefWith } from '@/components/ui';
import { ConsumptionMonthButton, ConsumptionPanel } from '@/components/environment/ConsumptionPanel';
import { FilterMenu } from '@/components/environment/FilterMenu';
import { NewStreamButton, StreamsPanel, type StreamSuggestions } from '@/components/environment/StreamsPanel';
import { NewEntryButton, WasteRegister, type StreamOption } from '@/components/environment/WasteRegister';
import { SiteSiretButton } from '@/components/environment/SiteSiret';
import { Note } from '@/components/environment/parts';
import type { Carrier, Installation } from '@/components/environment/parts';
import { fmtDelta, fmtNum, fmtPct, lcfirst, shiftMonth } from '@/lib/rules/environment';
import styles from '@/components/environment/environment.module.css';
import { fmtDate, fmtDayMonth } from '@/lib/dates';
import { BSD_STALE_DAYS } from '@/lib/rules/environment';
import { SCREENS, TONE, canApprove, canEdit, canSee, type Tone } from '@/lib/domain';
import { fmtSiret } from '@/lib/siret';
import { guard } from '@/lib/guard';
import { loadEnvironment, wasteEntryYear } from '@/lib/data/environment';
import { loadFormOptions } from '@/lib/data/options';
import { QHSE_ONLY_CREATE_MESSAGE, actionHref, canCreateAction } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { ALL_SITES } from '@/lib/session';
import { getI18n, screenMetadata } from '@/i18n/server';
import { fill } from '@/i18n/translate';

export const generateMetadata = () => screenMetadata('env');

const PATH = '/environnement';
const TABS = ['registre', 'filieres', 'consommations'] as const;
type Tab = (typeof TABS)[number];
const VIEWS = ['dangereux', 'bsd-manquants', 'bsd-en-attente', 'mentions-incompletes', 'annules'] as const;
type View = (typeof VIEWS)[number];

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
/** `one` et `many` : chaînes traduites portant {n}. */
const plural = (n: number, one: string, many: string) => fill(n > 1 ? many : one, { n: fmtNum(n) });
const uniq = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
const tonnes = (t: number) => `${fmtNum(t, t < 10 ? 2 : 1)} t`;
const fmtEnergy = (kWh: number) => (kWh >= 10_000 ? `${fmtNum(kWh / 1000)} MWh` : `${fmtNum(kWh)} kWh`);

export default async function EnvironmentPage({ searchParams }: PageProps<'/environnement'>) {
  const session = await guard('env');
  const { t } = await getI18n();
  const sp = await searchParams;
  const manage = canEdit(session.role, 'env');
  // DOC-08 : ?enlevement=<id> ouvre la fiche d'un enlèvement (année du registre retrouvée si l'URL ne la porte pas).
  const entryParam = /^\d{1,9}$/.test(str(sp.enlevement) ?? '') ? Number(sp.enlevement) : null;
  const yearParam = Number(str(sp.annee) ?? (entryParam != null ? await wasteEntryYear(entryParam) : undefined));
  const [d, allOptions] = await Promise.all([loadEnvironment(Number.isInteger(yearParam) ? yearParam : undefined), loadFormOptions()]);
  // Création d'action : service QHSE seulement (ACT-22, réponses du 15/10/2026) ; les autres rôles ne reçoivent ni les
  // listes du formulaire d'action ni ses valeurs proposées.
  const qhse = canCreateAction(session.role);
  const actionOptions: ActionFormOptions | null = qhse ? { people: allOptions.people, sites: allOptions.sites, today: d.now } : null;
  const entryActionOptions = manage ? actionOptions : null;

  // ── État porté par l'URL : onglet, année, filière, vue
  const tab: Tab = TABS.find((x) => x === str(sp.onglet)) ?? 'registre';
  const vue = VIEWS.find((v) => v === str(sp.vue));
  const rawStream = str(sp.filiere);
  const filiere = d.streams.some((s) => s.id === rawStream) ? rawStream : undefined;
  const annee = d.year === d.currentYear ? undefined : String(d.year);
  const params = { onglet: tab === 'registre' ? undefined : tab, annee, filiere, vue };
  const regParams = { ...params, onglet: undefined };
  // Liens profonds (DOC-08) : fiche d'un enlèvement (registre) ou d'une filière (onglet « Filières »).
  const deepEntry = tab === 'registre' && entryParam != null && manage ? d.entries.find((e) => e.id === entryParam) : undefined;
  const deepStream = tab === 'filieres' && manage ? filiere : undefined;
  const missingDeep = (tab === 'registre' && entryParam != null && !deepEntry) || (tab === 'filieres' && !!rawStream && !filiere);

  // ── Registre filtré (les enlèvements annulés n'apparaissent que sous « Annulés »)
  const live = d.entries.filter((e) => !e.cancelled);
  const byStream = d.entries.filter((e) => !filiere || e.streamId === filiere);
  const matchesView = (e: (typeof d.entries)[number], v: View | undefined) => {
    if (v === 'annules') return !!e.cancelled;
    if (e.cancelled) return false;
    return !v || (v === 'dangereux' ? e.hazardous : v === 'bsd-manquants' ? e.missingBsd : v === 'mentions-incompletes' ? e.gaps.length > 0 : e.staleBsd);
  };
  const shown = byStream.filter((e) => matchesView(e, vue));
  const byView = d.entries.filter((e) => matchesView(e, vue));
  const filtered = Boolean(filiere || vue);
  const shownTonnes = shown.reduce((n, e) => n + (e.tonnes ?? 0), 0);
  const streamFilter = d.streams.find((s) => s.id === filiere);

  const missing = d.kpis.missing.count;
  const sub = `${fill(t('Register {year}'), { year: d.year })} · ${plural(live.length, t('{n} removal'), t('{n} removals'))} · ${missing ? plural(missing, t('{n} missing slip'), t('{n} missing slips')) : t('no missing slip')}`;

  // ── Listes de choix et valeurs par défaut
  const defaultSite = session.site.id === ALL_SITES ? allOptions.sites[0]?.[0] ?? '' : session.site.id;
  const scopeSites = d.sites.map((s) => [s.id, s.label] as const);
  const streamOptions: StreamOption[] = d.streams.map(({
    id, label, ewcCode, hazardous, unit, collector, destination, treatmentCode, channel, site, siteId,
    pop, qualification, collectorSiret, collectorAddress, collectorReceipt, destinationSiret, destinationAddress, archived, siteArchived,
  }) => ({
    id, label, ewcCode, hazardous, unit, collector, destination, treatmentCode, channel, site, siteId,
    pop, qualification, collectorSiret, collectorAddress, collectorReceipt, destinationSiret, destinationAddress, archived, siteArchived,
  }));
  // Filières en service (DOC-09) : seules proposées pour un nouvel enlèvement et comptées dans l'onglet.
  const activeStreams = d.streams.filter((s) => !s.archived);
  const transporters = uniq([...live.map((e) => e.transporter), ...d.streams.map((s) => s.collector)]);
  // Identité connue des transporteurs et des installations (mentions du registre) : enlèvements, du plus ancien au plus
  // récent, puis filières (le collecteur et l'installation de la filière font foi).
  const carriers: Record<string, Carrier> = {};
  const installations: Record<string, Installation> = {};
  [...live].reverse().forEach((e) => {
    if (e.transporterSiret || e.transporterAddress || e.transporterReceipt) carriers[e.transporter] = { siret: e.transporterSiret, address: e.transporterAddress, receipt: e.transporterReceipt };
    if (e.destinationSiret || e.destinationAddress) installations[e.destination] = { siret: e.destinationSiret, address: e.destinationAddress };
  });
  d.streams.forEach((s) => {
    if (s.collectorSiret || s.collectorAddress || s.collectorReceipt) carriers[s.collector] = { siret: s.collectorSiret, address: s.collectorAddress, receipt: s.collectorReceipt };
    if (s.destinationSiret || s.destinationAddress) installations[s.destination] = { siret: s.destinationSiret, address: s.destinationAddress };
  });
  const suggestions: StreamSuggestions = {
    channels: uniq(d.streams.map((s) => s.channel)),
    collectors: uniq(d.streams.map((s) => s.collector)),
    destinations: uniq(d.streams.map((s) => s.destination)),
    carriers,
    installations,
  };
  // SIRET des établissements (première mention du registre) : renseigné par l'animateur QHSE ou la direction.
  const approver = canApprove(session.role);
  const noSiret = d.registrySites.filter((s) => !s.siret);
  const siretSite = session.site.id === ALL_SITES ? undefined : session.site.id;
  const previousMonth = shiftMonth(d.consumption.maxMonth, -1);
  const monthSite = d.sites.some((s) => s.id === defaultSite) ? defaultSite : d.sites[0]?.id ?? '';
  // Mois proposé : le plus récent mois échu sans relevé, sinon le mois qui suit le dernier relevé du site.
  const gap = d.consumption.tables.find((t) => t.siteId === monthSite)?.rows.find((r) => r.month <= previousMonth && Object.values(r.values).every((v) => v == null));
  const latestMonth = d.consumption.records.filter((r) => r.siteId === monthSite).map((r) => r.month).sort().at(-1);
  const followingMonth = latestMonth ? shiftMonth(latestMonth, 1) : previousMonth;
  const defaultMonth = gap?.month ?? (followingMonth > d.consumption.maxMonth ? d.consumption.maxMonth : followingMonth);

  // ── Indicateurs de l'année
  const k = d.kpis;
  const elecTone: Tone | null = k.electricity.delta == null ? null : k.electricity.delta > 0.005 ? 'warn' : k.electricity.delta < -0.005 ? 'ok' : null;
  const tiles: { key: string; label: string; value: string; valueColor?: string; sub: string; subColor?: string; note: string }[] = [
    {
      key: 'evac', label: `${t('Waste removed')} · ${d.year}`, value: tonnes(k.evacuated.tonnes),
      sub: plural(k.evacuated.count, t('{n} removal'), t('{n} removals')),
      note: [
        k.evacuated.prevTonnes != null ? `${d.year - 1}${d.isCurrent ? t(' same period') : ''}${t(': ')}${tonnes(k.evacuated.prevTonnes)}` : fill(t('Total {period}'), { period: d.periodNote }),
        k.evacuated.volumeCount ? plural(k.evacuated.volumeCount, t('excluding {n} volume not weighed'), t('excluding {n} volumes not weighed')) : '',
      ].filter(Boolean).join(' · '),
    },
    {
      key: 'dd', label: t('Share of hazardous waste'), value: k.hazardous.share != null ? fmtPct(k.hazardous.share) : '—',
      sub: k.hazardous.share != null ? tonnes(k.hazardous.tonnes) : '', note: t('Waste codes with an asterisk (*)'),
    },
    {
      key: 'valo', label: t('Recovery rate'), value: k.recovery.share != null ? fmtPct(k.recovery.share) : '—',
      sub: k.recovery.share != null ? tonnes(k.recovery.tonnes) : '', note: t('Quantities sent to R1–R13'),
    },
  ];
  const elecTile = {
    label: `${t('Electricity')} · ${d.year}`, value: k.electricity.delta != null ? fmtDelta(k.electricity.delta) : '—',
    valueColor: elecTone ? TONE[elecTone].dot : undefined,
    sub: k.electricity.current ? fmtEnergy(k.electricity.current) : '',
    note: k.electricity.period
      ? (k.electricity.previous != null ? `${k.electricity.period} vs ${d.year - 1} (${fmtEnergy(k.electricity.previous)})` : `${k.electricity.period} · ${t('previous year incomplete')}`)
      : t('No reading entered'),
  };

  const tabs: [Tab, string, string][] = [
    ['registre', t('Waste register'), String(live.length)],
    ['filieres', t('Waste streams'), String(activeStreams.length)],
    ['consommations', t('Consumption'), t('12 months')],
  ];
  const yearOptions = d.years.map((y) => ({ href: hrefWith(PATH, params, { annee: y === d.currentYear ? undefined : String(y) }), label: String(y), on: y === d.year }));

  const tile = (t: Omit<(typeof tiles)[number], 'key'>) => (
    <>
      <div className="vg-eyebrow" style={{ color: 'var(--color-neutral-500)' }}>{t.label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-.02em', lineHeight: 1.1, color: t.valueColor, whiteSpace: 'nowrap' }}>{t.value}</span>
        {t.sub && <span style={{ fontSize: 12, color: t.subColor ?? 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{t.sub}</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>{t.note}</div>
    </>
  );

  return (
    <>
      <PageHeader title={SCREENS.env.title} sub={sub} />
      <div className="vg-page">
        {missingDeep && (
          <MissingNotice text={tab === 'filieres' ? t('Waste stream not found or outside the selected site.') : t('Removal not found, outside the selected site or not accessible.')}
            closeHref={hrefWith(PATH, params, { filiere: tab === 'filieres' ? undefined : filiere })} />
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(176px, 1fr))', gap: 12 }}>
          {tiles.map(({ key, ...t }) => <div key={key} className="card" style={{ gap: 5, padding: '12px 14px', minWidth: 0 }}>{tile(t)}</div>)}

          <div className="card" style={{ gap: 5, padding: '12px 14px', minWidth: 0, boxShadow: missing ? `inset 0 0 0 1px color-mix(in srgb, ${TONE.danger.dot} 55%, transparent)` : undefined }}>
            <div className="vg-eyebrow" style={{ color: missing ? TONE.danger.fg : 'var(--color-neutral-500)' }}>{t('Missing waste tracking slips')} · {d.year}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-.02em', lineHeight: 1.1, color: missing ? TONE.danger.dot : TONE.ok.dot }}>{missing}</span>
              <span style={{ fontSize: 12, color: missing ? TONE.danger.fg : 'var(--color-neutral-400)' }}>{missing ? t('hazardous waste without a slip') : t('register complete')}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
              {k.missing.other
                ? fill(t('+ {n} in {years} · Trackdéchets required'), { n: k.missing.other, years: k.missing.otherYears.join(', ') })
                : t('Trackdéchets required (Env. Code R. 541-45)')}
            </div>
            {k.missing.other > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11 }}>
                {k.missing.otherYears.map((y) => (
                  <Link key={y} href={hrefWith(PATH, {}, { annee: y === d.currentYear ? undefined : String(y), vue: 'bsd-manquants' })} scroll={false} className="vg-link">
                    {fill(t('See {year}'), { year: y })}
                  </Link>
                ))}
              </div>
            )}
            {missing > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
                <Link href={hrefWith(PATH, { annee }, { vue: 'bsd-manquants' })} scroll={false} className="vg-link">{t('Show')}</Link>
                {d.bsdAction ? (
                  <Link href={actionHref(d.bsdAction.id)} className="vg-link" title={`${d.bsdAction.label} — ${d.bsdAction.pilot} · ${fill(t('target date {date}'), { date: fmtDate(d.bsdAction.dueOn) })}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Dot color={TONE[d.bsdAction.tone].dot} size={6} />{d.bsdAction.id} · {d.bsdAction.statusLabel.toLowerCase()}
                  </Link>
                ) : actionOptions ? (
                  <NewActionButton options={actionOptions} label={t('Create the action')} className="vg-text-btn" icon="ph-plus"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} defaults={d.bsdActionDefaults} />
                ) : manage && (
                  <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{QHSE_ONLY_CREATE_MESSAGE}</span>
                )}
              </div>
            )}
          </div>

          <div className="card" style={{ gap: 5, padding: '12px 14px', minWidth: 0 }}>{tile(elecTile)}</div>
        </div>

        <div className={styles.layout}>
          <div className={styles.main}>
            <Toolbar end={(
              <>
                {tab === 'registre' && (
                  <a href={`${PATH}/registre?annee=${d.year}`} download className="btn btn-ghost vg-btn-sm" title={`${fill(t('Chronological register {year}'), { year: d.year })} · ${session.site.label} · CSV`}>
                    <Icon name="ph-download-simple" size={13} />{t('Export the register')}
                  </a>
                )}
                {manage && tab === 'registre' && (
                  <NewEntryButton streams={streamOptions} today={d.now} showSite={d.showSite} transporters={transporters} carriers={carriers} defaultStreamId={filiere} events={d.eventOptions} />
                )}
                {manage && tab === 'filieres' && <NewStreamButton sites={allOptions.sites} defaultSite={defaultSite} suggestions={suggestions} />}
                {manage && tab === 'consommations' && monthSite && (
                  <ConsumptionMonthButton records={d.consumption.records} sites={scopeSites} defaultSite={monthSite} defaultMonth={defaultMonth} maxMonth={d.consumption.maxMonth} />
                )}
              </>
            )}>
              <Segments label={t('Environment tabs')} items={tabs.map(([key, label, n]) => ({
                key, label, count: n, href: hrefWith(PATH, { annee }, { onglet: key === 'registre' ? undefined : key }), on: tab === key,
              }))} />
            </Toolbar>

            {tab === 'registre' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <SegLinks size={12} pad="4px 10px" options={yearOptions} />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {([
                      { key: undefined, label: t('All#mplural'), n: byStream.filter((e) => matchesView(e, undefined)).length },
                      { key: 'dangereux', label: t('Hazardous waste'), n: byStream.filter((e) => matchesView(e, 'dangereux')).length },
                      { key: 'bsd-manquants', label: t('Missing waste tracking slips'), n: byStream.filter((e) => matchesView(e, 'bsd-manquants')).length },
                      { key: 'bsd-en-attente', label: t('Slips not finalised'), n: byStream.filter((e) => matchesView(e, 'bsd-en-attente')).length },
                      { key: 'mentions-incompletes', label: t('Incomplete mentions'), n: byStream.filter((e) => matchesView(e, 'mentions-incompletes')).length },
                      { key: 'annules', label: t('Cancelled#plural'), n: byStream.filter((e) => matchesView(e, 'annules')).length },
                    ] satisfies { key: View | undefined; label: string; n: number }[])
                      .filter((c) => c.n > 0 || vue === c.key || (c.key !== 'annules' && c.key !== 'bsd-en-attente' && c.key !== 'mentions-incompletes'))
                      .map((c) => (
                      <Link key={c.label} href={hrefWith(PATH, regParams, { vue: c.key })} scroll={false} className={`vg-chip${vue === c.key ? ' is-on' : ''}`}
                        title={c.key === 'bsd-en-attente' ? fill(t('Slip draft, issued or collected more than {n} days after the removal'), { n: BSD_STALE_DAYS })
                          : c.key === 'mentions-incompletes' ? t('Required mentions missing (order of 31 May 2021): SIRET, address, receipt, qualification of the treatment…') : undefined}>
                        {c.key === 'bsd-manquants' && c.n > 0 && <Dot color={TONE.danger.dot} size={6} />}
                        {(c.key === 'bsd-en-attente' || c.key === 'mentions-incompletes') && c.n > 0 && <Dot color={TONE.warn.dot} size={6} />}
                        {c.label}<span style={{ opacity: 0.6 }}>{c.n}</span>
                      </Link>
                    ))}
                  </div>
                  <FilterMenu key={`f-${filiere ?? ''}-${d.year}-${vue ?? ''}`} icon="ph-funnel" label={fill(t('Waste stream: {value}'), { value: streamFilter ? lcfirst(streamFilter.label) : t('all#f') })}
                    options={[
                      { href: hrefWith(PATH, regParams, { filiere: undefined }), label: t('All waste streams'), on: !filiere, n: byView.length },
                      ...d.streams.map((s) => ({
                        href: hrefWith(PATH, regParams, { filiere: s.id }),
                        label: `${s.label}${d.showSite ? ` · ${s.site.split(' — ')[0]}` : ''}`,
                        on: filiere === s.id,
                        n: byView.filter((e) => e.streamId === s.id).length,
                      })),
                    ]} />
                  {filtered && <Link href={hrefWith(PATH, { annee }, {})} scroll={false} className="vg-link">{t('Reset')}</Link>}
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                    {plural(shown.length, t('{n} removal'), t('{n} removals'))}{shownTonnes ? ` · ${tonnes(shownTonnes)}` : ''} · {session.site.label}
                  </span>
                </div>
                {noSiret.length > 0 ? (
                  <Note icon="ph-identification-card" tone="warn">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ flex: '1 1 260px' }}>
                        {fill(t('SIRET of the establishment to enter ({sites}): first mention of the chronological register (order of 31 May 2021).'), { sites: noSiret.map((s) => s.label.split(' — ')[0]).join(', ') })}{!approver && t(' To complete by the QHSE coordinator or management.')}
                      </span>
                      {approver && <SiteSiretButton sites={d.registrySites} defaultSiteId={noSiret.find((s) => s.id === siretSite)?.id ?? noSiret[0].id} />}
                    </span>
                  </Note>
                ) : d.registrySites.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                    <span>
                      {d.registrySites.map((s) => `${d.registrySites.length > 1 ? `${s.label.split(' — ')[0]} · ` : ''}SIRET ${fmtSiret(s.siret!)}`).join(' — ')}
                    </span>
                    {approver && <SiteSiretButton sites={d.registrySites} defaultSiteId={siretSite} label={t('Edit')} className="vg-text-btn" />}
                  </div>
                )}
                <WasteRegister key={`reg-${deepEntry?.id ?? ''}`} entries={shown} lookup={d.entries} initialId={deepEntry?.id} closeHref={hrefWith(PATH, params, {})}
                  streams={streamOptions} canManage={manage} showSite={d.showSite} today={d.now} transporters={transporters} carriers={carriers}
                  events={d.eventOptions} actionOptions={entryActionOptions} canSeeEvents={canSee(session.role, 'events')}
                  emptyText={
                    !d.streams.length ? t('No waste stream for this site') + (manage ? t(': create one in the “Waste streams” tab, then record the removals.') : '.')
                      : filtered ? t('No removal matches the filters.')
                        : fill(t('No removal recorded in the register in {year}.'), { year: d.year })
                  } />
              </>
            )}

            {tab === 'filieres' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <SegLinks size={12} pad="4px 10px" options={yearOptions} />
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                    {plural(activeStreams.filter((s) => s.hazardous).length, t('{n} hazardous waste stream'), t('{n} hazardous waste streams'))} · {fill(t('totals {year} {period} and {previous}'), { year: d.year, period: d.periodNote, previous: d.year - 1 })}
                  </span>
                </div>
                <StreamsPanel key={`str-${deepStream ?? ''}`} initialId={deepStream} closeHref={hrefWith(PATH, params, { filiere: undefined })}
                  streams={d.streams} year={d.year} annee={annee} isCurrent={d.isCurrent} canManage={manage} showSite={d.showSite} sites={allOptions.sites}
                  suggestions={suggestions} actionOptions={entryActionOptions} />
              </>
            )}

            {tab === 'consommations' && (
              <ConsumptionPanel data={d.consumption} year={d.year} canManage={manage} sites={scopeSites} showSite={d.showSite} />
            )}
          </div>

          <aside className={styles.aside}>
            <div className="card" style={{ gap: 8 }}>
              <CardHead title={t('Environmental events')} aside={
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
                  <Aside>{plural(d.envEvents.length, t('{n} open'), t('{n} open#plural'))}</Aside>
                  {/* EVT-24 : encadrement — « Nouvel événement » de type Environnement ; Salarié — formulaire terrain. */}
                  <Link href={manage ? newEventHref('type', 'ENV') : '/signaler?type=ENV'} className="vg-link">
                    {t('Report#verb')}<span className="vg-sr-only">{t(' a spill, a leak, a discharge…')}</span>
                  </Link>
                </span>
              } />
              <div style={{ display: 'grid', gap: 2 }}>
                {d.envEvents.length === 0 && <span className="vg-muted" style={{ fontSize: 12 }}>{t('No open environmental event.')}</span>}
                {d.envEvents.map((e) => {
                  const body = (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--color-neutral-500)' }}>
                        <span>{e.id}</span><span>{fmtDayMonth(e.occurredOn)} · J+{e.days}</span>
                      </div>
                      <div style={{ fontSize: 12.5, textWrap: 'pretty' }}>{e.title}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--color-neutral-500)', minWidth: 0 }}>
                        <span style={{ color: TONE[e.severityTone].dot, fontWeight: 500 }}>G{e.severity}</span>
                        <span style={{ whiteSpace: 'nowrap' }}>{e.status}</span>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.location}</span>
                      </div>
                    </>
                  );
                  return canSee(session.role, 'events')
                    ? <Link key={e.id} href={`/evenements?sel=${encodeURIComponent(e.id)}`} className={styles.event}>{body}</Link>
                    : <div key={e.id} className={styles.event}>{body}</div>;
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                {canSee(session.role, 'events') && <Link href="/evenements?type=ENV&etat=tous" className="vg-link">{t('All events →')}</Link>}
                <Aside>{plural(d.envClosed12, t('{n} closed over 12 months'), t('{n} closed over 12 months#plural'))}</Aside>
              </div>
            </div>

            <div className="card" style={{ gap: 8 }}>
              <CardHead title={t('Trackdéchets slips')} aside={<Aside>{t('Hazardous waste')} · {d.year}</Aside>} />
              <div style={{ display: 'grid', gap: 5 }}>
                {d.bsdStats.map((s) => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <Dot color={TONE[s.tone].dot} size={7} />
                    <span style={{ flex: 1, color: s.key === 'manquant' && s.n ? TONE.danger.fg : 'var(--color-neutral-300)' }}>{s.label}</span>
                    <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: s.n ? undefined : 'var(--vg-text-muted)' }}>{s.n}</span>
                  </div>
                ))}
              </div>
              {(k.stale.count > 0 || k.stale.other > 0) && (
                <div className="vg-inset" style={{ display: 'grid', gap: 3, padding: '8px 10px', fontSize: 12, boxShadow: `inset 2px 0 0 ${TONE.warn.dot}` }}>
                  <span>
                    {k.stale.count > 0
                      ? fill(plural(k.stale.count, t('{n} slip not finalised more than {days} d after the removal'), t('{n} slips not finalised more than {days} d after the removal')), { days: BSD_STALE_DAYS })
                      : fill(t('No pending slip in {year}'), { year: d.year })}
                    {k.stale.other > 0 && <span style={{ color: 'var(--color-neutral-500)' }}>{fill(t(' · + {n} in {years}'), { n: k.stale.other, years: k.stale.otherYears.join(', ') })}</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {k.stale.count > 0 && <Link href={hrefWith(PATH, { annee }, { vue: 'bsd-en-attente' })} scroll={false} className="vg-link">{t('Show')}</Link>}
                    {k.stale.otherYears.map((y) => (
                      <Link key={y} href={hrefWith(PATH, {}, { annee: y === d.currentYear ? undefined : String(y), vue: 'bsd-en-attente' })} scroll={false} className="vg-link">{y}</Link>
                    ))}
                  </span>
                </div>
              )}
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
                {t('Electronic slip required for any hazardous waste since 1 January 2022. The numbers and statuses are entered here until the connector exists.')}
              </p>
              <span title={t('Connector to come')} style={{ display: 'inline-flex', alignSelf: 'flex-start' }}>
                <button type="button" className="btn btn-secondary vg-btn-sm" disabled><Icon name="ph-plugs-connected" size={13} />{t('Trackdéchets connector · to come')}</button>
              </span>
            </div>

            {d.requirements.length > 0 && (
              <div className="card" style={{ gap: 8 }}>
                <CardHead title={t('Regulatory watch')} aside={canSee(session.role, 'watch') ? <Link href="/veille" className="vg-link">{t('Watch →')}</Link> : undefined} />
                <div style={{ display: 'grid', gap: 2 }}>
                  {d.requirements.map((r) => {
                    const body = (
                      <>
                        <div style={{ fontSize: 12.5, textWrap: 'pretty' }}>{r.text}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <ToneTag tone={r.tone}>{r.label}</ToneTag>
                          {r.note && <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{r.note}</span>}
                        </div>
                      </>
                    );
                    return canSee(session.role, 'watch')
                      ? <Link key={r.id} href={`/veille?exigence=${r.id}`} className={styles.event}>{body}</Link>
                      : <div key={r.id} className={styles.event}>{body}</div>;
                  })}
                </div>
              </div>
            )}
          </aside>
        </div>

        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
          {t('Chronological register of outgoing waste (Environment Code, art. R. 541-43 and order of 31 May 2021), kept three years. Mentions of each removal: shipping date, establishment (SIRET) and pick-up address if different, name and code of the waste, POP where relevant, quantity in tonnes (or m³), carrier (company name, SIRET, address, receipt), slip number, destination facility (company name, SIRET, address), treatment code and qualification of the final treatment. A waste whose code carries an asterisk is hazardous: its removal requires an electronic Trackdéchets tracking slip (art. R. 541-45). Treatment codes: R1–R13 recovery, D1–D15 disposal; R12, R13 and D13 to D15 are transit operations.')}
        </p>
      </div>
    </>
  );
}
