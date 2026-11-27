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
import { getI18n } from '@/i18n/server';
import { labelT } from '@/i18n/labels';
import { fill } from '@/i18n/translate';
import '../../../prevention/imprimer/print.css';

export async function generateMetadata({ params }: PageProps<'/actions/fiche/[id]'>): Promise<Metadata> {
  const [{ id }, { t }] = await Promise.all([params, getI18n()]);
  return { title: fill(t('Action {id} · printable sheet'), { id: decodeURIComponent(id) }) };
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
const Text = ({ value, empty }: { value: string | null; empty: string }) =>
  (value ? <p className="pp-text">{value}</p> : <p className="pp-empty">{empty}</p>);

/**
 * Fiche imprimable d'une action QSE (IMP-07) : problème, action, planification, source, vérification, coûts, fil de
 * commentaires, preuves (noms) et historique. Mêmes droits que la fiche (loadActionDetail : plan du site sélectionné, ou ses
 * propres actions sur tout le périmètre ; Salarié : les siennes) ; ni texte d'un commentaire retiré, ni donnée de santé
 * (aucune n'est portée par une action). Action introuvable ou hors du site : bandeau commun, rien n'est révélé (UX-13).
 */
export default async function ActionPrintPage({ params }: PageProps<'/actions/fiche/[id]'>) {
  await guard('actions');
  const { t } = await getI18n();
  const l = labelT(t);
  const reason = (r: string) => l(r).toLowerCase();
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const { payload } = await loadActionDetail(id);
  if (!payload) {
    return (
      <article className="pp-doc pp-doc-narrow">
        <h1 className="vg-sr-only">{t('Action sheet')}</h1>
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
        <a href={actionHref(d.id)} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{fill(t('Action {id}'), { id: d.id })}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="pp-muted" style={{ fontSize: 11.5 }}>{t('For the PDF: “Save as PDF” in the print dialog.')}</span>
          <PrintButton />
        </span>
      </div>

      <header className="pp-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>{t('Vigie · QSE action plan · action sheet')}</div>
        <div className="pp-head-row">
          <h1>{d.id} · {d.label}</h1>
          <span>{l(d.statusLabel)}</span>
        </div>
        <div className="pp-muted" style={{ fontSize: 12.5 }}>{l(d.sourceLabel)} · {d.site} · {fill(t('printed on {date}#f'), { date: fmtDate(today()) })}</div>
      </header>

      <Section num={1} title={t('Problem')}><Text value={d.problem} empty={t('To complete.')} /></Section>
      <Section num={2} title={t('Action')}><Text value={d.detail} empty={t('No detail entered.')} /></Section>

      <Section num={3} title={t('Planning')}>
        <Meta rows={[
          [t('Opened on'), d.opened],
          [t('Owner'), `${d.pilot}${d.pilotLeft ? t(' (left the workforce)') : ''}`],
          [t('Progress'), l(d.avancement)],
          [t('Priority'), d.priorityLabel ? l(d.priorityLabel) : t('To complete')],
          [t('Domain'), d.domainLabel ? l(d.domainLabel) : t('To complete')],
          [t('Risk level'), d.riskLevelLabel ? l(d.riskLevelLabel) : '—'],
          [t('Site'), d.site],
          [t('Target date'), `${fmtDate(d.dueOn)}${d.late ? fill(t(' · {n} d late'), { n: d.lateDays }) : ''}`],
          ...(d.rescheduled ? [[t('Initial target date'), fmtDate(d.initialDueOn)] as [string, ReactNode]] : []),
          [t('Planned verification'), d.verifyDueOn ? `${fmtDate(d.verifyDueOn)}${d.verifyLate ? t(' · overdue#verification') : ''}` : '—'],
          [t('Actual date'), d.doneOn ? fmtDate(d.doneOn) : '—'],
          ...(abandoned ? [[t('Abandoned on'), d.cancelledOn ? fmtDate(d.cancelledOn) : '—'], [t('By'), d.cancelledBy ?? '—'], [t('Reason'), d.cancelReason ?? '—']] as [string, ReactNode][] : []),
        ]} />
      </Section>

      <Section num={4} title={t('Source')}>
        <Meta rows={[
          [t('Source'), l(d.sourceLabel)],
          ...(d.originRef ? [[t('Origin reference'), d.originRef] as [string, ReactNode]] : []),
          ...(d.follows ? [[t('Follow-up of'), `${d.follows.id}${d.follows.label ? ` · ${d.follows.label}` : ''} (${reason(FOLLOW_REASONS[d.follows.reason])})`] as [string, ReactNode]] : []),
          ...d.followUps.map((f) => [t('Followed up by'), `${f.id} · ${f.label} (${reason(FOLLOW_REASONS[f.reason])}) · ${l(f.statusLabel)}`] as [string, ReactNode]),
        ]} />
        {d.sources.length > 0 ? (
          <ul className="pp-text" style={{ margin: 0, paddingLeft: 18 }}>
            {d.sources.map((s, i) => <li key={`${s.kind}-${i}`}>{s.label}{s.detail ? ` · ${s.detail}` : ''}</li>)}
          </ul>
        ) : <p className="pp-empty">{t('No linked item.')}</p>}
      </Section>

      <Section num={5} title={t('Verification')}>
        {verified ? (
          <>
            <Meta rows={[
              [t('Verified on'), d.closedOn ? fmtDate(d.closedOn) : '—'],
              [t('Nature'), d.verifyMethodLabel ? l(d.verifyMethodLabel) : '—'],
              [t('Result'), d.effective == null ? '—' : d.effective ? t('Effective') : t('Not effective')],
              [t('Verified by'), d.verifiedBy ?? '—'],
              ...(d.newRisk ? [[t('New risk'), t('Generated#risk')] as [string, ReactNode]] : []),
            ]} />
            <Text value={d.efficacyNote} empty={t('No finding recorded.')} />
          </>
        ) : <p className="pp-empty">{t('Action not verified.')}</p>}
      </Section>

      <Section num={6} title={t('Time logged and costs')}>
        <Meta rows={[[t('Time logged'), fmtHours(d.hours)], [t('Estimated cost'), fmtEuros(d.estimatedCost)], [t('Actual cost'), fmtEuros(d.actualCost)]]} />
      </Section>

      <Section num={7} title={t('Action thread')}>
        {d.comments.length ? d.comments.map((c) => (
          <div key={c.id} className="pp-sub">
            <h3>{c.author}{c.authorRole ? ` · ${c.authorRole}` : ''} · {c.atLabel}</h3>
            {c.withdrawn
              ? <p className="pp-empty">{fill(t('Comment withdrawn on {date} by {name} · reason: {reason}'), { date: c.withdrawn.atLabel, name: c.withdrawn.by, reason: c.withdrawn.reason })}</p>
              : <Text value={c.body} empty="" />}
            {c.files.length > 0 && <p className="pp-muted" style={{ margin: 0, fontSize: 12 }}>{t('Files: ')}{c.files.map((f) => f.name).join(', ')}</p>}
          </div>
        )) : <p className="pp-empty">{t('No comment.')}</p>}
      </Section>

      <Section num={8} title={t('Evidence')}>
        {d.files.length ? (
          <ul className="pp-text" style={{ margin: 0, paddingLeft: 18 }}>
            {d.files.map((f) => <li key={f.id}>{f.name}{f.commentWithdrawn ? t(' (comment withdrawn)') : ''}</li>)}
          </ul>
        ) : <p className="pp-empty">{t('No evidence attached.')}</p>}
      </Section>

      <Section num={9} title={t('History')}>
        {d.history.length ? (
          <table className="table pp-table">
            <thead><tr><th scope="col">{t('Date')}</th><th scope="col">{t('By')}</th><th scope="col">{t('Change')}</th></tr></thead>
            <tbody>
              {d.history.map((e) => (
                <tr key={e.id}>
                  <td className="pp-nowrap">{fmtParisDateTime(new Date(e.at))}</td>
                  <td>{e.who}</td>
                  <td>
                    {e.summary}
                    {e.reason && <>{t(' · reason: ')}{e.reason}</>}
                    {e.details.map((x, i) => <div key={i} className="pp-muted">{x.field} : {x.from ?? '—'} → {x.to ?? '—'}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="pp-empty">{t('No change recorded.')}</p>}
      </Section>
      <p className="pp-foot">{fill(t('Document printed from Vigie on {date}: the online sheet is authoritative.'), { date: fmtDate(today()) })}</p>
    </article>
  );
}
