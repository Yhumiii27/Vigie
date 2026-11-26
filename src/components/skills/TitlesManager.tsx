'use client';

import { useState } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Checkbox, Field, Select } from '@/components/form';
import { ReasonButton, ReasonForm } from '@/components/ReasonDialog';
import { fmtDate, parisDay } from '@/lib/dates';
import type { Option } from '@/lib/data/options';
import type { ArchivedRecord, TrainingTitle } from '@/lib/data/skills';
import { followTitle, moveTitle, archiveTitle, restoreTitle, saveTitle } from '@/server/skills';
import { SaveStatus, useActionRunner } from '@/components/feedback';
import { TipButton } from '@/components/Tip';
import { ArchiveTable } from './common';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

// Titres suivis par Vigie (D08, décision CV-01 du 04/11/2026) : un titre se choisit dans le catalogue de Cursus, qui en tient
// l'intitulé et la validité ; Vigie garde l'ordre des colonnes (HAB-15) et ses attributs propres au QHSE (CV-03).

/** Attributs propres au QHSE (secourisme, sensibilisation, auditeur interne, accueil sécurité), communs à l'ajout et à la modification. */
function LocalFlags({ title }: { title?: TrainingTitle }) {
  const { t } = useI18n();
  return (
    <>
      <Field name="awareness" label={t('Awareness')} hint={t('Safety induction, toolbox talk, instructions: an awareness action (ISO 45001 §7.3) rather than a qualifying training.')}>
        <Checkbox name="awareness" label={t('Awareness action')} defaultChecked={title?.awareness ?? false} />
      </Field>
      <Field name="internalAuditor" label={t('Internal auditor')} hint={t('Internal auditor training (ISO 19011…): the internal auditor of an audit without a valid title of this type is flagged.')}>
        <Checkbox name="internalAuditor" label={t('Qualifies an internal auditor')} defaultChecked={title?.internalAuditor ?? false} />
      </Field>
      <Field name="safetyInduction" label={t('Safety induction')} hint={t('Site safety induction: a worker of a prevention plan without a valid title of this type is flagged (PRV-23).')}>
        <Checkbox name="safetyInduction" label={t('Safety induction of the workers')} defaultChecked={title?.safetyInduction ?? false} />
      </Field>
      <Field name="firstAid" label={t('First aid')} hint={t('Holders with a valid title offered as care givers in the register of minor accidents.')}>
        <Checkbox name="firstAid" label={t('Workplace first-aider (SST) or equivalent')} defaultChecked={title?.firstAid ?? false} />
      </Field>
    </>
  );
}

/** Modification des seuls attributs propres au QHSE d'un titre suivi (intitulé et validité : Cursus). */
function TitleForm({ title, version, onDone }: { title: TrainingTitle; version?: string; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <ActionForm action={saveTitle} onDone={onDone} onCancel={onDone} submitLabel={t('Save')}
      hidden={{ id: title.id, version, firstAidField: '1', awarenessField: '1', internalAuditorField: '1', safetyInductionField: '1' }}>
      <LocalFlags title={title} />
    </ActionForm>
  );
}

/** « Suivre un titre » : choix parmi les titres du catalogue de Cursus que Vigie ne suit pas encore. */
function FollowForm({ catalog, onDone }: { catalog: { choices: readonly Option[]; message: string | null }; onDone: () => void }) {
  const { t } = useI18n();
  if (catalog.message) return <div role="status" style={{ fontSize: 12.5 }}>{catalog.message}</div>;
  if (!catalog.choices.length) return <div role="status" style={{ fontSize: 12.5 }}>{t('Every title of the Cursus catalogue is already followed.')}</div>;
  return (
    <ActionForm action={followTitle} onDone={onDone} onCancel={onDone} submitLabel={t('Follow the title')}>
      <Field name="titleId" label={t('Title from the Cursus catalogue')} hint={t('Name and validity are those of Cursus; a new title is requested from the HR department.')}>
        <Select name="titleId" options={catalog.choices} placeholder={t('Choose…')} autoFocus />
      </Field>
      <LocalFlags />
    </ActionForm>
  );
}

