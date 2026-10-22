import type { Metadata } from 'next';
import Link from 'next/link';
import { NewActionButton } from '@/components/ActionFormDialog';
import { PageHeader } from '@/components/PageHeader';
import { Aside, CardHead, Dot, Icon, MissingNotice, SegLinks, ToneTag, hrefWith } from '@/components/ui';
import { ConsumptionMonthButton, ConsumptionPanel } from '@/components/environment/ConsumptionPanel';
import { FilterMenu } from '@/components/environment/FilterMenu';
import { NewStreamButton, StreamsPanel, type StreamSuggestions } from '@/components/environment/StreamsPanel';
import { NewEntryButton, WasteRegister, type StreamOption } from '@/components/environment/WasteRegister';
import { SiteSiretButton } from '@/components/environment/SiteSiret';
import { Note } from '@/components/environment/parts';
import type { Carrier, Installation } from '@/components/environment/parts';
import { fmtDelta, fmtNum, fmtPct, lcfirst, shiftMonth } from '@/components/environment/model';
import styles from '@/components/environment/environment.module.css';
import { fmtDate, fmtDayMonth } from '@/lib/dates';
import { BSD_STALE_DAYS } from '@/components/environment/model';
import { SCREENS, TONE, canApprove, canEdit, canSee, type Tone } from '@/lib/domain';
import { fmtSiret } from '@/lib/siret';
import { guard } from '@/lib/guard';
import { loadEnvironment, wasteEntryYear } from '@/lib/data/environment';
import { loadFormOptions } from '@/lib/data/options';
import { QHSE_ONLY_CREATE_MESSAGE, actionHref, canCreateAction } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { ALL_SITES } from '@/lib/session';

export const metadata: Metadata = { title: SCREENS.env.title };

const PATH = '/environnement';
const TABS = ['registre', 'filieres', 'consommations'] as const;
type Tab = (typeof TABS)[number];
const VIEWS = ['dangereux', 'bsd-manquants', 'bsd-en-attente', 'mentions-incompletes', 'annules'] as const;
type View = (typeof VIEWS)[number];

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const plural = (n: number, one: string, many: string) => `${fmtNum(n)} ${n > 1 ? many : one}`;
const uniq = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
const tonnes = (t: number) => `${fmtNum(t, t < 10 ? 2 : 1)} t`;
const fmtEnergy = (kWh: number) => (kWh >= 10_000 ? `${fmtNum(kWh / 1000)} MWh` : `${fmtNum(kWh)} kWh`);

