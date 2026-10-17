'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { ActionForm, Checkbox, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { firstMinuteReason, ruleBasis, type SiteRule } from '@/components/prevention/model';
import { ConfirmButton, ErrorLine, Facts, Notice, SectionTitle, muted, useRun } from '@/components/prevention/parts';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { ReasonForm } from '@/components/ReasonDialog';
import { Icon, ToneTag } from '@/components/ui';
import { fmtDate, fmtDayMonth } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import {
  cancelActivity, deleteRoute, deleteZone, replaceSitePlan, resetSitePlan, saveActivity, saveMapSettings, saveRoute, saveZone,
} from '@/server/sitemap';
import { activeOn, containingZone, lacksSignedPlan, type Conflict, type Pt } from './coactivity';
import {
  DEFAULT_PLANS, ROUTE_KINDS, ROUTE_KIND_KEYS, TEAMS, ZONE_KINDS, ZONE_KIND_KEYS,
  type ActivityDraft, type ActivityView, type MapConfig, type RouteView, type SitemapChoices, type Team, type ZoneView,
} from './model';
import styles from './sitemap.module.css';

// Fenêtres de la carte du site : zones, voies, activités, échelle et plan de fond.

export const periodLabel = (start: string, end: string) =>
  start === end ? `Le ${fmtDate(start)}` : start.slice(0, 4) === end.slice(0, 4) ? `${fmtDayMonth(start)} → ${fmtDate(end)}` : `${fmtDate(start)} → ${fmtDate(end)}`;

function DeleteRow({ label, question, onConfirm, pending, error }: { label: string; question: string; onConfirm: () => void; pending: boolean; error: string | null }) {
  return (
    <div style={{ display: 'grid', gap: 6, paddingTop: 10, background: 'var(--rule-soft) no-repeat top / 100% 1px' }}>
      <ErrorLine error={error} />
      <div><ConfirmButton label={label} confirmLabel="Supprimer" icon="ph-trash" question={question} pending={pending} onConfirm={onConfirm} /></div>
    </div>
  );
}

// ─── Zones ──────────────────────────────────────────────────────────────────

export function ZoneForm({ siteId, zone, points, activityCount, onDone, onCancel }: {
  siteId: string; zone?: ZoneView; points?: Pt[]; activityCount: number; onDone: (id?: number) => void; onCancel: () => void;
}) {
  const { pending, error, run } = useRun();
  return (
    <>
      <ActionForm action={saveZone} onDone={(s) => onDone(Number(s.id) || undefined)} onCancel={onCancel} submitLabel={zone ? 'Enregistrer' : 'Créer la zone'}
        hidden={{ id: zone?.id, siteId, polygon: points ? JSON.stringify(points) : undefined }}>
        <FormRow>
          <Field name="name" label="Nom">
            <Input name="name" defaultValue={zone?.name} placeholder="Ex. Atelier montage" autoFocus />
          </Field>
          <Field name="kind" label="Type">
            <Select name="kind" options={ZONE_KIND_KEYS.map((k) => [k, ZONE_KINDS[k].label] as const)} defaultValue={zone?.kind ?? 'atelier'} />
          </Field>
        </FormRow>
        <Field name="notes" label="Notes" hint="Facultatif : équipements, consignes d'accès, zonage ATEX…">
          <TextArea name="notes" rows={2} defaultValue={zone?.notes ?? ''} />
        </Field>
        {!zone && <span style={muted}>Contour de {points?.length ?? 0} sommets ; vous pourrez déplacer les sommets après l&apos;enregistrement (sélectionnez la zone, puis faites glisser les poignées).</span>}
      </ActionForm>
      {zone && (
        <DeleteRow label="Supprimer la zone" pending={pending} error={error}
          question={activityCount > 1
            ? `Supprimer la zone ? ${activityCount} activités y sont rattachées et gardent leur position.`
            : activityCount === 1 ? 'Supprimer la zone ? 1 activité y est rattachée et garde sa position.' : 'Supprimer définitivement cette zone ?'}
          onConfirm={() => run(() => deleteZone(zone.id), () => onDone())} />
      )}
    </>
  );
}

