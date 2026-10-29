import type { Metadata } from 'next';
import { PrintButton } from '@/components/PrintButton';
import { monthLabel } from '@/components/audits/shared';
import { fmtDate } from '@/lib/dates';
import { PLAN_ITEM_STATES } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadAuditProgramPrint } from '@/lib/data/audits';
import '../../prevention/imprimer/print.css';

export const metadata: Metadata = { title: "Programme annuel d'audit" };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

// Programme annuel des audits imprimable (AUD-26, ISO 9001 §9.2.2 : programme d'audit planifié, critères, périmètre,
// auditeurs) : éléments en vigueur de l'année, par mois, du site sélectionné et du périmètre (AUD-22), état à la date
// d'édition. Lecteurs de l'écran Audits (consultation comprise). Lien HTML simple : print.css hors de l'application.
export default async function AuditProgramPrintPage({ searchParams }: PageProps<'/audits/imprimer'>) {
  const session = await guard('audits');
  const sp = await searchParams;
  const p = await loadAuditProgramPrint(str(sp.annee));
  const certLabel = (id: string | null) => (id ? p.certs.find(([v]) => v === id)?.[1] ?? id : '');
  const done = p.items.filter((i) => i.state === 'done').length;
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        <a href={`/audits?annee=${p.year}`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />Audits et certifications</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          {p.years.map((y) => (
            <a key={y} href={`/audits/imprimer?annee=${y}`} className={`btn vg-btn-sm ${y === p.year ? 'btn-secondary' : 'btn-ghost'}`} aria-current={y === p.year ? 'page' : undefined}>{y}</a>
          ))}
          <PrintButton />
        </span>
      </div>
      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Audits et certifications</div>
        <h1>Programme annuel d&apos;audit {p.year}</h1>
        <dl className="pp-meta">
          <dt>Établissement</dt><dd>{p.site}</dd>
          <dt>Éléments</dt><dd>{p.items.length} au programme · {done} réalisé{done > 1 ? 's' : ''}{p.cancelledCount ? ` · ${p.cancelledCount} annulé${p.cancelledCount > 1 ? 's' : ''}` : ''}</dd>
          <dt>Lignes</dt><dd>{p.tracks.join(' · ') || '—'}</dd>
          <dt>Édité le</dt><dd>{fmtDate(p.now)} par {session.user.name}</dd>
        </dl>
      </header>
      <section className="pp-section">
        {p.items.length ? (
          <table className="table pp-table">
            <thead><tr><th>Mois</th><th>Ligne</th><th>Intitulé</th><th>Date</th><th>Auditeur</th><th>Périmètre · site</th><th>Responsable</th><th>État</th></tr></thead>
            <tbody>
              {p.items.map((i) => (
                <tr key={i.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{monthLabel(i.month, i.year)}</td>
                  <td>{i.track}{i.unplanned ? ' · hors programme' : ''}</td>
                  <td>{i.detail ?? i.label}{i.certificationId ? ` (${certLabel(i.certificationId)})` : ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{i.doneOn ? `réalisé le ${fmtDate(i.doneOn)}` : i.plannedOn ? fmtDate(i.plannedOn) : 'à fixer'}</td>
                  <td>{i.isReview ? '—' : i.auditorLabel || '—'}</td>
                  <td>{[i.scope, i.site].filter(Boolean).join(' · ')}</td>
                  <td>{i.owner || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{PLAN_ITEM_STATES[i.state].label}{i.findingCount ? ` · ${i.findingCount} constat${i.findingCount > 1 ? 's' : ''}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="pp-muted">Aucun élément au programme {p.year}.</p>}
      </section>
      <div className="pp-foot">Programme établi d&apos;après Vigie à la date d&apos;édition · états calculés (réalisé, à confirmer, à venir) · éléments annulés exclus.</div>
    </article>
  );
}
