import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ReportForm } from '@/components/ReportForm';
import { reportQuery } from '@/components/events/shared';
import { LOGIN_PATH, REPORT_TOKEN_PARAM } from '@/lib/auth/paths';
import { resolveReportPost, resolveReportToken, type ReportTokenCheck } from '@/lib/data/report-posts';
import { EVENT_TYPE_KEYS } from '@/lib/domain';
import { ALL_SITES, getOptionalSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Signaler', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#161826' };

const Frame = ({ children }: { children: ReactNode }) => <div style={{ minHeight: '100dvh', maxWidth: 480, margin: '0 auto' }}>{children}</div>;
const muted = { fontSize: 13.5, color: 'var(--color-neutral-400)', textWrap: 'pretty', margin: 0 } as const;

// Formulaire de signalement terrain (EVT-06, EVT-07), sur téléphone comme sur poste de travail.
// - QR code de poste : /signaler?jeton=<jeton signé> (src/lib/report-token.ts) — lieu et site pré-remplis ; sans session,
//   c'est le seul accès au formulaire (anonyme ou nom + entreprise déclarés), le proxy laissant passer ce seul cas.
// - Personne connectée : bouton « Nouveau signalement », ancien QR code ?poste=12&site=ville-a, lieu libre ?lieu=… ;
//   ?type=ENV présélectionne le type (lien « Signaler » de l'écran Environnement).
export default async function ReportPage({ searchParams }: PageProps<'/signaler'>) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
  const token = str(sp[REPORT_TOKEN_PARAM]);
  const [session, check] = await Promise.all([getOptionalSession(), token ? resolveReportToken(token) : null]);
  const type = EVENT_TYPE_KEYS.find((k) => k === str(sp.type));
  // Les paramètres du QR code sont conservés (retour depuis « Mes signalements », retour après la connexion).
  const qs = reportQuery(sp);
  const loginHref = `${LOGIN_PATH}?retour=${encodeURIComponent(`/signaler${qs}`)}`;

  if (!session) {
    if (check?.status !== 'ok') return <Frame><Unavailable status={check?.status ?? 'invalid'} loginHref={loginHref} /></Frame>;
    return (
      <Frame>
        <ReportForm publicMode token={token} siteLabel={check.post.siteLabel} defaultLocation={check.post.name} topPadding={24}
          defaultType={type} loginHref={loginHref} />
      </Frame>
    );
  }

  const { site, siteOptions } = session;
  // Le poste du QR code fixe le lieu et le site, quel que soit le site de la session.
  const post = check?.status === 'ok' ? check.post : await resolveReportPost(str(sp.poste), str(sp.site));
  const siteLabel = post?.siteLabel ?? (site.id === ALL_SITES ? siteOptions[0] : site).label.split(' — ')[0];
  const lieu = post?.name ?? str(sp.lieu) ?? '';
  return (
    <Frame>
      <div style={{ padding: '14px 18px 0', display: 'grid', gap: 10 }}>
        <Link href="/" className="vg-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44, fontSize: 12.5, justifySelf: 'start' }}>
          <i className="ph ph-caret-left" />Retour à Vigie
        </Link>
        {check && check.status !== 'ok' && (
          <div role="status" className="card" style={{ gap: 4, fontSize: 12.5 }}>
            <span style={{ color: 'var(--tone-warn-fg)' }}>{check.status === 'revoked' ? 'QR code remplacé' : 'QR code non reconnu'}</span>
            <span style={{ color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
              Le signalement sera enregistré sur votre site ; précisez le lieu. Prévenez l&apos;animateur QHSE pour faire remplacer l&apos;étiquette.
            </span>
          </div>
        )}
      </div>
      <ReportForm token={check?.status === 'ok' ? token : undefined} siteLabel={siteLabel} siteId={post?.siteId} defaultLocation={lieu}
        topPadding={14} myReportsHref={`/signaler/mes-signalements${qs}`} defaultType={type} />
    </Frame>
  );
}

/** Sans session, QR code révoqué ou inconnu : pas de formulaire ; proposer la connexion. */
function Unavailable({ status, loginHref }: { status: Exclude<ReportTokenCheck['status'], 'ok'>; loginHref: string }) {
  return (
    <div style={{ padding: '72px 18px 40px', display: 'grid', gap: 14, justifyItems: 'center', textAlign: 'center', fontFamily: 'var(--font-body)' }}>
      <span style={{ width: 64, height: 64, borderRadius: '50%', border: '1px solid var(--tone-warn-fg)', color: 'var(--tone-warn-fg)', display: 'grid', placeItems: 'center' }}>
        <i className="ph ph-qr-code" style={{ fontSize: 30 }} />
      </span>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>{status === 'revoked' ? 'QR code remplacé' : 'QR code non reconnu'}</h1>
      <p style={muted}>
        {status === 'revoked'
          ? 'Ce QR code a été remplacé par une nouvelle étiquette : scannez celle qui est affichée au poste.'
          : 'Ce lien ne correspond à aucun poste de signalement : scannez le QR code affiché au poste de travail.'}
      </p>
      <p style={muted}>En cas d&apos;urgence, prévenez immédiatement votre responsable ou l&apos;animateur QHSE.</p>
      <a href={loginHref} className="btn btn-secondary" style={{ minHeight: 44 }}><i className="ph ph-sign-in" style={{ fontSize: 16 }} />Se connecter à Vigie</a>
    </div>
  );
}
