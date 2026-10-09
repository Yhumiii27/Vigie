'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/** Erreur inattendue dans un écran : affichée dans le shell (navigation conservée). */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <>
      <header className="vg-header"><h1>Erreur</h1></header>
      <div className="vg-page">
        <div className="card" style={{ maxWidth: 520, gap: 10 }}>
          <div className="card-kicker">Erreur inattendue</div>
          <div className="card-title" style={{ fontSize: 15 }}>Cet écran n&apos;a pas pu s&apos;afficher.</div>
          <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)' }}>
            Réessayez ; si le problème persiste, communiquez la référence ci-dessous à l&apos;animateur QHSE.
          </p>
          {error.digest && <span className="vg-muted" style={{ fontSize: 12 }}>Référence : {error.digest}</span>}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn btn-primary" onClick={() => retry()}>Réessayer</button>
            <Link href="/" className="btn btn-secondary">Retour à l&apos;accueil</Link>
          </div>
        </div>
      </div>
    </>
  );
}