export function ZoneSheet({ zone, activityCount }: { zone: ZoneView; activityCount: number }) {
  return (
    <Facts items={[
      ['Type', ZONE_KINDS[zone.kind].label],
      ['Activités rattachées', String(activityCount)],
      zone.notes ? ['Notes', zone.notes] : null,
    ]} />
  );
}

// ─── Voies ──────────────────────────────────────────────────────────────────

export function RouteForm({ siteId, route, points, activityCount, onDone, onCancel }: {
  siteId: string; route?: RouteView; points?: Pt[]; activityCount: number; onDone: (id?: number) => void; onCancel: () => void;
}) {
  const { pending, error, run } = useRun();
  return (
    <>
      <ActionForm action={saveRoute} onDone={(s) => onDone(Number(s.id) || undefined)} onCancel={onCancel} submitLabel={route ? 'Enregistrer' : 'Créer la voie'}
        hidden={{ id: route?.id, siteId, polyline: points ? JSON.stringify(points) : undefined }}>
        <FormRow>
          <Field name="name" label="Nom">
            <Input name="name" defaultValue={route?.name} placeholder="Ex. Voie de livraison poids lourds" autoFocus />
          </Field>
          <Field name="kind" label="Type">
            <Select name="kind" options={ROUTE_KIND_KEYS.map((k) => [k, ROUTE_KINDS[k].label] as const)} defaultValue={route?.kind ?? 'vehicules'} />
          </Field>
        </FormRow>
        <div style={{ display: 'grid', gap: 4 }}>
          <Checkbox name="shared" label="Voie commune à plusieurs équipes" defaultChecked={route?.shared ?? true} />
          <span className="vg-field-hint" style={{ paddingLeft: 24, marginTop: 0 }}>Deux équipes qui empruntent une voie commune le même jour sont signalées en coactivité.</span>
        </div>
        <Field name="notes" label="Notes" hint="Facultatif : sens de circulation, vitesse, horaires de livraison…">
          <TextArea name="notes" rows={2} defaultValue={route?.notes ?? ''} />
        </Field>
      </ActionForm>
      {route && (
        <DeleteRow label="Supprimer la voie" pending={pending} error={error}
          question={activityCount ? `Supprimer la voie ? Elle sera retirée de ${activityCount} activité${activityCount > 1 ? 's' : ''}.` : 'Supprimer définitivement cette voie ?'}
          onConfirm={() => run(() => deleteRoute(route.id), () => onDone())} />
      )}
    </>
  );
}

