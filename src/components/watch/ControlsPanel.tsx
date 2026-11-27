'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { ActionFields } from '@/components/ActionFormDialog';
import { EntityFiles } from '@/components/EntityFiles';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { LinkedEvents } from '@/components/LinkedEvents';
import { newEventHref } from '@/lib/event-prefill';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { LinkActionButton } from '@/components/LinkActionButton';
import { ReasonButton } from '@/components/ReasonDialog';
import { Icon, ToneTag } from '@/components/ui';
import { QHSE_ONLY_CREATE_MESSAGE, actionHref } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { addMonths, fmtDate } from '@/lib/dates';
import { CONTROL_CATEGORIES, CONTROL_CATEGORY_KEYS, CONTROL_RESULTS, TONE, controlResultsFor, isControlCategory } from '@/lib/domain';
import type { FormOptions, Option } from '@/lib/data/options';
import { ARCHIVED_SITE_SUFFIX, LEFT_SUFFIX, withCurrent } from '@/lib/form-options';
import type { ControlFilter, ControlView } from '@/lib/data/watch';
import {
  archiveControl, cancelControlRecord, recordControl, restoreControl, saveControl, type CancelRecordState, type RecordControlState,
} from '@/server/watch';
import { controlOverdueDefaults, controlReserveDefaults } from './action-defaults';
import { ArchivedBanner, Facts, FileError, Notice, ViewSwitch, checkPickedFiles, muted, rowOpener } from './parts';
import { TipButton } from '@/components/Tip';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

type Opts = Pick<FormOptions, 'people' | 'sites'>;
/**
 * Plan d'actions (ACT-22) : `actionOptions` (formulaire d'action) et `linkActions` (actions ouvertes à rattacher) ne sont
 * fournis qu'au service QHSE, seul à créer une action et à modifier ses rattachements.
 */
type ActionProps = { actionOptions?: ActionFormOptions | null; linkActions?: readonly Option[] };
export type ControlSuggestions = { types: string[]; organizations: string[] };
type View = 'fiche' | 'historique' | 'realise';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Périodicité après « tous les » : « tous les mois » plutôt que « tous les 1 mois ». */
const months = (n: number, t: T) => (n === 1 ? t('month#every') : fill(t('{n} months'), { n }));

/** Prochain contrôle = dernier + périodicité (vide tant que la saisie est incomplète). */
function nextFrom(lastOn: string, period: string) {
  const n = Number(period);
  return ISO.test(lastOn) && Number.isInteger(n) && n >= 1 && n <= 120 ? addMonths(lastOn, n) : '';
}

// ─── Tableau des contrôles ──────────────────────────────────────────────────

