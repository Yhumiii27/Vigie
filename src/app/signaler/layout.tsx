import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ReportWorker } from '@/components/ReportWorker';
import { APPLE_TOUCH_ICON, MANIFEST_PATH } from '@/lib/pwa';

// Signalement terrain installable (EVT-20) : manifeste (src/app/manifest.ts), icône d'écran d'accueil iOS, service
// worker limité à /signaler (src/components/ReportWorker.tsx), zones sûres de l'écran (encoche, barre d'accueil :
// viewport-fit=cover et .vg-report-shell, src/app/vigie.css).
export const metadata: Metadata = {
  manifest: MANIFEST_PATH,
  applicationName: 'Vigie · Signalement',
  appleWebApp: { capable: true, title: 'Signaler', statusBarStyle: 'black-translucent' },
  icons: { apple: [{ url: APPLE_TOUCH_ICON, sizes: '180x180', type: 'image/png' }] },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { viewportFit: 'cover', themeColor: '#161826' };

export default function ReportLayout({ children }: { children: ReactNode }) {
  return (
    <div className="vg-report-shell">
      {children}
      <ReportWorker />
    </div>
  );
}
