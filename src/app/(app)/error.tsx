'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

/** Erreur inattendue dans un écran : affichée dans le shell (navigation conservée). */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { t } = useI18n();
  useEffect(() => console.error(error), [error]);
  return (
    <>
      <header className="vg-header"><h1>{t('Error')}</h1></header>
      <div className="vg-page">
        <div className="card" style={{ maxWidth: 520, gap: 10 }}>
          <div className="card-kicker">{t('Unexpected error')}</div>
          <div className="card-title" style={{ fontSize: 15 }}>{t('This screen could not be displayed.')}</div>
          <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)' }}>
            {t('Try again; if the problem persists, give the reference below to the QHSE coordinator.')}
          </p>
          {error.digest && <span className="vg-muted" style={{ fontSize: 12 }}>{fill(t('Reference: {ref}'), { ref: error.digest })}</span>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn-primary" onClick={() => retry()}>{t('Try again')}</button>
            <Link href="/" className="btn btn-secondary">{t('Back to home')}</Link>
          </div>
        </div>
      </div>
    </>
  );
}
