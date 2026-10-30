'use client';

import { useState } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Checkbox, Field, FormRow, Input } from '@/components/form';
import { ReasonButton, ReasonForm } from '@/components/ReasonDialog';
import { fmtDate, parisDay } from '@/lib/dates';
import type { ArchivedRecord, TrainingTitle } from '@/lib/data/skills';
import { archiveTitle, moveTitle, restoreTitle, saveTitle } from '@/server/skills';
import { SaveStatus, useActionRunner } from '@/components/feedback';
import { TipButton } from '@/components/Tip';
import { HistoryTable } from './common';

function TitleForm({ title, titles, onDone }: { title?: TrainingTitle; titles: TrainingTitle[]; onDone: () => void }) {
  const others = titles.filter((x) => x.id !== title?.id);
  const prereq = new Set(title?.prerequisiteIds ?? []);
  return (
    <ActionForm action={saveTitle} onDone={onDone} onCancel={onDone} submitLabel={title ? 'Enregistrer' : 'Ajouter le titre'} hidden={{ id: title?.id, firstAidField: '1', prerequisitesField: '1', awarenessField: '1', internalAuditorField: '1' }}>
      <FormRow>
        <Field name="label" label="Intitulé">
          <Input name="label" defaultValue={title?.label} placeholder="Ex. Habilitation soudure" maxLength={60} autoFocus />
        </Field>
        <Field name="validityMonths" label="Validité (mois)" hint="0 = sans échéance">
          <Input name="validityMonths" type="number" inputMode="numeric" min={0} max={240} step={1} defaultValue={title?.validityMonths ?? 36} />
        </Field>
      </FormRow>
      {/* HAB-13 : sensibilisation (ISO 45001 §7.3), suivie et évaluée comme une formation. */}
      <Field name="awareness" label="Sensibilisation" hint="Accueil sécurité, causerie, consignes : action de sensibilisation (ISO 45001 §7.3) plutôt qu'une formation qualifiante.">
        <Checkbox name="awareness" label="Action de sensibilisation" defaultChecked={title?.awareness ?? false} />
      </Field>
      {/* AUD-27 : qualification d'auditeur interne, vérifiée (signalée) pour l'auditeur interne d'un audit du programme. */}
      <Field name="internalAuditor" label="Auditeur interne" hint="Formation d'auditeur interne (ISO 19011…) : l'auditeur interne d'un audit sans titre valide de ce type est signalé.">
        <Checkbox name="internalAuditor" label="Qualifie un auditeur interne" defaultChecked={title?.internalAuditor ?? false} />
      </Field>
      <Field name="firstAid" label="Secourisme" hint="Titulaires en cours de validité proposés comme donneurs de soins du registre des accidents bénins.">
        <Checkbox name="firstAid" label="Sauveteur secouriste du travail (SST) ou équivalent" defaultChecked={title?.firstAid ?? false} />
      </Field>
      {/* HAB-10 : catégories ou niveaux obtenus, saisis avec chaque formation. */}
      <Field name="scopeLabel" label="Catégories ou niveaux" hint="Facultatif : intitulé du champ saisi avec chaque formation (ex. « Catégories CACES », « Indices d'habilitation »).">
        <Input name="scopeLabel" defaultValue={title?.scopeLabel ?? ''} maxLength={60} />
      </Field>
      {others.length > 0 && (
        <Field name="prerequisiteIds" label="Titres prérequis"
          hint="Le titre n'est valide qu'avec au moins un de ces titres en cours de validité (ex. autorisation de conduite : CACES de la catégorie, R. 4323-56).">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            {others.map((x) => <Checkbox key={x.id} name="prerequisiteIds" value={x.id} label={x.label} defaultChecked={prereq.has(x.id)} />)}
          </div>
        </Field>
      )}
    </ActionForm>
  );
}

