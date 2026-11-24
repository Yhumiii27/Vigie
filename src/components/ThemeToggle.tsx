'use client';

import { useState } from 'react';
import { themeCookie, type Theme } from '@/lib/theme';
import { useI18n } from '@/i18n/client';

const OPTIONS: readonly (readonly [Theme, string])[] = [
  ['dark', 'ph-moon'],
  ['light', 'ph-sun'],
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
 * Placé dans l'en-tête de la barre latérale, juste après le sélecteur FR / EN (LangToggle, VG-N01). Libellés traduits par t().
 */
export function ThemeToggle({ theme: initial }: { theme: Theme }) {
  const { t } = useI18n();
  const labels: Record<Theme, string> = { dark: t('Dark display'), light: t('Light display') };
  const [theme, setTheme] = useState<Theme>(initial);
  const choose = (v: Theme) => {
    setTheme(v);
    applyTheme(v);
  };
  return (
    <div className="seg vg-theme-toggle" role="radiogroup" aria-label={t('Dark / light display')}>
      {OPTIONS.map(([value, icon]) => (
        <label key={value} className="seg-opt vg-tip">
          <input type="radio" name="vg-theme" value={value} checked={theme === value} onChange={() => choose(value)} />
          <i className={`ph ${icon}`} aria-hidden />
          <span className="vg-sr-only">{labels[value]}</span>
          <span className="vg-tip-bubble" aria-hidden>{labels[value]}</span>
        </label>
      ))}
    </div>
  );
}
