import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { QrCode } from '@/components/events/QrCode';
import { loadReportPosts } from '@/lib/data/report-posts';
import { SCREENS, canManage } from '@/lib/domain';
import { publicOrigin } from '@/lib/public-url';
import { activeSiteIds, currentSiteId, getSession, inSite } from '@/lib/session';
import { RegenerateQr } from './RegenerateQr';
import styles from './postes.module.css';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Workstation QR codes') };
}

// Planche d'étiquettes à imprimer : un QR code par zone du plan de site, qui ouvre /signaler avec le jeton signé du poste
// (formulaire accessible sans compte) ; « Régénérer le QR » révoque les étiquettes déjà imprimées d'un poste.
export default async function ReportPostsPage({ searchParams }: PageProps<'/signaler/postes'>) {
  const sp = await searchParams;
  const [{ role, demo }, { t }] = await Promise.all([getSession(), getI18n()]);
  if (!canManage(role)) redirect('/signaler');
  const site = typeof sp.site === 'string' && (await activeSiteIds()).includes(sp.site) ? sp.site : undefined;
  const [posts, origin, selected] = await Promise.all([loadReportPosts(site), publicOrigin(), currentSiteId()]);
  const unsigned = posts.some((p) => !p.signed);
  // Retour : aperçu mobile en démonstration ; sinon la carte du site, où se dessinent les zones.
  const back = demo
    ? { href: SCREENS.mobile.path, label: t('Field report') }
    : { href: `/prevention/carte${site ? `?site=${encodeURIComponent(site)}` : ''}`, label: t('Site map') };

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Link href={back.href} className="vg-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i className="ph ph-caret-left" aria-hidden />{back.label}</Link>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>{t('Workstation QR codes')}</h1>
          <span style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>
            {fill(posts.length > 1 ? t('{n} posts · zones of the site plan · to stick at the workstation') : t('{n} post · zones of the site plan · to stick at the workstation'), { n: posts.length })}
          </span>
        </div>
        <PrintButton label={t('Print')} className="btn btn-primary" />
      </div>
      {unsigned && (
        <div role="status" className={`card ${styles.notice}`}>
          {t('VIGIE_REPORT_SECRET is not set: these QR codes open the form only to people signed in to Vigie. Set it to allow reporting without an account (temporary workers, contractors), then reprint the labels.')}
        </div>
      )}
      {posts.length === 0 ? (
        <div className="card" style={{ maxWidth: 520, fontSize: 13 }}>
          {t('No zone drawn on the site plan: create the zones in Prevention → Map to generate their QR codes.')}
        </div>
      ) : (
        <div className={styles.grid}>
          {posts.map((p) => (
            <div key={p.zoneId} id={`poste-${p.zoneId}`} className={styles.cell}>
              <div className={styles.label}>
                <QrCode value={`${origin}${p.path}`} size={160} label={fill(t('QR code of the post {name}'), { name: p.name })} />
                <span className={styles.name}>{p.name}</span>
                <span className={styles.site}>{p.siteLabel}{p.version > 1 ? fill(t(' · label no. {n}'), { n: p.version }) : ''}</span>
                <span className={styles.cta}><i className="ph ph-warning" aria-hidden />{t('Report an event · scan')}</span>
              </div>
              {p.signed && inSite(selected, p.siteId) && <RegenerateQr zoneId={p.zoneId} name={p.name} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
