'use client';

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { FormState } from '@/lib/forms';

export type FormAction = (prev: FormState, fd: FormData) => Promise<FormState>;

const ErrorsCtx = createContext<Record<string, string> | undefined>(undefined);
const useFieldError = (name?: string) => {
  const errors = useContext(ErrorsCtx);
  return name ? errors?.[name] : undefined;
};

type ActionFormProps = {
  action: FormAction;
  children: ReactNode;
  /** Appelé après un enregistrement réussi (typiquement : fermer la fenêtre). */
  onDone?: (state: FormState) => void;
  onCancel?: () => void;
  submitLabel?: string;
  submitIcon?: string;
  /** Champs masqués transmis tels quels. */
  hidden?: Record<string, string | number | null | undefined>;
  encType?: 'multipart/form-data';
};

/**
 * Formulaire branché sur une server action `(prev, formData) => FormState`.
 * La soumission passe par onSubmit + startTransition pour conserver la saisie si la validation échoue.
 */
export function ActionForm({ action, children, onDone, onCancel, submitLabel = 'Enregistrer', submitIcon, hidden, encType }: ActionFormProps) {
  const [state, dispatch, pending] = useActionState(action, {});
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => { if (state.ok) done.current?.(state); }, [state]);
  return (
    <form className="vg-form" encType={encType} noValidate
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => dispatch(fd)); }}>
      {hidden && Object.entries(hidden).map(([k, v]) => v != null && <input key={k} type="hidden" name={k} value={String(v)} />)}
      <ErrorsCtx.Provider value={state.fieldErrors}>{children}</ErrorsCtx.Provider>
      {state.error && <div role="alert" className="vg-form-error">{state.error}</div>}
      <div className="dialog-actions">
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>Annuler</button>}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {submitIcon && <i className={`ph ${submitIcon}`} style={{ fontSize: 14 }} />}{pending ? 'Enregistrement…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** Libellé + contrôle + message d'erreur. `wide` occupe toute la largeur d'une FormRow. */
export function Field({ name, label, hint, children, wide }: { name?: string; label: ReactNode; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  const error = useFieldError(name);
  return (
    <div className="field" style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label htmlFor={name}>{label}</label>
      {children}
      {error ? <span className="vg-field-error">{error}</span> : hint ? <span className="vg-field-hint">{hint}</span> : null}
    </div>
  );
}

/** Grille de champs sur deux colonnes (une seule en mobile). */
export function FormRow({ children, cols = 2 }: { children: ReactNode; cols?: number }) {
  return <div className="vg-form-row" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{children}</div>;
}

export function Input({ name, ...rest }: InputHTMLAttributes<HTMLInputElement> & { name: string }) {
  const error = useFieldError(name);
  return <input id={name} name={name} className="input" aria-invalid={!!error || undefined} {...rest} />;
}

export function TextArea({ name, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { name: string }) {
  const error = useFieldError(name);
  return <textarea id={name} name={name} className="input" aria-invalid={!!error || undefined} {...rest} />;
}

export function Select({ name, options, placeholder, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { name: string; options: readonly (readonly [string, string])[]; placeholder?: string }) {
  const error = useFieldError(name);
  return (
    <select id={name} name={name} className="input" aria-invalid={!!error || undefined} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function Checkbox({ name, label, defaultChecked }: { name: string; label: ReactNode; defaultChecked?: boolean }) {
  return (
    <label className="vg-check">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      <span className="vg-check-box"><i className="ph ph-check" /></span>
      <span>{label}</span>
    </label>
  );
}
