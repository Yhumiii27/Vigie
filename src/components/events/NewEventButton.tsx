'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Dialog } from '@/components/Dialog';
import { EventFields, type EventDefaults, type EventFieldOptions } from './EventEditButton';

/**
 * « Nouvel événement » (encadrement, bureau) : formulaire complet, ouvert d'emblée quand la page est appelée
 * avec ?nouveau=1 (signalement depuis un plan de prévention ou un permis). Ouvre la fiche créée.
 */
export function NewEventButton({ options, defaults, today, initialOpen = false }: { options: EventFieldOptions; defaults?: EventDefaults; today: string; initialOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <i className="ph ph-plus" style={{ fontSize: 14 }} />Nouvel événement
      </button>
      <Dialog open={open} onClose={close} title="Nouvel événement" kicker="Signalements et événements" width={680}>
        {open && (
          <EventFields mode="create" options={options} defaults={defaults} today={today} onCancel={close}
            onDone={(state) => { close(); if (state.id) router.push(`/evenements?sel=${encodeURIComponent(state.id)}`); }} />
        )}
      </Dialog>
    </>
  );
}
