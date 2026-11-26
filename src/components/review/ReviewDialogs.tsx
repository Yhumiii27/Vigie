'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { ActionForm, Checkbox, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ReasonButton, ReasonForm } from '@/components/ReasonDialog';
import { DeleteButton } from '@/components/audits/parts';
import { fmtDate } from '@/lib/dates';
import { REVIEW_DECISION_KINDS, REVIEW_DECISION_KEYS, REVIEW_KINDS, REVIEW_KIND_KEYS, REVIEW_SOURCES, REVIEW_SOURCE_KEYS, type ReviewKind } from '@/lib/domain';
import type { Option } from '@/lib/data/options';
import type { DecisionView, ReviewItemView, ReviewView } from '@/lib/data/review';
import {
  abandonReviewDecision, addReviewCorrection, cancelReview, closeReview, createReview, deleteReviewDecision, deleteReviewItem, holdReview, rescheduleReview,
  saveReviewDecision, saveReviewItem,
} from '@/server/review';
import styles from './review.module.css';
import { withCurrent } from '@/lib/form-options';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

const SOURCE_OPTIONS = REVIEW_SOURCE_KEYS.map((k) => [k, REVIEW_SOURCES[k].label] as const);
const KIND_OPTIONS = REVIEW_KIND_KEYS.map((k) => [k, REVIEW_KINDS[k].label] as const);
const DECISION_OPTIONS = REVIEW_DECISION_KEYS.map((k) => [k, REVIEW_DECISION_KINDS[k].label] as const);


