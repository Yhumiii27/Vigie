import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IOSDevice } from '@/components/IOSDevice';
import { PageHeader } from '@/components/PageHeader';
import { ReportForm } from '@/components/ReportForm';
import { MyReportDetail } from '@/components/events/MyReportDetail';
import { MyReports } from '@/components/events/MyReports';
import { QrCode } from '@/components/events/QrCode';
import { MAX_PHOTOS } from '@/lib/rules/events';
import { MissingNotice, SegLinks } from '@/components/ui';
import { isDemo } from '@/lib/config';
import { loadMyReport, loadMyReports } from '@/lib/data/events';
import { loadReportPosts } from '@/lib/data/report-posts';
import { DEMO_POST } from '@/lib/demo';
import { SCREENS, canManage } from '@/lib/domain';
import { publicOrigin } from '@/lib/public-url';
import { ALL_SITES, getSession } from '@/lib/session';

export const metadata: Metadata = { title: SCREENS.mobile.title };

const PATH = SCREENS.mobile.path;
const MINE = `${PATH}?vue=mes-signalements`;

/**
 * Aperçu mobile du signalement terrain : démonstration seulement (VIGIE_DEMO=1) ; en production, /signaler.
 * Sur un téléphone, pas de cadre iPhone : le lien ouvre directement le formulaire terrain (EVT-06).
 */
export default async function MobilePreviewPage({ searchParams }: PageProps<'/apercu-mobile'>) {
  if (!isDemo()) notFound();
  const sp = await searchParams;
  const mine = sp.vue === 'mes-signalements';
  const sel = mine && typeof sp.sel === 'string' ? sp.sel : undefined;
  const { site, siteOptions, user, role } = await getSession();
  const reportSite = (site.id === ALL_SITES ? siteOptions[0] : site).label.split(' — ')[0];
  const [reports, report, posts, origin] = await Promise.all([
    mine ? loadMyReports() : [],
    sel ? loadMyReport(sel) : null,
    loadReportPosts(),
    publicOrigin(),
  ]);
  const firstPost = posts[0];
  const fieldHref = firstPost?.path ?? `/signaler?lieu=${encodeURIComponent(DEMO_POST)}`;

  return (
    <>
      <PageHeader title={SCREENS.mobile.title} sub="Aperçu mobile · 390 × 844" />
      <div style={{ padding: '0 28px 40px', display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="vg-narrow-only card" style={{ gap: 8, width: '100%' }}>
          <div className="card-title" style={{ fontSize: 15 }}>Sur téléphone</div>
          <Link href={fieldHref} className="btn btn-primary" style={{ minHeight: 44 }}><i className="ph ph-warning" style={{ fontSize: 16 }} aria-hidden />Ouvrir le formulaire terrain</Link>
          <Link href="/signaler/mes-signalements" className="vg-link">Mes signalements →</Link>
        </div>
        <div className="vg-wide-only">
          <IOSDevice width={390} height={844} dark>
            {report
              ? <MyReportDetail report={report} backHref={MINE} />
              : mine
                ? <MyReports reports={reports} userName={user.name} siteLabel={site.id === ALL_SITES ? site.label : reportSite} backHref={PATH}
                    currentSiteId={site.id === ALL_SITES ? null : site.id} detailHref={(id) => `${MINE}&sel=${encodeURIComponent(id)}`} />
                : <ReportForm siteLabel={reportSite} defaultLocation={DEMO_POST} myReportsHref={MINE} />}
          </IOSDevice>
        </div>
        <div style={{ display: 'grid', gap: 14, maxWidth: 360 }}>
          {/* UX-13 : signalement inconnu, d'autrui ou anonyme : même bandeau, liste « Mes signalements » affichée. */}
          {sel && !report && <MissingNotice text="Signalement introuvable ou qui n'est pas le vôtre." closeHref={MINE} />}
          <div>
            <SegLinks options={[
              { href: PATH, label: 'Signaler', on: !mine, icon: 'ph-warning' },
              { href: MINE, label: 'Mes signalements', on: mine, icon: 'ph-list-checks' },
            ]} />
          </div>
          <div className="card" style={{ gap: 8 }}>
            <div className="card-kicker">Parcours terrain</div>
            <div className="card-title" style={{ fontSize: 15 }}>Signaler en moins d&apos;une minute</div>
            <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>Le QR code du poste ouvre ce formulaire avec le lieu et le site pré-remplis. Le signalement crée l&apos;événement à l&apos;étape « Déclaré » dans Vigie, visible dans la liste des signalements et sur le tableau de bord ; l&apos;animateur QHSE le qualifie sous 48 h.</p>
            <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>Jusqu&apos;à {MAX_PHOTOS} photos prises sur le moment accompagnent le signalement et apparaissent sur la fiche de l&apos;événement. Le téléphone les allège avant l&apos;envoi, ce qui retire aussi leurs métadonnées (position, appareil) quand il sait les convertir ; une photo qu&apos;il ne peut pas alléger n&apos;est pas jointe à un signalement anonyme.</p>
            <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>Le mode anonyme masque le déclarant pour tous les rôles, animateur QHSE compris ; un signalement anonyme n&apos;apparaît donc pas dans « Mes signalements ». Les signalements nominatifs y sont suivis tous sites confondus, avec la suite donnée.</p>
            <Link href={fieldHref} className="vg-link">Ouvrir le formulaire terrain (cible du QR code{firstPost ? ` · ${firstPost.name}` : ''}) →</Link>
            <Link href="/signaler/mes-signalements" className="vg-link">Ouvrir « Mes signalements » sur mobile →</Link>
          </div>
          <div className="card" style={{ gap: 10 }}>
            <div className="card-kicker">Affichage au poste</div>
            <div className="card-title" style={{ fontSize: 15 }}>QR codes des postes</div>
            <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
              Un QR code par zone du plan de site{site.id === ALL_SITES ? '' : ` (${reportSite})`} : scanné au poste, il ouvre le formulaire avec le lieu et le site du poste.
            </p>
            {posts.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Aucune zone dessinée sur le plan de site.</span>
            ) : (
              <div style={{ display: 'grid', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                {posts.map((p) => (
                  <div key={p.zoneId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ padding: 3, background: '#fff', borderRadius: 4, flex: 'none' }}><QrCode value={`${origin}${p.path}`} size={72} label={`QR code du poste ${p.name}`} /></span>
                    <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5 }}>{p.name}</span>
                      {site.id === ALL_SITES && <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{p.siteLabel}</span>}
                      <Link href={p.path} className="vg-link">Ouvrir →</Link>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {canManage(role) && posts.length > 0 && (
              <Link href={`/signaler/postes${site.id === ALL_SITES ? '' : `?site=${encodeURIComponent(site.id)}`}`} className="vg-link">
                <i className="ph ph-printer" style={{ marginRight: 4 }} aria-hidden />Imprimer la planche →
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
