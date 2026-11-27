'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { ActionForm, Checkbox, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { firstMinuteReasonMsg, ruleBasis, type SiteRule } from '@/lib/rules/prevention';
import { ConfirmButton, ErrorLine, Facts, Notice, SectionTitle, muted, useRun } from '@/components/prevention/parts';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { ReasonForm } from '@/components/ReasonDialog';
import { Icon, ToneTag } from '@/components/ui';
import { fmtDate, fmtDayMonth } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import {
  archiveZone, cancelActivity, deleteRoute, replaceSitePlan, resetSitePlan, saveActivity, saveMapSettings, saveRoute, saveZone,
} from '@/server/sitemap';
import { activeOn, containingZone, lacksSignedPlan, type Conflict, type Pt } from '@/lib/rules/coactivity';
import {
  DEFAULT_PLANS, ROUTE_KINDS, ROUTE_KIND_KEYS, TEAMS, ZONE_KINDS, ZONE_KIND_KEYS,
  type ActivityDraft, type ActivityView, type MapConfig, type RouteView, type SitemapChoices, type Team, type ZoneView,
} from '@/lib/rules/sitemap';
import styles from './sitemap.module.css';
import { withCurrent } from '@/lib/form-options';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';
import { msgT } from '@/i18n/msg';

// Fenêtres de la carte du site : zones, voies, activités, échelle et plan de fond.

export const periodLabel = (start: string, end: string, t: T) =>
  start === end ? fill(t('On {date}'), { date: fmtDate(start) }) : start.slice(0, 4) === end.slice(0, 4) ? `${fmtDayMonth(start)} → ${fmtDate(end)}` : `${fmtDate(start)} → ${fmtDate(end)}`;

function DeleteRow({ label, question, onConfirm, pending, error }: { label: string; question: string; onConfirm: () => void; pending: boolean; error: string | null }) {
  const { t } = useI18n();
  return (
    <div style={{ display: 'grid', gap: 6, paddingTop: 10, background: 'var(--rule-soft) no-repeat top / 100% 1px' }}>
      <ErrorLine error={error} />
      <div><ConfirmButton label={label} confirmLabel={t('Delete')} icon="ph-trash" question={question} pending={pending} onConfirm={onConfirm} /></div>
    </div>
  );
}

// ─── Zones ──────────────────────────────────────────────────────────────────

/**
 * Avertissement avant l'archivage d'une zone (EVT-19) : son QR code de poste, s'il est imprimé et collé, ne pré-remplit
 * plus le lieu ; activités et événements rattachés.
 */
export function zoneArchiveMessage(zone: ZoneView, activityCount: number, t: T): string {
  const label = zone.qrVersion && zone.qrVersion > 1 ? fill(t(' (label no. {n})'), { n: zone.qrVersion }) : '';
  const parts = [
    fill(t('The zone is removed from the map, the station QR codes and the co-activity; it stays traced with its reason. Its station QR code{label}, if printed and stuck at the station, will no longer prefill the location: a report from this label will ask to choose the location. Remove the label from the station.'), { label }),
  ];
  if (activityCount) parts.push(fill(activityCount > 1 ? t('{n} activities are linked to it and keep their position, without a zone.') : t('{n} activity is linked to it and keeps their position, without a zone.'), { n: activityCount }));
  if (zone.eventCount) parts.push(fill(zone.eventCount > 1 ? t('{n} events keep this zone in their record.') : t('{n} event keeps this zone in its record.'), { n: zone.eventCount }));
  return parts.join(' ');
}

