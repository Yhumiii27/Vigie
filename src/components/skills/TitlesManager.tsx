'use client';

import { useState, useTransition } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Checkbox, Field, FormRow, Input } from '@/components/form';
import { ReasonForm } from '@/components/ReasonDialog';
import { fmtDate } from '@/lib/dates';
import type { ArchivedRecord, TrainingTitle } from '@/lib/data/skills';
import { archiveTitle, restoreTitle, saveTitle } from '@/server/skills';
import { HistoryTable } from './common';

function TitleForm({ title, onDone }: { title?: TrainingTitle; onDone: () => void }) {
  return (
    <ActionForm action={saveTitle} onDone={onDone} onCancel={onDone} submitLabel={title ? 'Enregistrer' : 'Ajouter le titre'} hidden={{ id: title?.id, firstAidField: '1' }}>
      <FormRow>
        <Field name="label" label="Intitulé">
          <Input name="label" defaultValue={title?.label} placeholder="Ex. Habilitation soudure" maxLength={60} autoFocus />
        </Field>
        <Field name="validityMonths" label="Validité (mois)" hint="0 = sans échéance">
          <Input name="validityMonths" type="number" inputMode="numeric" min={0} max={240} step={1} defaultValue={title?.validityMonths ?? 36} />
        </Field>
      </FormRow>
      <Field name="firstAid" label="Secourisme" hint="Titulaires en cours de validité proposés comme donneurs de soins du registre des accidents bénins.">
        <Checkbox name="firstAid" label="Sauveteur secouriste du travail (SST) ou équivalent" defaultChecked={title?.firstAid ?? false} />
      </Field>
    </ActionForm>
  );
}

