// Thème d'affichage sombre / clair (Norma 1.0, charte « Thème sombre / clair ») : règles pures du socle commun
// (norma/charte/ds/theme.ts : cookie atrium-theme depuis Norma 3.0, même nom dans tous les outils de la suite Atrium ;
// l'ancien nom reste lu à défaut du nouveau pendant la transition, jamais écrit), reprises ici pour que l'application
// n'importe la copie de Norma qu'à un seul endroit. Côté serveur : `themeFromCookies((n) => jar.get(n)?.value)`.
export {
  LEGACY_THEME_COOKIE, THEME_COOKIE, THEME_COOKIES_READ, themeCookie, themeFromCookies, themeOf, type Theme,
} from '@norma/charte/ds/theme';
