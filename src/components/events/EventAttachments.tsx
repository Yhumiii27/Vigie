'use client';

import { Attachments } from '@/components/Attachments';
import { addEventFiles, removeEventFile } from '@/server/events';
import type { AttachmentItem } from '@/lib/rules/events';
import { useI18n } from '@/i18n/client';

/** Photos et pièces jointes de la fiche événement (vignettes, ajout et suppression pour l'encadrement). */
export function EventAttachments({ eventId, files, canManage }: { eventId: string; files: AttachmentItem[]; canManage: boolean }) {
  const { t } = useI18n();
  return (
    <Attachments title={t('Photos and attachments')} kicker={eventId} files={files} canAdd={canManage}
      onAdd={(picked) => {
        const fd = new FormData();
        fd.set('eventId', eventId);
        picked.forEach((f) => fd.append('files', f));
        return addEventFiles(fd);
      }}
      onRemove={removeEventFile} />
  );
}
