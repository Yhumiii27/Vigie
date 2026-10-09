'use client';

/** Ouvre la boîte d'impression du navigateur (impression papier ou « Enregistrer au format PDF »). */
export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => window.print()}>
      <i className="ph ph-printer" style={{ fontSize: 13 }} />Imprimer / PDF
    </button>
  );
}
