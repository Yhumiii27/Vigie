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

export const metadata: Metadata = { title: 'QR codes des postes' };

// Planche d'étiquettes à imprimer : un QR code par zone du plan de site, qui ouvre /signaler avec le jeton signé du poste
// (formulaire accessible sans compte) ; « Régénérer le QR » révoque les étiquettes déjà imprimées d'un poste.
export default async function ReportPostsPage({ searchParams }: PageProps<'/signaler/postes'>) {
  const sp = await searchParams;
  const { role, demo } = await getSession();
  if (!canManage(role)) redirect('/signaler');
  const site = typeof sp.site === 'string' && (await activeSiteIds()).includes(sp.site) ? sp.site : undefined;
  const [posts, origin, selected] = await Promise.all([loadReportPosts(site), publicOrigin(), currentSiteId()]);
  const unsigned = posts.some((p) => !p.signed);
  // Retour : aperçu mobile en démonstration ; sinon la carte du site, où se dessinent les zones.
  const back = demo
    ? { href: SCREENS.mobile.path, label: 'Signalement terrain' }
    : { href: `/prevention/carte${site ? `?site=${encodeURIComponent(site)}` : ''}`, label: 'Carte du site' };

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Link href={back.href} className="vg-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i className="ph ph-caret-left" aria-hidden />{back.label}</Link>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>QR codes des postes</h1>
          <span style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>
            {posts.length} poste{posts.length > 1 ? 's' : ''} · zones du plan de site · à coller au poste de travail
          </span>
        </div>
        <PrintButton label="Imprimer" className="btn btn-primary" />
      </div>
      {unsigned && (
        <div role="status" className={`card ${styles.notice}`}>
          VIGIE_REPORT_SECRET n&apos;est pas défini : ces QR codes n&apos;ouvrent le formulaire qu&apos;aux personnes connectées à Vigie.
          Définissez-le pour permettre le signalement sans compte (intérimaires, entreprises extérieures), puis réimprimez les étiquettes.
        </div>
      )}
      {posts.length === 0 ? (
        <div className="card" style={{ maxWidth: 520, fontSize: 13 }}>
          Aucune zone dessinée sur le plan de site : créez les zones dans Prévention → Carte pour générer leurs QR codes.
        </div>
      ) : (
        <div className={styles.grid}>
          {posts.map((p) => (
            <div key={p.zoneId} id={`poste-${p.zoneId}`} className={styles.cell}>
              <div className={styles.label}>
                <QrCode value={`${origin}${p.path}`} size={160} label={`QR code du poste ${p.name}`} />
                <span className={styles.name}>{p.name}</span>
                <span className={styles.site}>{p.siteLabel}{p.version > 1 ? ` · étiquette n° ${p.version}` : ''}</span>
                <span className={styles.cta}><i className="ph ph-warning" aria-hidden />Signaler un événement · scannez</span>
              </div>
              {p.signed && inSite(selected, p.siteId) && <RegenerateQr zoneId={p.zoneId} name={p.name} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
