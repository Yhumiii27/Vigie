import type { ReactNode } from 'react';
import { HEALTH_RESTRICTED, HEALTH_RESTRICTED_HINT } from './shared';

// Grille « libellé / valeur » des fiches événement (fiche complète, fiche déclarant, accident du travail). Sans état :
// utilisable par les composants serveur et client.

export const FieldLabel = ({ children }: { children: ReactNode }) => (
  <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--vg-text-muted)' }}>{children}</span>
);

export function FieldGrid({ fields, min = 150 }: { fields: [string, ReactNode][]; min?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: '10px 16px' }}>
      {fields.map(([k, v]) => (
        <div key={k} style={{ display: 'grid', gap: 2, alignContent: 'start', minWidth: 0 }}>
          <FieldLabel>{k}</FieldLabel>
          <span style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Données de santé d'un AT pour un rôle non habilité (SEC-06) : la fiche n'en reçoit aucune, seulement cette mention. */
export const Restricted = () => (
  <span title={HEALTH_RESTRICTED_HINT} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--color-neutral-400)' }}>
    <i className="ph ph-lock-simple" style={{ fontSize: 13 }} aria-hidden />{HEALTH_RESTRICTED}
  </span>
);

/** Mention « données restreintes » d'un formulaire (rôle non habilité). */
export const RestrictedNote = () => (
  <div className="vg-inset" role="note" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, color: 'var(--color-neutral-400)' }}>
    <i className="ph ph-lock-simple" style={{ fontSize: 14 }} aria-hidden />
    <span style={{ textWrap: 'pretty' }}>{HEALTH_RESTRICTED} · {HEALTH_RESTRICTED_HINT}</span>
  </div>
);
