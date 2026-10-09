import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import '@phosphor-icons/web/regular';
import './nocturne.css';
import './vigie.css';

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: { default: 'Vigie · QHSE', template: '%s · Vigie' },
  description: 'Pilotage QHSE : signalements, plan d’actions, DUERP, habilitations, veille et audits.',
};

export const viewport: Viewport = { themeColor: '#161826' };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="fr" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
