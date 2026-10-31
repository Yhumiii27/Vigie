import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { MissingNotice } from '@/components/ui';
import { fmtEuros, fmtHours } from '@/components/actions/detail/form-helpers';
import { actionHref } from '@/lib/action-rules';
import { fmtDate, fmtParisDateTime } from '@/lib/dates';
import { FOLLOW_REASONS } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadActionDetail } from '@/lib/data/actions';
import { today } from '@/lib/today';
import '../../../prevention/imprimer/print.css';

export async function generateMetadata({ params }: PageProps<'/actions/fiche/[id]'>): Promise<Metadata> {
  const { id } = await params;
  return { title: `Action ${decodeURIComponent(id)} · fiche imprimable` };
}

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
    {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>)}
  </dl>
);
const Text = ({ value, empty = 'Non renseigné.' }: { value: string | null; empty?: string }) =>
  (value ? <p className="pp-text">{value}</p> : <p className="pp-empty">{empty}</p>);

/**
 * Fiche imprimable d'une action QSE (IMP-07) : problème, action, planification, source, vérification, coûts, fil de
 * commentaires, preuves (noms) et historique. Mêmes droits que la fiche (loadActionDetail : plan du site sélectionné, ou ses
 * propres actions sur tout le périmètre ; Salarié : les siennes) ; ni texte d'un commentaire retiré, ni donnée de santé
 * (aucune n'est portée par une action). Action introuvable ou hors du site : bandeau commun, rien n'est révélé (UX-13).
 */