function Footer({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}

// ─── Élément d'entrée de la check-list ──────────────────────────────────────

export function ItemForm({ reviewId, version, item, people, canDelete, onClose }: {
  reviewId: number; item?: ReviewItemView; people: readonly Option[]; canDelete: boolean; onClose: () => void;
  /** QUA-12 : version de la revue à l'ouverture de la page. */
  version?: string;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState<string>(item?.source ?? 'manuel');
  const auto = REVIEW_SOURCES[source as keyof typeof REVIEW_SOURCES]?.auto ?? false;
  return (
    <>
      <ActionForm action={saveReviewItem} onDone={onClose} onCancel={onClose} submitLabel={item ? t('Save') : t('Add')}
        hidden={{ id: item?.id, reviewId: item ? undefined : reviewId, version: item ? version : undefined }}>
        <Field name="label" label={t('Review input item')} hint={t('E.g. Supplier performance, Internal audit results.')}>
          <Input name="label" defaultValue={item?.label} maxLength={160} autoFocus />
        </Field>
        <Field name="source" label={t('Source')}
          hint={auto ? t('Computed by Vigie: provided as soon as the data of the section exist in the file.') : t('Item handed in by a contributor, ticked on receipt.')}>
          <Select name="source" options={SOURCE_OPTIONS} defaultValue={item?.source ?? 'manuel'} onChange={(e) => setSource(e.target.value)} />
        </Field>
        {!auto && (
          <>
            <FormRow>
              <Field name="ownerId" label={t('Provided by')}>
                <Select name="ownerId" options={withCurrent(people, item?.ownerId)} defaultValue={item?.ownerId ?? ''} placeholder={t('Outside the directory / Vigie')} />
              </Field>
              <Field name="dueOn" label={t('Expected on')}>
                <Input name="dueOn" type="date" defaultValue={item?.dueOn ?? ''} />
              </Field>
            </FormRow>
            <Field name="owner" label={t('Detail')} hint={t('Contributor outside the directory, action reference (e.g. A-184)…')}>
              <Input name="owner" defaultValue={item?.owner} maxLength={80} />
            </Field>
            {!item && <Checkbox name="done" label={t('Already provided')} />}
          </>
        )}
      </ActionForm>
      {item && canDelete && (
        <Footer>
          <DeleteButton run={() => deleteReviewItem(item.id)} onDone={onClose} label={t('Remove from the checklist')} note={t('Preparation data: permanent removal.')} />
        </Footer>
      )}
    </>
  );
}

// ─── Décision, objectif ou besoin en ressources ─────────────────────────────

export function DecisionForm({ reviewId, version, decision, people, canDelete, onClose }: {
  reviewId: number; decision?: DecisionView; people: readonly Option[]; canDelete: boolean; onClose: () => void;
  version?: string;
}) {
  const { t } = useI18n();
  return (
    <>
      <ActionForm action={saveReviewDecision} onDone={onClose} onCancel={onClose} submitLabel={decision ? t('Save') : t('Add')}
        hidden={{ id: decision?.id, reviewId: decision ? undefined : reviewId, version: decision ? version : undefined }}>
        <Field name="kind" label={t('Nature')}>
          <Select name="kind" options={DECISION_OPTIONS} defaultValue={decision?.kind ?? 'decision'} />
        </Field>
        <Field name="text" label={t('Title')} hint={t('§9.3.3: improvement opportunities, changes to the system, resource needs.')}>
          <TextArea name="text" rows={3} maxLength={400} defaultValue={decision?.text} autoFocus />
        </Field>
        <FormRow>
          <Field name="pilotId" label={t('Lead')}>
            <Select name="pilotId" options={withCurrent(people, decision?.pilotId, decision?.pilot)} defaultValue={decision?.pilotId ?? ''} placeholder={t('To appoint')} />
          </Field>
          <Field name="dueOn" label={t('Deadline')}>
            <Input name="dueOn" type="date" defaultValue={decision?.dueOn ?? ''} />
          </Field>
        </FormRow>
      </ActionForm>
      {decision && canDelete && !decision.actionId && (
        <Footer>
          <DeleteButton run={() => deleteReviewDecision(decision.id)} onDone={onClose} label={t('Remove')} note={t('Draft decision before the meeting: permanent removal.')} />
        </Footer>
      )}
    </>
  );
}

// ─── Compte rendu de la séance ──────────────────────────────────────────────

export function HoldForm({ review, version, people, now, next, allSites, onClose }: {
  review: ReviewView; version?: string; people: readonly Option[]; now: string; next: { on: string; kind: ReviewKind }; allSites: boolean; onClose: () => void;
}) {
  const { t } = useI18n();
  const chosen = new Set(review.participantIds);
  // Participants déjà enregistrés mais sortis de l'effectif : conservés dans la liste.
  const departed = review.participantIds.filter((id) => !people.some(([v]) => v === id)).map((id) => [id, review.participants[review.participantIds.indexOf(id)] ?? id] as const);
  const list = [...people, ...departed].map(([v, l]) => [v, l.split(' — ')[0]] as const);
  return (
    <ActionForm action={holdReview} onDone={onClose} onCancel={onClose} hidden={{ id: review.id, version }}
      submitLabel={review.status === 'tenue' ? t('Save the minutes') : t('Save · review held')}>
      {/* Première saisie : le dossier de séance est figé (indicateurs arrêtés à la date de la séance, AUD-06) sur tout le périmètre. */}
      <p style={{ margin: 0, fontSize: 12, color: !allSites && !review.seanceFrozen ? 'var(--tone-warn-fg)' : 'var(--color-neutral-500)', textWrap: 'pretty' }}>
        {review.seanceFrozen
          ? t('Meeting file frozen at the first entry: correcting it does not recompute its indicators, unless the meeting date changes (“All sites” required).')
          : t('When saved, the meeting file is frozen with the indicators set on the meeting date.') + (allSites ? '' : t(' Select “All sites” first: it covers the whole scope.'))}
      </p>
      <Field name="reviewOn" label={t('Meeting date')} hint={t('Correct it if the review took place on another day.')}>
        <Input name="reviewOn" type="date" defaultValue={review.reviewOn <= now ? review.reviewOn : now} max={now} />
      </Field>
      <Field name="participantIds" label={t('Participants')}>
        <div className={styles.people}>
          {list.map(([id, label]) => (
            <label key={id} className="vg-check">
              <input type="checkbox" name="participantIds" value={id} defaultChecked={chosen.has(id)} />
              <span className="vg-check-box"><i className="ph ph-check" aria-hidden /></span>
              <span>{label}</span>
            </label>
          ))}
        </div>
      </Field>
      <Field name="externalParticipants" label={t('Other participants')} hint={t('Outside the directory: CSE representatives, body, consultant…')}>
        <Input name="externalParticipants" defaultValue={review.externalParticipants ?? ''} maxLength={300} />
      </Field>
      <Field name="customerPerception" label={t('Customer perception (§9.3.2 c1)')} hint={t('Customer feedback, surveys, on-time delivery.')}>
        <TextArea name="customerPerception" rows={3} maxLength={2000} defaultValue={review.customerPerception ?? ''} />
      </Field>
      <Field name="resourceNeeds" label={t('Resource needs (§9.3.3 c)')} hint={t('Headcount, equipment, budget, trainings to schedule.')}>
        <TextArea name="resourceNeeds" rows={3} maxLength={2000} defaultValue={review.resourceNeeds ?? ''} />
      </Field>
      <Field name="minutes" label={t('Minutes and conclusions')}>
        <TextArea name="minutes" rows={5} maxLength={4000} defaultValue={review.minutes ?? ''} />
      </Field>
      <FormRow>
        <Field name="nextReviewOn" label={t('Next review on')} hint={t('Next review already planned: postponed to this date if needed; otherwise created (checklist taken over) with its deadline in the programme.')}>
          <Input name="nextReviewOn" type="date" defaultValue={next.on} />
        </Field>
        <Field name="nextKind" label={t('Type of the next review')}>
          <Select name="nextKind" options={KIND_OPTIONS} defaultValue={next.kind} />
        </Field>
      </FormRow>
    </ActionForm>
  );
}

// ─── Nouvelle revue, report ─────────────────────────────────────────────────

export function CreateReviewForm({ nextOn, kind, copyFrom, copyLabel, onClose }: {
  nextOn: string; kind: ReviewKind; copyFrom: number | null; copyLabel: string | null; onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <ActionForm action={createReview} onDone={onClose} onCancel={onClose} hidden={{ copyFrom }} submitLabel={t('Plan the review')}>
      <FormRow>
        <Field name="reviewOn" label={t('Review date')}>
          <Input name="reviewOn" type="date" defaultValue={nextOn} autoFocus />
        </Field>
        <Field name="kind" label={t('Type')}>
          <Select name="kind" options={KIND_OPTIONS} defaultValue={kind} />
        </Field>
      </FormRow>
      {copyFrom && copyLabel && <Checkbox name="copyItems" label={fill(t('Take over the checklist of the {review}'), { review: copyLabel.toLowerCase() })} defaultChecked />}
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-500)', textWrap: 'pretty' }}>
        {t('The review is entered in the annual programme: it takes over the review deadline already planned that month, otherwise it is added to the “Management reviews” line.')}
      </p>
    </ActionForm>
  );
}

export function RescheduleForm({ review, onClose }: { review: ReviewView; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <ReasonForm action={rescheduleReview} onDone={onClose} onCancel={onClose} hidden={{ id: review.id }} submitLabel={t('Postpone the review')}
      placeholder={t('E.g. Management unavailable')} before={(
        <Field name="to" label={t('New date')} hint={t('The deadline of the review in the annual programme is postponed to this date (first date kept).')}>
          <Input name="to" type="date" defaultValue={review.reviewOn} autoFocus />
        </Field>
      )} />
  );
}

// ─── Clôture et annulation (animateur QHSE, direction) ──────────────────────

/** Visa de la direction : confirmation en ligne, puis clôture et dossier figé. */
export function CloseReviewButton({ id, allSites }: { id: number; allSites: boolean }) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!asking) {
    return (
      <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setAsking(true)}
        title={t('Management sign-off: the review file is frozen and no longer recomputed.')}>
        <i className="ph ph-seal-check" style={{ fontSize: 13 }} aria-hidden />{t('Close and freeze the file')}
      </button>
    );
  }
  return (
    <span style={{ display: 'grid', gap: 6, flexBasis: '100%' }}>
      <span style={{ fontSize: 12, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
        {t('The file is frozen with the indicators set on the meeting date (meeting file and minutes) and can no longer be changed.')}
        {!allSites && t(' Select “All sites” first: the archived file covers the whole scope.')}
      </span>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending} onClick={() => { setAsking(false); setError(null); }}>{t('Cancel')}</button>
        <button type="button" className="btn btn-primary vg-btn-sm" disabled={pending || !allSites}
          onClick={() => start(async () => {
            const r = await closeReview(id);
            if (r.error) setError(r.error);
            else setAsking(false);
          })}>
          <i className="ph ph-seal-check" style={{ fontSize: 13 }} aria-hidden />{pending ? t('Closing…') : t('Confirm the closing')}
        </button>
      </span>
      {error && <span role="alert" style={{ fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>{error}</span>}
    </span>
  );
}

/** Décision abandonnée après la séance (AUD-36) : motif obligatoire, la décision reste affichée barrée. */
export function AbandonDecisionButton({ decision }: { decision: DecisionView }) {
  const { t } = useI18n();
  return (
    <ReasonButton action={abandonReviewDecision} hidden={{ id: decision.id }} label={t('Abandon')} className="vg-text-btn"
      title={fill(t('{kind} abandoned'), { kind: decision.kindLabel })} kicker={decision.text.length > 80 ? `${decision.text.slice(0, 79)}…` : decision.text} submitLabel={t('Abandon')}
      message={t('The decision is never removed from the minutes: it stays shown struck through with the date, the author and the reason, and no longer gives a “no follow-up” deadline.')}
      placeholder={t('E.g. objective taken over by the decision of the next review')} />
  );
}

/**
 * Rectificatif d'une revue clôturée (AUD-34), signé par la direction : ajout daté et motivé, affiché avec le dossier figé
 * (qui ne change pas) et à l'historique de la revue.
 */
export function CorrectionButton({ review }: { review: ReviewView }) {
  const { t } = useI18n();
  return (
    <ReasonButton action={addReviewCorrection} hidden={{ id: review.id }} label={t('Add a correction')} icon="ph-pen-nib" className="btn btn-ghost vg-btn-sm"
      title={t('Correction of the review')} kicker={fill(t('Management review of {date}'), { date: fmtDate(review.reviewOn) })} submitLabel={t('Sign the correction')}
      message={t('The file frozen at the sign-off does not change: the correction is added to it, dated and signed in your name, and can no longer be changed (an error is corrected by a new correction).')}
      placeholder={t('E.g. entry error noted by the CSE')} before={(
        <Field name="text" label={t('Correction')} hint={t('What is corrected in the file and the correction made.')}>
          <TextArea name="text" rows={4} maxLength={2000} autoFocus />
        </Field>
      )} />
  );
}

export function CancelReviewButton({ review }: { review: ReviewView }) {
  const { t } = useI18n();
  return (
    <ReasonButton action={cancelReview} hidden={{ id: review.id }} label={t('Cancel the review')} icon="ph-x-circle" className="btn btn-ghost vg-btn-sm"
      title={t('Cancel the review')} kicker={fill(t('Management review of {date}'), { date: fmtDate(review.reviewOn) })} submitLabel={t('Cancel the review')}
      message={t('The review and its checklist stay viewable in the history (“Show the cancelled ones” filter). Its deadline in the annual programme is cancelled with it (“Cancelled items” list).')}
      placeholder={t('E.g. Review grouped with the annual review')} />
  );
}
