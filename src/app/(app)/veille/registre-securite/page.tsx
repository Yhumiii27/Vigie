import type { Metadata } from 'next';
import { PrintButton } from '@/components/PrintButton';
import { fmtDate } from '@/lib/dates';
import { CONTROL_CATEGORIES, isControlCategory } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadSafetyRegisterPrint } from '@/lib/data/watch';
import { today } from '@/lib/today';
import '../../prevention/imprimer/print.css';

export const metadata: Metadata = { title: 'Registre de sécurité' };

// Registre de sécurité consolidé par site (VEI-15, L. 4711-1 et L. 4711-2 du Code du travail) : vérifications
// périodiques réalisées (résultats, organismes, réserves et observations) et observations ou mises en demeure de
// l'inspection du travail et des organismes, avec leur réponse. Site sélectionné (« Tous les sites » : un registre par
// site du périmètre). Calculé à l'affichage, jamais stocké ; ouvert dans un nouvel onglet (print.css hors de l'application).
export default async function SafetyRegisterPrintPage() {
  const session = await guard('watch');
  const now = today();
  const { sites } = await loadSafetyRegisterPrint();
  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        <a href="/veille?onglet=registre" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />Veille et contrôles</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>Pour le PDF : « Enregistrer au format PDF » dans la boîte d&apos;impression.</span>
          <PrintButton />
        </span>
      </div>
      {sites.length === 0 && <p className="pp-empty">Aucun site dans le périmètre sélectionné.</p>}
      {sites.map((s, i) => (
        <section key={s.id} className="pp-section" style={i > 0 ? { breakBefore: 'page' } : undefined}>
          <header className="pp-head">
            <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Registre de sécurité (L. 4711-1)</div>
            <h1>{s.label}{s.archived ? ' (site archivé)' : ''}</h1>
            <dl className="pp-meta">
              {s.siret && <><dt>SIRET</dt><dd>{s.siret}</dd></>}
              <dt>Édité le</dt><dd>{fmtDate(now)} par {session.user.name}</dd>
              <dt>Contenu</dt><dd>{s.controls.length} équipement{s.controls.length > 1 ? 's' : ''} suivi{s.controls.length > 1 ? 's' : ''} · {s.notices.length} observation{s.notices.length > 1 ? 's' : ''} ou mise{s.notices.length > 1 ? 's' : ''} en demeure</dd>
            </dl>
          </header>

          <h2 className="pp-h">Observations et mises en demeure</h2>
          {s.notices.length === 0 ? <p className="pp-empty">Aucune observation ni mise en demeure inscrite.</p> : (
            <table className="table pp-table">
              <thead><tr><th>Reçue le</th><th>Nature</th><th>Émetteur</th><th>Objet</th><th>Délai</th><th>Réponse</th></tr></thead>
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

          <h2 className="pp-h">Vérifications et contrôles périodiques</h2>
          {s.controls.length === 0 ? <p className="pp-empty">Aucun contrôle périodique suivi.</p> : (
            <table className="table pp-table">
              <thead><tr><th>Équipement</th><th>Contrôle</th><th>Date</th><th>Organisme</th><th>Résultat</th><th>Réserves et observations</th></tr></thead>
              <tbody>
                {s.controls.flatMap((c) => {
                  const head = `${c.equipment}${c.common ? ' (tous sites)' : ''}`;
                  const kind = `${c.controlType}${isControlCategory(c.category) && c.category !== 'reglementaire' ? ` · ${CONTROL_CATEGORIES[c.category].short}` : ''} · tous les ${c.period} mois`;
                  if (!c.records.length) {
                    return [<tr key={`c${c.id}`}><td>{head}</td><td>{kind}</td><td colSpan={4} className="pp-muted">Aucun contrôle enregistré dans Vigie · prochain le {fmtDate(c.next)} ({c.status})</td></tr>];
                  }
                  return c.records.map((r, j) => (
                    <tr key={`r${r.id}`}>
                      <td>{j === 0 ? head : ''}</td>
                      <td>{j === 0 ? kind : ''}</td>
                      <td className="pp-nowrap">{fmtDate(r.performedOn)}</td>
                      <td>{r.organization}</td>
                      <td>{r.result ?? '—'}{r.eventId ? ` · NC ${r.eventId}` : ''}</td>
                      <td className="pp-text">{[r.reserves && `Réserves : ${r.reserves}`, r.notes].filter(Boolean).join(' · ') || '—'}</td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          )}
          <div className="pp-foot">Registre consolidé d&apos;après Vigie à la date d&apos;édition · rapports et attestations joints aux contrôles dans Vigie.</div>
        </section>
      ))}
    </article>
  );
}
