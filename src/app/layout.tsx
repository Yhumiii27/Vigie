import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { connection } from 'next/server';
import '@phosphor-icons/web/regular';
import './nocturne.css';
import './vigie.css';

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: { default: 'Vigie · QHSE', template: '%s · Vigie' },
  description: 'Pilotage QHSE : signalements, plan d’actions, DUERP, habilitations, veille et audits.',
};

export const viewport: Viewport = { themeColor: '#161826' };

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // CSP à nonce (src/proxy.ts) : toute page est rendue à la requête, pour que Next.js pose le nonce sur ses scripts
  // (page 404 comprise, sinon prérendue sans nonce).
  await connection();
  return (
    <html lang="fr" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
