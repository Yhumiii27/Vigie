import type { Metadata, Viewport } from 'next';
import { MyReports } from '@/components/events/MyReports';
import { loadMyReports } from '@/lib/data/events';
import { ALL_SITES, getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Mes signalements' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#161826' };

// Suivi des signalements nominatifs de l'utilisateur (parcours terrain, sans la coque de l'application).
export default async function MyReportsPage({ searchParams }: PageProps<'/signaler/mes-signalements'>) {
  const sp = await searchParams;
  const [{ user, site }, reports] = await Promise.all([getSession(), loadMyReports()]);
  const siteLabel = site.id === ALL_SITES ? site.label : site.label.split(' — ')[0];
  const lieu = typeof sp.lieu === 'string' ? sp.lieu : '';
  return (
    <div style={{ minHeight: '100dvh', maxWidth: 480, margin: '0 auto' }}>
      <MyReports reports={reports} userName={user.name} siteLabel={siteLabel} backHref={lieu ? `/signaler?lieu=${encodeURIComponent(lieu)}` : '/signaler'} topPadding={24} />
    </div>
  );
}