export function RouteSheet({ route, activityCount }: { route: RouteView; activityCount: number }) {
  return (
    <Facts items={[
      ['Type', ROUTE_KINDS[route.kind].label],
      ['Usage', route.shared ? 'Voie commune' : 'Voie réservée'],
      ['Activités qui l\'empruntent', String(activityCount)],
      route.notes ? ['Notes', route.notes] : null,
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
  const zoneHint = detected && zoneId === detected.id && (!activity || activity.zoneId == null) ? `Déduite de la position : ${detected.name}.`
    : point && !detected ? `Position hors des zones dessinées${guessed ? ` (lieu indiqué : ${guessed.name})` : ''}.` : undefined;
  const projects = src.keystoneProject && !choices.projects.some(([v]) => v === src.keystoneProject)
    ? [[src.keystoneProject, src.keystoneProject] as const, ...choices.projects] : choices.projects;
  const routeIds = new Set(src.routeIds ?? []);

  const pickPlan = (id: string) => {
    setPlanId(id);
    const c = id ? choices.planContractor[id] : undefined;
    if (c) { setTeam('externe'); setContractorId(c); }
  };

  return (
    <ActionForm action={saveActivity} onDone={(s) => onDone(Number(s.id), startOn, endOn)} onCancel={onCancel}
      submitLabel={activity ? 'Enregistrer' : "Créer l'activité"}
      hidden={{ id: activity?.id, siteId, geometry: geometry ? JSON.stringify(geometry) : '' }}>
      <Field name="title" label="Activité">
        <Input name="title" defaultValue={src.title} placeholder="Ex. Maintenance du pont roulant 10 t" autoFocus={!src.title} />
      </Field>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="seg" role="radiogroup" aria-label="Équipe">
          {(['interne', 'externe'] as const).map((k) => (
            <label key={k} className="seg-opt" style={{ fontSize: 12.5, padding: '5px 10px' }}>
              <input type="radio" name="team" value={k} checked={team === k} onChange={() => setTeam(k)} />
              <i className={`ph ${TEAMS[k].icon}`} style={{ fontSize: 14 }} aria-hidden />{TEAMS[k].label}
            </label>
          ))}
        </div>
        {team === 'externe' && rule.ppFromFirstMinute && !planId && (
          <span style={{ fontSize: 11.5, color: 'var(--tone-warn-fg)' }}>{firstMinuteReason(rule)}.</span>
        )}
      </div>
      <FormRow>
        {team === 'externe' ? (
          <Field name="contractorId" label="Entreprise extérieure">
            <Select name="contractorId" options={choices.contractors} value={contractorId} onChange={(e) => setContractorId(e.target.value)} placeholder="Choisir…" />
          </Field>
        ) : (
          <Field name="keystoneProject" label="Projet Keystone">
            <Select name="keystoneProject" options={projects} defaultValue={src.keystoneProject ?? ''} placeholder="Aucun projet" />
          </Field>
        )}
        <Field name="ownerId" label={team === 'externe' ? 'Responsable interne (donneur d\'ordre)' : 'Responsable'}>
          <Select name="ownerId" options={choices.people} defaultValue={src.ownerId ?? ''} placeholder="Choisir…" />
        </Field>
      </FormRow>
      {team === 'externe' && (
        <FormRow>
          <Field name="preventionPlanId" label="Plan de prévention">
            <Select name="preventionPlanId" options={choices.plans} value={planId} onChange={(e) => pickPlan(e.target.value)} placeholder="Aucun plan" />
          </Field>
          <Field name="keystoneProject" label="Projet Keystone">
            <Select name="keystoneProject" options={projects} defaultValue={src.keystoneProject ?? ''} placeholder="Aucun projet" />
          </Field>
        </FormRow>
      )}
      <FormRow cols={3}>
        <Field name="startOn" label="Du">
          <Input name="startOn" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
        </Field>
        <Field name="endOn" label="Au">
          <Input name="endOn" type="date" value={endOn} min={startOn || undefined} onChange={(e) => setEndOn(e.target.value)} />
        </Field>
        <Field name="hours" label="Plage horaire" hint="Deux plages disjointes lèvent la coactivité.">
          <Input name="hours" defaultValue={src.hours ?? ''} placeholder="Ex. 7 h 30 – 12 h" />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="zoneId" label="Zone" hint={zoneHint}>
          <Select name="zoneId" options={zones.map((z) => [String(z.id), z.name] as const)} defaultValue={zoneId ? String(zoneId) : ''} placeholder="Aucune zone" />
        </Field>
        <Field name="permitId" label="Permis (feu, essai)">
          <Select name="permitId" options={choices.permits} defaultValue={src.permitId ?? ''} placeholder="Aucun permis" />
        </Field>
      </FormRow>
      <div className="vg-inset" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 12 }}>
        <Icon name={geometry ? 'ph-map-pin' : 'ph-map-pin-line'} size={15} style={{ color: geometry ? 'var(--color-accent)' : 'var(--color-neutral-500)' }} />
        <span style={{ color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
          {geometry
            ? `Position placée sur la carte${detected ? `, dans « ${detected.name} »` : ''}. ${activity ? 'Utilisez « Déplacer sur la carte » depuis la fiche pour la modifier.' : 'Vous pourrez la déplacer après l\'enregistrement en faisant glisser le repère sélectionné.'}`
            : 'Sans position : la zone sert de position approximative ; placez l\'activité depuis sa fiche.'}
        </span>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle>Accès</SectionTitle>
        <Checkbox name="vehicles" label="Véhicules ou engins en circulation (camion, chariot élévateur, nacelle…)" defaultChecked={src.vehicles ?? false} />
        {routes.length === 0 && <span style={muted}>Aucune voie tracée sur ce site : dessinez les voies de circulation avec l&apos;outil « Voie ».</span>}
        {routes.length > 0 && (
          <div style={{ display: 'grid', gap: 5 }} role="group" aria-label="Voies empruntées">
            <span style={{ fontSize: 11.5, color: 'color-mix(in srgb, var(--color-text) 70%, transparent)' }}>Voies empruntées</span>
            {routes.map((r) => (
              <label key={r.id} className="vg-check">
                <input type="checkbox" name="routeIds" value={r.id} defaultChecked={routeIds.has(r.id)} />
                <span className="vg-check-box"><i className="ph ph-check" /></span>
                <span>{r.name} <span style={muted}>· {ROUTE_KINDS[r.kind].label.toLowerCase()}{r.shared ? ' · voie commune' : ''}</span></span>
              </label>
            ))}
          </div>
        )}
      </div>
      <Field name="notes" label="Notes" hint="Facultatif : moyens, balisage, consignes particulières.">
        <TextArea name="notes" rows={2} defaultValue={src.notes ?? ''} />
      </Field>
    </ActionForm>
  );
}

/**
 * Écart de l'activité d'une entreprise extérieure active à la date : plan obligatoire (règle du site ou R. 4512-7)
 * non signé par les deux entreprises, ou plan clos ou annulé ; null sinon.
 */
export function planGap(a: ActivityView, date: string): 'Plan non signé' | 'Plan clos ou annulé' | null {
  if (a.team !== 'externe' || !a.preventionPlanId || !activeOn(a, date)) return null;
  if (a.planClosed) return 'Plan clos ou annulé';
  return lacksSignedPlan(a) ? 'Plan non signé' : null;
}

/** Fiche d'une activité : faits, coactivité du jour, liens vers le plan de prévention et le permis. */
export function ActivitySheet({ activity, zones, routes, conflicts, others, date, canManage, rule, onEdit, onMove, onDeleted }: {
  activity: ActivityView; zones: ZoneView[]; routes: RouteView[]; conflicts: Conflict[]; others: Map<number, ActivityView>; date: string;
  canManage: boolean; rule: SiteRule; onEdit: () => void; onMove: () => void; onDeleted: () => void;
}) {
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
        <ToneTag tone={activity.team === 'externe' ? 'warn' : 'accent'}><Icon name={TEAMS[activity.team].icon} size={12} style={{ marginRight: 4 }} />{TEAMS[activity.team].label}</ToneTag>
        {noPlan && <ToneTag tone={rule.ppFromFirstMinute ? 'danger' : 'warn'}>Sans plan de prévention</ToneTag>}
        {gap && <ToneTag tone="danger">{gap}</ToneTag>}
        {!activity.geometry && <ToneTag tone="neutral">{zone ? 'Position approximative (zone)' : 'Sans position'}</ToneTag>}
        {activity.vehicles && <span className="tag tag-neutral">Véhicules / engins</span>}
      </div>
      {noPlan && rule.ppFromFirstMinute && (
        <Notice tone="danger">{firstMinuteReason(rule)} de l&apos;entreprise extérieure : rattachez le plan de prévention de cette intervention.</Notice>
      )}
      {gap && (
        <Notice tone="danger">
          {gap === 'Plan clos ou annulé'
            ? `Intervention en cours alors que le plan ${activity.preventionPlanId} est clos ou annulé : établissez un nouveau plan de prévention.`
            : `${rule.ppFromFirstMinute ? `${ruleBasis(rule)} : le` : 'Le'} plan ${activity.preventionPlanId} (${(activity.planStatusLabel ?? '').toLowerCase()}) doit être signé par les deux entreprises avant toute intervention${rule.ppFromFirstMinute ? '' : ' (R. 4512-7)'}.`}
        </Notice>
      )}
      <Facts items={[
        activity.team === 'externe' && ['Entreprise extérieure', activity.contractor ?? '—'],
        ['Responsable', activity.owner ?? '—'],
        ['Période', periodLabel(activity.startOn, activity.endOn)],
        ['Plage horaire', activity.hours ?? 'Non précisée'],
        ['Zone', zone?.name ?? '—'],
        ['Voies empruntées', used.length ? used.map((r) => r.name).join(', ') : 'Aucune'],
        ['Plan de prévention', activity.preventionPlanId
          ? <><Link href={`/prevention?plan=${activity.preventionPlanId}`} className="vg-link" style={{ fontSize: 12.5 }}>{activity.preventionPlanId}</Link>{activity.planStatusLabel && <span style={muted}> · {activity.planStatusLabel}</span>}</>
          : '—'],
        ['Permis', activity.permitId || activity.planPermits.length ? (
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '2px 10px' }}>
            {activity.permitId && <Link href={`/prevention?onglet=permis&permis=${activity.permitId}`} className="vg-link" style={{ fontSize: 12.5 }}>{activity.permitId}</Link>}
            {activity.planPermits.map((p) => (
              <span key={p.id}>
                <Link href={`/prevention?onglet=permis&permis=${p.id}`} className="vg-link" style={{ fontSize: 12.5 }}>{p.id}</Link>
                <span style={muted}> · {p.type === 'essai' ? "permis d'essai" : 'permis de feu'} du plan, {p.from === p.to ? `le ${fmtDayMonth(p.from)}` : `du ${fmtDayMonth(p.from)} au ${fmtDayMonth(p.to)}`}</span>
              </span>
            ))}
          </span>
        ) : '—'],
        ['Projet Keystone', activity.keystoneProject ?? '—'],
      ]} />
      {activity.notes && (
        <div style={{ display: 'grid', gap: 4 }}>
          <SectionTitle>Notes</SectionTitle>
          <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line' }}>{activity.notes}</span>
        </div>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle>Coactivité le {fmtDate(date)}</SectionTitle>
        {mine.length === 0 && <span style={muted}>{activity.startOn <= date && date <= activity.endOn ? 'Aucune situation de coactivité ce jour.' : 'Activité inactive à cette date.'}</span>}
        {mine.map((c) => {
          const other = others.get(c.a === activity.id ? c.b : c.a);
          return (
            <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5, flexWrap: 'wrap' }}>
              <span className="vg-dot" style={{ width: 7, height: 7, background: TONE[c.tone].dot, alignSelf: 'center' }} />
              <span>{c.title}</span>
              <span style={muted}>avec {other ? `« ${other.title} »` : 'une autre activité'}{c.place ? ` · ${c.place}` : ''}</span>
            </div>
          );
        })}
      </div>
      {/* Historique de l'activité (PRV-12), chargé à l'ouverture. */}
      <LazyChangeLog entity="site_activity" id={activity.id} />
      <ErrorLine error={error} />
      {canManage && cancelling && (
        <ReasonForm action={cancelActivity} hidden={{ id: activity.id }} submitLabel="Annuler l'activité" submitIcon="ph-prohibit"
          message="L'activité est retirée de la carte et de la coactivité ; elle reste tracée avec son motif."
          placeholder="Ex. intervention annulée, activité saisie en double" onCancel={() => setCancelling(false)} onDone={onDeleted} />
      )}
      {canManage && !cancelling && (
        <div className="dialog-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost vg-btn-sm" disabled={pending} onClick={() => setCancelling(true)}><Icon name="ph-prohibit" size={13} />Annuler l&apos;activité</button>
          <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onMove}><Icon name="ph-map-pin" size={13} />{activity.geometry ? 'Déplacer sur la carte' : 'Placer sur la carte'}</button>
          <button type="button" className="btn btn-primary vg-btn-sm" onClick={onEdit}><Icon name="ph-pencil-simple" size={13} />Modifier</button>
        </div>
      )}
    </div>
  );
}

