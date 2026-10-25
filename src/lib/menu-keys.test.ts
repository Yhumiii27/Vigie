import { describe, expect, it } from 'vitest';
import { menuInitialFocus, menuKeyMove } from './menu-keys';

describe('menuKeyMove (UX-11)', () => {
  it('flèches en boucle, Origine et Fin', () => {
    expect(menuKeyMove('ArrowDown', 0, 3)).toEqual({ focus: 1 });
    expect(menuKeyMove('ArrowDown', 2, 3)).toEqual({ focus: 0 });
    expect(menuKeyMove('ArrowUp', 0, 3)).toEqual({ focus: 2 });
    expect(menuKeyMove('ArrowUp', 2, 3)).toEqual({ focus: 1 });
    expect(menuKeyMove('Home', 2, 3)).toEqual({ focus: 0 });
    expect(menuKeyMove('End', 0, 3)).toEqual({ focus: 2 });
  });
  it('sans élément actif : ↓ premier, ↑ dernier', () => {
    expect(menuKeyMove('ArrowDown', -1, 4)).toEqual({ focus: 0 });
    expect(menuKeyMove('ArrowUp', -1, 4)).toEqual({ focus: 3 });
  });
  it('Échap rend le focus au bouton, Tab le laisse suivre', () => {
    expect(menuKeyMove('Escape', 1, 3)).toEqual({ close: 'restore' });
    expect(menuKeyMove('Tab', 1, 3)).toEqual({ close: 'leave' });
    expect(menuKeyMove('Escape', -1, 0)).toEqual({ close: 'restore' });
  });
  it('autre touche ou menu vide : rien', () => {
    expect(menuKeyMove('a', 0, 3)).toBeNull();
    expect(menuKeyMove('Enter', 0, 3)).toBeNull();
    expect(menuKeyMove('ArrowDown', -1, 0)).toBeNull();
  });
});

describe('menuInitialFocus', () => {
  it('choix en cours, sinon premier ; ouverture par ↑ : dernier', () => {
    expect(menuInitialFocus(2, 4)).toBe(2);
    expect(menuInitialFocus(-1, 4)).toBe(0);
    expect(menuInitialFocus(7, 4)).toBe(0);
    expect(menuInitialFocus(1, 4, 'last')).toBe(3);
    expect(menuInitialFocus(0, 0)).toBe(-1);
  });
});
