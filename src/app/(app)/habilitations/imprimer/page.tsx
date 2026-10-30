import type { Metadata } from 'next';
import { PrintButton } from '@/components/PrintButton';
import { ForecastView } from '@/components/skills/ForecastView';
import { renewalForecast } from '@/lib/rules/skills';
import { fmtDate } from '@/lib/dates';
import { guard } from '@/lib/guard';
import { loadSkillMatrix } from '@/lib/data/skills';
import { today } from '@/lib/today';
import '../../prevention/imprimer/print.css';

export const metadata: Metadata = { title: 'Plan de formation · recyclages à prévoir' };

// Plan de formation imprimable (HAB-09) : recyclages et formations à prévoir sur 12 mois, par mois et par titre, pour le
// site sélectionné (le Salarié : ses seuls titres, comme la matrice). Calculé à l'affichage, jamais stocké ; géré par le
// service RH, sans action QSE. Ouvert dans un nouvel onglet par un lien HTML simple (print.css hors de l'application).
export default async function TrainingPlanPrintPage() {
  const session = await guard('skills');
  const now = today();
  const { rows, titles, self } = await loadSkillMatrix();
  const forecast = renewalForecast(rows, now);
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        <a href="/habilitations?vue=a-prevoir" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />Habilitations et formations</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>Pour le PDF : « Enregistrer au format PDF » dans la boîte d&apos;impression.</span>
          <PrintButton />
        </span>
      </div>
      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Habilitations et formations</div>
        <h1>Plan de formation · recyclages à prévoir sur 12 mois</h1>
        <dl className="pp-meta">
          <dt>Établissement</dt><dd>{session.site.label}</dd>
          <dt>Périmètre</dt><dd>{self ? 'Mes habilitations' : `${rows.length} salariés · ${titles.length} titres suivis`}</dd>
          <dt>Édité le</dt><dd>{fmtDate(now)} par {session.user.name}</dd>
        </dl>
      </header>
      <section className="pp-section">
        <ForecastView forecast={forecast} links={false} tableClass="table pp-table" />
      </section>
      <div className="pp-foot">Prévision calculée d&apos;après les échéances des titres requis à la date d&apos;édition · formations gérées par le service RH.</div>
    </article>
  );
}
