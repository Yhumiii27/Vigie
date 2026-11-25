'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Dialog } from '@/components/Dialog';
import { useHeaderMenu } from '@/components/coque';
import { EventFields, type EventDefaults, type EventFieldOptions } from './EventEditButton';
import { useI18n } from '@/i18n/client';

/**
 * « Nouvel événement » (encadrement, bureau) : formulaire complet, ouvert d'emblée quand la page est appelée
 * avec ?nouveau=1 (signalement prérempli depuis un plan de prévention, un permis, un contrôle, un risque, un document ou
 * l'écran Environnement, EVT-24 : src/lib/event-prefill.ts). Ouvre la fiche créée.
 * `health` : données de santé d'un AT saisissables (animateur QHSE, direction ; SEC-06).
 */
export function NewEventButton({ options, defaults, today, health, initialOpen = false }: { options: EventFieldOptions; defaults?: EventDefaults; today: string; health: boolean; initialOpen?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const menu = useHeaderMenu();
  const close = () => setOpen(false);
  return (
    <>
      {/* Dans le menu « Actions » de l'en-tête (plus de trois actions, COQUE.md § 3.3) : une ligne du menu. */}
      <button type="button" {...(menu ? { role: 'menuitem', className: 'vg-menu-item vg-menu-row' } : { className: 'btn btn-secondary' })}
        onClick={() => { menu?.close(); setOpen(true); }}>
        <i className="ph ph-plus" style={{ fontSize: 14 }} aria-hidden />{t('New event')}
      </button>
      <Dialog open={open} onClose={close} title={t('New event')} kicker={t('Reports and events')} width={680}>
        {open && (
          <EventFields mode="create" options={options} defaults={defaults} today={today} health={health} onCancel={close}
            onDone={(state) => { close(); if (state.id) router.push(`/evenements?sel=${encodeURIComponent(state.id)}`); }} />
        )}
      </Dialog>
    </>
  );
}
