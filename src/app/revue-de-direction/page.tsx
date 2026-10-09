import type { Metadata } from 'next';
import { DossierView } from '@/components/review/DossierView';
import { ToneTag } from '@/components/ui';
import { fmtDate, yearOf } from '@/lib/dates';
import { guard } from '@/lib/guard';
import { loadReviewDossierPage } from '@/lib/data/review';
import './dossier.css';

export const metadata: Metadata = { title: 'Dossier de revue de direction' };

// Dossier de la revue de direction (ISO 9001 §9.3), ouvert dans un nouvel onglet depuis /audits (?revue=<id>) :
// préparatoire tant que la revue n'est pas clôturée, figé ensuite.
export default async function ReviewDossierPage({ searchParams }: PageProps<'/revue-de-direction'>) {
  const session = await guard('audits');
  const sp = await searchParams;
  const page = await loadReviewDossierPage({ revue: sp.revue });

  if (page.mode === 'none') {
    return (
      <main className="rd-doc">
        <div className="rd-toolbar rd-noprint">
          <a href="/audits" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} />Audits et certifications</a>
        </div>
        <section className="rd-section">
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>Aucune revue de direction</h2>
          <p className="rd-empty rd-muted">Planifiez la prochaine revue depuis l&apos;écran Audits et certifications pour générer son dossier.</p>
        </section>
      </main>
    );
  }
  if (page.mode === 'cancelled') {
    const { cancel, review } = page;
    return (
      <main className="rd-doc">
        <div className="rd-toolbar rd-noprint">
          <a href={`/audits?annee=${yearOf(review.reviewOn)}&revue=${review.id}#revue`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} />Audits et certifications</a>
          <ToneTag tone={review.statusTone} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i className="ph ph-x-circle" style={{ fontSize: 12 }} />{review.statusLabel}</ToneTag>
        </div>
        <section className="rd-section">
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>{cancel.kind} du {fmtDate(review.reviewOn)} — annulée</h2>
          <p className="rd-text">
            Annulée le {cancel.on ? fmtDate(cancel.on) : '—'}{cancel.by ? ` par ${cancel.by}` : ''}.
            {cancel.reason && <><br /><span className="rd-muted">Motif : </span>{cancel.reason}</>}
          </p>
          <p className="rd-empty rd-muted">Une revue annulée n&apos;a pas de dossier : sa check-list reste consultable dans l&apos;historique des revues (écran Audits et certifications).</p>
        </section>
      </main>
    );
  }
  return <DossierView page={page} role={session.role} />;
}
