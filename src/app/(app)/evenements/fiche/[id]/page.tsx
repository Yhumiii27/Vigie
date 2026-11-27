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
import { getI18n } from '@/i18n/server';
import { labelT } from '@/i18n/labels';
import { fill, type T } from '@/i18n/translate';
import '../../../prevention/imprimer/print.css';

export async function generateMetadata({ params }: PageProps<'/evenements/fiche/[id]'>): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  return { title: fill(t('Event {id} · printable sheet'), { id: decodeURIComponent(id) }) };
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
const Text = ({ value, empty }: { value: string | null | undefined; empty: string }) =>
  (value ? <p className="pp-text">{value}</p> : <p className="pp-empty">{empty}</p>);

/** Analyse des causes de la méthode choisie, en texte (5M, arbre des causes, 5 pourquoi, 8D). */
function AnalysisText({ method, content, t }: { method: string; content: unknown; t: T }) {
  const none = <p className="pp-empty">{t('No analysis entered.')}</p>;
  const l = labelT(t);
  if (method === '5m') {
    const rows = (Array.isArray(content) ? content : []) as [string, string][];
    return rows.length ? <Meta rows={rows.map(([k, v]) => [k, v] as [string, ReactNode])} /> : none;
  }
  if (method === 'tree') {
    const nodes = readTree(content);
    return nodes.length
      ? <ul className="pp-text" style={{ margin: 0, listStyle: 'none', paddingLeft: 0 }}>{nodes.map(([lvl, t], i) => <li key={i} style={{ paddingLeft: lvl * 18 }}>– {t}</li>)}</ul>
      : none;
  }
  if (method === 'why') {
    const whys = readWhys(content);
    return whys.length ? <ol className="pp-text" style={{ margin: 0, paddingLeft: 22 }}>{whys.map((w, i) => <li key={i}>{w}</li>)}</ol> : none;
  }
  const { current, notes } = readD8(content);
  return (
    <Meta rows={D8_STEPS.map((s, i) => [l(s), notes[i] || (i < current ? t('Done#step') : i === current ? t('In progress') : '—')] as [string, ReactNode])} />
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
  const { t } = await getI18n();
  const l = labelT(t);
  const notEntered = t('Not entered.');
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const detail = await loadEventDetail(id);
  if (!detail) {
    return (
      <article className="pp-doc pp-doc-narrow">
        <h1 className="vg-sr-only">{t('Event sheet')}</h1>
        <MissingNotice closeHref="/evenements" />
      </article>
    );
  }
  const employee = isEmployee(role);
  const log = employee ? [] : await loadEventChangeLog(detail.event.id);
  const { event: e, actions, analyses, history, stepDates, accident, cpam, health, occupational, dismissal, attachments, zone } = detail;
  const methodLabel = METHODS.find(([k]) => k === e.analysisMethod)?.[1];
  const method = methodLabel ? l(methodLabel) : e.analysisMethod;
  let n = 0;
  const num = () => ++n;

  return (
    <article className="pp-doc pp-doc-narrow">
      <div className="pp-toolbar pp-noprint">
        {/* Lien HTML simple (navigation complète) : la feuille print.css ne doit pas rester chargée dans l'application. */}
        <a href={`/evenements?sel=${encodeURIComponent(e.id)}`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{fill(t('Event {id}'), { id: e.id })}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>{t('For the PDF: “Save as PDF” in the print dialog.')}</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>{t('Vigie · Events · ')}{l(e.typeLabel)}{e.type === 'AT' && e.commute ? t(' (commuting)') : ''}</div>
        <div className="pp-head-row">
          <h1>{e.id} · {e.title}</h1>
          <span>{l(e.status)}</span>
        </div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>{fill(t('Occurred on {date} · printed on {today}'), { date: fmtDate(e.occurredOn), today: fmtDate(today()) })}</div>
        {dismissal && <p className="pp-text">{fill(t('Dismissed on {date}'), { date: fmtDate(dismissal.on) })}{employee ? '' : fill(t(' by {name}'), { name: dismissal.by })}{dismissal.reason ? ` — ${dismissal.reason}` : ''}</p>}
      </header>

      <Section num={num()} title={t('Identification')}>
        <Meta rows={[
          [t('Date'), fmtDate(e.occurredOn)], [t('Location'), e.location], ...(zone ? [[t('Map zone'), zone.name] as [string, ReactNode]] : []),
          [t('Equipment'), e.equipment ?? '—'], [t('Reporter'), e.declarantLabel],
          ...(employee ? [] : [[t('Lead'), e.pilot], [t('Potential severity'), SEVERITY[e.severity] && l(SEVERITY[e.severity])], [t('Linked Keystone project'), e.keystoneProject ?? '—']] as [string, ReactNode][]),
        ]} />
      </Section>

      <Section num={num()} title={t('Description')}>
        <div className="pp-sub"><h3>{t('Description')}</h3><Text value={e.description} empty={notEntered} /></div>
        <div className="pp-sub"><h3>{t('Immediate measures')}</h3><Text value={e.immediateMeasures} empty={notEntered} /></div>
      </Section>

      {accident && (
        <Section num={num()} title={t('Work accident')}>
          <Meta rows={[
            [t('Victim'), `${accident.victim}${accident.victimKind !== '—' ? ` · ${l(accident.victimKind)}` : ''}`],
            [t('Time'), accident.occurredTime ?? '—'], [t('Working hours'), accident.workSchedule ?? '—'],
            [t('Victim’s activity'), accident.activity ?? '—'], [t('Third party involved'), accident.thirdParty ?? t('None#m')],
            // Données de santé (HEALTH_LABELS) : rôles habilités seulement.
            ...(health
              ? [
                [t('Injury'), e.injury === 'arret' && e.lostDays != null ? `${l(injuryLabel(e.injury))} · ${fill(e.lostDays > 1 ? t('{n} days lost') : t('{n} day lost'), { n: e.lostDays })}` : l(injuryLabel(e.injury))],
                [t('Lesions (nature · site)'), e.lesionNature || e.lesionSite ? `${e.lesionNature ?? '—'} · ${e.lesionSite ?? '—'}` : '—'],
                [t('Care given'), e.careGiven ?? '—'],
                [t('CPAM declaration'), cpam?.label ?? '—'],
              ]
              : [[t('Injury, lesions, care, declaration'), l(HEALTH_RESTRICTED)]]) as [string, ReactNode][],
          ]} />
          <div className="pp-sub"><h3>{t('Circumstances')}</h3><Text value={accident.circumstances} empty={notEntered} /></div>
          <div className="pp-sub"><h3>{t('Witnesses')}</h3><Text value={accident.witnesses} empty={t('No witness given.')} /></div>
        </Section>
      )}

      {occupational && (
        <Section num={num()} title={t('Occupational disease')}>
          <Meta rows={[
            [t('Victim'), occupational.victim], [t('Table#mp'), occupational.table ?? '—'], [t('Declared disease'), occupational.disease ?? '—'],
            [t('Initial medical certificate'), occupational.certificateOn ? fmtDate(occupational.certificateOn) : '—'],
            [t('Declaration received from the CPAM'), occupational.informedOn ? fmtDate(occupational.informedOn) : '—'],
            [t('Employer questionnaire'), occupational.questionnaire.label],
          ]} />
        </Section>
      )}

      {!employee && (
        <Section num={num()} title={`${t('Root cause analysis')} · ${method}`}>
          <AnalysisText method={e.analysisMethod} content={analyses[e.analysisMethod]} t={t} />
        </Section>
      )}

      <Section num={num()} title={employee ? t('Follow-up given') : t('Actions')}>
        {actions.length ? (
          <table className="table pp-table">
            <thead><tr><th scope="col">{t('No.')}</th><th scope="col">{t('Action')}</th>{!employee && <th scope="col">{t('Owner')}</th>}<th scope="col">{t('Target date')}</th><th scope="col">{t('Progress')}</th></tr></thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id}>
                  <td className="pp-nowrap">{a.id}</td><td>{a.label}</td>{!employee && <td>{a.pilot}</td>}
                  <td className="pp-nowrap">{fmtDate(a.dueOn)}</td><td>{l(employee ? a.avancement : a.statusLabel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="pp-empty">{t('No action decided yet.')}</p>}
      </Section>

      <Section num={num()} title={t('Progress')}>
        <Meta rows={EVENT_STEPS.map((s, i) => [l(s), stepDates[i] ? fmtDate(stepDates[i]!) : i <= e.step ? t('Done#step') : '—'] as [string, ReactNode])} />
        {attachments.length > 0 && <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>{t('Attachments: ')}{attachments.map((f) => f.name).join(', ')}</p>}
      </Section>

      {!employee && (
        <Section num={num()} title={t('History')}>
          {history.length || log.length ? (
            <table className="table pp-table">
              <thead><tr><th scope="col">{t('Date')}</th><th scope="col">{t('By')}</th><th scope="col">{t('Stage or change')}</th></tr></thead>
              <tbody>
                {[
                  ...history.map((h) => ({ key: `s${h.id}`, at: h.at, who: h.by, text: `${l(h.label)} : ${l(h.from)} → ${l(h.to)}${h.reason ? `${t(' · reason: ')}${h.reason}` : ''}`, details: [] as { field: string; from: string | null; to: string | null }[] })),
                  ...log.map((x) => ({ key: `l${x.id}`, at: x.at, who: x.who, text: `${x.summary}${x.reason ? `${t(' · reason: ')}${x.reason}` : ''}`, details: x.details })),
                ].sort((a, b) => b.at.localeCompare(a.at)).map((r) => (
                  <tr key={r.key}>
                    <td className="pp-nowrap">{fmtParisDateTime(new Date(r.at))}</td>
                    <td>{r.who}</td>
                    <td>{r.text}{r.details.map((x, i) => <div key={i} className="pp-muted">{x.field} : {x.from ?? '—'} → {x.to ?? '—'}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="pp-empty">{t('No change recorded.')}</p>}
        </Section>
      )}
      <p className="pp-foot">
        {health && (e.type === 'AT' || e.type === 'MP')
          ? t('Confidential document: health data reserved to the QHSE coordinator and management.')
          : fill(t('Document printed from Vigie on {date}: the online sheet is authoritative.'), { date: fmtDate(today()) })}
      </p>
    </article>
  );
}
