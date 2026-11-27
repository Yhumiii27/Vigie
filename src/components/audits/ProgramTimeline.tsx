'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { NewActionButton } from '@/components/ActionFormDialog';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ReasonButton, ReasonForm } from '@/components/ReasonDialog';
import { ActionForm, Checkbox, Field, FormRow, Input, Select } from '@/components/form';
import { CardHead, ToneTag } from '@/components/ui';
import { FileError, checkPickedFiles, filesHint } from '@/components/watch/parts';
import { ATTACH_ACCEPT } from '@/lib/attachments';
import { MONTHS_SHORT, addDays, fmtDate, monthName, monthOf, yearOf } from '@/lib/dates';
import { AUDIT_KINDS, FINDING_KINDS, PLAN_ITEM_STATES, TONE } from '@/lib/domain';
import type { FindingView, PlanItemView } from '@/lib/data/audits';
import type { Option } from '@/lib/data/options';
import { offeredOr, withCurrent } from '@/lib/form-options';
import type { ActionDefaults, ActionFormOptions } from '@/lib/action-view';
import { cancelPlanItem, hideTrack, removePlanItemReport, renameTrack, renewProgram, reschedulePlanItem, savePlanItem, showTrack } from '@/server/audits';
import { FindingForm } from './FindingsCard';
import { ActionLink, ActionLinks, DialogFooter, FileList } from './parts';
import { CHOOSABLE_AUDIT_KINDS, MONTH_OPTIONS, NEW_TRACK, REVIEW_TRACK, auditActionSource, auditReportAvailable, auditReportHref, inferAuditKind, isReviewPlanItem, monthLabel } from '@/lib/rules/audits';
import styles from './audits.module.css';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

type Opts = ActionFormOptions;

/**
 * Valeurs proposées pour l'action de suivi d'un élément du programme (ACT-28) : source selon la ligne (auditActionSource ;
 * « Revues de direction » → Revue de direction), élément lié (D15 : posé à la création seulement), problème = intitulé de
 * l'élément, responsable de l'élément, date cible = date prévue (vérification proposée 30 jours après) ; site choisi par le
 * service QHSE.
 */
export function planItemActionDefaults(item: Pick<PlanItemView, 'id' | 'track' | 'label' | 'detail' | 'year' | 'month' | 'ownerId' | 'plannedOn' | 'siteId'>): ActionDefaults {
  return {
    ...auditActionSource('plan', item.track), link: `plan:${item.id}`, linkLabel: `${item.track} · ${item.detail ?? item.label}`,
    originRef: `Programme ${item.year} · ${item.detail ?? item.label}`.slice(0, 120), problem: item.detail ?? item.label,
    pilotId: item.ownerId ?? undefined, dueOn: item.plannedOn ?? undefined, verifyDueOn: item.plannedOn ? addDays(item.plannedOn, 30) : undefined,
    // AUD-22 : site de l'élément imposé à l'action (élément commun : le service QHSE choisit).
    ...(item.siteId ? { siteId: item.siteId } : {}),
  };
}
/** Élément ouvert : existant (id), à créer (ligne + mois ; ligne null = nouvelle ligne) ou audit hors programme (AUD-20). */
type Editing = { id: number } | { track: string | null; month: number } | { unplanned: true } | null;

/** Listes du formulaire d'un élément : personnes présentes (responsable, auditeur interne) et sites (AUD-22, « Tous les sites » en tête quand admis). */
export type PlanFormOptions = { people: readonly Option[]; sites: readonly Option[] };
/** Vue secondaire de la fenêtre d'un élément : nouveau constat, report. */
type Sub = 'finding' | 'reschedule' | null;

type Props = {
  year: number;
  /** Mois en cours dans l'année affichée (0 = année à venir, 13 = année écoulée). */
  curMonth: number;
  tracks: string[];
  allTracks: string[];
  items: PlanItemView[];
  /** Éléments annulés de l'année (liste « Éléments annulés »), le plus récemment annulé d'abord. */
  cancelled: PlanItemView[];
  /** Constats rattachés aux éléments affichés. */
  findings: FindingView[];
  /** Référentiels proposés (audit de certification ou de suivi). */
  certs: readonly Option[];
  /** Audits du programme proposés dans le formulaire de constat. */
  auditOptions: Option[];
  /** Années proposées pour un report (« Reporter… »). */
  yearOptions: number[];
  /** Saisie sur l'écran Audits (animateur QHSE, direction) ; consultation seule sinon (AUD-02). */
  canEdit: boolean;
  /** Service QHSE (canCreateAction) : « Créer l'action de suivi » (ACT-22). */
  canCreate?: boolean;
  options: Opts;
  /** Listes du formulaire d'un élément (vides en consultation). */
  planOptions: PlanFormOptions;
  /** AUD-24 : lignes reprises de l'année précédente masquées pour l'année affichée. */
  hiddenTracks: string[];
  /** AUD-24 : année reconductible (année précédente), ou null. */
  renewFrom: number | null;
  aside?: ReactNode;
  /** Élément à ouvrir d'emblée (lien profond `?element=<id>`). */
  initialId?: number;
  /** URL sans le lien profond, rétablie à la fermeture. */
  closeHref?: string;
};

