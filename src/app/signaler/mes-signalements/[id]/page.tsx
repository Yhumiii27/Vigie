import type { Metadata, Viewport } from 'next';
import { getI18n } from '@/i18n/server';
import { notFound } from 'next/navigation';
import { MyReportDetail } from '@/components/events/MyReportDetail';
import { reportQuery } from '@/lib/rules/events';
import { loadMyReport } from '@/lib/data/events';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('My report') };
}
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
