'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { NewActionButton } from '@/components/ActionFormDialog';
import { ChangeLogList } from '@/components/ChangeLog';
import { Dialog } from '@/components/Dialog';
import { LinkActionButton } from '@/components/LinkActionButton';
import { ActionForm, Checkbox, Field, FormRow, Input, Select } from '@/components/form';
import { CardHead, ToneTag } from '@/components/ui';
import { FILES_HINT, FileError, checkPickedFiles } from '@/components/watch/parts';
import { ATTACH_ACCEPT } from '@/lib/attachments';
import { MONTHS_SHORT, fmtDate, monthName } from '@/lib/dates';
import { FINDING_KINDS, PLAN_ITEM_STATES, TONE } from '@/lib/domain';
import type { FindingView, PlanItemView } from '@/lib/data/audits';
import type { FormOptions, Option } from '@/lib/data/options';
import { deletePlanItem, removePlanItemReport, savePlanItem } from '@/server/audits';
import { FindingForm } from './FindingsCard';
import { ActionLink, DeleteButton, DialogFooter, FileList } from './parts';
import { MONTH_OPTIONS, NEW_TRACK, isReviewPlanItem } from './shared';
import styles from './audits.module.css';

type Opts = Pick<FormOptions, 'people' | 'origins' | 'sites' | 'actions'>;
/** Élément ouvert : existant (id) ou à créer (ligne + mois ; ligne null = nouvelle ligne). */
type Editing = { id: number } | { track: string | null; month: number } | null;

type Props = {
  year: number;
  /** Mois en cours dans l'année affichée (0 = année à venir, 13 = année écoulée). */
  curMonth: number;
  tracks: string[];
  allTracks: string[];
  items: PlanItemView[];
  /** Constats rattachés aux éléments affichés. */
  findings: FindingView[];
  /** Référentiels proposés (audit de certification ou de suivi). */
  certs: readonly Option[];
  /** Audits du programme proposés dans le formulaire de constat. */
  auditOptions: Option[];
  canManage: boolean;
  options: Opts;
  aside?: ReactNode;
  /** Élément à ouvrir d'emblée (lien profond `?element=<id>`). */
  initialId?: number;
  /** URL sans le lien profond, rétablie à la fermeture. */
  closeHref?: string;
};

/**
 * Programme annuel des audits, visites et revues. Un clic sur un élément ouvre l'audit (fiche, rapport et constats) ;
 * un clic sur une cellule vide l'ajoute (rôles qui saisissent).
 */
