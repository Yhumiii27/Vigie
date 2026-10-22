'use client';

import Link from 'next/link';
import { useEffect } from 'react';

// Liste puis fiche sur petit écran (UX-07) : conteneur `.vg-md` (data-focus="detail" quand une fiche est demandée par
// l'URL), colonnes `.vg-md-list` et `.vg-md-detail` (src/app/vigie.css). Sur téléphone, la fiche remplace la liste, avec
// « Retour à la liste » ; sur grand écran, rien ne change (deux colonnes, bouton masqué).

/** Même seuil que la navigation mobile (vigie.css). */
const NARROW = '(max-width: 760px)';

/**
 * Remonte en haut de la page à l'ouverture d'une fiche sur téléphone (la liste, masquée, laissait la page défilée) ;
 * à rendre avec une `key` par fiche. Sans effet sur grand écran.
 */
export function DetailFocus() {
  useEffect(() => {
    if (window.matchMedia(NARROW).matches) window.scrollTo({ top: 0 });
  }, []);
  return null;
}

/** Lien « Retour à la liste », affiché sur téléphone seulement. */
export function BackToList({ href, label = 'Retour à la liste' }: { href: string; label?: string }) {
  return (
    <Link href={href} className="vg-md-back vg-link">
      <i className="ph ph-caret-left" aria-hidden />{label}
    </Link>
  );
}
