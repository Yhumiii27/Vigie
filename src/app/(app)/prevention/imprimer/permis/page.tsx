import type { Metadata } from 'next';
import { PrintButton } from '@/components/PrintButton';
import { PERMIT_FILTERS, PERMIT_TYPE_FILTERS, filterParam, pickFilter, pickType } from '@/components/prevention/filters';
import { PERMIT_TYPES } from '@/components/prevention/model';
import { hrefWith } from '@/components/ui';
import { fmtDate, today } from '@/lib/dates';
import { guard } from '@/lib/guard';
import { loadPrevention } from '@/lib/data/prevention';
import { getSession } from '@/lib/session';
import '../print.css';

export const metadata: Metadata = { title: 'Registre des permis de feu et d’essai' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

// Registre imprimable des permis du site sélectionné, avec les filtres de l'onglet Permis (?filtre=, ?type=).
export default async function PermitRegisterPage({ searchParams }: PageProps<'/prevention/imprimer/permis'>) {
  await guard('prevention');
  const sp = await searchParams;
  const [d, session] = await Promise.all([loadPrevention(), getSession()]);
  const filter = pickFilter(PERMIT_FILTERS, str(sp.filtre));
  const type = pickType(str(sp.type));
  const permits = d.permits
    .filter((p) => filter.states.includes(p.state) && (!type || p.type === type))
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.id.localeCompare(b.id, 'fr', { numeric: true }));
  const typeLabel = PERMIT_TYPE_FILTERS.find((f) => f.key === type)?.label ?? 'Tous types';
  const backHref = hrefWith('/prevention', { onglet: 'permis' }, { filtre: filterParam(PERMIT_FILTERS, filter), type: type ?? undefined });

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

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Prévention</div>
        <h1>Registre des permis de feu et d&apos;essai</h1>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>
          {session.site.label} · permis {filter.label.toLowerCase()} · {typeLabel.toLowerCase()} · {permits.length} permis · édité le {fmtDate(today())}
        </div>
      </header>

      <section className="pp-section">
        {permits.length === 0
          ? <p className="pp-empty">{filter.empty}</p>
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
                      <td>{p.issuer ?? '—'}</td>
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

      <div className="pp-foot">Vigie · registre des permis · {session.site.label} · édité le {fmtDate(today())}</div>
    </article>
  );
}
