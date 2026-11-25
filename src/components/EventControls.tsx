'use client';

import { useOptimistic, useState, useTransition, type ReactNode } from 'react';
import { ReasonButton } from '@/components/ReasonDialog';
import { advanceEvent, dismissEvent, restoreEvent, revertEvent, setAnalysisMethod } from '@/server/events';
import { METHODS } from '@/lib/domain';
import { SaveStatus } from '@/components/feedback';
import { TipButton, TipText } from '@/components/Tip';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

function useStepAction(run: () => Promise<{ error?: string }>) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const trigger = () => start(async () => {
    try {
      const r = await run();
      setError(r.error ?? null);
    } catch {
      setError(t('The operation failed. Reload the page and try again.'));
    }
  });
  const errorNote = error && <span role="alert" style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--tone-danger-fg)', textAlign: 'right' }}>{error}</span>;
  return { pending, trigger, errorNote, t };
}

/** Passage à l'étape suivante du workflow ; `hint` explique pourquoi le bouton est désactivé. */
export function AdvanceButton({ id, label, disabled, hint }: { id: string; label: string; disabled: boolean; hint?: string }) {
  const { pending, trigger, errorNote, t } = useStepAction(() => advanceEvent(id));
  return (
    <>
      {/* Infobulle accessible au clavier, aussi sur le bouton désactivé (UX-10). */}
      <TipButton className="btn btn-primary vg-btn-sm" disabled={disabled || pending} aria-busy={pending || undefined} onClick={trigger} tip={hint}>
        {pending ? t('Saving…') : label}
      </TipButton>
      {errorNote}
    </>
  );
}

/** Retour à l'étape précédente (erreur de workflow) ou réouverture d'un événement clôturé — animateur QHSE et direction, avec motif. */
export function StepBackButton({ id, label, reopen }: { id: string; label: string; reopen?: boolean }) {
  const { t } = useI18n();
  return (
    <ReasonButton label={label} title={reopen ? fill(t('Reopen {id}'), { id }) : label} kicker={id} icon={reopen ? 'ph-lock-open' : 'ph-arrow-counter-clockwise'}
      className="btn btn-ghost vg-btn-sm" tooltip={reopen ? t('Reopen to correct or complete the sheet') : t('Correct a workflow error')}
      action={revertEvent} hidden={{ id }} reasonLabel={reopen ? t('Reason for reopening') : t('Reason for going back')}
      message={reopen ? t('The sheet becomes editable again at the previous stage; the closure and its date stay in the history.') : undefined}
      submitLabel={reopen ? t('Reopen') : t('Go back')} />
  );
}

/** Classement sans suite (doublon, faux signalement, hors sujet) — animateur QHSE et direction. */
export function DismissButton({ id, disabled, tooltip }: { id: string; disabled?: boolean; tooltip?: string }) {
  const { t } = useI18n();
  return (
    <ReasonButton label={t('Dismiss')} title={fill(t('Dismiss {id}'), { id })} kicker={t('Reports and events')} icon="ph-archive"
      className="btn btn-ghost vg-btn-sm" disabled={disabled} tooltip={tooltip}
      action={dismissEvent} hidden={{ id }} reasonLabel={t('Reason for dismissal')} placeholder={t('Duplicate, false report, off topic…')}
      hint={t('Duplicate, false report, off topic… The event is kept but leaves the indicators; the dismissal can be cancelled.')}
      submitLabel={t('Dismiss')} submitIcon="ph-archive" />
  );
}

/** Annulation du classement sans suite : l'événement reprend son étape. */
export function RestoreButton({ id }: { id: string }) {
  const { t } = useI18n();
  return (
    <ReasonButton label={t('Cancel the dismissal')} title={fill(t('Cancel the dismissal of {id}'), { id })} kicker={t('Reports and events')} icon="ph-arrow-u-up-left"
      action={restoreEvent} hidden={{ id }} reasonLabel={t('Reason')} submitLabel={t('Cancel the dismissal')} />
  );
}

const Wrap = ({ tip, children }: { tip?: string; children: ReactNode }) => (tip ? <TipText tip={tip}>{children}</TipText> : <>{children}</>);

export function MethodSeg({ id, method, disabled, hint }: { id: string; method: string; disabled?: boolean; hint?: string }) {
  const { t } = useI18n();
  const [current, setCurrent] = useOptimistic(method);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const choose = (key: string) => start(async () => {
    setCurrent(key);
    try {
      const r = await setAnalysisMethod(id, key);
      setError(r.error ?? null);
    } catch {
      setError(t('The operation failed. Reload the page and try again.'));
    }
  });
  return (
    <>
      {/* Choix désactivé : la raison est lue par les lecteurs d'écran et affichée au survol (UX-10). */}
      <Wrap tip={disabled ? hint ?? t('Reserved for the QHSE coordinator and management.') : undefined}>
      <div className="seg">
        {METHODS.map(([key, label]) => (
          <label key={key} className="seg-opt" style={{ fontSize: 12, padding: '5px 10px', cursor: disabled ? 'default' : undefined, opacity: disabled && current !== key ? 0.6 : undefined }}>
            <input type="radio" name={`method-${id}`} checked={current === key} disabled={disabled} onChange={() => choose(key)} />
            {label}
          </label>
        ))}
      </div>
      </Wrap>
      <SaveStatus pending={pending} />
      {error && <span role="alert" style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--tone-danger-fg)', textAlign: 'right' }}>{error}</span>}
    </>
  );
}
