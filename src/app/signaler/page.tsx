import type { Metadata, Viewport } from 'next';
import { ReportForm } from '@/components/ReportForm';
import { ALL_SITES, getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Signaler' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#161826' };

// Cible des QR codes de poste : /signaler?lieu=Atelier%20montage%20·%20poste%20M3
export default async function ReportPage({ searchParams }: PageProps<'/signaler'>) {
  const sp = await searchParams;
  const { site, siteOptions } = await getSession();
  const siteLabel = (site.id === ALL_SITES ? siteOptions[0] : site).label.split(' — ')[0];
  const lieu = typeof sp.lieu === 'string' ? sp.lieu : '';
  // Le lieu du QR code est conservé pour revenir au formulaire depuis « Mes signalements ».
  const myReportsHref = lieu ? `/signaler/mes-signalements?lieu=${encodeURIComponent(lieu)}` : '/signaler/mes-signalements';
  return (
    <div style={{ minHeight: '100dvh', maxWidth: 480, margin: '0 auto' }}>
      <ReportForm siteLabel={siteLabel} defaultLocation={lieu} topPadding={24} myReportsHref={myReportsHref} />
    </div>
  );
}
