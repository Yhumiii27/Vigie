import type { Metadata } from 'next';
import Link from 'next/link';
import { IOSDevice } from '@/components/IOSDevice';
import { PageHeader } from '@/components/PageHeader';
import { ReportForm } from '@/components/ReportForm';
import { MyReports } from '@/components/events/MyReports';
import { MAX_PHOTOS } from '@/components/events/shared';
import { SegLinks } from '@/components/ui';
import { loadMyReports } from '@/lib/data/events';
import { SCREENS } from '@/lib/domain';
import { ALL_SITES, getSession } from '@/lib/session';

export const metadata: Metadata = { title: SCREENS.mobile.title };

const DEMO_POST = 'Atelier montage · poste M3';
const PATH = SCREENS.mobile.path;
const MINE = `${PATH}?vue=mes-signalements`;

export default async function MobilePreviewPage({ searchParams }: PageProps<'/apercu-mobile'>) {
  const sp = await searchParams;
  const mine = sp.vue === 'mes-signalements';
  const { site, siteOptions, user } = await getSession();
  const reportSite = (site.id === ALL_SITES ? siteOptions[0] : site).label.split(' — ')[0];
  const reports = mine ? await loadMyReports() : [];

  return (
    <>
      <PageHeader title={SCREENS.mobile.title} sub="Aperçu mobile · 390 × 844" />
      <div style={{ padding: '0 28px 40px', display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <IOSDevice width={390} height={844} dark>
          {mine
            ? <MyReports reports={reports} userName={user.name} siteLabel={site.id === ALL_SITES ? site.label : reportSite} backHref={PATH} />
            : <ReportForm siteLabel={reportSite} defaultLocation={DEMO_POST} myReportsHref={MINE} />}
        </IOSDevice>
        <div style={{ display: 'grid', gap: 14, maxWidth: 360 }}>
          <div>
            <SegLinks options={[
              { href: PATH, label: 'Signaler', on: !mine, icon: 'ph-warning' },
              { href: MINE, label: 'Mes signalements', on: mine, icon: 'ph-list-checks' },
            ]} />
          </div>
          <div className="card" style={{ gap: 8 }}>
            <div className="card-kicker">Parcours terrain</div>
            <div className="card-title" style={{ fontSize: 15 }}>Signaler en moins d&apos;une minute</div>
            <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>Le QR code du poste ouvre ce formulaire avec le lieu pré-rempli. Le signalement crée l&apos;événement à l&apos;étape « Déclaré » dans Vigie, visible dans la liste des signalements et sur le tableau de bord.</p>
            <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>Jusqu&apos;à {MAX_PHOTOS} photos prises sur le moment accompagnent le signalement et apparaissent sur la fiche de l&apos;événement. Le téléphone les allège avant l&apos;envoi, ce qui retire aussi leurs métadonnées (position, appareil) quand il sait les convertir ; une photo qu&apos;il ne peut pas alléger n&apos;est pas jointe à un signalement anonyme.</p>
            <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>Le mode anonyme masque le déclarant pour tous les rôles, animateur QHSE compris ; un signalement anonyme n&apos;apparaît donc pas dans « Mes signalements ».</p>
            <Link href={`/signaler?lieu=${encodeURIComponent(DEMO_POST)}`} className="vg-link">Ouvrir le formulaire terrain (cible du QR code) →</Link>
            <Link href="/signaler/mes-signalements" className="vg-link">Ouvrir « Mes signalements » sur mobile →</Link>
          </div>
        </div>
      </div>
    </>
  );
}
