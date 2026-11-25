'use client';

import { ReasonButton } from '@/components/ReasonDialog';
import { cancelCpamWaiver, waiveCpamDeclaration } from '@/server/events';
import type { DeclarationDuty } from '@/lib/rules/events';
import { useI18n } from '@/i18n/client';
import type { T } from '@/i18n/translate';

// Absence de déclaration CPAM d'un AT motivée (EVT-02) : animateur QHSE et direction, motif conservé au journal (réservé).
// Libellés selon la victime (declarationDuty) : intérimaire, information de l'ETT (R. 412-2 CSS) ; victime extérieure,
// déclaration par son employeur.

const waiverTexts = (t: T): Record<DeclarationDuty, { label: string; title: string; reasonLabel: string; placeholder: string }> => ({
  cpam: {
    label: t('Give the reason for not declaring'), title: t('CPAM declaration not made by the company'),
    reasonLabel: t('Why does the company not declare this accident?'),
    placeholder: t('Declaration made by a third party, accident entered in the paper register, reservations…'),
  },
  ett: {
    label: t('Record that the agency was informed'), title: t('Accident of a temp worker: declaration by the temporary work agency'),
    reasonLabel: t('When and how was the temporary work agency informed?'),
    placeholder: t('Agency informed on … by registered letter; copies to the CARSAT and the labour inspectorate on …'),
  },
  employer: {
    label: t('Record the declaration by the employer'), title: t('External victim: declaration by their employer'),
    reasonLabel: t('Which employer declares the accident, and how were they informed?'),
    placeholder: t('External company …, informed on …; prevention plan …'),
  },
});

/** « Motiver l'absence de déclaration » : l'obligation sort des échéances et la clôture redevient possible. */
export function CpamWaiverButton({ eventId, duty = 'cpam' }: { eventId: string; duty?: DeclarationDuty }) {
  const { t } = useI18n();
  const w = waiverTexts(t)[duty];
  return (
    <ReasonButton label={w.label} title={w.title} kicker={eventId} icon="ph-file-x"
      className="btn btn-ghost vg-btn-sm" action={waiveCpamDeclaration} hidden={{ id: eventId }}
      reasonLabel={w.reasonLabel}
      message={t('The accident leaves the declaration deadlines and can be closed. The reason is kept in the sheet’s log, visible to the QHSE coordinator and senior management only.')}
      placeholder={w.placeholder}
      submitLabel={t('Save the reason')} />
  );
}

/** « Annuler le motif » : l'accident redevient à déclarer (échéance, clôture bloquée). */
export function CancelCpamWaiverButton({ eventId }: { eventId: string }) {
  const { t } = useI18n();
  return (
    <ReasonButton label={t('Cancel the reason')} title={t('Cancel the reason for not declaring')} kicker={eventId} icon="ph-arrow-counter-clockwise"
      className="btn btn-ghost vg-btn-sm" action={cancelCpamWaiver} hidden={{ id: eventId }} reasonLabel={t('Reason for cancellation')}
      message={t('The accident must again be declared to the CPAM: the deadline returns and closure is blocked again.')}
      submitLabel={t('Cancel the reason')} />
  );
}
