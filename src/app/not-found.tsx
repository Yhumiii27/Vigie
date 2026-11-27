import type { Metadata } from 'next';
import Link from 'next/link';
import { getI18n } from '@/i18n/server';

// Manifeste du signalement installable (EVT-20) : pages /signaler seulement.
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Page not found'), manifest: null };
}

/** Adresse inconnue : page autonome, hors du shell. */
export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ display: 'grid', gap: 16, justifyItems: 'center', maxWidth: 440, textAlign: 'center' }}>
        <div className="vg-brand" style={{ padding: 0 }}>
          <span className="coque-logo" aria-hidden><i className="ph ph-binoculars" style={{ fontSize: 15 }} aria-hidden /></span>
          <span className="coque-wordmark">Vigie</span>
        </div>
        <div className="card" style={{ gap: 10, alignItems: 'center' }}>
          <div className="card-title" style={{ fontSize: 15 }}>{t('Page not found')}</div>
          <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)' }}>
            {t('This item does not exist, has been archived or is not accessible with your role.')}
          </p>
          <Link href="/" className="btn btn-secondary">{t('Back to home')}</Link>
        </div>
      </div>
    </main>
  );
}
