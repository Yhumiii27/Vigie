'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { ActionFields } from '@/components/ActionFormDialog';
import { ReasonForm } from '@/components/ReasonDialog';
import { Dot, Icon, ToneTag } from '@/components/ui';
import { QHSE_ONLY_CREATE_MESSAGE, actionHref } from '@/lib/action-rules';
import { fmtDate } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { DocumentRow, LinkedAction, VersionView } from '@/lib/data/documents';
import { abandonDraft, approveVersion, obsoleteDocument, returnToDraft, submitVersion } from '@/server/documents';
import { ConfirmForm, DraftForm, MetadataForm, RevisionForm, type DocFormOptions } from './DocumentForms';
import { documentActionDefaults } from './action-defaults';
import { nextVersion } from './meta';

type Mode = 'view' | 'edit' | 'revise' | 'draft' | 'submit' | 'approve' | 'return' | 'abandon' | 'obsolete' | 'action';

const APPROVER_ONLY = "Réservé à l'animateur QHSE et à la direction.";

const H6 = ({ children }: { children: ReactNode }) => <h6 className="vg-h6">{children}</h6>;

function Meta({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 2, minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>{label}</span>
      <span style={{ fontSize: 12.5, textWrap: 'pretty' }}>{children}</span>
    </div>
  );
}

