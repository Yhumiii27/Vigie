import type { Metadata } from 'next';
import { PrintButton } from '@/components/PrintButton';
import { ForecastView } from '@/components/skills/ForecastView';
import { renewalForecast } from '@/lib/rules/skills';
import { fmtDate } from '@/lib/dates';
import { guard } from '@/lib/guard';
import { loadSkillMatrix } from '@/lib/data/skills';
import { today } from '@/lib/today';
import { getI18n } from '@/i18n/server';
import { fill } from '@/i18n/translate';
import '../../prevention/imprimer/print.css';

export const metadata: Metadata = { title: 'Plan de formation · recyclages à prévoir' };

// Plan de formation imprimable (HAB-09) : recyclages et formations à prévoir sur 12 mois, par mois et par titre, pour le
// site sélectionné (le Salarié : ses seuls titres, comme la matrice). Calculé à l'affichage, jamais stocké ; géré par le
// service RH, sans action QSE. Ouvert dans un nouvel onglet par un lien HTML simple (print.css hors de l'application).
export default async function TrainingPlanPrintPage() {
  const session = await guard('skills');
  const { t } = await getI18n();
  const now = today();
  const { rows, titles, self } = await loadSkillMatrix();
  const forecast = renewalForecast(rows, now);
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        <a href="/habilitations?vue=a-prevoir" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Qualifications and training')}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>{t('For the PDF: “Save as PDF” in the print dialog.')}</span>
          <PrintButton />
        </span>
      </div>
      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>{t('Vigie · Qualifications and training')}</div>
        <h1>{t('Training plan · renewals to plan over 12 months')}</h1>
        <dl className="pp-meta">
          <dt>{t('Establishment')}</dt><dd>{session.site.label}</dd>
          <dt>{t('Scope')}</dt><dd>{self ? t('My qualifications') : fill(t('{people} employees · {n} titles followed'), { people: rows.length, n: titles.length })}</dd>
          <dt>{t('Issued on')}</dt><dd>{fill(t('{date} by {name}'), { date: fmtDate(now), name: session.user.name })}</dd>
        </dl>
      </header>
      <section className="pp-section">
        <ForecastView forecast={forecast} links={false} tableClass="table pp-table" />
      </section>
      <div className="pp-foot">{t('Forecast computed from the expiry dates of the required titles on the issue date · trainings managed by the HR department.')}</div>
    </article>
  );
}