/** Titre archivé : date, motif, formations conservées (consultation seule) et « Restaurer ». */
function ArchivedRow({ title, records, canManage }: { title: TrainingTitle; records: ArchivedRecord[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const count = records.reduce((n, r) => n + r.entries.length, 0);
  const on = title.archivedAt ? fmtDate(parisDay(new Date(title.archivedAt))) : '';
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
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-neutral-500)' }}>{title.validityMonths ? `${title.validityMonths} mois` : 'Sans échéance'}</td>
      {canManage && (
        <td style={{ textAlign: 'right', width: 1 }}>
          <ReasonButton action={restoreTitle} hidden={{ id: title.id }} label="Restaurer" className="vg-text-btn" title="Restaurer le titre"
            kicker={title.label} submitLabel="Restaurer" message="Le titre revient dans la matrice avec ses exigences et ses formations."
            placeholder="Ex. habilitation de nouveau exigée" />
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
                  title={<>{r.person.name}{r.person.leftOn && <span style={{ color: 'var(--vg-text-muted)', fontWeight: 400 }}> · sortie le {fmtDate(r.person.leftOn)}</span>}</>} />
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
  const { pending, error, run } = useActionRunner();
  const close = () => setEditing(null);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <table className="table" style={{ fontSize: 12.5 }}>
        <thead>
          <tr><th>Titre</th><th style={{ textAlign: 'right' }}>Validité</th>{canManage && <th aria-label="Actions" />}</tr>
        </thead>
        <tbody>
          {titles.map((t, i) => editing === t.id ? (
            <tr key={t.id}><td colSpan={3} style={{ padding: '10px 4px' }}><TitleForm title={t} titles={titles} onDone={close} /></td></tr>
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
                {t.firstAid && <span className="tag tag-outline" style={{ fontSize: 11, marginLeft: 8 }} title="Donneurs de soins du registre des accidents bénins">Secourisme</span>}
                {t.awareness && <span className="tag tag-outline" style={{ fontSize: 11, marginLeft: 8 }}>Sensibilisation</span>}
                {t.internalAuditor && <span className="tag tag-outline" style={{ fontSize: 11, marginLeft: 8 }}>Auditeur interne</span>}
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-neutral-400)' }}>{t.validityMonths ? `${t.validityMonths} mois` : 'Sans échéance'}</td>
              {canManage && (
                <td style={{ textAlign: 'right', width: 1, whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
                    {/* HAB-15 : ordre des colonnes de la matrice (journal du titre). */}
                    <span style={{ display: 'inline-flex', gap: 2 }}>
                      <TipButton className="btn btn-ghost btn-icon vg-btn-sm" tip="Placer avant dans la matrice" aria-label={`Monter « ${t.label} »`}
                        disabled={editing !== null || pending || i === 0} onClick={() => run(() => moveTitle(t.id, 'up'))}>
                        <i className="ph ph-arrow-up" style={{ fontSize: 13 }} aria-hidden />
                      </TipButton>
                      <TipButton className="btn btn-ghost btn-icon vg-btn-sm" tip="Placer après dans la matrice" aria-label={`Descendre « ${t.label} »`}
                        disabled={editing !== null || pending || i === titles.length - 1} onClick={() => run(() => moveTitle(t.id, 'down'))}>
                        <i className="ph ph-arrow-down" style={{ fontSize: 13 }} aria-hidden />
                      </TipButton>
                    </span>
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
          <div className="vg-inset" style={{ padding: 12, flex: 1 }}><TitleForm titles={titles} onDone={close} /></div>
        ) : (
          <button type="button" className="btn btn-secondary vg-btn-sm" disabled={editing !== null} onClick={() => setEditing('new')}>
            <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />Ajouter un titre
          </button>
        ))}
        {archivedTitles.length > 0 && editing !== 'new' && (
          <button type="button" className={`vg-chip${showArchived ? ' is-on' : ''}`} aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            <i className="ph ph-archive" style={{ fontSize: 13 }} aria-hidden />Afficher les titres archivés ({archivedTitles.length})
          </button>
        )}
      </div>
      <SaveStatus pending={pending} error={error} label="Déplacement…" />
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
        {canManage && <>L&apos;ordre de la liste est celui des colonnes de la matrice (flèches). </>}La validité sert à calculer l&apos;échéance des formations enregistrées ensuite ; les échéances déjà saisies ne sont pas recalculées.
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
