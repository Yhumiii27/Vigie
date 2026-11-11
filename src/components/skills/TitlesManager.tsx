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

// Titres suivis par Vigie (D08, décision CV-01 du 04/11/2026) : un titre se choisit dans le catalogue de Cursus, qui en tient
// l'intitulé et la validité ; Vigie garde l'ordre des colonnes (HAB-15) et ses attributs propres au QHSE (CV-03).

/** Attributs propres au QHSE (secourisme, sensibilisation, auditeur interne, accueil sécurité), communs à l'ajout et à la modification. */
function LocalFlags({ title }: { title?: TrainingTitle }) {
  return (
    <>
      <Field name="awareness" label="Sensibilisation" hint="Accueil sécurité, causerie, consignes : action de sensibilisation (ISO 45001 §7.3) plutôt qu'une formation qualifiante.">
        <Checkbox name="awareness" label="Action de sensibilisation" defaultChecked={title?.awareness ?? false} />
      </Field>
      <Field name="internalAuditor" label="Auditeur interne" hint="Formation d'auditeur interne (ISO 19011…) : l'auditeur interne d'un audit sans titre valide de ce type est signalé.">
        <Checkbox name="internalAuditor" label="Qualifie un auditeur interne" defaultChecked={title?.internalAuditor ?? false} />
      </Field>
      <Field name="safetyInduction" label="Accueil sécurité" hint="Accueil sécurité du site : un intervenant d'un plan de prévention sans titre valide de ce type est signalé (PRV-23).">
        <Checkbox name="safetyInduction" label="Accueil sécurité des intervenants" defaultChecked={title?.safetyInduction ?? false} />
      </Field>
      <Field name="firstAid" label="Secourisme" hint="Titulaires en cours de validité proposés comme donneurs de soins du registre des accidents bénins.">
        <Checkbox name="firstAid" label="Sauveteur secouriste du travail (SST) ou équivalent" defaultChecked={title?.firstAid ?? false} />
      </Field>
    </>
  );
}

/** Modification des seuls attributs propres au QHSE d'un titre suivi (intitulé et validité : Cursus). */
function TitleForm({ title, version, onDone }: { title: TrainingTitle; version?: string; onDone: () => void }) {
  return (
    <ActionForm action={saveTitle} onDone={onDone} onCancel={onDone} submitLabel="Enregistrer"
      hidden={{ id: title.id, version, firstAidField: '1', awarenessField: '1', internalAuditorField: '1', safetyInductionField: '1' }}>
      <LocalFlags title={title} />
    </ActionForm>
  );
}

/** « Suivre un titre » : choix parmi les titres du catalogue de Cursus que Vigie ne suit pas encore. */
function FollowForm({ catalog, onDone }: { catalog: { choices: readonly Option[]; message: string | null }; onDone: () => void }) {
  if (catalog.message) return <div role="status" style={{ fontSize: 12.5 }}>{catalog.message}</div>;
  if (!catalog.choices.length) return <div role="status" style={{ fontSize: 12.5 }}>Tous les titres du catalogue de Cursus sont déjà suivis.</div>;
  return (
    <ActionForm action={followTitle} onDone={onDone} onCancel={onDone} submitLabel="Suivre le titre">
      <Field name="titleId" label="Titre du catalogue de Cursus" hint="Intitulé et validité sont ceux de Cursus ; un nouveau titre se demande au service RH.">
        <Select name="titleId" options={catalog.choices} placeholder="Choisir…" autoFocus />
      </Field>
      <LocalFlags />
    </ActionForm>
  );
}

