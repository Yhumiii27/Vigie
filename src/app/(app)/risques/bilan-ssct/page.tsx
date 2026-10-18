import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { fmtDate } from '@/lib/dates';
import { canSeeHealth } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadSsctReport } from '@/lib/data/ssct';
import '../../prevention/imprimer/print.css';

export const metadata: Metadata = { title: 'Bilan annuel SSCT' };

function Section({ num, title, children }: { num: number; title: string; children: ReactNode }) {
  return (
    <section className="pp-section">
      <h2><span className="pp-num">{num}</span>{title}</h2>
      {children}
    </section>
  );
}
const Meta = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="pp-meta">
    {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>
);
const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

// Bilan annuel santé, sécurité et conditions de travail présenté au CSE (CNF-03, art. L. 2312-27 du code du travail) :
// calculé d'après les données de Vigie (site sélectionné, « Tous les sites » : consolidé), imprimable. Accidentologie et
// maladies professionnelles : animateur QHSE et direction seulement (HEALTH_PAGES, src/lib/auth/route-access.ts).
export default async function SsctReportPage({ searchParams }: PageProps<'/risques/bilan-ssct'>) {
  const session = await guard('risks');
  if (!canSeeHealth(session.role)) redirect('/risques');
  const sp = await searchParams;
  const r = await loadSsctReport(str(sp.annee));
  if (!r) redirect('/risques');
  const a = r.accidents;

  return (
    <article className="pp-doc pp-doc-narrow">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href="/risques" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} />Évaluation des risques</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          {r.years.map((y) => (
            <a key={y} href={`/risques/bilan-ssct?annee=${y}`} className={`btn vg-btn-sm ${y === r.year ? 'btn-secondary' : 'btn-ghost'}`} aria-current={y === r.year ? 'page' : undefined}>{y}</a>
          ))}
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · document pour le comité social et économique</div>
        <div className="pp-head-row"><h1>Bilan annuel santé, sécurité et conditions de travail {r.year}</h1></div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>
          Code du travail, art. L. 2312-27 · {r.site} · données au {fmtDate(r.periodEnd)} · édité le {fmtDate(r.generatedOn)}
        </div>
        <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>
          Bilan calculé d&apos;après les données de Vigie, à compléter par l&apos;employeur (conditions de travail, effectifs, analyse) avant sa présentation au CSE.
        </p>
      </header>

      <Section num={1} title="Accidents du travail et maladies professionnelles">
        <Meta rows={[
          ['Accidents avec arrêt', `${a.arret} · ${a.lostDays} jour${a.lostDays > 1 ? 's' : ''} perdu${a.lostDays > 1 ? 's' : ''}`],
          ['Accidents sans arrêt', String(a.sansArret)],
          ['Premiers soins (accidents bénins)', String(a.soins)],
          ['Taux de fréquence (TF1)', `${a.tf1}${a.missingMonths ? ` · ${a.missingMonths} mois sans heures saisies` : ''}`],
          ['Taux de gravité (TG)', a.tg],
          ['Accidents de trajet', `${a.commute} · hors TF1 et TG`],
          ['Accidents d’intérimaires · de personnes extérieures', `${a.temporary} · ${a.external}`],
          ['Maladies professionnelles déclarées', String(a.occupationalDiseases)],
          ['Presque-accidents · situations dangereuses signalés', `${a.nearMisses} · ${a.dangerous}`],
        ]} />
        <p className="pp-muted" style={{ margin: 0, fontSize: 11.5 }}>Taux calculés sur les accidents de l&apos;effectif et les heures travaillées saisies des mois échus de l&apos;année.</p>
      </Section>

      <Section num={2} title="Actions de prévention menées">
        <Meta rows={[
          ['Actions ouvertes dans l’année', String(r.actions.opened)],
          ['Actions vérifiées dans l’année', `${r.actions.closed} · efficaces : ${r.actions.efficacy}`],
          [`Actions ouvertes au ${fmtDate(r.actions.asOf)}`, `${r.actions.openAtEnd} · en retard : ${r.actions.lateAtEnd} (${r.actions.lateRate})`],
        ]} />
        <p className="pp-muted" style={{ margin: 0, fontSize: 11.5 }}>Plan d&apos;actions QSE, domaines Sécurité et Santé (statistiques mensuelles du plan).</p>
        {r.actions.done.length > 0 && (
          <table className="table" style={{ fontSize: 12 }}>
            <thead><tr><th>N°</th><th>Action vérifiée</th><th>Le</th><th>Efficacité</th></tr></thead>
            <tbody>
              {r.actions.done.map((x) => (
                <tr key={x.id}><td>{x.id}</td><td>{x.label}</td><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(x.closedOn)}</td><td>{x.effective ? 'Efficace' : 'Non efficace'}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section num={3} title="Évaluation des risques (document unique)">
        {r.duerp.length ? (
          <table className="table" style={{ fontSize: 12 }}>
            <thead><tr><th>Version</th><th>Mise à jour</th><th>CSE consulté</th><th>Transmise au SPST</th></tr></thead>
            <tbody>
              {r.duerp.map((v) => (
                <tr key={v.version}>
                  <td>{v.version}{v.current ? ' (en vigueur)' : ''}</td><td>{fmtDate(v.updatedOn)}</td>
                  <td>{v.cseConsultedOn ? fmtDate(v.cseConsultedOn) : 'À renseigner'}</td><td>{v.spstSentOn ? fmtDate(v.spstSentOn) : 'À renseigner'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="pp-empty">Aucune mise à jour du document unique dans l&apos;année.</p>}
      </Section>

      <Section num={4} title="Programme annuel de prévention">
        <Meta rows={r.programs.map((p) => [String(p.year), p.label] as [string, ReactNode])} />
        <p className="pp-muted" style={{ margin: 0, fontSize: 11.5 }}>Programme annuel de prévention des risques professionnels et d&apos;amélioration des conditions de travail (L. 2312-27 2°), détaillé sur l&apos;écran Évaluation des risques.</p>
      </Section>

      <Section num={5} title="Contrôles, prévention et formation">
        <Meta rows={[
          ['Contrôles réglementaires réalisés', `${r.controls.performed} · avec réserves : ${r.controls.withReserves} · défavorables ou mise à l’arrêt : ${r.controls.blocking}`],
          ['Plans de prévention (interventions de l’année)', String(r.prevention.plans)],
          ['Formations et habilitations obtenues', String(r.trainings.total)],
        ]} />
        {r.trainings.byTitle.length > 0 && (
          <p className="pp-text" style={{ fontSize: 12 }}>{r.trainings.byTitle.map((x) => `${x.title} : ${x.n}`).join(' · ')}</p>
        )}
      </Section>
      <p className="pp-foot">Document réservé à l&apos;animateur QHSE et à la direction jusqu&apos;à sa présentation au CSE (données d&apos;accidentologie).</p>
    </article>
  );
}
