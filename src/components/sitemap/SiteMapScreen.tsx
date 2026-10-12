'use client';

import { useRef, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { NewActionButton, type ActionDefaults } from '@/components/ActionFormDialog';
import { Dialog } from '@/components/Dialog';
import { ConfirmButton, ErrorLine, Notice, muted, useRun } from '@/components/prevention/parts';
import { Icon, ToneTag } from '@/components/ui';
import { addDays, fmtDate, fmtDayMonth, fmtLong } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { FormOptions } from '@/lib/data/options';
import type { SitemapData } from '@/lib/data/sitemap';
import { addConflictToPlan, moveActivity, saveShape } from '@/server/sitemap';
import { activeOn, centroid, detectConflicts, dist, interferenceLine, type CoInput, type Conflict, type Pt } from './coactivity';
import { ActivityForm, ActivitySheet, PanelTitle, PlanBackgroundForm, RouteForm, RouteSheet, ScaleForm, ZoneForm, ZoneSheet, periodLabel, planGap } from './dialogs';
import { MapCanvas, activityPosition, type DrawState, type Layers, type MapActivity, type MapHandle, type Target, type Tool } from './MapCanvas';
import { ROUTE_KINDS, TEAMS, ZONE_KINDS, isRealDate, type ActivityDraft, type ActivityView, type PositionCandidate, type Team } from './model';
import styles from './sitemap.module.css';

type DialogState =
  | { type: 'zone' | 'route'; id: number }
  | { type: 'zone-new' | 'route-new'; points: Pt[] }
  | { type: 'activity'; id: number; mode: 'view' | 'edit' }
  | { type: 'activity-new'; draft: ActivityDraft }
  | { type: 'scale'; measured: number | null }
  | { type: 'plan' };
type Placing = { mode: 'new'; draft: ActivityDraft; label: string | null } | { mode: 'move'; id: number; label: string };

const TOOLS: [Tool, string, string, string][] = [
  ['select', 'Sélection', 'ph-cursor', 'Sélectionner, déplacer la carte et les repères'],
  ['zone', 'Zone', 'ph-polygon', 'Dessiner une zone : clic par sommet, double-clic ou Entrée pour terminer'],
  ['route', 'Voie', 'ph-path', 'Tracer une voie de circulation : clic par point, double-clic ou Entrée pour terminer'],
  ['activity', 'Activité', 'ph-map-pin-plus', 'Placer une nouvelle activité sur la carte'],
];
const LAYERS: [keyof Layers, string, string][] = [
  ['zones', 'Zones', 'ph-polygon'],
  ['routes', 'Voies', 'ph-path'],
  ['activities', 'Activités', 'ph-map-pin'],
  ['conflicts', 'Conflits', 'ph-warning'],
];

const lcfirst = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const weekday = (iso: string) => (isRealDate(iso) ? new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`)) : '');

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
      keystoneProject: c.keystoneProject, startOn: c.startOn, endOn: c.endOn, hours: c.hours, preventionPlanId: c.preventionPlanId,
      permitId: c.permitId, zoneId: zone?.id ?? null, notes: c.location ? `Lieu indiqué : ${c.location}.` : null, source: c.id,
    },
  };
}

type Props = {
  data: SitemapData;
  canManage: boolean;
  /** Date demandée (?date=) ou date du jour. */
  initialDate: string;
  actionOptions: Pick<FormOptions, 'people' | 'origins' | 'sites' | 'allSites'>;
};

export function SiteMapScreen({ data, canManage, initialDate, actionOptions }: Props) {
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
  const [, startSaving] = useTransition();
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
  const conflicts = detectConflicts(input, date);
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
  const chooseTool = (t: Tool) => {
    setTool(t);
    setPlacing(t === 'activity' ? { mode: 'new', draft: {}, label: null } : null);
    if (t !== 'select') setSelection(null);
  };
  const openTarget = (t: Target | null) => {
    setSelection(t);
    if (!t) return;
    setDialog(t.kind === 'activity' ? { type: 'activity', id: t.id, mode: 'view' } : { type: t.kind, id: t.id });
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
      const r = await moveActivity(id, at);
      setMoves((m) => { const { [id]: _drop, ...rest } = m; void _drop; return rest; });
      setSaveError(r.error ?? null);
    });
  };
  const persistShape = (kind: 'zone' | 'route', id: number, points: Pt[]) => {
    const key = `${kind}:${id}`;
    setShapes((s) => ({ ...s, [key]: points }));
    startSaving(async () => {
      const r = await saveShape(kind, id, points);
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

  // ─── Coactivité : action et report dans le plan de prévention ─────────

  const actionDefaults = (c: Conflict): ActionDefaults => {
    const a = byId.get(c.a), b = byId.get(c.b);
    const tomorrow = addDays(now, 1);
    return {
      title: truncate(`Maîtriser la coactivité du ${fmtDayMonth(c.date)} · ${c.title}${c.place ? ` (${c.place})` : ''}`, 200),
      description: `${c.description}\nMesures recommandées : ${c.measures.map(lcfirst).join(' ; ')}.`,
      origin: 'prevention',
      originRef: c.planIds[0] ?? `Coactivité ${fmtDate(c.date)}`,
      lockOrigin: true,
      siteId: site.id,
      pilotId: a?.ownerId ?? b?.ownerId ?? undefined,
      dueOn: c.date > tomorrow ? addDays(c.date, -1) : tomorrow,
      kind: 'P',
    };
  };

  // ─── Fenêtres ─────────────────────────────────────────────────────────

  let dialogTitle: ReactNode = '';
  let dialogKicker: ReactNode = 'Carte du site';
  let dialogWidth = 560;
  let dialogBody: ReactNode = null;
  if (dialog?.type === 'zone' || dialog?.type === 'zone-new') {
    const zone = dialog.type === 'zone' ? zones.find((z) => z.id === dialog.id) : undefined;
    dialogTitle = zone ? zone.name : 'Nouvelle zone';
    dialogKicker = zone ? `Zone · ${ZONE_KINDS[zone.kind].label}` : 'Carte du site · zone';
    const done = (id?: number) => { setDialog(null); setTool('select'); setSelection(id ? { kind: 'zone', id } : null); };
    dialogBody = canManage
      ? <ZoneForm siteId={site.id} zone={zone} points={dialog.type === 'zone-new' ? dialog.points : undefined} activityCount={zone ? countIn(zone.id) : 0} onDone={done} onCancel={closeDialog} />
      : zone && <ZoneSheet zone={zone} activityCount={countIn(zone.id)} />;
  } else if (dialog?.type === 'route' || dialog?.type === 'route-new') {
    const route = dialog.type === 'route' ? routes.find((r) => r.id === dialog.id) : undefined;
    dialogTitle = route ? route.name : 'Nouvelle voie de circulation';
    dialogKicker = route ? `Voie · ${ROUTE_KINDS[route.kind].label}${route.shared ? ' · voie commune' : ''}` : 'Carte du site · voie de circulation';
    const done = (id?: number) => { setDialog(null); setTool('select'); setSelection(id ? { kind: 'route', id } : null); };
    dialogBody = canManage
      ? <RouteForm siteId={site.id} route={route} points={dialog.type === 'route-new' ? dialog.points : undefined} activityCount={route ? countOn(route.id) : 0} onDone={done} onCancel={closeDialog} />
      : route && <RouteSheet route={route} activityCount={countOn(route.id)} />;
  } else if (dialog?.type === 'activity') {
    const activity = byId.get(dialog.id);
    dialogWidth = 720;
    if (activity) {
      dialogTitle = dialog.mode === 'edit' ? "Modifier l'activité" : activity.title;
      dialogKicker = activity.team === 'externe' ? `Entreprise extérieure · ${activity.contractor ?? ''}` : 'Équipe interne';
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
    dialogTitle = 'Nouvelle activité';
    dialogKicker = placing?.mode === 'new' && placing.label ? `Positionner ${placing.label}` : 'Carte du site · coactivité';
    dialogBody = <ActivityForm siteId={site.id} rule={rule} draft={dialog.draft} zones={zones} routes={routes} choices={choices}
      onDone={afterActivitySaved} onCancel={closeDialog} />;
  } else if (dialog?.type === 'scale') {
    dialogTitle = "Échelle et seuil de proximité";
    dialogKicker = dialog.measured != null ? 'Étalonnage sur deux points' : 'Carte du site';
    dialogBody = <ScaleForm map={map} measured={dialog.measured} onDone={() => setDialog(null)} onCancel={() => setDialog(null)}
      onMeasure={() => { setDialog(null); setSelection(null); setPlacing(null); setTool('measure'); }} />;
  } else if (dialog?.type === 'plan') {
    dialogTitle = 'Remplacer le plan du site';
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
            <strong>{tool === 'zone' ? 'Nouvelle zone' : 'Nouvelle voie'}</strong> : un clic par {tool === 'zone' ? 'sommet' : 'point'} ; double-clic ou Entrée pour terminer, Retour arrière pour retirer le dernier point, Échap pour abandonner.
            {!draw.ready && <span style={{ color: 'var(--color-neutral-500)' }}> {draw.points} / {min} points au minimum.</span>}
          </span>
          <button type="button" className="btn btn-primary vg-btn-sm" disabled={!draw.ready} onClick={() => mapRef.current?.finishDrawing()}
            title={draw.ready ? undefined : `Placez au moins ${min} points`}>Terminer</button>
          <button type="button" className="btn btn-ghost vg-btn-sm" onClick={cancelTool}>Annuler</button>
        </>
      );
    };
  } else if (tool === 'measure') {
    banner = (
      <>
        <span className={styles.bannerText}><strong>Étalonnage</strong> : cliquez deux points dont vous connaissez la distance réelle (Échap pour abandonner).</span>
        <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => { cancelTool(); setDialog({ type: 'scale', measured: null }); }}>Annuler</button>
      </>
    );
  } else if (tool === 'activity') {
    banner = (
      <>
        <span className={styles.bannerText}>
          {placing?.mode === 'move'
            ? <><strong>Déplacer</strong> « {truncate(placing.label, 60)} » : cliquez sur la nouvelle position.</>
            : placing?.label
              ? <><strong>Positionner {placing.label}</strong> : cliquez sur la carte à l&apos;emplacement de l&apos;intervention.</>
              : <><strong>Nouvelle activité</strong> : cliquez sur la carte à son emplacement.</>}
        </span>
        {placing?.mode !== 'move' && (
          <button type="button" className="btn btn-secondary vg-btn-sm" title="Saisir l'activité sans point sur la carte (la zone sert de position approximative)"
            onClick={() => setDialog({ type: 'activity-new', draft: draftWithDates(placing?.draft ?? {}) })}>Sans position</button>
        )}
        <button type="button" className="btn btn-ghost vg-btn-sm" onClick={cancelTool}>Annuler</button>
      </>
    );
  }

  const dangers = conflicts.filter((c) => c.tone === 'danger').length;
  const unplaced = dayActivities.filter((a) => !activityPosition(a, zones).pos).length;

  return (
    <>
      {focus.notice && <Notice tone="warn">{focus.notice}</Notice>}
      {!canManage && focus.candidate && (
        <Notice tone="neutral" icon="ph-map-pin-line">{focus.candidate.label} n&apos;est pas encore positionné sur la carte du site.</Notice>
      )}

      <div className={styles.layout}>
        <div className={`card ${styles.mapCard}`}>
          <div className={styles.toolbar}>
            {canManage ? (
              <div className="seg" role="radiogroup" aria-label="Outils de la carte">
                {TOOLS.map(([key, label, icon, hint], i) => (
                  <button key={key} type="button" role="radio" aria-checked={tool === key} aria-label={`${label} : ${hint}`} title={hint}
                    className={`seg-opt${tool === key ? ' is-on' : ''}`} onClick={() => chooseTool(key)}
                    style={{ fontSize: 12, padding: '5px 10px', border: 'none', borderLeft: i ? '1px solid var(--color-divider)' : 'none', background: 'transparent', color: tool === key ? undefined : 'inherit', font: 'inherit', cursor: 'pointer' }}>
                    <i className={`ph ${icon}`} style={{ fontSize: 14 }} aria-hidden />{label}
                  </button>
                ))}
              </div>
            ) : (
              <span style={{ ...muted, fontSize: 12 }}><Icon name="ph-eye" size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Consultation : la carte est tenue à jour par l&apos;encadrement.</span>
            )}
            {canManage && (
              <span className={styles.toolbarEnd}>
                <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setDialog({ type: 'scale', measured: null })}><Icon name="ph-ruler" size={13} />Étalonner l&apos;échelle</button>
                <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setDialog({ type: 'plan' })}><Icon name="ph-image" size={13} />Remplacer le plan</button>
                <button type="button" className="btn btn-primary vg-btn-sm" onClick={newActivity}><Icon name="ph-plus" size={13} />Nouvelle activité</button>
              </span>
            )}
          </div>
          {saveError && <div style={{ padding: '8px 10px 0' }}><ErrorLine error={saveError} /></div>}
          <MapCanvas ref={mapRef} map={map} zones={zones} routes={routes} activities={mapActivities} conflicts={conflicts} layers={layers} dimPlan={dimPlan}
            tool={tool} editable={canManage} selection={selection} activeConflict={activeConflict} initialFocus={initialFocus}
            label={`Carte du ${lcfirst(site.label)} au ${fmtDate(date)} : ${plural(dayActivities.length, 'activité', 'activités')}, ${plural(conflicts.length, 'situation de coactivité', 'situations de coactivité')}`}
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
                    {canManage ? 'Aucune zone ni voie sur ce plan : dessinez-les avec les outils « Zone » et « Voie ».' : 'Aucune zone ni voie dessinée sur ce plan.'}
                  </div>
                )}
              </>
            )} />
        </div>

        <div className={styles.panel}>
          {/* Date et calques */}
          <div className={`card ${styles.panelCard}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button type="button" className="btn btn-secondary vg-btn-sm" style={{ padding: '5px 7px' }} aria-label="Jour précédent" onClick={() => setDate(addDays(date, -1))}>
                <Icon name="ph-caret-left" size={14} />
              </button>
              <input type="date" className="input" value={date} aria-label="Date affichée" onChange={(e) => setDate(e.target.value)}
                style={{ flex: 1, minWidth: 0, minHeight: 30, padding: '3px 8px', fontSize: 12.5, colorScheme: 'dark' }} />
              <button type="button" className="btn btn-secondary vg-btn-sm" style={{ padding: '5px 7px' }} aria-label="Jour suivant" onClick={() => setDate(addDays(date, 1))}>
                <Icon name="ph-caret-right" size={14} />
              </button>
              <button type="button" className="btn btn-ghost vg-btn-sm" disabled={date === now} onClick={() => setDate(now)}>Aujourd&apos;hui</button>
            </div>
            <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
              {weekday(date)} {fmtLong(date)}{date === now ? " · aujourd'hui" : ''}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }} role="group" aria-label="Calques">
              {map.url && (
                <button type="button" className={`vg-chip${layers.plan ? ' is-on' : ''}`} aria-pressed={layers.plan} onClick={() => setLayers((l) => ({ ...l, plan: !l.plan }))}>
                  <Icon name="ph-map-trifold" size={12} />Plan
                </button>
              )}
              {LAYERS.map(([key, label, icon]) => (
                <button key={key} type="button" className={`vg-chip${layers[key] ? ' is-on' : ''}`} aria-pressed={layers[key]} onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}>
                  <Icon name={icon} size={12} />{label}
                </button>
              ))}
              {map.custom && (
                <button type="button" className={`vg-chip${dimPlan ? ' is-on' : ''}`} aria-pressed={dimPlan} title="Inverse les couleurs d'un plan à fond clair" onClick={() => setDimPlan((d) => !d)}>
                  <Icon name="ph-circle-half" size={12} />Assombrir
                </button>
              )}
            </div>
            <div className={styles.legend}>
              <span className={styles.legendItem}><TeamMark team="interne" />Équipe interne</span>
              <span className={styles.legendItem}><TeamMark team="externe" />Entreprise extérieure</span>
              <span className={styles.legendItem}><svg width="22" height="8" aria-hidden><line x1="1" y1="4" x2="21" y2="4" style={{ stroke: 'var(--color-accent)', strokeOpacity: 0.4, strokeWidth: 7, strokeLinecap: 'round' }} /><line x1="1" y1="4" x2="21" y2="4" style={{ stroke: ROUTE_KINDS.vehicules.color, strokeWidth: 3 }} /></svg>Voie commune</span>
              {(['mixte', 'engins', 'pietons'] as const).map((k) => (
                <span key={k} className={styles.legendItem}>
                  <svg width="22" height="8" aria-hidden><line x1="1" y1="4" x2="21" y2="4" style={{ stroke: ROUTE_KINDS[k].color, strokeWidth: 3, strokeDasharray: ROUTE_KINDS[k].dash?.map((n) => n / 2).join(' ') }} /></svg>
                  {k === 'mixte' ? 'Mixte' : k === 'engins' ? 'Engins' : 'Piétons'}
                </span>
              ))}
              <span className={styles.legendItem}><svg width="12" height="12" viewBox="-7 -7 14 14" aria-hidden><circle r="5.5" style={{ fill: 'none', stroke: 'var(--color-neutral-300)', strokeWidth: 1.2, strokeDasharray: '2.2 1.8' }} /></svg>Véhicules / engins</span>
            </div>
          </div>

          {/* Situations de coactivité */}
          <div className={`card ${styles.panelCard}`}>
            <PanelTitle icon="ph-warning" count={conflicts.length}
              aside={conflicts.length > 0 && (
                <ToneTag tone={dangers ? 'danger' : 'warn'}>{!dangers ? 'Vigilance' : dangers === conflicts.length ? 'Danger' : `dont ${plural(dangers, 'danger', 'dangers')}`}</ToneTag>
              )}>
              Coactivité
            </PanelTitle>
            {conflicts.length === 0 && (
              <span style={muted}>
                {dayActivities.length ? `Aucune situation de coactivité détectée le ${fmtDate(date)}.` : `Aucune activité localisée le ${fmtDate(date)}.`}
                {!map.metersPerUnit && ' Plan non étalonné : la proximité est évaluée sur les zones contiguës.'}
              </span>
            )}
            <div style={{ display: 'grid', gap: 6 }}>
              {conflicts.map((c) => {
                const on = c.key === activeConflict;
                const details = c.reasons.filter((r) => r.detail && r.detail !== r.subject);
                return (
                  <div key={c.key} className={`${styles.conflict}${on ? ` ${styles.isOn}` : ''}`}>
                    <button type="button" className={styles.conflictHead} aria-pressed={on}
                      aria-label={`${c.title}${c.place ? `, ${c.place}` : ''} : centrer la carte`} onClick={() => focusConflict(c)}>
                      <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                        <ToneTag tone={c.tone}>{c.tone === 'danger' ? 'Danger' : 'Vigilance'}</ToneTag>
                        <span className="tag tag-neutral">{c.pairLabel}</span>
                      </span>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, textWrap: 'pretty' }}>
                        {c.title}{c.place && <span style={{ fontWeight: 400, color: 'var(--color-neutral-400)' }}> · {c.place}</span>}
                      </span>
                      <span style={{ display: 'grid', gap: 3 }}>
                        {[c.a, c.b].map((id) => {
                          const a = byId.get(id);
                          if (!a) return null;
                          return (
                            <span key={id} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 12 }}>
                              <TeamMark team={a.team} size={9} />
                              <span style={{ minWidth: 0 }}>{a.title}<span style={muted}> — {a.team === 'externe' ? a.contractor : 'équipe interne'}{a.preventionPlanId ? ` · ${a.preventionPlanId}` : ''}</span></span>
                            </span>
                          );
                        })}
                      </span>
                      {details.length > 0 && (
                        <span style={{ display: 'grid', gap: 2 }}>
                          {details.map((r) => (
                            <span key={`${r.code}-${r.zoneId ?? ''}-${r.routeId ?? ''}`} style={{ fontSize: 11.5, color: TONE[r.tone].fg }}>{r.label} : {r.detail}</span>
                          ))}
                        </span>
                      )}
                    </button>
                    <details>
                      <summary className={styles.summary}><i className="ph ph-caret-right" aria-hidden />Mesures recommandées ({c.measures.length})</summary>
                      <ul className={styles.measures} style={{ marginTop: 4 }}>{c.measures.map((m) => <li key={m}>{m}</li>)}</ul>
                    </details>
                    {canManage && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <NewActionButton options={actionOptions} defaults={actionDefaults(c)} label="Créer l'action" icon="ph-list-plus" className="btn btn-secondary vg-btn-sm" />
                        {c.planIds.map((planId) => (
                          <AddToPlan key={planId} siteId={site.id} conflict={c} planId={planId} single={c.planIds.length === 1}
                            linked={[byId.get(c.a), byId.get(c.b)].find((x) => x?.preventionPlanId === planId)} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Activités du jour */}
          <div className={`card ${styles.panelCard}`}>
            <PanelTitle icon="ph-map-pin" count={dayActivities.length}
              aside={unplaced > 0 && <span style={{ fontSize: 11, color: 'var(--tone-warn-fg)' }}>{plural(unplaced, 'sans position', 'sans position')}</span>}>
              Activités du jour
            </PanelTitle>
            {dayActivities.length === 0 && (
              <span style={muted}>Aucune activité le {fmtDate(date)}.{canManage ? ' Ajoutez-en avec « Nouvelle activité » ou depuis « À positionner ».' : ''}</span>
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
                    <button type="button" className={`vg-row ${styles.rowBtn}${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={`${a.title} : centrer la carte`}
                      onClick={() => focusActivity(a)}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                        <TeamMark team={a.team} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.title}>{a.title}</span>
                        {tone && <span className="vg-dot" style={{ width: 7, height: 7, background: TONE[tone].dot }} title="Situation de coactivité ce jour" />}
                      </span>
                      <span style={{ ...muted, paddingLeft: 17 }}>
                        {a.team === 'externe' ? a.contractor : 'Équipe interne'}
                        {a.zoneId != null && zoneName.get(a.zoneId) ? ` · ${zoneName.get(a.zoneId)}` : ''}
                        {a.hours ? ` · ${a.hours}` : ''}
                      </span>
                      {(noPlan || gap || !placed.pos || placed.approx) && (
                        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingLeft: 17 }}>
                          {noPlan && <ToneTag tone={site.ppFromFirstMinute ? 'danger' : 'warn'} style={{ fontSize: 10.5, padding: '1px 7px' }}>Sans plan de prévention</ToneTag>}
                          {gap && (
                            <span title={gap === 'Plan clos ou annulé' ? `${a.preventionPlanId} est clos ou annulé` : `${a.preventionPlanId} · ${a.planStatusLabel ?? ''} : signatures EU et EE exigées avant toute intervention`}>
                              <ToneTag tone="danger" style={{ fontSize: 10.5, padding: '1px 7px' }}>{gap} · {a.preventionPlanId}</ToneTag>
                            </span>
                          )}
                          {!placed.pos && <ToneTag tone="warn" style={{ fontSize: 10.5, padding: '1px 7px' }}>Sans position</ToneTag>}
                          {placed.approx && <span className="tag tag-neutral" style={{ fontSize: 10.5, padding: '1px 7px' }}>Position approximative</span>}
                        </span>
                      )}
                    </button>
                    <button type="button" className={styles.iconBtn} aria-label={`Ouvrir la fiche « ${a.title} »`} title="Ouvrir la fiche"
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
            <PanelTitle icon="ph-map-pin-plus" count={toPosition.length}>À positionner</PanelTitle>
            <span style={{ ...muted, marginTop: -4 }}>Plans de prévention et permis en cours ou débutant sous 15 jours, sans activité sur la carte (un permis rattaché à un plan déjà positionné suit l&apos;activité du plan).</span>
            {toPosition.length === 0 && <span style={muted}>Toutes les interventions des 15 prochains jours sont positionnées.</span>}
            <div style={{ display: 'grid', gap: 8 }}>
              {toPosition.map((c) => (
                <div key={`${c.kind}-${c.id}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                    <Link href={c.kind === 'plan' ? `/prevention?plan=${c.id}` : `/prevention?onglet=permis&permis=${c.id}`} className="vg-link" style={{ fontSize: 12.5, color: 'var(--color-text)' }}>
                      {c.label}
                    </Link>
                    <span style={{ fontSize: 12, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{truncate(c.title, 110)}</span>
                    <span style={muted}>{periodLabel(c.startOn, c.endOn)}{c.hours ? ` · ${c.hours}` : ''} · {c.location}</span>
                  </div>
                  {canManage && (
                    <button type="button" className="btn btn-secondary vg-btn-sm" style={{ flex: 'none' }} onClick={() => position(c)}>
                      <Icon name="ph-map-pin-plus" size={13} />Positionner
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Zones et voies */}
          <details className={`card ${styles.panelCard}`}>
            <summary className={styles.summary} style={{ fontSize: 12.5, color: 'var(--color-neutral-300)' }}>
              <i className="ph ph-caret-right" aria-hidden />Zones et voies du plan
              <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{zones.length} · {routes.length}</span>
            </summary>
            {zones.length === 0 && routes.length === 0 && <span style={muted}>Aucune zone ni voie.</span>}
            <div className={styles.list}>
              {zones.map((z) => (
                <button key={`z${z.id}`} type="button" className={`vg-row ${styles.rowBtn}${selection?.kind === 'zone' && selection.id === z.id ? ' is-on' : ''}`}
                  onClick={() => { openTarget({ kind: 'zone', id: z.id }); mapRef.current?.centerOn(centroid(z.polygon), 1.6); }}>
                  <span style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, flex: 'none', background: `color-mix(in srgb, ${ZONE_KINDS[z.kind].color} 35%, transparent)`, border: `1px solid ${ZONE_KINDS[z.kind].color}` }} />
                    {z.name}<span style={muted}>· {ZONE_KINDS[z.kind].label}</span>
                  </span>
                </button>
              ))}
              {routes.map((r) => (
                <button key={`r${r.id}`} type="button" className={`vg-row ${styles.rowBtn}${selection?.kind === 'route' && selection.id === r.id ? ' is-on' : ''}`}
                  onClick={() => { openTarget({ kind: 'route', id: r.id }); mapRef.current?.centerOn(r.polyline[Math.floor(r.polyline.length / 2)], 1.6); }}>
                  <span style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 }}>
                    <Icon name={ROUTE_KINDS[r.kind].icon} size={13} style={{ color: ROUTE_KINDS[r.kind].color }} />
                    {r.name}<span style={muted}>· {r.shared ? 'voie commune' : 'voie réservée'}</span>
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

/** « Ajouter au plan de prévention » : ligne datée dans les risques d'interférence du plan lié. */
function AddToPlan({ siteId, conflict, planId, single, linked }: { siteId: string; conflict: Conflict; planId: string; single: boolean; linked?: ActivityView }) {
  const { pending, error, run } = useRun();
  if (linked?.planClosed) return <span style={muted}>{planId} clos ou annulé</span>;
  if (linked?.planInterference?.includes(interferenceLine(conflict))) {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--tone-ok-fg)' }}><Icon name="ph-check" size={12} />Reporté dans {planId}</span>;
  }
  return (
    <>
      <ConfirmButton label={single ? 'Ajouter au plan de prévention' : `Ajouter au ${planId}`} confirmLabel="Ajouter" icon="ph-clipboard-text" pending={pending}
        question={linked?.planHasSignature
          ? `Ajouter cette coactivité aux risques d'interférence de ${planId} ? Les signatures recueillies sont annulées : le plan modifié est à signer à nouveau par les deux entreprises.`
          : `Ajouter cette coactivité aux risques d'interférence de ${planId} ?`}
        tooltip={`Ajoute une ligne datée aux risques d'interférence du plan ${planId}. Modification essentielle du plan : signatures annulées, plan à revoir et à signer à nouveau avec l'entreprise extérieure.`}
        onConfirm={() => run(() => addConflictToPlan(siteId, conflict.date, conflict.key, planId))} />
      <ErrorLine error={error} />
    </>
  );
}
