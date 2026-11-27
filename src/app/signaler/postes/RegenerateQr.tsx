'use client';

import { ReasonButton } from '@/components/ReasonDialog';
import { regenerateReportPost } from '@/server/events';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

/** « Régénérer le QR » d'un poste : nouvelle version signée, les étiquettes déjà imprimées ne fonctionnent plus. */
export function RegenerateQr({ zoneId, name }: { zoneId: number; name: string }) {
  const { t } = useI18n();
  return (
    <ReasonButton label={t('Regenerate the QR')} icon="ph-arrows-clockwise" className="btn btn-ghost vg-btn-sm no-print"
      title={fill(t('Regenerate the QR code of the post “{name}”'), { name })} kicker={t('Workstation QR code')}
      action={regenerateReportPost} hidden={{ id: zoneId }} submitLabel={t('Regenerate')} submitIcon="ph-arrows-clockwise"
      message={t('Labels already printed for this post will no longer open the reporting form without an account. Print then stick the new label at the post.')}
      placeholder={t('Label torn off, QR code photographed and shared outside the site…')} />
  );
}