export function ControlsPanel({ rows, filter, canManage, canApprove, options, actionOptions, linkActions, requirementOptions, today, showSite, suggestions, initialId, closeHref, emptyText }: ActionProps & {
  /** Liste vide par l'effet des filtres (VEI-13). */
  emptyText?: string;
  /** Contrôles du site, archivés compris (filtre « Archivés ») : la fiche ouverte reste affichée après son archivage. */
  rows: ControlView[];
  filter?: ControlFilter;
  canManage: boolean;
  /** Animateur QHSE, direction : annulation d'un enregistrement, restauration d'un contrôle archivé. */
  canApprove: boolean;
  options: Opts;
  /** Exigences en vigueur, pour rattacher le contrôle à son exigence réglementaire. */
  requirementOptions: readonly Option[];
  today: string;
  /** « Tous les sites » : rappelle le site de chaque équipement. */
  showSite: boolean;
  suggestions: ControlSuggestions;
  /** Contrôle à ouvrir d'emblée (lien profond `?controle=<id>`). */
  initialId?: number;
  /** URL sans le lien profond, rétablie à la fermeture. */
  closeHref?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const firstView = (c?: ControlView): View => (canManage && c && !c.archived ? 'fiche' : 'historique');
  const [sel, setSel] = useState<{ id: number; view: View } | null>(initialId ? { id: initialId, view: firstView(rows.find((c) => c.id === initialId)) } : null);
  const control = sel ? rows.find((c) => c.id === sel.id) ?? null : null;
  // « Tous » : contrôles en service ; les équipements réformés ne s'affichent qu'avec le filtre « Archivés ».
  const shown = filter ? rows.filter((c) => c.filter === filter) : rows.filter((c) => !c.archived);
  const open = (id: number, view: View) => setSel({ id, view });
  const close = () => {
    setSel(null);
    if (closeHref) router.replace(closeHref, { scroll: false });
  };

  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 960 }}>
          <thead>
            <tr>
              <th>{t('Equipment')}</th><th>{t('Inspection')}</th><th>{t('Frequency')}</th><th>{t('Body')}</th><th>{t('Last')}</th><th>{t('Next')}</th><th>{t('Status')}</th><th>{t('Reservations')}</th>
              {canManage && <th aria-label={t('Actions')} />}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={canManage ? 9 : 8} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
                {emptyText ?? (filter === 'archives' ? t('No archived inspection.') : rows.some((c) => !c.archived) ? t('No inspection in this category.') : showSite ? t('No periodic inspection followed.') : t('No periodic inspection followed on this site.'))}
              </td></tr>
            )}
            {shown.map((c) => (
              <tr key={c.id} {...rowOpener(() => open(c.id, firstView(c)))} data-obsolete={c.archived || undefined}>
                <td style={{ fontWeight: 500, minWidth: 180 }}>
                  {c.equipment}
                  {c.category === 'metrologie' && <span className="tag tag-neutral" style={{ marginLeft: 6, fontSize: 11, verticalAlign: 'middle' }}>{t('Metrology')}</span>}
                  {(showSite || c.responsible || c.equipmentCode) && (
                    <div style={{ ...muted, fontWeight: 400, marginTop: 2 }}>{[c.equipmentCode, showSite && c.siteLabel, c.responsible].filter(Boolean).join(' · ')}</div>
                  )}
                  {c.archivedLabel && <div style={{ ...muted, fontWeight: 400, marginTop: 2 }}>{c.archivedLabel}</div>}
                </td>
                <td style={{ color: 'var(--color-neutral-300)' }}>{c.controlType}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{c.period}</td>
                <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{c.organization}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--color-neutral-400)' }}>{c.last}</td>
                <td style={{ whiteSpace: 'nowrap', color: c.tone === 'neutral' ? 'var(--color-neutral-300)' : TONE[c.tone].dot }}>{c.next}</td>
                <td>
                  <ToneTag tone={c.tone} style={{ whiteSpace: 'nowrap' }}>{c.status}</ToneTag>
                  {/* Contrôle dépassé sans réserve ni action (les réserves sans action sont signalées dans la colonne suivante). */}
                  {canManage && c.days < 0 && !c.archived && !c.actionId && !c.reserves && (
                    <div style={{ ...muted, marginTop: 2, color: TONE.danger.dot, whiteSpace: 'nowrap' }}>{t('Action to define')}</div>
                  )}
                </td>
                <td style={{ color: 'var(--color-neutral-300)', whiteSpace: 'nowrap' }}>
                  {c.reserves ?? '—'}
                  {c.actionId ? (
                    <div style={{ marginTop: 2 }}>
                      <Link href={actionHref(c.actionId)} className="vg-link" style={{ fontSize: 11 }}>{c.actionId}</Link>
                      {c.action && <span style={{ ...muted, color: c.action.late ? TONE.danger.dot : muted.color }}> · {labelT(t)(c.action.statusLabel)}</span>}
                    </div>
                  ) : c.reserves && canManage && !c.archived ? (
                    <div style={{ ...muted, marginTop: 2, color: TONE.danger.dot }}>{t('Action to define')}</div>
                  ) : null}
                </td>
                {canManage && (
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {!c.archived && (
                      <TipButton className="vg-text-btn" tip={t('Record an inspection carried out')} onClick={() => open(c.id, 'realise')}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Icon name="ph-check-square-offset" size={13} />{t('Carried out')}
                      </TipButton>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!control} onClose={close} width={660}
        kicker={control ? `${t('Periodic inspection')} · ${control.siteLabel}${control.archived ? t(' · archived') : ''}` : undefined} title={control?.equipment ?? ''}>
        {control && sel && (
          <ControlDetail key={control.id} c={control} initialView={sel.view} canManage={canManage} canApprove={canApprove} options={options}
            actionOptions={actionOptions} linkActions={linkActions} requirementOptions={requirementOptions} today={today} suggestions={suggestions} onClose={close} />
        )}
      </Dialog>
    </div>
  );
}

/** Bouton « Ajouter un contrôle ». */
export function AddControlButton({ options, requirementOptions, defaultSite, suggestions, today }: {
  options: Opts; requirementOptions: readonly Option[]; defaultSite: string; suggestions: ControlSuggestions; today: string;
}) {
  const { t } = useI18n();
  return (
    <DialogButton label={t('Add an inspection')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('New periodic inspection')} kicker={t('Periodic inspections')} width={660}>
      {(close) => <ControlForm options={options} requirementOptions={requirementOptions} defaultSite={defaultSite} suggestions={suggestions} today={today} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

// ─── Fiche d'un contrôle ────────────────────────────────────────────────────

function ControlDetail({ c, initialView, canManage, canApprove, options, actionOptions, linkActions, requirementOptions, today, suggestions, onClose }: ActionProps & {
  c: ControlView; initialView: View; canManage: boolean; canApprove: boolean; options: Opts; requirementOptions: readonly Option[];
  today: string; suggestions: ControlSuggestions; onClose: () => void;
}) {
  const { t } = useI18n();
  const editable = canManage && !c.archived;
  const [view, setView] = useState<View>(editable ? initialView : 'historique');
  // Confirmation après un enregistrement (la vue bascule sur l'historique) ou une restauration.
  const [notice, setNotice] = useState<string | null>(null);
  // « Lever les réserves » / « Créer une action » s'affichent dans cette fenêtre (pas de NewActionButton imbriqué : identifiants de champs en double).
  const [creating, setCreating] = useState(false);
  const show = (v: View) => { setNotice(null); setView(v); };
  const current = editable ? view : 'historique';
  const views: (readonly [View, string, string])[] = editable
    ? [['fiche', t('Record'), 'ph-pencil-simple'], ['historique', `${t('History')} · ${c.records.length}`, 'ph-clock-counter-clockwise'], ['realise', t('Inspection carried out'), 'ph-check-square-offset']]
    : [];

  return (
    <>
      <Facts items={[
        [t('Status'), <ToneTag key="s" tone={c.tone} style={{ marginTop: 1 }}>{c.status}</ToneTag>],
        [t('Next'), <span key="n" style={{ color: c.tone === 'neutral' ? undefined : TONE[c.tone].dot }}>{c.next}</span>],
        [t('Last'), c.last],
        [t('Nature'), isControlCategory(c.category) ? labelT(t)(CONTROL_CATEGORIES[c.category].label) : c.category],
        !!c.tolerance && [t('Tolerance'), c.tolerance],
        [t('Frequency'), fill(t('Every {period}'), { period: months(c.periodMonths, t) })],
        [t('Body'), c.organization],
        !!c.equipmentCode && [t('Equipment code'), c.equipmentCode],
        [t('Owner'), c.responsible || '—'],
        [t('Reservations'), c.reserves ?? t('None#f')],
        c.requirement && [t('Requirement'), (
          <Link key="r" href={`/veille?exigence=${c.requirement.id}`} className="vg-link" style={{ fontSize: 12.5 }}>
            {c.requirement.text}{c.requirement.archived ? t(' (archived#f)') : ''}
          </Link>
        )],
      ]} />

      {c.archived && (
        <ArchivedBanner title={t('Equipment scrapped · inspection archived')} label={c.archivedLabel}>
          {canApprove && (
            <ReasonButton label={t('Restore')} icon="ph-arrow-counter-clockwise" title={fill(t('Restore “{text}”'), { text: c.equipment })} kicker={t('Periodic inspections')}
              action={restoreControl} hidden={{ id: c.id }} submitLabel={t('Restore the inspection')} submitIcon="ph-arrow-counter-clockwise"
              message={t('The inspection comes back in the follow-up, with its deadlines and its history.')}
              placeholder={t('E.g. archived by mistake, equipment back in service')} onDone={() => setNotice(t('Inspection restored in the follow-up.'))} />
          )}
        </ArchivedBanner>
      )}

      {notice && <Notice>{notice}</Notice>}

      <FollowUp c={c} today={today} actionOptions={c.archived ? null : actionOptions} linkActions={c.archived ? undefined : linkActions} editable={editable}
        creating={creating} setCreating={setCreating}
        onCreated={() => { setCreating(false); setNotice(t('Action created and linked to the inspection.')); }}
        onRecord={editable && !c.archived ? () => show('realise') : undefined} />

      {/* EVT-14 : événements rattachés à l'équipement (pannes, presque-accidents, non-conformités). */}
      {!creating && <LinkedEvents events={c.events} reportHref={canManage && !c.archived ? newEventHref('controle', c.id) : null} />}

      {!creating && (
        <>
          {views.length > 0 && <ViewSwitch name={`control-view-${c.id}`} value={current} onChange={show} options={views} />}

          {/* Pas de `key` dérivée des données : l'enregistrement les modifie et remonterait le formulaire avant son onDone. */}
          {current === 'fiche' && (
            <>
              <ControlForm c={c} options={options} requirementOptions={requirementOptions} defaultSite={c.siteId ?? ''} suggestions={suggestions} today={today} onDone={onClose} onCancel={onClose} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
                <span style={{ ...muted, flex: 1, minWidth: 200, textWrap: 'pretty' }}>{t('Equipment scrapped? The inspection is archived with its reason; its history is kept.')}</span>
                <ReasonButton label={t('Archive the inspection')} icon="ph-archive" title={fill(t('Archive “{text}”'), { text: c.equipment })} kicker={t('Periodic inspections · equipment scrapped')}
                  action={archiveControl} hidden={{ id: c.id }} submitLabel={t('Archive')} submitIcon="ph-archive"
                  message={t('The inspection leaves the follow-up and the deadlines. The history of the inspections carried out and the linked action are kept.')}
                  placeholder={t('E.g. equipment scrapped, replaced by …')} />
              </div>
            </>
          )}
          {current === 'historique' && (
            <>
              <History c={c} canApprove={canApprove && !c.archived} canEditFiles={editable} onNotice={setNotice} />
              <LazyChangeLog entity="control" id={c.id} title={t('Change log')} />
            </>
          )}
          {current === 'realise' && (
            <RecordForm c={c} today={today} suggestions={suggestions}
              onDone={(s) => { setView('historique'); setNotice(s.notice ?? t('Inspection carried out recorded in the history.')); }} onCancel={onClose} />
          )}
        </>
      )}
    </>
  );
}

/**
 * Suivi du contrôle dans le plan d'actions : action liée (détachable par le QHSE) ; sinon, réserves en cours ou contrôle
 * dépassé, avec « Lever les réserves » / « Créer une action » ou le rattachement d'une action existante (service QHSE
 * seulement, ACT-22 ; l'encadrement qui suit le contrôle lit QHSE_ONLY_CREATE_MESSAGE).
 */
function FollowUp({ c, today, actionOptions, linkActions, editable, creating, setCreating, onCreated, onRecord }: ActionProps & {
  c: ControlView; today: string; editable: boolean; creating: boolean; setCreating: (v: boolean) => void; onCreated: () => void;
  /** VEI-05 : « Enregistrer le contrôle de levée » (vue « Contrôle réalisé »), pour qui saisit les contrôles. */
  onRecord?: () => void;
}) {
  const { t } = useI18n();
  const qhse = !!actionOptions;
  const overdue = c.days < 0 && !c.archived;
  if (!c.reserves && !c.actionId && !overdue) return null;
  const box = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', fontSize: 12.5 } as const;
  const link = `control:${c.id}`;
  if (c.actionId) {
    return (
      <div className="vg-inset" style={box}>
        <Icon name="ph-list-checks" size={15} style={{ color: 'var(--color-accent)' }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: 'var(--color-neutral-500)' }}>{c.reserves ? fill(t('Open reservations · {reserves} · action '), { reserves: c.reserves }) : t('Linked action ')}</span>
          <Link href={actionHref(c.actionId)} className="vg-link" style={{ fontSize: 12.5 }}>{c.actionId}</Link>
          {c.action && <span> · {c.action.label}</span>}
          {c.action && <span style={{ ...muted, display: 'block', color: c.action.late ? TONE.danger.dot : muted.color }}>{fill(t('Target date {date}'), { date: c.action.due })}</span>}
        </span>
        {c.action && <ToneTag tone={c.action.tone} style={{ whiteSpace: 'nowrap' }}>{labelT(t)(c.action.statusLabel)}</ToneTag>}
        {linkActions && <LinkActionButton link={link} current={c.actionId} />}
        {/* VEI-05 : action de levée close, réserves toujours inscrites : boucler par un contrôle sans réserve. */}
        {c.loopBack && (
          <span role="status" style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid var(--color-divider)' }}>
            <Icon name="ph-arrows-clockwise" size={15} style={{ color: TONE.warn.dot }} />
            <span style={{ flex: 1, minWidth: 180, textWrap: 'pretty' }}>
              {fill(t('Action {state}, reservations still noted: record the inspection lifting the reservations'), { state: c.loopBack.abandoned ? t('abandoned#f') : t('verified#f') })}
              {qhse ? t(', or unlink the action to create a new one.') : '.'}
            </span>
            {onRecord && (
              <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onRecord}>
                <Icon name="ph-check-square-offset" size={13} />{t('Record the inspection')}
              </button>
            )}
          </span>
        )}
      </div>
    );
  }
  if (creating && actionOptions) {
    return (
      <>
        <div className="vg-eyebrow">{c.reserves ? t('Lift the reservations') : t('Inspection overdue')} · plan d&apos;actions unique</div>
        {/* Rendu sur un état local seulement : l'action liée arrive avec le même rafraîchissement que le succès du formulaire. */}
        <ActionFields options={actionOptions} defaults={c.reserves ? controlReserveDefaults(c, today) : controlOverdueDefaults(c, today)}
          onCancel={() => setCreating(false)} onDone={onCreated} />
      </>
    );
  }
  if (!c.reserves) {
    // Contrôle dépassé, sans réserve ni action : signalé à qui peut agir seulement (le statut « Dépassé » suffit sinon).
    if (!editable && !qhse) return null;
    return (
      <div className="vg-inset" style={{ ...box, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${TONE.danger.dot} 45%, transparent)` }}>
        <Icon name="ph-warning-octagon" size={15} style={{ color: TONE.danger.dot }} />
        <span style={{ flex: 1, minWidth: 180, textWrap: 'pretty' }}>
          <span style={{ color: 'var(--color-neutral-500)' }}>{t('Inspection overdue since ')}</span>{c.next}
          <span style={{ ...muted, display: 'block' }}>Aucune action dans le plan d&apos;actions.{qhse ? '' : ` ${QHSE_ONLY_CREATE_MESSAGE}`}</span>
        </span>
        {linkActions && <LinkActionButton link={link} actions={linkActions} label={t('Link')} />}
        {qhse && (
          <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setCreating(true)}>
            <Icon name="ph-plus" size={13} />{t('Create an action')}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="vg-inset" style={{ ...box, boxShadow: editable ? `inset 0 0 0 1px color-mix(in srgb, ${TONE.warn.dot} 45%, transparent)` : undefined }}>
      <Icon name="ph-warning" size={15} style={{ color: TONE.warn.dot }} />
      <span style={{ flex: 1, minWidth: 180, textWrap: 'pretty' }}>
        <span style={{ color: 'var(--color-neutral-500)' }}>{t('Open reservations')} · </span>{c.reserves}
        {(editable || qhse) && (
          <span style={{ ...muted, display: 'block' }}>{t('No lifting action in the action plan.')}{qhse ? '' : ` ${QHSE_ONLY_CREATE_MESSAGE}`}</span>
        )}
      </span>
      {linkActions && <LinkActionButton link={link} actions={linkActions} label={t('Link')} />}
      {qhse && (
        <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setCreating(true)}>
          <Icon name="ph-plus" size={13} />{t('Lift the reservations')}
        </button>
      )}
    </div>
  );
}

function History({ c, canApprove, canEditFiles, onNotice }: {
  c: ControlView; canApprove: boolean; canEditFiles: boolean; onNotice: (msg: string) => void;
}) {
  const { t } = useI18n();
  if (!c.records.length) {
    return (
      <div className="vg-inset" style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
        {t('No inspection recorded in Vigie for this equipment. Last known inspection: ')}{c.last}{c.reserves ? fill(t(' (reservations: {reserves})'), { reserves: c.reserves }) : ''}.
      </div>
    );
  }
  return (
    <div style={{ display: 'grid' }}>
      {c.records.map((r, i) => (
        <div key={r.id} className={i < c.records.length - 1 ? 'vg-rule-bottom' : undefined}
          style={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', gap: 12, padding: '10px 0', opacity: r.cancelled ? 0.6 : undefined }}>
          <div style={{ display: 'grid', gap: 2, alignContent: 'start' }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, textDecoration: r.cancelled ? 'line-through' : undefined }}>{r.date}</span>
            {r.latest && <span style={muted}>{t('Last')}</span>}
            {r.cancelled && <span style={muted}>{t('Cancelled#m')}</span>}
          </div>
          <div style={{ display: 'grid', gap: 5, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, textDecoration: r.cancelled ? 'line-through' : undefined }}>
              <span>{r.organization}</span>
              {r.result && <ToneTag tone={r.cancelled ? 'neutral' : r.result.tone}>{r.result.label}</ToneTag>}
              <ToneTag tone={r.cancelled ? 'neutral' : r.reserves ? 'warn' : 'ok'}>{r.reserves ? `${t('Reservations')} · ${r.reserves}` : t('No reservation')}</ToneTag>
            </div>
            {r.cancelLabel && <span style={{ ...muted, fontSize: 11.5, color: 'var(--color-neutral-300)' }}>{r.cancelLabel}</span>}
            {r.notes && <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{r.notes}</p>}
            {r.eventId && (
              <span style={{ fontSize: 12 }}>
                <span style={muted}>{t('Non-conformity opened')} · </span>
                <Link href={`/evenements?sel=${encodeURIComponent(r.eventId)}`} className="vg-link" style={{ fontSize: 12 }}>{r.eventId}</Link>
              </span>
            )}
            {/* VEI-08 : rapport complété ou retiré (motif) après la saisie ; figé sur un enregistrement annulé. */}
            <EntityFiles kind="control_record" entityId={r.id} title={t('Report and attachments')} kicker={`${c.equipment} · ${fill(t('inspection of {date}'), { date: r.date })}`} files={r.files}
              canAdd={canEditFiles && !r.cancelled} emptyText={t('No report attached.')} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {r.recordedBy && <span style={muted}>Saisi par {r.recordedBy}</span>}
              {canApprove && !r.cancelled && (
                <ReasonButton label={t('Cancel the record')} icon="ph-arrow-u-up-left" className="vg-text-btn" style={{ fontSize: 11.5 }}
                  title={fill(t('Cancel the inspection of {date}'), { date: r.date })} kicker={c.equipment}
                  action={cancelControlRecord} hidden={{ id: r.id }} submitLabel={t('Cancel the record')} submitIcon="ph-arrow-u-up-left"
                  message={r.latest
                    ? t('Wrong entry: the record stays visible, struck through, with its reason. The state of the inspection (last, next, reservations) is recomputed.')
                    : t('Wrong entry: the record stays visible, struck through, with its reason. The deadline of the inspection is not changed.')}
                  placeholder={t('E.g. wrong date, inspection entered on the wrong equipment')}
                  onDone={(s) => onNotice((s as CancelRecordState).notice ?? fill(t('Record of {date} cancelled.'), { date: r.date }))} />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Formulaires ────────────────────────────────────────────────────────────

function Suggestions({ id, values }: { id: string; values: string[] }) {
  return <datalist id={id}>{values.map((v) => <option key={v} value={v} />)}</datalist>;
}

const RECORD_HINT = '“Record an inspection” updates it (history, reservations and lifting action).';

function ControlForm({ c, options, requirementOptions, defaultSite, suggestions, today, onDone, onCancel }: {
  c?: ControlView; options: Opts; requirementOptions: readonly Option[]; defaultSite: string; suggestions: ControlSuggestions; today: string;
  onDone: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  // Exigence archivée encore rattachée : conservée comme choix (la modification renvoie toujours une valeur).
  const reqs = withCurrent(requirementOptions, c?.requirement ? String(c.requirement.id) : null, c?.requirement ? `${c.requirement.text}${t(' (archived#f)')}` : null);
  // Responsable sorti de l'effectif, site archivé : conservés comme choix tant qu'un autre n'est pas fait (VEI-01).
  const responsibles = withCurrent(options.people, c?.responsibleId, c ? `${c.responsible || c.responsibleId}${LEFT_SUFFIX}` : undefined);
  const sites = withCurrent(options.sites, c?.siteId, c ? `${c.siteLabel}${ARCHIVED_SITE_SUFFIX}` : undefined);
  const [lastOn, setLastOn] = useState(c?.lastOn ?? '');
  const [period, setPeriod] = useState(c ? String(c.periodMonths) : '12');
  // Échéance saisie à la main (null = calculée).
  const [manualNext, setManualNext] = useState<string | null>(c && c.nextOn !== nextFrom(c.lastOn, String(c.periodMonths)) ? c.nextOn : null);
  const computed = nextFrom(lastOn, period);
  const nextOn = manualNext ?? computed;

  return (
    <ActionForm action={saveControl} hidden={{ id: c?.id, version: c?.version }} onDone={onDone} onCancel={onCancel} submitLabel={c ? t('Save') : t('Add the inspection')}>
      <Field name="equipment" label={t('Equipment')}>
        <Input name="equipment" defaultValue={c?.equipment} placeholder={t('E.g. Overhead crane 10 t — assembly workshop')} maxLength={160} autoFocus={!c} />
      </Field>
      <FormRow>
        <Field name="category" label={t('Nature')} hint={t('Calibration: monitoring and measuring equipment (ISO 9001 §7.1.5); an out-of-tolerance result opens a non-conformity.')}>
          <Select name="category" options={CATEGORY_OPTIONS.map(([k, l]) => [k, labelT(t)(l)] as const)} defaultValue={c?.category ?? 'reglementaire'} />
        </Field>
        <Field name="tolerance" label={t('Tolerance (calibration)')} hint={t('Maximum permissible error, accuracy class… Optional.')}>
          <Input name="tolerance" defaultValue={c?.tolerance ?? ''} placeholder="Ex. ± 0,02 mm" maxLength={120} />
        </Field>
      </FormRow>
      <Field name="equipmentCode" label={t('Equipment code')} hint={t('Optional · code shared with the Crucible test resource (capitals, digits, hyphens), published with the inspection.')}>
        <Input name="equipmentCode" defaultValue={c?.equipmentCode ?? ''} placeholder={t('E.g. PDE-PIL')} maxLength={32} autoCapitalize="characters" spellCheck={false}
          style={{ textTransform: 'uppercase' }} />
      </Field>
      <FormRow>
        <Field name="controlType" label={t('Inspection type')}>
          <Input name="controlType" defaultValue={c?.controlType} placeholder={t('E.g. Lifting periodic check')} list={`${uid}-types`} maxLength={120} />
        </Field>
        <Field name="periodMonths" label={t('Frequency (months)')}>
          <Input name="periodMonths" type="number" min={1} max={120} step={1} inputMode="numeric" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="organization" label={t('Body')} hint={t('Approved body or “Internal — department”.')}>
          <Input name="organization" defaultValue={c?.organization} placeholder={t('E.g. [Apave]')} list={`${uid}-orgs`} maxLength={120} />
        </Field>
        <Field name="responsibleId" label={t('Owner')} hint={responsibles !== options.people ? t('Left the workforce: kept as long as no successor is chosen.') : undefined}>
          <Select name="responsibleId" options={responsibles} defaultValue={c?.responsibleId ?? ''} placeholder={t('Not appointed')} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="siteId" label={t('Site')} hint={sites !== options.sites ? t('Site archived: kept as long as no other site is chosen.') : undefined}>
          <Select name="siteId" options={sites} defaultValue={c ? c.siteId ?? '' : defaultSite} placeholder={t('All sites')} />
        </Field>
        <Field name="reserves" label={t('Open reservations')} hint={c ? t(RECORD_HINT) : t('Empty = none. Updated at each inspection recorded.')}>
          {/* VEI-09 : à la modification, champ en lecture (non envoyé) ; il change par un contrôle enregistré. */}
          <Input name="reserves" defaultValue={c?.reserves ?? ''} placeholder={c ? t('None#f') : t('E.g. 1 · limit switch to adjust')} maxLength={160} disabled={!!c} />
        </Field>
      </FormRow>
      <Field name="requirementId" label={t('Regulatory requirement')} hint={t('Text the inspection falls under: an overdue inspection suggests a gap there.')}>
        <Select name="requirementId" options={reqs} defaultValue={c?.requirementId != null ? String(c.requirementId) : ''} placeholder={t('None#f')} />
      </Field>
      <FormRow>
        <Field name="lastOn" label={t('Last inspection')} hint={c ? t(RECORD_HINT) : undefined}>
          <Input name="lastOn" type="date" value={lastOn} max={today} onChange={(e) => setLastOn(e.target.value)} disabled={!!c} />
        </Field>
        <Field name="nextOn" label={t('Next inspection')}
          hint={manualNext !== null ? (
            <>{t('Manual entry · ')}<button type="button" className="vg-text-btn" style={{ fontSize: 11 }} onClick={() => setManualNext(null)}>
              {t('recompute')}{computed ? ` (${fmtDate(computed)})` : ''}
            </button></>
          ) : t('Computed: last inspection + frequency.')}>
          <Input name="nextOn" type="date" value={nextOn} min={lastOn || undefined} onChange={(e) => setManualNext(e.target.value)} />
        </Field>
      </FormRow>
      <Suggestions id={`${uid}-types`} values={suggestions.types} />
      <Suggestions id={`${uid}-orgs`} values={suggestions.organizations} />
    </ActionForm>
  );
}

const CATEGORY_OPTIONS = CONTROL_CATEGORY_KEYS.map((k) => [k, CONTROL_CATEGORIES[k].label] as const);
/** Résultats proposés selon la nature du contrôle (VEI-14 : « hors tolérance » pour un étalonnage seulement). */
const resultOptions = (category: string) => controlResultsFor(category).map((k) => [k, CONTROL_RESULTS[k].label] as const);

function RecordForm({ c, today, suggestions, onDone, onCancel }: {
  c: ControlView; today: string; suggestions: ControlSuggestions; onDone: (state: RecordControlState) => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  const [date, setDate] = useState(today);
  const [fileError, setFileError] = useState<string | null>(null);
  const valid = ISO.test(date);
  const older = valid && date < c.lastOn;

  return (
    <ActionForm action={recordControl} hidden={{ controlId: c.id }} encType="multipart/form-data" onDone={onDone} onCancel={onCancel}
      submitLabel={t('Record the inspection')} submitIcon="ph-check-square-offset">
      <FormRow>
        <Field name="performedOn" label={t('Inspection date')}>
          <Input name="performedOn" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field name="organization" label={t('Body')}>
          <Input name="organization" defaultValue={c.organization} list={`${uid}-orgs`} maxLength={120} />
        </Field>
      </FormRow>
      {/* VEI-11 : avis de l'organisme ; défavorable ou mise à l'arrêt : équipement signalé jusqu'à un contrôle favorable. */}
      <Field name="result" label={c.category === 'metrologie' ? t('Calibration result') : t('Inspection result')}
        hint={c.category === 'metrologie'
          ? t('Out of tolerance: the equipment is flagged until a new compliant calibration and a non-conformity is opened (validity of the earlier measurements to assess).')
          : t('Unfavourable or shut down: the equipment is flagged until a new favourable inspection.')}>
        <Select name="result" options={resultOptions(c.category).map(([k, l]) => [k, labelT(t)(l)] as const)} defaultValue="" placeholder={t('Choose…')} />
      </Field>
      <Field name="reserves" label={t('Reservations')}
        hint={t('Number and subject, e.g. “1 · limit switch to adjust”. Empty = no reservation.') + (c.actionId ? fill(t(' Different reservations unlink {id}, which stays in the action plan.'), { id: c.actionId }) : '')}>
        <Input name="reserves" placeholder={t('None#f')} maxLength={160} />
      </Field>
      <Field name="notes" label={t('Observations')}>
        <TextArea name="notes" rows={2} maxLength={2000} placeholder={t('Points noted, lifting of reservations, follow-up given…')} style={{ minHeight: 56 }} />
      </Field>
      <Field name="report" label={t('Report')} hint={t('PDF, image or Office document · 10 MB at most.')}>
        <Input name="report" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,.doc,.docx,.xls,.xlsx,.pptx,.txt,.csv"
          onChange={(e) => setFileError(checkPickedFiles(e.currentTarget))} />
      </Field>
      <FileError error={fileError} />
      <div className="vg-inset" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, color: 'var(--color-neutral-300)' }}>
        <Icon name="ph-calendar-check" size={15} style={{ color: older ? 'var(--color-neutral-500)' : 'var(--color-accent)', flex: 'none' }} />
        <span style={{ textWrap: 'pretty' }}>
          {!valid
            ? t('Enter the date of the inspection carried out.')
            : older
              ? fill(t('Earlier than the last known inspection ({date}): added to the history without changing the deadline.'), { date: c.last })
              : <>{t('Next inspection on ')}<strong style={{ fontWeight: 500, color: 'var(--color-text)' }}>{fmtDate(addMonths(date, c.periodMonths))}</strong>{fill(t(' (every {period}).'), { period: months(c.periodMonths, t) })}</>}
        </span>
      </div>
      <Suggestions id={`${uid}-orgs`} values={suggestions.organizations} />
    </ActionForm>
  );
}
