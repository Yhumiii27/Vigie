import Link from 'next/link';
import { getI18n } from '@/i18n/server';

/**
 * Élément introuvable, affiché dans le shell : notFound() d'une page de l'application (ex. plan de prévention
 * imprimable inconnu). Une adresse inconnue affiche src/app/not-found.tsx (hors du shell) ; un lien profond
 * (?sel=, ?plan=…) qui ne correspond à rien garde l'écran et affiche un bandeau (MissingNotice).
 */
export default async function AppNotFound() {
  const { t } = await getI18n();
  return (
    <>
      <header className="vg-header"><h1>{t('Page not found')}</h1></header>
      <div className="vg-page">
        <div className="card" style={{ maxWidth: 520, gap: 10 }}>
          <div className="card-title" style={{ fontSize: 15 }}>{t('Page not found')}</div>
          <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)' }}>
            {t('This item does not exist, has been archived or is not accessible with your role.')}
          </p>
          <div><Link href="/" className="btn btn-secondary">{t('Back to home')}</Link></div>
        </div>
      </div>
    </>
  );
}
