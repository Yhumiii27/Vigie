'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

type DialogProps = { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number; kicker?: ReactNode };

/** Fenêtre modale Nocturne sur l'élément natif <dialog> (focus piégé, Échap pour fermer). */
export function Dialog({ open, onClose, title, children, width = 520, kicker }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    // stopPropagation : React remonte l'événement « cancel » aux fenêtres parentes ; Échap ne ferme que la fenêtre du dessus.
    <dialog ref={ref} className="vg-dialog" onCancel={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="dialog" style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
              {kicker && <div className="card-kicker">{kicker}</div>}
              <div className="dialog-title">{title}</div>
            </div>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Fermer" onClick={onClose} style={{ width: 28, height: 28, color: 'var(--color-neutral-400)' }}>
              <i className="ph ph-x" style={{ fontSize: 16 }} />
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
  tooltip?: string;
  /** Contenu de la fenêtre ; `close` ferme la fenêtre (à appeler après un enregistrement réussi). */
  children: (close: () => void) => ReactNode;
};

/** Bouton qui ouvre une fenêtre modale. */
export function DialogButton({ label, title, kicker, icon, className = 'btn btn-secondary vg-btn-sm', style, width, disabled, tooltip, children }: DialogButtonProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className={className} style={style} disabled={disabled} title={tooltip} onClick={() => setOpen(true)}>
        {icon && <i className={`ph ${icon}`} style={{ fontSize: 13 }} />}{label}
      </button>
      <Dialog open={open} onClose={close} title={title} kicker={kicker} width={width}>{open && children(close)}</Dialog>
    </>
  );
}