// ─── Échelle ────────────────────────────────────────────────────────────────

const parseNum = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

/** Échelle (largeur réelle du plan, étalonnage sur deux points) et seuil de proximité. */
export function ScaleForm({ map, measured, onDone, onCancel, onMeasure }: { map: MapConfig; measured: number | null; onDone: () => void; onCancel: () => void; onMeasure: () => void }) {
  const [width, setWidth] = useState(map.metersPerUnit ? String(map.metersPerUnit).replace('.', ',') : '');
  const [distance, setDistance] = useState('');
  const onDistance = (val: string) => {
    setDistance(val);
    const d = parseNum(val);
    if (measured && d > 0) setWidth(String(Math.round((d / measured) * 10) / 10).replace('.', ','));
  };
  const widthM = parseNum(width);
  return (
    <ActionForm action={saveMapSettings} onDone={onDone} onCancel={onCancel} submitLabel="Enregistrer" hidden={{ siteId: map.siteId }}>
      {measured != null ? (
        <Field name="distance" label="Distance réelle entre les deux points mesurés (m)" hint={`Segment mesuré : ${(measured * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % de la largeur du plan. La largeur réelle du plan est recalculée.`}>
          <Input name="distance" inputMode="decimal" value={distance} onChange={(e) => onDistance(e.target.value)} placeholder="Ex. 104" autoFocus />
        </Field>
      ) : (
        <Notice tone="neutral" icon="ph-ruler">
          Étalonnez sur deux points dont vous connaissez la distance (longueur d&apos;un bâtiment, d&apos;une voie…).{' '}
          <button type="button" className="vg-text-btn" onClick={onMeasure}>Mesurer deux points sur la carte</button>
        </Notice>
      )}
      <FormRow>
        <Field name="metersPerUnit" label="Largeur réelle représentée par le plan (m)"
          hint={widthM > 0 ? `1 m ≈ ${(map.width / widthM).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} px du plan (${map.width} px de large).` : 'Mètres pour toute la largeur du plan.'}>
          <Input name="metersPerUnit" inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="Ex. 320" />
        </Field>
        <Field name="proximityMeters" label="Seuil de proximité (m)" hint="En dessous, deux activités voisines sont en coactivité.">
          <Input name="proximityMeters" inputMode="numeric" defaultValue={String(map.proximityMeters)} />
        </Field>
      </FormRow>
      {/* Historique de la carte du site (PRV-12) : zones, voies, plan de fond, échelle. */}
      <LazyChangeLog entity="site_map" id={map.siteId} title="Historique de la carte" />
    </ActionForm>
  );
}

