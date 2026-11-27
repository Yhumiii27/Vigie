import type { Metadata } from 'next';
import { PrintButton } from '@/components/PrintButton';
import { PERMIT_FILTERS, PERMIT_TYPE_FILTERS, REGISTER_FILTERS, filterParam, inPeriod, pickFilter, pickPeriod, pickType } from '@/components/prevention/filters';
import { PERMIT_TYPES } from '@/lib/rules/prevention';
import { hrefWith } from '@/components/ui';
import { fmtDate, monthName } from '@/lib/dates';
import { today } from '@/lib/today';
import { guard } from '@/lib/guard';
import { loadPrevention } from '@/lib/data/prevention';
import { getSession } from '@/lib/session';
import '../print.css';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Register of hot work and test permits') };
}

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// Registre imprimable des permis du site sélectionné : filtres de l'onglet Permis (?filtre=, ?type=), plus « Tous, annulés
// compris » et la période (?annee=, ?mois=, validité recoupant la période en jours de Paris). Formulaire GET simple dans
// la barre d'outils (non imprimée).
export default async function PermitRegisterPage({ searchParams }: PageProps<'/prevention/imprimer/permis'>) {
  await guard('prevention');
  const { t } = await getI18n();
  const sp = await searchParams;
  const [d, session] = await Promise.all([loadPrevention(), getSession()]);
  const filter = pickFilter(REGISTER_FILTERS, str(sp.filtre));
  const type = pickType(str(sp.type));
  const period = pickPeriod(str(sp.annee), str(sp.mois));
  const permits = d.permits
    .filter((p) => filter.states.includes(p.state) && (!type || p.type === type) && (!period || inPeriod(p, period)))
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.id.localeCompare(b.id, 'fr', { numeric: true }));
  const typeLabel = t(PERMIT_TYPE_FILTERS.find((f) => f.key === type)?.label ?? 'All types#filter');
  const periodLabel = period?.label ?? t('all periods');
  // Années proposées : celles des permis du site (début et fin de validité) et l'année en cours.
  const now = today();
  const years = [...new Set([now.slice(0, 4), ...d.permits.flatMap((p) => [p.validFrom.slice(0, 4), p.validTo.slice(0, 4)])])].sort().reverse();
  // Retour à l'onglet : le filtre « Tous, annulés compris » n'existe que dans le registre.
  const backHref = hrefWith('/prevention', { onglet: 'permis' }, {
    filtre: filter.key === 'registre' ? undefined : filterParam(PERMIT_FILTERS, filter), type: type ?? undefined,
  });
  const printedOn = fmtDate(now);

  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href={backHref} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Permits')}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>{t('For the PDF: “Save as PDF” in the print dialog.')}</span>
          <PrintButton />
        </span>
      </div>

      <form method="get" action="/prevention/imprimer/permis" className="pp-filters pp-noprint">
        <label>
          {t('State')}
          <select name="filtre" className="input" defaultValue={filter.key}>
            {REGISTER_FILTERS.map((f) => <option key={f.key} value={f.key}>{t(f.label)}</option>)}
          </select>
        </label>
        <label>
          {t('Type')}
          <select name="type" className="input" defaultValue={type ?? ''}>
            {PERMIT_TYPE_FILTERS.map((f) => <option key={f.key ?? ''} value={f.key ?? ''}>{t(f.label)}</option>)}
          </select>
        </label>
        <label>
          {t('Year')}
          <select name="annee" className="input" defaultValue={period?.annee ?? ''}>
            <option value="">{t('Any')}</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>
          {t('Month')}
          <select name="mois" className="input" defaultValue={period?.mois ?? ''}>
            <option value="">{t('All#mplural')}</option>
            {MONTHS.map((m) => <option key={m} value={String(m)}>{monthName(m)}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary vg-btn-sm"><i className="ph ph-funnel" style={{ fontSize: 13 }} aria-hidden />{t('Show')}</button>
      </form>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · {t('Prevention')}</div>
        <h1>{t('Register of fire and test permits')}</h1>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>
          {session.site.label} · {periodLabel} · {fill(t('permits {filter}'), { filter: t(filter.label).toLowerCase() })} · {typeLabel.toLowerCase()} · {fill(t('{n} permits'), { n: permits.length })} · {fill(t('printed on {date}'), { date: printedOn })}
        </div>
      </header>

      <section className="pp-section">
        {permits.length === 0
          ? <p className="pp-empty">{period ? fill(t('No permit over the period ({period}).'), { period: period.label }) : t(filter.empty)}</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table pp-table">
                <thead>
                  <tr>
                    <th>{t('Ref.')}</th><th>{t('Type')}</th><th>{t('Location')}</th><th>{t('Work')}</th><th>{t('Company / worker')}</th><th>{t('Plan')}</th><th>{t('Validity')}</th>
                    <th>{t('Watch')}</th><th>{t('Checklist')}</th><th>{t('Issued by')}</th><th>{t('Status')}</th><th>{t('Closed / cancelled on')}</th>
                  </tr>
                </thead>
                <tbody>
                  {permits.map((p) => (
                    <tr key={p.id}>
                      <td className="pp-nowrap">{p.id}</td>
                      <td className="pp-nowrap">{labelT(t)(PERMIT_TYPES[p.type].short)}</td>
                      <td>{p.location}</td>
                      <td>{p.description}</td>
                      <td>{p.contractor ?? t('Internal')}<span className="pp-muted" style={{ display: 'block' }}>{p.performer}</span></td>
                      <td className="pp-nowrap">{p.plan ? `${p.plan.id}${p.plan.signed ? '' : t(' (not signed)')}` : '—'}</td>
                      <td className="pp-nowrap">{p.validity}</td>
                      <td className="pp-nowrap">{p.watchLabel ?? '—'}</td>
                      <td className="pp-nowrap">{p.checklist.filter((i) => i.checked).length}/{p.checklist.length}</td>
                      <td>
                        {p.issuer ?? '—'}
                        {p.deliveredLabel && <span className="pp-muted" style={{ display: 'block' }}>{fill(t('on {date}'), { date: p.deliveredLabel })}</span>}
                      </td>
                      <td className="pp-nowrap">{p.stateLabel}</td>
                      <td>
                        {p.closedLabel ?? '—'}
                        {p.cancelReason && <span className="pp-muted" style={{ display: 'block' }}>{p.cancelReason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <div className="pp-foot">Vigie · {t('register of permits')} · {session.site.label} · {periodLabel} · {fill(t('printed on {date}'), { date: printedOn })}</div>
    </article>
  );
}
