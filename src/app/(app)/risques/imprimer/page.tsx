import type { Metadata } from 'next';
import { getI18n } from '@/i18n/server';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { DuerpAccessNotice } from '@/components/risks/AccessNotice';
import { fmtDate } from '@/lib/dates';
import { RISK_ACTION_THRESHOLD, RISK_LEVELS, riskLevel } from '@/lib/domain';
import { labelT } from '@/i18n/labels';
import { fill, type T } from '@/i18n/translate';
import { guard } from '@/lib/guard';
import { DUERP_RETENTION, loadDuerpPrint, loadDuerpVersion, type PrintAction, type RiskRecord } from '@/lib/data/risks';
import { today } from '@/lib/today';
import '../../prevention/imprimer/print.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t('Occupational risk assessment document') };
}

type Unit = { id: string; label: string; siteId: string | null; site: string };
type PrintDoc = { meta: [string, ReactNode][]; units: Unit[]; risks: RiskRecord[]; actionInfo: Record<string, PrintAction> | null; label: string };

const Meta = ({ rows }: { rows: [string, ReactNode][] }) => (
  <dl className="pp-meta">
    {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
  </dl>
);

function Cotation({ g, p, t }: { g: number; p: number; t: T }) {
  const n = g * p;
  return (
    <>
      <span className="pp-nowrap">G{g} × P{p} = {n}</span>
      <span className="pp-muted" style={{ display: 'block' }}>{labelT(t)(RISK_LEVELS[riskLevel(n)].label).replace(/\s.*$/, '')}</span>
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
  const [sp, { t }] = await Promise.all([searchParams, getI18n()]);
  const lt = labelT(t);
  // Durée de conservation (« 40 ans ») : valeur par défaut de Vigie, rendue par t() ; une valeur saisie s'affiche telle quelle.
  const retention = (v?: string | null) => (!v || v === DUERP_RETENTION ? t('40 years') : v);
  const wanted = typeof sp.version === 'string' && sp.version ? sp.version : null;
  const archived = wanted ? await loadDuerpVersion(wanted) : null;
  const now = today();

  let doc: PrintDoc | null = null;
  let empty: string | null = null;
  if (wanted && !archived) {
    empty = fill(t('Version {v} unknown.'), { v: wanted });
  } else if (archived && !archived.current) {
    const { snapshot } = archived;
    if (!snapshot.risks) {
      empty = fill(t('Version {v} archived outside Vigie: no snapshot is available in the application.'), { v: archived.version });
    } else {
      const units = snapshot.units ?? [...new Map(snapshot.risks.map((r) => [r.unitId, { id: r.unitId, label: r.unit, siteId: r.siteId, site: r.site }])).values()];
      doc = {
        label: fill(t('Version {v} (archived)'), { v: archived.version }),
        units, risks: snapshot.risks, actionInfo: null,
        meta: [
          [t('Establishment'), sitesOf(units)],
          [t('Version'), archived.archivedOn ? fill(t('{v} · archived on {date}'), { v: archived.version, date: fmtDate(archived.archivedOn) }) : fill(t('{v} · archived'), { v: archived.version })],
          [t('Updated#date'), fmtDate(archived.updatedOn)],
          [t('Validated by'), archived.validatedBy || '—'],
          [t('CSE consulted on'), archived.cseConsultedOn ? fmtDate(archived.cseConsultedOn) : '—'],
          [t('Retention'), `${retention(null)} (R. 4121-4)`],
          [t('Purpose'), archived.comment || '—'],
          [t('Printed on'), fmtDate(now)],
        ],
      };
    }
  } else {
    const d = await loadDuerpPrint();
    if (!d.version) {
      empty = t('No version of the DUERP in force.');
    } else {
      const v = d.version;
      doc = {
        label: fill(t('Version {v} (in force)'), { v: v.version }),
        units: d.units, risks: d.risks, actionInfo: d.actionInfo,
        meta: [
          [t('Establishment'), d.siteLabel ?? sitesOf(d.units)],
          [t('Version'), fill(t('{v} · in force'), { v: v.version })],
          [t('Updated#date'), fmtDate(v.updatedOn)],
          [t('Next update'), fmtDate(v.nextUpdateOn)],
          [t('Validated by'), v.validatedBy || '—'],
          [t('CSE consulted on'), v.cseConsultedOn ? fmtDate(v.cseConsultedOn) : t('To be filled in')],
          [t('Retention'), `${retention(v.retention)} (R. 4121-4)`],
          [t('Purpose'), v.comment || '—'],
          [t('Printed on'), fmtDate(now)],
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
        <a href="/risques" className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Risk assessment')}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>{t('For a PDF: “Save as PDF” in the print dialog.')}</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>{t('Vigie · DUERP')}{doc ? ` · ${doc.label}` : ''}</div>
        <h1>{t('Occupational risk assessment document')}</h1>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>{t('Labour code, articles R. 4121-1 to R. 4121-4')}</div>
        {doc && <Meta rows={doc.meta} />}
      </header>

      <section className="pp-section">
        <h2>{t('Availability')}</h2>
        <DuerpAccessNotice />
      </section>

      {empty ? (
        <section className="pp-section"><p className="pp-empty">{empty}</p></section>
      ) : doc && (
        <>
          <section className="pp-section">
            <h2>{t('Rating method')}</h2>
            <p className="pp-text">
              {fill(t('Rating severity (G1 to G4) × probability (P1 to P4), gross then residual after the existing measures. From {n}, a reduction action is mandatory and followed in the single action plan.'), { n: RISK_ACTION_THRESHOLD })}
            </p>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
              {RISK_LEVELS.map((l) => (
                <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: l.bg, border: '1px solid var(--color-divider)' }} />{lt(l.label)}
                </span>
              ))}
            </div>
          </section>

          {doc.units.length === 0 && <section className="pp-section"><p className="pp-empty">{t('No work unit on this site.')}</p></section>}
          {doc.units.map((u, i) => {
            const rows = doc.risks.filter((r) => r.unitId === u.id);
            return (
              <section key={u.id} className="pp-section">
                <h2><span className="pp-num">{i + 1}</span>{u.label}{multiSite ? ` · ${u.site}` : ''}</h2>
                {rows.length === 0 ? <p className="pp-empty">{t('No risk assessed.')}</p> : (
                  <table className="table pp-table">
                    <thead><tr><th>{t('Hazard')}</th><th>{t('Hazardous situation')}</th><th>{t('Gross')}</th><th>{t('Existing measures')}</th><th>{t('Residual')}</th><th>{t('Prevention actions')}</th></tr></thead>
                    <tbody>
                      {rows.map((r, j) => (
                        <tr key={`${r.unitId}-${j}`}>
                          <td style={{ fontWeight: 500 }}>{r.hazard}</td>
                          <td>{r.situation}</td>
                          <td><Cotation g={r.gravity} p={r.probability} t={t} /></td>
                          <td>{r.existingMeasures || '—'}</td>
                          <td><Cotation g={r.residualGravity} p={r.residualProbability} t={t} /></td>
                          <td>
                            {!r.actions.length ? '—' : info ? r.actions.map((id) => {
                              const a = info[id];
                              return (
                                <div key={id} style={{ marginBottom: 3 }}>
                                  <span className="pp-nowrap">{id}</span>{a ? ` · ${a.title}` : ''}
                                  {a && <span className="pp-muted" style={{ display: 'block' }}>{fill(t('target date {date} · {status}'), { date: fmtDate(a.dueOn), status: lt(a.status) })}</span>}
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

      <div className="pp-foot">{t('Vigie · single document')}{doc ? ` · ${doc.label.toLowerCase()}` : ''}{fill(t(' · printed on {date}'), { date: fmtDate(now) })}</div>
    </article>
  );
}
