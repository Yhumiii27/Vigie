// Clavier des menus de la coque (UX-11, motif « menu button » de l'ARIA APG), règle pure : élément à activer après une
// touche, d'après la position courante (−1 : aucun élément du menu n'a le focus) et le nombre d'éléments.

export type MenuMove = { focus: number } | { close: 'restore' | 'leave' } | null;

/**
 * ↓ / ↑ : élément suivant / précédent (en boucle) ; Origine / Fin : premier / dernier ; Échap : fermeture, focus rendu au
 * bouton ; Tab : fermeture, le focus suit l'ordre de tabulation. Autre touche (ou menu vide) : rien.
 */
export function menuKeyMove(key: string, index: number, count: number): MenuMove {
  if (key === 'Escape') return { close: 'restore' };
  if (key === 'Tab') return { close: 'leave' };
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown': return { focus: index < 0 ? 0 : (index + 1) % count };
    case 'ArrowUp': return { focus: index < 0 ? count - 1 : (index - 1 + count) % count };
    case 'Home': return { focus: 0 };
    case 'End': return { focus: count - 1 };
    default: return null;
  }
}

/**
 * Élément qui reçoit le focus à l'ouverture : le choix en cours (case cochée) s'il y en a un, sinon le premier ; ouverture
 * par ↑ : le dernier.
 */
export function menuInitialFocus(checked: number, count: number, from: 'first' | 'last' = 'first'): number {
  if (count <= 0) return -1;
  if (from === 'last') return count - 1;
  return checked >= 0 && checked < count ? checked : 0;
}