export function ProgramTimeline({ year, curMonth, tracks, allTracks, items, findings, certs, auditOptions, canManage, options, aside, initialId, closeHref }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(initialId ? { id: initialId } : null);
  const [addingFinding, setAddingFinding] = useState(false);
  const [deepLink, setDeepLink] = useState(initialId != null);
  const close = (opts: { keepUrl?: boolean } = {}) => {
    setEditing(null);
    setAddingFinding(false);
    if (deepLink) {
      setDeepLink(false);
      if (closeHref && !opts.keepUrl) router.replace(closeHref, { scroll: false });
    }
  };
  const item = editing && 'id' in editing ? items.find((i) => i.id === editing.id) : undefined;
  const itemFindings = item ? findings.filter((f) => f.planItemId === item.id) : [];
  const trackOptions = [...new Set([...tracks, ...allTracks])];
  const certLabel = (id: string | null) => (id ? certs.find(([v]) => v === id)?.[1] ?? id : null);

  const title = item
    ? addingFinding ? `Nouveau constat · ${item.detail ?? item.label}` : `${item.track} · ${monthName(item.month)}`
    : editing && 'track' in editing && editing.track ? `Nouvel élément · ${editing.track}` : 'Nouvelle ligne du programme';

  return (
    <div className="card" style={{ gap: 10 }}>
      <CardHead title={`Programme annuel ${year}`} aside={(
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
          {aside}
          {canManage && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setEditing({ track: null, month: curMonth >= 1 && curMonth <= 12 ? curMonth : 1 })}>
              <i className="ph ph-plus" style={{ fontSize: 13 }} />Ajouter une ligne
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
            <TrackRow key={track} track={track} items={items.filter((p) => p.track === track)} curMonth={curMonth} canManage={canManage}
              onOpen={(month, it) => setEditing(it ? { id: it.id } : { track, month })} />
          ))}
        </div>
      </div>
      {!tracks.length && (
        <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>
          Aucun élément au programme {year}.{canManage && ' Ajoutez une ligne (audits internes, visites sécurité, certification…) pour commencer.'}
        </div>
      )}

      <Dialog open={!!editing} onClose={() => close()} kicker={`Programme annuel ${year}`} width={600} title={title}>
        {editing && item && addingFinding && (
          <FindingForm defaultPlanItemId={item.id} defaultAudit={item.detail ?? item.label} audits={[]} auditOptions={auditOptions}
            onDone={() => setAddingFinding(false)} onCancel={() => setAddingFinding(false)} />
        )}
        {editing && item && !addingFinding && !canManage && (
          <PlanItemDetail item={item} findings={itemFindings} certLabel={certLabel(item.certificationId)} onLeave={() => close({ keepUrl: true })} />
        )}
        {editing && (!item || (canManage && !addingFinding)) && (
          <>
            <PlanItemForm key={item ? item.id : 'new'} year={year} item={item} trackOptions={trackOptions} people={options.people} certs={certs}
              track={'track' in editing ? editing.track : undefined} month={'month' in editing ? editing.month : undefined} onDone={() => close()} />
            {item && !item.isReview && (
              <ReportSection item={item} findings={itemFindings} onAddFinding={() => setAddingFinding(true)} onLeave={() => close({ keepUrl: true })} />
            )}
            {item && (
              <DialogFooter>
                {item.actionId ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-neutral-400)' }}>
                    Échéance portée par l&apos;action <ActionLink action={item.action} id={item.actionId} />
                    <LinkActionButton link={`plan:${item.id}`} current={item.actionId} />
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <NewActionButton options={options} label="Créer l'action de suivi" className="btn btn-secondary vg-btn-sm"
                      defaults={{
                        title: item.detail ?? item.label, origin: 'audit', originRef: `Programme ${item.year}`, pilotId: item.ownerId ?? undefined,
                        dueOn: item.plannedOn ?? undefined, kind: 'P', link: `plan:${item.id}`, lockOrigin: true,
                      }} />
                    <LinkActionButton link={`plan:${item.id}`} actions={options.actions} />
                  </span>
                )}
                {item.removable && (
                  <DeleteButton run={() => deletePlanItem(item.id)} onDone={() => close()} label="Retirer du programme"
                    note="Élément jamais réalisé : retrait inscrit au journal." />
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
};

function TrackRow({ track, items, curMonth, canManage, onOpen }: {
  track: string; items: PlanItemView[]; curMonth: number; canManage: boolean; onOpen: (month: number, item?: PlanItemView) => void;
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
          ? [it.detail ?? it.label, it.plannedOn && `prévu le ${fmtDate(it.plannedOn)}`, it.owner,
            it.done ? (it.doneOn ? `réalisé le ${fmtDate(it.doneOn)}` : 'réalisé') : it.state === 'late' && 'à confirmer'].filter(Boolean).join(' · ')
          : canManage ? `Ajouter en ${monthName(m)} · ${track}` : undefined;
        const content = it && (
          <span style={{ display: 'block', width: '100%', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {it.done && <i className="ph ph-check" aria-label="Réalisé" style={{ fontSize: 11, marginRight: 3, color: TONE.ok.dot, verticalAlign: '-1px' }} />}
            {it.state === 'late' && <i className="ph ph-warning" aria-label="À confirmer" style={{ fontSize: 11, marginRight: 3, verticalAlign: '-1px' }} />}
            {it.label}
          </span>
        );
        // Élément : ouvert par tous (fiche en lecture seule hors saisie) ; cellule vide : ajout réservé à la saisie.
        if (!it && !canManage) return <div key={m} style={style} />;
        return (
          <button key={m} type="button" title={title} className={styles.cell} style={style} onClick={() => onOpen(m, it)}>
            {content ?? <i className={`ph ph-plus ${styles.plus}`} aria-hidden />}
          </button>
        );
      })}
    </>
  );
}

function PlanItemForm({ year, item, track, month, trackOptions, people, certs, onDone }: {
  year: number; item?: PlanItemView; track?: string | null; month?: number; trackOptions: string[]; people: Opts['people']; certs: readonly Option[]; onDone: () => void;
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
      hidden={{ id: item?.id, year: item?.year ?? year }} encType="multipart/form-data">
      <FormRow>
        <Field name="track" label="Ligne du programme">
          <Select name="track" value={trackChoice} onChange={(e) => setTrackChoice(e.target.value)}
            options={[...trackOptions.map((t) => [t, t] as const), [NEW_TRACK, 'Nouvelle ligne…'] as const]} />
        </Field>
        <Field name="month" label="Mois">
          <Select name="month" options={MONTH_OPTIONS} defaultValue={String(item?.month ?? month ?? 1)} />
        </Field>
      </FormRow>
      {isNew && (
        <Field name="newTrack" label="Nom de la nouvelle ligne" hint="Ex. Audits fournisseurs, Exercices d'évacuation, Audits produit.">
          <Input name="newTrack" autoFocus onChange={(e) => setNewTrack(e.target.value)} />
        </Field>
      )}
      <FormRow>
        <Field name="label" label="Libellé court" hint="Affiché dans la cellule (30 caractères au maximum).">
          <Input name="label" defaultValue={item?.label} maxLength={30} placeholder="Ex. BE · 17/10" autoFocus={!isNew} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field name="plannedOn" label="Date prévue" hint="Reprise dans les échéances à 15 jours.">
          <Input name="plannedOn" type="date" defaultValue={item?.plannedOn ?? ''} />
        </Field>
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
        <Field label="État">
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

/** Rapport(s) et constats d'un audit du programme, sous le formulaire (saisie). */
function ReportSection({ item, findings, onAddFinding, onLeave }: { item: PlanItemView; findings: FindingView[]; onAddFinding: () => void; onLeave: () => void }) {
  return (
    <div className={styles.footer} style={{ display: 'grid', gap: 8 }}>
      <span className="card-kicker">Rapport et constats</span>
      {item.reports.length ? <FileList files={item.reports} onRemove={removePlanItemReport} /> : (
        <span style={{ color: 'var(--color-neutral-500)' }}>Aucun rapport joint.</span>
      )}
      <FindingList findings={findings} year={item.year} onLeave={onLeave} />
      <button type="button" className="btn btn-secondary vg-btn-sm" style={{ justifySelf: 'start' }} onClick={onAddFinding}>
        <i className="ph ph-plus" style={{ fontSize: 13 }} />Ajouter un constat
      </button>
    </div>
  );
}

function FindingList({ findings, year, onLeave }: { findings: FindingView[]; year: number; onLeave: () => void }) {
  if (!findings.length) return <span style={{ color: 'var(--color-neutral-500)' }}>Aucun constat rattaché.</span>;
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
            <span style={{ whiteSpace: 'nowrap' }}>{f.actionId ? <ActionLink action={f.action} id={f.actionId} compact /> : <span style={{ color: 'var(--color-neutral-600)' }}>—</span>}</span>
          </div>
        );
      })}
      <Link href={`/audits?annee=${year}&constat=${findings[0].id}`} scroll={false} className="vg-link" style={{ justifySelf: 'start' }} onClick={onLeave}>
        Voir dans les constats
      </Link>
    </div>
  );
}

