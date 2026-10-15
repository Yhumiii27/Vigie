'use client';

import { ReasonButton } from '@/components/ReasonDialog';
import { regenerateReportPost } from '@/server/events';

/** « Régénérer le QR » d'un poste : nouvelle version signée, les étiquettes déjà imprimées ne fonctionnent plus. */
export function RegenerateQr({ zoneId, name }: { zoneId: number; name: string }) {
  return (
    <ReasonButton label="Régénérer le QR" icon="ph-arrows-clockwise" className="btn btn-ghost vg-btn-sm no-print"
      title={`Régénérer le QR code du poste « ${name} »`} kicker="QR code de poste"
      action={regenerateReportPost} hidden={{ id: zoneId }} submitLabel="Régénérer" submitIcon="ph-arrows-clockwise"
      message="Les étiquettes déjà imprimées pour ce poste n'ouvriront plus le formulaire de signalement sans compte. Imprimez puis collez la nouvelle étiquette au poste."
      placeholder="Étiquette arrachée, QR code photographié et diffusé hors du site…" />
  );
}
