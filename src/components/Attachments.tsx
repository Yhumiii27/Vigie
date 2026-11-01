'use client';

import { useRef, useState, useTransition, type ReactNode } from 'react';
import { Dialog } from '@/components/Dialog';
import {
  ATTACH_ACCEPT, MAX_FILE_BYTES, fileBatchError,
  fileIcon, fmtSize, type AttachmentItem,
} from '@/lib/attachments';
import { TONE } from '@/lib/domain';
import type { FormState } from '@/lib/forms';
import { ReasonForm } from '@/components/ReasonDialog';
import { PhotoGallery } from '@/components/PhotoGallery';
import { ATTACHMENT_PHOTO_EDGE, photosToShrink, shrinkPhoto } from '@/lib/photo-shrink';

type Result = { error?: string };

type AttachmentsProps = {
  files: AttachmentItem[];
  /** Ajout autorisé (encadrement, fiche non clôturée…). */
  canAdd: boolean;
  /** Retrait autorisé pour ce fichier (pièce ajoutée par erreur, avant clôture) ; par défaut = canAdd. */
  canRemove?: (f: AttachmentItem) => boolean;
  /** Envoi : les fichiers déjà contrôlés côté client ; la server action reconstruit un FormData. */
  onAdd: (files: File[]) => Promise<Result>;
  /** Retrait ; `reason` : motif saisi quand `reasonRequired` (pièces jointes génériques, paquet 6). */
  onRemove: (id: string, reason?: string) => Promise<Result>;
  /** Motif obligatoire au retrait, conservé dans l'historique de la fiche (src/server/entity-files.ts). */
  reasonRequired?: boolean;
  title?: string;
  /** Référence affichée dans la fenêtre de confirmation (ex. A-214). */
  kicker?: string;
  hint?: string;
  emptyText?: string;
  /** Mention sous la vignette (preuve d'une action : « avec un commentaire », « commentaire retiré », D23). */
  caption?: (f: AttachmentItem) => ReactNode;
};

/**
 * Pièces jointes d'une fiche (photos, PV, attestations, rapports) : vignettes, ajout et retrait.
 * Composant transverse ; le stockage passe par src/lib/uploads.ts et la lecture par /fichiers/[id] (droit sur l'entité).
 */
