'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { NewActionButton } from '@/components/ActionFormDialog';
import { Dialog } from '@/components/Dialog';
import { ActionForm, Checkbox, Field, FormRow, Input, Select } from '@/components/form';
import { CardHead } from '@/components/ui';
import { MONTHS_SHORT, fmtDate, monthName } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { PlanItemView } from '@/lib/data/audits';
import type { FormOptions } from '@/lib/data/options';
import { deletePlanItem, savePlanItem } from '@/server/audits';
import { ActionLink, DeleteButton, DialogFooter } from './parts';
import { MONTH_OPTIONS, NEW_TRACK } from './shared';
import styles from './audits.module.css';

type Opts = Pick<FormOptions, 'people' | 'origins' | 'sites'>;
/** Élément ouvert : existant (id) ou à créer (ligne + mois ; ligne null = nouvelle ligne). */
type Editing = { id: number } | { track: string | null; month: number } | null;

type Props = {
  year: number;
  /** Mois en cours dans l'année affichée (0 = année à venir, 13 = année écoulée). */
  curMonth: number;
  tracks: string[];
  allTracks: string[];
  items: PlanItemView[];
  canManage: boolean;
  options: Opts;
  aside?: ReactNode;
};

/** Programme annuel des audits, visites et revues ; un clic sur une cellule ajoute ou modifie l'élément. */
export function ProgramTimeline({ year, curMonth, tracks, allTracks, items, canManage, options, aside }: Props) {
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);
  const item = editing && 'id' in editing ? items.find((i) => i.id === editing.id) : undefined;
  const trackOptions = [...new Set([...tracks, ...allTracks])];

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

      <Dialog open={!!editing} onClose={close} kicker={`Programme annuel ${year}`} width={560}
        title={item ? `${item.track} · ${monthName(item.month)}` : editing && 'track' in editing && editing.track ? `Nouvel élément · ${editing.track}` : 'Nouvelle ligne du programme'}>
        {editing && (
          <>
            <PlanItemForm key={item ? item.id : 'new'} year={year} item={item} trackOptions={trackOptions} people={options.people}
              track={'track' in editing ? editing.track : undefined} month={'month' in editing ? editing.month : undefined} onDone={close} />
            {item && (
              <DialogFooter>
                {item.actionId ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-neutral-400)' }}>
                    Échéance portée par l&apos;action <ActionLink action={item.action} id={item.actionId} />
                  </span>
                ) : (
                  <NewActionButton options={options} label="Créer l'action de suivi" className="btn btn-secondary vg-btn-sm"
                    defaults={{
                      title: item.detail ?? item.label, origin: 'audit', originRef: `Programme ${item.year}`, pilotId: item.ownerId ?? undefined,
                      dueOn: item.plannedOn ?? undefined, kind: 'P', link: `plan:${item.id}`, lockOrigin: true,
                    }} />
                )}
                <DeleteButton run={() => deletePlanItem(item.id)} onDone={close} />
              </DialogFooter>
            )}
          </>
        )}
      </Dialog>
    </div>
  );
}

function TrackRow({ track, items, curMonth, canManage, onOpen }: {
  track: string; items: PlanItemView[]; curMonth: number; canManage: boolean; onOpen: (month: number, item?: PlanItemView) => void;
}) {
  return (
    <>
      <div style={{ minHeight: 34, display: 'flex', alignItems: 'center', padding: '0 6px', color: 'var(--color-neutral-300)' }}>{track}</div>
      {MONTHS_SHORT.map((_, i) => {
        const m = i + 1;
        const it = items.find((p) => p.month === m);
        const past = m < curMonth;
        const style: CSSProperties = {
          minHeight: 34, display: 'flex', alignItems: 'center', padding: '0 6px', borderRadius: 4, minWidth: 0,
          background: it ? (past ? 'var(--color-neutral-900)' : 'var(--color-accent-900)') : m === curMonth ? 'color-mix(in srgb, var(--color-accent) 6%, transparent)' : 'transparent',
          color: it ? (past ? 'var(--color-neutral-400)' : 'var(--color-accent-200)') : 'transparent',
        };
        const title = it
          ? [it.detail ?? it.label, it.plannedOn && `prévu le ${fmtDate(it.plannedOn)}`, it.owner, it.done && 'réalisé'].filter(Boolean).join(' · ')
          : canManage ? `Ajouter en ${monthName(m)} · ${track}` : undefined;
        const content = it && (
          <span style={{ display: 'block', width: '100%', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {it.done && <i className="ph ph-check" aria-label="Réalisé" style={{ fontSize: 11, marginRight: 3, color: TONE.ok.dot, verticalAlign: '-1px' }} />}
            {it.label}
          </span>
        );
        if (!canManage) return <div key={m} title={title} style={style}>{content}</div>;
        return (
          <button key={m} type="button" title={title} className={styles.cell} style={style} onClick={() => onOpen(m, it)}>
            {content ?? <i className={`ph ph-plus ${styles.plus}`} aria-hidden />}
          </button>
        );
      })}
    </>
  );
}

function PlanItemForm({ year, item, track, month, trackOptions, people, onDone }: {
  year: number; item?: PlanItemView; track?: string | null; month?: number; trackOptions: string[]; people: Opts['people']; onDone: () => void;
}) {
  const [trackChoice, setTrackChoice] = useState(item?.track ?? track ?? NEW_TRACK);
  const isNew = trackChoice === NEW_TRACK;
  return (
    <ActionForm action={savePlanItem} onDone={onDone} onCancel={onDone} submitLabel={item ? 'Enregistrer' : 'Ajouter au programme'}
      hidden={{ id: item?.id, year: item?.year ?? year }}>
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
          <Input name="newTrack" autoFocus />
        </Field>
      )}
      <FormRow>
        <Field name="label" label="Libellé court" hint="Affiché dans la cellule (30 caractères au maximum).">
          <Input name="label" defaultValue={item?.label} maxLength={30} placeholder="Ex. BE · 17/10" autoFocus={!isNew} />
        </Field>
        <Field name="plannedOn" label="Date prévue" hint="Reprise dans les échéances à 15 jours.">
          <Input name="plannedOn" type="date" defaultValue={item?.plannedOn ?? ''} />
        </Field>
      </FormRow>
      <Field name="detail" label="Intitulé détaillé" hint="Ex. Processus Conception BE, Audit de suivi ISO 9001.">
        <Input name="detail" defaultValue={item?.detail ?? ''} />
      </Field>
      <FormRow>
        <Field name="ownerId" label="Responsable">
          <Select name="ownerId" options={people} defaultValue={item?.ownerId ?? ''} placeholder="Non désigné" />
        </Field>
        <Field label="État">
          <div style={{ minHeight: 34, display: 'flex', alignItems: 'center' }}>
            <Checkbox name="done" label="Réalisé" defaultChecked={item?.done} />
          </div>
        </Field>
      </FormRow>
    </ActionForm>
  );
}