/** Fiche en lecture seule d'un élément du programme (rôles qui consultent sans saisir). */
function PlanItemDetail({ item, findings, certLabel, onLeave }: { item: PlanItemView; findings: FindingView[]; certLabel: string | null; onLeave: () => void }) {
  const st = PLAN_ITEM_STATES[item.state];
  const rows: [string, ReactNode][] = [
    ['Nature', item.kind],
    ['État', <ToneTag key="s" tone={st.tone}>{st.label}</ToneTag>],
    ['Date prévue', item.plannedOn ? fmtDate(item.plannedOn) : `${monthName(item.month)} ${item.year}`],
    ...(item.done ? [['Réalisé le', item.doneOn ? fmtDate(item.doneOn) : '—'] as [string, ReactNode]] : []),
    ['Responsable', item.owner || '—'],
    ...(item.isReview ? [] : [['Auditeur', item.auditor || '—'], ['Périmètre', item.scope || '—']] as [string, ReactNode][]),
    ...(certLabel ? [['Référentiel', certLabel] as [string, ReactNode]] : []),
    ['Action', item.actionId ? <ActionLink key="a" action={item.action} id={item.actionId} /> : '—'],
  ];
  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 12.5 }}>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{item.detail ?? item.label}</div>
      <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', margin: 0 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt style={{ color: 'var(--color-neutral-500)' }}>{k}</dt>
            <dd style={{ margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
      {!item.isReview && (
        <div className={styles.footer} style={{ display: 'grid', gap: 8 }}>
          <span className="card-kicker">Rapport et constats</span>
          {item.reports.length ? <FileList files={item.reports} /> : <span style={{ color: 'var(--color-neutral-500)' }}>Aucun rapport joint.</span>}
          <FindingList findings={findings} year={item.year} onLeave={onLeave} />
        </div>
      )}
      <ChangeLogList entries={item.log} />
    </div>
  );
}
