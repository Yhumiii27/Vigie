'use client';

import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

// Infobulles accessibles (UX-10) : affichées au survol et au focus clavier, fermées par Échap, reliées au bouton par
// aria-describedby (au lieu de l'attribut `title`, ni lisible au clavier ni sur un bouton désactivé). Un bouton désactivé qui
// porte une explication reste atteignable au clavier : aria-disabled, sans effet au clic.

type TipButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Infobulle (raison d'une désactivation, précision) ; absente : bouton ordinaire. */
  tip?: string | null;
  children: ReactNode;
};

/** Bouton avec infobulle accessible ; sans `tip`, bouton ordinaire (attributs transmis tels quels). */
export function TipButton({ tip, disabled, onClick, children, type = 'button', ...rest }: TipButtonProps) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  if (!tip) return <button type={type} disabled={disabled} onClick={onClick} {...rest}>{children}</button>;
  return (
    <span className="vg-tip" data-dismissed={dismissed || undefined}
      onMouseLeave={() => setDismissed(false)} onBlur={() => setDismissed(false)}
      onKeyDown={(e) => { if (e.key === 'Escape' && !dismissed) { setDismissed(true); e.preventDefault(); e.stopPropagation(); } }}>
      <button type={type} aria-describedby={id} aria-disabled={disabled || undefined}
        onClick={disabled ? (e) => e.preventDefault() : onClick} {...rest}>
        {children}
      </button>
      <span role="tooltip" id={id} className="vg-tip-bubble">{tip}</span>
    </span>
  );
}

/**
 * Infobulle d'un élément non interactif (pastille, abréviation) : le texte est aussi lu par les lecteurs d'écran
 * (texte masqué), l'infobulle s'affiche au survol. À réserver aux compléments : une information utile au clavier va dans
 * un bouton (TipButton) ou dans le texte.
 */
export function TipText({ tip, children, className }: { tip: string; children: ReactNode; className?: string }) {
  return (
    <span className={`vg-tip${className ? ` ${className}` : ''}`}>
      {children}
      <span className="vg-sr-only">{` (${tip})`}</span>
      <span className="vg-tip-bubble" aria-hidden>{tip}</span>
    </span>
  );
}

/**
 * Infobulle accessible d'un lien ou d'un autre élément interactif (UX-10) : `children` reçoit les attributs à poser sur
 * l'élément (aria-describedby) ; l'infobulle s'affiche au survol et au focus clavier, Échap la ferme. Sans `tip`, l'élément
 * est rendu tel quel.
 */
export function Tip({ tip, children }: { tip?: string | null; children: (props: { 'aria-describedby'?: string }) => ReactNode }) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  if (!tip) return <>{children({})}</>;
  return (
    <span className="vg-tip" data-dismissed={dismissed || undefined}
      onMouseLeave={() => setDismissed(false)} onBlur={() => setDismissed(false)}
      onKeyDown={(e) => { if (e.key === 'Escape' && !dismissed) { setDismissed(true); e.preventDefault(); e.stopPropagation(); } }}>
      {children({ 'aria-describedby': id })}
      <span role="tooltip" id={id} className="vg-tip-bubble">{tip}</span>
    </span>
  );
}