export function ZoneForm({ siteId, zone, points, activityCount, qrHref, onDone, onCancel }: {
  siteId: string; zone?: ZoneView; points?: Pt[]; activityCount: number;
  /** QR code du poste de la zone (planche des postes, encadrement). */
  qrHref?: string;
  onDone: (id?: number) => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const [archiving, setArchiving] = useState(false);
  if (zone && archiving) {
    // EVT-19 : une zone ne se supprime plus (QR code imprimé, événements rattachés) ; elle s'archive avec un motif.
    return (
      <ReasonForm action={archiveZone} hidden={{ id: zone.id }} submitLabel={t('Archive the zone')} submitIcon="ph-archive"
        message={<span className="vg-warn-text" style={{ display: 'block' }}><i className="ph ph-qr-code" style={{ marginRight: 6 }} aria-hidden />{zoneArchiveMessage(zone, activityCount, t)}</span>}
        placeholder={t('E.g. zone redrawn, room demolished, workshop rearranged')} onCancel={() => setArchiving(false)} onDone={() => onDone()} />
    );
  }
  return (
    <>
      <ActionForm action={saveZone} onDone={(s) => onDone(Number(s.id) || undefined)} onCancel={onCancel} submitLabel={zone ? t('Save') : t('Create the zone')}
        hidden={{ id: zone?.id, siteId, polygon: points ? JSON.stringify(points) : undefined }}>
        <FormRow>
          <Field name="name" label={t('Name')}>
            <Input name="name" defaultValue={zone?.name} placeholder={t('E.g. Assembly workshop')} autoFocus />
          </Field>
          <Field name="kind" label={t('Type')}>
            <Select name="kind" options={ZONE_KIND_KEYS.map((k) => [k, labelT(t)(ZONE_KINDS[k].label)] as const)} defaultValue={zone?.kind ?? 'atelier'} />
          </Field>
        </FormRow>
        <Field name="notes" label={t('Notes')} hint={t('Optional: equipment, access instructions, ATEX zoning…')}>
          <TextArea name="notes" rows={2} defaultValue={zone?.notes ?? ''} />
        </Field>
        {!zone && <span style={muted}>{fill(t('Outline of {n} vertices; you can move the vertices after saving (select the zone, then drag the handles).'), { n: points?.length ?? 0 })}</span>}
      </ActionForm>
      {zone && (
        <div style={{ display: 'grid', gap: 6, paddingTop: 10, background: 'var(--rule-soft) no-repeat top / 100% 1px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => setArchiving(true)}>
              <Icon name="ph-archive" size={13} />{t('Archive the zone')}
            </button>
            {qrHref && <Link href={qrHref} className="vg-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}><Icon name="ph-qr-code" size={13} />{t('Station QR code')}</Link>}
          </div>
        </div>
      )}
    </>
  );
}

export function ZoneSheet({ zone, activityCount, qrHref }: { zone: ZoneView; activityCount: number; qrHref?: string }) {
  const { t } = useI18n();
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Facts items={[
        [t('Type'), labelT(t)(ZONE_KINDS[zone.kind].label)],
        [t('Linked activities'), String(activityCount)],
        zone.eventCount ? [t('Linked events#records'), String(zone.eventCount)] : null,
        zone.notes ? [t('Notes'), zone.notes] : null,
      ]} />
      {qrHref && <Link href={qrHref} className="vg-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}><Icon name="ph-qr-code" size={13} />{t('Station QR code')}</Link>}
    </div>
  );
}

// ─── Voies ──────────────────────────────────────────────────────────────────

export function RouteForm({ siteId, route, points, activityCount, onDone, onCancel }: {
  siteId: string; route?: RouteView; points?: Pt[]; activityCount: number; onDone: (id?: number) => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const { pending, error, run } = useRun();
  return (
    <>
      <ActionForm action={saveRoute} onDone={(s) => onDone(Number(s.id) || undefined)} onCancel={onCancel} submitLabel={route ? t('Save') : t('Create the route')}
        hidden={{ id: route?.id, siteId, polyline: points ? JSON.stringify(points) : undefined }}>
        <FormRow>
          <Field name="name" label={t('Name')}>
            <Input name="name" defaultValue={route?.name} placeholder={t('E.g. Heavy goods vehicle delivery route')} autoFocus />
          </Field>
          <Field name="kind" label={t('Type')}>
            <Select name="kind" options={ROUTE_KIND_KEYS.map((k) => [k, labelT(t)(ROUTE_KINDS[k].label)] as const)} defaultValue={route?.kind ?? 'vehicules'} />
          </Field>
        </FormRow>
        <div style={{ display: 'grid', gap: 4 }}>
          <Checkbox name="shared" label={t('Route shared by several teams')} defaultChecked={route?.shared ?? true} />
          <span className="vg-field-hint" style={{ paddingLeft: 24, marginTop: 0 }}>{t('Two teams using a shared route on the same day are flagged as co-activity.')}</span>
        </div>
        <Field name="notes" label={t('Notes')} hint={t('Optional: traffic direction, speed, delivery hours…')}>
          <TextArea name="notes" rows={2} defaultValue={route?.notes ?? ''} />
        </Field>
      </ActionForm>
      {route && (
        <DeleteRow label={t('Delete the route')} pending={pending} error={error}
          question={activityCount ? fill(activityCount > 1 ? t('Delete the route? It will be removed from {n} activities.') : t('Delete the route? It will be removed from {n} activity.'), { n: activityCount }) : t('Delete this route for good?')}
          onConfirm={() => run(() => deleteRoute(route.id), () => onDone())} />
      )}
    </>
  );
}

export function RouteSheet({ route, activityCount }: { route: RouteView; activityCount: number }) {
  const { t } = useI18n();
  return (
    <Facts items={[
      [t('Type'), labelT(t)(ROUTE_KINDS[route.kind].label)],
      [t('Use'), route.shared ? t('Shared route') : t('Reserved route')],
      [t('Activities using it'), String(activityCount)],
      route.notes ? [t('Notes'), route.notes] : null,
    ]} />
  );
}

// ─── Activités ──────────────────────────────────────────────────────────────

type ActivityFormProps = {
  siteId: string;
  /** Règle de prévention du site (classement Seveso, plan dès la première minute). */
  rule: SiteRule;
  activity?: ActivityView;
  draft?: ActivityDraft;
  zones: ZoneView[];
  routes: RouteView[];
  choices: SitemapChoices;
  onDone: (id: number, startOn: string, endOn: string) => void;
  onCancel: () => void;
};

/** Formulaire d'activité (création préremplie depuis la carte ou « À positionner », modification). */
export function ActivityForm({ siteId, rule, activity, draft, zones, routes, choices, onDone, onCancel }: ActivityFormProps) {
  const { t } = useI18n();
  const src = activity ?? draft ?? {};
  const [team, setTeam] = useState<Team>(src.team ?? 'externe');
  const [contractorId, setContractorId] = useState(src.contractorId ?? '');
  const [planId, setPlanId] = useState(src.preventionPlanId ?? '');
  const [startOn, setStartOn] = useState(src.startOn ?? '');
  const [endOn, setEndOn] = useState(src.endOn ?? '');
  const geometry = src.geometry ?? null;
  const point = geometry?.type === 'point' ? geometry.at : null;
  const detected = point ? containingZone(zones, point) : null;
  // Nouvelle activité placée sur la carte : la zone qui contient le point prime sur la zone devinée d'après le lieu
  // du plan ou du permis (« Positionner ») ; celle-ci ne sert que pour une activité sans position.
  const zoneId = activity ? activity.zoneId ?? detected?.id ?? null : point ? detected?.id ?? null : src.zoneId ?? null;
  const guessed = !activity && point && src.zoneId != null && src.zoneId !== detected?.id ? zones.find((z) => z.id === src.zoneId) : undefined;
  const zoneHint = detected && zoneId === detected.id && (!activity || activity.zoneId == null) ? fill(t('Deduced from the position: {zone}.'), { zone: detected.name })
    : point && !detected ? `${t('Position outside the drawn zones')}${guessed ? fill(t(' (location given: {zone})'), { zone: guessed.name }) : ''}.` : undefined;
  const projects = withCurrent(choices.projects, src.keystoneProjectCode, src.keystoneProject, 'start');
  const routeIds = new Set(src.routeIds ?? []);

  const pickPlan = (id: string) => {
    setPlanId(id);
    const c = id ? choices.planContractor[id] : undefined;
    if (c) { setTeam('externe'); setContractorId(c); }
  };

  return (
    <ActionForm action={saveActivity} onDone={(s) => onDone(Number(s.id), startOn, endOn)} onCancel={onCancel}
      submitLabel={activity ? t('Save') : t('Create the activity')}
      hidden={{ id: activity?.id, siteId, geometry: geometry ? JSON.stringify(geometry) : '' }}>
      <Field name="title" label={t('Activity')}>
        <Input name="title" defaultValue={src.title} placeholder={t('E.g. Maintenance of the 10 t overhead crane')} autoFocus={!src.title} />
      </Field>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="seg" role="radiogroup" aria-label={t('Team')}>
          {(['interne', 'externe'] as const).map((k) => (
            <label key={k} className="seg-opt" style={{ fontSize: 12.5, padding: '5px 10px' }}>
              <input type="radio" name="team" value={k} checked={team === k} onChange={() => setTeam(k)} />
              <i className={`ph ${TEAMS[k].icon}`} style={{ fontSize: 14 }} aria-hidden />{labelT(t)(TEAMS[k].label)}
            </label>
          ))}
        </div>
        {team === 'externe' && rule.ppFromFirstMinute && !planId && (
          <span style={{ fontSize: 11.5, color: 'var(--tone-warn-fg)' }}>{msgT(t)(firstMinuteReasonMsg(rule))}.</span>
        )}
      </div>
      <FormRow>
        {team === 'externe' ? (
          <Field name="contractorId" label={t('External company')}>
            <Select name="contractorId" options={choices.contractors} value={contractorId} onChange={(e) => setContractorId(e.target.value)} placeholder={t('Choose…')} />
          </Field>
        ) : (
          <Field name="keystoneProjectCode" label={t('Keystone project')} hint={choices.projectsMessage ?? undefined}>
            <Select name="keystoneProjectCode" options={projects} defaultValue={src.keystoneProjectCode ?? ''} placeholder={t('No project')} />
          </Field>
        )}
        <Field name="ownerId" label={team === 'externe' ? t('Internal manager (principal)') : t('Owner')}>
          <Select name="ownerId" options={choices.people} defaultValue={src.ownerId ?? ''} placeholder={t('Choose…')} />
        </Field>
      </FormRow>
      {team === 'externe' && (
        <FormRow>
          <Field name="preventionPlanId" label={t('Prevention plan')}>
            <Select name="preventionPlanId" options={choices.plans} value={planId} onChange={(e) => pickPlan(e.target.value)} placeholder={t('No plan')} />
          </Field>
          <Field name="keystoneProjectCode" label={t('Keystone project')} hint={choices.projectsMessage ?? undefined}>
            <Select name="keystoneProjectCode" options={projects} defaultValue={src.keystoneProjectCode ?? ''} placeholder={t('No project')} />
          </Field>
        </FormRow>
      )}
      <FormRow cols={3}>
        <Field name="startOn" label={t('From#date')}>
          <Input name="startOn" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
        </Field>
        <Field name="endOn" label={t('To#date')}>
          <Input name="endOn" type="date" value={endOn} min={startOn || undefined} onChange={(e) => setEndOn(e.target.value)} />
        </Field>
        <Field name="hours" label={t('Time slot')} hint={t('Two separate slots lift the co-activity.')}>
          <Input name="hours" defaultValue={src.hours ?? ''} placeholder={t('E.g. 7.30 am – 12 pm')} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="zoneId" label={t('Zone')} hint={zoneHint}>
          <Select name="zoneId" options={zones.map((z) => [String(z.id), z.name] as const)} defaultValue={zoneId ? String(zoneId) : ''} placeholder={t('No zone#placeholder')} />
        </Field>
        <Field name="permitId" label={t('Permit (fire, test)')}>
          <Select name="permitId" options={choices.permits} defaultValue={src.permitId ?? ''} placeholder={t('No permit#placeholder')} />
        </Field>
      </FormRow>
      <div className="vg-inset" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 12 }}>
        <Icon name={geometry ? 'ph-map-pin' : 'ph-map-pin-line'} size={15} style={{ color: geometry ? 'var(--color-accent)' : 'var(--color-neutral-500)' }} />
        <span style={{ color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
          {geometry
            ? `${t('Position placed on the map')}${detected ? fill(t(', in “{zone}”'), { zone: detected.name }) : ''}. ${activity ? t('Use “Move on the map” from the record to change it.') : t('You can move it after saving by dragging the selected marker.')}`
            : t('Without position: the zone serves as an approximate position; place the activity from its record.')}
        </span>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle>{t('Access')}</SectionTitle>
        <Checkbox name="vehicles" label={t('Vehicles or machinery moving (truck, forklift, aerial platform…)')} defaultChecked={src.vehicles ?? false} />
        {routes.length === 0 && <span style={muted}>{t('No route drawn on this site: draw the traffic routes with the “Route” tool.')}</span>}
        {routes.length > 0 && (
          <div style={{ display: 'grid', gap: 5 }} role="group" aria-label={t('Routes used')}>
            <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--color-text) 70%, transparent)' }}>{t('Routes used')}</span>
            {routes.map((r) => (
              <label key={r.id} className="vg-check">
                <input type="checkbox" name="routeIds" value={r.id} defaultChecked={routeIds.has(r.id)} />
                <span className="vg-check-box"><i className="ph ph-check" aria-hidden /></span>
                <span>{r.name} <span style={muted}>· {labelT(t)(ROUTE_KINDS[r.kind].label).toLowerCase()}{r.shared ? t(' · shared route') : ''}</span></span>
              </label>
            ))}
          </div>
        )}
      </div>
      <Field name="notes" label={t('Notes')} hint={t('Optional: means, marking, specific instructions.')}>
        <TextArea name="notes" rows={2} defaultValue={src.notes ?? ''} />
      </Field>
    </ActionForm>
  );
}

/**
 * Écart de l'activité d'une entreprise extérieure active à la date : plan obligatoire (règle du site ou R. 4512-7)
 * non signé par les deux entreprises, ou plan clos ou annulé ; null sinon.
 */
/** Chaîne source (VG-N01), rendue par t(). */
export function planGap(a: ActivityView, date: string): 'Plan not signed' | 'Plan closed or cancelled' | null {
  if (a.team !== 'externe' || !a.preventionPlanId || !activeOn(a, date)) return null;
  if (a.planClosed) return 'Plan closed or cancelled';
  return lacksSignedPlan(a) ? 'Plan not signed' : null;
}

/** Fiche d'une activité : faits, coactivité du jour, liens vers le plan de prévention et le permis. */
export function ActivitySheet({ activity, zones, routes, conflicts, others, date, canManage, rule, onEdit, onMove, onDeleted }: {
  activity: ActivityView; zones: ZoneView[]; routes: RouteView[]; conflicts: Conflict[]; others: Map<number, ActivityView>; date: string;
  canManage: boolean; rule: SiteRule; onEdit: () => void; onMove: () => void; onDeleted: () => void;
}) {
  const { t } = useI18n();
  const { pending, error } = useRun();
  const [cancelling, setCancelling] = useState(false);
  const zone = zones.find((z) => z.id === activity.zoneId);
  const used = routes.filter((r) => activity.routeIds.includes(r.id));
  const mine = conflicts.filter((c) => c.a === activity.id || c.b === activity.id);
  const noPlan = activity.team === 'externe' && !activity.preventionPlanId;
  const gap = planGap(activity, date);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <ToneTag tone={activity.team === 'externe' ? 'warn' : 'accent'}><Icon name={TEAMS[activity.team].icon} size={12} style={{ marginRight: 4 }} />{labelT(t)(TEAMS[activity.team].label)}</ToneTag>
        {noPlan && <ToneTag tone={rule.ppFromFirstMinute ? 'danger' : 'warn'}>{t('Without a prevention plan')}</ToneTag>}
        {gap && <ToneTag tone="danger">{t(gap)}</ToneTag>}
        {!activity.geometry && <ToneTag tone="neutral">{zone ? t('Approximate position (zone)') : t('Without position')}</ToneTag>}
        {activity.vehicles && <span className="tag tag-neutral">{t('Vehicles / machinery')}</span>}
      </div>
      {noPlan && rule.ppFromFirstMinute && (
        <Notice tone="danger">{fill(t('{reason} of the external company: link the prevention plan of this intervention.'), { reason: msgT(t)(firstMinuteReasonMsg(rule)) })}</Notice>
      )}
      {gap && (
        <Notice tone="danger">
          {gap === 'Plan closed or cancelled'
            ? fill(t('Intervention in progress although the plan {id} is closed or cancelled: draw up a new prevention plan.'), { id: activity.preventionPlanId ?? '' })
            : fill(rule.ppFromFirstMinute
              ? t('{basis}: the plan {id} ({status}) must be signed by both companies before any intervention.')
              : t('The plan {id} ({status}) must be signed by both companies before any intervention (R. 4512-7).'), { basis: labelT(t)(ruleBasis(rule)), id: activity.preventionPlanId ?? '', status: labelT(t)(activity.planStatusLabel ?? '').toLowerCase() })}
        </Notice>
      )}
      <Facts items={[
        activity.team === 'externe' && [t('External company'), activity.contractor ?? '—'],
        [t('Owner'), activity.owner ?? '—'],
        [t('Period'), periodLabel(activity.startOn, activity.endOn, t)],
        [t('Time slot'), activity.hours ?? t('Not specified#f')],
        [t('Zone'), zone?.name ?? '—'],
        [t('Routes used'), used.length ? used.map((r) => r.name).join(', ') : t('None#f')],
        [t('Prevention plan'), activity.preventionPlanId
          ? <><Link href={`/prevention?plan=${activity.preventionPlanId}`} className="vg-link" style={{ fontSize: 12.5 }}>{activity.preventionPlanId}</Link>{activity.planStatusLabel && <span style={muted}> · {activity.planStatusLabel}</span>}</>
          : '—'],
        [t('Permit'), activity.permitId || activity.planPermits.length ? (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '2px 10px' }}>
            {activity.permitId && <Link href={`/prevention?onglet=permis&permis=${activity.permitId}`} className="vg-link" style={{ fontSize: 12.5 }}>{activity.permitId}</Link>}
            {activity.planPermits.map((p) => (
              <span key={p.id}>
                <Link href={`/prevention?onglet=permis&permis=${p.id}`} className="vg-link" style={{ fontSize: 12.5 }}>{p.id}</Link>
                <span style={muted}> · {p.type === 'essai' ? t('test permit') : t('fire permit')} {t('of the plan')}, {p.from === p.to ? fill(t('on {date}'), { date: fmtDayMonth(p.from) }) : fill(t('from {from} to {to}'), { from: fmtDayMonth(p.from), to: fmtDayMonth(p.to) })}</span>
              </span>
            ))}
          </span>
        ) : '—'],
        [t('Keystone project'), activity.keystoneProject ?? '—'],
      ]} />
      {activity.notes && (
        <div style={{ display: 'grid', gap: 4 }}>
          <SectionTitle>{t('Notes')}</SectionTitle>
          <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line' }}>{activity.notes}</span>
        </div>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle>{fill(t('Co-activity on {date}'), { date: fmtDate(date) })}</SectionTitle>
        {mine.length === 0 && <span style={muted}>{activity.startOn <= date && date <= activity.endOn ? t('No co-activity situation this day.') : t('Activity inactive on this date.')}</span>}
        {mine.map((c) => {
          const other = others.get(c.a === activity.id ? c.b : c.a);
          return (
            <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5, flexWrap: 'wrap' }}>
              <span className="vg-dot" style={{ width: 7, height: 7, background: TONE[c.tone].dot, alignSelf: 'center' }} />
              <span>{c.titleText.map(msgT(t)).join(' · ')}</span>
              <span style={muted}>{other ? fill(t('with “{title}”'), { title: other.title }) : t('with another activity')}{c.place ? ` · ${c.place}` : ''}</span>
            </div>
          );
        })}
      </div>
      {/* Historique de l'activité (PRV-12), chargé à l'ouverture. */}
      <LazyChangeLog entity="site_activity" id={activity.id} />
      <ErrorLine error={error} />
      {canManage && cancelling && (
        <ReasonForm action={cancelActivity} hidden={{ id: activity.id }} submitLabel={t('Cancel the activity')} submitIcon="ph-prohibit"
          message={t('The activity is removed from the map and the co-activity; it stays traced with its reason.')}
          placeholder={t('E.g. intervention cancelled, activity entered twice')} onCancel={() => setCancelling(false)} onDone={onDeleted} />
      )}
      {canManage && !cancelling && (
        <div className="dialog-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost vg-btn-sm" disabled={pending} onClick={() => setCancelling(true)}><Icon name="ph-prohibit" size={13} />{t('Cancel the activity')}</button>
          <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onMove}><Icon name="ph-map-pin" size={13} />{activity.geometry ? t('Move on the map') : t('Place on the map')}</button>
          <button type="button" className="btn btn-primary vg-btn-sm" onClick={onEdit}><Icon name="ph-pencil-simple" size={13} />{t('Edit')}</button>
        </div>
      )}
    </div>
  );
}

