import type { ReactNode } from 'react';

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

export { Restricted, RestrictedNote } from '@/components/SharedText';
