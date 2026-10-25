'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { NewActionButton } from '@/components/ActionFormDialog';
import { ChangeLogList } from '@/components/ChangeLog';
import { Dialog } from '@/components/Dialog';
import { ReasonButton, ReasonForm } from '@/components/ReasonDialog';
import { ActionForm, Checkbox, Field, FormRow, Input, Select } from '@/components/form';
import { CardHead, ToneTag } from '@/components/ui';
import { FILES_HINT, FileError, checkPickedFiles } from '@/components/watch/parts';
import { ATTACH_ACCEPT } from '@/lib/attachments';
import { MONTHS_SHORT, addDays, fmtDate, monthName, monthOf, yearOf } from '@/lib/dates';
import { FINDING_KINDS, PLAN_ITEM_STATES, TONE } from '@/lib/domain';
import type { FindingView, PlanItemView } from '@/lib/data/audits';
import type { Option } from '@/lib/data/options';
import type { ActionDefaults, ActionFormOptions } from '@/lib/action-view';
import { cancelPlanItem, removePlanItemReport, reschedulePlanItem, savePlanItem } from '@/server/audits';
import { FindingForm } from './FindingsCard';
import { ActionLink, ActionLinks, DialogFooter, FileList } from './parts';
import { MONTH_OPTIONS, NEW_TRACK, auditActionSource, isReviewPlanItem, monthLabel } from './shared';
import styles from './audits.module.css';

type Opts = ActionFormOptions;

/**
 * Valeurs proposées pour l'action de suivi d'un élément du programme (ACT-28) : source selon la ligne (auditActionSource ;
 * « Revues de direction » → Revue de direction), élément lié (D15 : posé à la création seulement), problème = intitulé de
 * l'élément, responsable de l'élément, date cible = date prévue (vérification proposée 30 jours après) ; site choisi par le
 * service QHSE.
 */
export function planItemActionDefaults(item: Pick<PlanItemView, 'id' | 'track' | 'label' | 'detail' | 'year' | 'month' | 'ownerId' | 'plannedOn'>): ActionDefaults {
  return {
    ...auditActionSource('plan', item.track), link: `plan:${item.id}`, linkLabel: `${item.track} · ${item.detail ?? item.label}`,
    originRef: `Programme ${item.year} · ${item.detail ?? item.label}`.slice(0, 120), problem: item.detail ?? item.label,
    pilotId: item.ownerId ?? undefined, dueOn: item.plannedOn ?? undefined, verifyDueOn: item.plannedOn ? addDays(item.plannedOn, 30) : undefined,
  };
}
/** Élément ouvert : existant (id) ou à créer (ligne + mois ; ligne null = nouvelle ligne). */
type Editing = { id: number } | { track: string | null; month: number } | null;
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
  aside?: ReactNode;
  /** Élément à ouvrir d'emblée (lien profond `?element=<id>`). */
  initialId?: number;
  /** URL sans le lien profond, rétablie à la fermeture. */
  closeHref?: string;
};

const REVIEW_NOTE = 'Échéance de la revue de direction : sa date suit la revue, sa réalisation le compte rendu.';
const muted = { color: 'var(--color-neutral-500)' } as const;

/**
 * Programme annuel des audits, visites et revues. Un clic sur un élément ouvre l'audit (fiche, rapport et constats) ;
 * un clic sur une cellule vide l'ajoute (rôles qui saisissent). Une échéance de revue de direction rattachée est
 * verrouillée (« Ouvrir la revue ») ; un élément se reporte (« Reporter… ») ou s'annule avec un motif, jamais supprimé.
 */
