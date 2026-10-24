'use client';

import { useOptimistic, useState, useTransition, type ReactNode } from 'react';
import { ReasonButton } from '@/components/ReasonDialog';
import { advanceEvent, dismissEvent, restoreEvent, revertEvent, setAnalysisMethod } from '@/server/events';
import { METHODS } from '@/lib/domain';
import { SaveStatus } from '@/components/feedback';
import { TipButton, TipText } from '@/components/Tip';

function useStepAction(run: () => Promise<{ error?: string }>) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const trigger = () => start(async () => {
    try {
      const r = await run();
      setError(r.error ?? null);
    } catch {
      setError("L'opération a échoué. Rechargez la page puis réessayez.");
    }
  });
  const errorNote = error && <span role="alert" style={{ flexBasis: '100%', fontSize: 11.5, color: 'var(--tone-danger-fg)', textAlign: 'right' }}>{error}</span>;
  return { pending, trigger, errorNote };
}

/** Passage à l'étape suivante du workflow ; `hint` explique pourquoi le bouton est désactivé. */
export function AdvanceButton({ id, label, disabled, hint }: { id: string; label: string; disabled: boolean; hint?: string }) {
  const { pending, trigger, errorNote } = useStepAction(() => advanceEvent(id));
  return (
    <>
      {/* Infobulle accessible au clavier, aussi sur le bouton désactivé (UX-10). */}
      <TipButton className="btn btn-primary vg-btn-sm" disabled={disabled || pending} aria-busy={pending || undefined} onClick={trigger} tip={hint}>
        {pending ? 'Enregistrement…' : label}
      </TipButton>
      {errorNote}
    </>
  );
}

/** Retour à l'étape précédente (erreur de workflow) ou réouverture d'un événement clôturé — animateur QHSE et direction, avec motif. */
export function StepBackButton({ id, label, reopen }: { id: string; label: string; reopen?: boolean }) {
  return (
    <ReasonButton label={label} title={reopen ? `Rouvrir ${id}` : label} kicker={id} icon={reopen ? 'ph-lock-open' : 'ph-arrow-counter-clockwise'}
      className="btn btn-ghost vg-btn-sm" tooltip={reopen ? 'Rouvrir pour corriger ou compléter la fiche' : 'Corriger une erreur de workflow'}
      action={revertEvent} hidden={{ id }} reasonLabel={reopen ? 'Motif de la réouverture' : 'Motif du retour'}
      message={reopen ? "La fiche redevient modifiable à l'étape précédente ; la clôture et sa date restent dans l'historique." : undefined}
      submitLabel={reopen ? 'Rouvrir' : 'Revenir'} />
  );
}

/** Classement sans suite (doublon, faux signalement, hors sujet) — animateur QHSE et direction. */
export function DismissButton({ id, disabled, tooltip }: { id: string; disabled?: boolean; tooltip?: string }) {
  return (
    <ReasonButton label="Classer sans suite" title={`Classer ${id} sans suite`} kicker="Signalements et événements" icon="ph-archive"
      className="btn btn-ghost vg-btn-sm" disabled={disabled} tooltip={tooltip}
      action={dismissEvent} hidden={{ id }} reasonLabel="Motif du classement" placeholder="Doublon, faux signalement, hors sujet…"
      hint="Doublon, faux signalement, hors sujet… L'événement est conservé mais sort des indicateurs ; le classement peut être annulé."
      submitLabel="Classer sans suite" submitIcon="ph-archive" />
  );
}

/** Annulation du classement sans suite : l'événement reprend son étape. */
export function RestoreButton({ id }: { id: string }) {
  return (
    <ReasonButton label="Annuler le classement" title={`Annuler le classement de ${id}`} kicker="Signalements et événements" icon="ph-arrow-u-up-left"
      action={restoreEvent} hidden={{ id }} reasonLabel="Motif" submitLabel="Annuler le classement" />
  );
}

const Wrap = ({ tip, children }: { tip?: string; children: ReactNode }) => (tip ? <TipText tip={tip}>{children}</TipText> : <>{children}</>);

export function MethodSeg({ id, method, disabled, hint }: { id: string; method: string; disabled?: boolean; hint?: string }) {
  const [current, setCurrent] = useOptimistic(method);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const choose = (key: string) => start(async () => {
    setCurrent(key);
    try {
      const r = await setAnalysisMethod(id, key);
      setError(r.error ?? null);
    } catch {
      setError("L'opération a échoué. Rechargez la page puis réessayez.");
    }
  });
  return (
    <>
      {/* Choix désactivé : la raison est lue par les lecteurs d'écran et affichée au survol (UX-10). */}
      <Wrap tip={disabled ? hint ?? "Réservé à l'animateur QHSE et à l'encadrement." : undefined}>
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
