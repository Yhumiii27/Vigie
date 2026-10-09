import Link from 'next/link';

export const metadata = { title: 'Page introuvable' };

/** Adresse inconnue : page autonome, hors du shell. */
export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ display: 'grid', gap: 16, justifyItems: 'center', maxWidth: 440, textAlign: 'center' }}>
        <div className="vg-brand" style={{ padding: 0 }}>
          <span className="vg-brand-mark">V</span>
          <span className="vg-brand-name">Vigie</span>
        </div>
        <div className="card" style={{ gap: 10, alignItems: 'center' }}>
          <div className="card-title" style={{ fontSize: 15 }}>Page introuvable</div>
          <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)' }}>
            Cet élément n&apos;existe pas, a été archivé ou n&apos;est pas accessible avec votre rôle.
          </p>
          <Link href="/" className="btn btn-secondary">Retour à l&apos;accueil</Link>
        </div>
      </div>
    </main>
  );
}
