'use client';

import { Dialog } from '@/components/Dialog';
import { fmtSize, type AttachmentItem } from '@/lib/attachments';

/**
 * Galerie des photos d'une fiche (UX-05) : photo agrandie, précédente / suivante (boutons, flèches du clavier), lien vers
 * l'original. Les photos sont celles que le chargement de la fiche a déjà retenues pour le lecteur et sont servies par
 * /fichiers/<id> avec les mêmes droits (canReadAttachment) : une pièce médicale n'y figure que pour les rôles habilités.
 */
export function PhotoGallery({ photos, index, onIndex, onClose, kicker }: {
  photos: AttachmentItem[]; index: number | null; onIndex: (i: number) => void; onClose: () => void; kicker?: string;
}) {
  const open = index !== null && index >= 0 && index < photos.length;
  const photo = open ? photos[index] : null;
  const go = (step: number) => { if (open) onIndex((index + step + photos.length) % photos.length); };
  return (
    <Dialog open={open} onClose={onClose} width={960} kicker={kicker ?? (open ? `Photo ${index + 1} sur ${photos.length}` : undefined)}
      title={photo ? photo.name : ''}>
      {photo && (
        <div style={{ display: 'grid', gap: 10 }}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } }}>
          <div style={{ display: 'grid', placeItems: 'center', background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', minHeight: 200 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- fichier servi par /fichiers/[id], pas d'optimisation */}
            <img key={photo.id} src={photo.url} alt={photo.name} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {photos.length > 1 && (
              <>
                <button type="button" className="btn btn-secondary" onClick={() => go(-1)} autoFocus style={{ minHeight: 40 }}>
                  <i className="ph ph-caret-left" style={{ fontSize: 14 }} aria-hidden />Précédente
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => go(1)} style={{ minHeight: 40 }}>
                  Suivante<i className="ph ph-caret-right" style={{ fontSize: 14 }} aria-hidden />
                </button>
              </>
            )}
            <span style={{ fontSize: 12, color: 'var(--vg-text-muted)' }}>{fmtSize(photo.size)}</span>
            <a href={photo.url} target="_blank" rel="noopener" className="vg-link" style={{ marginLeft: 'auto', minHeight: 40, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <i className="ph ph-arrow-square-out" aria-hidden />Ouvrir l&apos;original
            </a>
          </div>
        </div>
      )}
    </Dialog>
  );
}