export function ProgramTimeline({
  year, curMonth, tracks, allTracks, items, cancelled, findings, certs, auditOptions, yearOptions, canEdit, canCreate = false, options, aside, initialId, closeHref,
}: Props) {
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

  const title = item
    ? sub === 'finding' ? `Nouveau constat · ${item.detail ?? item.label}`
      : sub === 'reschedule' ? `Reporter · ${item.detail ?? item.label}`
        : `${item.track} · ${monthName(item.month)}${item.cancelled ? ' · annulé' : ''}`
    : editing && 'track' in editing && editing.track ? `Nouvel élément · ${editing.track}` : 'Nouvelle ligne du programme';

  return (
    <div className="card" style={{ gap: 10 }}>
      <CardHead title={`Programme annuel ${year}`} aside={(
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
          {aside}
          {canEdit && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setEditing({ track: null, month: curMonth >= 1 && curMonth <= 12 ? curMonth : 1 })}>
              <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />Ajouter une ligne
            </button>
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
          Aucun élément au programme {year}.{canEdit && ' Ajoutez une ligne (audits internes, visites sécurité, certification…) pour commencer.'}
        </div>
      )}
      {cancelled.length > 0 && (
        <CancelledList items={cancelled} open={showCancelled} onToggle={() => setShowCancelled((v) => !v)} onOpen={(id) => setEditing({ id })} />
      )}

      <Dialog open={!!editing} onClose={() => close()} kicker={`Programme annuel ${year}`} width={600} title={title}>
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
            <PlanItemForm key={item ? item.id : 'new'} year={year} item={item} trackOptions={trackOptions} people={options.people} certs={certs}
              track={'track' in editing ? editing.track : undefined} month={'month' in editing ? editing.month : undefined}
              onReschedule={() => setSub('reschedule')} onDone={() => close()} />
            {item && !item.isReview && (
              <ReportSection item={item} findings={itemFindings} onAddFinding={() => setSub('finding')} onLeave={() => close({ keepUrl: true })} />
            )}
            {item && (
              <DialogFooter>
                {/* Un seul élément d'audit par action, posé à la création : ni rattachement ni détachement ensuite (D15). */}
                {item.actionId ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-neutral-400)' }}>
                    Échéance portée par l&apos;action <ActionLink action={item.action} id={item.actionId} />
                  </span>
                ) : canCreate ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <NewActionButton options={options} label="Créer l'action de suivi" className="btn btn-secondary vg-btn-sm"
                      defaults={planItemActionDefaults(item)} />
                  </span>
                ) : null}
                {item.cancellable && (
                  <ReasonButton action={cancelPlanItem} hidden={{ id: item.id }} label="Annuler l'élément" icon="ph-prohibit"
                    className="btn btn-ghost vg-btn-sm" style={{ color: 'var(--tone-danger-fg)', marginLeft: 'auto' }}
                    title="Annuler l'élément du programme" kicker={`${item.track} · ${monthLabel(item.month, item.year)}`} submitLabel="Annuler l'élément"
                    message="L'élément sort du programme, des échéances et du dossier de revue ; il reste consultable dans « Éléments annulés »."
                    placeholder="Ex. Processus intégré au périmètre d'un autre audit" onDone={() => close()} />
                )}
              </DialogFooter>
            )}
            {item && <ChangeLogList entries={item.log} />}
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
  return (
    <>
      <div style={{ minHeight: 34, display: 'flex', alignItems: 'center', padding: '0 6px', color: 'var(--color-neutral-300)' }}>{track}</div>
      {MONTHS_SHORT.map((_, i) => {
        const m = i + 1;
        const it = items.find((p) => p.month === m);
        const style: CSSProperties = {
          minHeight: 34, display: 'flex', alignItems: 'center', padding: '0 6px', borderRadius: 4, minWidth: 0,
          ...(it ? STATE_STYLE[it.state] : { background: m === curMonth ? 'color-mix(in srgb, var(--color-accent) 6%, transparent)' : 'transparent', color: 'transparent' }),
        };
        const title = it
          ? [it.detail ?? it.label, it.plannedOn && `prévu le ${fmtDate(it.plannedOn)}`, it.postponedFrom && `reporté (initialement ${firstPlanned(it.postponedFrom)})`, it.owner,
            it.done ? (it.doneOn ? `réalisé le ${fmtDate(it.doneOn)}` : 'réalisé') : it.state === 'late' && 'à confirmer',
            it.locked && 'revue de direction : ouvrir la revue'].filter(Boolean).join(' · ')
          : canEdit ? `Ajouter en ${monthName(m)} · ${track}` : undefined;
        const content = it && (
          <span style={{ display: 'block', width: '100%', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {it.locked && <><i className="ph ph-lock-simple" style={{ fontSize: 11, marginRight: 3, verticalAlign: '-1px' }} aria-hidden /><span className="vg-sr-only">Revue de direction</span></>}
            {it.done && <><i className="ph ph-check" style={{ fontSize: 11, marginRight: 3, color: TONE.ok.dot, verticalAlign: '-1px' }} aria-hidden /><span className="vg-sr-only">Réalisé</span></>}
            {it.state === 'late' && <><i className="ph ph-warning" style={{ fontSize: 11, marginRight: 3, verticalAlign: '-1px' }} aria-hidden /><span className="vg-sr-only">À confirmer</span></>}
            {it.label}
          </span>
        );
        // Élément : ouvert par tous (fiche en lecture seule hors saisie) ; cellule vide : ajout réservé à la saisie.
        if (!it && !canEdit) return <div key={m} style={style} />;
        return (
          <button key={m} type="button" title={title} className={styles.cell} style={style} onClick={() => onOpen(m, it)}>
            {content ?? <i className={`ph ph-plus ${styles.plus}`} aria-hidden />}
          </button>
        );
      })}
    </>
  );
}

/** Éléments annulés de l'année (AUD-03) : repliés sous la grille, consultables avec leur motif et leur historique. */
function CancelledList({ items, open, onToggle, onOpen }: { items: PlanItemView[]; open: boolean; onToggle: () => void; onOpen: (id: number) => void }) {
  return (
    <div style={{ display: 'grid', gap: 6, fontSize: 12 }}>
      <button type="button" className="vg-text-btn" style={{ justifySelf: 'start', color: 'var(--color-neutral-400)' }} aria-expanded={open} onClick={onToggle}>
        <i className={`ph ${open ? 'ph-caret-down' : 'ph-caret-right'}`} style={{ fontSize: 12 }} aria-hidden /> Éléments annulés ({items.length})
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
              Annulé le {fmtDate(p.cancelled.on)}{p.cancelled.by ? ` par ${p.cancelled.by}` : ''} · Motif : {p.cancelled.reason || '—'}
            </div>
          )}
          <ChangeLogList entries={p.log} />
        </div>
      ))}
    </div>
  );
}