export function Attachments({ files, canAdd, canRemove = () => canAdd, onAdd, onRemove, reasonRequired = false, title = 'Pièces jointes', kicker, hint = `Photos, PDF, Word, Excel · ${MAX_FILE_BYTES / 1024 / 1024} Mo par fichier`, emptyText = 'Aucune pièce jointe.', caption }: AttachmentsProps) {
  const canManage = canAdd;
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AttachmentItem | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Images que le navigateur ne sait pas afficher (HEIC hors Safari…) : vignette fichier à la place.
  const [broken, setBroken] = useState<string[]>([]);
  const [uploading, startUpload] = useTransition();
  // UX-05 : galerie des photos de la fiche (indice de la photo agrandie) ; photos allégées du dernier envoi.
  const [viewing, setViewing] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const photos = files.filter((f) => f.isImage && !broken.includes(f.id));
  const [deleting, startDelete] = useTransition();

  const upload = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (input.current) input.current.value = '';
    if (!picked.length) return;
    setNote(null);
    startUpload(async () => {
      // UX-05 : originaux envoyés tels quels tant que l'envoi respecte les limites ; sinon, les photos d'appareil sont
      // réduites (ATTACHMENT_PHOTO_EDGE, réencodage sans métadonnées) avant le contrôle commun.
      const shrinkable = photosToShrink(picked);
      let reduced = 0;
      for (const i of shrinkable) {
        const out = await shrinkPhoto(picked[i], { maxEdge: ATTACHMENT_PHOTO_EDGE, quality: 0.85, keepIfLarger: true });
        if (out.file !== picked[i]) { picked[i] = out.file; reduced++; }
      }
      const issue = fileBatchError(picked);
      if (issue) { setError(issue); return; }
      try {
        const r = await onAdd(picked);
        if (!r.error && reduced) setNote(`${reduced} photo${reduced > 1 ? 's' : ''} allégée${reduced > 1 ? 's' : ''} avant l'envoi pour respecter la limite (${ATTACHMENT_PHOTO_EDGE} px au plus).`);
        setError(r.error ?? null);
      } catch {
        setError("L'envoi a échoué. Vérifiez la connexion puis réessayez.");
      }
    });
  };

  const askRemove = (f: AttachmentItem | null) => { setRemoveError(null); setRemoving(f); };

  // Retrait avec motif (QUA-22) : formulaire commun ReasonForm, le motif est contrôlé par le serveur (reasonError).
  const removeWithReason = async (_prev: FormState, fd: FormData): Promise<FormState> => {
    if (!removing) return {};
    try {
      const r = await onRemove(removing.id, String(fd.get('reason') ?? '').trim());
      return r.error ? { error: r.error } : { ok: true };
    } catch {
      return { error: 'La suppression a échoué. Réessayez.' };
    }
  };

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
      <h6 className="vg-h6">{title}{files.length > 0 && <span style={{ color: 'var(--vg-text-muted)' }}> · {files.length}</span>}</h6>
      {files.length === 0 && !canManage ? (
        <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{emptyText}</div>
      ) : (
        <div className="vg-thumbs">
          {files.map((f) => (
            <div key={f.id} style={{ position: 'relative' }}>
              {f.isImage && !broken.includes(f.id) ? (
                // UX-05 : une photo s'ouvre dans la galerie de la fiche (précédente / suivante, lien vers l'original).
                <button type="button" className="vg-thumb" onClick={() => setViewing(photos.findIndex((p) => p.id === f.id))}
                  aria-label={`Voir la photo ${f.name}`} style={{ border: 0, padding: 0, cursor: 'zoom-in' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- fichier servi par /fichiers/[id], pas d'optimisation */}
                  <img src={f.url} alt="" loading="lazy" onError={() => setBroken((b) => [...b, f.id])} />
                </button>
              ) : (
              <a href={f.url} target="_blank" rel="noopener" className="vg-thumb" title={`${f.name} · ${fmtSize(f.size)}`}>
                <span style={{ display: 'grid', justifyItems: 'center', gap: 4, padding: '0 6px', maxWidth: '100%' }}>
                  <i className={`ph ${fileIcon(f.mime)}`} style={{ fontSize: 24, color: 'var(--color-neutral-400)' }} aria-hidden />
                  <span style={{ fontSize: 11, lineHeight: 1.25, color: 'var(--color-neutral-300)', textAlign: 'center', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }}>{f.name}</span>
                </span>
              </a>
              )}
              {canRemove(f) && (
                <button type="button" aria-label={`Supprimer ${f.name}`} title="Supprimer" onClick={() => askRemove(f)}
                  style={{ position: 'absolute', top: 3, right: 3, width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', border: 0, cursor: 'pointer', color: 'var(--color-neutral-100)', background: 'color-mix(in srgb, var(--color-bg) 75%, transparent)' }}>
                  <i className="ph ph-x" style={{ fontSize: 12 }} aria-hidden />
                </button>
              )}
              {caption?.(f) && <div className="vg-thumb-caption">{caption(f)}</div>}
            </div>
          ))}
          {canManage && (
            <>
              <button type="button" className="vg-thumb" onClick={() => input.current?.click()} disabled={uploading}
                style={{ border: '1px dashed var(--color-divider)', boxShadow: 'none', cursor: uploading ? 'progress' : 'pointer', font: 'inherit', fontSize: 11, color: 'var(--color-neutral-400)' }}>
                <span style={{ display: 'grid', justifyItems: 'center', gap: 4 }}>
                  <i className={`ph ${uploading ? 'ph-circle-notch' : 'ph-plus'}`} style={{ fontSize: 20 }} aria-hidden />
                  {uploading ? 'Envoi…' : 'Ajouter'}
                </span>
              </button>
              <input ref={input} type="file" multiple accept={ATTACH_ACCEPT} hidden onChange={(e) => upload(e.target.files)} />
            </>
          )}
        </div>
      )}
      {canManage && hint && <span style={{ fontSize: 11, color: 'var(--vg-text-muted)' }}>{hint}</span>}
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--tone-danger-fg)' }}>{error}</div>}
      {note && <div role="status" style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{note}</div>}
      <PhotoGallery photos={photos} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} kicker={kicker ? `${kicker} · photo ${(viewing ?? 0) + 1} sur ${photos.length}` : undefined} />

      <Dialog open={!!removing} onClose={() => askRemove(null)} title="Supprimer la pièce jointe ?" kicker={kicker} width={420}>
        {removing && (
          <>
            {reasonRequired ? (
              <ReasonForm action={removeWithReason} reasonLabel="Motif du retrait" submitLabel="Supprimer" submitIcon="ph-trash"
                message={`« ${removing.name} » sera définitivement retiré de la fiche. Cette suppression est irréversible. Le retrait est inscrit à l’historique de la fiche avec son motif.`}
                placeholder="Ex. fichier joint par erreur, mauvaise version du rapport" onDone={() => setRemoving(null)} onCancel={() => askRemove(null)} />
            ) : (
              <>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                  « {removing.name} » sera définitivement retiré de la fiche. Cette suppression est irréversible.
                </p>
                {removeError && <div role="alert" className="vg-form-error">{removeError}</div>}
                <div className="dialog-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => askRemove(null)} disabled={deleting}>Annuler</button>
                  <button type="button" className="btn" onClick={confirmRemove} disabled={deleting}
                    style={{ color: TONE.danger.fg, borderColor: TONE.danger.dot }}>
                    <i className="ph ph-trash" style={{ fontSize: 14 }} aria-hidden />{deleting ? 'Suppression…' : 'Supprimer'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </Dialog>
    </div>
  );
}
