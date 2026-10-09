'use client';

import type { ReactNode } from 'react';
import { Icon } from '@/components/ui';
import type { ImportField } from '@/lib/pp-import/types';
import s from './pp-import.module.css';

// Éléments partagés par les étapes de l'import du plan de prévention.

export const STAGES = [
  ['drop', 'Dépôt du fichier'],
  ['detect', 'Détection'],
  ['map', 'Correspondance'],
  ['review', 'Vérification'],
] as const;
export type Stage = (typeof STAGES)[number][0];

export const muted = { fontSize: 11, color: 'var(--color-neutral-500)' } as const;

/** Suivi des quatre étapes ; une étape passée se rouvre d'un clic. */
export function Stepper({ stage, reachable, onGo }: { stage: Stage; reachable: Stage[]; onGo: (s: Stage) => void }) {
  const current = STAGES.findIndex(([k]) => k === stage);
  return (
    <nav className={s.steps} aria-label="Étapes de l'import">
      {STAGES.map(([key, label], i) => {
        const done = i < current;
        const canGo = done && reachable.includes(key);
        return (
          <span key={key} style={{ display: 'contents' }}>
            {i > 0 && <span className={s.stepSep} aria-hidden />}
            <button type="button" className={`${s.step} ${i === current ? s.stepOn : ''} ${canGo ? s.stepDone : ''}`}
              aria-current={i === current ? 'step' : undefined} disabled={!canGo} onClick={() => onGo(key)}>
              <span className={s.stepNum}>{done ? <Icon name="ph-check" size={11} /> : i + 1}</span>{label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

export const KIND_LABELS: Record<ImportField['kind'], string> = { checkbox: 'Case', text: 'Texte', date: 'Date', choice: 'Choix' };

/** Case lue : ☑ cochée / ☐ vide. */
export function CheckMark({ checked, label }: { checked: boolean; label?: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: checked ? 'var(--tone-ok-fg)' : 'var(--color-neutral-500)' }}>
      <Icon name={checked ? 'ph-check-square' : 'ph-square'} size={15} style={{ color: checked ? 'var(--tone-ok-dot)' : 'var(--color-neutral-600)', flex: 'none' }} />
      {label}
    </span>
  );
}

/** Valeur lue d'un champ (case ou texte). */
export function FieldValue({ field, max = 90 }: { field: ImportField; max?: number }) {
  if (field.kind === 'checkbox') return <CheckMark checked={!!field.checked} label={field.checked ? 'Cochée' : 'Vide'} />;
  const v = field.value ?? '';
  if (!v) return <span style={muted}>Non rempli</span>;
  return <span title={v.length > max ? v : undefined} style={{ textWrap: 'pretty' }}>{v.length > max ? `${v.slice(0, max - 1)}…` : v}</span>;
}

/** Taille lisible d'un fichier. */
export const fileSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`);

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