export function ActionLink({ action }: { action: LinkedAction }) {
  return (
    <Link href={actionHref(action.id)} className="vg-link" title={`${action.label} · ${action.statusLabel}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
      <Dot color={TONE[action.tone].dot} size={6} />{action.id}
    </Link>
  );
}

function FileLink({ file }: { file: NonNullable<VersionView['file']> }) {
  return (
    <a href={`/fichiers/${file.id}`} target="_blank" rel="noopener noreferrer" className="vg-link" title={file.name}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: 150, minWidth: 0 }}>
      <Icon name="ph-file-text" size={13} style={{ flex: 'none' }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
    </a>
  );
}

const reviewText = (doc: DocumentRow) => {
  if (!doc.nextReviewOn || doc.reviewDays == null) return null;
  if (doc.overdue) return `Revue périodique dépassée depuis le ${fmtDate(doc.nextReviewOn)} (+${-doc.reviewDays} j).`;
  return `Revue périodique prévue le ${fmtDate(doc.nextReviewOn)} (${doc.reviewDays === 0 ? "aujourd'hui" : `dans ${doc.reviewDays} j`}).`;
};

/** Contenu de la fiche d'un document : informations, cycle de vie de la version en cours et historique. */
export function DocumentPanel({ doc, canManage, canApprove, options, suggestedDueOn }: {
  doc: DocumentRow; canManage: boolean; canApprove: boolean; options: DocFormOptions; suggestedDueOn: string;
}) {
  const [mode, setMode] = useState<Mode>('view');
  // Création d'action : service QHSE seulement (ACT-22), qui reçoit seul le formulaire d'action.
  const actionForm = options.actionForm;
  // Action de revue (encadré « revue dépassée ») ou action libre (« Nouvelle action »).
  const [reviewAction, setReviewAction] = useState(true);
  const newAction = (review: boolean) => { setReviewAction(review); setMode('action'); };
  const back = () => setMode('view');
  const { current, pending } = doc;
  const obsolete = doc.status === 'obsolete';
  const next = nextVersion(doc.versions.map((v) => v.version));
  const approveHint = canApprove ? undefined : APPROVER_ONLY;
  // Sans version en vigueur, abandonner le brouillon retire le document : même droit que « Rendre obsolète ».
  const abandonLocked = !current && !canApprove;

  const buttons: ReactNode[] = [];
  if (canManage && mode === 'view') {
    // Le retrait reste possible pendant une révision en cours : celle-ci est alors abandonnée.
    if (current && pending) {
      buttons.push(
        <button key="obsolete" type="button" className="btn btn-ghost vg-btn-sm" style={{ color: 'var(--color-neutral-400)' }} disabled={!canApprove} title={approveHint} onClick={() => setMode('obsolete')}><Icon name="ph-prohibit" size={13} />Rendre obsolète</button>,
      );
    }
    if (pending?.status === 'brouillon') {
      buttons.push(
        <button key="abandon" type="button" className="btn btn-ghost vg-btn-sm" style={{ color: 'var(--color-neutral-400)' }} disabled={abandonLocked} title={abandonLocked ? APPROVER_ONLY : undefined} onClick={() => setMode('abandon')}>Abandonner</button>,
        <button key="draft" type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setMode('draft')}><Icon name="ph-pencil-simple" size={13} />Modifier le brouillon</button>,
        <button key="submit" type="button" className="btn btn-primary vg-btn-sm" onClick={() => setMode('submit')}><Icon name="ph-paper-plane-tilt" size={13} />Soumettre en revue</button>,
      );
    } else if (pending?.status === 'en_revue') {
      buttons.push(
        <button key="return" type="button" className="btn btn-secondary vg-btn-sm" disabled={!canApprove} title={approveHint} onClick={() => setMode('return')}><Icon name="ph-arrow-u-up-left" size={13} />Renvoyer en brouillon</button>,
        <button key="approve" type="button" className="btn btn-primary vg-btn-sm" disabled={!canApprove} title={approveHint} onClick={() => setMode('approve')}><Icon name="ph-seal-check" size={13} />Approuver la version {pending.version}</button>,
      );
    } else if (current) {
      buttons.push(
        <button key="obsolete" type="button" className="btn btn-secondary vg-btn-sm" disabled={!canApprove} title={approveHint} onClick={() => setMode('obsolete')}><Icon name="ph-prohibit" size={13} />Rendre obsolète</button>,
        <button key="revise" type="button" className="btn btn-primary vg-btn-sm" onClick={() => setMode('revise')}><Icon name="ph-git-branch" size={13} />Nouvelle révision</button>,
      );
    } else if (doc.abandoned) {
      // Abandonné avant toute approbation : la référence reste attribuée, le document peut repartir en rédaction.
      buttons.push(
        <button key="revise" type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setMode('revise')}><Icon name="ph-arrow-counter-clockwise" size={13} />Relancer · version {next}</button>,
      );
    }
  }

  const review = reviewText(doc);
  const showReview = !!review && (doc.overdue || doc.dueSoon) && mode === 'view';

  return (
    <div style={{ display: 'grid', gap: 16, marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <ToneTag tone={doc.statusTone}>{doc.statusLabel}</ToneTag>
        {current?.approvedOn && <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>Version {current.version} en vigueur depuis le {fmtDate(current.approvedOn)}</span>}
        {pending && (
          <span style={{ fontSize: 12, color: pending.status === 'en_revue' ? TONE.warn.dot : 'var(--color-neutral-400)' }}>
            {current ? '· ' : ''}{current ? 'révision' : 'version'} {pending.version} {pending.status === 'en_revue' ? `en revue depuis le ${pending.submittedOn ? fmtDate(pending.submittedOn) : '—'}` : 'en brouillon'}
          </span>
        )}
        {(buttons.length > 0 || current?.file) && (
          <span style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 }}>
            {current?.file && mode === 'view' && (
              <a href={`/fichiers/${current.file.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary vg-btn-sm" title={current.file.name}>
                <Icon name="ph-file-arrow-down" size={13} />Ouvrir la version {current.version}
              </a>
            )}
            {buttons}
          </span>
        )}
      </div>

      {obsolete && doc.retired && mode === 'view' && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', background: TONE.neutral.bg }}>
          <Icon name="ph-prohibit" size={14} style={{ color: 'var(--color-neutral-400)', flex: 'none', alignSelf: 'center' }} />
          <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
            Rendu obsolète le {fmtDate(doc.retired.on)} par {doc.retired.by}.{doc.retired.reason && <> Motif : {doc.retired.reason}</>}
          </span>
        </div>
      )}

      {showReview && (
        <div className="vg-inset" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', boxShadow: `inset 2px 0 0 ${doc.overdue ? TONE.danger.dot : TONE.warn.dot}` }}>
          <Icon name="ph-clock-countdown" size={16} style={{ color: doc.overdue ? TONE.danger.dot : TONE.warn.dot }} />
          <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 220 }}>
            <span style={{ fontSize: 12.5 }}>{review}</span>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
              Une revue sans modification se trace aussi par une nouvelle révision (objet « Revue périodique sans modification »).
            </span>
          </div>
          {doc.reviewActions.length > 0 ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-neutral-400)' }}>
              Action{doc.reviewActions.length > 1 ? 's' : ''} {doc.reviewActions.map((a) => <ActionLink key={a.id} action={a} />)}
            </span>
          ) : actionForm ? (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => newAction(true)}><Icon name="ph-list-plus" size={13} />Créer une action</button>
          ) : canManage && (
            <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{QHSE_ONLY_CREATE_MESSAGE}</span>
          )}
        </div>
      )}

      {mode === 'view' && (
        <>
          <section style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <H6>Informations</H6>
              {canManage && !obsolete && (
                <span style={{ display: 'flex', gap: 14 }}>
                  {actionForm && <button type="button" className="vg-text-btn" onClick={() => newAction(false)}>Nouvelle action</button>}
                  <button type="button" className="vg-text-btn" onClick={() => setMode('edit')}>Modifier</button>
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 16px' }}>
              <Meta label="Référence">{doc.id}</Meta>
              <Meta label="Type">{doc.typeLabel}</Meta>
              <Meta label="Processus">{doc.processLabel}</Meta>
              <Meta label="Propriétaire">{doc.owner}</Meta>
              <Meta label="Périodicité de revue">{doc.reviewMonths} mois</Meta>
              <Meta label="Prochaine revue">
                <span style={{ color: doc.overdue ? TONE.danger.dot : doc.dueSoon ? TONE.warn.dot : undefined }}>{doc.nextReviewOn ? fmtDate(doc.nextReviewOn) : '—'}</span>
              </Meta>
              <Meta label="Site">{doc.siteLabel}</Meta>
              <Meta label="Diffusion" wide>{doc.distribution || '—'}</Meta>
            </div>
          </section>

          {!showReview && doc.reviewActions.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--color-neutral-400)' }}>
              <H6>Actions liées</H6>
              {doc.reviewActions.map((a) => <span key={a.id} style={{ display: 'inline-flex', gap: 6 }}><ActionLink action={a} /><span>{a.label}</span></span>)}
            </div>
          )}

          <section style={{ display: 'grid', gap: 8 }}>
            {/* Consultation seule : la version en vigueur, sans l'historique ni les actions liées. */}
            <H6>{canManage ? 'Historique des versions' : 'Version en vigueur'}</H6>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: 12, minWidth: canManage ? 820 : 640 }}>
                <thead>
                  <tr>
                    <th>Version</th><th>Statut</th><th>Objet de la modification</th><th>Auteur</th><th>Approbateur</th>
                    {canManage && <th>Soumis le</th>}<th>Approuvé le</th><th>Fichier</th>{canManage && <th>Action liée</th>}
                  </tr>
                </thead>
                <tbody>
                  {doc.versions.map((v) => (
                    <tr key={v.id} style={v.status === 'archive' ? { color: 'var(--color-neutral-400)' } : undefined}>
                      <td style={{ fontWeight: 500 }}>{v.version}</td>
                      <td><ToneTag tone={v.tone} style={{ whiteSpace: 'nowrap' }}>{v.statusLabel}</ToneTag></td>
                      <td style={{ minWidth: 220, textWrap: 'pretty' }}>{v.summary || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{v.author}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{v.approver}</td>
                      {canManage && <td style={{ whiteSpace: 'nowrap' }}>{v.submittedOn ? fmtDate(v.submittedOn) : '—'}</td>}
                      <td style={{ whiteSpace: 'nowrap' }}>{v.approvedOn ? fmtDate(v.approvedOn) : '—'}</td>
                      <td>{v.file ? <FileLink file={v.file} /> : <span className="vg-muted">—</span>}</td>
                      {canManage && <td>{v.action ? <ActionLink action={v.action} /> : <span className="vg-muted">—</span>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {mode !== 'view' && (
        <section style={{ display: 'grid', gap: 10 }}>
          <H6>{MODE_TITLE[mode](doc, next)}</H6>
          {mode === 'edit' && <MetadataForm doc={doc} options={options} onDone={back} onCancel={back} />}
          {mode === 'revise' && <RevisionForm doc={doc} version={next} options={options} onDone={back} onCancel={back} />}
          {mode === 'draft' && pending && <DraftForm version={pending} options={options} onDone={back} onCancel={back} />}
          {mode === 'submit' && pending && (
            <ConfirmForm action={submitVersion} hidden={{ versionId: pending.id }} submitLabel="Soumettre en revue" submitIcon="ph-paper-plane-tilt" onDone={back} onCancel={back}
              message={<>La version {pending.version} est transmise pour approbation à l&apos;animateur QHSE ou à la direction. Elle n&apos;est plus modifiable, sauf renvoi en brouillon.{!pending.file && <> Aucun fichier n&apos;est joint à cette version.</>}</>} />
          )}
          {mode === 'approve' && pending && (
            <ConfirmForm action={approveVersion} hidden={{ versionId: pending.id }} submitLabel={`Approuver la version ${pending.version}`} submitIcon="ph-seal-check" onDone={back} onCancel={back}
              message={<>La version {pending.version} entre en vigueur ce jour{current ? <> et remplace la version {current.version}, qui est archivée</> : null}. Diffusion attendue : {doc.distribution || 'à préciser'}.</>} />
          )}
          {mode === 'return' && pending && (
            <ConfirmForm action={returnToDraft} hidden={{ versionId: pending.id }} submitLabel="Renvoyer en brouillon" onDone={back} onCancel={back}
              message={<>La version {pending.version} repasse en brouillon pour correction par son auteur ({pending.author}){current ? <> ; la version {current.version} reste en vigueur</> : null}.</>} />
          )}
          {mode === 'abandon' && pending && (
            <ConfirmForm action={abandonDraft} hidden={{ versionId: pending.id }} submitLabel="Abandonner le brouillon" onDone={back} onCancel={back}
              message={current
                ? <>Le brouillon {pending.version} est abandonné et conservé dans l&apos;historique ; la version {current.version} reste en vigueur.</>
                : <>Le brouillon {pending.version} est abandonné. Le document n&apos;ayant jamais été approuvé, il est classé « Abandonné » et conservé pour traçabilité ; il pourra être relancé par une nouvelle version.</>} />
          )}
          {mode === 'obsolete' && current && (
            <ReasonForm action={obsoleteDocument} hidden={{ documentId: doc.id }} submitLabel="Rendre obsolète" submitIcon="ph-prohibit" onDone={back} onCancel={back}
              reasonLabel="Motif du retrait" placeholder="Ex. remplacé par un autre document, activité arrêtée, exigence abrogée…"
              message={<>La version {current.version} est retirée de la diffusion et archivée{pending ? <> ; la révision {pending.version} {pending.status === 'en_revue' ? 'en revue' : 'en cours'} est abandonnée</> : null}. Le document est classé obsolète et reste consultable pour traçabilité ; pensez à retirer les exemplaires diffusés ({doc.distribution || 'diffusion non précisée'}).</>} />
          )}
          {mode === 'action' && actionForm && (
            // Version en cours sans action : rattachée à la nouvelle action (qui porte aussi le document) ; sinon le
            // document lui-même (la version en vigueur garde l'action qui l'a fait naître).
            <ActionFields options={actionForm} onDone={back} onCancel={back} defaults={documentActionDefaults(doc, { review: reviewAction, suggestedDueOn })} />
          )}
        </section>
      )}
    </div>
  );
}

const MODE_TITLE: Record<Exclude<Mode, 'view'>, (doc: DocumentRow, next: string) => string> = {
  edit: () => 'Modifier les informations',
  revise: (d, next) => `${d.abandoned ? 'Relancer le document' : 'Nouvelle révision'} · version ${next}`,
  draft: (d) => `Brouillon de la version ${d.pending?.version ?? ''}`,
  submit: (d) => `Soumettre la version ${d.pending?.version ?? ''} en revue`,
  approve: (d) => `Approuver la version ${d.pending?.version ?? ''}`,
  return: (d) => `Renvoyer la version ${d.pending?.version ?? ''} en brouillon`,
  abandon: (d) => `Abandonner le brouillon ${d.pending?.version ?? ''}`,
  obsolete: (d) => `Rendre obsolète ${d.id}`,
  action: () => "Nouvelle action · plan d'actions unique",
};