/** Titre qui n'est plus suivi : date, motif, titres détenus conservés (consultation seule) et « Suivre à nouveau ». */
function ArchivedRow({ title, records, canManage }: { title: TrainingTitle; records: ArchivedRecord[]; canManage: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const on = title.archivedAt ? fmtDate(parisDay(new Date(title.archivedAt))) : '';
  return (
    <>
      <tr>
        <td>
          <span style={{ display: 'block', color: 'var(--color-neutral-400)' }}>{title.label}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
            {fill(t('No longer followed since {date}'), { date: on })}{title.archiveReason ? ` — ${title.archiveReason}` : ''}
          </span>
          {records.length > 0 && (
            <button type="button" className="vg-text-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ fontSize: 11.5 }}>
              {open ? t('Hide the holders') : fill(t('See the holders ({n})'), { n: records.length })}
            </button>
          )}
        </td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-neutral-500)' }}>{title.validityMonths ? fill(t('{n} months'), { n: title.validityMonths }) : t('No expiry')}</td>
        {canManage && (
          <td style={{ textAlign: 'right', width: 1 }}>
            <ReasonButton action={restoreTitle} hidden={{ id: title.id }} label={t('Follow again')} className="vg-text-btn" title={t('Follow the title again')}
              kicker={title.label} submitLabel={t('Follow again')} message={t('The title comes back in the matrix with its requirements.')}
              placeholder={t('E.g. qualification required again')} />
          </td>
        )}
      </tr>
      {open && (
        <tr><td colSpan={3} style={{ padding: '6px 4px 12px' }}><ArchiveTable records={records} first="person" /></td></tr>
      )}
    </>
  );
}

