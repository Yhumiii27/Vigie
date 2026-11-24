'use client';

import { PrefsStack } from './coque';
import { langCookie, type Lang } from '@/i18n/translate';
import type { Theme } from '@/lib/theme';

/** Applique la langue dans le navigateur : cookie vigie-lang (relu par le serveur au rendu) et attribut lang de <html>. */
function applyLang(lang: Lang) {
  document.cookie = langCookie(lang);
  document.documentElement.lang = lang;
}

/**
 * Langue et affichage empilés (Norma 2.1, COQUE.md § 4, demande du propriétaire du 24/11/2026) : FR | EN au-dessus de
 * sombre | clair, de même taille, bords gauches alignés ; dernier élément de l'en-tête de chaque page (> 1024 px) et de la
 * barre supérieure (≤ 1024 px), nulle part ailleurs. La langue écrit le cookie dans le navigateur puis la page est relue
 * (le serveur rend l'interface dans la langue choisie, VG-N01) ; l'affichage pose data-theme et le cookie epc2i-theme.
 */
export function Prefs({ lang, theme }: { lang: Lang; theme: Theme }) {
  return <PrefsStack lang={lang} theme={theme} onSelect={applyLang} />;
}
