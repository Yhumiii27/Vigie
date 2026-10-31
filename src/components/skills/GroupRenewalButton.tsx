'use client';

import { DialogButton } from '@/components/Dialog';
import type { TrainingTitle } from '@/lib/data/skills';
import { SessionForm, type SessionCandidate } from './SessionForm';

/**
 * Recyclage groupé depuis la vue « À prévoir » (HAB-06) : session collective sur un titre de la prévision, ses salariés à
 * recycler proposés (à rattraper ou expirant sous 3 mois cochés d'office, groupRenewalCandidates). Bouton placé dans
 * l'en-tête de la carte : il reste affiché quand l'enregistrement retire le titre de la prévision (confirmation annoncée).
 */
export function GroupRenewalButton({ titles, renewals, today }: { titles: TrainingTitle[]; renewals: Record<string, SessionCandidate[]>; today: string }) {
  return (
    <DialogButton label="Recyclage groupé" icon="ph-users-three" className="btn btn-secondary vg-btn-sm"
      title="Recyclage groupé" kicker="Habilitations et formations" width={560}>
      {(close) => <SessionForm titles={titles} rows={[]} today={today} renewals={renewals} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}
