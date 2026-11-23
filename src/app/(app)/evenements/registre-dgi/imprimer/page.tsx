import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { fmtDate } from '@/lib/dates';
import { guard } from '@/lib/guard';
import { loadDgiRegister } from '@/lib/data/dgi';
import { DGI_PRINT_PATH, DGI_REGISTER_PATH, canReadDgi } from '@/lib/rules/dgi';
import { today } from '@/lib/today';
import '../../../prevention/imprimer/print.css';

export const metadata: Metadata = { title: 'Registre des dangers graves et imminents' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const fmtLocal = (local: string) => `${fmtDate(local.slice(0, 10))} à ${local.slice(11, 16)}`;

// Registre des dangers graves et imminents imprimable (CNF-01), mêmes lecteurs que la page du registre.
export default async function DgiPrintPage({ searchParams }: PageProps<'/evenements/registre-dgi/imprimer'>) {
  const session = await guard('events');
  if (!canReadDgi(session)) redirect('/evenements');
  const sp = await searchParams;
  const register = await loadDgiRegister(str(sp.site) ?? null);
  if (!register) redirect('/evenements');
  const now = today();
  const site = register.site;
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        <a href={site ? `${DGI_REGISTER_PATH}?site=${encodeURIComponent(site.id)}` : DGI_REGISTER_PATH} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />Registre</a>
        {site && <PrintButton />}
      </div>
      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Signalements et événements</div>
        <div className="pp-head-row">
          <h1>Registre spécial des dangers graves et imminents</h1>
          {site && <span className="pp-muted" style={{ fontSize: 12.5 }}>{site.label}</span>}
        </div>
        <p className="pp-text pp-muted">Art. L. 4132-2, D. 4132-1 et D. 4132-2 du code du travail. Registre tenu sous la responsabilité de l&apos;employeur, à la disposition des représentants du personnel au CSE.</p>
        {!site && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {register.sites.map((s) => <a key={s.id} href={`${DGI_PRINT_PATH}?site=${encodeURIComponent(s.id)}`} className="btn btn-secondary vg-btn-sm">{s.label.split(' — ')[0]}</a>)}
          </div>
        )}
      </header>
      {site && (
        <section className="pp-section">
          {register.notices.length === 0 ? <p className="pp-empty">Aucun avis consigné au registre de ce site.</p> : (
            <table className="table pp-table">
              <thead>
                <tr><th>N°</th><th>Date et heure</th><th>Poste(s)</th><th>Nature et cause du danger</th><th>Travailleurs exposés</th><th>Représentant du CSE (signature)</th><th>Mesures prises par l&apos;employeur</th></tr>
              </thead>
              <tbody>
                {register.notices.map((n) => (
                  <tr key={n.id} data-obsolete={n.cancelled ? true : undefined}>
                    <td className="pp-nowrap" style={n.cancelled ? { textDecoration: 'line-through' } : undefined}>{n.number}</td>
                    <td className="pp-nowrap">{fmtLocal(n.reportedAt)}</td>
                    <td style={{ whiteSpace: 'pre-line' }}>{n.workstations}</td>
                    <td style={{ whiteSpace: 'pre-line' }}>{n.danger}</td>
                    <td style={{ whiteSpace: 'pre-line' }}>{n.exposedWorkers}</td>
                    <td>{n.representativeName}<span className="pp-muted" style={{ display: 'block' }}>{n.signed ? `signé le ${fmtLocal(n.signed.at)}` : 'à signer'}</span></td>
                    <td style={{ whiteSpace: 'pre-line' }}>
                      {n.cancelled ? `Avis annulé le ${fmtDate(n.cancelled.on)} : ${n.cancelled.reason}` : n.measures ? `${n.measures.text}\n(le ${fmtLocal(n.measures.at)}, ${n.measures.by})` : '—'}
                      {n.closed && <span className="pp-muted" style={{ display: 'block' }}>Clos le {fmtLocal(n.closed.at)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      <div className="pp-foot">Vigie · registre des dangers graves et imminents{site ? ` · ${site.label}` : ''} · édité le {fmtDate(now)} par {session.user.name}</div>
    </article>
  );
}
