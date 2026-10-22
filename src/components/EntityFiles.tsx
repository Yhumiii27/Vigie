'use client';

import { Attachments } from '@/components/Attachments';
import type { AttachmentItem } from '@/lib/attachments';
import type { EntityFileKind } from '@/lib/entity-files';
import { addEntityFiles, removeEntityFile } from '@/server/entity-files';

/**
 * Pièces jointes d'une fiche après sa saisie (paquet 6 : DUERP signé, justificatifs d'un risque, textes, preuves et
 * rapports de la veille, pièces de la revue de direction, bordereaux d'un enlèvement) : ajout, et retrait avec un motif
 * conservé dans l'historique de la fiche. Droits, site et fiche figée contrôlés par le serveur (src/server/entity-files.ts) ;
 * `canAdd` / `canRemove` ne règlent que l'affichage.
 */
export function EntityFiles({ kind, entityId, files, canAdd, canRemove, title, kicker, hint, emptyText }: {
  kind: EntityFileKind;
  entityId: string | number;
  files: AttachmentItem[];
  canAdd: boolean;
  /** Par défaut = canAdd ; une fonction pour limiter le retrait (fichiers envoyés par la personne). */
  canRemove?: boolean | ((f: AttachmentItem) => boolean);
  title?: string;
  kicker?: string;
  hint?: string;
  emptyText?: string;
}) {
  const removable = typeof canRemove === 'function' ? canRemove : () => canRemove ?? canAdd;
  return (
    <Attachments files={files} canAdd={canAdd} canRemove={removable} reasonRequired title={title} kicker={kicker} hint={hint} emptyText={emptyText}
      onAdd={(picked) => {
        const fd = new FormData();
        fd.set('kind', kind);
        fd.set('entityId', String(entityId));
        picked.forEach((file) => fd.append('files', file));
        return addEntityFiles(fd);
      }}
      onRemove={(id, reason) => removeEntityFile(id, reason ?? '')} />
  );
}
