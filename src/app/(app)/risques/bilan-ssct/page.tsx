import type { Metadata } from 'next';
import { getI18n } from '@/i18n/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { fmtDate } from '@/lib/dates';
import { PROGRAM_SHORT, canSeeHealth } from '@/lib/domain';
import { fill, type T } from '@/i18n/translate';
import { guard } from '@/lib/guard';
import { loadSsctReport } from '@/lib/data/ssct';
import '../../prevention/imprimer/print.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Annual OHS report') };
}

function Section({ num, title, children }: { num: number; title: string; children: ReactNode }) {
  return (
    <section className="pp-section">
      <h2><span className="pp-num">{num}</span>{title}</h2>
      {children}
    </section>
  );
}
const Meta = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="pp-meta">
    {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>
);
const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
/** État du programme annuel d'une année (loadSsctReport), dans la langue de la personne. */
function programText(p: { year: number; state: 'none' | 'frozen' | 'draft'; cseConsultedOn: string | null }, t: T) {
  const v = { short: PROGRAM_SHORT, year: p.year };
  if (p.state === 'none') return fill(t('{short} {year} not established'), v);
  if (p.state === 'draft') return fill(t('{short} {year} in preparation'), v);
  return p.cseConsultedOn ? fill(t('{short} {year} adopted · CSE consulted on {date}'), { ...v, date: fmtDate(p.cseConsultedOn) }) : fill(t('{short} {year} adopted'), v);
}