function PlanItemForm({ year, item, track, month, trackOptions, people, certs, onReschedule, onDone }: {
  year: number; item?: PlanItemView; track?: string | null; month?: number; trackOptions: string[]; people: Opts['people']; certs: readonly Option[];
  onReschedule: () => void; onDone: () => void;
}) {
  const [trackChoice, setTrackChoice] = useState(item?.track ?? track ?? NEW_TRACK);
  const [newTrack, setNewTrack] = useState('');
  const [label, setLabel] = useState(item?.label ?? '');
  const [detail, setDetail] = useState(item?.detail ?? '');
  const [fileError, setFileError] = useState<string | null>(null);
  const isNew = trackChoice === NEW_TRACK;
  // Même règle que le serveur et les chargements : ligne des revues, ou libellé / intitulé « revue de direction ».
  const review = isReviewPlanItem({ track: isNew ? newTrack : trackChoice, label, detail });
  // Responsable sorti de l'effectif : gardé dans la liste, sinon l'enregistrement l'effacerait sans le dire.
  const owners = item?.ownerId && !people.some(([v]) => v === item.ownerId)
    ? [...people, [item.ownerId, `${item.owner || item.ownerId} — sorti de l'effectif`] as const]
    : people;
  return (
    <ActionForm action={savePlanItem} onDone={onDone} onCancel={onDone} submitLabel={item ? 'Enregistrer' : 'Ajouter au programme'}
      hidden={{ id: item?.id, year: item ? undefined : year }} encType="multipart/form-data">
      {review && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
          <i className="ph ph-info" style={{ fontSize: 13, marginRight: 4, verticalAlign: '-2px' }} aria-hidden />
          Planifiez la revue depuis la carte Revue de direction : elle reprendra cet élément.
        </p>
      )}
      {item ? (
        <>
          <Field name="track" label="Ligne du programme">
            <Select name="track" value={trackChoice} onChange={(e) => setTrackChoice(e.target.value)}
              options={[...trackOptions.map((t) => [t, t] as const), [NEW_TRACK, 'Nouvelle ligne…'] as const]} />
          </Field>
          <Planning item={item} onReschedule={onReschedule} />
        </>
      ) : (
        <FormRow>
          <Field name="track" label="Ligne du programme">
            <Select name="track" value={trackChoice} onChange={(e) => setTrackChoice(e.target.value)}
              options={[...trackOptions.map((t) => [t, t] as const), [NEW_TRACK, 'Nouvelle ligne…'] as const]} />
          </Field>
          <Field name="month" label="Mois">
            <Select name="month" options={MONTH_OPTIONS} defaultValue={String(month ?? 1)} />
          </Field>
        </FormRow>
      )}
      {isNew && (
        <Field name="newTrack" label="Nom de la nouvelle ligne" hint="Ex. Audits fournisseurs, Exercices d'évacuation, Audits produit.">
          <Input name="newTrack" autoFocus onChange={(e) => setNewTrack(e.target.value)} />
        </Field>
      )}
      <FormRow>
        <Field name="label" label="Libellé court" hint="Affiché dans la cellule (30 caractères au maximum).">
          <Input name="label" defaultValue={item?.label} maxLength={30} placeholder="Ex. BE · 17/10" autoFocus={!isNew} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        {!item && (
          <Field name="plannedOn" label="Date prévue" hint="Reprise dans les échéances à 15 jours.">
            <Input name="plannedOn" type="date" />
          </Field>
        )}
      </FormRow>
      <Field name="detail" label="Intitulé détaillé" hint="Ex. Processus Conception BE, Audit de suivi ISO 9001.">
        <Input name="detail" defaultValue={item?.detail ?? ''} onChange={(e) => setDetail(e.target.value)} />
      </Field>
      <FormRow>
        <Field name="ownerId" label="Responsable">
          <Select name="ownerId" options={owners} defaultValue={item?.ownerId ?? ''} placeholder="Non désigné" />
        </Field>
        <Field name="certificationId" label="Référentiel" hint="Audit de certification ou de suivi.">
          <Select name="certificationId" options={certs} defaultValue={item?.certificationId ?? ''} placeholder="Aucun" />
        </Field>
      </FormRow>
      {!review && (
        <FormRow>
          <Field name="auditor" label="Auditeur" hint="Interne ou organisme.">
            <Input name="auditor" defaultValue={item?.auditor ?? ''} maxLength={120} />
          </Field>
          <Field name="scope" label="Périmètre">
            <Input name="scope" defaultValue={item?.scope ?? ''} maxLength={200} />
          </Field>
        </FormRow>
      )}
      <FormRow>
        <Field name="done" group label="État">
          <div style={{ minHeight: 34, display: 'flex', alignItems: 'center' }}>
            <Checkbox name="done" label="Réalisé" defaultChecked={item?.done} />
          </div>
        </Field>
        <Field name="doneOn" label="Réalisé le" hint="Par défaut, la date prévue si elle est passée.">
          <Input name="doneOn" type="date" defaultValue={item?.doneOn ?? ''} />
        </Field>
      </FormRow>
      {!review && (
        <>
          <Field name="report" label="Rapport d'audit" hint={FILES_HINT}>
            <Input name="report" type="file" multiple accept={ATTACH_ACCEPT} onChange={(e) => setFileError(checkPickedFiles(e.currentTarget))} />
          </Field>
          <FileError error={fileError} />
        </>
      )}
    </ActionForm>
  );
}

