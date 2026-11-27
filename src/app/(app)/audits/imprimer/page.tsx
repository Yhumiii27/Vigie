import type { Metadata } from 'next';
import { PrintButton } from '@/components/PrintButton';
import { monthLabel } from '@/lib/rules/audits';
import { fmtDate } from '@/lib/dates';
import { PLAN_ITEM_STATES } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadAuditProgramPrint } from '@/lib/data/audits';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';
import '../../prevention/imprimer/print.css';
import { labelT } from '@/i18n/labels';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Annual audit programme') };
}

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

// Programme annuel des audits imprimable (AUD-26, ISO 9001 §9.2.2 : programme d'audit planifié, critères, périmètre,
// auditeurs) : éléments en vigueur de l'année, par mois, du site sélectionné et du périmètre (AUD-22), état à la date
// d'édition. Lecteurs de l'écran Audits (consultation comprise). Lien HTML simple : print.css hors de l'application.
export default async function AuditProgramPrintPage({ searchParams }: PageProps<'/audits/imprimer'>) {
  const session = await guard('audits');
  const { t } = await getI18n();
  const sp = await searchParams;
  const p = await loadAuditProgramPrint(str(sp.annee));
  const certLabel = (id: string | null) => (id ? p.certs.find(([v]) => v === id)?.[1] ?? id : '');
  const done = p.items.filter((i) => i.state === 'done').length;
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        <a href={`/audits?annee=${p.year}`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Audits and certifications')}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          {p.years.map((y) => (
            <a key={y} href={`/audits/imprimer?annee=${y}`} className={`btn vg-btn-sm ${y === p.year ? 'btn-secondary' : 'btn-ghost'}`} aria-current={y === p.year ? 'page' : undefined}>{y}</a>
          ))}
          <PrintButton />
        </span>
      </div>
      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>{t('Vigie · Audits and certifications')}</div>
        <h1>{fill(t('Annual audit programme {year}'), { year: p.year })}</h1>
        <dl className="pp-meta">
          <dt>{t('Establishment')}</dt><dd>{p.site}</dd>
          <dt>{t('Items')}</dt><dd>{fill(t('{n} in the programme'), { n: p.items.length })} · {fill(done > 1 ? t('{n} carried out#plural') : t('{n} carried out'), { n: done })}{p.cancelledCount ? ` · ${fill(p.cancelledCount > 1 ? t('{n} cancelled#mplural') : t('{n} cancelled#m'), { n: p.cancelledCount })}` : ''}</dd>
          <dt>{t('Lines')}</dt><dd>{p.tracks.join(' · ') || '—'}</dd>
          <dt>{t('Issued on')}</dt><dd>{fill(t('{date} by {name}'), { date: fmtDate(p.now), name: session.user.name })}</dd>
        </dl>
      </header>
      <section className="pp-section">
        {p.items.length ? (
          <table className="table pp-table">
            <thead><tr><th>{t('Month')}</th><th>{t('Line')}</th><th>{t('Title')}</th><th>{t('Date')}</th><th>{t('Auditor')}</th><th>{t('Scope · site')}</th><th>{t('Owner')}</th><th>{t('State')}</th></tr></thead>
            <tbody>
              {p.items.map((i) => (
                <tr key={i.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{monthLabel(i.month, i.year)}</td>
                  <td>{i.track}{i.unplanned ? t(' · unplanned') : ''}</td>
                  <td>{i.detail ?? i.label}{i.certificationId ? ` (${certLabel(i.certificationId)})` : ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{i.doneOn ? fill(t('carried out on {date}'), { date: fmtDate(i.doneOn) }) : i.plannedOn ? fmtDate(i.plannedOn) : t('to set')}</td>
                  <td>{i.isReview ? '—' : i.auditorLabel || '—'}</td>
                  <td>{[i.scope, i.site].filter(Boolean).join(' · ')}</td>
                  <td>{i.owner || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{labelT(t)(PLAN_ITEM_STATES[i.state].label)}{i.findingCount ? ` · ${fill(i.findingCount > 1 ? t('{n} findings') : t('{n} finding'), { n: i.findingCount })}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="pp-muted">{fill(t('No item in the {year} programme.'), { year: p.year })}</p>}
      </section>
      <div className="pp-foot">{t('Programme drawn up from Vigie on the issue date · computed states (carried out, to confirm, upcoming) · cancelled items excluded.')}</div>
    </article>
  );
}
