'use client';

import { unstable_rethrow } from 'next/navigation';
import { createContext, startTransition, useActionState, useCallback, useContext, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { announce } from '@/components/feedback';
import { FAILURE_MESSAGE, savedMessage } from '@/lib/feedback';
import type { FormState } from '@/lib/forms';

export type FormAction = (prev: FormState, fd: FormData) => Promise<FormState>;

const ErrorsCtx = createContext<Record<string, string> | undefined>(undefined);
const useFieldError = (name?: string) => {
  const errors = useContext(ErrorsCtx);
  return name ? errors?.[name] : undefined;
};

/**
 * Champ englobant (UX-04) : nom du contrôle et identifiant de son message (erreur, sinon aide), relié par
 * aria-describedby aux contrôles de même nom (Input, TextArea, Select, Radios, Checkbox).
 */
const FieldCtx = createContext<{ name?: string; describedBy?: string; labelId?: string } | null>(null);
function useDescribedBy(name: string, own?: string) {
  const field = useContext(FieldCtx);
  const ids = [field && field.name === name ? field.describedBy : undefined, own].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

/** Contrôles d'un formulaire qui peuvent recevoir le focus (premier champ en erreur). */
const focusable = (el: Element): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement =>
  'name' in el && (el as HTMLInputElement).type !== 'hidden' && !(el as HTMLInputElement).disabled;

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
  /**
   * Confirmation annoncée après un enregistrement réussi (UX-14, toast de la coque) : `message` renvoyé par l'action,
   * sinon ce texte, sinon « Enregistrement effectué. » ; `false` : aucune annonce.
   */
  successMessage?: string | false;
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
 * Erreurs (UX-04) : message général dans une région `alert`, focus sur le premier champ en erreur (sinon sur le message) ;
 * échec de l'appel (réseau, serveur) rendu comme une erreur du formulaire. Succès (UX-14) : confirmation annoncée.
 */
export function ActionForm({ action, children, onDone, onCancel, submitLabel = 'Enregistrer', submitIcon, hidden, encType, resetOnDone, successMessage }: ActionFormProps) {
  const safeAction = useCallback(async (prev: FormState, fd: FormData): Promise<FormState> => {
    try {
      return await action(prev, fd);
    } catch (e) {
      unstable_rethrow(e);
      return { error: FAILURE_MESSAGE };
    }
  }, [action]);
  const [state, dispatch, pending] = useActionState(safeAction, {});
  const form = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  // Une région d'erreur neuve à chaque échec : le même message est annoncé de nouveau.
  const [attempt, setAttempt] = useState(0);
  const done = useRef(onDone);
  const reset = useRef(resetOnDone);
  const success = useRef(successMessage);
  useEffect(() => { done.current = onDone; reset.current = resetOnDone; success.current = successMessage; });
  useEffect(() => {
    if (state.ok) {
      if (reset.current) form.current?.reset();
      form.current?.dispatchEvent(new CustomEvent(FORM_SAVED_EVENT, { bubbles: true }));
      const message = savedMessage(state, success.current);
      if (message) announce(message);
      done.current?.(state);
      return;
    }
    const names = Object.keys(state.fieldErrors ?? {});
    if (names.length && form.current) {
      const first = [...form.current.elements].find((el) => focusable(el) && names.includes(el.name));
      (first instanceof HTMLElement ? first : alertRef.current)?.focus();
    }
  }, [state]);
  return (
    <form ref={form} className="vg-form" encType={encType} noValidate
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); setAttempt((n) => n + 1); startTransition(() => dispatch(fd)); }}>
      {hidden && Object.entries(hidden).map(([k, v]) => v != null && <input key={k} type="hidden" name={k} value={String(v)} />)}
      <ErrorsCtx.Provider value={state.fieldErrors}>{children}</ErrorsCtx.Provider>
      {state.error && <div key={attempt} ref={alertRef} role="alert" tabIndex={-1} className="vg-form-error">{state.error}</div>}
      <div className="dialog-actions">
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>Annuler</button>}
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending || undefined}>
          {submitIcon && <i className={`ph ${submitIcon}`} style={{ fontSize: 14 }} aria-hidden />}{pending ? 'Enregistrement…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * Libellé + contrôle + message d'erreur. `wide` occupe toute la largeur d'une FormRow. Le libellé vise le contrôle
 * `htmlFor` (par défaut `name`) ; sans `name` ni `htmlFor` (plusieurs contrôles), le champ est un groupe nommé par son
 * libellé. L'erreur et l'aide portent un identifiant, repris par aria-describedby des contrôles de même nom (UX-04).
 */
export function Field({ name, htmlFor, group, label, hint, children, wide }: {
  name?: string; htmlFor?: string;
  /** Groupe de contrôles (boutons radio, case à cocher sans identifiant) : erreur de `name` affichée, libellé du groupe. */
  group?: boolean;
  label: ReactNode; hint?: ReactNode; children: ReactNode; wide?: boolean;
}) {
  const error = useFieldError(name);
  const uid = useId();
  const target = group ? undefined : htmlFor ?? name;
  const messageId = error ? `${uid}-error` : hint ? `${uid}-hint` : undefined;
  const labelId = `${uid}-label`;
  const style = wide ? { gridColumn: '1 / -1' } : undefined;
  return (
    <div className="field" style={style} {...(target ? {} : { role: 'group', 'aria-labelledby': labelId, 'aria-describedby': messageId })}>
      <label id={labelId} htmlFor={target}>{label}</label>
      <FieldCtx.Provider value={{ name, describedBy: target ? messageId : undefined, labelId }}>{children}</FieldCtx.Provider>
      {error ? <span id={messageId} className="vg-field-error">{error}</span> : hint ? <span id={messageId} className="vg-field-hint">{hint}</span> : null}
    </div>
  );
}

/** Grille de champs sur deux colonnes (une seule en mobile). */
export function FormRow({ children, cols = 2 }: { children: ReactNode; cols?: number }) {
  return <div className="vg-form-row" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{children}</div>;
}

export function Input({ name, 'aria-describedby': own, ...rest }: InputHTMLAttributes<HTMLInputElement> & { name: string }) {
  const error = useFieldError(name);
  return <input id={name} name={name} className="input" aria-invalid={!!error || undefined} aria-describedby={useDescribedBy(name, own)} {...rest} />;
}

export function TextArea({ name, 'aria-describedby': own, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { name: string }) {
  const error = useFieldError(name);
  return <textarea id={name} name={name} className="input" aria-invalid={!!error || undefined} aria-describedby={useDescribedBy(name, own)} {...rest} />;
}

export function Select({ name, options, placeholder, 'aria-describedby': own, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { name: string; options: readonly (readonly [string, string])[]; placeholder?: string }) {
  const error = useFieldError(name);
  return (
    <select id={name} name={name} className="input" aria-invalid={!!error || undefined} aria-describedby={useDescribedBy(name, own)} {...rest}>
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
  const error = useFieldError(name);
  const describedBy = useDescribedBy(name);
  return (
    <label className="vg-check">
      <input type="checkbox" name={name} value={value} aria-invalid={!!error || undefined} aria-describedby={describedBy}
        {...(checked !== undefined ? { checked } : { defaultChecked })}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined} />
      <span className="vg-check-box"><i className="ph ph-check" aria-hidden /></span>
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
  const describedBy = useDescribedBy(name);
  const field = useContext(FieldCtx);
  return (
    <div id={name} role="radiogroup" className="vg-radios" aria-invalid={!!error || undefined} aria-describedby={describedBy}
      aria-labelledby={field && field.name === name ? field.labelId : undefined}>
      {options.map(([v, l]) => (
        <label key={v} className="vg-check">
          <input type="radio" name={name} value={v}
            {...(value !== undefined ? { checked: value === v } : { defaultChecked: defaultValue === v })}
            onChange={onChange ? () => onChange(v) : undefined} />
          <span className="vg-check-box vg-radio-box"><i className="ph ph-circle" aria-hidden /></span>
          <span>{l}</span>
        </label>
      ))}
    </div>
  );
}
