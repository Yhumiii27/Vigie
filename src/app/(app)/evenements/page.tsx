import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChangeLogList } from '@/components/ChangeLog';
import type { ChangeEntry } from '@/lib/change-entry';
import { EventAccessLog } from '@/components/events/AccessLog';
import { AdvanceButton, DismissButton, MethodSeg, RestoreButton, StepBackButton } from '@/components/EventControls';
import { BackToList, DetailFocus } from '@/components/ListDetail';
import { HeaderLink } from '@/components/HeaderLink';
import { PageHeader } from '@/components/PageHeader';
import { AccidentSection } from '@/components/events/AccidentSection';
import { AnalysisEditButton } from '@/components/events/AnalysisEditButton';
import { EventActions, type EventActionItem } from '@/components/events/EventActions';
import { EventAttachments } from '@/components/events/EventAttachments';
import { EventEditButton, type EditableEvent, type EventFieldOptions } from '@/components/events/EventEditButton';
import { EventHistory } from '@/components/events/EventHistory';
import { EventInbound } from '@/components/InboundRequests';
import { FieldGrid as Fields } from '@/components/events/FieldGrid';
import { EventFilterBar } from '@/components/events/EventFilters';
import { NewEventButton } from '@/components/events/NewEventButton';
import { OccupationalSection } from '@/components/events/OccupationalSection';
import { BENIGN_REGISTER_PATH, DAT_PRINT_PATH, addActionBlocker, eventPrintHref, hasNcDisposition, hasNcOrigin, readD8, readTree, readWhys } from '@/lib/rules/events';
import { Dot, MissingNotice, SegLinks, ToneTag, hrefWith } from '@/components/ui';
import { admissibleSources, canCreateAction } from '@/lib/action-rules';
import type { ActionDefaults, ActionFormOptions } from '@/lib/action-view';
import { fmtDate, fmtDayMonth, toParisLocal } from '@/lib/dates';
import { today } from '@/lib/today';
import {
  ACTION_PRIORITIES, ALL_SITES, AVANCEMENT, D8_STEPS, EVENT_DISMISSED, EVENT_STEPS, EVENT_TYPES, EVENT_TYPE_KEYS, NC_DISPOSITIONS, NC_ORIGINS, SCREENS, SEVERITY, STEP_ACTIONS, STEP_CLOSED, TONE,
  canEdit as canEditScreen, canManage, canSee, canSeeEventType, canSeeHealth, isEmployee, proposedDomain, severityTone, type AnalysisMethod, type NcDisposition,
} from '@/lib/domain';
import { reportPostHref } from '@/lib/auth/paths';
import { DGI_REGISTER_PATH, canReadDgi } from '@/lib/rules/dgi';
import { guard } from '@/lib/guard';
import { QHSE_ONLY } from '@/lib/edit-rights';
import { loadEventChangeLog, loadEventClosures, loadEventDetail, loadEventLinkOptions, loadNewEventDefaults, loadVisibleEvents, type EventDetail } from '@/lib/data/events';
import { loadFormOptions, withCurrent, type FormOptions } from '@/lib/data/options';
import { NC_ORIGIN_NONE, ncOriginOf } from '@/lib/dashboard-rules';
import { NEW_EVENT_SOURCES, prefillKey, prefillType, sourceParam } from '@/lib/event-prefill';
import { eventFilterParams, hasEventFilters, matchesEventFilters, parseEventFilters } from '@/lib/event-filters';
import { eventView, isOpen, loadPeople } from '@/lib/queries';
import { loadEventInbound } from '@/lib/data/inbound';
import { pageParams, paginate, parsePage, parsePageSize } from '@/lib/pagination';
import { Pagination } from '@/components/Pagination';
import { getI18n } from '@/i18n/server';
import { fill, type T } from '@/i18n/translate';

export const metadata: Metadata = { title: SCREENS.events.title };

const H6 = ({ children }: { children: React.ReactNode }) => <h6 className="vg-h6">{children}</h6>;

type Tab = 'ouverts' | 'tous' | 'classes';

