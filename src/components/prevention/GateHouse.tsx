import Link from 'next/link';
import { ScrollX, SegLinks } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import type { GateHouse } from '@/lib/data/gate-house';
import { GATE_HOUSE_HORIZONS, GATE_HOUSE_PATH, GATE_HOUSE_PRINT_PATH, type GateRow } from '@/lib/rules/gate-house';

// Liste du poste de garde (PRV-25, décision CV-10) : arrivées et départs à venir d'après les présences prévues de Cursus,
// sur l'écran Prévention (vue) et en impression. Composant serveur, sans saisie.

export const GATE_HOUSE_NOTICE = 'Présences déclarées dans le formulaire de Cursus et validées par le service RH ; Vigie les lit (aucune saisie ici). Accueil sécurité : non suivi par Vigie.';

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
export function GateTable({ rows, caption, showSite, print, empty }: { rows: readonly GateRow[]; caption: string; showSite: boolean; print?: boolean; empty: string }) {
  if (!rows.length) return <p style={{ margin: 0, fontSize: 12, color: 'var(--vg-text-muted)' }}>{empty}</p>;
  return (
    <ScrollX label={caption}>
      <table className={print ? 'table pp-table' : 'table'} style={{ fontSize: 12.5 }}>
        <caption className="vg-sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Personne</th><th scope="col">Matricule</th><th scope="col">Entreprise ou agence</th>
            {showSite && <th scope="col">Site</th>}
            <th scope="col">Présence</th><th scope="col">Objet</th><th scope="col">Plan ou permis</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ref}>
              <td>{r.name ?? <span style={{ color: 'var(--tone-warn-fg)' }}>Matricule inconnu</span>}</td>
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
export function GateHouseView({ gate }: { gate: GateHouse }) {
  const { list, horizon, message, siteCount } = gate;
  const showSite = siteCount > 1;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <SegLinks options={GATE_HOUSE_HORIZONS.map((h) => ({
          href: h === 7 ? GATE_HOUSE_PATH : `${GATE_HOUSE_PATH}&horizon=${h}`,
          label: h === 1 ? 'Demain' : `${h} jours`,
          on: h === horizon,
        }))} />
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>Du {fmtDate(list.from)} au {fmtDate(list.to)}</span>
        {/* Lien HTML simple, nouvel onglet : la feuille d'impression ne reste pas chargée dans l'application. */}
        <a href={`${GATE_HOUSE_PRINT_PATH}${horizon === 7 ? '' : `?horizon=${horizon}`}`} target="_blank" rel="noreferrer" className="btn btn-secondary vg-btn-sm" style={{ marginLeft: 'auto' }}>
          <i className="ph ph-printer" style={{ fontSize: 13 }} aria-hidden />Imprimer la liste
        </a>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
        <i className="ph ph-plugs-connected" style={{ fontSize: 13, marginRight: 6 }} aria-hidden />{GATE_HOUSE_NOTICE} Plan ou permis rapproché : même site, même
        entreprise extérieure et dates qui se recoupent.
      </p>
      {message && (
        <div className="card" role="status" style={{ padding: '10px 14px', borderColor: 'var(--tone-warn-dot)', fontSize: 12.5, textWrap: 'pretty' }}>
          {message} La liste du poste de garde ne peut pas être établie.
        </div>
      )}
      <div className="card" style={{ gap: 8 }}>
        <h2 className="vg-h6" style={{ margin: 0 }}>Arrivées · {list.arrivals.length}</h2>
        <GateTable rows={list.arrivals} caption="Arrivées à venir" showSite={showSite} empty="Aucune arrivée prévue sur la période." />
      </div>
      <div className="card" style={{ gap: 8 }}>
        <h2 className="vg-h6" style={{ margin: 0 }}>Départs · {list.departures.length}</h2>
        <GateTable rows={list.departures} caption="Départs à venir" showSite={showSite} empty="Aucun départ prévu sur la période." />
      </div>
      {list.cancelled.length > 0 && (
        <div className="card" style={{ gap: 8 }}>
          <h2 className="vg-h6" style={{ margin: 0 }}>Annulées · {list.cancelled.length}</h2>
          <GateTable rows={list.cancelled} caption="Présences annulées" showSite={showSite} empty="" />
        </div>
      )}
    </div>
  );
}