/** Titre qui n'est plus suivi : date, motif, titres détenus conservés (consultation seule) et « Suivre à nouveau ». */
function ArchivedRow({ title, records, canManage }: { title: TrainingTitle; records: ArchivedRecord[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const on = title.archivedAt ? fmtDate(parisDay(new Date(title.archivedAt))) : '';
  return (
    <>
      <tr>
        <td>
          <span style={{ display: 'block', color: 'var(--color-neutral-400)' }}>{title.label}</span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
            Plus suivi depuis le {on}{title.archiveReason ? ` — ${title.archiveReason}` : ''}
          </span>
          {records.length > 0 && (
            <button type="button" className="vg-text-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)} style={{ fontSize: 11.5 }}>
              {open ? 'Masquer les titulaires' : `Voir les titulaires (${records.length})`}
            </button>
          )}
        </td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: 'var(--color-neutral-500)' }}>{title.validityMonths ? `${title.validityMonths} mois` : 'Sans échéance'}</td>
        {canManage && (
          <td style={{ textAlign: 'right', width: 1 }}>
            <ReasonButton action={restoreTitle} hidden={{ id: title.id }} label="Suivre à nouveau" className="vg-text-btn" title="Suivre à nouveau le titre"
              kicker={title.label} submitLabel="Suivre à nouveau" message="Le titre revient dans la matrice avec ses exigences."
              placeholder="Ex. habilitation de nouveau exigée" />
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
  const [editing, setEditing] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { pending, error, run } = useActionRunner();
  const close = () => setEditing(null);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
        Données tenues par Cursus (RH) : intitulé, validité, formations et habilitations. Vigie choisit les titres qu&apos;il suit dans sa matrice.
      </p>
      <table className="table" style={{ fontSize: 12.5 }}>
        <thead>
          <tr><th>Titre</th><th style={{ textAlign: 'right' }}>Validité</th>{canManage && <th aria-label="Actions" />}</tr>
        </thead>
        <tbody>
          {titles.map((t, i) => editing === t.id ? (
            <tr key={t.id}><td colSpan={3} style={{ padding: '10px 4px' }}><TitleForm title={t} version={versions?.[t.id]} onDone={close} /></td></tr>
          ) : editing === `archive:${t.id}` ? (
            <tr key={t.id}>
              <td colSpan={3} style={{ padding: '10px 4px' }}>
                <ReasonForm action={archiveTitle} hidden={{ id: t.id }} onDone={close} onCancel={close} submitLabel="Ne plus suivre" submitIcon="ph-archive"
                  message={<>« {t.label} » sera retiré de la matrice et des échéances. Les exigences sont conservées ; les titres détenus restent dans Cursus.</>}
                  placeholder="Ex. remplacé par un nouveau référentiel" />
              </td>
            </tr>
          ) : (
            <tr key={t.id}>
              <td>
                {t.label}
                <span style={{ display: 'block', fontSize: 11, color: 'var(--vg-text-muted)' }}>{t.id}{t.cursusState === 'absent' ? ' · absent du catalogue de Cursus' : ''}</span>
                {t.firstAid && <span className="tag tag-outline" style={{ fontSize: 11, marginRight: 6 }}>Secourisme</span>}
                {t.awareness && <span className="tag tag-outline" style={{ fontSize: 11, marginRight: 6 }}>Sensibilisation</span>}
                {t.internalAuditor && <span className="tag tag-outline" style={{ fontSize: 11, marginRight: 6 }}>Auditeur interne</span>}
                {t.safetyInduction && <span className="tag tag-outline" style={{ fontSize: 11 }}>Accueil sécurité</span>}
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
                    <button type="button" className="vg-text-btn" disabled={editing !== null} onClick={() => setEditing(`archive:${t.id}`)}>Ne plus suivre</button>
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
          <div className="vg-inset" style={{ padding: 12, flex: 1 }}><FollowForm catalog={catalog} onDone={close} /></div>
        ) : (
          <button type="button" className="btn btn-secondary vg-btn-sm" disabled={editing !== null} onClick={() => setEditing('new')}>
            <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />Suivre un titre de Cursus
          </button>
        ))}
        {archivedTitles.length > 0 && editing !== 'new' && (
          <button type="button" className={`vg-chip${showArchived ? ' is-on' : ''}`} aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            <i className="ph ph-archive" style={{ fontSize: 13 }} aria-hidden />Afficher les titres qui ne sont plus suivis ({archivedTitles.length})
          </button>
        )}
      </div>
      <SaveStatus pending={pending} error={error} label="Déplacement…" />
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
        {canManage && <>L&apos;ordre de la liste est celui des colonnes de la matrice (flèches). </>}Ne plus suivre un titre le retire de la matrice ;
        ses titulaires restent consultables dans les titres qui ne sont plus suivis.
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
  return (
    <DialogButton label="Titres suivis" icon="ph-list-checks" title="Titres suivis" kicker="Habilitations et formations" width={600}>
      {() => <TitlesManager titles={titles} archivedTitles={archivedTitles} archive={archive} canManage={canManage} versions={versions} catalog={catalog} />}
    </DialogButton>
  );
}
