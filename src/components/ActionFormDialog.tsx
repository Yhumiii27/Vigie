'use client';

// STUB paquet 1 (Foundation) — implémenté par le flux B.
// Signatures finales (plan § 2.13). Ancienne implémentation : git show 22778e2:src/components/ActionFormDialog.tsx.

import type { CSSProperties } from 'react';
import type { ActionDefaults, ActionFormOptions } from '@/lib/action-view';

export type { ActionDefaults } from '@/lib/action-view';

const STUB = 'Formulaire d’action en cours de réécriture (paquet 1).';

/** Champs du formulaire d'action (création, QHSE seulement ; modification), ordre du formulaire Power Apps (§ 4). */
export function ActionFields(props: { options: ActionFormOptions; defaults?: ActionDefaults; onDone: () => void; onCancel?: () => void }) {
  return (
    <div>
      <p className="vg-muted">{STUB}</p>
      <button type="button" className="btn vg-btn-sm" onClick={props.onCancel ?? props.onDone}>Fermer</button>
    </div>
  );
}

/** Bouton « Nouvelle action » (ou libellé personnalisé) ouvrant le formulaire. */
export function NewActionButton(props: {
  options: ActionFormOptions; defaults?: ActionDefaults; label?: string; className?: string; icon?: string; style?: CSSProperties; disabled?: boolean; tooltip?: string;
}) {
  return (
    <button type="button" className={props.className ?? 'btn btn-primary vg-btn-sm'} style={props.style} disabled title={STUB}>
      {props.label ?? 'Nouvelle action'}
    </button>
  );
}
