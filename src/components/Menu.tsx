'use client';

import { useCallback, useEffect, useId, useState, type KeyboardEvent } from 'react';
import { menuInitialFocus, menuKeyMove } from '@/lib/menu-keys';

const ITEMS = '[role="menuitem"], [role="menuitemradio"]';

/** Attributs d'un élément de menu (focus géré par le menu : hors de l'ordre de tabulation) ; `checked` : choix exclusif. */
export function menuItemProps(checked?: boolean) {
  return {
    role: checked === undefined ? ('menuitem' as const) : ('menuitemradio' as const),
    'aria-checked': checked,
    tabIndex: -1,
  };
}

/**
 * Menu déroulant au clavier (UX-11, motif « menu button ») : bouton `aria-haspopup="menu"` / `aria-expanded`, menu
 * `role="menu"` dont les éléments (`menuItemProps`) se parcourent aux flèches, Origine et Fin ; Échap ferme et rend le focus
 * au bouton, Tab et un appui en dehors ferment. À l'ouverture, le focus va au choix en cours (`aria-checked`), sinon au
 * premier élément (au dernier par ↑ sur le bouton). Éléments retrouvés par leur identifiant (aucune ref exposée).
 */
export function useMenu() {
  // false : fermé ; sinon élément visé à l'ouverture.
  const [state, setState] = useState<false | 'first' | 'last'>(false);
  const id = useId();
  const ids = { root: `${id}-root`, button: `${id}-button`, menu: `${id}-menu` };
  const open = state !== false;

  const close = useCallback((restore: boolean) => {
    setState(false);
    if (restore) document.getElementById(`${id}-button`)?.focus();
  }, [id]);

  useEffect(() => {
    if (state === false) return;
    const list = [...(document.getElementById(`${id}-menu`)?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    list[menuInitialFocus(list.findIndex((el) => el.getAttribute('aria-checked') === 'true'), list.length, state)]?.focus();
    const root = () => document.getElementById(`${id}-root`);
    const onDown = (e: PointerEvent) => { if (!root()?.contains(e.target as Node)) setState(false); };
    // Capture et preventDefault : Échap ferme le menu seulement, pas le tiroir de navigation (AppShell) ni une fenêtre.
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey, true); };
    // Focus initial à l'ouverture seulement (pas quand l'élément visé change pendant que le menu est ouvert).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close, id]);

  const onMenuKey = (e: KeyboardEvent<HTMLElement>) => {
    const list = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
    const move = menuKeyMove(e.key, list.indexOf(document.activeElement as HTMLElement), list.length);
    if (!move) return;
    if ('focus' in move) { e.preventDefault(); list[move.focus]?.focus(); return; }
    if (move.close === 'leave') setState(false);
  };

  return {
    open,
    /** Ferme le menu ; `restore` rend le focus au bouton (choix fait au clavier ou à la souris). */
    close,
    rootProps: { id: ids.root },
    buttonProps: {
      id: ids.button,
      'aria-haspopup': 'menu' as const,
      'aria-expanded': open,
      'aria-controls': open ? ids.menu : undefined,
      onClick: () => setState((s) => (s === false ? 'first' : false)),
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          setState(e.key === 'ArrowUp' ? 'last' : 'first');
        }
      },
    },
    menuProps: { id: ids.menu, role: 'menu' as const, 'aria-labelledby': ids.button, onKeyDown: onMenuKey },
  };
}
