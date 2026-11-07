import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PrintButton } from '@/components/PrintButton';
import { GATE_HOUSE_NOTICE, GateTable } from '@/components/prevention/GateHouse';
import { fmtDate } from '@/lib/dates';
import { guard } from '@/lib/guard';
import { loadGateHouse } from '@/lib/data/gate-house';
import { GATE_HOUSE_HORIZONS, GATE_HOUSE_PATH, canReadGateHouse, parseHorizon } from '@/lib/rules/gate-house';
import { today } from '@/lib/today';
import '../../imprimer/print.css';

export const metadata: Metadata = { title: 'Liste du poste de garde' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

// Liste imprimable du poste de garde (PRV-25, décision CV-10) : arrivées et départs à venir du site sélectionné (ou de tous
// les sites du périmètre), d'après les présences prévues de Cursus. Mêmes lecteurs que la vue de l'écran Prévention
// (canReadGateHouse) ; horizon ?horizon= (1, 7, 14 ou 30 jours).
export default async function GateHousePrintPage({ searchParams }: PageProps<'/prevention/poste-de-garde/imprimer'>) {
  const session = await guard('prevention');
  if (!canReadGateHouse(session.role)) redirect('/prevention');
  const sp = await searchParams;
  const gate = await loadGateHouse(parseHorizon(str(sp.horizon)));
  if (!gate) redirect('/prevention');
  const { list, horizon, message, siteCount } = gate;
  const printedOn = fmtDate(today());
  const showSite = siteCount > 1;
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href={`${GATE_HOUSE_PATH}${horizon === 7 ? '' : `&horizon=${horizon}`}`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />Poste de garde</a>
        <form method="get" action="/prevention/poste-de-garde/imprimer" className="pp-filters" style={{ margin: 0 }}>
          <label>
            Période
            <select name="horizon" className="input" defaultValue={String(horizon)}>
              {GATE_HOUSE_HORIZONS.map((h) => <option key={h} value={h}>{h === 1 ? 'Demain' : `${h} jours`}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-secondary vg-btn-sm"><i className="ph ph-funnel" style={{ fontSize: 13 }} aria-hidden />Afficher</button>
          <PrintButton />
        </form>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Prévention</div>
        <h1>Liste du poste de garde</h1>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>
          {session.site.label} · du {fmtDate(list.from)} au {fmtDate(list.to)} · {list.arrivals.length} arrivée(s), {list.departures.length} départ(s) · édité le {printedOn}
        </div>
        <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>{GATE_HOUSE_NOTICE}</p>
      </header>

      {message ? <section className="pp-section"><p role="status" className="pp-empty">{message}</p></section> : (
        <>
          <section className="pp-section">
            <h2>Arrivées</h2>
            <GateTable rows={list.arrivals} caption="Arrivées à venir" showSite={showSite} print empty="Aucune arrivée prévue sur la période." />
          </section>
          <section className="pp-section">
            <h2>Départs</h2>
            <GateTable rows={list.departures} caption="Départs à venir" showSite={showSite} print empty="Aucun départ prévu sur la période." />
          </section>
          {list.cancelled.length > 0 && (
            <section className="pp-section">
              <h2>Annulées</h2>
              <GateTable rows={list.cancelled} caption="Présences annulées" showSite={showSite} print empty="" />
            </section>
          )}
        </>
      )}

      <div className="pp-foot">Vigie · poste de garde · {session.site.label} · édité le {printedOn}</div>
    </article>
  );
}
