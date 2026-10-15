'use client';

import { useRef, useState, useTransition } from 'react';
import { Dialog } from '@/components/Dialog';
import {
  ATTACH_ACCEPT, MAX_BATCH_BYTES, MAX_FILES_PER_BATCH, MAX_FILE_BYTES,
  fileIcon, fmtSize, type AttachmentItem,
} from '@/lib/attachments';
import { TONE } from '@/lib/domain';

type Result = { error?: string };

type AttachmentsProps = {
  files: AttachmentItem[];
  /** Ajout autorisé (encadrement, fiche non clôturée…). */
  canAdd: boolean;
  /** Retrait autorisé pour ce fichier (pièce ajoutée par erreur, avant clôture) ; par défaut = canAdd. */
  canRemove?: (f: AttachmentItem) => boolean;
  /** Envoi : les fichiers déjà contrôlés côté client ; la server action reconstruit un FormData. */
  onAdd: (files: File[]) => Promise<Result>;
  onRemove: (id: string) => Promise<Result>;
  title?: string;
  /** Référence affichée dans la fenêtre de confirmation (ex. A-214). */
  kicker?: string;
  hint?: string;
  emptyText?: string;
};

/**
 * Pièces jointes d'une fiche (photos, PV, attestations, rapports) : vignettes, ajout et retrait.
 * Composant transverse ; le stockage passe par src/lib/uploads.ts et la lecture par /fichiers/[id] (droit sur l'entité).
 */
export function Attachments({ files, canAdd, canRemove = () => canAdd, onAdd, onRemove, title = 'Pièces jointes', kicker, hint = `Photos, PDF, Word, Excel · ${MAX_FILE_BYTES / 1024 / 1024} Mo par fichier`, emptyText = 'Aucune pièce jointe.' }: AttachmentsProps) {
  const canManage = canAdd;
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AttachmentItem | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Images que le navigateur ne sait pas afficher (HEIC hors Safari…) : vignette fichier à la place.
  const [broken, setBroken] = useState<string[]>([]);
  const [uploading, startUpload] = useTransition();
  const [deleting, startDelete] = useTransition();

  const upload = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (input.current) input.current.value = '';
    if (!picked.length) return;
    const tooBig = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) { setError(`« ${tooBig.name} » dépasse ${MAX_FILE_BYTES / 1024 / 1024} Mo.`); return; }
    if (picked.length > MAX_FILES_PER_BATCH) { setError(`${MAX_FILES_PER_BATCH} fichiers au maximum par envoi.`); return; }
    if (picked.reduce((s, f) => s + f.size, 0) > MAX_BATCH_BYTES) { setError(`Ces fichiers dépassent ${MAX_BATCH_BYTES / 1024 / 1024} Mo au total : ajoutez-les en plusieurs fois.`); return; }
    startUpload(async () => {
      try {
        const r = await onAdd(picked);
        setError(r.error ?? null);
      } catch {
        setError("L'envoi a échoué. Vérifiez la connexion puis réessayez.");
      }
    });
  };

  const askRemove = (f: AttachmentItem | null) => { setRemoveError(null); setRemoving(f); };

  // La boîte de dialogue reste ouverte en cas d'échec et affiche l'erreur ; elle se ferme une fois la pièce retirée.
  const confirmRemove = () => {
    const target = removing;
    if (!target) return;
    startDelete(async () => {
      try {
        const r = await onRemove(target.id);
        if (r.error) { setRemoveError(r.error); return; }
        setRemoving(null);
      } catch {
        setRemoveError('La suppression a échoué. Réessayez.');
      }
    });
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <h6 className="vg-h6">{title}{files.length > 0 && <span style={{ color: 'var(--color-neutral-600)' }}> · {files.length}</span>}</h6>
      {files.length === 0 && !canManage ? (
        <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{emptyText}</div>
      ) : (
        <div className="vg-thumbs">
          {files.map((f) => (
            <div key={f.id} style={{ position: 'relative' }}>
              <a href={f.url} target="_blank" rel="noopener" className="vg-thumb" title={`${f.name} · ${fmtSize(f.size)}`}>
                {f.isImage && !broken.includes(f.id) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- fichier servi par /fichiers/[id], pas d'optimisation
                  <img src={f.url} alt={f.name} loading="lazy" onError={() => setBroken((b) => [...b, f.id])} />
                ) : (
                  <span style={{ display: 'grid', justifyItems: 'center', gap: 4, padding: '0 6px', maxWidth: '100%' }}>
                    <i className={`ph ${fileIcon(f.mime)}`} style={{ fontSize: 24, color: 'var(--color-neutral-400)' }} />
                    <span style={{ fontSize: 10.5, lineHeight: 1.25, color: 'var(--color-neutral-300)', textAlign: 'center', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }}>{f.name}</span>
                  </span>
                )}
              </a>
              {canRemove(f) && (
                <button type="button" aria-label={`Supprimer ${f.name}`} title="Supprimer" onClick={() => askRemove(f)}
                  style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', border: 0, cursor: 'pointer', color: 'var(--color-neutral-100)', background: 'color-mix(in srgb, var(--color-bg) 75%, transparent)' }}>
                  <i className="ph ph-x" style={{ fontSize: 12 }} />
                </button>
              )}
            </div>
          ))}
          {canManage && (
            <>
              <button type="button" className="vg-thumb" onClick={() => input.current?.click()} disabled={uploading}
                style={{ border: '1px dashed var(--color-divider)', boxShadow: 'none', cursor: uploading ? 'progress' : 'pointer', font: 'inherit', fontSize: 11, color: 'var(--color-neutral-400)' }}>
                <span style={{ display: 'grid', justifyItems: 'center', gap: 4 }}>
                  <i className={`ph ${uploading ? 'ph-circle-notch' : 'ph-plus'}`} style={{ fontSize: 20 }} />
                  {uploading ? 'Envoi…' : 'Ajouter'}
                </span>
              </button>
              <input ref={input} type="file" multiple accept={ATTACH_ACCEPT} hidden onChange={(e) => upload(e.target.files)} />
            </>
          )}
        </div>
      )}
      {canManage && hint && <span style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>{hint}</span>}
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--tone-danger-fg)' }}>{error}</div>}

      <Dialog open={!!removing} onClose={() => askRemove(null)} title="Supprimer la pièce jointe ?" kicker={kicker} width={420}>
        {removing && (
          <>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
              « {removing.name} » sera définitivement retiré de la fiche. Cette suppression est irréversible.
            </p>
            {removeError && <div role="alert" className="vg-form-error">{removeError}</div>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => askRemove(null)} disabled={deleting}>Annuler</button>
              <button type="button" className="btn" onClick={confirmRemove} disabled={deleting}
                style={{ color: TONE.danger.fg, borderColor: TONE.danger.dot }}>
                <i className="ph ph-trash" style={{ fontSize: 14 }} />{deleting ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
