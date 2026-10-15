'use client';

import { ReasonButton } from '@/components/ReasonDialog';
import { cancelCpamWaiver, waiveCpamDeclaration } from '@/server/events';
import type { DeclarationDuty } from './shared';

// Absence de déclaration CPAM d'un AT motivée (EVT-02) : animateur QHSE et direction, motif conservé au journal (réservé).
// Libellés selon la victime (declarationDuty) : intérimaire, information de l'ETT (R. 412-2 CSS) ; victime extérieure,
// déclaration par son employeur.

const WAIVER_TEXTS: Record<DeclarationDuty, { label: string; title: string; reasonLabel: string; placeholder: string }> = {
  cpam: {
    label: "Motiver l'absence de déclaration", title: "Déclaration CPAM non faite par l'entreprise",
    reasonLabel: "Pourquoi l'entreprise ne déclare-t-elle pas cet accident ?",
    placeholder: 'Déclaration faite par un tiers, accident inscrit sur le registre papier, réserves…',
  },
  ett: {
    label: "Indiquer l'information de l'ETT", title: "Accident d'un intérimaire : déclaration par l'entreprise de travail temporaire",
    reasonLabel: "Quand et comment l'entreprise de travail temporaire a-t-elle été informée ?",
    placeholder: 'ETT informée le … par lettre recommandée ; copies à la CARSAT et à l’inspection du travail le …',
  },
  employer: {
    label: "Indiquer la déclaration par l'employeur", title: "Victime extérieure : déclaration par son employeur",
    reasonLabel: "Quel employeur déclare l'accident, et comment a-t-il été informé ?",
    placeholder: 'Entreprise extérieure …, informée le … ; plan de prévention …',
  },
};

/** « Motiver l'absence de déclaration » : l'obligation sort des échéances et la clôture redevient possible. */
export function CpamWaiverButton({ eventId, duty = 'cpam' }: { eventId: string; duty?: DeclarationDuty }) {
  const t = WAIVER_TEXTS[duty];
  return (
    <ReasonButton label={t.label} title={t.title} kicker={eventId} icon="ph-file-x"
      className="btn btn-ghost vg-btn-sm" action={waiveCpamDeclaration} hidden={{ id: eventId }}
      reasonLabel={t.reasonLabel}
      message="L'accident sort des échéances de déclaration et peut être clôturé. Le motif est conservé au journal de la fiche, visible de l'animateur QHSE et de la direction seulement."
      placeholder={t.placeholder}
      submitLabel="Enregistrer le motif" />
  );
}

/** « Annuler le motif » : l'accident redevient à déclarer (échéance, clôture bloquée). */
export function CancelCpamWaiverButton({ eventId }: { eventId: string }) {
  return (
    <ReasonButton label="Annuler le motif" title="Annuler le motif d'absence de déclaration" kicker={eventId} icon="ph-arrow-counter-clockwise"
      className="btn btn-ghost vg-btn-sm" action={cancelCpamWaiver} hidden={{ id: eventId }} reasonLabel="Motif de l'annulation"
      message="L'accident redevient à déclarer à la CPAM : l'échéance revient et la clôture est de nouveau bloquée."
      submitLabel="Annuler le motif" />
  );
}