// ─── Plan de fond ───────────────────────────────────────────────────────────

const MAX_BYTES = 10 * 1024 * 1024;
const PDF_WIDTH = 2400;
type Picked = { file: File; preview: string; width: number; height: number; note: string };

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion impossible.'))), type, quality));

/** Page 1 d'un PDF → image PNG (≈ 2 400 px de large), JPEG si le PNG dépasse 10 Mo. */
async function pdfToImage(file: File): Promise<Picked> {
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
    let blob = await canvasBlob(canvas, 'image/png');
    if (blob.size > MAX_BYTES) blob = await canvasBlob(canvas, 'image/jpeg', 0.85);
    if (blob.size > MAX_BYTES) blob = await canvasBlob(canvas, 'image/jpeg', 0.6);
    if (blob.size > MAX_BYTES) throw new Error('Image convertie trop lourde (plus de 10 Mo).');
    const name = `${file.name.replace(/\.pdf$/i, '')}.${blob.type === 'image/png' ? 'png' : 'jpg'}`;
    return {
      file: new File([blob], name, { type: blob.type }), preview: URL.createObjectURL(blob), width: canvas.width, height: canvas.height,
      note: `Page 1${doc.numPages > 1 ? ` sur ${doc.numPages}` : ''} convertie en image (${canvas.width} × ${canvas.height} px).`,
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
        setBusy('Conversion de la page 1 du PDF…');
        setPicked(await pdfToImage(file));
      } else if (/^image\/(png|jpeg|webp)$/.test(file.type)) {
        if (file.size > MAX_BYTES) throw new Error(`« ${file.name} » dépasse 10 Mo.`);
        const size = await imageSize(file);
        setPicked({ file, preview: URL.createObjectURL(file), ...size, note: `${size.width} × ${size.height} px.` });
      } else {
        throw new Error('Format non accepté : image PNG, JPEG, WebP ou PDF.');
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Impossible de lire ce fichier.');
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
      else setError(Object.values(r.fieldErrors ?? {})[0] ?? r.error ?? 'Enregistrement impossible.');
    });
  };

  const ratioChange = picked ? Math.abs(picked.height / picked.width - map.aspect) / map.aspect : 0;
  return (
    <form className="vg-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Facts items={[
        ['Plan actuel', map.custom ? map.fileName ?? 'Plan importé' : map.url ? 'Plan schématique par défaut' : 'Aucun plan (fond quadrillé)'],
        ['Dimensions', `${map.width} × ${map.height} px`],
      ]} />
      <Field name="file" label="Nouveau plan" hint="Image PNG, JPEG ou WebP, ou PDF (la première page est convertie en image) ; 10 Mo au maximum.">
        <input id="file" name="file" type="file" className="input" accept="image/png,image/jpeg,image/webp,application/pdf"
          onChange={(e) => void pick(e.target.files?.[0])} disabled={!!busy || pending} />
      </Field>
      {busy && <span style={{ ...muted, display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="ph-spinner" size={13} />{busy}</span>}
      {picked && (
        <div style={{ display: 'grid', gap: 6 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:) avant envoi */}
          <img src={picked.preview} alt="Aperçu du nouveau plan" className={styles.preview} />
          <span style={muted}>{picked.note}</span>
        </div>
      )}
      <Notice tone="warn" icon="ph-info">
        Les zones, voies et activités sont conservées en coordonnées relatives au plan : vérifiez leur position et ajustez-les si le nouveau plan n&apos;a pas le même cadrage, puis étalonnez l&apos;échelle.
        {ratioChange > 0.02 && <> Les proportions du nouveau plan diffèrent de l&apos;actuel ({Math.round(ratioChange * 100)} %) : un recalage sera nécessaire.</>}
      </Notice>
      <ErrorLine error={error ?? reset.error} />
      <div className="dialog-actions" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {map.custom && DEFAULT_PLANS[map.siteId] && (
          <span style={{ marginRight: 'auto' }}>
            <ConfirmButton label="Revenir au plan schématique" confirmLabel="Revenir" icon="ph-arrow-counter-clockwise" question="Supprimer le plan importé ?"
              pending={reset.pending} onConfirm={() => reset.run(() => resetSitePlan(map.siteId), onDone)} className="btn btn-ghost vg-btn-sm" />
          </span>
        )}
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn btn-primary" disabled={!picked || pending || !!busy}>{pending ? 'Envoi…' : 'Remplacer le plan'}</button>
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
