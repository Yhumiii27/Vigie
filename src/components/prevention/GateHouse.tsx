import Link from 'next/link';
import { ScrollX, SegLinks } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import type { GateHouse } from '@/lib/data/gate-house';
import { GATE_HOUSE_HORIZONS, GATE_HOUSE_PATH, GATE_HOUSE_PRINT_PATH, type GateRow } from '@/lib/rules/gate-house';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';

// Liste du poste de garde (PRV-25, décision CV-10) : arrivées et départs à venir d'après les présences prévues de Cursus,
// sur l'écran Prévention (vue) et en impression. Composant serveur, sans saisie.

/** Chaîne source (VG-N01), rendue par t(). */
export const GATE_HOUSE_NOTICE = 'Attendance declared in the Cursus form and validated by the HR department; Vigie reads it (no entry here). Safety induction: not tracked by Vigie.';

const period = (r: GateRow) => (r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} → ${fmtDate(r.to)}`);

function Interventions({ r, print }: { r: GateRow; print?: boolean }) {
  if (!r.plans.length && !r.permits.length) return <span style={{ color: 'var(--vg-text-muted)' }}>—</span>;
  const link = (href: string, id: string) => (print ? <span key={id}>{id}</span> : <Link key={id} href={href} scroll={false}>{id}</Link>);
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
      {r.plans.map((id) => link(`/prevention?plan=${encodeURIComponent(id)}`, id))}
      {r.permits.map((id) => link(`/prevention?onglet=permis&permis=${encodeURIComponent(id)}`, id))}
    </span>
  );
}

/** Tableau d'une liste (arrivées, départs ou annulées). */
export async function GateTable({ rows, caption, showSite, print, empty }: { rows: readonly GateRow[]; caption: string; showSite: boolean; print?: boolean; empty: string }) {
  const { t } = await getI18n();
  if (!rows.length) return <p style={{ margin: 0, fontSize: 12, color: 'var(--vg-text-muted)' }}>{empty}</p>;
  return (
    <ScrollX label={caption}>
      <table className={print ? 'table pp-table' : 'table'} style={{ fontSize: 12.5 }}>
        <caption className="vg-sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t('Person')}</th><th scope="col">{t('Cursus employee number')}</th><th scope="col">{t('Company or agency')}</th>
            {showSite && <th scope="col">Site</th>}
            <th scope="col">{t('Attendance')}</th><th scope="col">{t('Purpose')}</th><th scope="col">{t('Plan or permit')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ref}>
              <td>
                {r.name ?? <span style={{ color: 'var(--tone-warn-fg)' }}>{t('Person unknown to Vigie')}</span>}
                {/* Matricule de site (I… intérimaire, E… extérieur) : celui du badge, sous le nom pour rester lisible sur téléphone. */}
                {r.siteMatricule && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--vg-text-muted)', whiteSpace: 'nowrap' }}>{t('Site employee number')} <strong style={{ fontWeight: 600 }}>{r.siteMatricule}</strong></span>}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>{r.matricule ?? '—'}</td>
              <td>{r.company ?? '—'}</td>
              {showSite && <td>{r.siteLabel.split(' — ')[0]}</td>}
              <td style={{ whiteSpace: 'nowrap' }}>{period(r)}</td>
              <td>{r.purpose ?? '—'}</td>
              <td><Interventions r={r} print={print} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}

/** Vue « Poste de garde » de l'écran Prévention (`/prevention?vue=poste-de-garde&horizon=`). */
export async function GateHouseView({ gate }: { gate: GateHouse }) {
  const { t } = await getI18n();
  const { list, horizon, message, siteCount } = gate;
  const showSite = siteCount > 1;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <SegLinks options={GATE_HOUSE_HORIZONS.map((h) => ({
          href: h === 7 ? GATE_HOUSE_PATH : `${GATE_HOUSE_PATH}&horizon=${h}`,
          label: h === 1 ? t('Tomorrow') : fill(t('{n} days'), { n: h }),
          on: h === horizon,
        }))} />
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{fill(t('From {from} to {to}'), { from: fmtDate(list.from), to: fmtDate(list.to) })}</span>
        {/* Lien HTML simple, nouvel onglet : la feuille d'impression ne reste pas chargée dans l'application. */}
        <a href={`${GATE_HOUSE_PRINT_PATH}${horizon === 7 ? '' : `?horizon=${horizon}`}`} target="_blank" rel="noreferrer" className="btn btn-secondary vg-btn-sm" style={{ marginLeft: 'auto' }}>
          <i className="ph ph-printer" style={{ fontSize: 13 }} aria-hidden />{t('Print the list')}
        </a>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
        <i className="ph ph-plugs-connected" style={{ fontSize: 13, marginRight: 6 }} aria-hidden />{t(GATE_HOUSE_NOTICE)} {t('Plan or permit matched: same site, same external company and overlapping dates.')}
      </p>
      {message && (
        <div className="card" role="status" style={{ padding: '10px 14px', borderColor: 'var(--tone-warn-dot)', fontSize: 12.5, textWrap: 'pretty' }}>
          {message} {t('The gatehouse list cannot be drawn up.')}
        </div>
      )}
      <div className="card" style={{ gap: 8 }}>
        <h2 className="vg-h6" style={{ margin: 0 }}>{t('Arrivals')} · {list.arrivals.length}</h2>
        <GateTable rows={list.arrivals} caption={t('Upcoming arrivals')} showSite={showSite} empty={t('No arrival planned over the period.')} />
      </div>
      <div className="card" style={{ gap: 8 }}>
        <h2 className="vg-h6" style={{ margin: 0 }}>{t('Departures')} · {list.departures.length}</h2>
        <GateTable rows={list.departures} caption={t('Upcoming departures')} showSite={showSite} empty={t('No departure planned over the period.')} />
      </div>
      {list.cancelled.length > 0 && (
        <div className="card" style={{ gap: 8 }}>
          <h2 className="vg-h6" style={{ margin: 0 }}>{t('Cancelled#fplural')} · {list.cancelled.length}</h2>
          <GateTable rows={list.cancelled} caption={t('Cancelled attendance')} showSite={showSite} empty="" />
        </div>
      )}
    </div>
  );
}
