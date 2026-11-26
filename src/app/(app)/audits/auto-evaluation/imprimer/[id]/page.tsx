import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { fmtDate } from '@/lib/dates';
import { guard } from '@/lib/guard';
import { loadSelfAssessments } from '@/lib/data/self-assessment';
import { ASSESSMENT_STANDARDS, fmtDelta, rateDelta, selfAssessmentHref } from '@/lib/rules/self-assessment';
import { today } from '@/lib/today';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';
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
  const { t } = await getI18n();
  const data = await loadSelfAssessments({ open: decodeURIComponent(id) });
  const d = data?.detail;
  if (!d) notFound();
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        <a href={selfAssessmentHref(d.id)} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Campaign')}</a>
        <PrintButton />
      </div>
      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>{t('Vigie · Audits')} · {d.id}</div>
        <div className="pp-head-row">
          <h1>{t('Self-assessment')} · {ASSESSMENT_STANDARDS[d.standard].label}</h1>
          <span className="pp-muted" style={{ fontSize: 12.5 }}>{d.site}</span>
        </div>
        <dl className="pp-meta">
          <dt>{t('Date')}</dt><dd>{fmtDate(d.assessedOn)}</dd>
          <dt>{t('Assessor')}</dt><dd>{d.assessor}</dd>
          <dt>{t('State')}</dt><dd>{d.statusLabel}{d.closedOn ? fill(t(' on {date}'), { date: fmtDate(d.closedOn) }) : ''}</dd>
          <dt>{t('Compliance')}</dt><dd>{pct(d.synthesis.overall.rate)}{d.previous ? fill(t(' ({delta} compared with {id} of {date})'), { delta: fmtDelta(d.delta), id: d.previous.id, date: fmtDate(d.previous.assessedOn) }) : ''}</dd>
          {d.scope && <><dt>{t('Scope')}</dt><dd>{d.scope}</dd></>}
        </dl>
        {d.conclusion && <p className="pp-text" style={{ whiteSpace: 'pre-line' }}>{d.conclusion}</p>}
      </header>
      <section className="pp-section">
        <h2>{t('Summary by clause')}</h2>
        <table className="table pp-table">
          <thead><tr><th>{t('Clause')}</th><th>{t('C#compliant')}</th><th>{t('P#partial')}</th><th>{t('NC#noncompliant')}</th><th>{t('N/A')}</th><th>{t('Rate')}</th>{d.previous && <th>{t('Difference')}</th>}</tr></thead>
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
        <p className="pp-muted" style={{ fontSize: 11.5 }}>{t('C: compliant · P: partially compliant · NC: non-compliant · N/A: not applicable (outside the rate).')}</p>
      </section>
      <section className="pp-section">
        <h2>{t('Requirements')}</h2>
        <table className="table pp-table">
          <thead><tr><th>{t('Clause')}</th><th>{t('Level')}</th><th>{t('Justification and finding')}</th><th>{t('Evidence and actions')}</th></tr></thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.clause} · {l.heading}</td>
                <td>{l.levelLabel}</td>
                <td>{[l.justification, l.finding].filter(Boolean).join(' — ') || '—'}</td>
                <td>{[l.files.length ? fill(l.files.length > 1 ? t('{n} pieces of evidence') : t('{n} piece of evidence'), { n: l.files.length }) : '', ...l.actions.map((a) => a.id)].filter(Boolean).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="pp-foot">{fill(t('Vigie · self-assessment {id} · issued on {date} by {name}'), { id: d.id, date: fmtDate(today()), name: session.user.name })}</div>
    </article>
  );
}