/** Liste des titres suivis dans la matrice ; ordre, attributs propres, « Ne plus suivre » avec motif, « Suivre un titre ». */
function TitlesManager({ titles, archivedTitles, archive, canManage, versions, catalog }: {
  titles: TrainingTitle[]; archivedTitles: TrainingTitle[]; archive: ArchivedRecord[]; canManage: boolean; versions?: Record<string, string>;
  catalog: { choices: readonly Option[]; message: string | null };
}) {
  // Titre en cours de modification (`id`), à ne plus suivre (`archive:id`) ou à suivre (`new`).
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { pending, error, run } = useActionRunner();
  const close = () => setEditing(null);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
        {t('Data held by Cursus (HR): name, validity, trainings and qualifications. Vigie chooses the titles it follows in its matrix.')}
      </p>
      <table className="table" style={{ fontSize: 12.5 }}>
        <thead>
          <tr><th>{t('Title#qualification')}</th><th style={{ textAlign: 'right' }}>{t('Validity')}</th>{canManage && <th aria-label={t('Actions')} />}</tr>
        </thead>
        <tbody>
          {titles.map((ti, i) => editing === ti.id ? (
            <tr key={ti.id}><td colSpan={3} style={{ padding: '10px 4px' }}><TitleForm title={ti} version={versions?.[ti.id]} onDone={close} /></td></tr>
          ) : editing === `archive:${ti.id}` ? (
            <tr key={ti.id}>
              <td colSpan={3} style={{ padding: '10px 4px' }}>
                <ReasonForm action={archiveTitle} hidden={{ id: ti.id }} onDone={close} onCancel={close} submitLabel={t('Stop following')} submitIcon="ph-archive"
                  message={fill(t('“{title}” will be removed from the matrix and the deadlines. The requirements are kept; the titles held stay in Cursus.'), { title: ti.label })}
                  placeholder={t('E.g. replaced by a new standard')} />
              </td>
            </tr>
          ) : (
            <tr key={ti.id}>
              <td>
                {ti.label}
                <span style={{ display: 'block', fontSize: 11, color: 'var(--vg-text-muted)' }}>{ti.id}{ti.cursusState === 'absent' ? t(' · absent from the Cursus catalogue') : ''}</span>
                {ti.firstAid && <span className="tag tag-outline" style={{ fontSize: 11, marginRight: 6 }}>{t('First aid')}</span>}
                {ti.awareness && <span className="tag tag-outline" style={{ fontSize: 11, marginRight: 6 }}>{t('Awareness')}</span>}
                {ti.internalAuditor && <span className="tag tag-outline" style={{ fontSize: 11, marginRight: 6 }}>{t('Internal auditor')}</span>}
                {ti.safetyInduction && <span className="tag tag-outline" style={{ fontSize: 11 }}>{t('Safety induction')}</span>}
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-neutral-400)' }}>{ti.validityMonths ? fill(t('{n} months'), { n: ti.validityMonths }) : t('No expiry')}</td>
              {canManage && (
                <td style={{ textAlign: 'right', width: 1, whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
                    {/* HAB-15 : ordre des colonnes de la matrice (journal du titre). */}
                    <span style={{ display: 'inline-flex', gap: 2 }}>
                      <TipButton className="btn btn-ghost btn-icon vg-btn-sm" tip={t('Place earlier in the matrix')} aria-label={fill(t('Move up “{title}”'), { title: ti.label })}
                        disabled={editing !== null || pending || i === 0} onClick={() => run(() => moveTitle(ti.id, 'up'))}>
                        <i className="ph ph-arrow-up" style={{ fontSize: 13 }} aria-hidden />
                      </TipButton>
                      <TipButton className="btn btn-ghost btn-icon vg-btn-sm" tip={t('Place later in the matrix')} aria-label={fill(t('Move down “{title}”'), { title: ti.label })}
                        disabled={editing !== null || pending || i === titles.length - 1} onClick={() => run(() => moveTitle(ti.id, 'down'))}>
                        <i className="ph ph-arrow-down" style={{ fontSize: 13 }} aria-hidden />
                      </TipButton>
                    </span>
                    <button type="button" className="vg-text-btn" disabled={editing !== null} onClick={() => setEditing(ti.id)}>{t('Edit')}</button>
                    <button type="button" className="vg-text-btn" disabled={editing !== null} onClick={() => setEditing(`archive:${ti.id}`)}>{t('Stop following')}</button>
                  </span>
                </td>
              )}
            </tr>
          ))}
          {showArchived && archivedTitles.map((ti) => <ArchivedRow key={ti.id} title={ti} records={archive.filter((r) => r.title.id === ti.id)} canManage={canManage} />)}
        </tbody>
      </table>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {canManage && (editing === 'new' ? (
          <div className="vg-inset" style={{ padding: 12, flex: 1 }}><FollowForm catalog={catalog} onDone={close} /></div>
        ) : (
          <button type="button" className="btn btn-secondary vg-btn-sm" disabled={editing !== null} onClick={() => setEditing('new')}>
            <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />{t('Follow a Cursus title')}
          </button>
        ))}
        {archivedTitles.length > 0 && editing !== 'new' && (
          <button type="button" className={`vg-chip${showArchived ? ' is-on' : ''}`} aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            <i className="ph ph-archive" style={{ fontSize: 13 }} aria-hidden />{fill(t('Show the titles no longer followed ({n})'), { n: archivedTitles.length })}
          </button>
        )}
      </div>
      <SaveStatus pending={pending} error={error} label={t('Moving…')} />
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
        {canManage && t('The order of the list is that of the matrix columns (arrows). ')}{t('Stopping following a title removes it from the matrix; its holders stay viewable in the titles no longer followed.')}
      </p>
    </div>
  );
}

/** Bouton « Titres suivis » ouvrant la liste des titres. */
export function TitlesButton({ titles, archivedTitles, archive, canManage, versions, catalog }: {
  titles: TrainingTitle[]; archivedTitles: TrainingTitle[]; archive: ArchivedRecord[]; canManage: boolean;
  /** QUA-12 : version de chaque titre à l'ouverture de la page. */
  versions?: Record<string, string>;
  catalog: { choices: readonly Option[]; message: string | null };
}) {
  const { t } = useI18n();
  return (
    <DialogButton label={t('Titles followed')} icon="ph-list-checks" title={t('Titles followed')} kicker={t('Qualifications and training')} width={600}>
      {() => <TitlesManager titles={titles} archivedTitles={archivedTitles} archive={archive} canManage={canManage} versions={versions} catalog={catalog} />}
    </DialogButton>
  );
}