/** Titre archivé : date, motif, formations conservées (consultation seule) et « Restaurer ». */
function ArchivedRow({ title, records, canManage }: { title: TrainingTitle; records: ArchivedRecord[]; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const count = records.reduce((n, r) => n + r.entries.length, 0);
  const restore = () => start(async () => { setError((await restoreTitle(title.id)).error ?? null); });
  const on = title.archivedAt ? fmtDate(new Date(title.archivedAt).toISOString().slice(0, 10)) : '';
  const row = (
    <tr>
      <td>
        <span style={{ display: 'block', color: 'var(--color-neutral-400)' }}>{title.label}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
          Archivé le {on}{title.archiveReason ? ` — ${title.archiveReason}` : ''}
        </span>
        {count > 0 && (
          <button type="button" className="vg-text-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ fontSize: 11.5 }}>
            {open ? 'Masquer les formations' : `Voir les formations (${count})`}
          </button>
        )}
        {error && <span role="alert" style={{ display: 'block', fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>{error}</span>}
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-neutral-500)' }}>{title.validityMonths ? `${title.validityMonths} mois` : 'Sans échéance'}</td>
      {canManage && (
        <td style={{ textAlign: 'right', width: 1 }}>
          <button type="button" className="vg-text-btn" disabled={pending} onClick={restore}>{pending ? 'Restauration…' : 'Restaurer'}</button>
        </td>
      )}
    </tr>
  );
  return (
    <>
      {row}
      {open && (
        <tr>
          <td colSpan={3} style={{ padding: '6px 4px 12px' }}>
            <div style={{ display: 'grid', gap: 14 }}>
              {records.map((r) => (
                <HistoryTable key={r.person.id} entries={r.entries}
                  title={<>{r.person.name}{r.person.leftOn && <span style={{ color: 'var(--color-neutral-600)', fontWeight: 400 }}> · sortie le {fmtDate(r.person.leftOn)}</span>}</>} />
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Liste des titres suivis dans la matrice, avec leur durée de validité ; archivage avec motif et restauration. */
function TitlesManager({ titles, archivedTitles, archive, canManage }: { titles: TrainingTitle[]; archivedTitles: TrainingTitle[]; archive: ArchivedRecord[]; canManage: boolean }) {
  // Titre en cours de modification (`id`), d'archivage (`archive:id`) ou d'ajout (`new`).
  const [editing, setEditing] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const close = () => setEditing(null);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <table className="table" style={{ fontSize: 12.5 }}>
        <thead>
          <tr><th>Titre</th><th style={{ textAlign: 'right' }}>Validité</th>{canManage && <th aria-label="Actions" />}</tr>
        </thead>
        <tbody>
          {titles.map((t) => editing === t.id ? (
            <tr key={t.id}><td colSpan={3} style={{ padding: '10px 4px' }}><TitleForm title={t} onDone={close} /></td></tr>
          ) : editing === `archive:${t.id}` ? (
            <tr key={t.id}>
              <td colSpan={3} style={{ padding: '10px 4px' }}>
                <ReasonForm action={archiveTitle} hidden={{ id: t.id }} onDone={close} onCancel={close} submitLabel="Archiver le titre" submitIcon="ph-archive"
                  message={<>« {t.label} » sera retiré de la matrice et des échéances. Les exigences et formations enregistrées sont conservées.</>}
                  placeholder="Ex. remplacé par un nouveau référentiel" />
              </td>
            </tr>
          ) : (
            <tr key={t.id}>
              <td>
                {t.label}
                {t.firstAid && <span className="tag tag-outline" style={{ fontSize: 10, marginLeft: 8 }} title="Donneurs de soins du registre des accidents bénins">Secourisme</span>}
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-neutral-400)' }}>{t.validityMonths ? `${t.validityMonths} mois` : 'Sans échéance'}</td>
              {canManage && (
                <td style={{ textAlign: 'right', width: 1, whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', gap: 10 }}>
                    <button type="button" className="vg-text-btn" disabled={editing !== null} onClick={() => setEditing(t.id)}>Modifier</button>
                    <button type="button" className="vg-text-btn" disabled={editing !== null} onClick={() => setEditing(`archive:${t.id}`)}>Archiver</button>
                  </span>
                </td>
              )}
            </tr>
          ))}
          {showArchived && archivedTitles.map((t) => <ArchivedRow key={t.id} title={t} records={archive.filter((r) => r.title.id === t.id)} canManage={canManage} />)}
        </tbody>
      </table>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {canManage && (editing === 'new' ? (
          <div className="vg-inset" style={{ padding: 12, flex: 1 }}><TitleForm onDone={close} /></div>
        ) : (
          <button type="button" className="btn btn-secondary vg-btn-sm" disabled={editing !== null} onClick={() => setEditing('new')}>
            <i className="ph ph-plus" style={{ fontSize: 13 }} />Ajouter un titre
          </button>
        ))}
        {archivedTitles.length > 0 && editing !== 'new' && (
          <button type="button" className={`vg-chip${showArchived ? ' is-on' : ''}`} aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            <i className="ph ph-archive" style={{ fontSize: 13 }} />Afficher les titres archivés ({archivedTitles.length})
          </button>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
        La validité sert à calculer l&apos;échéance des formations enregistrées ensuite ; les échéances déjà saisies ne sont pas recalculées.
        Archiver un titre le retire de la matrice ; les formations enregistrées restent consultables dans les titres archivés.
      </p>
    </div>
  );
}

/** Bouton « Titres suivis » ouvrant la liste des titres. */
export function TitlesButton({ titles, archivedTitles, archive, canManage }: {
  titles: TrainingTitle[]; archivedTitles: TrainingTitle[]; archive: ArchivedRecord[]; canManage: boolean;
}) {
  return (
    <DialogButton label="Titres suivis" icon="ph-list-checks" title="Titres suivis" kicker="Habilitations et formations" width={600}>
      {() => <TitlesManager titles={titles} archivedTitles={archivedTitles} archive={archive} canManage={canManage} />}
    </DialogButton>
  );
}
