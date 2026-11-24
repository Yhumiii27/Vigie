import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { THEME_COOKIE, themeOf } from '@/lib/theme';
import '@phosphor-icons/web/regular';
import './nocturne.css';
import './vigie.css';

// Inter servie depuis le dépôt (fichier variable, sous-ensemble latin, licence OFL : fonts/OFL-Inter.txt) : la construction
// ne télécharge plus la police chez Google Fonts (échecs passagers de l'image Docker, construction hors ligne possible).
const inter = localFont({ src: './fonts/inter-latin-wght.woff2', weight: '100 900', style: 'normal', display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: { default: 'Vigie · QHSE', template: '%s · Vigie' },
  description: 'Pilotage QHSE : signalements, plan d’actions, DUERP, habilitations, veille et audits.',
};

export const viewport: Viewport = { themeColor: '#161826' };

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // CSP à nonce (src/proxy.ts) : toute page est rendue à la requête, pour que Next.js pose le nonce sur ses scripts
  // (page 404 comprise, sinon prérendue sans nonce).
  await connection();
  // Thème sombre / clair (Norma 1.0) : cookie epc2i-theme lu au rendu, attribut posé sur <html> (pas de flash).
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="fr" className={inter.variable} data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
