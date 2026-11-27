import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { fmtDate } from '@/lib/dates';
import { guard } from '@/lib/guard';
import { loadDgiRegister } from '@/lib/data/dgi';
import { DGI_PRINT_PATH, DGI_REGISTER_PATH, canReadDgi } from '@/lib/rules/dgi';
import { today } from '@/lib/today';
import '../../../prevention/imprimer/print.css';
import { getI18n } from '@/i18n/server';
import { fill, type T } from '@/i18n/translate';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Register of serious and imminent dangers') };
}

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const fmtLocal = (local: string, t: T) => fill(t('{date} at {time}'), { date: fmtDate(local.slice(0, 10)), time: local.slice(11, 16) });

// Registre des dangers graves et imminents imprimable (CNF-01), mêmes lecteurs que la page du registre.
export default async function DgiPrintPage({ searchParams }: PageProps<'/evenements/registre-dgi/imprimer'>) {
  const session = await guard('events');
  if (!canReadDgi(session)) redirect('/evenements');
  const { t } = await getI18n();
  const sp = await searchParams;
  const register = await loadDgiRegister(str(sp.site) ?? null);
  if (!register) redirect('/evenements');
  const now = today();
  const site = register.site;
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        <a href={site ? `${DGI_REGISTER_PATH}?site=${encodeURIComponent(site.id)}` : DGI_REGISTER_PATH} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Register')}</a>
        {site && <PrintButton />}
      </div>
      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · {t('Reports and events')}</div>
        <div className="pp-head-row">
          <h1>{t('Special register of serious and imminent dangers')}</h1>
          {site && <span className="pp-muted" style={{ fontSize: 12.5 }}>{site.label}</span>}
        </div>
        <p className="pp-text pp-muted">{t('Art. L. 4132-2, D. 4132-1 and D. 4132-2 of the French Labour Code. Register kept under the employer’s responsibility, available to the staff representatives on the CSE.')}</p>
        {!site && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {register.sites.map((s) => <a key={s.id} href={`${DGI_PRINT_PATH}?site=${encodeURIComponent(s.id)}`} className="btn btn-secondary vg-btn-sm">{s.label.split(' — ')[0]}</a>)}
          </div>
        )}
      </header>
      {site && (
        <section className="pp-section">
          {register.notices.length === 0 ? <p className="pp-empty">{t('No notice recorded in this site’s register.')}</p> : (
            <table className="table pp-table">
              <thead>
                <tr><th>{t('No.')}</th><th>{t('Date and time')}</th><th>{t('Workstation(s)#short')}</th><th>{t('Nature and cause of the danger')}</th><th>{t('Exposed workers')}</th><th>{t('CSE representative (signature)')}</th><th>{t('Measures taken by the employer')}</th></tr>
              </thead>
              <tbody>
                {register.notices.map((n) => (
                  <tr key={n.id} data-obsolete={n.cancelled ? true : undefined}>
                    <td className="pp-nowrap" style={n.cancelled ? { textDecoration: 'line-through' } : undefined}>{n.number}</td>
                    <td className="pp-nowrap">{fmtLocal(n.reportedAt, t)}</td>
                    <td style={{ whiteSpace: 'pre-line' }}>{n.workstations}</td>
                    <td style={{ whiteSpace: 'pre-line' }}>{n.danger}</td>
                    <td style={{ whiteSpace: 'pre-line' }}>{n.exposedWorkers}</td>
                    <td>{n.representativeName}<span className="pp-muted" style={{ display: 'block' }}>{n.signed ? fill(t('signed on {date}'), { date: fmtLocal(n.signed.at, t) }) : t('to sign')}</span></td>
                    <td style={{ whiteSpace: 'pre-line' }}>
                      {n.cancelled ? fill(t('Notice cancelled on {date}: {reason}'), { date: fmtDate(n.cancelled.on), reason: n.cancelled.reason }) : n.measures ? `${n.measures.text}\n${fill(t('(on {date}, {name})'), { date: fmtLocal(n.measures.at, t), name: n.measures.by })}` : '—'}
                      {n.closed && <span className="pp-muted" style={{ display: 'block' }}>{fill(t('Closed on {date}#m'), { date: fmtLocal(n.closed.at, t) })}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      <div className="pp-foot">Vigie · {t('register of serious and imminent dangers')}{site ? ` · ${site.label}` : ''} · {fill(t('printed on {date} by {name}'), { date: fmtDate(now), name: session.user.name })}</div>
    </article>
  );
}