const REVIEW_NOTE = 'Deadline of the management review: its date follows the review, its completion the minutes.';
const muted = { color: 'var(--color-neutral-500)' } as const;

/**
 * Programme annuel des audits, visites et revues. Un clic sur un élément ouvre l'audit (fiche, rapport et constats) ;
 * un clic sur une cellule vide l'ajoute (rôles qui saisissent). Une échéance de revue de direction rattachée est
 * verrouillée (« Ouvrir la revue ») ; un élément se reporte (« Reporter… ») ou s'annule avec un motif, jamais supprimé.
 */
export function ProgramTimeline({
  year, curMonth, tracks, allTracks, items, cancelled, findings, certs, auditOptions, yearOptions, canEdit, canCreate = false, options, planOptions, hiddenTracks, renewFrom,
  aside, initialId, closeHref,
}: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(initialId ? { id: initialId } : null);
  const [sub, setSub] = useState<Sub>(null);
  const [deepLink, setDeepLink] = useState(initialId != null);
  const [showCancelled, setShowCancelled] = useState(initialId != null && cancelled.some((c) => c.id === initialId));
  const close = (opts: { keepUrl?: boolean } = {}) => {
    setEditing(null);
    setSub(null);
    if (deepLink) {
      setDeepLink(false);
      if (closeHref && !opts.keepUrl) router.replace(closeHref, { scroll: false });
    }
  };
  const item = editing && 'id' in editing ? items.find((i) => i.id === editing.id) ?? cancelled.find((i) => i.id === editing.id) : undefined;
  const itemFindings = item ? findings.filter((f) => f.planItemId === item.id) : [];
  const trackOptions = [...new Set([...tracks, ...allTracks])];
  const certLabel = (id: string | null) => (id ? certs.find(([v]) => v === id)?.[1] ?? id : null);
  // Fiche en lecture : rôle en consultation, échéance de revue rattachée (verrouillée) ou élément annulé.
  const readOnly = !!item && (!canEdit || item.locked || !!item.cancelled);

  const unplannedNew = !!editing && 'unplanned' in editing;
  const title = item
    ? sub === 'finding' ? `${t('New finding')} · ${item.detail ?? item.label}`
      : sub === 'reschedule' ? `${t('Postpone')} · ${item.detail ?? item.label}`
        : `${item.track} · ${monthName(item.month)}${item.unplanned ? t(' · unplanned') : ''}${item.cancelled ? t(' · cancelled#m') : ''}`
    : unplannedNew ? t('Unplanned audit')
      : editing && 'track' in editing && editing.track ? `${t('New item')} · ${editing.track}` : t('New programme line');

  return (
    <div className="card" style={{ gap: 10 }}>
      <CardHead title={`${t('Annual programme')} ${year}`} aside={(
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
          {aside}
          {/* AUD-26 : programme annuel imprimable (ISO 9001 §9.2.2), lien HTML simple (feuille d'impression dédiée). */}
          <a href={`/audits/imprimer?annee=${year}`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-printer" style={{ fontSize: 13 }} aria-hidden />{t('Print')}</a>
          {canEdit && (
            <>
              <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setEditing({ unplanned: true })}>
                <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />{t('Unplanned audit')}
              </button>
              <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setEditing({ track: null, month: curMonth >= 1 && curMonth <= 12 ? curMonth : 1 })}>
                <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />{t('Add a line')}
              </button>
              <TracksButton year={year} tracks={tracks} items={items} hidden={hiddenTracks} />
              {renewFrom != null && <RenewButton year={year} from={renewFrom} />}
            </>
          )}
        </span>
      )} />
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '150px repeat(12, minmax(56px, 1fr))', gap: 3, minWidth: 820, fontSize: 11 }}>
          <div />
          {MONTHS_SHORT.map((m, i) => (
            <div key={m} style={{ textAlign: 'center', padding: '2px 0 6px', color: i + 1 === curMonth ? 'var(--color-accent)' : 'var(--color-neutral-500)' }}>{m}</div>
          ))}
          {tracks.map((track) => (
            <TrackRow key={track} track={track} items={items.filter((p) => p.track === track)} curMonth={curMonth} canEdit={canEdit}
              onOpen={(month, it) => setEditing(it ? { id: it.id } : { track, month })} />
          ))}
        </div>
      </div>
      {!tracks.length && (
        <div style={{ fontSize: 12, ...muted }}>
          {fill(t('No item in the {year} programme.'), { year })}{canEdit && t(' Add a line (internal audits, safety visits, certification…) to start.')}
        </div>
      )}
      {cancelled.length > 0 && (
        <CancelledList items={cancelled} open={showCancelled} onToggle={() => setShowCancelled((v) => !v)} onOpen={(id) => setEditing({ id })} />
      )}

      <Dialog open={!!editing} onClose={() => close()} kicker={`${t('Annual programme')} ${year}`} width={600} title={title}>
        {editing && item && sub === 'finding' && (
          <FindingForm defaultPlanItemId={item.id} defaultAudit={item.detail ?? item.label} audits={[]} auditOptions={auditOptions}
            onDone={() => setSub(null)} onCancel={() => setSub(null)} />
        )}
        {editing && item && sub === 'reschedule' && (
          <RescheduleForm item={item} yearOptions={yearOptions} onCancel={() => setSub(null)}
            onDone={(to) => {
              if (to !== item.year) {
                setEditing(null);
                setSub(null);
                router.replace(`/audits?annee=${to}&element=${item.id}`, { scroll: false });
              } else close();
            }} />
        )}
        {editing && item && !sub && readOnly && (
          <PlanItemDetail item={item} findings={itemFindings} certLabel={certLabel(item.certificationId)} onLeave={() => close({ keepUrl: true })} />
        )}
        {editing && !sub && (!item || !readOnly) && (
          <>
            <PlanItemForm key={item ? item.id : unplannedNew ? 'unplanned' : 'new'} year={year} item={item} trackOptions={trackOptions} options={planOptions} certs={certs}
              track={'track' in editing ? editing.track : undefined} month={'month' in editing ? editing.month : undefined} unplanned={unplannedNew}
              onReschedule={() => setSub('reschedule')} onDone={() => close()} />
            {item && !item.isReview && (
              <ReportSection item={item} findings={itemFindings} onAddFinding={() => setSub('finding')} onLeave={() => close({ keepUrl: true })} />
            )}
            {item && (
              <DialogFooter>
                {/* Un seul élément d'audit par action, posé à la création : ni rattachement ni détachement ensuite (D15). */}
                {item.actionId ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-neutral-400)' }}>
                    {t('Deadline carried by the action ')}<ActionLink action={item.action} id={item.actionId} />
                  </span>
                ) : canCreate ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <NewActionButton options={options} label={t('Create the follow-up action')} className="btn btn-secondary vg-btn-sm"
                      defaults={planItemActionDefaults(item)} />
                  </span>
                ) : null}
                {item.cancellable && (
                  <ReasonButton action={cancelPlanItem} hidden={{ id: item.id }} label={t('Cancel the item')} icon="ph-prohibit"
                    className="btn btn-ghost vg-btn-sm" style={{ color: 'var(--tone-danger-fg)', marginLeft: 'auto' }}
                    title={t('Cancel the programme item')} kicker={`${item.track} · ${monthLabel(item.month, item.year)}`} submitLabel={t('Cancel the item')}
                    message={t('The item leaves the programme, the deadlines and the review file; it stays viewable in “Cancelled items”.')}
                    placeholder={t('E.g. Process included in the scope of another audit')} onDone={() => close()} />
                )}
              </DialogFooter>
            )}
            {item && <LazyChangeLog entity="audit_plan_item" id={item.id} />}
          </>
        )}
      </Dialog>
    </div>
  );
}