// ─── Échelle ────────────────────────────────────────────────────────────────

const parseNum = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

/** Échelle (largeur réelle du plan, étalonnage sur deux points) et seuil de proximité. */
export function ScaleForm({ map, measured, onDone, onCancel, onMeasure }: { map: MapConfig; measured: number | null; onDone: () => void; onCancel: () => void; onMeasure: () => void }) {
  const { t, lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'fr-FR';
  const [width, setWidth] = useState(map.metersPerUnit ? String(map.metersPerUnit).replace('.', ',') : '');
  const [distance, setDistance] = useState('');
  const onDistance = (val: string) => {
    setDistance(val);
    const d = parseNum(val);
    if (measured && d > 0) setWidth(String(Math.round((d / measured) * 10) / 10).replace('.', ','));
  };
  const widthM = parseNum(width);
  return (
    <ActionForm action={saveMapSettings} onDone={onDone} onCancel={onCancel} submitLabel={t('Save')} hidden={{ siteId: map.siteId }}>
      {measured != null ? (
        <Field name="distance" label={t('Real distance between the two measured points (m)')} hint={fill(t('Segment measured: {pct} % of the plan’s width. The real width of the plan is recalculated.'), { pct: (measured * 100).toLocaleString(locale, { maximumFractionDigits: 1 }) })}>
          <Input name="distance" inputMode="decimal" value={distance} onChange={(e) => onDistance(e.target.value)} placeholder={t('E.g. 104')} autoFocus />
        </Field>
      ) : (
        <Notice tone="neutral" icon="ph-ruler">
          {t('Calibrate on two points whose distance you know (length of a building, of a route…).')}{' '}
          <button type="button" className="vg-text-btn" onClick={onMeasure}>{t('Measure two points on the map')}</button>
        </Notice>
      )}
      <FormRow>
        <Field name="metersPerUnit" label={t('Real width shown by the plan (m)')}
          hint={widthM > 0 ? fill(t('1 m ≈ {px} px of the plan ({width} px wide).'), { px: (map.width / widthM).toLocaleString(locale, { maximumFractionDigits: 1 }), width: map.width }) : t('Metres for the whole width of the plan.')}>
          <Input name="metersPerUnit" inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} placeholder={t('E.g. 320')} />
        </Field>
        <Field name="proximityMeters" label={t('Proximity threshold (m)')} hint={t('Below it, two neighbouring activities are in co-activity.')}>
          <Input name="proximityMeters" inputMode="numeric" defaultValue={String(map.proximityMeters)} />
        </Field>
      </FormRow>
      {/* Historique de la carte du site (PRV-12) : zones, voies, plan de fond, échelle. */}
      <LazyChangeLog entity="site_map" id={map.siteId} title={t('Map history')} />
    </ActionForm>
  );
}

