import type { Metadata, Viewport } from 'next';
import { ReportForm } from '@/components/ReportForm';
import { reportQuery } from '@/components/events/shared';
import { resolveReportPost } from '@/lib/data/events';
import { EVENT_TYPE_KEYS } from '@/lib/domain';
import { ALL_SITES, getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Signaler' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#161826' };

// Cible des QR codes de poste : /signaler?poste=12&site=ville-a (zone du plan de site), ou /signaler?lieu=… (lieu libre) ;
// ?type=ENV présélectionne le type (lien « Signaler » de l'écran Environnement).
export default async function ReportPage({ searchParams }: PageProps<'/signaler'>) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
  const [{ site, siteOptions }, post] = await Promise.all([getSession(), resolveReportPost(str(sp.poste), str(sp.site))]);
  // Le poste du QR code fixe le lieu et le site, quel que soit le site de la session.
  const siteLabel = post?.siteLabel ?? (site.id === ALL_SITES ? siteOptions[0] : site).label.split(' — ')[0];
  const lieu = post?.name ?? str(sp.lieu) ?? '';
  const type = EVENT_TYPE_KEYS.find((k) => k === str(sp.type));
  // Les paramètres du QR code sont conservés pour revenir au formulaire depuis « Mes signalements ».
  const myReportsHref = `/signaler/mes-signalements${reportQuery(sp)}`;
  return (
    <div style={{ minHeight: '100dvh', maxWidth: 480, margin: '0 auto' }}>
      <ReportForm siteLabel={siteLabel} siteId={post?.siteId} defaultLocation={lieu} topPadding={24} myReportsHref={myReportsHref} defaultType={type} />
    </div>
  );
}
