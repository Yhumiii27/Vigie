'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { advanceEvent, revertEvent, setAnalysisMethod } from '@/server/events';
import { METHODS } from '@/lib/domain';

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
      {/* Le bouton désactivé ne reçoit pas le survol : l'infobulle est portée par son conteneur. */}
      <span title={hint} style={{ display: 'inline-flex' }}>
        <button type="button" className="btn btn-primary vg-btn-sm" disabled={disabled || pending} onClick={trigger} title={hint}>
          {label}
        </button>
      </span>
      {errorNote}
    </>
  );
}

/** Retour à l'étape précédente, en cas d'erreur (animateur QHSE et direction). */
export function StepBackButton({ id, label }: { id: string; label: string }) {
  const { pending, trigger, errorNote } = useStepAction(() => revertEvent(id));
  return (
    <>
      <button type="button" className="btn btn-ghost vg-btn-sm" disabled={pending} onClick={trigger} title="Corriger une erreur de workflow">
        <i className="ph ph-arrow-counter-clockwise" style={{ fontSize: 13 }} />{label}
      </button>
      {errorNote}
    </>
  );
}

export function MethodSeg({ id, method, disabled }: { id: string; method: string; disabled?: boolean }) {
  const [current, setCurrent] = useOptimistic(method);
  const [, start] = useTransition();
  return (
    <div className="seg" title={disabled ? "Réservé à l'animateur QHSE et à l'encadrement." : undefined}>
      {METHODS.map(([key, label]) => (
        <label key={key} className="seg-opt" style={{ fontSize: 12, padding: '5px 10px', cursor: disabled ? 'default' : undefined, opacity: disabled && current !== key ? 0.6 : undefined }}>
          <input type="radio" name={`method-${id}`} checked={current === key} disabled={disabled}
            onChange={() => start(async () => { setCurrent(key); await setAnalysisMethod(id, key); })} />
          {label}
        </label>
      ))}
    </div>
  );
}
