'use client';

import { useState } from 'react';
import { themeCookie, type Theme } from '@/lib/theme';

const OPTIONS: readonly (readonly [Theme, string, string])[] = [
  ['dark', 'Affichage sombre', 'ph-moon'],
  ['light', 'Affichage clair', 'ph-sun'],
];

/** Applique le thème dans le navigateur : attribut de <html> (variables de nocturne.css et vigie.css) et cookie. */
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.cookie = themeCookie(theme);
}

/**
 * Bascule sombre / clair (Norma 1.0, équivalent de norma/charte/ds/ThemeToggle.tsx pour Vigie : interface en français,
 * icônes de la police Phosphor). Change l'attribut data-theme de <html> et le cookie epc2i-theme dans le navigateur, sans
 * aller-retour au serveur ; le serveur relit le cookie à la page suivante (src/app/layout.tsx, pas de flash).
 * Vigie n'a pas de sélecteur de langue : le bouton est dans l'en-tête de la barre latérale, à côté du nom de l'outil.
 */
export function ThemeToggle({ theme: initial }: { theme: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const choose = (v: Theme) => {
    setTheme(v);
    applyTheme(v);
  };
  return (
    <div className="seg vg-theme-toggle" role="radiogroup" aria-label="Affichage">
      {OPTIONS.map(([value, label, icon]) => (
        <label key={value} className="seg-opt vg-tip">
          <input type="radio" name="vg-theme" value={value} checked={theme === value} onChange={() => choose(value)} />
          <i className={`ph ${icon}`} aria-hidden />
          <span className="vg-sr-only">{label}</span>
          <span className="vg-tip-bubble" aria-hidden>{label}</span>
        </label>
      ))}
    </div>
  );
}
