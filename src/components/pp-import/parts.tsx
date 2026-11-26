'use client';

import type { ReactNode } from 'react';
import { Icon } from '@/components/ui';
import type { ImportField } from '@/lib/pp-import/types';
import s from './pp-import.module.css';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';

// Éléments partagés par les étapes de l'import du plan de prévention. Libellés : chaînes sources (VG-N01), rendues par t().

export const STAGES = [
  ['drop', 'File upload'],
  ['detect', 'Detection'],
  ['map', 'Mapping'],
  ['review', 'Review'],
] as const;
export type Stage = (typeof STAGES)[number][0];

export const muted = { fontSize: 11, color: 'var(--color-neutral-500)' } as const;

/** Suivi des quatre étapes ; une étape passée se rouvre d'un clic. */
export function Stepper({ stage, reachable, onGo }: { stage: Stage; reachable: Stage[]; onGo: (s: Stage) => void }) {
  const { t } = useI18n();
  const current = STAGES.findIndex(([k]) => k === stage);
  return (
    <nav className={s.steps} aria-label={t('Import steps')}>
      {STAGES.map(([key, label], i) => {
        const done = i < current;
        const canGo = done && reachable.includes(key);
        return (
          <span key={key} style={{ display: 'contents' }}>
            {i > 0 && <span className={s.stepSep} aria-hidden />}
            <button type="button" className={`${s.step} ${i === current ? s.stepOn : ''} ${canGo ? s.stepDone : ''}`}
              aria-current={i === current ? 'step' : undefined} disabled={!canGo} onClick={() => onGo(key)}>
              <span className={s.stepNum}>{done ? <Icon name="ph-check" size={11} /> : i + 1}</span>{t(label)}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

/** Chaînes sources (VG-N01), rendues par t(). */
export const KIND_LABELS: Record<ImportField['kind'], string> = { checkbox: 'Box', text: 'Text', date: 'Date', choice: 'Choice' };

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
  const { t } = useI18n();
  if (field.kind === 'checkbox') return <CheckMark checked={!!field.checked} label={field.checked ? t('Ticked#f') : t('Empty#f')} />;
  const v = field.value ?? '';
  if (!v) return <span style={muted}>{t('Not filled')}</span>;
  return <span title={v.length > max ? v : undefined} style={{ textWrap: 'pretty' }}>{v.length > max ? `${v.slice(0, max - 1)}…` : v}</span>;
}

/** Taille lisible d'un fichier. */
export const fileSize = (bytes: number, t: T) => (bytes < 1024 * 1024 ? fill(t('{n} KB'), { n: Math.max(1, Math.round(bytes / 1024)) }) : fill(t('{n} MB'), { n: (bytes / 1024 / 1024).toFixed(1).replace('.', t('.#decimal')) }));

/** Nombre et libellé : `one` et `many` portent `{n}` (chaînes déjà traduites). */
export const plural = (n: number, one: string, many: string) => fill(n > 1 ? many : one, { n });
