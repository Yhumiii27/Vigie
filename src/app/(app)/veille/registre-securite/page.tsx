import type { Metadata } from 'next';
import { PrintButton } from '@/components/PrintButton';
import { fmtDate } from '@/lib/dates';
import { CONTROL_CATEGORIES, isControlCategory } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadSafetyRegisterPrint } from '@/lib/data/watch';
import { today } from '@/lib/today';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';
import '../../prevention/imprimer/print.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Safety register') };
}

// Registre de sécurité consolidé par site (VEI-15, L. 4711-1 et L. 4711-2 du Code du travail) : vérifications
// périodiques réalisées (résultats, organismes, réserves et observations) et observations ou mises en demeure de
// l'inspection du travail et des organismes, avec leur réponse. Site sélectionné (« Tous les sites » : un registre par
// site du périmètre). Calculé à l'affichage, jamais stocké ; ouvert dans un nouvel onglet (print.css hors de l'application).
export default async function SafetyRegisterPrintPage() {
  const session = await guard('watch');
  const { t } = await getI18n();
  const now = today();
  const { sites } = await loadSafetyRegisterPrint();
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        <a href="/veille?onglet=registre" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Watch and inspections')}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>{t('For the PDF: “Save as PDF” in the print dialog.')}</span>
          <PrintButton />
        </span>
      </div>
      {sites.length === 0 && <p className="pp-empty">{t('No site in the selected scope.')}</p>}
      {sites.map((s, i) => (
        <section key={s.id} className="pp-section" style={i > 0 ? { breakBefore: 'page' } : undefined}>
          <header className="pp-head">
            <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>{t('Vigie · Safety register (L. 4711-1)')}</div>
            <h1>{s.label}{s.archived ? t(' (site archived)') : ''}</h1>
            <dl className="pp-meta">
              {s.siret && <><dt>SIRET</dt><dd>{s.siret}</dd></>}
              <dt>{t('Issued on')}</dt><dd>{fill(t('{date} by {name}'), { date: fmtDate(now), name: session.user.name })}</dd>
              <dt>{t('Content')}</dt><dd>{fill(s.controls.length > 1 ? t('{n} pieces of equipment followed') : t('{n} piece of equipment followed'), { n: s.controls.length })} · {fill(s.notices.length > 1 ? t('{n} observations or formal notices') : t('{n} observation or formal notice'), { n: s.notices.length })}</dd>
            </dl>
          </header>

          <h2 className="pp-h">{t('Observations and formal notices')}</h2>
          {s.notices.length === 0 ? <p className="pp-empty">{t('No observation or formal notice recorded.')}</p> : (
            <table className="table pp-table">
              <thead><tr><th>{t('Received on')}</th><th>{t('Nature')}</th><th>{t('Issuer')}</th><th>{t('Subject')}</th><th>{t('Deadline#response')}</th><th>{t('Answer')}</th></tr></thead>
              <tbody>
                {s.notices.map((n) => (
                  <tr key={n.id}>
                    <td className="pp-nowrap">{fmtDate(n.receivedOn)}</td>
                    <td>{n.kindLabel}</td>
                    <td>{n.authority}{n.reference ? ` · ${n.reference}` : ''}</td>
                    <td className="pp-text">{n.text}{n.control ? ` (${n.control})` : ''}</td>
                    <td className="pp-nowrap">{n.dueOn ? fmtDate(n.dueOn) : '—'}</td>
                    <td className="pp-text">{n.answeredOn ? `${fmtDate(n.answeredOn)} · ${n.answer}` : n.state.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2 className="pp-h">{t('Periodic checks and inspections')}</h2>
          {s.controls.length === 0 ? <p className="pp-empty">{t('No periodic inspection followed.')}</p> : (
            <table className="table pp-table">
              <thead><tr><th>{t('Equipment')}</th><th>{t('Inspection')}</th><th>{t('Date')}</th><th>{t('Body')}</th><th>{t('Result')}</th><th>{t('Reservations and observations')}</th></tr></thead>
              <tbody>
                {s.controls.flatMap((c) => {
                  const head = `${c.equipment}${c.common ? t(' (all sites)') : ''}`;
                  const kind = `${c.controlType}${isControlCategory(c.category) && c.category !== 'reglementaire' ? ` · ${CONTROL_CATEGORIES[c.category].short}` : ''} · ${fill(t('every {n} months'), { n: c.period })}`;
                  if (!c.records.length) {
                    return [<tr key={`c${c.id}`}><td>{head}</td><td>{kind}</td><td colSpan={4} className="pp-muted">{fill(t('No inspection recorded in Vigie · next on {date} ({status})'), { date: fmtDate(c.next), status: c.status })}</td></tr>];
                  }
                  return c.records.map((r, j) => (
                    <tr key={`r${r.id}`}>
                      <td>{j === 0 ? head : ''}</td>
                      <td>{j === 0 ? kind : ''}</td>
                      <td className="pp-nowrap">{fmtDate(r.performedOn)}</td>
                      <td>{r.organization}</td>
                      <td>{r.result ?? '—'}{r.eventId ? ` · NC ${r.eventId}` : ''}</td>
                      <td className="pp-text">{[r.reserves && fill(t('Reservations: {reserves}'), { reserves: r.reserves }), r.notes].filter(Boolean).join(' · ') || '—'}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          )}
          <div className="pp-foot">{t('Register consolidated from Vigie on the issue date · reports and certificates attached to the inspections in Vigie.')}</div>
        </section>
      ))}
    </article>
  );
}
