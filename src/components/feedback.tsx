'use client';

import { unstable_rethrow } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { FAILURE_MESSAGE, feedbackOf, type Feedback, type FeedbackTone } from '@/lib/feedback';

// Retours d'état communs (UX-14) : annonce d'un enregistrement ou d'un échec (`announce`, affichée et lue par le
// `StatusToaster` de la coque), exécution d'une server action sans formulaire avec attente et erreur (`useActionRunner`),
// indicateur en ligne (`SaveStatus`). Règles pures (messages, résultat d'une action) : src/lib/feedback.ts.

export const ANNOUNCE_EVENT = 'vg:announce';

/** Annonce un message à la coque (toast lu par les lecteurs d'écran) ; sans effet hors de la coque (/signaler). */
export function announce(message: string, tone: FeedbackTone = 'ok') {
  if (typeof window === 'undefined' || !message) return;
  window.dispatchEvent(new CustomEvent<Feedback>(ANNOUNCE_EVENT, { detail: { message, tone } }));
}

const TOAST_MS = 5000;

/**
 * Région d'annonce de la coque : toujours présente dans la page (les lecteurs d'écran ne lisent une région vive que si elle
 * existe avant le message). Confirmations dans une région `status` (polie), échecs dans une région `alert` ; chaque message
 * disparaît après 5 s ou par « Fermer ».
 */
export function StatusToaster() {
  const [items, setItems] = useState<(Feedback & { id: number })[]>([]);
  const next = useRef(0);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onAnnounce = (e: Event) => {
      const detail = (e as CustomEvent<Feedback>).detail;
      if (!detail?.message) return;
      const id = ++next.current;
      // Même message répété : un seul toast (le plus récent).
      setItems((list) => [...list.filter((i) => i.message !== detail.message).slice(-2), { ...detail, id }]);
      const t = setTimeout(() => { timers.delete(t); setItems((list) => list.filter((i) => i.id !== id)); }, TOAST_MS);
      timers.add(t);
    };
    window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
    return () => { window.removeEventListener(ANNOUNCE_EVENT, onAnnounce); timers.forEach(clearTimeout); };
  }, []);
  const dismiss = (id: number) => setItems((list) => list.filter((i) => i.id !== id));
  const region = (tone: 'ok' | 'error') => items.filter((i) => (tone === 'error') === (i.tone === 'error'));
  return (
    <div className="vg-toasts">
      <div role="status" aria-live="polite" className="vg-toast-region">
        {region('ok').map((i) => <Toast key={i.id} item={i} onClose={() => dismiss(i.id)} />)}
      </div>
      <div role="alert" aria-live="assertive" className="vg-toast-region">
        {region('error').map((i) => <Toast key={i.id} item={i} onClose={() => dismiss(i.id)} />)}
      </div>
    </div>
  );
}

function Toast({ item, onClose }: { item: Feedback; onClose: () => void }) {
  return (
    <div className={`vg-toast is-${item.tone}`}>
      <i className={`ph ${item.tone === 'error' ? 'ph-warning-circle' : item.tone === 'info' ? 'ph-info' : 'ph-check-circle'}`} aria-hidden />
      <span style={{ flex: 1, minWidth: 0 }}>{item.message}</span>
      <button type="button" className="vg-text-btn" onClick={onClose} aria-label="Fermer le message">
        <i className="ph ph-x" aria-hidden />
      </button>
    </div>
  );
}

/**
 * Appel d'une server action dont l'échec technique (réseau, serveur) devient `{ error }` au lieu d'une exception qui
 * remonterait à la page d'erreur ; redirections et « introuvable » de Next.js suivent leur cours.
 */
export async function safeCall<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    return { error: FAILURE_MESSAGE };
  }
}

type RunOptions = {
  /** Message annoncé après un succès (toast) ; sans message, aucun toast. */
  success?: string;
  /** Appelé après un succès. */
  onOk?: () => void;
  /** Erreur aussi annoncée par un toast (défaut) ; false quand l'écran l'affiche déjà dans une région `alert`. */
  announceError?: boolean;
};

/**
 * Exécute une server action sans formulaire (case à cocher, déplacement sur la carte, choix du site…) : `pending` pendant
 * l'appel, `error` gardé jusqu'au prochain essai (message renvoyé par l'action, ou échec réseau / serveur), annonce de
 * l'erreur et, si demandé, du succès. Les redirections et « introuvable » de Next.js suivent leur cours.
 */
export function useActionRunner() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = useCallback((fn: () => Promise<unknown>, opts: RunOptions = {}) => start(async () => {
    setError(null);
    let result: Feedback;
    try {
      result = feedbackOf(await fn(), opts.success);
    } catch (e) {
      unstable_rethrow(e);
      result = { tone: 'error', message: FAILURE_MESSAGE };
    }
    if (result.tone === 'error') {
      setError(result.message);
      if (opts.announceError !== false) announce(result.message, 'error');
      return;
    }
    if (result.message) announce(result.message, result.tone);
    opts.onOk?.();
  }), []);
  return { pending, error, run, clear: () => setError(null) };
}

/**
 * Indicateur en ligne d'un enregistrement sans formulaire : « Enregistrement… » pendant l'appel (région `status`), puis le
 * message d'erreur (région `alert`) s'il a échoué.
 */
export function SaveStatus({ pending, error, label = 'Enregistrement…', className }: { pending: boolean; error?: string | null; label?: string; className?: string }) {
  return (
    <>
      <span role="status" aria-live="polite" className={`vg-save-status${className ? ` ${className}` : ''}`}>
        {pending && <><span className="vg-spinner" aria-hidden />{label}</>}
      </span>
      {error && !pending && <div role="alert" className="vg-form-error">{error}</div>}
    </>
  );
}
