import { LOGOUT_PATH } from '@/lib/auth/paths';
import type { Option } from '@/lib/data/options';
import { canApprove } from '@/lib/domain';
import type { Session } from '@/lib/session';
import { saveSite } from '@/server/sites';
import { ActionForm } from './form';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';
import { MatrixSiteField, QhseLeadField, type MatrixChoices } from './SitesManager';

/**
 * Amorçage d'une base de production vide (aucun site actif) : l'animateur QHSE ou la direction crée le premier site ;
 * les autres rôles sont invités à patienter. Remplace tout l'écran tant qu'aucun site n'existe.
 */
export async function Bootstrap({ session, leadOptions, matrix }: { session: Session; leadOptions: Option[]; matrix: MatrixChoices }) {
  const { role, user, demo } = session;
  const admin = canApprove(role);
  const { t } = await getI18n();
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ display: 'grid', gap: 16, width: '100%', maxWidth: 520 }}>
        <div className="vg-brand" style={{ padding: 0, justifySelf: 'center' }}>
          <span className="coque-logo" aria-hidden><i className="ph ph-binoculars" style={{ fontSize: 15 }} aria-hidden /></span>
          <span className="coque-wordmark">Vigie</span>
        </div>
        <div className="card" style={{ gap: 12 }}>
          <div className="card-kicker">{t('First commissioning')}</div>
          <div className="card-title" style={{ fontSize: 16 }}>{admin ? t('Follow the first site') : t('Vigie is not configured yet')}</div>
          <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
            {admin
              ? t('No site is followed yet. Every report, action, check or work unit belongs to a site: choose the first one in the site register of Matrix to begin. The next ones are added from “Manage sites…”, in the site selector.')
              : fill(t('Signed in as {name} ({role}). No site is recorded yet: a QHSE coordinator or management must create the first site before Vigie can be used.'), { name: user.name, role: labelT(t)(role) })}
          </p>
          {admin && (
            <ActionForm action={saveSite} hidden={{ id: '' }} submitLabel={t('Follow the site')} submitIcon="ph-factory">
              <MatrixSiteField matrix={matrix} />
              <QhseLeadField options={leadOptions} current={{ qhseLeadId: role === 'Animateur QHSE' ? user.id : null, qhseLead: user.name }} />
            </ActionForm>
          )}
          {!demo && <a href={LOGOUT_PATH} className="vg-link" style={{ justifySelf: 'start' }}>{t('Sign out')}</a>}
        </div>
      </div>
    </main>
  );
}
