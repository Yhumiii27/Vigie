'use client';

import { useRef, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ReasonButton } from '@/components/ReasonDialog';
import { ActionForm, Field, TextArea } from '@/components/form';
import { ConfirmButton, ErrorLine, Notice, muted, useRun } from '@/components/prevention/parts';
import { Icon, ToneTag } from '@/components/ui';
import { addDays, fmtDate, fmtLong } from '@/lib/dates';
import { reportPostHref } from '@/lib/auth/paths';
import { TONE } from '@/lib/domain';
import type { SitemapData } from '@/lib/data/sitemap';
import { addConflictToPlan, controlConflict, moveActivity, releaseConflictControl, saveShape } from '@/server/sitemap';
import { activeOn, centroid, detectConflicts, dist, interferenceLine, type CoInput, type Conflict, type Pt } from '@/lib/rules/coactivity';
import { ActivityForm, ActivitySheet, PanelTitle, PlanBackgroundForm, RouteForm, RouteSheet, ScaleForm, ZoneForm, ZoneSheet, periodLabel, planGap } from './dialogs';
import { MapCanvas, activityPosition, type DrawState, type Layers, type MapActivity, type MapHandle, type Target, type Tool } from './MapCanvas';
import { ROUTE_KINDS, TEAMS, ZONE_KINDS, isRealDate, type ActivityDraft, type ActivityView, type PositionCandidate, type Team } from '@/lib/rules/sitemap';
import styles from './sitemap.module.css';
import { SaveStatus, safeCall } from '@/components/feedback';
import { TipButton } from '@/components/Tip';
import { useI18n } from '@/i18n/client';
import { fill, type Lang } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';
import { msgT } from '@/i18n/msg';

type DialogState =
  | { type: 'zone' | 'route'; id: number }
  | { type: 'zone-new' | 'route-new'; points: Pt[] }
  | { type: 'activity'; id: number; mode: 'view' | 'edit' }
  | { type: 'activity-new'; draft: ActivityDraft }
  | { type: 'scale'; measured: number | null }
  | { type: 'plan' };
type Placing = { mode: 'new'; draft: ActivityDraft; label: string | null } | { mode: 'move'; id: number; label: string };

// Libellés et aides : chaînes sources (VG-N01), rendues par t().
const TOOLS: [Tool, string, string, string][] = [
  ['select', 'Selection', 'ph-cursor', 'Select, move the map and the markers'],
  ['zone', 'Zone', 'ph-polygon', 'Draw a zone: click per vertex, double-click or Enter to finish'],
  ['route', 'Route', 'ph-path', 'Draw a traffic route: click per point, double-click or Enter to finish'],
  ['activity', 'Activity', 'ph-map-pin-plus', 'Place a new activity on the map'],
];
const LAYERS: [keyof Layers, string, string][] = [
  ['zones', 'Zones', 'ph-polygon'],
  ['routes', 'Routes', 'ph-path'],
  ['activities', 'Activities', 'ph-map-pin'],
  ['conflicts', 'Conflicts', 'ph-warning'],
];

