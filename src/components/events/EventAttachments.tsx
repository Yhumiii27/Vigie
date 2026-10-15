'use client';

import { Attachments } from '@/components/Attachments';
import { addEventFiles, removeEventFile } from '@/server/events';
import type { AttachmentItem } from './shared';

/** Photos et pièces jointes de la fiche événement (vignettes, ajout et suppression pour l'encadrement). */
export function EventAttachments({ eventId, files, canManage }: { eventId: string; files: AttachmentItem[]; canManage: boolean }) {
  return (
    <Attachments title="Photos et pièces jointes" kicker={eventId} files={files} canAdd={canManage}
      onAdd={(picked) => {
        const fd = new FormData();
        fd.set('eventId', eventId);
        picked.forEach((f) => fd.append('files', f));
        return addEventFiles(fd);
      }}
      onRemove={removeEventFile} />
  );
}
