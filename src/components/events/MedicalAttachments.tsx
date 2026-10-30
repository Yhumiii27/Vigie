'use client';

import { useState, useTransition } from 'react';
import { Attachments } from '@/components/Attachments';
import { addEventFiles, classifyEventFileAsMedical, removeEventFile } from '@/server/events';
import type { AttachmentItem } from '@/lib/rules/events';

/**
 * Pièces médicales d'un AT (certificat médical, avis d'arrêt, réserves… ; SEC-06) : animateur QHSE et direction seulement,
 * jamais transmises aux autres rôles ni servies par /fichiers. `others` : pièces ordinaires de la fiche, qu'un rôle habilité
 * peut reclasser en pièce médicale (sans retour : une erreur se corrige en retirant la pièce).
 */
export function MedicalAttachments({ eventId, files, others, canEdit }: { eventId: string; files: AttachmentItem[]; others: AttachmentItem[]; canEdit: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Attachments title="Pièces médicales · accès restreint" kicker={eventId} files={files} canAdd={canEdit} emptyText="Aucune pièce médicale."
        hint="Certificat médical, avis d'arrêt, réserves… : animateur QHSE et direction seulement."
        onAdd={(picked) => {
          const fd = new FormData();
          fd.set('eventId', eventId);
          fd.set('health', '1');
          picked.forEach((f) => fd.append('files', f));
          return addEventFiles(fd);
        }}
        onRemove={removeEventFile} />
      {canEdit && others.length > 0 && <Reclassify files={others} />}
    </div>
  );
}

/** « Reclasser une pièce en pièce médicale » : pièce jointe parmi les photos du signalement (certificat photographié…). */
function Reclassify({ files }: { files: AttachmentItem[] }) {
  const [id, setId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () => {
    if (!id) return;
    start(async () => {
      try {
        const r = await classifyEventFileAsMedical(id);
        setError(r.error ?? null);
        if (!r.error) setId('');
      } catch {
        setError("Le reclassement a échoué. Réessayez.");
      }
    });
  };
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <label htmlFor="medical-reclassify" style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>Reclasser une pièce en pièce médicale</label>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <select id="medical-reclassify" className="input" value={id} onChange={(e) => setId(e.target.value)} style={{ flex: '1 1 200px', minWidth: 0, maxWidth: 360, fontSize: 12.5 }}>
          <option value="">Choisir une pièce jointe…</option>
          {files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button type="button" className="btn btn-secondary vg-btn-sm" onClick={submit} disabled={!id || pending}>
          <i className="ph ph-lock-simple" style={{ fontSize: 13 }} aria-hidden />{pending ? 'Reclassement…' : 'Reclasser'}
        </button>
      </span>
      <span style={{ fontSize: 11, color: 'var(--vg-text-muted)' }}>Sans retour : la pièce n&apos;est plus visible que de l&apos;animateur QHSE et de la direction ; une erreur se corrige en la retirant.</span>
      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--tone-danger-fg)' }}>{error}</span>}
    </div>
  );
}
