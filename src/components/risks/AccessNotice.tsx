import type { CSSProperties } from 'react';

// Mention de mise à disposition du document unique (R. 4121-4), affichée aux rôles en consultation et dans la version
// imprimable. Sans état ni 'use client' : rendue côté serveur (écran DUERP, impression).

/** Texte de la mention (identique à l'écran et à l'impression). */
export const DUERP_ACCESS_NOTICE =
  "Le document unique est tenu à la disposition des travailleurs, des anciens travailleurs (versions en vigueur pendant leur activité), des membres du CSE, du médecin du travail, des agents de l'inspection du travail et des services de prévention de la sécurité sociale (R. 4121-4). Demande d'accès : animateur QHSE.";

export function DuerpAccessNotice({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <p className={className} style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty', ...style }}>
      <i className="ph ph-info" style={{ fontSize: 13, flex: 'none' }} aria-hidden />
      <span>{DUERP_ACCESS_NOTICE}</span>
    </p>
  );
}