const STATE_STYLE: Record<PlanItemView['state'], { background: string; color: string }> = {
  done: { background: 'var(--color-neutral-900)', color: 'var(--color-neutral-400)' },
  late: { background: `color-mix(in srgb, ${TONE.warn.dot} 16%, transparent)`, color: TONE.warn.dot },
  upcoming: { background: 'var(--color-accent-900)', color: 'var(--color-accent-200)' },
  // Élément annulé (AUD-03) : hors grille ; style de la liste « Éléments annulés ».
  cancelled: { background: 'transparent', color: 'var(--color-neutral-500)' },
};

/** Première planification d'un élément reporté (« septembre 2026 », « 17/09/2026 »). */
const firstPlanned = (iso: string) => (iso.endsWith('-01') ? `${monthName(monthOf(iso))} ${yearOf(iso)}` : fmtDate(iso));

function TrackRow({ track, items, curMonth, canEdit, onOpen }: {
  track: string; items: PlanItemView[]; curMonth: number; canEdit: boolean; onOpen: (month: number, item?: PlanItemView) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div style={{ minHeight: 34, display: 'flex', alignItems: 'center', padding: '0 6px', color: 'var(--color-neutral-300)' }}>{track}</div>
      {MONTHS_SHORT.map((_, i) => {
        const m = i + 1;
        // AUD-21 : plusieurs éléments par ligne et par mois, l'un sous l'autre (date prévue, puis ordre de saisie).
        const list = items.filter((p) => p.month === m).sort((a, b) => (a.plannedOn ?? '').localeCompare(b.plannedOn ?? '') || a.id - b.id);
        const empty: CSSProperties = {
          minHeight: 34, display: 'flex', alignItems: 'center', padding: '0 6px', borderRadius: 4, minWidth: 0,
          background: m === curMonth ? 'color-mix(in srgb, var(--color-accent) 6%, transparent)' : 'transparent', color: 'transparent',
        };
        const addLabel = `${fill(t('Add in {month}'), { month: monthName(m) })} · ${track}`;
        const addButton = (compact: boolean) => (
          <button key="add" type="button" title={addLabel} className={styles.cell}
            style={compact ? { ...empty, minHeight: 24, justifyContent: 'center' } : empty} onClick={() => onOpen(m)}>
            <i className={`ph ph-plus ${styles.plus}`} aria-hidden /><span className="vg-sr-only">{addLabel}</span>
          </button>
        );
        if (!list.length) return canEdit ? <div key={m} style={{ display: 'grid' }}>{addButton(false)}</div> : <div key={m} style={empty} />;
        return (
          <div key={m} style={{ display: 'grid', gap: 2, minWidth: 0 }}>
            {list.map((it) => {
              const style: CSSProperties = { minHeight: list.length > 1 ? 26 : 34, display: 'flex', alignItems: 'center', padding: '0 6px', borderRadius: 4, minWidth: 0, ...STATE_STYLE[it.state] };
              const title = [it.detail ?? it.label, it.unplanned && t('unplanned'), it.plannedOn && !it.unplanned && fill(t('planned on {date}'), { date: fmtDate(it.plannedOn) }),
                it.postponedFrom && fill(t('postponed (initially {date})'), { date: firstPlanned(it.postponedFrom) }), it.owner, it.siteId && it.site,
                it.done ? (it.doneOn ? fill(t('carried out on {date}'), { date: fmtDate(it.doneOn) }) : t('carried out')) : it.state === 'late' && t('to confirm'),
                it.locked && t('management review: open the review')].filter(Boolean).join(' · ');
              return (
                <button key={it.id} type="button" title={title} className={styles.cell} style={style} onClick={() => onOpen(m, it)}>
                  <span style={{ display: 'block', width: '100%', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {it.locked && <><i className="ph ph-lock-simple" style={{ fontSize: 11, marginRight: 3, verticalAlign: '-1px' }} aria-hidden /><span className="vg-sr-only">{t('Management review')}</span></>}
                    {it.done && <><i className="ph ph-check" style={{ fontSize: 11, marginRight: 3, color: TONE.ok.dot, verticalAlign: '-1px' }} aria-hidden /><span className="vg-sr-only">{t('Carried out')}</span></>}
                    {it.state === 'late' && <><i className="ph ph-warning" style={{ fontSize: 11, marginRight: 3, verticalAlign: '-1px' }} aria-hidden /><span className="vg-sr-only">{t('To confirm')}</span></>}
                    {it.unplanned && <span className="vg-sr-only">{t('Unplanned: ')}</span>}
                    {it.label}
                  </span>
                </button>
              );
            })}
            {canEdit && addButton(true)}
          </div>
        );
      })}
    </>
  );
}

/**
 * Gestion des lignes de l'année (AUD-24) : renommer une ligne qui porte des éléments, masquer une ligne reprise de l'année
 * précédente sans élément (motif), afficher à nouveau une ligne masquée (motif). La ligne des revues ne se renomme ni ne se masque.
 */
function TracksButton({ year, tracks, items, hidden }: { year: number; tracks: string[]; items: PlanItemView[]; hidden: string[] }) {
  const { t } = useI18n();
  return (
    <DialogButton label={t('Lines…')} icon="ph-rows" title={fill(t('Lines of the {year} programme'), { year })} kicker={t('Annual programme')} width={560}>
      {(close) => (
        <div style={{ display: 'grid', gap: 10, fontSize: 12.5 }}>
          {tracks.map((tr) => {
            const n = items.filter((p) => p.track === tr).length;
            const review = isReviewPlanItem({ track: tr, label: '', detail: null }) || tr === REVIEW_TRACK;
            return (
              <div key={tr} className="vg-rule-bottom" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <span style={{ fontWeight: 500 }}>{tr}</span>
                <span style={muted}>{n ? fill(n > 1 ? t('{n} items') : t('{n} item'), { n }) : t('taken over from the previous year, no item')}</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                  {!review && n > 0 && (
                    <DialogButton label={t('Rename')} className="btn btn-ghost vg-btn-sm" title={fill(t('Rename “{name}”'), { name: tr })} kicker={`${t('Programme')} ${year}`} width={460}>
                      {(done) => (
                        <ActionForm action={renameTrack} hidden={{ year, from: tr }} submitLabel={t('Rename the line')} onCancel={done} onDone={() => { done(); close(); }}>
                          <Field name="to" label={t('New name')} hint={t('Every item of the line this year takes this name (log of each item).')}>
                            <Input name="to" defaultValue={tr} maxLength={40} autoFocus />
                          </Field>
                        </ActionForm>
                      )}
                    </DialogButton>
                  )}
                  {!review && n === 0 && (
                    <ReasonButton label={t('Hide')} className="btn btn-ghost vg-btn-sm" title={fill(t('Hide “{name}”'), { name: tr })} kicker={`${t('Programme')} ${year}`}
                      action={hideTrack} hidden={{ year, track: tr }} submitLabel={t('Hide the line')}
                      message={fill(t('The line is no longer shown in the {year} programme; the previous years do not change.'), { year })}
                      placeholder={t('E.g. no more supplier audit planned this year')} onDone={close} />
                  )}
                </span>
              </div>
            );
          })}
          {hidden.length > 0 && <span className="card-kicker">{t('Hidden lines')}</span>}
          {hidden.map((tr) => (
            <div key={tr} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--color-neutral-400)' }}>{tr}</span>
              <ReasonButton label={t('Show again')} className="btn btn-ghost vg-btn-sm" style={{ marginLeft: 'auto' }} title={fill(t('Show “{name}”'), { name: tr })} kicker={`${t('Programme')} ${year}`}
                action={showTrack} hidden={{ year, track: tr }} submitLabel={t('Show the line')} placeholder={t('E.g. supplier audit planned after all')} onDone={close} />
            </div>
          ))}
        </div>
      )}
    </DialogButton>
  );
}

/** Reconduction du programme de l'année précédente (AUD-24) : éléments recopiés à réaliser, dates décalées d'un an. */
function RenewButton({ year, from }: { year: number; from: number }) {
  const { t } = useI18n();
  return (
    <DialogButton label={fill(t('Renew {year}'), { year: from })} icon="ph-copy" title={fill(t('Renew the {from} programme into {year}'), { from, year })} kicker={t('Annual programme')} width={500}>
      {(close) => (
        <ActionForm action={renewProgram} hidden={{ year }} submitLabel={t('Renew#programme')} submitIcon="ph-copy" onCancel={close} onDone={close}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
            {fill(t('Each item of the {from} programme (except management reviews and unplanned audits) is copied into {year}, to carry out, in the same month, planned date shifted by one year. An item already present is not copied; each item created is written to its history.'), { from, year })}
          </p>
        </ActionForm>
      )}
    </DialogButton>
  );
}

/** Éléments annulés de l'année (AUD-03) : repliés sous la grille, consultables avec leur motif et leur historique. */
function CancelledList({ items, open, onToggle, onOpen }: { items: PlanItemView[]; open: boolean; onToggle: () => void; onOpen: (id: number) => void }) {
  const { t } = useI18n();
  return (
    <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
      <button type="button" className="vg-text-btn" style={{ justifySelf: 'start', color: 'var(--color-neutral-400)' }} aria-expanded={open} onClick={onToggle}>
        <i className={`ph ${open ? 'ph-caret-down' : 'ph-caret-right'}`} style={{ fontSize: 12 }} aria-hidden /> {fill(t('Cancelled items ({n})'), { n: items.length })}
      </button>
      {open && items.map((p) => (
        <div key={p.id} style={{ display: 'grid', gap: 2, padding: '4px 0 4px 18px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
            <span style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{monthLabel(p.month, p.year)}</span>
            <span style={muted}>{p.track}</span>
            <button type="button" className="vg-text-btn" onClick={() => onOpen(p.id)} style={{ textDecoration: 'line-through', color: 'var(--color-neutral-300)' }}>
              {p.detail ?? p.label}
            </button>
          </div>
          {p.cancelled && (
            <div style={{ ...muted, textWrap: 'pretty' }}>
              {t('Cancelled on#m')} {fmtDate(p.cancelled.on)}{p.cancelled.by ? fill(t(' by {name}'), { name: p.cancelled.by }) : ''}{t(' · Reason: ')}{p.cancelled.reason || '—'}
            </div>
          )}
          <LazyChangeLog entity="audit_plan_item" id={p.id} />
        </div>
      ))}
    </div>
  );
}

function PlanItemForm({ year, item, track, month, unplanned = false, trackOptions, options, certs, onReschedule, onDone }: {
  year: number; item?: PlanItemView; track?: string | null; month?: number; unplanned?: boolean; trackOptions: string[]; options: PlanFormOptions;
  certs: readonly Option[]; onReschedule: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const auditLines = trackOptions.filter((tr) => !isReviewPlanItem({ track: tr, label: '', detail: null }));
  const [trackChoice, setTrackChoice] = useState(item?.track ?? track ?? (unplanned ? auditLines[0] ?? NEW_TRACK : NEW_TRACK));
  const [newTrack, setNewTrack] = useState('');
  const [label, setLabel] = useState(item?.label ?? '');
  const [detail, setDetail] = useState(item?.detail ?? '');
  const [fileError, setFileError] = useState<string | null>(null);
  const isNew = trackChoice === NEW_TRACK;
  const outOfPlan = unplanned || !!item?.unplanned;
  // Même règle que le serveur et les chargements : ligne des revues, ou libellé / intitulé « revue de direction ».
  const review = isReviewPlanItem({ track: isNew ? newTrack : trackChoice, label, detail });
  // Responsable ou auditeur sorti de l'effectif : gardés dans la liste (withCurrent), jamais proposés pour un nouveau choix.
  const owners = withCurrent(options.people, item?.ownerId, `${item?.owner || item?.ownerId} — sorti de l'effectif`);
  const auditors = withCurrent(options.people, item?.auditorId, `${item?.auditorName || item?.auditorId} — sorti de l'effectif`);
  // AUD-22 : site de l'élément ; site absent de la liste (archivé, autre site) gardé à la modification.
  const sites = item ? withCurrent(options.sites, item.siteId ?? ALL_SITES_VALUE, item.site) : options.sites;
  const lines = outOfPlan ? auditLines : trackOptions;
  return (
    <ActionForm action={savePlanItem} onDone={onDone} onCancel={onDone} submitLabel={item ? t('Save') : unplanned ? t('Save the audit') : t('Add to the programme')}
      hidden={{ id: item?.id, version: item?.version, year: item || unplanned ? undefined : year, unplanned: unplanned ? '1' : undefined }} encType="multipart/form-data">
      {outOfPlan && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
          <i className="ph ph-info" style={{ fontSize: 13, marginRight: 4, verticalAlign: '-2px' }} aria-hidden />
          {t('Unplanned audit (customer audit, unannounced…): recorded as carried out on its date, with its auditor, its report and its findings; outside the programme deadlines.')}
        </p>
      )}
      {review && !outOfPlan && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
          <i className="ph ph-info" style={{ fontSize: 13, marginRight: 4, verticalAlign: '-2px' }} aria-hidden />
          {t('Plan the review from the Management review card: it will take over this item.')}
        </p>
      )}
      {item || outOfPlan ? (
        <>
          <Field name="track" label={t('Programme line')}>
            <Select name="track" value={trackChoice} onChange={(e) => setTrackChoice(e.target.value)}
              options={[...lines.map((tr) => [tr, tr] as const), [NEW_TRACK, t('New line…')] as const]} />
          </Field>
          {item && !item.unplanned && <Planning item={item} onReschedule={onReschedule} />}
        </>
      ) : (
        <FormRow>
          <Field name="track" label={t('Programme line')}>
            <Select name="track" value={trackChoice} onChange={(e) => setTrackChoice(e.target.value)}
              options={[...trackOptions.map((tr) => [tr, tr] as const), [NEW_TRACK, t('New line…')] as const]} />
          </Field>
          <Field name="month" label={t('Month')}>
            <Select name="month" options={MONTH_OPTIONS} defaultValue={String(month ?? 1)} />
          </Field>
        </FormRow>
      )}
      {isNew && (
        <Field name="newTrack" label={t('Name of the new line')} hint={t('E.g. Supplier audits, Evacuation drills, Product audits.')}>
          <Input name="newTrack" autoFocus onChange={(e) => setNewTrack(e.target.value)} />
        </Field>
      )}
      <FormRow>
        <Field name="label" label={t('Short label')} hint={t('Shown in the cell (30 characters at most).')}>
          <Input name="label" defaultValue={item?.label} maxLength={30} placeholder={outOfPlan ? t('E.g. Customer [Client A]') : t('E.g. Design office · 17/10')} autoFocus={!isNew} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        {!item && !outOfPlan && (
          <Field name="plannedOn" label={t('Planned date')} hint={t('Taken into the deadlines at 15 days.')}>
            <Input name="plannedOn" type="date" />
          </Field>
        )}
        {outOfPlan && (
          <Field name="doneOn" label={t('Carried out on')} hint={t('Sets the month of the audit in the programme.')}>
            <Input name="doneOn" type="date" defaultValue={item?.doneOn ?? ''} />
          </Field>
        )}
      </FormRow>
      <Field name="detail" label={t('Detailed title')} hint={outOfPlan ? t('E.g. Customer audit [Client A] — supplier quality requirements.') : t('E.g. Design office process, ISO 9001 surveillance audit.')}>
        <Input name="detail" defaultValue={item?.detail ?? ''} onChange={(e) => setDetail(e.target.value)} />
      </Field>
      {!review && (
        // D08-5 : type d'audit (la revue de direction est reconnue par ses mots, jamais choisie ici).
        <Field name="auditKind" label={t('Audit type')}>
          <Select name="auditKind" options={CHOOSABLE_AUDIT_KINDS.map((k) => [k, labelT(t)(AUDIT_KINDS[k].label)] as const)}
            defaultValue={item && item.auditKind !== 'revue_direction' ? item.auditKind : inferAuditKind({ track: isNew ? newTrack : trackChoice, label, detail })} />
        </Field>
      )}
      <FormRow>
        <Field name="ownerId" label={t('Owner')}>
          <Select name="ownerId" options={owners} defaultValue={item?.ownerId ?? ''} placeholder={t('Not appointed')} />
        </Field>
        <Field name="certificationId" label={t('Standard')} hint={t('Certification or surveillance audit.')}>
          <Select name="certificationId" options={certs} defaultValue={item?.certificationId ?? ''} placeholder={t('None#m')} />
        </Field>
      </FormRow>
      {!review && (
        <>
          <FormRow>
            <Field name="auditorId" label={t('Internal auditor')} hint={t('Person of the directory (auditor qualification checked against the “internal auditor” titles).')}>
              <Select name="auditorId" options={auditors} defaultValue={item?.auditorId ?? ''} placeholder={t('None#m')} />
            </Field>
            <Field name="auditor" label={t('External auditor')} hint={t('Body or auditor outside the directory.')}>
              <Input name="auditor" defaultValue={item?.auditor ?? ''} maxLength={120} />
            </Field>
          </FormRow>
          <FormRow>
            <Field name="scope" label={t('Scope')}>
              <Input name="scope" defaultValue={item?.scope ?? ''} maxLength={200} />
            </Field>
            <Field name="siteId" label={t('Site')} hint={t('Audited site; “All sites”: audit shared by the company.')}>
              <Select name="siteId" options={sites} defaultValue={item ? item.siteId ?? ALL_SITES_VALUE : offeredOr(sites, ALL_SITES_VALUE, sites[0]?.[0] ?? '') ?? ''} />
            </Field>
          </FormRow>
        </>
      )}
      {!outOfPlan && (
        <FormRow>
          <Field name="done" group label={t('State')}>
            <div style={{ minHeight: 34, display: 'flex', alignItems: 'center' }}>
              <Checkbox name="done" label={t('Carried out')} defaultChecked={item?.done} />
            </div>
          </Field>
          <Field name="doneOn" label={t('Carried out on')} hint={t('By default, the planned date if it is past.')}>
            <Input name="doneOn" type="date" defaultValue={item?.doneOn ?? ''} />
          </Field>
        </FormRow>
      )}
      {!review && (
        <>
          <Field name="report" label={t('Audit report')} hint={filesHint(t)}>
            <Input name="report" type="file" multiple accept={ATTACH_ACCEPT} onChange={(e) => setFileError(checkPickedFiles(e.currentTarget))} />
          </Field>
          <FileError error={fileError} />
        </>
      )}
    </ActionForm>
  );
}

/** Valeur du choix « Tous les sites » (élément commun à l'entreprise), identique à ALL_SITES de src/lib/domain.ts. */
const ALL_SITES_VALUE = 'all';

/** Planification d'un élément existant, en lecture : elle ne change que par « Reporter… » (motif obligatoire, AUD-03). */
function Planning({ item, onReschedule }: { item: PlanItemView; onReschedule?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="field">
      <label>{t('Planning')}</label>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 12px', minHeight: 34, fontSize: 12.5 }}>
        <span>
          {monthLabel(item.month, item.year)}
          {item.plannedOn ? fill(t(' · on {date}'), { date: fmtDate(item.plannedOn) }) : t(' · date to specify')}
        </span>
        {item.postponedFrom && <span style={muted}>{fill(item.postponedFrom.endsWith('-01') ? t('initially planned in {date}') : t('initially planned on {date}'), { date: firstPlanned(item.postponedFrom) })}</span>}
        {onReschedule && item.reschedulable && (
          <button type="button" className="btn btn-ghost vg-btn-sm" style={{ marginLeft: 'auto' }} onClick={onReschedule}>
            <i className="ph ph-calendar-blank" style={{ fontSize: 13 }} aria-hidden />{t('Postpone…')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Report d'un élément du programme : nouvelle année, mois et date prévue, motif obligatoire (AUD-03). */
function RescheduleForm({ item, yearOptions, onDone, onCancel }: { item: PlanItemView; yearOptions: number[]; onDone: (year: number) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [year, setYear] = useState(item.year);
  const years = [...new Set([...yearOptions, item.year, item.year + 1])].sort((a, b) => a - b).map((y) => [String(y), String(y)] as const);
  return (
    <ReasonForm action={reschedulePlanItem} hidden={{ id: item.id }} onDone={() => onDone(year)} onCancel={onCancel} submitLabel={t('Postpone the item')} submitIcon="ph-calendar-blank"
      message={<>
        {fill(t('Planned in {month}'), { month: monthLabel(item.month, item.year) })}{item.plannedOn ? fill(t(', on {date}'), { date: fmtDate(item.plannedOn) }) : ''}.
        {item.postponedFrom && fill(t(' First planning kept: {date}.'), { date: firstPlanned(item.postponedFrom) })}
        {item.actionId && fill(t(' The carrying action {id} keeps its deadline: postpone it if needed from the action plan.'), { id: item.actionId })}
      </>}
      hint={item.actionId ? t('Required, kept in the history; the carrying action keeps its deadline.') : t('Required, kept in the history of the item.')}
      placeholder={t('E.g. Auditor unavailable, audit grouped')}
      before={(
        <FormRow cols={3}>
          <Field name="year" label={t('Year')}>
            <Select name="year" options={years} value={String(year)} onChange={(e) => setYear(+e.target.value)} />
          </Field>
          <Field name="month" label={t('Month')}>
            <Select name="month" options={MONTH_OPTIONS} defaultValue={String(item.month)} />
          </Field>
          <Field name="plannedOn" label={t('Planned date')} hint={t('In the chosen month.')}>
            <Input name="plannedOn" type="date" defaultValue={item.plannedOn ?? ''} />
          </Field>
        </FormRow>
      )} />
  );
}

/** Rapport(s) et constats d'un audit du programme, sous le formulaire (saisie). */
function ReportSection({ item, findings, onAddFinding, onLeave }: { item: PlanItemView; findings: FindingView[]; onAddFinding: () => void; onLeave: () => void }) {
  const { t } = useI18n();
  return (
    <div className={styles.footer} style={{ display: 'grid', gap: 8 }}>
      <span className="card-kicker">{t('Report and findings')}</span>
      {item.reports.length ? <FileList files={item.reports} onRemove={removePlanItemReport} /> : (
        <span style={muted}>{t('No report attached.#audit')}</span>
      )}
      <FindingList findings={findings} year={item.year} onLeave={onLeave} />
      <ReportPdfLink item={item} />
      {/* AUD-11 : un constat suit la réalisation de l'audit. */}
      {item.done ? (
        <button type="button" className="btn btn-secondary vg-btn-sm" style={{ justifySelf: 'start' }} onClick={onAddFinding}>
          <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />{t('Add a finding')}
        </button>
      ) : <span style={muted}>{t('Declare the audit carried out to enter its findings.')}</span>}
    </div>
  );
}

/**
 * AUD-39 : rapport d'audit en PDF (élément, constats et actions), téléchargeable une fois l'audit réalisé ; lien simple
 * (téléchargement, pas de navigation de l'application).
 */
function ReportPdfLink({ item }: { item: PlanItemView }) {
  const { t } = useI18n();
  if (!auditReportAvailable(item)) return null;
  return (
    <a href={auditReportHref(item.id)} download className="btn btn-secondary vg-btn-sm" style={{ justifySelf: 'start' }}>
      <i className="ph ph-file-pdf" style={{ fontSize: 13 }} aria-hidden />{t('Download the audit report (PDF)')}
    </a>
  );
}

function FindingList({ findings, year, onLeave }: { findings: FindingView[]; year: number; onLeave: () => void }) {
  const { t } = useI18n();
  if (!findings.length) return <span style={muted}>{t('No finding linked.')}</span>;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {findings.map((f) => {
        const k = FINDING_KINDS[f.kind] ?? { label: f.kind, tone: 'neutral' as const };
        return (
          <div key={f.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 8, alignItems: 'start' }}>
            <ToneTag tone={k.tone} style={{ whiteSpace: 'nowrap' }}>{k.label}</ToneTag>
            <span style={{ textWrap: 'pretty' }}>
              {f.clause && <span style={{ color: 'var(--color-neutral-400)', marginRight: 6 }}>{f.clause}</span>}
              {f.text}
            </span>
            <span style={{ whiteSpace: 'nowrap' }}><ActionLinks actions={f.actions} compact /></span>
          </div>
        );
      })}
      <Link href={`/audits?annee=${year}&constat=${findings[0].id}`} scroll={false} className="vg-link" style={{ justifySelf: 'start' }} onClick={onLeave}>
        {t('See in the findings')}
      </Link>
    </div>
  );
}

/**
 * Fiche en lecture seule d'un élément du programme : rôles qui consultent sans saisir, échéance d'une revue de direction
 * rattachée (verrouillée : « Ouvrir la revue »), élément annulé.
 */
function PlanItemDetail({ item, findings, certLabel, onLeave }: { item: PlanItemView; findings: FindingView[]; certLabel: string | null; onLeave: () => void }) {
  const { t } = useI18n();
  const st = PLAN_ITEM_STATES[item.state];
  const rows: [string, ReactNode][] = [
    [t('Nature'), item.kind],
    [t('Audit type'), AUDIT_KINDS[item.auditKind]?.label ?? item.auditKind],
    [t('State'), <ToneTag key="s" tone={st.tone}>{st.label}</ToneTag>],
    [t('Planned date'), item.plannedOn ? fmtDate(item.plannedOn) : monthLabel(item.month, item.year)],
    ...(item.postponedFrom ? [[t('Initially'), firstPlanned(item.postponedFrom)] as [string, ReactNode]] : []),
    ...(item.done ? [[t('Carried out on'), item.doneOn ? fmtDate(item.doneOn) : '—'] as [string, ReactNode]] : []),
    ...(item.cancelled ? [
      [t('Cancelled on#m'), `${fmtDate(item.cancelled.on)}${item.cancelled.by ? fill(t(' by {name}'), { name: item.cancelled.by }) : ''}`],
      [t('Reason'), item.cancelled.reason || '—'],
    ] as [string, ReactNode][] : []),
    [t('Owner'), item.owner || '—'],
    ...(item.isReview ? [] : [
      [t('Auditor'), <span key="au">{item.auditorLabel || '—'}{item.auditorUnqualified && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--tone-warn-fg)' }}>{t('No valid internal auditor title on the date of the audit')}</span>}</span>],
      [t('Scope'), item.scope || '—'],
      [t('Site'), item.site],
    ] as [string, ReactNode][]),
    ...(item.unplanned ? [[t('Programme'), t('Unplanned audit')] as [string, ReactNode]] : []),
    ...(certLabel ? [[t('Standard'), certLabel] as [string, ReactNode]] : []),
    ...(item.review ? [[t('Review#management'), <ToneTag key="r" tone={item.review.statusTone}>{item.review.statusLabel}</ToneTag>] as [string, ReactNode]] : []),
    [t('Action'), item.actionId ? <ActionLink key="a" action={item.action} id={item.actionId} /> : '—'],
  ];
  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 12.5 }}>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{item.detail ?? item.label}</div>
      {item.locked && <p style={{ margin: 0, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>{t(REVIEW_NOTE)}</p>}
      <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', margin: 0 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt style={muted}>{k}</dt>
            <dd style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      {item.review && (
        <Link href={item.review.href} className="btn btn-primary vg-btn-sm" style={{ justifySelf: 'start' }} onClick={onLeave}>
          <i className="ph ph-arrow-square-out" style={{ fontSize: 13 }} aria-hidden />{t('Open the review')}
        </Link>
      )}
      {!item.isReview && (
        <div className={styles.footer} style={{ display: 'grid', gap: 8 }}>
          <span className="card-kicker">{t('Report and findings')}</span>
          {item.reports.length ? <FileList files={item.reports} /> : <span style={muted}>{t('No report attached.#audit')}</span>}
          <FindingList findings={findings} year={item.year} onLeave={onLeave} />
          <ReportPdfLink item={item} />
        </div>
      )}
      <LazyChangeLog entity="audit_plan_item" id={item.id} />
    </div>
  );
}