export default async function EventsPage({ searchParams }: PageProps<'/evenements'>) {
  const { role, user, site, siteOptions, cse } = await guard('events');
  const { t } = await getI18n();
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
  // ?type=AT, ou plusieurs types séparés par des virgules (?type=NC,RC depuis le tableau de bord).
  const askedTypes = typeof sp.type === 'string' ? sp.type.split(',') : [];
  // Maladie professionnelle (EVT-09) : filtre proposé aux seuls rôles habilités aux données de santé.
  const typeKeys = EVENT_TYPE_KEYS.filter((k) => canSeeEventType(role, k));
  const types = typeKeys.filter((k) => askedTypes.includes(k));
  const type = types.length ? types.join(',') : undefined;
  // ?origine=Fournisseurs : origine de la non-conformité (barres « Non-conformités par origine » du tableau de bord) ;
  // ?origine=aucune : origine non renseignée (TDB-13).
  const origin = sp.origine === NC_ORIGIN_NONE ? NC_ORIGIN_NONE : NC_ORIGINS.find((o) => o === sp.origine);
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const tab: Tab = sp.etat === 'tous' ? 'tous' : sp.etat === 'classes' ? 'classes' : 'ouverts';
  const now = today();
  const manager = canManage(role);
  const employee = isEmployee(role);
  // Salarié : ses propres signalements uniquement, sur tout son périmètre (filtre dans loadVisibleEvents, EVT-27).
  const [events, people, options, linkOptions] = await Promise.all([loadVisibleEvents(), loadPeople(), loadFormOptions(), loadEventLinkOptions()]);

  // EVT-13 : filtres d'URL (étape, pilote, période, gravité, ancienneté ; blessure pour les seuls rôles habilités aux
  // données de santé — ailleurs le paramètre est ignoré, jamais appliqué).
  const health = canSeeHealth(role);
  const urlFilters = parseEventFilters(sp, { health, pilots: new Set(people.keys()) });
  const needle = q.toLocaleLowerCase('fr');
  const matches = (e: (typeof events)[number]) => (!origin || (origin === NC_ORIGIN_NONE ? e.type === 'NC' && ncOriginOf(e) === null : e.ncOrigin === origin)) && matchesEventFilters(e, urlFilters, now)
    && (!needle || [e.id, e.title, e.location, e.equipment, e.keystoneProject, e.customer, e.customerRef].some((v) => v?.toLocaleLowerCase('fr').includes(needle)));
  const found = events.filter(matches);
  const inTab = { ouverts: found.filter(isOpen), tous: found.filter((e) => !e.dismissedAt), classes: found.filter((e) => !!e.dismissedAt) };
  const searched = inTab[tab];
  const selParam = str(sp.sel);
  // QUA-21 : liste paginée (?page=, ?taille=) ; sans ?page=, la page de la fiche demandée (?sel=, liens d'échéance).
  const pageSize = parsePageSize(sp.taille);
  const paged = paginate(searched.filter((e) => !types.length || (types as string[]).includes(e.type)), {
    page: parsePage(sp.page), size: pageSize, selected: selParam ? (e) => e.id === selParam : undefined,
  });
  const list = paged.items.map((e) => eventView(e, people, now));
  // Lien vers un événement non visible (autre site, signalement d'un autre déclarant) : avis « introuvable », pas un autre événement.
  const selId = selParam ? (events.some((e) => e.id === selParam) ? selParam : undefined) : list[0]?.id;
  const [detail, closures, newDefaults] = await Promise.all([
    selId ? loadEventDetail(selId) : null,
    loadEventClosures(list.filter((e) => e.step >= STEP_CLOSED).map((e) => e.id)),
    // EVT-24 : formulaire prérempli depuis la fiche d'un autre écran (src/lib/event-prefill.ts).
    manager && sp.nouveau === '1'
      ? loadNewEventDefaults({ ...Object.fromEntries(NEW_EVENT_SOURCES.map((k) => [k, sourceParam(sp, k)])), type: prefillType(str(sp.type)) })
      : null,
  ]);
  const [log, inbound] = detail && !employee
    ? await Promise.all([loadEventChangeLog(detail.event.id), detail.event.type === 'NC' ? loadEventInbound(detail.event.id) : null])
    : [[], null];
  const baseParams = { etat: tab === 'ouverts' ? undefined : tab, type, origine: origin, q: q || undefined, taille: pageParams(1, pageSize).taille };
  const params = { ...baseParams, ...eventFilterParams(urlFilters), page: pageParams(paged.page, pageSize).page, sel: selParam };

  const counts = Object.fromEntries(typeKeys.map((k) => [k, searched.filter((e) => e.type === k).length]));
  const filters: { key: string | undefined; label: string; n: number }[] = [
    { key: undefined, label: t('All'), n: searched.length },
    ...(types.length > 1 ? [{ key: type, label: types.map((k) => EVENT_TYPES[k].label).join(' + '), n: types.reduce((n, k) => n + counts[k], 0) }] : []),
    ...typeKeys.map((k) => ({ key: k, label: EVENT_TYPES[k].label, n: counts[k] })),
  ];
  const openCount = events.filter(isOpen).length;
  const fieldOptions: EventFieldOptions = {
    people: options.people, sites: options.sites, projects: options.projects, projectsMessage: options.projectsMessage,
    controls: linkOptions.controls, risks: linkOptions.risks, documents: linkOptions.documents, plans: linkOptions.plans, permits: linkOptions.permits,
    zones: linkOptions.zones,
  };
  // Formulaire d'action : service QHSE seulement (ACT-22) ; listes vides pour les autres rôles (convention isReadOnly), qui
  // lisent les actions liées et ouvrent leur fiche dans le plan. `today` : date du jour du serveur, jamais celle du navigateur.
  const qhse = canCreateAction(role);
  const actionOptions: ActionFormOptions = qhse ? { people: options.people, sites: options.sites, today: now } : { people: [], sites: [], today: now };
  const defaultSite = site.id !== ALL_SITES ? site.id : siteOptions[0]?.id;
  const emptyText = hasEventFilters(urlFilters) || q || type || origin ? t('No matching event.')
    : tab === 'classes' ? t('No dismissed event.') : tab === 'tous' ? t('No matching event.') : t('No open event.');
  const tabLink = (etat: Tab, label: string, n: number) => ({
    href: hrefWith('/evenements', params, { etat: etat === 'ouverts' ? undefined : etat, page: undefined, sel: undefined }),
    label: <>{label}<span style={{ opacity: 0.6 }}>{n}</span></>, on: tab === etat,
  });

  const dgiReader = canReadDgi({ role, cse });

  return (
    <>
      <PageHeader title={SCREENS.events.title} sub={`${fill(openCount > 1 ? t('{n} open events') : t('{n} open event'), { n: openCount })} · ${employee ? t('your reports, all your sites') : t('all types')}`}
        actions={(manager || dgiReader) && (
          <>
            {/* Registre imprimable (données de santé, EVT-04) : lien HTML simple, la feuille d'impression ne reste pas chargée. */}
            {health && (
              <HeaderLink plain href={`${BENIGN_REGISTER_PATH}${site.id !== ALL_SITES ? `?site=${encodeURIComponent(site.id)}` : ''}`} icon="ph-notebook" className="vg-wide-only">
                {t('Minor accident register')}
              </HeaderLink>
            )}
            {/* CNF-01 : registre des dangers graves et imminents (animateur QHSE, direction, membres du CSE). */}
            {dgiReader && (
              <HeaderLink href={`${DGI_REGISTER_PATH}${site.id !== ALL_SITES ? `?site=${encodeURIComponent(site.id)}` : ''}`} icon="ph-siren" className="vg-wide-only">
                {t('Serious and imminent danger register')}
              </HeaderLink>
            )}
            {manager && <NewEventButton key={prefillKey(sp)} options={fieldOptions} today={now}
              health={health} initialOpen={sp.nouveau === '1'}
              defaults={{
                siteId: newDefaults?.siteId ?? defaultSite, location: newDefaults?.location, equipment: newDefaults?.equipment, type: newDefaults?.type,
                preventionPlanId: newDefaults?.preventionPlanId, permitId: newDefaults?.permitId, controlId: newDefaults?.controlId,
                riskId: newDefaults?.riskId, documentId: newDefaults?.documentId, declarantId: user.id,
              }} />}
          </>
        )} />
      {/* UX-07 : sur téléphone, la fiche demandée (?sel=) remplace la liste, avec « Retour à la liste ». */}
      <div className="vg-page vg-md" data-focus={selParam ? 'detail' : 'list'}
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: 14, alignItems: 'start' }}>
        <div className="vg-md-list" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, maxWidth: 420 }}>
          <form action="/evenements" style={{ position: 'relative' }}>
            <i className="ph ph-magnifying-glass" style={{ position: 'absolute', left: 10, top: 10, fontSize: 15, color: 'var(--color-neutral-500)' }} aria-hidden />
            {tab !== 'ouverts' && <input type="hidden" name="etat" value={tab} />}
            {type && <input type="hidden" name="type" value={type} />}
            {origin && <input type="hidden" name="origine" value={origin} />}
            {baseParams.taille && <input type="hidden" name="taille" value={baseParams.taille} />}
            {Object.entries(eventFilterParams(urlFilters)).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <input className="input" name="q" defaultValue={q} placeholder={t('Reference, location, equipment…')} style={{ fontSize: 12.5, paddingLeft: 32 }} />
          </form>
          <div>
            <SegLinks options={[
              tabLink('ouverts', t('Open'), inTab.ouverts.length),
              tabLink('tous', t('All'), inTab.tous.length),
              tabLink('classes', t('Dismissed'), inTab.classes.length),
            ]} />
          </div>
          <EventFilterBar filters={urlFilters} base={baseParams} people={employee ? [] : options.people} health={health} pilots={!employee} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {origin && (
              <Link href={hrefWith('/evenements', params, { origine: undefined, page: undefined, sel: undefined })} scroll={false} className="vg-chip is-on" title={t('Remove the origin filter')}>
                {fill(t('Origin: {origin}'), { origin: origin === NC_ORIGIN_NONE ? t('not entered') : origin })}<i className="ph ph-x" style={{ fontSize: 11 }} aria-hidden />
              </Link>
            )}
            {filters.map((f) => (
              <Link key={f.label} href={hrefWith('/evenements', params, { type: f.key, page: undefined, sel: undefined })} scroll={false} className={`vg-chip${type === f.key ? ' is-on' : ''}`}>
                {f.label}<span style={{ opacity: 0.6 }}>{f.n}</span>
              </Link>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 3 }}>
            {list.length === 0 && <div className="vg-muted" style={{ fontSize: 12, padding: '8px 12px' }}>{emptyText}</div>}
            {list.map((e) => {
              const closedOn = closures.get(e.id);
              const state = e.dismissed ? t('dismissed') : e.step >= STEP_CLOSED ? (closedOn ? fill(t('closed on {date}'), { date: fmtDayMonth(closedOn) }) : t('closed')) : fill(t('D+{n}'), { n: e.days });
              return (
                <Link key={e.id} href={hrefWith('/evenements', params, { sel: e.id })} scroll={false} className={`vg-row${e.id === selId ? ' is-on' : ''}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-neutral-500)' }}>
                    <span>{e.id}</span>
                    <span>{fmtDayMonth(e.occurredOn)} · {state}</span>
                  </div>
                  <div style={{ fontSize: 12.5 }}>{e.title}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--color-neutral-500)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}><Dot color={TONE[e.typeTone].dot} size={6} />{e.typeLabel}</span>
                    <span style={{ color: TONE[severityTone(e.severity)].dot, fontWeight: 500 }}>G{e.severity}</span>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.location}</span>
                  </div>
                </Link>
              );
            })}
          </div>
          <Pagination path="/evenements" params={params} page={paged} label={t('Event pages')} clear={['sel']} />
        </div>

        <div className="vg-md-detail" style={{ display: 'grid', gap: 10, minWidth: 0 }}>
          <BackToList href={hrefWith('/evenements', params, { sel: undefined })} />
          {selParam && <DetailFocus key={selParam} />}
          {selParam && !detail && <MissingNotice text={t('Event not found, outside the selected site or not accessible.')} closeHref={hrefWith('/evenements', params, { sel: undefined })} />}
          {detail && (employee
            ? <ReportCard key={detail.event.id} detail={detail} sites={options.sites} />
            : <EventCard key={detail.event.id} detail={detail} log={log} inbound={inbound} options={fieldOptions} actionOptions={actionOptions} qhse={qhse} canEdit={canEditScreen(role, 'events')} canRevert={canEditScreen(role, 'events')}
              canSeeRisks={canSee(role, 'risks')} canEditRisks={canEditScreen(role, 'risks')} canSeeEnv={canSee(role, 'env')} today={now} />)}
        </div>
      </div>
    </>
  );
}

/** Libellé court de l'état d'un événement (en-tête de fiche). */
function statusText(e: EventDetail['event'], stepDates: EventDetail['stepDates'], t: T) {
  if (e.dismissed) return EVENT_DISMISSED.toLowerCase();
  if (e.step >= STEP_CLOSED) return stepDates[STEP_CLOSED] ? fill(t('closed on {date}'), { date: fmtDate(stepDates[STEP_CLOSED]!) }) : t('closed');
  return fill(t('open for {n} d'), { n: e.days });
}

/** Avancement du workflow, avec la date d'entrée dans chaque étape atteinte. */
function StepTrack({ step, dismissed, stepDates }: { step: number; dismissed: boolean; stepDates: EventDetail['stepDates'] }) {
  const closed = step >= STEP_CLOSED;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: '8px 4px' }}>
      {EVENT_STEPS.map((label, i) => {
        const done = i < step || (closed && i === step), cur = i === step && !closed;
        const date = stepDates[i];
        return (
          <div key={label} style={{ display: 'grid', gap: 6, minWidth: 0, opacity: dismissed ? 0.6 : undefined }}>
            <div style={{ height: 3, borderRadius: 2, background: done ? 'var(--color-accent-600)' : cur ? 'var(--color-accent)' : 'var(--color-neutral-800)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: done ? 'var(--color-neutral-300)' : cur ? 'var(--color-accent)' : 'var(--vg-text-muted)' }}>
              <i className={`ph ${done ? 'ph-check-circle' : cur ? 'ph-circle-half' : 'ph-circle'}`} style={{ fontSize: 12 }} aria-hidden /><span>{label}</span>
            </div>
            {date && i <= step && <span style={{ fontSize: 11, color: 'var(--color-neutral-500)', marginTop: -4 }}>{fmtDayMonth(date)}</span>}
          </div>
        );
      })}
    </div>
  );
}

async function Narrative({ description, immediateMeasures }: { description: string | null; immediateMeasures: string | null }) {
  const { t } = await getI18n();
  const text = { margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty', whiteSpace: 'pre-line' } as const;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
      <div><h6 className="vg-h6" style={{ marginBottom: 4 }}>{t('Description')}</h6><p style={text}>{description || '—'}</p></div>
      <div><h6 className="vg-h6" style={{ marginBottom: 4 }}>{t('Immediate measures')}</h6><p style={text}>{immediateMeasures || '—'}</p></div>
    </div>
  );
}

/**
 * Fiche d'un signalement vue par son déclarant (Salarié, lecture seule) : avancement daté, description, mesures immédiates,
 * pièces jointes et suite donnée (libellé et avancement des actions). Ni l'analyse des causes, ni le pilote, ni les historiques.
 */
async function ReportCard({ detail, sites }: { detail: EventDetail; sites: FormOptions['sites'] }) {
  const { t } = await getI18n();
  const { event: e, actions, attachments, stepDates, dismissal } = detail;
  const siteLabel = sites.find(([id]) => id === e.siteId)?.[1].split(' — ')[0] ?? e.siteId;

  return (
    <div className="card" style={{ gap: 16, padding: '18px 20px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{e.id}</span>
        <ToneTag tone={e.typeTone}>{e.typeLabel}</ToneTag>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{fmtDate(e.occurredOn)}{e.occurredTime ? fill(t(' at {time}'), { time: e.occurredTime }) : ''} · {statusText(e, stepDates, t)}</span>
        {/* IMP-07 : fiche imprimable du déclarant (sans pilote, analyse ni historique). */}
        <a href={eventPrintHref(e.id)} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm" style={{ marginLeft: 'auto' }}>
          <i className="ph ph-printer" style={{ fontSize: 13 }} aria-hidden />{t('Print the sheet')}
        </a>
      </div>
      <h2 style={{ fontSize: 18, margin: 0, letterSpacing: '-.01em' }}>{e.title}</h2>

      {dismissal && (
        <div className="vg-inset" role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', fontSize: 12.5 }}>
          <i className="ph ph-archive" style={{ fontSize: 16, color: 'var(--color-neutral-400)' }} aria-hidden />
          <span style={{ textWrap: 'pretty' }}>
            {fill(t('Dismissed on {date}'), { date: fmtDate(dismissal.on) })}{dismissal.reason && <> — <em style={{ color: 'var(--color-neutral-300)' }}>{dismissal.reason}</em></>}
          </span>
        </div>
      )}

      <StepTrack step={e.step} dismissed={e.dismissed} stepDates={stepDates} />
      <Fields fields={[[t('Date'), fmtDate(e.occurredOn)], [t('Location'), e.location], [t('Site'), siteLabel], [t('Equipment'), e.equipment ?? '—']]} />
      <Narrative description={e.description} immediateMeasures={e.immediateMeasures} />
      <EventAttachments eventId={e.id} files={attachments} canManage={false} />

      <div style={{ display: 'grid', gap: 8 }}>
        <H6>{t('Follow-up')}</H6>
        {actions.length > 0 ? (
          <table className="table" style={{ fontSize: 12.5 }}>
            <thead><tr><th>{t('No.')}</th><th>{t('Action')}</th><th>{t('Progress')}</th></tr></thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id}>
                  <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{a.id}</td>
                  <td>{a.label}</td>
                  <td><ToneTag tone={AVANCEMENT[a.status].tone}>{a.avancement}</ToneTag></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: '10px 12px', border: '1px dashed var(--color-divider)', borderRadius: 'var(--radius-md)' }}>
            {t('No action decided yet.')}
          </div>
        )}
      </div>
    </div>
  );
}

async function EventCard({ detail, log, inbound, options, actionOptions, qhse, canEdit, canRevert, canSeeRisks, canEditRisks, canSeeEnv, today }: {
  detail: EventDetail; log: ChangeEntry[];
  /** D13 (CV-08) : demandes reçues de Keystone pour une NC (null : autre type d'événement). */
  inbound: Awaited<ReturnType<typeof loadEventInbound>> | null;
  options: EventFieldOptions; actionOptions: ActionFormOptions; canEdit: boolean; canRevert: boolean;
  /** Service QHSE (canCreateAction) : crée et modifie les actions de l'événement ; les autres rôles les consultent. */
  qhse: boolean;
  /** Accès à l'écran « Évaluation des risques » : sinon le risque lié s'affiche sans lien. */
  canSeeRisks: boolean;
  /** Saisie sur l'écran « Évaluation des risques » (pas en consultation seule) : lien « Réévaluer le risque → ». */
  canEditRisks: boolean;
  /** Accès à l'écran « Environnement et déchets » : sinon les enlèvements liés s'affichent sans lien. */
  canSeeEnv: boolean;
  today: string;
}) {
  const { t } = await getI18n();
  const { event: e, actions, analyses, attachments, blocker, lock, history, stepDates, links, wasteEntries, health, dismissal, accident, register, zone } = detail;
  const sev = TONE[severityTone(e.severity)];
  const closed = e.step >= STEP_CLOSED;
  const locked = !!lock;
  const siteLabel = options.sites.find(([id]) => id === e.siteId)?.[1].split(' — ')[0] ?? e.siteId;
  const link = (l: { label: string; href: string } | undefined, fallback = '—') => (l ? <Link href={l.href} className="vg-link" style={{ fontSize: 12.5 }}>{l.label}</Link> : fallback);
  const fields: [string, ReactNode][] = [
    [t('Date'), fmtDate(e.occurredOn)], [t('Location'), e.location], [t('Site'), siteLabel], [t('Reporter'), e.declarantLabel], [t('Linked Keystone project'), e.keystoneProject ?? '—'],
    [e.type === 'AT' ? t('Object or equipment involved') : t('Equipment'), (
      <span key="equipment" style={{ display: 'grid', gap: 3 }}>
        {e.equipment && <span>{e.equipment}</span>}
        {links.control && (
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {link(links.control)}{links.control.status && <ToneTag tone={links.control.status.tone}>{links.control.status.label}</ToneTag>}
          </span>
        )}
        {!e.equipment && !links.control && '—'}
      </span>
    )],
    [t('Lead'), e.pilot], [t('Potential severity'), SEVERITY[e.severity]],
  ];
  // EVT-19 : zone de la carte, avec le QR code de son poste (encadrement) ; zone archivée : QR code sans lieu pré-rempli.
  if (zone) {
    fields.splice(2, 0, [t('Map zone'), (
      <span key="zone" style={{ display: 'grid', gap: 3 }}>
        <span>{zone.name}{zone.archived && <span className="vg-muted">{t(' · archived zone')}</span>}</span>
        {canEdit && !zone.archived && (
          <Link href={reportPostHref(zone.siteId, zone.id)} className="vg-link" style={{ fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <i className="ph ph-qr-code" aria-hidden />{t('Station QR code')}
          </Link>
        )}
      </span>
    )]);
  }
  if (hasNcOrigin(e.type)) fields.push([t('Origin'), e.ncOrigin ?? (e.type === 'RC' ? t('Customer complaint') : '—')]);
  if (e.type === 'AT' && e.commute) fields.push([t('Nature'), t('Commuting accident · excluded from TF1 / TG')]);
  if (hasNcDisposition(e.type)) {
    // EVT-17 : traitement du produit non conforme (ISO 9001 §8.7).
    const eur = (n: number) => fill(t('{n} k€ excl. VAT'), { n: n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) });
    fields.push(
      [t('Product disposition'), e.ncDisposition ? NC_DISPOSITIONS[e.ncDisposition as NcDisposition] ?? e.ncDisposition : t('To be decided')],
      [t('Quantity concerned'), e.ncQuantity != null ? e.ncQuantity.toLocaleString('fr-FR') : '—'],
      [t('Cost of non-quality'), e.ncCostKeur != null ? eur(e.ncCostKeur) : '—'],
    );
    if (e.ncDispositionNote) fields.push([e.ncDisposition === 'derogation' ? t('Concession granted by') : t('Disposition details'), e.ncDispositionNote]);
  }
  if (e.type === 'RC') fields.push([t('Customer'), e.customer ?? '—'], [t('Customer reference'), e.customerRef ?? '—']);
  if (e.type === 'ENV') fields.push([t('Environmental aspect'), e.envAspect ?? '—'], [t('Medium concerned'), e.envMedium ?? '—']);
  if (links.risk) {
    fields.push([t('DUER risk'), canSeeRisks ? (
      <span key="risk" style={{ display: 'grid', gap: 3 }}>
        {link(links.risk)}
        {canEditRisks && ['AT', 'PA', 'SD'].includes(e.type) && <Link href={links.risk.href} className="vg-link" style={{ fontSize: 11.5 }}>{t('Reassess the risk →')}</Link>}
      </span>
    ) : links.risk.label]);
  }
  // Document de Codex (lot 4 de M-02) : lien vers le registre, ou vers Codex hors du registre ; identifiant seul sinon.
  if (links.document) {
    const d = links.document;
    fields.push([t('Document'), (
      <span key="document" style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
        {!d.href ? d.label : d.href.startsWith('/') ? link(d) : <a href={d.href} target="_blank" rel="noopener noreferrer" className="vg-link" style={{ fontSize: 12.5 }}>{d.label}</a>}
        {d.status && <span style={{ fontSize: 11.5, color: 'var(--vg-text-muted)' }}>{d.status.label}</span>}
      </span>
    )]);
  }
  if (links.plan) fields.push([t('Prevention plan'), link(links.plan)]);
  if (links.permit) fields.push([t('Permit'), link(links.permit)]);
  if (wasteEntries.length) {
    fields.push([t('Waste collections'), (
      <span key="waste" style={{ display: 'grid', gap: 3 }}>
        {wasteEntries.map((w) => (
          <span key={w.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {canSeeEnv ? link(w) : w.label}{w.status && <ToneTag tone={w.status.tone}>{w.status.label}</ToneTag>}
          </span>
        ))}
      </span>
    )]);
  }

  // Données de santé à null pour un rôle non habilité (withoutHealth) : le formulaire ne les propose pas.
  const editable: EditableEvent = {
    id: e.id, siteId: e.siteId, type: e.type, title: e.title, occurredOn: e.occurredOn, occurredTime: e.occurredTime, location: e.location, equipment: e.equipment,
    keystoneProject: e.keystoneProject, keystoneProjectCode: e.keystoneProjectCode, pilotId: e.pilotId, severity: e.severity, description: e.description, immediateMeasures: e.immediateMeasures,
    ncOrigin: e.ncOrigin, customer: e.customer, customerRef: e.customerRef, envAspect: e.envAspect, envMedium: e.envMedium,
    victimKind: e.victimKind, victimId: e.victimId, victimName: e.victimName, victimCompany: e.victimCompany, workSchedule: e.workSchedule,
    knownAt: e.knownAt ? toParisLocal(e.knownAt) : null, activity: e.activity, circumstances: e.circumstances, witnesses: e.witnesses, thirdParty: e.thirdParty,
    injury: e.injury, lostDays: e.lostDays, cpamDeclaredOn: e.cpamDeclaredOn, lesionNature: e.lesionNature, lesionSite: e.lesionSite, careGiven: e.careGiven, reservesOn: e.reservesOn,
    controlId: e.controlId, riskId: e.riskId, documentId: e.documentId, preventionPlanId: e.preventionPlanId, permitId: e.permitId, zoneId: e.zoneId,
    version: detail.version,
    commute: e.commute, ncDisposition: e.ncDisposition, ncQuantity: e.ncQuantity, ncCostKeur: e.ncCostKeur, ncDispositionNote: e.ncDispositionNote,
    mpTable: e.mpTable, mpDisease: e.mpDisease, mpCertificateOn: e.mpCertificateOn, mpInformedOn: e.mpInformedOn,
    mpQuestionnaireReceivedOn: e.mpQuestionnaireReceivedOn, mpQuestionnaireReturnedOn: e.mpQuestionnaireReturnedOn,
  };
  // Valeurs déjà enregistrées gardées dans les listes (pilote sorti, site archivé, rattachement hors du site sélectionné).
  const editOptions: EventFieldOptions = {
    ...options,
    people: withCurrent(options.people, e.pilotId, e.pilot),
    victims: withCurrent(options.people, e.victimId, accident?.victim),
    sites: withCurrent(options.sites, e.siteId, siteLabel),
    controls: withCurrent(options.controls, e.controlId == null ? null : String(e.controlId), links.control?.label),
    risks: withCurrent(options.risks, e.riskId == null ? null : String(e.riskId), links.risk?.label),
    documents: withCurrent(options.documents, e.documentId, links.document?.label),
    plans: withCurrent(options.plans, e.preventionPlanId, links.plan?.label),
    permits: withCurrent(options.permits, e.permitId, links.permit?.label),
    // Zone enregistrée gardée comme choix (archivée, ou hors du site sélectionné), jamais proposée pour un nouveau choix.
    zones: zone && !(options.zones ?? []).some((z) => z.id === zone.id)
      ? [{ id: zone.id, name: zone.archived ? fill(t('{name} (archived)'), { name: zone.name }) : zone.name, siteId: zone.siteId }, ...(options.zones ?? [])]
      : options.zones,
  };
  // Avertissement « aucune donnée de santé » du formulaire d'action (§ 4) : événement de type AT.
  const at = e.type === 'AT';
  const actionItems: EventActionItem[] = actions.map((a) => ({
    id: a.id, label: a.label, pilot: a.pilot, due: a.due, late: a.late, tone: a.tone, statusLabel: a.statusLabel,
    priority: a.priority ? ACTION_PRIORITIES[a.priority] : null,
    site: a.siteId === e.siteId ? siteLabel : a.siteId ?? undefined,
    // Modification depuis la fiche : service QHSE, action non abandonnée (lecture seule, D17) ; valeurs actuelles.
    edit: qhse && a.status !== 'abandonnee' ? {
      id: a.id, status: a.status, source: a.source, originRef: a.originRef, domain: a.domain, priority: a.priority, riskLevel: a.riskLevel,
      problem: a.problem ?? '', detail: a.detail, siteId: a.siteId, pilotId: a.pilotId, pilotName: a.pilot, openedOn: a.openedOn,
      dueOn: a.dueOn, verifyDueOn: a.verifyDueOn, doneOn: a.doneOn, verifyMethod: a.verifyMethod, efficacyNote: a.efficacyNote,
      hours: a.hours, estimatedCost: a.estimatedCost, actualCost: a.actualCost, healthWarning: at,
    } : undefined,
  }));
  // Création depuis l'événement (QHSE) : source imposée par l'événement (Réclamation client pour une RC, sinon Évènement
  // QSE, D20), événement lié, domaine proposé, problème = intitulé neutre de l'événement (jamais un champ de santé).
  const [source] = admissibleSources('event', { eventType: e.type });
  const newDefaults: ActionDefaults = {
    source, lockSource: true, link: `event:${e.id}`, linkLabel: `${e.id} · ${e.title}`, originRef: e.id,
    domain: proposedDomain({ eventType: e.type }), problem: e.title, siteId: e.siteId, pilotId: e.pilotId ?? undefined, healthWarning: at,
  };
  // Les actions abandonnées restent affichées mais ne retiennent plus l'événement (classement sans suite).
  const openLinked = actions.filter((a) => a.status !== 'abandonnee').length;
  const method = e.analysisMethod as AnalysisMethod;
  const hint = !canEdit ? QHSE_ONLY : closed && !e.dismissed ? undefined : blocker ?? undefined;

  return (
    <div className="card" style={{ gap: 16, padding: '18px 20px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{e.id}</span>
        <ToneTag tone={e.typeTone}>{e.typeLabel}</ToneTag>
        {e.type === 'AT' && e.commute && <ToneTag tone="neutral">{t('Commute')}</ToneTag>}
        <span className="tag" style={{ background: sev.bg, color: sev.fg }}>{SEVERITY[e.severity]}</span>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{fmtDate(e.occurredOn)}{e.occurredTime ? fill(t(' at {time}'), { time: e.occurredTime }) : ''} · {statusText(e, stepDates, t)}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
          {/* IMP-07 : fiche imprimable (mêmes droits que la fiche) ; lien HTML simple (print.css). */}
          <a href={eventPrintHref(e.id)} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm">
            <i className="ph ph-printer" style={{ fontSize: 13 }} aria-hidden />{t('Print the sheet')}
          </a>
          {/* EVT-10 : synthèse imprimable de la DAT et feuille d'accident (données de santé) ; lien HTML simple (print.css). */}
          {health && e.type === 'AT' && (
            <a href={`${DAT_PRINT_PATH}/${encodeURIComponent(e.id)}`} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm">
              <i className="ph ph-printer" style={{ fontSize: 13 }} aria-hidden />{t('DAT summary')}
            </a>
          )}
          {canEdit && !locked && <EventEditButton event={editable} options={editOptions} health={health} benign={register?.entry ? (register.entry.escalatedAt ? 'escalated' : 'active') : null} />}
          {canRevert && !e.dismissed && !closed && (
            <DismissButton id={e.id} disabled={openLinked > 0}
              tooltip={openLinked > 1 ? fill(t('{n} linked actions: abandon them first in the action plan.'), { n: openLinked }) : openLinked === 1 ? t('1 linked action: abandon it first in the action plan.') : t('Duplicate, false report, off topic…')} />
          )}
          {canRevert && !e.dismissed && e.step > 0 && (
            <StepBackButton key={`back-${e.step}`} id={e.id} reopen={closed} label={closed ? t('Reopen the event') : fill(t('Back to “{step}”'), { step: EVENT_STEPS[e.step - 1] })} />
          )}
          <AdvanceButton key={`next-${e.step}`} id={e.id} label={closed ? t('Closed') : fill(t('Move to “{step}”'), { step: EVENT_STEPS[e.step + 1] })} disabled={closed || e.dismissed || !!blocker || !canEdit} hint={hint} />
        </span>
      </div>
      <h2 style={{ fontSize: 18, margin: 0, letterSpacing: '-.01em' }}>{e.title}</h2>

      {dismissal ? (
        <div className="vg-inset" role="status" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '10px 12px', fontSize: 12.5 }}>
          <i className="ph ph-archive" style={{ fontSize: 16, color: 'var(--color-neutral-400)' }} aria-hidden />
          <span style={{ flex: 1, minWidth: 200, textWrap: 'pretty' }}>
            {fill(t('Dismissed on {date} by {by}'), { date: fmtDate(dismissal.on), by: dismissal.by })}{dismissal.reason && <> — <em style={{ color: 'var(--color-neutral-300)' }}>{dismissal.reason}</em></>}
          </span>
          {canRevert && <RestoreButton id={e.id} />}
        </div>
      ) : lock && (
        <div className="vg-inset" role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', fontSize: 12.5, color: 'var(--color-neutral-300)' }}>
          <i className="ph ph-lock-simple" style={{ fontSize: 15, color: 'var(--color-neutral-400)' }} aria-hidden />{lock}
        </div>
      )}

      <StepTrack step={e.step} dismissed={e.dismissed} stepDates={stepDates} />
      <Fields fields={fields} />
      <Narrative description={e.description} immediateMeasures={e.immediateMeasures} />
      {accident && <AccidentSection detail={detail} canEdit={canEdit} today={today} />}
      {detail.occupational && <OccupationalSection detail={detail} canEdit={canEdit} />}

      <EventAttachments eventId={e.id} files={attachments} canManage={canEdit && !locked} />

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <H6>{t('Root cause analysis')}</H6>
          <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}>
            <MethodSeg key={e.id} id={e.id} method={method} disabled={!canEdit || locked} hint={lock ?? undefined} />
            {canEdit && !locked && <AnalysisEditButton key={`${e.id}-${method}`} eventId={e.id} method={method} content={analyses[method]} />}
          </span>
        </div>
        <Analysis method={method} content={analyses[method]} />
      </div>

      <EventActions eventId={e.id} items={actionItems} options={actionOptions} canCreate={qhse} newDefaults={newDefaults}
        emptyNote={fill(t('No linked action — the root cause analysis must produce at least one before moving to the “{step}” stage.'), { step: EVENT_STEPS[STEP_ACTIONS] })}
        addBlocked={addActionBlocker(e.step, e.dismissed)} />

      {inbound && <EventInbound items={inbound.items} qhse={inbound.qhse} />}
      <EventHistory entries={history} />
      <ChangeLogList entries={log} title={t('Change log')} />
      {/* SEC-11 : consultations des données de santé et des pièces jointes, pour les rôles habilités seulement. */}
      {health && <EventAccessLog eventId={e.id} />}
    </div>
  );
}

async function Empty({ label }: { label: string }) {
  const { t } = await getI18n();
  return <div className="vg-inset" style={{ padding: 12, fontSize: 12, color: 'var(--color-neutral-500)' }}>{fill(t('No “{label}” analysis entered for this event.'), { label })}</div>;
}

async function Analysis({ method, content }: { method: string; content: unknown }) {
  const { t } = await getI18n();
  if (method === '5m') {
    const rows = content as [string, string][] | undefined;
    if (!rows?.length) return <Empty label="5M" />;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
        {rows.map(([k, v]) => (
          <div key={k} className="vg-inset" style={{ padding: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--color-accent-300)', marginBottom: 4 }}>{k}</div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-300)' }}>{v}</div>
          </div>
        ))}
      </div>
    );
  }
  if (method === 'tree') {
    const nodes = readTree(content);
    if (!nodes.length) return <Empty label={t('Cause tree')} />;
    return (
      <div className="vg-inset" style={{ display: 'grid', gap: 6, padding: 12 }}>
        {nodes.map(([lvl, cause, top], i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: lvl * 18 }}>
            <span style={{ width: 8, height: 8, flex: 'none', borderRadius: '50%', border: '1px solid var(--color-accent)', background: top ? 'var(--color-accent)' : 'transparent' }} />
            <span style={{ fontSize: 12, color: 'var(--color-neutral-300)' }}>{cause}</span>
          </div>
        ))}
      </div>
    );
  }
  if (method === 'why') {
    const whys = readWhys(content);
    if (!whys.length) return <Empty label={t('5 whys')} />;
    return (
      <div className="vg-inset" style={{ display: 'grid', gap: 6, padding: 12 }}>
        {whys.map((why, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 8, fontSize: 12, color: 'var(--color-neutral-300)' }}>
            <span style={{ color: 'var(--color-accent)' }}>{i + 1}.</span><span>{why}</span>
          </div>
        ))}
      </div>
    );
  }
  const { current, notes } = readD8(content);
  const noted = notes.map((n, i) => [D8_STEPS[i], n] as const).filter(([s, n]) => s && n);
  return (
    <div className="vg-inset" style={{ display: 'grid', gap: 10, padding: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px 12px' }}>
        {D8_STEPS.map((d8, i) => (
          <div key={d8} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12, color: i < current ? 'var(--color-neutral-300)' : i === current ? 'var(--color-accent)' : 'var(--vg-text-muted)' }}>
            <i className={`ph ${i < current ? 'ph-check-circle' : i === current ? 'ph-circle-half' : 'ph-circle'}`} style={{ fontSize: 13 }} aria-hidden /><span>{d8}</span>
          </div>
        ))}
      </div>
      {noted.length > 0 && (
        <div style={{ display: 'grid', gap: 6, paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
          {noted.map(([s, n]) => (
            <div key={s} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 150px) minmax(0, 1fr)', gap: 12, fontSize: 12 }}>
              <span style={{ color: 'var(--color-accent-300)' }}>{s}</span>
              <span style={{ color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
