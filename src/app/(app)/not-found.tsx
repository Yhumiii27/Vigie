import Link from 'next/link';

/**
 * Élément introuvable, affiché dans le shell : notFound() d'une page de l'application (ex. plan de prévention
 * imprimable inconnu). Une adresse inconnue affiche src/app/not-found.tsx (hors du shell) ; un lien profond
 * (?sel=, ?plan=…) qui ne correspond à rien garde l'écran et affiche un bandeau (MissingNotice).
 */
export default function AppNotFound() {
  return (
    <>
      <header className="vg-header"><h1>Page introuvable</h1></header>
      <div className="vg-page">
        <div className="card" style={{ maxWidth: 520, gap: 10 }}>
          <div className="card-title" style={{ fontSize: 15 }}>Page introuvable</div>
          <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)' }}>
            Cet élément n&apos;existe pas, a été archivé ou n&apos;est pas accessible avec votre rôle.
          </p>
          <div><Link href="/" className="btn btn-secondary">Retour à l&apos;accueil</Link></div>
        </div>
      </div>
    </>
  );
}
