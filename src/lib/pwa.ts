// Signalement installable (EVT-20) : chemins publics du manifeste, des icônes et du service worker. Module sans dépendance
// serveur (utilisable par src/proxy.ts, next.config.ts, le manifeste et le composant d'enregistrement).
//
// Le service worker est servi à la racine (/signaler-sw.js) et enregistré avec la portée /signaler (formulaire terrain,
// « Mes signalements ») : il ne contrôle aucune autre page de Vigie. Il ne met rien en cache — ni page, ni donnée
// authentifiée, ni réponse de server action — et n'intercepte que les navigations : hors ligne, il répond par une page
// « Vous êtes hors ligne, réessayez » construite par lui-même. La file d'attente hors ligne des signalements est EVT-21.

/** Manifeste généré par src/app/manifest.ts. */
export const MANIFEST_PATH = '/manifest.webmanifest';
/** Script du service worker (public/signaler-sw.js) et sa portée. */
export const REPORT_SW_PATH = '/signaler-sw.js';
export const REPORT_SW_SCOPE = '/signaler';
/** Icônes (public/pwa/, générées par scripts/pwa-icons.mjs). */
export const PWA_ICON_DIR = '/pwa/';
export const APPLE_TOUCH_ICON = '/pwa/apple-touch-icon.png';

/** Ressources du signalement installable, ouvertes sans session : fichiers statiques, sans aucune donnée. */
export function isPwaAsset(pathname: string): boolean {
  return pathname === MANIFEST_PATH || pathname === REPORT_SW_PATH || (pathname.startsWith(PWA_ICON_DIR) && /^\/pwa\/[a-z0-9-]+\.(png|svg)$/.test(pathname));
}

/** En-têtes du script du service worker (next.config.ts) : jamais mis en cache, portée limitée à /signaler. */
export const REPORT_SW_HEADERS = [
  { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
  { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
  { key: 'Service-Worker-Allowed', value: REPORT_SW_SCOPE },
];
