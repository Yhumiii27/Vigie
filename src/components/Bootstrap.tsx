import { LOGOUT_PATH } from '@/lib/auth/paths';
import type { Option } from '@/lib/data/options';
import { canApprove } from '@/lib/domain';
import type { Session } from '@/lib/session';
import { saveSite } from '@/server/sites';
import { ActionForm } from './form';
import { MatrixSiteField, QhseLeadField, type MatrixChoices } from './SitesManager';

/**
 * Amorçage d'une base de production vide (aucun site actif) : l'animateur QHSE ou la direction crée le premier site ;
 * les autres rôles sont invités à patienter. Remplace tout l'écran tant qu'aucun site n'existe.
 */
export function Bootstrap({ session, leadOptions, matrix }: { session: Session; leadOptions: Option[]; matrix: MatrixChoices }) {
  const { role, user, demo } = session;
  const admin = canApprove(role);
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ display: 'grid', gap: 16, width: '100%', maxWidth: 520 }}>
        <div className="vg-brand" style={{ padding: 0, justifySelf: 'center' }}>
          <span className="vg-brand-mark">V</span>
          <span className="vg-brand-name">Vigie</span>
        </div>
        <div className="card" style={{ gap: 12 }}>
          <div className="card-kicker">Première mise en service</div>
          <div className="card-title" style={{ fontSize: 16 }}>{admin ? 'Suivre le premier site' : 'Vigie n’est pas encore configuré'}</div>
          <p className="card-body" style={{ opacity: 1, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
            {admin
              ? 'Aucun site n’est encore suivi. Chaque signalement, action, contrôle ou unité de travail est rattaché à un site : choisissez le premier dans le référentiel des sites de Matrix pour commencer. Les suivants s’ajoutent ensuite depuis « Gérer les sites… », dans le sélecteur de site.'
              : `Connecté en tant que ${user.name} (${role}). Aucun site n’est encore enregistré : un animateur QHSE ou la direction doit créer le premier site avant que Vigie soit utilisable.`}
          </p>
          {admin && (
            <ActionForm action={saveSite} hidden={{ id: '' }} submitLabel="Suivre le site" submitIcon="ph-factory">
              <MatrixSiteField matrix={matrix} />
              <QhseLeadField options={leadOptions} current={{ qhseLeadId: role === 'Animateur QHSE' ? user.id : null, qhseLead: user.name }} />
            </ActionForm>
          )}
          {!demo && <a href={LOGOUT_PATH} className="vg-link" style={{ justifySelf: 'start' }}>Se déconnecter</a>}
        </div>
      </div>
    </main>
  );
}
