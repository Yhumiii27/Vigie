import type { Metadata } from 'next';
import { PrintButton } from '@/components/PrintButton';
import { PERMIT_FILTERS, PERMIT_TYPE_FILTERS, REGISTER_FILTERS, filterParam, inPeriod, pickFilter, pickPeriod, pickType } from '@/components/prevention/filters';
import { PERMIT_TYPES } from '@/components/prevention/model';
import { hrefWith } from '@/components/ui';
import { fmtDate, monthName } from '@/lib/dates';
import { today } from '@/lib/today';
import { guard } from '@/lib/guard';
import { loadPrevention } from '@/lib/data/prevention';
import { getSession } from '@/lib/session';
import '../print.css';

export const metadata: Metadata = { title: 'Registre des permis de feu et d’essai' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// Registre imprimable des permis du site sélectionné : filtres de l'onglet Permis (?filtre=, ?type=), plus « Tous, annulés
// compris » et la période (?annee=, ?mois=, validité recoupant la période en jours de Paris). Formulaire GET simple dans
// la barre d'outils (non imprimée).
export default async function PermitRegisterPage({ searchParams }: PageProps<'/prevention/imprimer/permis'>) {
  await guard('prevention');
  const sp = await searchParams;
  const [d, session] = await Promise.all([loadPrevention(), getSession()]);
  const filter = pickFilter(REGISTER_FILTERS, str(sp.filtre));
  const type = pickType(str(sp.type));
  const period = pickPeriod(str(sp.annee), str(sp.mois));
  const permits = d.permits
    .filter((p) => filter.states.includes(p.state) && (!type || p.type === type) && (!period || inPeriod(p, period)))
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.id.localeCompare(b.id, 'fr', { numeric: true }));
  const typeLabel = PERMIT_TYPE_FILTERS.find((f) => f.key === type)?.label ?? 'Tous types';
  const periodLabel = period?.label ?? 'toutes périodes';
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
        <a href={backHref} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} />Permis</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>Pour le PDF : « Enregistrer au format PDF » dans la boîte d&apos;impression.</span>
          <PrintButton />
        </span>
      </div>

      <form method="get" action="/prevention/imprimer/permis" className="pp-filters pp-noprint">
        <label>
          État
          <select name="filtre" className="input" defaultValue={filter.key}>
            {REGISTER_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
        <label>
          Type
          <select name="type" className="input" defaultValue={type ?? ''}>
            {PERMIT_TYPE_FILTERS.map((f) => <option key={f.key ?? ''} value={f.key ?? ''}>{f.label}</option>)}
          </select>
        </label>
        <label>
          Année
          <select name="annee" className="input" defaultValue={period?.annee ?? ''}>
            <option value="">Toutes</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>
          Mois
          <select name="mois" className="input" defaultValue={period?.mois ?? ''}>
            <option value="">Tous</option>
            {MONTHS.map((m) => <option key={m} value={String(m)}>{monthName(m)}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary vg-btn-sm"><i className="ph ph-funnel" style={{ fontSize: 13 }} />Afficher</button>
      </form>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Prévention</div>
        <h1>Registre des permis de feu et d&apos;essai</h1>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>
          {session.site.label} · {periodLabel} · permis {filter.label.toLowerCase()} · {typeLabel.toLowerCase()} · {permits.length} permis · édité le {printedOn}
        </div>
      </header>

      <section className="pp-section">
        {permits.length === 0
          ? <p className="pp-empty">{period ? `Aucun permis sur la période (${period.label}).` : filter.empty}</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table pp-table">
                <thead>
                  <tr>
                    <th>Réf.</th><th>Type</th><th>Lieu</th><th>Travaux</th><th>Entreprise / intervenant</th><th>Plan</th><th>Validité</th>
                    <th>Surveillance</th><th>Check-list</th><th>Délivré par</th><th>Statut</th><th>Clos / annulé le</th>
                  </tr>
                </thead>
                <tbody>
                  {permits.map((p) => (
                    <tr key={p.id}>
                      <td className="pp-nowrap">{p.id}</td>
                      <td className="pp-nowrap">{PERMIT_TYPES[p.type].short}</td>
                      <td>{p.location}</td>
                      <td>{p.description}</td>
                      <td>{p.contractor ?? 'Interne'}<span className="pp-muted" style={{ display: 'block' }}>{p.performer}</span></td>
                      <td className="pp-nowrap">{p.plan ? `${p.plan.id}${p.plan.signed ? '' : ' (non signé)'}` : '—'}</td>
                      <td className="pp-nowrap">{p.validity}</td>
                      <td className="pp-nowrap">{p.watchLabel ?? '—'}</td>
                      <td className="pp-nowrap">{p.checklist.filter((i) => i.checked).length}/{p.checklist.length}</td>
                      <td>
                        {p.issuer ?? '—'}
                        {p.deliveredLabel && <span className="pp-muted" style={{ display: 'block' }}>le {p.deliveredLabel}</span>}
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

      <div className="pp-foot">Vigie · registre des permis · {session.site.label} · {periodLabel} · édité le {printedOn}</div>
    </article>
  );
}
