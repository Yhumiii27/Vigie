import type { CSSProperties } from 'react';
import { getI18n } from '@/i18n/server';

// Mention de mise à disposition du document unique (R. 4121-4), affichée aux rôles en consultation et dans la version
// imprimable. Sans état ni 'use client' : rendue côté serveur (écran DUERP, impression), traduite par sa chaîne source.

export async function DuerpAccessNotice({ className, style }: { className?: string; style?: CSSProperties }) {
  const { t } = await getI18n();
  return (
    <p className={className} style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty', ...style }}>
      <i className="ph ph-info" style={{ fontSize: 13, flex: 'none' }} aria-hidden />
      <span>{t('The single document is kept available to workers, former workers (versions in force during their activity), CSE members, the occupational physician, labour inspectorate officers and social security prevention services (R. 4121-4). Access request: QHSE coordinator.')}</span>
    </p>
  );
}