const lcfirst = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n: number, one: string, many: string) => fill(n > 1 ? many : one, { n });
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const weekday = (iso: string, lang: Lang) => (isRealDate(iso) ? new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`)) : '');

/** Repère d'équipe (rond = interne, losange = externe), identique à la carte. */
function TeamMark({ team, size = 10 }: { team: Team; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-6 -6 12 12" aria-hidden style={{ flex: 'none' }}>
      {team === 'interne' ? <circle r={5} style={{ fill: TEAMS.interne.color }} /> : <rect x={-3.8} y={-3.8} width={7.6} height={7.6} transform="rotate(45)" style={{ fill: TEAMS.externe.color }} />}
    </svg>
  );
}

/** Zone citée dans le lieu d'un plan ou d'un permis (« Atelier montage · poste M3 » → Atelier montage). */
function guessZone(location: string, zones: SitemapData['zones']) {
  const loc = fold(location);
  return [...zones].sort((a, b) => b.name.length - a.name.length).find((z) => loc.includes(fold(z.name))) ?? null;
}

function placingFor(c: PositionCandidate, zones: SitemapData['zones']): Placing {
  const zone = guessZone(c.location, zones);
  return {
    mode: 'new',
    label: c.label,
    draft: {
      title: truncate(c.title, 160), team: c.contractorId ? 'externe' : 'interne', contractorId: c.contractorId, ownerId: c.ownerId,
      keystoneProject: c.keystoneProject, keystoneProjectCode: c.keystoneProjectCode, startOn: c.startOn, endOn: c.endOn, hours: c.hours, preventionPlanId: c.preventionPlanId,
      permitId: c.permitId, zoneId: zone?.id ?? null, notes: c.location ? `Lieu indiqué : ${c.location}.` : null, source: c.id,
    },
  };
}

type Props = {
  data: SitemapData;
  canManage: boolean;
  /** Date demandée (?date=) ou date du jour. */
  initialDate: string;
};

/**
 * Carte du site. Coactivité : report des mesures dans le plan de prévention seulement ; aucune action QSE (réponses du
 * service QHSE du 15/10/2026 : la prévention donne lieu à des actions immédiates, non enregistrées dans les actions QSE).
 */
export function SiteMapScreen({ data, canManage, initialDate }: Props) {
  const { t, lang } = useI18n();
  const { site, map, choices, toPosition, now, focus } = data;
  const rule = { seveso: site.seveso, ppFromFirstMinute: site.ppFromFirstMinute };
  const mapRef = useRef<MapHandle>(null);
  const [date, setDateState] = useState(focus.date ?? initialDate);
  // Date de l'URL : la navigation « ‹ › » la réécrit (history.replaceState, synchronisé avec le routeur) ; un lien
  // d'échéance ouvert alors que l'écran est affiché la change aussi, même vers la date d'origine de la page.
  const searchParams = useSearchParams();
  const requested = searchParams.get('date');
  const urlDate = isRealDate(requested) ? requested : now;
  const [seenUrlDate, setSeenUrlDate] = useState(urlDate);
  if (seenUrlDate !== urlDate) {
    setSeenUrlDate(urlDate);
    setDateState(urlDate);
  }
  const [layers, setLayers] = useState<Layers>({ plan: true, zones: true, routes: true, activities: true, conflicts: true });
  const [dimPlan, setDimPlan] = useState(false);
  const [tool, setTool] = useState<Tool>(canManage && focus.candidate ? 'activity' : 'select');
  const [placing, setPlacing] = useState<Placing | null>(() => (canManage && focus.candidate ? placingFor(focus.candidate, data.zones) : null));
  const [selection, setSelection] = useState<Target | null>(focus.activityId ? { kind: 'activity', id: focus.activityId } : null);
  const [activeConflict, setActiveConflict] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [shapes, setShapes] = useState<Record<string, Pt[]>>({});
  const [moves, setMoves] = useState<Record<number, Pt>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [initialFocus] = useState<Pt | null>(() => {
    const a = focus.activityId ? data.activities.find((x) => x.id === focus.activityId) : undefined;
    if (a) return activityPosition(a, data.zones).pos;
    const z = focus.candidate ? guessZone(focus.candidate.location, data.zones) : null;
    return z ? centroid(z.polygon) : null;
  });

  // Géométries en cours d'enregistrement (affichage immédiat).
  const zones = data.zones.map((z) => (shapes[`zone:${z.id}`] ? { ...z, polygon: shapes[`zone:${z.id}`] } : z));
  const routes = data.routes.map((r) => (shapes[`route:${r.id}`] ? { ...r, polyline: shapes[`route:${r.id}`] } : r));
  const activities: ActivityView[] = data.activities.map((a) => (moves[a.id] ? { ...a, geometry: { type: 'point', at: moves[a.id] } } : a));
  const byId = new Map(activities.map((a) => [a.id, a]));
  const input: CoInput = { zones, routes, activities, metersPerUnit: map.metersPerUnit, proximityMeters: map.proximityMeters, firstMinuteBasis: site.firstMinuteBasis };
  // PRV-10 : situations maîtrisées (mesure prise) retirées des situations signalées (carte, liste, badge, échéances).
  const controlByKey = new Map(data.controls.map((c) => [c.key, c]));
  const detected = detectConflicts(input, date);
  const conflicts = detected.filter((c) => !controlByKey.has(c.key));
  const mastered = detected.filter((c) => controlByKey.has(c.key));
  const toneOf = new Map<number, 'danger' | 'warn'>();
  conflicts.forEach((c) => [c.a, c.b].forEach((id) => { if (toneOf.get(id) !== 'danger') toneOf.set(id, c.tone); }));
  const dayActivities = activities.filter((a) => activeOn(a, date))
    .sort((a, b) => Number(!!toneOf.get(b.id)) - Number(!!toneOf.get(a.id)) || a.title.localeCompare(b.title, 'fr'));
  const mapActivities: MapActivity[] = dayActivities.map((a) => ({ ...a, ...activityPosition(a, zones), tone: toneOf.get(a.id) ?? null }));
  const zoneName = new Map(zones.map((z) => [z.id, z.name]));
  const countIn = (zoneId: number) => activities.filter((a) => a.zoneId === zoneId).length;
  const countOn = (routeId: number) => activities.filter((a) => a.routeIds.includes(routeId)).length;

  // ─── Navigation dans le temps ─────────────────────────────────────────

  const setDate = (d: string) => {
    if (!isRealDate(d)) return;
    setDateState(d);
    setActiveConflict(null);
    const url = new URL(window.location.href);
    if (d === now) url.searchParams.delete('date'); else url.searchParams.set('date', d);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  };

  // ─── Outils et sélection ──────────────────────────────────────────────

  const cancelTool = () => { setTool('select'); setPlacing(null); };
  const chooseTool = (k: Tool) => {
    setTool(k);
    setPlacing(k === 'activity' ? { mode: 'new', draft: {}, label: null } : null);
    if (k !== 'select') setSelection(null);
  };
  const openTarget = (x: Target | null) => {
    setSelection(x);
    if (!x) return;
    setDialog(x.kind === 'activity' ? { type: 'activity', id: x.id, mode: 'view' } : { type: x.kind, id: x.id });
  };
  const focusActivity = (a: ActivityView) => {
    setSelection({ kind: 'activity', id: a.id });
    const p = activityPosition(a, zones).pos;
    if (p) mapRef.current?.centerOn(p, 2.2);
  };
  const focusConflict = (c: Conflict) => {
    setActiveConflict(c.key);
    setSelection(null);
    mapRef.current?.centerOn(c.focus, 2.4);
  };
  const newActivity = () => {
    setTool('activity');
    setPlacing({ mode: 'new', draft: {}, label: null });
    setSelection(null);
  };
  const position = (c: PositionCandidate) => {
    const next = placingFor(c, zones);
    setPlacing(next);
    setTool('activity');
    setSelection(null);
    if (!activeOn(c, date)) setDate(c.startOn > now ? c.startOn : now);
    const zone = next.mode === 'new' && next.draft.zoneId != null ? zones.find((z) => z.id === next.draft.zoneId) : null;
    if (zone) mapRef.current?.centerOn(centroid(zone.polygon), 1.8);
  };
  const draftWithDates = (draft: ActivityDraft): ActivityDraft => ({ ...draft, startOn: draft.startOn ?? date, endOn: draft.endOn ?? date });

  const onPlace = (at: Pt) => {
    if (placing?.mode === 'move') {
      const id = placing.id;
      cancelTool();
      setSelection({ kind: 'activity', id });
      persistMove(id, at);
      return;
    }
    setDialog({ type: 'activity-new', draft: draftWithDates({ ...(placing?.draft ?? {}), geometry: { type: 'point', at } }) });
  };
  const persistMove = (id: number, at: Pt) => {
    setMoves((m) => ({ ...m, [id]: at }));
    startSaving(async () => {
      const r = await safeCall(() => moveActivity(id, at));
      setMoves((m) => { const { [id]: _drop, ...rest } = m; void _drop; return rest; });
      setSaveError(r.error ?? null);
    });
  };
  const persistShape = (kind: 'zone' | 'route', id: number, points: Pt[]) => {
    const key = `${kind}:${id}`;
    setShapes((s) => ({ ...s, [key]: points }));
    startSaving(async () => {
      const r = await safeCall(() => saveShape(kind, id, points));
      setShapes((s) => { const { [key]: _drop, ...rest } = s; void _drop; return rest; });
      setSaveError(r.error ?? null);
    });
  };

  const closeDialog = () => {
    if (dialog?.type === 'activity-new' || dialog?.type === 'zone-new' || dialog?.type === 'route-new') cancelTool();
    setDialog(null);
  };
  const afterActivitySaved = (id: number, startOn: string, endOn: string) => {
    cancelTool();
    setSelection({ kind: 'activity', id });
    setDialog(dialog?.type === 'activity' ? { type: 'activity', id, mode: 'view' } : null);
    if (startOn && endOn && !(startOn <= date && date <= endOn)) setDate(startOn);
  };

  // ─── Fenêtres ─────────────────────────────────────────────────────────

  let dialogTitle: ReactNode = '';
  let dialogKicker: ReactNode = t('Site map');
  let dialogWidth = 560;
  let dialogBody: ReactNode = null;
  if (dialog?.type === 'zone' || dialog?.type === 'zone-new') {
    const zone = dialog.type === 'zone' ? zones.find((z) => z.id === dialog.id) : undefined;
    dialogTitle = zone ? zone.name : t('New zone');
    dialogKicker = zone ? `${t('Zone')} · ${labelT(t)(ZONE_KINDS[zone.kind].label)}` : t('Site map · zone');
    const done = (id?: number) => { setDialog(null); setTool('select'); setSelection(id ? { kind: 'zone', id } : null); };
    dialogBody = canManage
      ? <ZoneForm siteId={site.id} zone={zone} points={dialog.type === 'zone-new' ? dialog.points : undefined} activityCount={zone ? countIn(zone.id) : 0}
        qrHref={zone ? reportPostHref(site.id, zone.id) : undefined} onDone={done} onCancel={closeDialog} />
      : zone && <ZoneSheet zone={zone} activityCount={countIn(zone.id)} />;
  } else if (dialog?.type === 'route' || dialog?.type === 'route-new') {
    const route = dialog.type === 'route' ? routes.find((r) => r.id === dialog.id) : undefined;
    dialogTitle = route ? route.name : t('New traffic route');
    dialogKicker = route ? `${t('Route')} · ${labelT(t)(ROUTE_KINDS[route.kind].label)}${route.shared ? t(' · shared route') : ''}` : t('Site map · traffic route');
    const done = (id?: number) => { setDialog(null); setTool('select'); setSelection(id ? { kind: 'route', id } : null); };
    dialogBody = canManage
      ? <RouteForm siteId={site.id} route={route} points={dialog.type === 'route-new' ? dialog.points : undefined} activityCount={route ? countOn(route.id) : 0} onDone={done} onCancel={closeDialog} />
      : route && <RouteSheet route={route} activityCount={countOn(route.id)} />;
  } else if (dialog?.type === 'activity') {
    const activity = byId.get(dialog.id);
    dialogWidth = 720;
    if (activity) {
      dialogTitle = dialog.mode === 'edit' ? t('Edit the activity') : activity.title;
      dialogKicker = activity.team === 'externe' ? `${t('External company')} · ${activity.contractor ?? ''}` : t('Internal team');
      dialogBody = dialog.mode === 'edit' && canManage
        ? <ActivityForm siteId={site.id} rule={rule} activity={activity} zones={zones} routes={routes} choices={choices}
          onDone={afterActivitySaved} onCancel={() => setDialog({ type: 'activity', id: activity.id, mode: 'view' })} />
        : <ActivitySheet activity={activity} zones={zones} routes={routes} conflicts={conflicts} others={byId} date={date} canManage={canManage}
          rule={rule}
          onEdit={() => setDialog({ type: 'activity', id: activity.id, mode: 'edit' })}
          onMove={() => {
            setDialog(null);
            setSelection({ kind: 'activity', id: activity.id });
            setTool('activity');
            setPlacing({ mode: 'move', id: activity.id, label: activity.title });
          }}
          onDeleted={() => { setDialog(null); setSelection(null); }} />;
    }
  } else if (dialog?.type === 'activity-new') {
    dialogWidth = 720;
    dialogTitle = t('New activity');
    dialogKicker = placing?.mode === 'new' && placing.label ? fill(t('Position {label}'), { label: placing.label }) : t('Site map · co-activity');
    dialogBody = <ActivityForm siteId={site.id} rule={rule} draft={dialog.draft} zones={zones} routes={routes} choices={choices}
      onDone={afterActivitySaved} onCancel={closeDialog} />;
  } else if (dialog?.type === 'scale') {
    dialogTitle = t('Scale and proximity threshold');
    dialogKicker = dialog.measured != null ? t('Calibration on two points') : t('Site map');
    dialogBody = <ScaleForm map={map} measured={dialog.measured} onDone={() => setDialog(null)} onCancel={() => setDialog(null)}
      onMeasure={() => { setDialog(null); setSelection(null); setPlacing(null); setTool('measure'); }} />;
  } else if (dialog?.type === 'plan') {
    dialogTitle = t('Replace the site plan');
    dialogKicker = site.label;
    dialogBody = <PlanBackgroundForm map={map} onDone={() => setDialog(null)} onCancel={() => setDialog(null)} />;
  }

  // ─── Bandeau d'instructions sur la carte ──────────────────────────────

  let banner: ReactNode | ((draw: DrawState) => ReactNode) = null;
  if (tool === 'zone' || tool === 'route') {
    const min = tool === 'zone' ? 3 : 2;
    banner = function DrawingBanner(draw: DrawState) {
      return (
        <>
          <span className={styles.bannerText}>
            <strong>{tool === 'zone' ? t('New zone') : t('New route')}</strong>{tool === 'zone' ? t(': one click per vertex; double-click or Enter to finish, Backspace to remove the last point, Escape to give up.') : t(': one click per point; double-click or Enter to finish, Backspace to remove the last point, Escape to give up.')}
            {!draw.ready && <span style={{ color: 'var(--color-neutral-500)' }}> {fill(t('{n} / {min} points at least.'), { n: draw.points, min })}</span>}
          </span>
          <button type="button" className="btn btn-primary vg-btn-sm" disabled={!draw.ready} onClick={() => mapRef.current?.finishDrawing()}
            title={draw.ready ? undefined : fill(t('Place at least {min} points'), { min })}>{t('Finish')}</button>
          <button type="button" className="btn btn-ghost vg-btn-sm" onClick={cancelTool}>{t('Cancel')}</button>
        </>
      );
    };
  } else if (tool === 'measure') {
    banner = (
      <>
        <span className={styles.bannerText}><strong>{t('Calibration')}</strong>{t(': click two points whose real distance you know (Escape to give up).')}</span>
        <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => { cancelTool(); setDialog({ type: 'scale', measured: null }); }}>{t('Cancel')}</button>
      </>
    );
  } else if (tool === 'activity') {
    banner = (
      <>
        <span className={styles.bannerText}>
          {placing?.mode === 'move'
            ? <><strong>{t('Move')}</strong> {fill(t('“{label}”: click on the new position.'), { label: truncate(placing.label, 60) })}</>
            : placing?.label
              ? <><strong>{fill(t('Position {label}'), { label: placing.label })}</strong>{t(': click on the map at the place of the intervention.')}</>
              : <><strong>{t('New activity')}</strong>{t(': click on the map at its place.')}</>}
        </span>
        {placing?.mode !== 'move' && (
          <TipButton className="btn btn-secondary vg-btn-sm" tip={t('Enter the activity without a point on the map (the zone serves as an approximate position)')}
            onClick={() => setDialog({ type: 'activity-new', draft: draftWithDates(placing?.draft ?? {}) })}>{t('Without position')}</TipButton>
        )}
        <button type="button" className="btn btn-ghost vg-btn-sm" onClick={cancelTool}>{t('Cancel')}</button>
      </>
    );
  }

  const dangers = conflicts.filter((c) => c.tone === 'danger').length;
  const unplaced = dayActivities.filter((a) => !activityPosition(a, zones).pos).length;

  return (
    <>
      {focus.notice && <Notice tone="warn">{focus.notice}</Notice>}
      {!canManage && focus.candidate && (
        <Notice tone="neutral" icon="ph-map-pin-line">{fill(t('{label} is not yet positioned on the site map.'), { label: focus.candidate.label })}</Notice>
      )}

      <div className={styles.layout}>
        <div className={`card ${styles.mapCard}`}>
          <div className={styles.toolbar}>
            {canManage ? (
              <div className="seg" role="radiogroup" aria-label={t('Map tools')}>
                {TOOLS.map(([key, label, icon, hint], i) => (
                  <button key={key} type="button" role="radio" aria-checked={tool === key} aria-label={`${t(label)}${t(':#sep')} ${t(hint)}`} title={t(hint)}
                    className={`seg-opt${tool === key ? ' is-on' : ''}`} onClick={() => chooseTool(key)}
                    style={{ fontSize: 12, padding: '5px 10px', border: 'none', borderLeft: i ? '1px solid var(--color-divider)' : 'none', background: 'transparent', color: tool === key ? undefined : 'inherit', font: 'inherit', cursor: 'pointer' }}>
                    <i className={`ph ${icon}`} style={{ fontSize: 14 }} aria-hidden />{t(label)}
                  </button>
                ))}
              </div>
            ) : (
              <span style={{ ...muted, fontSize: 12 }}><Icon name="ph-eye" size={13} style={{ marginRight: 5, verticalAlign: -2 }} />{t('Read-only: the map is kept up to date by management.')}</span>
            )}
            {canManage && (
              <span className={styles.toolbarEnd}>
                <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setDialog({ type: 'scale', measured: null })}><Icon name="ph-ruler" size={13} />{t('Calibrate the scale')}</button>
                <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setDialog({ type: 'plan' })}><Icon name="ph-image" size={13} />{t('Replace the plan')}</button>
                <button type="button" className="btn btn-primary vg-btn-sm" onClick={newActivity}><Icon name="ph-plus" size={13} />{t('New activity')}</button>
              </span>
            )}
          </div>
          {/* UX-14 : enregistrement d'un tracé ou d'un déplacement en cours, puis erreur éventuelle. */}
          {(saving || saveError) && <div style={{ padding: '8px 10px 0' }}><SaveStatus pending={saving} label={t('Saving the map…')} />{!saving && <ErrorLine error={saveError} />}</div>}
          <MapCanvas ref={mapRef} map={map} zones={zones} routes={routes} activities={mapActivities} conflicts={conflicts} layers={layers} dimPlan={dimPlan}
            tool={tool} editable={canManage} selection={selection} activeConflict={activeConflict} initialFocus={initialFocus}
            label={fill(t('Map of the {site} on {date}: {activities}, {conflicts}'), { site: lcfirst(site.label), date: fmtDate(date), activities: plural(dayActivities.length, t('{n} activity'), t('{n} activities')), conflicts: plural(conflicts.length, t('{n} co-activity situation'), t('{n} co-activity situations')) })}
            onSelect={openTarget}
            onDrawn={(kind, points) => setDialog({ type: kind === 'zone' ? 'zone-new' : 'route-new', points })}
            onPlace={onPlace}
            onMeasured={(a, b) => { setTool('select'); setDialog({ type: 'scale', measured: dist(a, b) }); }}
            onCancelTool={cancelTool}
            onShapeEdited={persistShape}
            onActivityMoved={persistMove}
            overlay={(draw) => (
              <>
                {banner && <div className={styles.banner} data-overlay>{typeof banner === 'function' ? banner(draw) : banner}</div>}
                {!banner && zones.length === 0 && routes.length === 0 && (
                  <div className={styles.empty} data-overlay>
                    {canManage ? t('No zone or route on this plan: draw them with the “Zone” and “Route” tools.') : t('No zone or route drawn on this plan.')}
                  </div>
                )}
              </>
            )} />
        </div>

        <div className={styles.panel}>
          {/* Date et calques */}
          <div className={`card ${styles.panelCard}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button type="button" className="btn btn-secondary vg-btn-sm" style={{ padding: '5px 7px' }} aria-label={t('Previous day#aria')} onClick={() => setDate(addDays(date, -1))}>
                <Icon name="ph-caret-left" size={14} />
              </button>
              <input type="date" className="input" value={date} aria-label={t('Date shown')} onChange={(e) => setDate(e.target.value)}
                style={{ flex: 1, minWidth: 0, minHeight: 30, padding: '3px 8px', fontSize: 12.5, colorScheme: 'dark' }} />
              <button type="button" className="btn btn-secondary vg-btn-sm" style={{ padding: '5px 7px' }} aria-label={t('Next day#aria')} onClick={() => setDate(addDays(date, 1))}>
                <Icon name="ph-caret-right" size={14} />
              </button>
              <button type="button" className="btn btn-ghost vg-btn-sm" disabled={date === now} onClick={() => setDate(now)}>{t('Today#button')}</button>
            </div>
            <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
              {weekday(date, lang)} {fmtLong(date)}{date === now ? t(' · today') : ''}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }} role="group" aria-label={t('Layers')}>
              {map.url && (
                <button type="button" className={`vg-chip${layers.plan ? ' is-on' : ''}`} aria-pressed={layers.plan} onClick={() => setLayers((l) => ({ ...l, plan: !l.plan }))}>
                  <Icon name="ph-map-trifold" size={12} />{t('Plan')}
                </button>
              )}
              {LAYERS.map(([key, label, icon]) => (
                <button key={key} type="button" className={`vg-chip${layers[key] ? ' is-on' : ''}`} aria-pressed={layers[key]} onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}>
                  <Icon name={icon} size={12} />{t(label)}
                </button>
              ))}
              {map.custom && (
                <TipButton className={`vg-chip${dimPlan ? ' is-on' : ''}`} aria-pressed={dimPlan} tip={t('Inverts the colours of a plan with a light background')} onClick={() => setDimPlan((d) => !d)}>
                  <Icon name="ph-circle-half" size={12} />{t('Darken')}
                </TipButton>
              )}
            </div>
            <div className={styles.legend}>
              <span className={styles.legendItem}><TeamMark team="interne" />{t('Internal team')}</span>
              <span className={styles.legendItem}><TeamMark team="externe" />{t('External company')}</span>
              <span className={styles.legendItem}><svg width="22" height="8" aria-hidden><line x1="1" y1="4" x2="21" y2="4" style={{ stroke: 'var(--color-accent)', strokeOpacity: 0.4, strokeWidth: 7, strokeLinecap: 'round' }} /><line x1="1" y1="4" x2="21" y2="4" style={{ stroke: ROUTE_KINDS.vehicules.color, strokeWidth: 3 }} /></svg>{t('Shared route')}</span>
              {(['mixte', 'engins', 'pietons'] as const).map((k) => (
                <span key={k} className={styles.legendItem}>
                  <svg width="22" height="8" aria-hidden><line x1="1" y1="4" x2="21" y2="4" style={{ stroke: ROUTE_KINDS[k].color, strokeWidth: 3, strokeDasharray: ROUTE_KINDS[k].dash?.map((n) => n / 2).join(' ') }} /></svg>
                  {k === 'mixte' ? t('Mixed') : k === 'engins' ? t('Machinery') : t('Pedestrians')}
                </span>
              ))}
              <span className={styles.legendItem}><svg width="12" height="12" viewBox="-7 -7 14 14" aria-hidden><circle r="5.5" style={{ fill: 'none', stroke: 'var(--color-neutral-300)', strokeWidth: 1.2, strokeDasharray: '2.2 1.8' }} /></svg>{t('Vehicles / machinery')}</span>
            </div>
          </div>

          {/* Situations de coactivité */}
          <div className={`card ${styles.panelCard}`}>
            <PanelTitle icon="ph-warning" count={conflicts.length}
              aside={conflicts.length > 0 && (
                <ToneTag tone={dangers ? 'danger' : 'warn'}>{!dangers ? t('Caution') : dangers === conflicts.length ? t('Hazard') : plural(dangers, t('of which {n} hazard'), t('of which {n} hazards'))}</ToneTag>
              )}>
              {t('Co-activity')}
            </PanelTitle>
            {conflicts.length === 0 && (
              <span style={muted}>
                {fill(dayActivities.length ? t('No co-activity situation detected on {date}.') : t('No activity located on {date}.'), { date: fmtDate(date) })}
                {!map.metersPerUnit && t(' Plan not calibrated: proximity is assessed on adjoining zones.')}
              </span>
            )}
            <div style={{ display: 'grid', gap: 6 }}>
              {conflicts.map((c) => {
                const on = c.key === activeConflict;
                const details = c.reasons.filter((r) => r.detail && r.detail !== r.subject);
                return (
                  <div key={c.key} className={`${styles.conflict}${on ? ` ${styles.isOn}` : ''}`}>
                    {/* Nom = texte visible de la situation, suivi de l'action (UX-10 : pas d'aria-label qui le masquerait). */}
                    <button type="button" className={styles.conflictHead} aria-pressed={on} onClick={() => focusConflict(c)}>
                      <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                        <ToneTag tone={c.tone}>{c.tone === 'danger' ? t('Hazard') : t('Caution')}</ToneTag>
                        <span className="tag tag-neutral">{labelT(t)(c.pairLabel)}</span>
                      </span>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, textWrap: 'pretty' }}>
                        {c.titleText.map(msgT(t)).join(' · ')}{c.place && <span style={{ fontWeight: 400, color: 'var(--color-neutral-400)' }}> · {c.place}</span>}
                      </span>
                      <span style={{ display: 'grid', gap: 3 }}>
                        {[c.a, c.b].map((id) => {
                          const a = byId.get(id);
                          if (!a) return null;
                          return (
                            <span key={id} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 12 }}>
                              <TeamMark team={a.team} size={9} />
                              <span style={{ minWidth: 0 }}>{a.title}<span style={muted}> — {a.team === 'externe' ? a.contractor : t('internal team')}{a.preventionPlanId ? ` · ${a.preventionPlanId}` : ''}</span></span>
                            </span>
                          );
                        })}
                      </span>
                      {details.length > 0 && (
                        <span style={{ display: 'grid', gap: 2 }}>
                          {details.map((r) => (
                            <span key={`${r.code}-${r.zoneId ?? ''}-${r.routeId ?? ''}`} style={{ fontSize: 11.5, color: TONE[r.tone].fg }}>{fill(t('{label}: {value}'), { label: msgT(t)(r.labelText), value: r.detail })}</span>
                          ))}
                        </span>
                      )}
                      <span className="vg-sr-only">{t(': centre the map')}</span>
                    </button>
                    <details>
                      <summary className={styles.summary}><i className="ph ph-caret-right" aria-hidden />{fill(t('Recommended measures ({n})'), { n: c.measures.length })}</summary>
                      <ul className={styles.measures} style={{ marginTop: 4 }}>{c.measureTexts.map((m, i) => <li key={c.measures[i]}>{msgT(t)(m)}</li>)}</ul>
                    </details>
                    {canManage && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {c.planIds.map((planId) => (
                          <AddToPlan key={planId} siteId={site.id} conflict={c} planId={planId} single={c.planIds.length === 1}
                            linked={[byId.get(c.a), byId.get(c.b)].find((x) => x?.preventionPlanId === planId)} />
                        ))}
                        <ControlConflictButton siteId={site.id} conflict={c} names={[byId.get(c.a)?.title, byId.get(c.b)?.title]} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {mastered.length > 0 && (
              <div style={{ display: 'grid', gap: 6 }}>
                <span style={{ ...muted, fontSize: 11.5 }}>{t('Controlled situations')} · {mastered.length}</span>
                {mastered.map((c) => {
                  const ctl = controlByKey.get(c.key)!;
                  return (
                    <div key={c.key} className={styles.conflict}>
                      <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                        <ToneTag tone="ok"><Icon name="ph-shield-check" size={11} style={{ marginRight: 4 }} />{t('Controlled#f')}</ToneTag>
                        <span className="tag tag-neutral">{labelT(t)(c.pairLabel)}</span>
                      </span>
                      <span style={{ fontSize: 12.5, textWrap: 'pretty' }}>
                        {c.titleText.map(msgT(t)).join(' · ')}{c.place && <span style={{ color: 'var(--color-neutral-400)' }}> · {c.place}</span>}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--color-neutral-300)' }}>
                        {[c.a, c.b].map((id) => byId.get(id)?.title).filter(Boolean).join(' · ')}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>
                        <span style={muted}>{t('Measure taken')} · </span>{ctl.measure}
                      </span>
                      <span style={muted}>{fill(t('Controlled on {date} by {name}'), { date: fmtDate(ctl.on), name: ctl.by })}</span>
                      {canManage && (
                        <ReasonButton label={t('Lift the control')} icon="ph-arrow-counter-clockwise" className="vg-text-btn" style={{ justifySelf: 'start', fontSize: 11.5 }}
                          title={t('Lift the control of the situation')} kicker={c.titleText.map(msgT(t)).join(' · ')} action={releaseConflictControl} hidden={{ id: ctl.id }}
                          submitLabel={t('Lift the control')} message={t('The situation is flagged again as long as it is detected. The measure taken and the reason stay in the map’s history.')}
                          placeholder={t('E.g. marking removed, hours changed')} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Activités du jour */}
          <div className={`card ${styles.panelCard}`}>
            <PanelTitle icon="ph-map-pin" count={dayActivities.length}
              aside={unplaced > 0 && <span style={{ fontSize: 11, color: 'var(--tone-warn-fg)' }}>{plural(unplaced, t('{n} without position'), t('{n} without position'))}</span>}>
              {t('Activities of the day')}
            </PanelTitle>
            {dayActivities.length === 0 && (
              <span style={muted}>{fill(t('No activity on {date}.'), { date: fmtDate(date) })}{canManage ? t(' Add some with “New activity” or from “To position”.') : ''}</span>
            )}
            <div className={styles.list}>
              {dayActivities.map((a) => {
                const on = selection?.kind === 'activity' && selection.id === a.id;
                const tone = toneOf.get(a.id);
                const placed = activityPosition(a, zones);
                const noPlan = a.team === 'externe' && !a.preventionPlanId;
                const gap = planGap(a, date);
                return (
                  <div key={a.id} className={styles.itemRow}>
                    <button type="button" className={`vg-row ${styles.rowBtn}${on ? ' is-on' : ''}`} aria-pressed={on}
                      onClick={() => focusActivity(a)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                        <TeamMark team={a.team} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.title}>{a.title}</span>
                        {tone && <span className="vg-dot" style={{ width: 7, height: 7, background: TONE[tone].dot }} title={t('Co-activity situation this day')}><span className="vg-sr-only">{t('Co-activity situation this day')}</span></span>}
                      </span>
                      <span style={{ ...muted, paddingLeft: 17 }}>
                        {a.team === 'externe' ? a.contractor : t('Internal team')}
                        {a.zoneId != null && zoneName.get(a.zoneId) ? ` · ${zoneName.get(a.zoneId)}` : ''}
                        {a.hours ? ` · ${a.hours}` : ''}
                      </span>
                      {(noPlan || gap || !placed.pos || placed.approx) && (
                        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingLeft: 17 }}>
                          {noPlan && <ToneTag tone={site.ppFromFirstMinute ? 'danger' : 'warn'} style={{ fontSize: 11, padding: '1px 7px' }}>{t('Without a prevention plan')}</ToneTag>}
                          {gap && (
                            <span title={gap === 'Plan closed or cancelled' ? fill(t('{id} is closed or cancelled'), { id: a.preventionPlanId ?? '' }) : fill(t('{id} · {status}: host and external company signatures required before any intervention'), { id: a.preventionPlanId ?? '', status: a.planStatusLabel ?? '' })}>
                              <ToneTag tone="danger" style={{ fontSize: 11, padding: '1px 7px' }}>{t(gap)} · {a.preventionPlanId}</ToneTag>
                            </span>
                          )}
                          {!placed.pos && <ToneTag tone="warn" style={{ fontSize: 11, padding: '1px 7px' }}>{t('Without position')}</ToneTag>}
                          {placed.approx && <span className="tag tag-neutral" style={{ fontSize: 11, padding: '1px 7px' }}>{t('Approximate position')}</span>}
                        </span>
                      )}
                      <span className="vg-sr-only">{t(': centre the map')}</span>
                    </button>
                    <button type="button" className={styles.iconBtn} aria-label={fill(t('Open the record “{title}”'), { title: a.title })} title={t('Open the record')}
                      onClick={() => { setSelection({ kind: 'activity', id: a.id }); setDialog({ type: 'activity', id: a.id, mode: 'view' }); }}>
                      <Icon name="ph-note-pencil" size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* À positionner */}
          <div className={`card ${styles.panelCard}`}>
            <PanelTitle icon="ph-map-pin-plus" count={toPosition.length}>{t('To position')}</PanelTitle>
            <span style={{ ...muted, marginTop: -4 }}>{t('Prevention plans and permits in progress or starting within 15 days, without an activity on the map (a permit linked to a plan already positioned follows the plan’s activity).')}</span>
            {toPosition.length === 0 && <span style={muted}>{t('All interventions of the next 15 days are positioned.')}</span>}
            <div style={{ display: 'grid', gap: 8 }}>
              {toPosition.map((c) => (
                <div key={`${c.kind}-${c.id}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                    <Link href={c.kind === 'plan' ? `/prevention?plan=${c.id}` : `/prevention?onglet=permis&permis=${c.id}`} className="vg-link" style={{ fontSize: 12.5, color: 'var(--color-text)' }}>
                      {c.label}
                    </Link>
                    <span style={{ fontSize: 12, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{truncate(c.title, 110)}</span>
                    <span style={muted}>{periodLabel(c.startOn, c.endOn, t)}{c.hours ? ` · ${c.hours}` : ''} · {c.location}</span>
                  </div>
                  {canManage && (
                    <button type="button" className="btn btn-secondary vg-btn-sm" style={{ flex: 'none' }} onClick={() => position(c)}>
                      <Icon name="ph-map-pin-plus" size={13} />{t('Position#verb')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Zones et voies */}
          <details className={`card ${styles.panelCard}`}>
            <summary className={styles.summary} style={{ fontSize: 12.5, color: 'var(--color-neutral-300)' }}>
              <i className="ph ph-caret-right" aria-hidden />{t('Zones and routes of the plan')}
              <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{zones.length} · {routes.length}</span>
            </summary>
            {zones.length === 0 && routes.length === 0 && <span style={muted}>{t('No zone or route.')}</span>}
            <div className={styles.list}>
              {zones.map((z) => (
                <button key={`z${z.id}`} type="button" className={`vg-row ${styles.rowBtn}${selection?.kind === 'zone' && selection.id === z.id ? ' is-on' : ''}`}
                  onClick={() => { openTarget({ kind: 'zone', id: z.id }); mapRef.current?.centerOn(centroid(z.polygon), 1.6); }}>
                  <span style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, flex: 'none', background: `color-mix(in srgb, ${ZONE_KINDS[z.kind].color} 35%, transparent)`, border: `1px solid ${ZONE_KINDS[z.kind].color}` }} />
                    {z.name}<span style={muted}>· {labelT(t)(ZONE_KINDS[z.kind].label)}</span>
                  </span>
                </button>
              ))}
              {routes.map((r) => (
                <button key={`r${r.id}`} type="button" className={`vg-row ${styles.rowBtn}${selection?.kind === 'route' && selection.id === r.id ? ' is-on' : ''}`}
                  onClick={() => { openTarget({ kind: 'route', id: r.id }); mapRef.current?.centerOn(r.polyline[Math.floor(r.polyline.length / 2)], 1.6); }}>
                  <span style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 }}>
                    <Icon name={ROUTE_KINDS[r.kind].icon} size={13} style={{ color: ROUTE_KINDS[r.kind].color }} />
                    {r.name}<span style={muted}>· {r.shared ? t('shared route') : t('reserved route')}</span>
                  </span>
                </button>
              ))}
            </div>
          </details>
        </div>
      </div>

      <Dialog open={!!dialog && !!dialogBody} onClose={closeDialog} width={dialogWidth} kicker={dialogKicker} title={dialogTitle}>
        {dialogBody}
      </Dialog>
    </>
  );
}

/**
 * « Marquer maîtrisée » (PRV-10) : mesure prise obligatoire ; la situation n'est plus signalée tant que la maîtrise n'est
 * pas levée. Aucune action QSE (prévention : actions immédiates).
 */
function ControlConflictButton({ siteId, conflict, names }: { siteId: string; conflict: Conflict; names: (string | undefined)[] }) {
  const { t } = useI18n();
  return (
    <DialogButton label={t('Mark as controlled')} icon="ph-shield-check" className="btn btn-secondary vg-btn-sm" title={t('Co-activity situation controlled')}
      kicker={`${conflict.titleText.map(msgT(t)).join(' · ')} · ${fmtDate(conflict.date)}`} width={500}>
      {(close) => (
        <ActionForm action={controlConflict} hidden={{ siteId, date: conflict.date, key: conflict.key }} onDone={close} onCancel={close}
          submitLabel={t('Mark as controlled')} submitIcon="ph-shield-check">
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
            {fill(t('{names}: the situation is no longer flagged (badge, deadlines) as long as the control is not lifted.'), { names: names.filter(Boolean).join(t(' and ')) })}
            {' '}{t('The measure taken, its author and its date are kept in the map’s history.')}
          </p>
          <Field name="measure" label={t('Measure taken')}>
            <TextArea name="measure" rows={3} maxLength={1000} required autoFocus
              placeholder={t('E.g. zone marked out, interventions moved to the afternoon, common instructions given to both teams')} />
          </Field>
        </ActionForm>
      )}
    </DialogButton>
  );
}

/** « Ajouter au plan de prévention » : ligne datée dans les risques d'interférence du plan lié. */
function AddToPlan({ siteId, conflict, planId, single, linked }: { siteId: string; conflict: Conflict; planId: string; single: boolean; linked?: ActivityView }) {
  const { t } = useI18n();
  const { pending, error, run } = useRun();
  if (linked?.planClosed) return <span style={muted}>{fill(t('{id} closed or cancelled'), { id: planId })}</span>;
  if (linked?.planInterference?.includes(interferenceLine(conflict))) {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--tone-ok-fg)' }}><Icon name="ph-check" size={12} />{fill(t('Carried over into {id}'), { id: planId })}</span>;
  }
  return (
    <>
      <ConfirmButton label={single ? t('Add to the prevention plan') : fill(t('Add to {id}'), { id: planId })} confirmLabel={t('Add')} icon="ph-clipboard-text" pending={pending}
        question={linked?.planHasSignature
          ? fill(t('Add this co-activity to the interference risks of {id}? The signatures collected are cancelled: the changed plan must be signed again by both companies.'), { id: planId })
          : fill(t('Add this co-activity to the interference risks of {id}?'), { id: planId })}
        tooltip={fill(t('Adds a dated line to the interference risks of the plan {id}. Essential change of the plan: signatures cancelled, plan to review and sign again with the external company.'), { id: planId })}
        onConfirm={() => run(() => addConflictToPlan(siteId, conflict.date, conflict.key, planId))} />
      <ErrorLine error={error} />
    </>
  );
}