export default async function ActionPrintPage({ params }: PageProps<'/actions/fiche/[id]'>) {
  await guard('actions');
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const { payload } = await loadActionDetail(id);
  if (!payload) {
    return (
      <article className="pp-doc pp-doc-narrow">
        <h1 className="vg-sr-only">Fiche d&apos;action</h1>
        <MissingNotice closeHref="/actions" />
      </article>
    );
  }
  const d = payload.detail;
  const verified = d.status === 'verifiee';
  const abandoned = d.status === 'abandonnee';

  return (
    <article className="pp-doc pp-doc-narrow">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href={actionHref(d.id)} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />Action {d.id}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>Pour le PDF : « Enregistrer au format PDF » dans la boîte d&apos;impression.</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Plan d&apos;actions QSE · fiche action</div>
        <div className="pp-head-row">
          <h1>{d.id} · {d.label}</h1>
          <span>{d.statusLabel}</span>
        </div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>{d.sourceLabel} · {d.site} · éditée le {fmtDate(today())}</div>
      </header>

      <Section num={1} title="Problème"><Text value={d.problem} empty="À compléter." /></Section>
      <Section num={2} title="Action"><Text value={d.detail} empty="Aucun détail saisi." /></Section>

      <Section num={3} title="Planification">
        <Meta rows={[
          ['Ouverte le', d.opened],
          ['Responsable', `${d.pilot}${d.pilotLeft ? ' (sorti de l’effectif)' : ''}`],
          ['Avancement', d.avancement],
          ['Priorité', d.priorityLabel ?? 'À compléter'],
          ['Domaine', d.domainLabel ?? 'À compléter'],
          ['Niveau de risque', d.riskLevelLabel ?? '—'],
          ['Site', d.site],
          ['Date cible', `${fmtDate(d.dueOn)}${d.late ? ` · ${d.lateDays} j de retard` : ''}`],
          ...(d.rescheduled ? [['Date cible initiale', fmtDate(d.initialDueOn)] as [string, ReactNode]] : []),
          ['Vérification planifiée', d.verifyDueOn ? `${fmtDate(d.verifyDueOn)}${d.verifyLate ? ' · dépassée' : ''}` : '—'],
          ['Date effective', d.doneOn ? fmtDate(d.doneOn) : '—'],
          ...(abandoned ? [['Abandonnée le', d.cancelledOn ? fmtDate(d.cancelledOn) : '—'], ['Par', d.cancelledBy ?? '—'], ['Motif', d.cancelReason ?? '—']] as [string, ReactNode][] : []),
        ]} />
      </Section>

      <Section num={4} title="Source">
        <Meta rows={[
          ['Source', d.sourceLabel],
          ...(d.originRef ? [['Référence d’origine', d.originRef] as [string, ReactNode]] : []),
          ...(d.follows ? [['Suite de', `${d.follows.id}${d.follows.label ? ` · ${d.follows.label}` : ''} (${FOLLOW_REASONS[d.follows.reason].toLowerCase()})`] as [string, ReactNode]] : []),
          ...d.followUps.map((f) => ['Suivie par', `${f.id} · ${f.label} (${FOLLOW_REASONS[f.reason].toLowerCase()}) · ${f.statusLabel}`] as [string, ReactNode]),
        ]} />
        {d.sources.length > 0 ? (
          <ul className="pp-text" style={{ margin: 0, paddingLeft: 18 }}>
            {d.sources.map((s, i) => <li key={`${s.kind}-${i}`}>{s.label}{s.detail ? ` · ${s.detail}` : ''}</li>)}
          </ul>
        ) : <p className="pp-empty">Aucun élément lié.</p>}
      </Section>

      <Section num={5} title="Vérification">
        {verified ? (
          <>
            <Meta rows={[
              ['Vérifiée le', d.closedOn ? fmtDate(d.closedOn) : '—'],
              ['Nature', d.verifyMethodLabel ?? '—'],
              ['Résultat', d.effective == null ? '—' : d.effective ? 'Efficace' : 'Non efficace'],
              ['Vérifiée par', d.verifiedBy ?? '—'],
              ...(d.newRisk ? [['Nouveau risque', 'Généré'] as [string, ReactNode]] : []),
            ]} />
            <Text value={d.efficacyNote} empty="Aucun constat consigné." />
          </>
        ) : <p className="pp-empty">Action non vérifiée.</p>}
      </Section>

      <Section num={6} title="Pointage et coûts">
        <Meta rows={[['Pointage', fmtHours(d.hours)], ['Coût estimé', fmtEuros(d.estimatedCost)], ['Coût réel', fmtEuros(d.actualCost)]]} />
      </Section>

      <Section num={7} title="Fil de l’action">
        {d.comments.length ? d.comments.map((c) => (
          <div key={c.id} className="pp-sub">
            <h3>{c.author}{c.authorRole ? ` · ${c.authorRole}` : ''} · {c.atLabel}</h3>
            {c.withdrawn
              ? <p className="pp-empty">Commentaire retiré le {c.withdrawn.atLabel} par {c.withdrawn.by} · motif : {c.withdrawn.reason}</p>
              : <Text value={c.body} empty="" />}
            {c.files.length > 0 && <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>Pièces : {c.files.map((f) => f.name).join(', ')}</p>}
          </div>
        )) : <p className="pp-empty">Aucun commentaire.</p>}
      </Section>

      <Section num={8} title="Preuves">
        {d.files.length ? (
          <ul className="pp-text" style={{ margin: 0, paddingLeft: 18 }}>
            {d.files.map((f) => <li key={f.id}>{f.name}{f.commentWithdrawn ? ' (commentaire retiré)' : ''}</li>)}
          </ul>
        ) : <p className="pp-empty">Aucune preuve jointe.</p>}
      </Section>

      <Section num={9} title="Historique">
        {d.history.length ? (
          <table className="table pp-table">
            <thead><tr><th scope="col">Date</th><th scope="col">Par</th><th scope="col">Modification</th></tr></thead>
            <tbody>
              {d.history.map((e) => (
                <tr key={e.id}>
                  <td className="pp-nowrap">{fmtParisDateTime(new Date(e.at))}</td>
                  <td>{e.who}</td>
                  <td>
                    {e.summary}
                    {e.reason && <> · motif : {e.reason}</>}
                    {e.details.map((x, i) => <div key={i} className="pp-muted">{x.field} : {x.from ?? '—'} → {x.to ?? '—'}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="pp-empty">Aucune modification enregistrée.</p>}
      </Section>
      <p className="pp-foot">Document édité depuis Vigie le {fmtDate(today())} : la fiche en ligne fait foi.</p>
    </article>
  );
}
