import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { fmtEuro } from '@/components/risks/format';
import { fmtDate, yearOf } from '@/lib/dates';
import { PROGRAM_SHORT, PROGRAM_STATES } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadPreventionProgram } from '@/lib/data/risks';
import { today } from '@/lib/today';
import '../../../prevention/imprimer/print.css';

export const metadata: Metadata = { title: 'Programme annuel de prévention (PAPRIPACT)' };

const Meta = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="pp-meta">
    {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>
);

// Programme annuel de prévention imprimable (L. 4121-3-1, DUE-02), ?annee=AAAA : lignes du site sélectionné (dans le
// périmètre), coût estimé, ressources et indicateur, avec une ligne de total. Jamais de pilotes ni d'historique.
export default async function ProgramPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await guard('risks');
  const sp = await searchParams;
  const now = today();
  const year = typeof sp.annee === 'string' && /^\d{4}$/.test(sp.annee) ? Number(sp.annee) : yearOf(now);
  const d = await loadPreventionProgram(year);
  const { program, lines, totals, hiddenCount } = d;
  const multiSite = new Set(lines.map((l) => l.siteId)).size > 1;

  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href={`/risques?programme=${year}`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{PROGRAM_SHORT} {year}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>Pour le PDF : « Enregistrer au format PDF » dans la boîte d&apos;impression.</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · {PROGRAM_SHORT} {year}</div>
        <div className="pp-head-row">
          <h1>Programme annuel de prévention des risques professionnels et d&apos;amélioration des conditions de travail {year}</h1>
          {program && <span className="tag tag-neutral">{PROGRAM_STATES[program.state].label}</span>}
        </div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>Code du travail, article L. 4121-3-1 · issu du document unique d&apos;évaluation des risques</div>
        {program && (
          <Meta rows={[
            ['Établissement', session.site.label],
            ['DUERP d’origine', `Version ${program.duerpVersion}`],
            ['Objet', program.comment || '—'],
            ['CSE consulté le', program.cseConsultedOn ? fmtDate(program.cseConsultedOn) : 'À renseigner'],
            ['Arrêté', program.frozenOn ? `le ${fmtDate(program.frozenOn)}${program.frozenBy ? ` par ${program.frozenBy}` : ''}` : 'Non (en préparation)'],
            ['Édité le', fmtDate(now)],
          ]} />
        )}
      </header>

      <section className="pp-section">
        {!program ? <p className="pp-empty">Aucun programme établi pour {year}.</p> : (
          <>
            <h2>Actions de prévention · {totals.count}</h2>
            {lines.length === 0 ? <p className="pp-empty">Aucune action du programme sur ce site.</p> : (
              <table className="table pp-table">
                <thead>
                  <tr><th>Action</th><th>Risques du DUERP</th><th>Date cible</th><th>Avancement</th><th style={{ textAlign: 'right' }}>Coût estimé (HT)</th><th>Ressources</th><th>Indicateur</th></tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.actionId}>
                      <td>
                        <span className="pp-nowrap">{l.actionId}</span> · {l.title}
                        {multiSite && <span className="pp-muted" style={{ display: 'block' }}>{l.site}</span>}
                      </td>
                      <td>{l.risks.length ? l.risks.map((r, i) => <div key={`${r.id ?? i}`}>{r.label} ({r.cotation})</div>) : '—'}</td>
                      <td className="pp-nowrap">{l.dueOn ? fmtDate(l.dueOn) : '—'}</td>
                      <td>
                        {l.status}
                        {l.frozenStatus != null && l.frozenStatus !== l.status && <span className="pp-muted" style={{ display: 'block' }}>à l&apos;arrêt : {l.frozenStatus}</span>}
                      </td>
                      <td className="pp-nowrap" style={{ textAlign: 'right' }}>{l.estimatedCost != null ? fmtEuro(l.estimatedCost) : '—'}</td>
                      <td>{l.resources || '—'}</td>
                      <td>{l.indicator || '—'}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4} style={{ fontWeight: 500 }}>
                      Total · {totals.count} action{totals.count > 1 ? 's' : ''}{totals.done ? ` · ${totals.done} vérifiée${totals.done > 1 ? 's' : ''}` : ''}
                      {totals.count > totals.costed && <span className="pp-muted"> · {totals.count - totals.costed} sans coût estimé</span>}
                    </td>
                    <td className="pp-nowrap" style={{ textAlign: 'right', fontWeight: 500 }}>{fmtEuro(totals.cost)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            )}
            {hiddenCount > 0 && (
              <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>
                Programme commun à tous les sites : {hiddenCount} action{hiddenCount > 1 ? 's' : ''} d&apos;autres sites {hiddenCount > 1 ? 'ne figurent pas' : 'ne figure pas'} sur cette édition (site sélectionné : {session.site.label}).
              </p>
            )}
          </>
        )}
      </section>

      <div className="pp-foot">Vigie · {PROGRAM_SHORT} {year} · {session.site.label} · édité le {fmtDate(now)}</div>
    </article>
  );
}
