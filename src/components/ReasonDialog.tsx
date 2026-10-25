'use client';

import type { CSSProperties, ReactNode } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, TextArea, type FormAction } from '@/components/form';
import { REASON_MAX } from '@/lib/domain';
import type { FormState } from '@/lib/forms';

type ReasonFormProps = {
  /** Server action `(prev, fd) => FormState` ; lit le motif avec `formReader(fd).reason()` (champ `reason`). */
  action: FormAction;
  /** Champs masqués (typiquement `id`). */
  hidden?: Record<string, string | number | null | undefined>;
  /** Texte d'explication affiché au-dessus du motif (conséquences de l'annulation, de l'archivage…). */
  message?: ReactNode;
  reasonLabel?: string;
  hint?: ReactNode;
  placeholder?: string;
  submitLabel?: string;
  submitIcon?: string;
  onDone?: (state: FormState) => void;
  onCancel?: () => void;
  /** Champs supplémentaires (date de sortie…), rendus après le motif. */
  children?: ReactNode;
  /** Champs rendus avant le motif (nouvelle date d'un report…) ; le motif n'a alors pas le focus d'ouverture. */
  before?: ReactNode;
};

/**
 * Formulaire « avec motif » : annulation, archivage, classement sans suite, réouverture, restauration, retrait, report.
 * Jamais de suppression d'un enregistrement tracé : qui, quand et pourquoi sont conservés côté serveur. Seul formulaire qui
 * saisit le champ `reason` (QUA-22, src/server/reason-usage.test.ts) ; le serveur le lit par `formReader(fd).reason()`.
 */
export function ReasonForm({ action, hidden, message, reasonLabel = 'Motif', hint, placeholder, submitLabel = 'Confirmer', submitIcon, onDone, onCancel, children, before }: ReasonFormProps) {
  return (
    <ActionForm action={action} hidden={hidden} onDone={onDone} onCancel={onCancel} submitLabel={submitLabel} submitIcon={submitIcon}>
      {message && <p style={{ margin: 0, fontSize: 13, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{message}</p>}
      {before}
      <Field name="reason" label={reasonLabel} hint={hint ?? 'Obligatoire, conservé dans l’historique de la fiche.'}>
        <TextArea name="reason" rows={3} maxLength={REASON_MAX} required autoFocus={!before} placeholder={placeholder} />
      </Field>
      {children}
    </ActionForm>
  );
}

type ReasonButtonProps = Omit<ReasonFormProps, 'onDone' | 'onCancel'> & {
  label: ReactNode;
  title: ReactNode;
  kicker?: ReactNode;
  icon?: string;
  className?: string;
  style?: CSSProperties;
  width?: number;
  disabled?: boolean;
  tooltip?: string;
  onDone?: (state: FormState) => void;
};

/** Bouton qui ouvre une fenêtre « avec motif » (ex. « Annuler l'action », « Archiver », « Classer sans suite »). */
export function ReasonButton({ label, title, kicker, icon, className = 'btn btn-secondary vg-btn-sm', style, width = 480, disabled, tooltip, onDone, ...form }: ReasonButtonProps) {
  return (
    <DialogButton label={label} title={title} kicker={kicker} icon={icon} className={className} style={style} width={width} disabled={disabled} tooltip={tooltip}>
      {(close) => <ReasonForm {...form} onDone={(s) => { close(); onDone?.(s); }} onCancel={close} />}
    </DialogButton>
  );
}