// ─── Plan de fond ───────────────────────────────────────────────────────────

const MAX_BYTES = 10 * 1024 * 1024;
const PDF_WIDTH = 2400;
type Picked = { file: File; preview: string; width: number; height: number; note: string };

const canvasBlob = (canvas: HTMLCanvasElement, type: string, t: T, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('Conversion impossible.')))), type, quality));

/** Page 1 d'un PDF → image PNG (≈ 2 400 px de large), JPEG si le PNG dépasse 10 Mo. */
async function pdfToImage(file: File, t: T): Promise<Picked> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(PDF_WIDTH / base.width, 10) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    let blob = await canvasBlob(canvas, 'image/png', t);
    if (blob.size > MAX_BYTES) blob = await canvasBlob(canvas, 'image/jpeg', t, 0.85);
    if (blob.size > MAX_BYTES) blob = await canvasBlob(canvas, 'image/jpeg', t, 0.6);
    if (blob.size > MAX_BYTES) throw new Error(t('Converted image too heavy (more than 10 MB).'));
    const name = `${file.name.replace(/\.pdf$/i, '')}.${blob.type === 'image/png' ? 'png' : 'jpg'}`;
    return {
      file: new File([blob], name, { type: blob.type }), preview: URL.createObjectURL(blob), width: canvas.width, height: canvas.height,
      note: fill(doc.numPages > 1 ? t('Page 1 of {n} converted to an image ({w} × {h} px).') : t('Page 1 converted to an image ({w} × {h} px).'), { n: doc.numPages, w: canvas.width, h: canvas.height }),
    };
  } finally {
    await task.destroy();
  }
}