/** Planification d'un élément existant, en lecture : elle ne change que par « Reporter… » (motif obligatoire, AUD-03). */
function Planning({ item, onReschedule }: { item: PlanItemView; onReschedule?: () => void }) {
  return (
    <div className="field">
      <label>Planification</label>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 12px', minHeight: 34, fontSize: 12.5 }}>
        <span>
          {monthLabel(item.month, item.year)}
          {item.plannedOn ? ` · le ${fmtDate(item.plannedOn)}` : ' · date à préciser'}
        </span>
        {item.postponedFrom && <span style={muted}>initialement prévu {item.postponedFrom.endsWith('-01') ? 'en' : 'le'} {firstPlanned(item.postponedFrom)}</span>}
        {onReschedule && item.reschedulable && (
          <button type="button" className="btn btn-ghost vg-btn-sm" style={{ marginLeft: 'auto' }} onClick={onReschedule}>
            <i className="ph ph-calendar-blank" style={{ fontSize: 13 }} aria-hidden />Reporter…
          </button>
        )}
      </div>
    </div>
  );
}

/** Report d'un élément du programme : nouvelle année, mois et date prévue, motif obligatoire (AUD-03). */
function RescheduleForm({ item, yearOptions, onDone, onCancel }: { item: PlanItemView; yearOptions: number[]; onDone: (year: number) => void; onCancel: () => void }) {
  const [year, setYear] = useState(item.year);
  const years = [...new Set([...yearOptions, item.year, item.year + 1])].sort((a, b) => a - b).map((y) => [String(y), String(y)] as const);
  return (
    <ReasonForm action={reschedulePlanItem} hidden={{ id: item.id }} onDone={() => onDone(year)} onCancel={onCancel} submitLabel="Reporter l'élément" submitIcon="ph-calendar-blank"
      message={<>
        Prévu en {monthLabel(item.month, item.year)}{item.plannedOn ? `, le ${fmtDate(item.plannedOn)}` : ''}.
        {item.postponedFrom && ` Première planification conservée : ${firstPlanned(item.postponedFrom)}.`}
        {item.actionId && ` L'action porteuse ${item.actionId} garde son échéance : reportez-la au besoin depuis le plan d'actions.`}
      </>}
      hint={item.actionId ? "Obligatoire, conservé dans l'historique ; l'action porteuse garde son échéance." : "Obligatoire, conservé dans l'historique de l'élément."}
      placeholder="Ex. Indisponibilité de l'auditeur, audit regroupé"
      before={(
        <FormRow cols={3}>
          <Field name="year" label="Année">
            <Select name="year" options={years} value={String(year)} onChange={(e) => setYear(+e.target.value)} />
          </Field>
          <Field name="month" label="Mois">
            <Select name="month" options={MONTH_OPTIONS} defaultValue={String(item.month)} />
          </Field>
          <Field name="plannedOn" label="Date prévue" hint="Dans le mois choisi.">
            <Input name="plannedOn" type="date" defaultValue={item.plannedOn ?? ''} />
          </Field>
        </FormRow>
      )} />
  );
}

