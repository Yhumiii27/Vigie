import { ToneTag } from '@/components/ui';
import type { EventDetail } from '@/lib/data/events';
import { fmtDate } from '@/lib/dates';
import { FieldGrid } from './FieldGrid';
import { MedicalAttachments } from './MedicalAttachments';
import { getI18n } from '@/i18n/server';

/**
 * Maladie professionnelle sur la fiche (EVT-09, rôles habilités seulement : le type n'est chargé que pour eux) : salarié
 * concerné, tableau, maladie, certificat médical initial, information par la caisse et questionnaire employeur
 * (30 jours francs, R. 461-9 CSS) ; pièces médicales.
 */
export async function OccupationalSection({ detail, canEdit = false }: { detail: EventDetail; canEdit?: boolean }) {
  const { t } = await getI18n();
  const { event: e, occupational: mp, medical, attachments, lock } = detail;
  if (!mp) return null;
  return (
    <div className="vg-inset" style={{ display: 'grid', gap: 12, padding: 12 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-neutral-400)' }}>
        <i className="ph ph-lock-simple" style={{ fontSize: 13 }} aria-hidden />{t('Occupational disease · health data (QHSE coordinator and senior management)')}
      </span>
      <FieldGrid min={200} fields={[
        [t('Employee concerned'), (
          <span key="victim" style={{ display: 'grid', gap: 2 }}>
            <span>{mp.victim}</span>
            {mp.victimKind !== '—' && <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{mp.victimKind}</span>}
          </span>
        )],
        [t('Table'), mp.table ?? '—'],
        [t('Disease declared'), mp.disease ?? '—'],
        [t('Initial medical certificate'), mp.certificateOn ? fmtDate(mp.certificateOn) : '—'],
        [t('Declaration received from the CPAM'), mp.informedOn ? fmtDate(mp.informedOn) : '—'],
        [t('Employer questionnaire'), <ToneTag key="q" tone={mp.questionnaire.tone}>{mp.questionnaire.label}</ToneTag>],
      ]} />
      <MedicalAttachments eventId={e.id} files={medical} others={attachments} canEdit={canEdit && !lock} />
    </div>
  );
}