async function imageSize(file: File) {
  const bmp = await createImageBitmap(file);
  const size = { width: bmp.width, height: bmp.height };
  bmp.close();
  return size;
}

/** Remplacement du plan de fond par une image ou un PDF (page 1 rendue dans le navigateur). */
export function PlanBackgroundForm({ map, onDone, onCancel }: { map: MapConfig; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reset = useRun();
  useEffect(() => () => { if (picked) URL.revokeObjectURL(picked.preview); }, [picked]);

  const pick = async (file: File | undefined) => {
    setError(null);
    setPicked(null);
    if (!file) return;
    try {
      if (file.type === 'application/pdf') {
        setBusy(t('Converting page 1 of the PDF…'));
        setPicked(await pdfToImage(file, t));
      } else if (/^image\/(png|jpeg|webp)$/.test(file.type)) {
        if (file.size > MAX_BYTES) throw new Error(fill(t('“{name}” exceeds 10 MB.'), { name: file.name }));
        const size = await imageSize(file);
        setPicked({ file, preview: URL.createObjectURL(file), ...size, note: `${size.width} × ${size.height} px.` });
      } else {
        throw new Error(t('Format not accepted: PNG, JPEG, WebP image or PDF.'));
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('This file cannot be read.'));
    } finally {
      setBusy(null);
    }
  };

  const submit = () => {
    if (!picked) return;
    start(async () => {
      const fd = new FormData();
      fd.set('siteId', map.siteId);
      fd.set('file', picked.file);
      fd.set('width', String(picked.width));
      fd.set('height', String(picked.height));
      const r = await replaceSitePlan({}, fd);
      if (r.ok) onDone();
      else setError(Object.values(r.fieldErrors ?? {})[0] ?? r.error ?? t('Saving impossible.'));
    });
  };

  const ratioChange = picked ? Math.abs(picked.height / picked.width - map.aspect) / map.aspect : 0;
  return (
    <form className="vg-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Facts items={[
        [t('Current plan'), map.custom ? map.fileName ?? t('Imported plan') : map.url ? t('Default schematic plan') : t('No plan (grid background)')],
        [t('Dimensions'), `${map.width} × ${map.height} px`],
      ]} />
      <Field name="file" label={t('New plan#background')} hint={t('PNG, JPEG or WebP image, or PDF (the first page is converted to an image); 10 MB at most.')}>
        <input id="file" name="file" type="file" className="input" accept="image/png,image/jpeg,image/webp,application/pdf"
          onChange={(e) => void pick(e.target.files?.[0])} disabled={!!busy || pending} />
      </Field>
      {busy && <span style={{ ...muted, display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="ph-spinner" size={13} />{busy}</span>}
      {picked && (
        <div style={{ display: 'grid', gap: 6 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:) avant envoi */}
          <img src={picked.preview} alt={t('Preview of the new plan')} className={styles.preview} />
          <span style={muted}>{picked.note}</span>
        </div>
      )}
      <Notice tone="warn" icon="ph-info">
        {t('Zones, routes and activities are kept in coordinates relative to the plan: check their position and adjust them if the new plan does not have the same framing, then calibrate the scale.')}
        {ratioChange > 0.02 && <> {fill(t('The proportions of the new plan differ from the current one ({pct} %): a realignment will be needed.'), { pct: Math.round(ratioChange * 100) })}</>}
      </Notice>
      <ErrorLine error={error ?? reset.error} />
      <div className="dialog-actions" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {map.custom && DEFAULT_PLANS[map.siteId] && (
          <span style={{ marginRight: 'auto' }}>
            <ConfirmButton label={t('Go back to the schematic plan')} confirmLabel={t('Go back')} icon="ph-arrow-counter-clockwise" question={t('Delete the imported plan?')}
              pending={reset.pending} onConfirm={() => reset.run(() => resetSitePlan(map.siteId), onDone)} className="btn btn-ghost vg-btn-sm" />
          </span>
        )}
        <button type="button" className="btn btn-secondary" onClick={onCancel}>{t('Cancel')}</button>
        <button type="submit" className="btn btn-primary" disabled={!picked || pending || !!busy}>{pending ? t('Sending…') : t('Replace the plan')}</button>
      </div>
    </form>
  );
}

/** Petit titre de section avec compteur, pour le panneau latéral. */
export function PanelTitle({ icon, children, count, aside }: { icon: string; children: ReactNode; count?: number; aside?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <Icon name={icon} size={15} style={{ color: 'var(--color-neutral-400)' }} />
      <span className="card-title" style={{ fontSize: 13.5 }}>{children}</span>
      {count != null && <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{count}</span>}
      {aside && <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>{aside}</span>}
    </div>
  );
}
