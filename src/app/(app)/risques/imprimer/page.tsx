import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { DuerpAccessNotice } from '@/components/risks/AccessNotice';
import { fmtDate } from '@/lib/dates';
import { RISK_ACTION_THRESHOLD, RISK_LEVELS } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { DUERP_RETENTION, levelName, loadDuerpPrint, loadDuerpVersion, type PrintAction, type RiskRecord } from '@/lib/data/risks';
import { today } from '@/lib/today';
import '../../prevention/imprimer/print.css';

export const metadata: Metadata = { title: "Document unique d'évaluation des risques professionnels" };

type Unit = { id: string; label: string; siteId: string | null; site: string };
type PrintDoc = { meta: [string, ReactNode][]; units: Unit[]; risks: RiskRecord[]; actionInfo: Record<string, PrintAction> | null; label: string };

const Meta = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="pp-meta">
    {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>
);

function Cotation({ g, p }: { g: number; p: number }) {
  const n = g * p;
  return (
    <>
      <span className="pp-nowrap">G{g} × P{p} = {n}</span>
      <span className="pp-muted" style={{ display: 'block' }}>{levelName(n)}</span>
    </>
  );
}

/** Établissement : site sélectionné, sinon sites des unités imprimées. */
const sitesOf = (units: Unit[]) => [...new Set(units.map((u) => u.site))].join(' · ') || '—';

// Version imprimable du DUERP (DUE-01), ouverte dans un nouvel onglet depuis l'écran ou la liste des versions : version en
// vigueur (unités du site sélectionné, actions de prévention avec échéance et statut) ou instantané d'une version archivée
// (?version=n, unités du périmètre, références des actions seulement). Jamais de pilotes, d'événements liés ni d'historique.
export default async function DuerpPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await guard('risks');
  const sp = await searchParams;
  const wanted = typeof sp.version === 'string' && sp.version ? sp.version : null;
  const archived = wanted ? await loadDuerpVersion(wanted) : null;
  const now = today();

  let doc: PrintDoc | null = null;
  let empty: string | null = null;
  if (wanted && !archived) {
    empty = `Version ${wanted} inconnue.`;
  } else if (archived && !archived.current) {
    const { snapshot } = archived;
    if (!snapshot.risks) {
      empty = `Version ${archived.version} archivée hors Vigie : aucun instantané n'est disponible dans l'application.`;
    } else {
      const units = snapshot.units ?? [...new Map(snapshot.risks.map((r) => [r.unitId, { id: r.unitId, label: r.unit, siteId: r.siteId, site: r.site }])).values()];
      doc = {
        label: `Version ${archived.version} (archivée)`,
        units, risks: snapshot.risks, actionInfo: null,
        meta: [
          ['Établissement', sitesOf(units)],
          ['Version', `${archived.version} · archivée${archived.archivedOn ? ` le ${fmtDate(archived.archivedOn)}` : ''}`],
          ['Mise à jour', fmtDate(archived.updatedOn)],
          ['Validée par', archived.validatedBy || '—'],
          ['CSE consulté le', archived.cseConsultedOn ? fmtDate(archived.cseConsultedOn) : '—'],
          ['Conservation', `${DUERP_RETENTION} (R. 4121-4)`],
          ['Objet', archived.comment || '—'],
          ['Édité le', fmtDate(now)],
        ],
      };
    }
  } else {
    const d = await loadDuerpPrint();
    if (!d.version) {
      empty = 'Aucune version du DUERP en vigueur.';
    } else {
      const v = d.version;
      doc = {
        label: `Version ${v.version} (en vigueur)`,
        units: d.units, risks: d.risks, actionInfo: d.actionInfo,
        meta: [
          ['Établissement', d.siteLabel ?? sitesOf(d.units)],
          ['Version', `${v.version} · en vigueur`],
          ['Mise à jour', fmtDate(v.updatedOn)],
          ['Prochaine mise à jour', fmtDate(v.nextUpdateOn)],
          ['Validée par', v.validatedBy || '—'],
          ['CSE consulté le', v.cseConsultedOn ? fmtDate(v.cseConsultedOn) : 'À renseigner'],
          ['Conservation', `${v.retention || DUERP_RETENTION} (R. 4121-4)`],
          ['Objet', v.comment || '—'],
          ['Édité le', fmtDate(now)],
        ],
      };
    }
  }

  const multiSite = !!doc && new Set(doc.units.map((u) => u.siteId)).size > 1;
  const info = doc?.actionInfo ?? null;

  return (
    <article className="pp-doc">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href="/risques" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} />Évaluation des risques</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>Pour le PDF : « Enregistrer au format PDF » dans la boîte d&apos;impression.</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · DUERP{doc ? ` · ${doc.label}` : ''}</div>
        <h1>Document unique d&apos;évaluation des risques professionnels</h1>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>Code du travail, articles R. 4121-1 à R. 4121-4</div>
        {doc && <Meta rows={doc.meta} />}
      </header>

      <section className="pp-section">
        <h2>Mise à disposition</h2>
        <DuerpAccessNotice />
      </section>

      {empty ? (
        <section className="pp-section"><p className="pp-empty">{empty}</p></section>
      ) : doc && (
        <>
          <section className="pp-section">
            <h2>Méthode de cotation</h2>
            <p className="pp-text">
              Cotation gravité (G1 à G4) × probabilité (P1 à P4), brute puis résiduelle après les mesures existantes. À partir de {RISK_ACTION_THRESHOLD}, une action
              de réduction est obligatoire et suivie dans le plan d&apos;actions unique.
            </p>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
              {RISK_LEVELS.map((l) => (
                <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: l.bg, border: '1px solid var(--color-divider)' }} />{l.label}
                </span>
              ))}
            </div>
          </section>

          {doc.units.length === 0 && <section className="pp-section"><p className="pp-empty">Aucune unité de travail sur ce site.</p></section>}
          {doc.units.map((u, i) => {
            const rows = doc.risks.filter((r) => r.unitId === u.id);
            return (
              <section key={u.id} className="pp-section">
                <h2><span className="pp-num">{i + 1}</span>{u.label}{multiSite ? ` · ${u.site}` : ''}</h2>
                {rows.length === 0 ? <p className="pp-empty">Aucun risque évalué.</p> : (
                  <table className="table pp-table">
                    <thead><tr><th>Danger</th><th>Situation dangereuse</th><th>Brut</th><th>Mesures existantes</th><th>Résiduel</th><th>Actions de prévention</th></tr></thead>
                    <tbody>
                      {rows.map((r, j) => (
                        <tr key={`${r.unitId}-${j}`}>
                          <td style={{ fontWeight: 500 }}>{r.hazard}</td>
                          <td>{r.situation}</td>
                          <td><Cotation g={r.gravity} p={r.probability} /></td>
                          <td>{r.existingMeasures || '—'}</td>
                          <td><Cotation g={r.residualGravity} p={r.residualProbability} /></td>
                          <td>
                            {!r.actions.length ? '—' : info ? r.actions.map((id) => {
                              const a = info[id];
                              return (
                                <div key={id} style={{ marginBottom: 3 }}>
                                  <span className="pp-nowrap">{id}</span>{a ? ` · ${a.title}` : ''}
                                  {a && <span className="pp-muted" style={{ display: 'block' }}>échéance {fmtDate(a.dueOn)} · {a.status}</span>}
                                </div>
                              );
                            }) : <span className="pp-nowrap">{r.actions.join(', ')}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
        </>
      )}

      <div className="pp-foot">Vigie · document unique{doc ? ` · ${doc.label.toLowerCase()}` : ''} · édité le {fmtDate(now)}</div>
    </article>
  );
}
