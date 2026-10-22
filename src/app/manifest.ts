import type { MetadataRoute } from 'next';
import { REPORT_SW_SCOPE } from '@/lib/pwa';

// Manifeste du signalement terrain installable (EVT-20) : /manifest.webmanifest, ouvert sans session (src/proxy.ts),
// lié aux seules pages /signaler (src/app/signaler/layout.tsx ; manifest: null ailleurs). Portée et démarrage : /signaler.
// Couleurs du design system Nocturne (--color-bg, --color-accent) ; icônes : scripts/pwa-icons.mjs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: REPORT_SW_SCOPE,
    name: 'Vigie · Signalement terrain',
    short_name: 'Signaler',
    description: 'Signaler un accident, un presqu’accident, une situation dangereuse ou un événement QSE depuis le poste de travail.',
    lang: 'fr',
    dir: 'ltr',
    start_url: REPORT_SW_SCOPE,
    scope: REPORT_SW_SCOPE,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#161826',
    theme_color: '#161826',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/pwa/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
