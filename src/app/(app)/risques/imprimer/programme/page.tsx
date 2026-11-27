import type { Metadata } from 'next';
import { getI18n } from '@/i18n/server';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { fmtEuro } from '@/lib/rules/risk-format';
import { fmtDate, yearOf } from '@/lib/dates';
import { PROGRAM_SHORT, PROGRAM_STATES } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadPreventionProgram } from '@/lib/data/risks';
import { today } from '@/lib/today';
import { labelT } from '@/i18n/labels';
import { fill } from '@/i18n/translate';
import '../../../prevention/imprimer/print.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Annual prevention programme (PAPRIPACT)') };
}

const Meta = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="pp-meta">
    {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>
);

// Programme annuel de prévention imprimable (L. 4121-3-1, DUE-02), ?annee=AAAA : lignes du site sélectionné (dans le
// périmètre), coût estimé, ressources et indicateur, avec une ligne de total. Jamais de pilotes ni d'historique.
export default async function ProgramPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await guard('risks');
  const [sp, { t }] = await Promise.all([searchParams, getI18n()]);
  const lt = labelT(t);
  const now = today();
  const year = typeof sp.annee === 'string' && /^\d{4}$/.test(sp.annee) ? Number(sp.annee) : yearOf(now);
  const d = await loadPreventionProgram(year);
  const { program, lines, totals, hiddenCount } = d;
  const multiSite = new Set(lines.map((l) => l.siteId)).size > 1;

  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href={`/risques?programme=${year}`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{PROGRAM_SHORT} {year}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>{t('For a PDF: “Save as PDF” in the print dialog.')}</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · {PROGRAM_SHORT} {year}</div>
        <div className="pp-head-row">
          <h1>{fill(t('Annual programme for the prevention of occupational risks and the improvement of working conditions {year}'), { year })}</h1>
          {program && <span className="tag tag-neutral">{lt(PROGRAM_STATES[program.state].label)}</span>}
        </div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>{t('Labour code, article L. 4121-3-1 · drawn from the occupational risk assessment document')}</div>
        {program && (
          <Meta rows={[
            [t('Establishment'), session.site.label],
            [t('Original DUERP'), fill(t('Version {v}'), { v: program.duerpVersion })],
            [t('Purpose'), program.comment || '—'],
            [t('CSE consulted on'), program.cseConsultedOn ? fmtDate(program.cseConsultedOn) : t('To be filled in')],
            [t('Adopted#programme'), program.frozenOn ? (program.frozenBy ? fill(t('on {date} by {name}'), { date: fmtDate(program.frozenOn), name: program.frozenBy }) : fill(t('on {date}'), { date: fmtDate(program.frozenOn) })) : t('No (in preparation)')],
            [t('Printed on'), fmtDate(now)],
          ]} />
        )}
      </header>

      <section className="pp-section">
        {!program ? <p className="pp-empty">{fill(t('No programme established for {year}.'), { year })}</p> : (
          <>
            <h2>{fill(t('Prevention actions · {n}'), { n: totals.count })}</h2>
            {lines.length === 0 ? <p className="pp-empty">{t('No action of the programme on this site.')}</p> : (
              <table className="table pp-table">
                <thead>
                  <tr><th>{t('Action')}</th><th>{t('DUERP risks')}</th><th>{t('Target date')}</th><th>{t('Progress')}</th><th style={{ textAlign: 'right' }}>{t('Estimated cost (excl. VAT)')}</th><th>{t('Resources')}</th><th>{t('Indicator')}</th></tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.actionId}>
                      <td>
                        <span className="pp-nowrap">{l.actionId}</span> · {l.title}
                        {multiSite && <span className="pp-muted" style={{ display: 'block' }}>{l.site}</span>}
                      </td>
                      <td>{l.risks.length ? l.risks.map((r, i) => <div key={`${r.id ?? i}`}>{r.label} ({r.cotation})</div>) : '—'}</td>
                      <td className="pp-nowrap">{l.dueOn ? fmtDate(l.dueOn) : '—'}</td>
                      <td>
                        {lt(l.status)}
                        {l.frozenStatus != null && l.frozenStatus !== l.status && <span className="pp-muted" style={{ display: 'block' }}>{fill(t('at adoption: {status}'), { status: lt(l.frozenStatus) })}</span>}
                      </td>
                      <td className="pp-nowrap" style={{ textAlign: 'right' }}>{l.estimatedCost != null ? fmtEuro(l.estimatedCost) : '—'}</td>
                      <td>{l.resources || '—'}</td>
                      <td>{l.indicator || '—'}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4} style={{ fontWeight: 500 }}>
                      {fill(totals.count > 1 ? t('Total · {n} actions') : t('Total · {n} action'), { n: totals.count })}{totals.done ? fill(totals.done > 1 ? t(' · {n} verified#plural') : t(' · {n} verified#one'), { n: totals.done }) : ''}
                      {totals.count > totals.costed && <span className="pp-muted">{fill(t(' · {n} without estimated cost'), { n: totals.count - totals.costed })}</span>}
                    </td>
                    <td className="pp-nowrap" style={{ textAlign: 'right', fontWeight: 500 }}>{fmtEuro(totals.cost)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            )}
            {hiddenCount > 0 && (
              <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>
                {fill(hiddenCount > 1
                  ? t('Programme common to all sites: {n} actions of other sites do not appear in this edition (site selected: {site}).')
                  : t('Programme common to all sites: {n} action of other sites does not appear in this edition (site selected: {site}).'), { n: hiddenCount, site: session.site.label })}
              </p>
            )}
          </>
        )}
      </section>

      <div className="pp-foot">Vigie · {PROGRAM_SHORT} {year} · {session.site.label}{fill(t(' · printed on {date}'), { date: fmtDate(now) })}</div>
    </article>
  );
}
