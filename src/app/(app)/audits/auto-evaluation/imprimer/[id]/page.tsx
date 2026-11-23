import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { fmtDate } from '@/lib/dates';
import { guard } from '@/lib/guard';
import { loadSelfAssessments } from '@/lib/data/self-assessment';
import { ASSESSMENT_STANDARDS, fmtDelta, rateDelta, selfAssessmentHref } from '@/lib/rules/self-assessment';
import { today } from '@/lib/today';
import '../../../../prevention/imprimer/print.css';

export async function generateMetadata({ params }: PageProps<'/audits/auto-evaluation/imprimer/[id]'>): Promise<Metadata> {
  const { id } = await params;
  return { title: `Auto-évaluation ${decodeURIComponent(id)}` };
}

const pct = (n: number | null) => (n == null ? '—' : `${n} %`);

// Grille d'auto-évaluation imprimable (AUD-40) : synthèse par article, comparaison avec la campagne précédente, puis chaque
// exigence (niveau, justification, constat, preuves et actions). Lecteurs de l'écran Audits, site sélectionné et périmètre.
export default async function SelfAssessmentPrintPage({ params }: PageProps<'/audits/auto-evaluation/imprimer/[id]'>) {
  const session = await guard('audits');
  const { id } = await params;
  const data = await loadSelfAssessments({ open: decodeURIComponent(id) });
  const d = data?.detail;
  if (!d) notFound();
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        <a href={selfAssessmentHref(d.id)} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />Campagne</a>
        <PrintButton />
      </div>
      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Audits · {d.id}</div>
        <div className="pp-head-row">
          <h1>Auto-évaluation · {ASSESSMENT_STANDARDS[d.standard].label}</h1>
          <span className="pp-muted" style={{ fontSize: 12.5 }}>{d.site}</span>
        </div>
        <dl className="pp-meta">
          <dt>Date</dt><dd>{fmtDate(d.assessedOn)}</dd>
          <dt>Évaluateur</dt><dd>{d.assessor}</dd>
          <dt>État</dt><dd>{d.statusLabel}{d.closedOn ? ` le ${fmtDate(d.closedOn)}` : ''}</dd>
          <dt>Conformité</dt><dd>{pct(d.synthesis.overall.rate)}{d.previous ? ` (${fmtDelta(d.delta)} par rapport à ${d.previous.id} du ${fmtDate(d.previous.assessedOn)})` : ''}</dd>
          {d.scope && <><dt>Périmètre</dt><dd>{d.scope}</dd></>}
        </dl>
        {d.conclusion && <p className="pp-text" style={{ whiteSpace: 'pre-line' }}>{d.conclusion}</p>}
      </header>
      <section className="pp-section">
        <h2>Synthèse par article</h2>
        <table className="table pp-table">
          <thead><tr><th>Article</th><th>C</th><th>P</th><th>NC</th><th>N/A</th><th>Taux</th>{d.previous && <th>Écart</th>}</tr></thead>
          <tbody>
            {[...d.synthesis.clauses, d.synthesis.overall].map((c) => (
              <tr key={c.clause || 'total'}>
                <td>{c.clause ? `${c.clause} · ${c.heading}` : c.heading}</td>
                <td>{c.counts.conforme}</td><td>{c.counts.partiel}</td><td>{c.counts.non_conforme}</td><td>{c.counts.non_applicable}</td>
                <td>{pct(c.rate)}</td>
                {d.previous && <td>{fmtDelta(rateDelta(c.rate, c.clause ? d.previous.clauses[c.clause] ?? null : d.previous.rate))}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pp-muted" style={{ fontSize: 11.5 }}>C : conforme · P : partiellement conforme · NC : non conforme · N/A : non applicable (hors taux).</p>
      </section>
      <section className="pp-section">
        <h2>Exigences</h2>
        <table className="table pp-table">
          <thead><tr><th>Article</th><th>Niveau</th><th>Justification et constat</th><th>Preuves et actions</th></tr></thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.clause} · {l.heading}</td>
                <td>{l.levelLabel}</td>
                <td>{[l.justification, l.finding].filter(Boolean).join(' — ') || '—'}</td>
                <td>{[l.files.length ? `${l.files.length} preuve${l.files.length > 1 ? 's' : ''}` : '', ...l.actions.map((a) => a.id)].filter(Boolean).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="pp-foot">Vigie · auto-évaluation {d.id} · éditée le {fmtDate(today())} par {session.user.name}</div>
    </article>
  );
}
