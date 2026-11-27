'use client';

// Textes communs de composants rendus aussi bien par une page serveur que par un composant du navigateur (ui.tsx,
// FieldGrid.tsx : modules sans 'use client') : la traduction (VG-N01) se fait ici, côté navigateur, d'après la langue
// fournie par la mise en page racine.
import { useI18n } from '@/i18n/client';
import { labelT } from '@/i18n/labels';
import { HEALTH_RESTRICTED, HEALTH_RESTRICTED_HINT } from '@/lib/rules/events';

/** Texte par défaut de MissingNotice (UX-13). */
export function MissingDefault() {
  const { t } = useI18n();
  return <>{t('Element not found or outside the selected site.')}</>;
}

/** « Fermer » d'un bandeau. */
export function CloseLabel() {
  const { t } = useI18n();
  return <>{t('Close')}</>;
}

/** Mention « Données restreintes » (rôle non habilité aux données de santé). */
export function Restricted() {
  const { t } = useI18n();
  const label = labelT(t);
  return (
    <span title={label(HEALTH_RESTRICTED_HINT)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--color-neutral-400)' }}>
      <i className="ph ph-lock-simple" style={{ fontSize: 13 }} aria-hidden />{label(HEALTH_RESTRICTED)}
    </span>
  );
}

/** Mention « données restreintes » d'un formulaire (rôle non habilité). */
export function RestrictedNote() {
  const { t } = useI18n();
  const label = labelT(t);
  return (
    <div className="vg-inset" role="note" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, color: 'var(--color-neutral-400)' }}>
      <i className="ph ph-lock-simple" style={{ fontSize: 14 }} aria-hidden />
      <span style={{ textWrap: 'pretty' }}>{label(HEALTH_RESTRICTED)} · {label(HEALTH_RESTRICTED_HINT)}</span>
    </div>
  );
}
