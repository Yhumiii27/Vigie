import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { QrCode } from '@/components/events/QrCode';
import { appOrigin, loadReportPosts } from '@/lib/data/events';
import { SCREENS, canManage } from '@/lib/domain';
import { activeSiteIds, getSession } from '@/lib/session';
import styles from './postes.module.css';

export const metadata: Metadata = { title: 'QR codes des postes' };

// Planche d'étiquettes à imprimer : un QR code par zone du plan de site, qui ouvre /signaler avec le poste et le site.
export default async function ReportPostsPage({ searchParams }: PageProps<'/signaler/postes'>) {
  const sp = await searchParams;
  const { role } = await getSession();
  if (!canManage(role)) redirect('/signaler');
  const site = typeof sp.site === 'string' && (await activeSiteIds()).includes(sp.site) ? sp.site : undefined;
  const [posts, origin] = await Promise.all([loadReportPosts(site), appOrigin()]);

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div style={{ display: 'grid', gap: 2 }}>
          <Link href={SCREENS.mobile.path} className="vg-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i className="ph ph-caret-left" />Signalement terrain</Link>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>QR codes des postes</h1>
          <span style={{ fontSize: 12.5, color: 'var(--color-neutral-500)' }}>
            {posts.length} poste{posts.length > 1 ? 's' : ''} · zones du plan de site · à coller au poste de travail
          </span>
        </div>
        <PrintButton label="Imprimer" className="btn btn-primary" />
      </div>
      {posts.length === 0 ? (
        <div className="card" style={{ maxWidth: 520, fontSize: 13 }}>
          Aucune zone dessinée sur le plan de site : créez les zones dans Prévention → Carte pour générer leurs QR codes.
        </div>
      ) : (
        <div className={styles.grid}>
          {posts.map((p) => (
            <div key={p.zoneId} className={styles.label}>
              <QrCode value={`${origin}${p.path}`} size={160} label={`QR code du poste ${p.name}`} />
              <span className={styles.name}>{p.name}</span>
              <span className={styles.site}>{p.siteLabel}</span>
              <span className={styles.cta}><i className="ph ph-warning" aria-hidden />Signaler un événement · scannez</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
