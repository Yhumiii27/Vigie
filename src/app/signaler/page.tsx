import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ReportForm } from '@/components/ReportForm';
import { reportQuery } from '@/lib/rules/events';
import { LOGIN_PATH, MY_SPACE_PATH, REPORT_TOKEN_PARAM } from '@/lib/auth/paths';
import { loadSiteZones, loadZoneRisks, resolveReportPost, resolveReportToken } from '@/lib/data/report-posts';
import { REPORT_TYPE_KEYS } from '@/lib/domain';
import { ALL_SITES, getOptionalSession } from '@/lib/session';
import { getI18n } from '@/i18n/server';
import type { T } from '@/i18n/translate';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Report#verb'), robots: { index: false, follow: false } };
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#161826' };

// Message du QR code d'une zone archivée : même texte que ARCHIVED_POST_NOTICE (src/lib/data/report-posts.ts), rendu par t().
const Frame = ({ children }: { children: ReactNode }) => <div style={{ minHeight: '100dvh', maxWidth: 480, margin: '0 auto' }}>{children}</div>;
const muted = { fontSize: 13.5, color: 'var(--color-neutral-400)', textWrap: 'pretty', margin: 0 } as const;

// Formulaire de signalement terrain (EVT-06, EVT-07), sur téléphone comme sur poste de travail.
// - QR code de poste : /signaler?jeton=<jeton signé> (src/lib/report-token.ts) — lieu et site pré-remplis ; sans session,
//   c'est le seul accès au formulaire (anonyme ou nom + entreprise déclarés), le proxy laissant passer ce seul cas.
// - Personne connectée : bouton « Nouveau signalement », ancien QR code ?poste=12&site=site_a, lieu libre ?lieu=… ;
//   ?type=ENV présélectionne le type (lien « Signaler » de l'écran Environnement).
export default async function ReportPage({ searchParams }: PageProps<'/signaler'>) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
  const token = str(sp[REPORT_TOKEN_PARAM]);
  const [session, check, { t }] = await Promise.all([getOptionalSession(), token ? resolveReportToken(token) : null, getI18n()]);
  const type = REPORT_TYPE_KEYS.find((k) => k === str(sp.type));
  // Les paramètres du QR code sont conservés (retour depuis « Mes signalements », retour après la connexion).
  const qs = reportQuery(sp);
  const loginHref = `${LOGIN_PATH}?retour=${encodeURIComponent(`/signaler${qs}`)}`;

  if (!session) {
    if (!check || !('post' in check)) return <Frame><Unavailable status={check?.status === 'revoked' ? 'revoked' : 'invalid'} loginHref={loginHref} t={t} /></Frame>;
    // QR code d'une zone archivée (EVT-19) : formulaire ouvert sur le site du poste, lieu à choisir parmi ses zones.
    const archived = check.status === 'archived';
    const zones = archived ? await loadSiteZones(check.post.siteId) : undefined;
    // DUE-20 : risques de l'unité de travail du poste (ou des zones proposées), à rattacher au signalement.
    const zoneRisks = await loadZoneRisks(archived ? (zones ?? []).map((z) => z.id) : [check.post.zoneId]);
    return (
      <Frame>
        <ReportForm publicMode token={token} siteLabel={check.post.siteLabel} defaultLocation={archived ? '' : check.post.name} topPadding={24}
          defaultType={type} loginHref={loginHref}
          zones={zones} notice={archived ? t('This post no longer exists: choose the location.') : undefined}
          postZoneId={archived ? undefined : check.post.zoneId} zoneRisks={zoneRisks} />
      </Frame>
    );
  }

  const { site, siteOptions } = session;
  // Le poste du QR code fixe le lieu et le site, quel que soit le site de la session ; zone archivée (EVT-19) : le site
  // seulement, le lieu est à choisir.
  const live = check?.status === 'ok' ? check.post : null;
  const gone = check?.status === 'archived' ? check.post : null;
  const legacy = check ? null : await resolveReportPost(str(sp.poste), str(sp.site));
  const post = live ?? (legacy && !legacy.archived ? legacy : null);
  const archivedPost = gone ?? (legacy?.archived ? legacy : null);
  const fallbackSite = site.id === ALL_SITES ? siteOptions.find((s) => s.id !== ALL_SITES) : site;
  const siteLabel = (post ?? archivedPost)?.siteLabel ?? (fallbackSite ?? site).label.split(' — ')[0];
  const lieu = post?.name ?? (archivedPost ? '' : str(sp.lieu) ?? '');
  // Lieux proposés (zones en service) quand le QR code ne fixe pas le poste.
  const zones = live ? [] : await loadSiteZones((post ?? archivedPost)?.siteId ?? fallbackSite?.id);
  const notice = archivedPost ? t('This post no longer exists: choose the location.') : undefined;
  // DUE-20 : risques de l'unité de travail du poste (QR code) ou des zones proposées.
  const zoneRisks = await loadZoneRisks(live ? [live.zoneId] : zones.map((z) => z.id));
  return (
    <Frame>
      <div style={{ padding: '14px 18px 0', display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Link href="/" className="vg-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44, fontSize: 12.5 }}>
            <i className="ph ph-caret-left" aria-hidden />{t('Back to Vigie')}
          </Link>
          {/* EVT-22 : espace salarié mobile (mes actions, mes habilitations, mes signalements). */}
          <Link href={`${MY_SPACE_PATH}${qs}`} className="vg-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44, fontSize: 12.5 }}>
            <i className="ph ph-user-circle" aria-hidden />{t('My space')}
          </Link>
        </div>
        {check && !('post' in check) && (
          <div role="status" className="card" style={{ gap: 4, fontSize: 12.5 }}>
            <span style={{ color: 'var(--tone-warn-fg)' }}>{check.status === 'revoked' ? t('QR code replaced') : t('QR code not recognised')}</span>
            <span style={{ color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
              {t('The report will be recorded on your site; specify the location. Tell the QHSE coordinator to have the label replaced.')}
            </span>
          </div>
        )}
      </div>
      <ReportForm token={check && 'post' in check ? token : undefined} siteLabel={siteLabel} siteId={(post ?? archivedPost)?.siteId} defaultLocation={lieu}
        topPadding={14} myReportsHref={`/signaler/mes-signalements${qs}`} defaultType={type}
        zones={zones} defaultZoneId={legacy && !legacy.archived ? legacy.zoneId : undefined} notice={notice}
        postZoneId={live?.zoneId} zoneRisks={zoneRisks} />
    </Frame>
  );
}

/** Sans session, QR code révoqué ou inconnu : pas de formulaire ; proposer la connexion. */
function Unavailable({ status, loginHref, t }: { status: 'revoked' | 'invalid'; loginHref: string; t: T }) {
  return (
    <div style={{ padding: '72px 18px 40px', display: 'grid', gap: 14, justifyItems: 'center', textAlign: 'center', fontFamily: 'var(--font-body)' }}>
      <span style={{ width: 64, height: 64, borderRadius: '50%', border: '1px solid var(--tone-warn-fg)', color: 'var(--tone-warn-fg)', display: 'grid', placeItems: 'center' }}>
        <i className="ph ph-qr-code" style={{ fontSize: 30 }} aria-hidden />
      </span>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>{status === 'revoked' ? t('QR code replaced') : t('QR code not recognised')}</h1>
      <p style={muted}>
        {status === 'revoked'
          ? t('This QR code has been replaced by a new label: scan the one displayed at the workstation.')
          : t('This link matches no reporting post: scan the QR code displayed at the workstation.')}
      </p>
      <p style={muted}>{t('In an emergency, alert your manager or the QHSE coordinator immediately.')}</p>
      <a href={loginHref} className="btn btn-secondary" style={{ minHeight: 44 }}><i className="ph ph-sign-in" style={{ fontSize: 16 }} aria-hidden />{t('Sign in to Vigie')}</a>
    </div>
  );
}