// Bilan annuel santé, sécurité et conditions de travail présenté au CSE (CNF-03, art. L. 2312-27 du code du travail) :
// calculé d'après les données de Vigie (site sélectionné, « Tous les sites » : consolidé), imprimable. Accidentologie et
// maladies professionnelles : animateur QHSE et direction seulement (HEALTH_PAGES, src/lib/auth/route-access.ts).
export default async function SsctReportPage({ searchParams }: PageProps<'/risques/bilan-ssct'>) {
  const session = await guard('risks');
  if (!canSeeHealth(session.role)) redirect('/risques');
  const [sp, { t }] = await Promise.all([searchParams, getI18n()]);
  const r = await loadSsctReport(str(sp.annee));
  if (!r) redirect('/risques');
  const a = r.accidents;

  return (
    <article className="pp-doc pp-doc-narrow">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href="/risques" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Risk assessment')}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          {r.years.map((y) => (
            <a key={y} href={`/risques/bilan-ssct?annee=${y}`} className={`btn vg-btn-sm ${y === r.year ? 'btn-secondary' : 'btn-ghost'}`} aria-current={y === r.year ? 'page' : undefined}>{y}</a>
          ))}
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>{t('Vigie · document for the social and economic committee')}</div>
        <div className="pp-head-row"><h1>{fill(t('Annual health, safety and working conditions report {year}'), { year: r.year })}</h1></div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>
          {fill(t('Labour code, art. L. 2312-27 · {site} · data as of {end} · printed on {date}'), { site: r.site, end: fmtDate(r.periodEnd), date: fmtDate(r.generatedOn) })}
        </div>
        <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>
          {t('Report computed from the data in Vigie, to be completed by the employer (working conditions, headcount, analysis) before its presentation to the CSE.')}
        </p>
      </header>

      <Section num={1} title={t('Occupational accidents and diseases')}>
        <Meta rows={[
          [t('Lost-time accidents'), fill(a.lostDays > 1 ? t('{n} · {days} days lost') : t('{n} · {days} day lost'), { n: a.arret, days: a.lostDays })],
          [t('Accidents without lost time'), String(a.sansArret)],
          [t('First aid (minor accidents)'), String(a.soins)],
          [t('Frequency rate (TF1)'), `${a.tf1}${a.missingMonths ? fill(t(' · {n} months without hours entered'), { n: a.missingMonths }) : ''}`],
          [t('Severity rate (TG)'), a.tg],
          [t('Commuting accidents'), fill(t('{n} · excluding TF1 and TG'), { n: a.commute })],
          [t('Accidents of temporary workers · of external people'), `${a.temporary} · ${a.external}`],
          [t('Occupational diseases declared'), String(a.occupationalDiseases)],
          [t('Near misses · hazardous situations reported'), `${a.nearMisses} · ${a.dangerous}`],
        ]} />
        <p className="pp-muted" style={{ margin: 0, fontSize: 11.5 }}>{t('Rates computed on the accidents of the workforce and the hours worked entered for the completed months of the year.')}</p>
      </Section>

      <Section num={2} title={t('Prevention actions carried out')}>
        <Meta rows={[
          [t('Actions opened in the year'), String(r.actions.opened)],
          [t('Actions verified in the year'), fill(t('{n} · effective: {e}'), { n: r.actions.closed, e: r.actions.efficacy })],
          [fill(t('Actions open on {date}'), { date: fmtDate(r.actions.asOf) }), fill(t('{n} · overdue: {late} ({rate})'), { n: r.actions.openAtEnd, late: r.actions.lateAtEnd, rate: r.actions.lateRate })],
        ]} />
        <p className="pp-muted" style={{ margin: 0, fontSize: 11.5 }}>{t('QSE action plan, Safety and Health domains (monthly statistics of the plan).')}</p>
        {r.actions.done.length > 0 && (
          <table className="table" style={{ fontSize: 12 }}>
            <thead><tr><th>{t('No.')}</th><th>{t('Verified action')}</th><th>{t('On#date')}</th><th>{t('Effectiveness')}</th></tr></thead>
            <tbody>
              {r.actions.done.map((x) => (
                <tr key={x.id}><td>{x.id}</td><td>{x.label}</td><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(x.closedOn)}</td><td>{x.effective ? t('Effective') : t('Not effective')}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section num={3} title={t('Risk assessment (single document)')}>
        {r.duerp.length ? (
          <table className="table" style={{ fontSize: 12 }}>
            <thead><tr><th>{t('Version')}</th><th>{t('Updated#date')}</th><th>{t('CSE consulted')}</th><th>{t('Sent to the SPST')}</th></tr></thead>
            <tbody>
              {r.duerp.map((v) => (
                <tr key={v.version}>
                  <td>{v.version}{v.current ? t(' (in force)') : ''}</td><td>{fmtDate(v.updatedOn)}</td>
                  <td>{v.cseConsultedOn ? fmtDate(v.cseConsultedOn) : t('To be filled in')}</td><td>{v.spstSentOn ? fmtDate(v.spstSentOn) : t('To be filled in')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="pp-empty">{t('No update of the single document in the year.')}</p>}
      </Section>

      <Section num={4} title={t('Annual prevention programme')}>
        <Meta rows={r.programs.map((p) => [String(p.year), programText(p, t)] as [string, ReactNode])} />
        <p className="pp-muted" style={{ margin: 0, fontSize: 11.5 }}>{t('Annual programme for the prevention of occupational risks and the improvement of working conditions (L. 2312-27 2°), detailed on the Risk assessment screen.')}</p>
      </Section>

      <Section num={5} title={t('Inspections, prevention and training')}>
        <Meta rows={[
          [t('Regulatory inspections carried out'), fill(t('{n} · with reservations: {r} · unfavourable or shutdown: {b}'), { n: r.controls.performed, r: r.controls.withReserves, b: r.controls.blocking })],
          [t('Prevention plans (work of the year)'), String(r.prevention.plans)],
          [t('Trainings and qualifications obtained (from Cursus)'), r.trainings.unavailable ? t('Cursus data unavailable') : String(r.trainings.total)],
        ]} />
        {r.trainings.unavailable && <p className="pp-muted" style={{ margin: 0, fontSize: 11.5 }}>{r.trainings.unavailable}</p>}
        {r.trainings.byTitle.length > 0 && (
          <p className="pp-text" style={{ fontSize: 12 }}>{r.trainings.byTitle.map((x) => `${x.title} : ${x.n}`).join(' · ')}</p>
        )}
      </Section>
      <p className="pp-foot">{t('Document reserved to the QHSE coordinator and management until its presentation to the CSE (accident data).')}</p>
    </article>
  );
}
