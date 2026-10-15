import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { MyReportDetail } from '@/components/events/MyReportDetail';
import { reportQuery } from '@/components/events/shared';
import { loadMyReport } from '@/lib/data/events';

export const metadata: Metadata = { title: 'Mon signalement' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#161826' };

// Détail d'un signalement pour son déclarant ; un signalement d'autrui ou anonyme est introuvable.
export default async function MyReportPage({ params, searchParams }: PageProps<'/signaler/mes-signalements/[id]'>) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const report = await loadMyReport(id);
  if (!report) notFound();
  return (
    <div style={{ minHeight: '100dvh', maxWidth: 480, margin: '0 auto' }}>
      <MyReportDetail report={report} backHref={`/signaler/mes-signalements${reportQuery(sp)}`} topPadding={24} />
    </div>
  );
}
