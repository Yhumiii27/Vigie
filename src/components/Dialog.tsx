'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FORM_SAVED_EVENT } from '@/components/form';
import { TipButton } from '@/components/Tip';

type DialogProps = { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number; kicker?: ReactNode };

/** Champ qui reçoit le focus à l'ouverture, faute d'élément [autofocus] : premier champ de saisie actif du contenu. */
const FIRST_FIELD = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
export const DISCARD_CONFIRM = 'Fermer sans enregistrer la saisie en cours ?';

/**
 * Fenêtre modale Nocturne sur l'élément natif <dialog> (focus piégé, Échap pour fermer), nommée par son titre (UX-03).
 * Clic à l'extérieur : ferme seulement si l'appui a aussi commencé sur le fond (une sélection de texte relâchée hors de la
 * fenêtre ne la ferme pas) et si rien n'a été saisi ; Échap demande confirmation quand une saisie est en cours.
 * Focus initial : élément [autofocus], sinon premier champ de saisie, sinon comportement natif ; le navigateur rend le
 * focus à l'élément d'origine à la fermeture. Un ActionForm intérieur enregistré (FORM_SAVED_EVENT) remet la saisie à zéro.
 */
export function Dialog({ open, onClose, title, children, width = 520, kicker }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const openRef = useRef(false);
  const dirty = useRef(false);
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // openRef d'abord : l'événement « close » natif déclenché par d.close() ne doit pas rappeler onClose.
    openRef.current = open;
    if (open && !d.open) {
      dirty.current = false;
      d.showModal();
      // (L'en-tête ne porte que le bouton « Fermer » : le premier champ de la fenêtre est celui du contenu.)
      const target = d.querySelector<HTMLElement>('[autofocus]') ?? d.querySelector<HTMLElement>(FIRST_FIELD);
      target?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  // Formulaire intérieur enregistré (commentaire ajouté depuis la fiche…) : la saisie n'est plus « en cours ».
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const saved = () => { dirty.current = false; };
    d.addEventListener(FORM_SAVED_EVENT, saved);
    return () => d.removeEventListener(FORM_SAVED_EVENT, saved);
  }, []);
  const requestClose = () => {
    if (dirty.current && !window.confirm(DISCARD_CONFIRM)) return;
    onClose();
  };
  return (
    // stopPropagation : React remonte l'événement « cancel » aux fenêtres parentes ; Échap ne ferme que la fenêtre du dessus.
    <dialog ref={ref} className="vg-dialog" aria-labelledby={open ? titleId : undefined}
      onCancel={(e) => { e.preventDefault(); e.stopPropagation(); requestClose(); }}
      // Fermeture native sans « cancel » (second Échap sous Chrome) : l'état React suit.
      onClose={(e) => { if (e.target === e.currentTarget && openRef.current) { openRef.current = false; onClose(); } }}
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnBackdrop.current && !dirty.current) onClose(); }}
      onInputCapture={() => { dirty.current = true; }}
      onChangeCapture={() => { dirty.current = true; }}>
      {open && (
        <div className="dialog" style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
              {kicker && <div className="card-kicker">{kicker}</div>}
              <h2 id={titleId} className="dialog-title" style={{ margin: 0 }}>{title}</h2>
            </div>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Fermer" onClick={onClose} style={{ width: 28, height: 28, color: 'var(--color-neutral-400)' }}>
              <i className="ph ph-x" style={{ fontSize: 16 }} aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

type DialogButtonProps = {
  label: ReactNode;
  title: ReactNode;
  kicker?: ReactNode;
  icon?: string;
  className?: string;
  style?: CSSProperties;
  width?: number;
  disabled?: boolean;
  /** Infobulle accessible au clavier (UX-10), aussi sur le bouton désactivé (raison de la désactivation). */
  tooltip?: string;
  /** Nom accessible d'un bouton à icône seule (`label` vide) ; à défaut, l'infobulle. */
  ariaLabel?: string;
  /** Contenu de la fenêtre ; `close` ferme la fenêtre (à appeler après un enregistrement réussi). */
  children: (close: () => void) => ReactNode;
};

/** Bouton qui ouvre une fenêtre modale. */
export function DialogButton({ label, title, kicker, icon, className = 'btn btn-secondary vg-btn-sm', style, width, disabled, tooltip, ariaLabel, children }: DialogButtonProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  // Bouton à icône seule : nommé par ariaLabel, sinon par l'infobulle (qui n'est alors pas répétée en description).
  const iconOnly = label === '' || label == null;
  const name = ariaLabel ?? (iconOnly ? tooltip : undefined);
  return (
    <>
      <TipButton className={className} style={style} disabled={disabled} tip={iconOnly && !ariaLabel ? null : tooltip} aria-label={name}
        title={iconOnly && !ariaLabel ? tooltip : undefined} onClick={() => setOpen(true)}>
        {icon && <i className={`ph ${icon}`} style={{ fontSize: 13 }} aria-hidden />}{label}
      </TipButton>
      <Dialog open={open} onClose={close} title={title} kicker={kicker} width={width}>{open && children(close)}</Dialog>
    </>
  );
}
