import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { MissingNotice } from '@/components/ui';
import { fmtDate, fmtParisDateTime } from '@/lib/dates';
import { D8_STEPS, EVENT_STEPS, METHODS, SEVERITY, isEmployee } from '@/lib/domain';
import { guard } from '@/lib/guard';
import { loadEventChangeLog, loadEventDetail } from '@/lib/data/events';
import { HEALTH_RESTRICTED, injuryLabel, readD8, readTree, readWhys } from '@/lib/rules/events';
import { today } from '@/lib/today';
import '../../../prevention/imprimer/print.css';

export async function generateMetadata({ params }: PageProps<'/evenements/fiche/[id]'>): Promise<Metadata> {
  const { id } = await params;
  return { title: `Événement ${decodeURIComponent(id)} · fiche imprimable` };
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
const Text = ({ value, empty = 'Non renseigné.' }: { value: string | null | undefined; empty?: string }) =>
  (value ? <p className="pp-text">{value}</p> : <p className="pp-empty">{empty}</p>);

/** Analyse des causes de la méthode choisie, en texte (5M, arbre des causes, 5 pourquoi, 8D). */
function AnalysisText({ method, content }: { method: string; content: unknown }) {
  if (method === '5m') {
    const rows = (Array.isArray(content) ? content : []) as [string, string][];
    return rows.length ? <Meta rows={rows.map(([k, v]) => [k, v] as [string, ReactNode])} /> : <p className="pp-empty">Aucune analyse saisie.</p>;
  }
  if (method === 'tree') {
    const nodes = readTree(content);
    return nodes.length
      ? <ul className="pp-text" style={{ margin: 0, listStyle: 'none', paddingLeft: 0 }}>{nodes.map(([lvl, t], i) => <li key={i} style={{ paddingLeft: lvl * 18 }}>– {t}</li>)}</ul>
      : <p className="pp-empty">Aucune analyse saisie.</p>;
  }
  if (method === 'why') {
    const whys = readWhys(content);
    return whys.length ? <ol className="pp-text" style={{ margin: 0, paddingLeft: 22 }}>{whys.map((t, i) => <li key={i}>{t}</li>)}</ol> : <p className="pp-empty">Aucune analyse saisie.</p>;
  }
  const { current, notes } = readD8(content);
  return (
    <Meta rows={D8_STEPS.map((s, i) => [s, notes[i] || (i < current ? 'Fait' : i === current ? 'En cours' : '—')] as [string, ReactNode])} />
  );
}

/**
 * Fiche imprimable d'un événement (IMP-07) : identification, description, accident du travail ou maladie professionnelle,
 * analyse des causes, actions, étapes et journal. Mêmes droits que la fiche (loadEventDetail : site sélectionné, Salarié :
 * ses signalements nominatifs, maladie professionnelle aux seuls rôles habilités) ; données de santé pour l'animateur QHSE
 * et la direction seulement (« Données restreintes » sinon, consultation tracée par loadEventDetail) ; pour le Salarié, la
 * fiche du déclarant (ni pilote, ni analyse, ni historiques). Synthèse de la DAT : page distincte (HEALTH_PAGES).
 */
export default async function EventPrintPage({ params }: PageProps<'/evenements/fiche/[id]'>) {
  const { role } = await guard('events');
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const detail = await loadEventDetail(id);
  if (!detail) {
    return (
      <article className="pp-doc pp-doc-narrow">
        <h1 className="vg-sr-only">Fiche d&apos;événement</h1>
        <MissingNotice closeHref="/evenements" />
      </article>
    );
  }
  const employee = isEmployee(role);
  const log = employee ? [] : await loadEventChangeLog(detail.event.id);
  const { event: e, actions, analyses, history, stepDates, accident, cpam, health, occupational, dismissal, attachments, zone } = detail;
  const method = METHODS.find(([k]) => k === e.analysisMethod)?.[1] ?? e.analysisMethod;
  let n = 0;
  const num = () => ++n;

  return (
    <article className="pp-doc pp-doc-narrow">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href={`/evenements?sel=${encodeURIComponent(e.id)}`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />Événement {e.id}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>Pour le PDF : « Enregistrer au format PDF » dans la boîte d&apos;impression.</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>Vigie · Événements · {e.typeLabel}{e.type === 'AT' && e.commute ? ' de trajet' : ''}</div>
        <div className="pp-head-row">
          <h1>{e.id} · {e.title}</h1>
          <span>{e.status}</span>
        </div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>Survenu le {fmtDate(e.occurredOn)} · éditée le {fmtDate(today())}</div>
        {dismissal && <p className="pp-text">Classé sans suite le {fmtDate(dismissal.on)}{employee ? '' : ` par ${dismissal.by}`}{dismissal.reason ? ` — ${dismissal.reason}` : ''}</p>}
      </header>

      <Section num={num()} title="Identification">
        <Meta rows={[
          ['Date', fmtDate(e.occurredOn)], ['Lieu', e.location], ...(zone ? [['Zone de la carte', zone.name] as [string, ReactNode]] : []),
          ['Équipement', e.equipment ?? '—'], ['Déclarant', e.declarantLabel],
          ...(employee ? [] : [['Pilote', e.pilot], ['Gravité potentielle', SEVERITY[e.severity]], ['Projet Keystone lié', e.keystoneProject ?? '—']] as [string, ReactNode][]),
        ]} />
      </Section>

      <Section num={num()} title="Description">
        <div className="pp-sub"><h3>Description</h3><Text value={e.description} /></div>
        <div className="pp-sub"><h3>Mesures immédiates</h3><Text value={e.immediateMeasures} /></div>
      </Section>

      {accident && (
        <Section num={num()} title="Accident du travail">
          <Meta rows={[
            ['Victime', `${accident.victim}${accident.victimKind !== '—' ? ` · ${accident.victimKind}` : ''}`],
            ['Heure', accident.occurredTime ?? '—'], ['Horaire de travail', accident.workSchedule ?? '—'],
            ['Activité de la victime', accident.activity ?? '—'], ['Tiers impliqué', accident.thirdParty ?? 'Aucun'],
            // Données de santé (HEALTH_LABELS) : rôles habilités seulement.
            ...(health
              ? [
                ['Blessure', e.injury === 'arret' && e.lostDays != null ? `${injuryLabel(e.injury)} · ${e.lostDays} j perdu${e.lostDays > 1 ? 's' : ''}` : injuryLabel(e.injury)],
                ['Lésions (nature · siège)', e.lesionNature || e.lesionSite ? `${e.lesionNature ?? '—'} · ${e.lesionSite ?? '—'}` : '—'],
                ['Soins dispensés', e.careGiven ?? '—'],
                ['Déclaration CPAM', cpam?.label ?? '—'],
              ]
              : [['Blessure, lésions, soins, déclaration', HEALTH_RESTRICTED]]) as [string, ReactNode][],
          ]} />
          <div className="pp-sub"><h3>Circonstances</h3><Text value={accident.circumstances} /></div>
          <div className="pp-sub"><h3>Témoins</h3><Text value={accident.witnesses} empty="Aucun témoin indiqué." /></div>
        </Section>
      )}

      {occupational && (
        <Section num={num()} title="Maladie professionnelle">
          <Meta rows={[
            ['Victime', occupational.victim], ['Tableau', occupational.table ?? '—'], ['Maladie déclarée', occupational.disease ?? '—'],
            ['Certificat médical initial', occupational.certificateOn ? fmtDate(occupational.certificateOn) : '—'],
            ['Déclaration reçue de la CPAM', occupational.informedOn ? fmtDate(occupational.informedOn) : '—'],
            ['Questionnaire employeur', occupational.questionnaire.label],
          ]} />
        </Section>
      )}

      {!employee && (
        <Section num={num()} title={`Analyse des causes · ${method}`}>
          <AnalysisText method={e.analysisMethod} content={analyses[e.analysisMethod]} />
        </Section>
      )}

      <Section num={num()} title={employee ? 'Suite donnée' : 'Actions'}>
        {actions.length ? (
          <table className="table pp-table">
            <thead><tr><th scope="col">N°</th><th scope="col">Action</th>{!employee && <th scope="col">Responsable</th>}<th scope="col">Date cible</th><th scope="col">Avancement</th></tr></thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id}>
                  <td className="pp-nowrap">{a.id}</td><td>{a.label}</td>{!employee && <td>{a.pilot}</td>}
                  <td className="pp-nowrap">{fmtDate(a.dueOn)}</td><td>{employee ? a.avancement : a.statusLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="pp-empty">Aucune action décidée pour l&apos;instant.</p>}
      </Section>

      <Section num={num()} title="Avancement">
        <Meta rows={EVENT_STEPS.map((s, i) => [s, stepDates[i] ? fmtDate(stepDates[i]!) : i <= e.step ? 'Fait' : '—'] as [string, ReactNode])} />
        {attachments.length > 0 && <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>Pièces jointes : {attachments.map((f) => f.name).join(', ')}</p>}
      </Section>

      {!employee && (
        <Section num={num()} title="Historique">
          {history.length || log.length ? (
            <table className="table pp-table">
              <thead><tr><th scope="col">Date</th><th scope="col">Par</th><th scope="col">Étape ou modification</th></tr></thead>
              <tbody>
                {[
                  ...history.map((h) => ({ key: `s${h.id}`, at: h.at, who: h.by, text: `${h.label} : ${h.from} → ${h.to}${h.reason ? ` · motif : ${h.reason}` : ''}`, details: [] as { field: string; from: string | null; to: string | null }[] })),
                  ...log.map((x) => ({ key: `l${x.id}`, at: x.at, who: x.who, text: `${x.summary}${x.reason ? ` · motif : ${x.reason}` : ''}`, details: x.details })),
                ].sort((a, b) => b.at.localeCompare(a.at)).map((r) => (
                  <tr key={r.key}>
                    <td className="pp-nowrap">{fmtParisDateTime(new Date(r.at))}</td>
                    <td>{r.who}</td>
                    <td>{r.text}{r.details.map((x, i) => <div key={i} className="pp-muted">{x.field} : {x.from ?? '—'} → {x.to ?? '—'}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="pp-empty">Aucune modification enregistrée.</p>}
        </Section>
      )}
      <p className="pp-foot">
        {health && (e.type === 'AT' || e.type === 'MP')
          ? 'Document confidentiel : données de santé réservées à l’animateur QHSE et à la direction.'
          : `Document édité depuis Vigie le ${fmtDate(today())} : la fiche en ligne fait foi.`}
      </p>
    </article>
  );
}