export default async function EnvironmentPage({ searchParams }: PageProps<'/environnement'>) {
  const session = await guard('env');
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
  const tab: Tab = TABS.find((t) => t === str(sp.onglet)) ?? 'registre';
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
  const sub = `Registre ${d.year} · ${plural(live.length, 'enlèvement', 'enlèvements')} · ${missing ? `${plural(missing, 'BSD manquant', 'BSD manquants')}` : 'aucun BSD manquant'}`;

  // ── Listes de choix et valeurs par défaut
  const defaultSite = session.site.id === ALL_SITES ? allOptions.sites[0]?.[0] ?? '' : session.site.id;
  const scopeSites = d.sites.map((s) => [s.id, s.label] as const);
  const streamOptions: StreamOption[] = d.streams.map(({
    id, label, ewcCode, hazardous, unit, collector, destination, treatmentCode, channel, site, siteId,
    pop, qualification, collectorSiret, collectorAddress, collectorReceipt, destinationSiret, destinationAddress, archived,
  }) => ({
    id, label, ewcCode, hazardous, unit, collector, destination, treatmentCode, channel, site, siteId,
    pop, qualification, collectorSiret, collectorAddress, collectorReceipt, destinationSiret, destinationAddress, archived,
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
      key: 'evac', label: `Déchets évacués · ${d.year}`, value: tonnes(k.evacuated.tonnes),
      sub: plural(k.evacuated.count, 'enlèvement', 'enlèvements'),
      note: [
        k.evacuated.prevTonnes != null ? `${d.year - 1}${d.isCurrent ? ' même période' : ''} : ${tonnes(k.evacuated.prevTonnes)}` : `Cumul ${d.periodNote}`,
        k.evacuated.volumeCount ? `hors ${plural(k.evacuated.volumeCount, 'volume non pesé', 'volumes non pesés')}` : '',
      ].filter(Boolean).join(' · '),
    },
    {
      key: 'dd', label: 'Part de déchets dangereux', value: k.hazardous.share != null ? fmtPct(k.hazardous.share) : '—',
      sub: k.hazardous.share != null ? tonnes(k.hazardous.tonnes) : '', note: 'Codes déchet avec astérisque (*)',
    },
    {
      key: 'valo', label: 'Taux de valorisation', value: k.recovery.share != null ? fmtPct(k.recovery.share) : '—',
      sub: k.recovery.share != null ? tonnes(k.recovery.tonnes) : '', note: 'Quantités orientées en R1–R13',
    },
  ];
  const elecTile = {
    label: `Électricité · ${d.year}`, value: k.electricity.delta != null ? fmtDelta(k.electricity.delta) : '—',
    valueColor: elecTone ? TONE[elecTone].dot : undefined,
    sub: k.electricity.current ? fmtEnergy(k.electricity.current) : '',
    note: k.electricity.period
      ? (k.electricity.previous != null ? `${k.electricity.period} vs ${d.year - 1} (${fmtEnergy(k.electricity.previous)})` : `${k.electricity.period} · N-1 incomplet`)
      : 'Aucun relevé saisi',
  };

  const tabs: [Tab, string, string][] = [
    ['registre', 'Registre des déchets', String(live.length)],
    ['filieres', 'Filières', String(activeStreams.length)],
    ['consommations', 'Consommations', '12 mois'],
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
          <MissingNotice text={tab === 'filieres' ? 'Filière introuvable ou hors du site sélectionné.' : 'Enlèvement introuvable, hors du site sélectionné ou non accessible.'}
            closeHref={hrefWith(PATH, params, { filiere: tab === 'filieres' ? undefined : filiere })} />
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(176px, 1fr))', gap: 12 }}>
          {tiles.map(({ key, ...t }) => <div key={key} className="card" style={{ gap: 5, padding: '12px 14px', minWidth: 0 }}>{tile(t)}</div>)}

          <div className="card" style={{ gap: 5, padding: '12px 14px', minWidth: 0, boxShadow: missing ? `inset 0 0 0 1px color-mix(in srgb, ${TONE.danger.dot} 55%, transparent)` : undefined }}>
            <div className="vg-eyebrow" style={{ color: missing ? TONE.danger.fg : 'var(--color-neutral-500)' }}>BSD manquants · {d.year}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-.02em', lineHeight: 1.1, color: missing ? TONE.danger.dot : TONE.ok.dot }}>{missing}</span>
              <span style={{ fontSize: 12, color: missing ? TONE.danger.fg : 'var(--color-neutral-400)' }}>{missing ? 'déchets dangereux sans bordereau' : 'registre complet'}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
              {k.missing.other
                ? `+ ${k.missing.other} sur ${k.missing.otherYears.join(', ')} · Trackdéchets obligatoire`
                : 'Trackdéchets obligatoire (C. env. R. 541-45)'}
            </div>
            {k.missing.other > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11 }}>
                {k.missing.otherYears.map((y) => (
                  <Link key={y} href={hrefWith(PATH, {}, { annee: y === d.currentYear ? undefined : String(y), vue: 'bsd-manquants' })} scroll={false} className="vg-link">
                    Voir {y}
                  </Link>
                ))}
              </div>
            )}
            {missing > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
                <Link href={hrefWith(PATH, { annee }, { vue: 'bsd-manquants' })} scroll={false} className="vg-link">Afficher</Link>
                {d.bsdAction ? (
                  <Link href={actionHref(d.bsdAction.id)} className="vg-link" title={`${d.bsdAction.label} — ${d.bsdAction.pilot} · date cible ${fmtDate(d.bsdAction.dueOn)}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Dot color={TONE[d.bsdAction.tone].dot} size={6} />{d.bsdAction.id} · {d.bsdAction.statusLabel.toLowerCase()}
                  </Link>
                ) : actionOptions ? (
                  <NewActionButton options={actionOptions} label="Créer l'action" className="vg-text-btn" icon="ph-plus"
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
            <div className="vg-tabs">
              {tabs.map(([key, label, n]) => (
                <Link key={key} href={hrefWith(PATH, { annee }, { onglet: key === 'registre' ? undefined : key })} scroll={false} className={`vg-tab${tab === key ? ' is-on' : ''}`}>
                  <span>{label}</span><span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{n}</span>
                </Link>
              ))}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, paddingBottom: 6, flexWrap: 'wrap' }}>
                {tab === 'registre' && (
                  <a href={`${PATH}/registre?annee=${d.year}`} download className="btn btn-ghost vg-btn-sm" title={`Registre chronologique ${d.year} · ${session.site.label} · CSV`}>
                    <Icon name="ph-download-simple" size={13} />Exporter le registre
                  </a>
                )}
                {manage && tab === 'registre' && (
                  <NewEntryButton streams={streamOptions} today={d.now} showSite={d.showSite} transporters={transporters} carriers={carriers} defaultStreamId={filiere} events={d.eventOptions} />
                )}
                {manage && tab === 'filieres' && <NewStreamButton sites={allOptions.sites} defaultSite={defaultSite} suggestions={suggestions} />}
                {manage && tab === 'consommations' && monthSite && (
                  <ConsumptionMonthButton records={d.consumption.records} sites={scopeSites} defaultSite={monthSite} defaultMonth={defaultMonth} maxMonth={d.consumption.maxMonth} />
                )}
              </span>
            </div>

            {tab === 'registre' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <SegLinks size={12} pad="4px 10px" options={yearOptions} />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {([
                      { key: undefined, label: 'Tous', n: byStream.filter((e) => matchesView(e, undefined)).length },
                      { key: 'dangereux', label: 'Déchets dangereux', n: byStream.filter((e) => matchesView(e, 'dangereux')).length },
                      { key: 'bsd-manquants', label: 'BSD manquants', n: byStream.filter((e) => matchesView(e, 'bsd-manquants')).length },
                      { key: 'bsd-en-attente', label: 'BSD non finalisés', n: byStream.filter((e) => matchesView(e, 'bsd-en-attente')).length },
                      { key: 'mentions-incompletes', label: 'Mentions incomplètes', n: byStream.filter((e) => matchesView(e, 'mentions-incompletes')).length },
                      { key: 'annules', label: 'Annulés', n: byStream.filter((e) => matchesView(e, 'annules')).length },
                    ] satisfies { key: View | undefined; label: string; n: number }[])
                      .filter((c) => c.n > 0 || vue === c.key || (c.key !== 'annules' && c.key !== 'bsd-en-attente' && c.key !== 'mentions-incompletes'))
                      .map((c) => (
                      <Link key={c.label} href={hrefWith(PATH, regParams, { vue: c.key })} scroll={false} className={`vg-chip${vue === c.key ? ' is-on' : ''}`}
                        title={c.key === 'bsd-en-attente' ? `Bordereau brouillon, émis ou collecté plus de ${BSD_STALE_DAYS} jours après l'enlèvement`
                          : c.key === 'mentions-incompletes' ? 'Mentions obligatoires manquantes (arrêté du 31 mai 2021) : SIRET, adresse, récépissé, qualification du traitement…' : undefined}>
                        {c.key === 'bsd-manquants' && c.n > 0 && <Dot color={TONE.danger.dot} size={6} />}
                        {(c.key === 'bsd-en-attente' || c.key === 'mentions-incompletes') && c.n > 0 && <Dot color={TONE.warn.dot} size={6} />}
                        {c.label}<span style={{ opacity: 0.6 }}>{c.n}</span>
                      </Link>
                    ))}
                  </div>
                  <FilterMenu key={`f-${filiere ?? ''}-${d.year}-${vue ?? ''}`} icon="ph-funnel" label={`Filière : ${streamFilter ? lcfirst(streamFilter.label) : 'toutes'}`}
                    options={[
                      { href: hrefWith(PATH, regParams, { filiere: undefined }), label: 'Toutes les filières', on: !filiere, n: byView.length },
                      ...d.streams.map((s) => ({
                        href: hrefWith(PATH, regParams, { filiere: s.id }),
                        label: `${s.label}${d.showSite ? ` · ${s.site.split(' — ')[0]}` : ''}`,
                        on: filiere === s.id,
                        n: byView.filter((e) => e.streamId === s.id).length,
                      })),
                    ]} />
                  {filtered && <Link href={hrefWith(PATH, { annee }, {})} scroll={false} className="vg-link">Réinitialiser</Link>}
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                    {plural(shown.length, 'enlèvement', 'enlèvements')}{shownTonnes ? ` · ${tonnes(shownTonnes)}` : ''} · {session.site.label}
                  </span>
                </div>
                {noSiret.length > 0 ? (
                  <Note icon="ph-identification-card" tone="warn">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ flex: '1 1 260px' }}>
                        SIRET de l&apos;établissement à renseigner ({noSiret.map((s) => s.label.split(' — ')[0]).join(', ')}) : première mention du registre
                        chronologique (arrêté du 31 mai 2021).{!approver && ' À compléter par l’animateur QHSE ou la direction.'}
                      </span>
                      {approver && <SiteSiretButton sites={d.registrySites} defaultSiteId={noSiret.find((s) => s.id === siretSite)?.id ?? noSiret[0].id} />}
                    </span>
                  </Note>
                ) : d.registrySites.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                    <span>
                      {d.registrySites.map((s) => `${d.registrySites.length > 1 ? `${s.label.split(' — ')[0]} · ` : ''}SIRET ${fmtSiret(s.siret!)}`).join(' — ')}
                    </span>
                    {approver && <SiteSiretButton sites={d.registrySites} defaultSiteId={siretSite} label="Modifier" className="vg-text-btn" />}
                  </div>
                )}
                <WasteRegister key={`reg-${deepEntry?.id ?? ''}`} entries={shown} lookup={d.entries} initialId={deepEntry?.id} closeHref={hrefWith(PATH, params, {})}
                  streams={streamOptions} canManage={manage} showSite={d.showSite} today={d.now} transporters={transporters} carriers={carriers}
                  events={d.eventOptions} actionOptions={entryActionOptions} canSeeEvents={canSee(session.role, 'events')}
                  emptyText={
                    !d.streams.length ? `Aucune filière déchets pour ce site${manage ? ' : créez-en une dans l’onglet « Filières », puis inscrivez les enlèvements.' : '.'}`
                      : filtered ? 'Aucun enlèvement ne correspond aux filtres.'
                        : `Aucun enlèvement inscrit au registre en ${d.year}.`
                  } />
              </>
            )}

            {tab === 'filieres' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <SegLinks size={12} pad="4px 10px" options={yearOptions} />
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
                    {plural(activeStreams.filter((s) => s.hazardous).length, 'filière dangereuse', 'filières dangereuses')} · cumuls {d.year} {d.periodNote} et {d.year - 1}
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
              <CardHead title="Événements environnementaux" aside={
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
                  <Aside>{plural(d.envEvents.length, 'ouvert', 'ouverts')}</Aside>
                  <Link href="/signaler?type=ENV" className="vg-link" title="Signaler un déversement, une fuite, un rejet…">Signaler</Link>
                </span>
              } />
              <div style={{ display: 'grid', gap: 2 }}>
                {d.envEvents.length === 0 && <span className="vg-muted" style={{ fontSize: 12 }}>Aucun événement environnemental ouvert.</span>}
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
                {canSee(session.role, 'events') && <Link href="/evenements?type=ENV&etat=tous" className="vg-link">Tous les événements →</Link>}
                <Aside>{plural(d.envClosed12, 'clôturé', 'clôturés')} sur 12 mois</Aside>
              </div>
            </div>

            <div className="card" style={{ gap: 8 }}>
              <CardHead title="Bordereaux Trackdéchets" aside={<Aside>Déchets dangereux · {d.year}</Aside>} />
              <div style={{ display: 'grid', gap: 5 }}>
                {d.bsdStats.map((s) => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <Dot color={TONE[s.tone].dot} size={7} />
                    <span style={{ flex: 1, color: s.key === 'manquant' && s.n ? TONE.danger.fg : 'var(--color-neutral-300)' }}>{s.label}</span>
                    <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: s.n ? undefined : 'var(--color-neutral-600)' }}>{s.n}</span>
                  </div>
                ))}
              </div>
              {(k.stale.count > 0 || k.stale.other > 0) && (
                <div className="vg-inset" style={{ display: 'grid', gap: 3, padding: '8px 10px', fontSize: 12, boxShadow: `inset 2px 0 0 ${TONE.warn.dot}` }}>
                  <span>
                    {k.stale.count > 0
                      ? <>{plural(k.stale.count, 'bordereau non finalisé', 'bordereaux non finalisés')} plus de {BSD_STALE_DAYS} j après l&apos;enlèvement</>
                      : <>Aucun bordereau en attente en {d.year}</>}
                    {k.stale.other > 0 && <span style={{ color: 'var(--color-neutral-500)' }}> · + {k.stale.other} sur {k.stale.otherYears.join(', ')}</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {k.stale.count > 0 && <Link href={hrefWith(PATH, { annee }, { vue: 'bsd-en-attente' })} scroll={false} className="vg-link">Afficher</Link>}
                    {k.stale.otherYears.map((y) => (
                      <Link key={y} href={hrefWith(PATH, {}, { annee: y === d.currentYear ? undefined : String(y), vue: 'bsd-en-attente' })} scroll={false} className="vg-link">{y}</Link>
                    ))}
                  </span>
                </div>
              )}
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
                Bordereau dématérialisé obligatoire pour tout déchet dangereux depuis le 1er janvier 2022. Les numéros et statuts sont saisis ici en attendant le connecteur.
              </p>
              <span title="Connecteur à venir" style={{ display: 'inline-flex', alignSelf: 'flex-start' }}>
                <button type="button" className="btn btn-secondary vg-btn-sm" disabled><Icon name="ph-plugs-connected" size={13} />Connecteur Trackdéchets · à venir</button>
              </span>
            </div>

            {d.requirements.length > 0 && (
              <div className="card" style={{ gap: 8 }}>
                <CardHead title="Veille réglementaire" aside={canSee(session.role, 'watch') ? <Link href="/veille" className="vg-link">Veille →</Link> : undefined} />
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
          Registre chronologique des déchets sortants (Code de l&apos;environnement, art. R. 541-43 et arrêté du 31 mai 2021), conservé trois ans.
          Mentions de chaque enlèvement : date d&apos;expédition, établissement (SIRET) et adresse de prise en charge si elle diffère, dénomination et code du
          déchet, POP le cas échéant, quantité en tonnes (ou m³), transporteur (raison sociale, SIRET, adresse, récépissé), n° de bordereau, installation de
          destination (raison sociale, SIRET, adresse), code de traitement et qualification du traitement final. Un déchet dont le code porte un astérisque
          est dangereux : son enlèvement exige un bordereau de suivi dématérialisé Trackdéchets (art. R. 541-45). Codes de traitement : R1–R13 valorisation,
          D1–D15 élimination ; R12, R13 et D13 à D15 sont des opérations de transit.
        </p>
      </div>
    </>
  );
}
