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
  /** Vide la saisie après un enregistrement réussi (formulaire qui reste affiché : ajout d'un commentaire). */
  resetOnDone?: boolean;
};

/**
 * Événement DOM émis (bouillonnant) par un ActionForm après un enregistrement réussi — ou par un écran dont la saisie est
 * abandonnée (« Annuler » d'une étape de la fiche d'action) : la fenêtre qui le contient (Dialog) oublie la saisie en
 * cours et se ferme ensuite sans demander confirmation.
 */
export const FORM_SAVED_EVENT = 'vg:form-saved';

/**
 * Formulaire branché sur une server action `(prev, formData) => FormState`.
 * La soumission passe par onSubmit + startTransition pour conserver la saisie si la validation échoue.
 */
export function ActionForm({ action, children, onDone, onCancel, submitLabel = 'Enregistrer', submitIcon, hidden, encType, resetOnDone }: ActionFormProps) {
  const [state, dispatch, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  const done = useRef(onDone);
  const reset = useRef(resetOnDone);
  useEffect(() => { done.current = onDone; reset.current = resetOnDone; });
  useEffect(() => {
    if (!state.ok) return;
    if (reset.current) form.current?.reset();
    form.current?.dispatchEvent(new CustomEvent(FORM_SAVED_EVENT, { bubbles: true }));
    done.current?.(state);
  }, [state]);
  return (
    <form ref={form} className="vg-form" encType={encType} noValidate
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

/** Case à cocher ; contrôlée avec `checked` + `onChange` (section dépendante de la case), sinon `defaultChecked`. */
export function Checkbox({ name, label, defaultChecked, checked, onChange, value }: {
  name: string; label: ReactNode; defaultChecked?: boolean; checked?: boolean; onChange?: (checked: boolean) => void;
  /** Valeur soumise (cases de même nom, lues par formReader(fd).list) ; « on » par défaut. */
  value?: string;
}) {
  return (
    <label className="vg-check">
      <input type="checkbox" name={name} value={value}
        {...(checked !== undefined ? { checked } : { defaultChecked })}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined} />
      <span className="vg-check-box"><i className="ph ph-check" /></span>
      <span>{label}</span>
    </label>
  );
}

/**
 * Choix exclusif (boutons radio) : `value` + `onChange` (contrôlé) ou `defaultValue`. Le message d'erreur du champ est
 * celui de `Field name={name}` qui l'entoure.
 */
export function Radios({ name, options, value, defaultValue, onChange }: {
  name: string; options: readonly (readonly [string, string])[]; value?: string; defaultValue?: string; onChange?: (value: string) => void;
}) {
  const error = useFieldError(name);
  return (
    <div id={name} role="radiogroup" className="vg-radios" aria-invalid={!!error || undefined}>
      {options.map(([v, l]) => (
        <label key={v} className="vg-check">
          <input type="radio" name={name} value={v}
            {...(value !== undefined ? { checked: value === v } : { defaultChecked: defaultValue === v })}
            onChange={onChange ? () => onChange(v) : undefined} />
          <span className="vg-check-box vg-radio-box"><i className="ph ph-circle" /></span>
          <span>{l}</span>
        </label>
      ))}
    </div>
  );
}
