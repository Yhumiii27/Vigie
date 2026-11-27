import { getI18n, screenMetadata } from '@/i18n/server';
import { fill } from '@/i18n/translate';
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

export const generateMetadata = () => screenMetadata('mobile');

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
  const [{ site, siteOptions, user, role }, { t }] = await Promise.all([getSession(), getI18n()]);
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
      <PageHeader title={SCREENS.mobile.title} sub={t('Mobile preview · 390 × 844')} />
      <div style={{ padding: '0 28px 40px', display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="vg-narrow-only card" style={{ gap: 8, width: '100%' }}>
          <div className="card-title" style={{ fontSize: 15 }}>{t('On a phone')}</div>
          <Link href={fieldHref} className="btn btn-primary" style={{ minHeight: 44 }}><i className="ph ph-warning" style={{ fontSize: 16 }} aria-hidden />{t('Open the field form')}</Link>
          <Link href="/signaler/mes-signalements" className="vg-link">{t('My reports →')}</Link>
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
          {sel && !report && <MissingNotice text={t('Report not found or not yours.')} closeHref={MINE} />}
          <div>
            <SegLinks options={[
              { href: PATH, label: t('Report#verb'), on: !mine, icon: 'ph-warning' },
              { href: MINE, label: t('My reports'), on: mine, icon: 'ph-list-checks' },
            ]} />
          </div>
          <div className="card" style={{ gap: 8 }}>
            <div className="card-kicker">{t('Field journey')}</div>
            <div className="card-title" style={{ fontSize: 15 }}>{t('Report in less than a minute')}</div>
            <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>{t('The QR code of the post opens this form with the location and the site filled in. The report creates the event at the stage “Reported” in Vigie, visible in the list of reports and on the dashboard; the QHSE coordinator qualifies it within 48 h.')}</p>
            <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>{fill(t('Up to {n} photos taken on the spot go with the report and appear on the event sheet. The phone reduces them before sending, which also removes their metadata (position, device) when it can convert them; a photo it cannot reduce is not attached to an anonymous report.'), { n: MAX_PHOTOS })}</p>
            <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>{t('The anonymous mode hides the reporter from every role, QHSE coordinator included; an anonymous report therefore does not appear in “My reports”. Named reports are followed there across all sites, with the follow-up given.')}</p>
            <Link href={fieldHref} className="vg-link">{firstPost ? fill(t('Open the field form (target of the QR code · {post}) →'), { post: firstPost.name }) : t('Open the field form (target of the QR code) →')}</Link>
            <Link href="/signaler/mes-signalements" className="vg-link">{t('Open “My reports” on mobile →')}</Link>
          </div>
          <div className="card" style={{ gap: 10 }}>
            <div className="card-kicker">{t('Display at the post')}</div>
            <div className="card-title" style={{ fontSize: 15 }}>{t('QR codes of the posts')}</div>
            <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
              {site.id === ALL_SITES ? t('One QR code per zone of the site plan: scanned at the post, it opens the form with the location and the site of the post.') : fill(t('One QR code per zone of the site plan ({site}): scanned at the post, it opens the form with the location and the site of the post.'), { site: reportSite })}
            </p>
            {posts.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{t('No zone drawn on the site plan.')}</span>
            ) : (
              <div style={{ display: 'grid', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                {posts.map((p) => (
                  <div key={p.zoneId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ padding: 3, background: '#fff', borderRadius: 4, flex: 'none' }}><QrCode value={`${origin}${p.path}`} size={72} label={fill(t('QR code of the post {post}'), { post: p.name })} /></span>
                    <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5 }}>{p.name}</span>
                      {site.id === ALL_SITES && <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{p.siteLabel}</span>}
                      <Link href={p.path} className="vg-link">{t('Open →')}</Link>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {canManage(role) && posts.length > 0 && (
              <Link href={`/signaler/postes${site.id === ALL_SITES ? '' : `?site=${encodeURIComponent(site.id)}`}`} className="vg-link">
                <i className="ph ph-printer" style={{ marginRight: 4 }} aria-hidden />{t('Print the sheet →')}
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
