'use client';

/** Ouvre la boîte d'impression du navigateur (impression papier ou « Enregistrer au format PDF »). */
export function PrintButton({ label = 'Imprimer / PDF', className = 'btn btn-primary vg-btn-sm' }: { label?: string; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      <i className="ph ph-printer" style={{ fontSize: 13 }} aria-hidden />{label}
    </button>
  );
}
