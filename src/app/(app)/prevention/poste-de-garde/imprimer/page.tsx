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
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Gatehouse list') };
}

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

// Liste imprimable du poste de garde (PRV-25, décision CV-10) : arrivées et départs à venir du site sélectionné (ou de tous
// les sites du périmètre), d'après les présences prévues de Cursus. Mêmes lecteurs que la vue de l'écran Prévention
// (canReadGateHouse) ; horizon ?horizon= (1, 7, 14 ou 30 jours).
export default async function GateHousePrintPage({ searchParams }: PageProps<'/prevention/poste-de-garde/imprimer'>) {
  const session = await guard('prevention');
  if (!canReadGateHouse(session.role)) redirect('/prevention');
  const { t } = await getI18n();
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
        <a href={`${GATE_HOUSE_PATH}${horizon === 7 ? '' : `&horizon=${horizon}`}`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Gatehouse')}</a>
        <form method="get" action="/prevention/poste-de-garde/imprimer" className="pp-filters" style={{ margin: 0 }}>
          <label>
            {t('Period')}
            <select name="horizon" className="input" defaultValue={String(horizon)}>
              {GATE_HOUSE_HORIZONS.map((h) => <option key={h} value={h}>{h === 1 ? t('Tomorrow') : fill(t('{n} days'), { n: h })}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-secondary vg-btn-sm"><i className="ph ph-funnel" style={{ fontSize: 13 }} aria-hidden />{t('Show')}</button>
          <PrintButton />
        </form>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · {t('Prevention')}</div>
        <h1>{t('Gatehouse list')}</h1>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>
          {session.site.label} · {fill(t('from {from} to {to}'), { from: fmtDate(list.from), to: fmtDate(list.to) })} · {fill(t('{a} arrival(s), {d} departure(s)'), { a: list.arrivals.length, d: list.departures.length })} · {fill(t('printed on {date}'), { date: printedOn })}
        </div>
        <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>{t(GATE_HOUSE_NOTICE)}</p>
      </header>

      {message ? <section className="pp-section"><p role="status" className="pp-empty">{message}</p></section> : (
        <>
          <section className="pp-section">
            <h2>{t('Arrivals')}</h2>
            <GateTable rows={list.arrivals} caption={t('Upcoming arrivals')} showSite={showSite} print empty={t('No arrival planned over the period.')} />
          </section>
          <section className="pp-section">
            <h2>{t('Departures')}</h2>
            <GateTable rows={list.departures} caption={t('Upcoming departures')} showSite={showSite} print empty={t('No departure planned over the period.')} />
          </section>
          {list.cancelled.length > 0 && (
            <section className="pp-section">
              <h2>{t('Cancelled#fplural')}</h2>
              <GateTable rows={list.cancelled} caption={t('Cancelled attendance')} showSite={showSite} print empty="" />
            </section>
          )}
        </>
      )}

      <div className="pp-foot">Vigie · {t('gatehouse')} · {session.site.label} · {fill(t('printed on {date}'), { date: printedOn })}</div>
    </article>
  );
}