/** Rapport(s) et constats d'un audit du programme, sous le formulaire (saisie). */
function ReportSection({ item, findings, onAddFinding, onLeave }: { item: PlanItemView; findings: FindingView[]; onAddFinding: () => void; onLeave: () => void }) {
  return (
    <div className={styles.footer} style={{ display: 'grid', gap: 8 }}>
      <span className="card-kicker">Rapport et constats</span>
      {item.reports.length ? <FileList files={item.reports} onRemove={removePlanItemReport} /> : (
        <span style={muted}>Aucun rapport joint.</span>
      )}
      <FindingList findings={findings} year={item.year} onLeave={onLeave} />
      {/* AUD-11 : un constat suit la réalisation de l'audit. */}
      {item.done ? (
        <button type="button" className="btn btn-secondary vg-btn-sm" style={{ justifySelf: 'start' }} onClick={onAddFinding}>
          <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />Ajouter un constat
        </button>
      ) : <span style={muted}>Déclarez l&apos;audit réalisé pour saisir ses constats.</span>}
    </div>
  );
}

function FindingList({ findings, year, onLeave }: { findings: FindingView[]; year: number; onLeave: () => void }) {
  if (!findings.length) return <span style={muted}>Aucun constat rattaché.</span>;
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
        Voir dans les constats
      </Link>
    </div>
  );
}

/**
 * Fiche en lecture seule d'un élément du programme : rôles qui consultent sans saisir, échéance d'une revue de direction
 * rattachée (verrouillée : « Ouvrir la revue »), élément annulé.
 */
function PlanItemDetail({ item, findings, certLabel, onLeave }: { item: PlanItemView; findings: FindingView[]; certLabel: string | null; onLeave: () => void }) {
  const st = PLAN_ITEM_STATES[item.state];
  const rows: [string, ReactNode][] = [
    ['Nature', item.kind],
    ['État', <ToneTag key="s" tone={st.tone}>{st.label}</ToneTag>],
    ['Date prévue', item.plannedOn ? fmtDate(item.plannedOn) : monthLabel(item.month, item.year)],
    ...(item.postponedFrom ? [['Initialement', firstPlanned(item.postponedFrom)] as [string, ReactNode]] : []),
    ...(item.done ? [['Réalisé le', item.doneOn ? fmtDate(item.doneOn) : '—'] as [string, ReactNode]] : []),
    ...(item.cancelled ? [
      ['Annulé le', `${fmtDate(item.cancelled.on)}${item.cancelled.by ? ` par ${item.cancelled.by}` : ''}`],
      ['Motif', item.cancelled.reason || '—'],
    ] as [string, ReactNode][] : []),
    ['Responsable', item.owner || '—'],
    ...(item.isReview ? [] : [['Auditeur', item.auditor || '—'], ['Périmètre', item.scope || '—']] as [string, ReactNode][]),
    ...(certLabel ? [['Référentiel', certLabel] as [string, ReactNode]] : []),
    ...(item.review ? [['Revue', <ToneTag key="r" tone={item.review.statusTone}>{item.review.statusLabel}</ToneTag>] as [string, ReactNode]] : []),
    ['Action', item.actionId ? <ActionLink key="a" action={item.action} id={item.actionId} /> : '—'],
  ];
  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 12.5 }}>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{item.detail ?? item.label}</div>
      {item.locked && <p style={{ margin: 0, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>{REVIEW_NOTE}</p>}
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
          <i className="ph ph-arrow-square-out" style={{ fontSize: 13 }} aria-hidden />Ouvrir la revue
        </Link>
      )}
      {!item.isReview && (
        <div className={styles.footer} style={{ display: 'grid', gap: 8 }}>
          <span className="card-kicker">Rapport et constats</span>
          {item.reports.length ? <FileList files={item.reports} /> : <span style={muted}>Aucun rapport joint.</span>}
          <FindingList findings={findings} year={item.year} onLeave={onLeave} />
        </div>
      )}
      <ChangeLogList entries={item.log} />
    </div>
  );
}
