import type { ReactNode } from 'react';
import { PrintButton } from '@/components/PrintButton';
import { SKILL_SOON_DAYS } from '@/lib/horizons';
import { CERT_TONE_LABELS, certDot, type CertTone } from '@/lib/rules/audits';
import { fmtDelta } from '@/lib/rules/self-assessment';
import { Dot, ToneTag } from '@/components/ui';
import { daysBetween, fmtDate, monthName, yearOf } from '@/lib/dates';
import { TONE, type Role } from '@/lib/domain';
import type { DossierFinding, ReviewDossierPage, ReviewRecordOnly, StoredDossier } from '@/lib/data/review';
import {
  ActionRefs, ActionStatus, ActionTable, Blank, Empty, FollowUpTable, Kpi, PyramidRow, RecordText, Ref, ScrollTable, Section,
  capitalize, dossierFindingActions, evalCount, fmtNum, fmtPct, followUpAside, fromMonth, plural, sectionCounter,
} from './dossier-parts';
import { DEFAULT_LANG, fill, makeT, type T } from '@/i18n/translate';

/**
 * Contenu du dossier : calculé (préparatoire), figé à la saisie du compte rendu (dossier de séance), figé au visa
 * (instantané), ou compte rendu seul (revue antérieure à Vigie). Chaque section vérifie ses données : un instantané d'un
 * format antérieur reste lisible (section 1 « previousActions » des instantanés de version 1).
 */
type DossierData = ReviewRecordOnly & Partial<Omit<StoredDossier, keyof ReviewRecordOnly>>;

const BLANK_DECISIONS = 3;

export function DossierView({ page, role, notice, t = makeT(DEFAULT_LANG) }: {
  page: Exclude<ReviewDossierPage, { mode: 'none' | 'cancelled' }>; role: Role;
  /** Bandeau sous la barre d'outils (lien ?revue= vers une revue inconnue, UX-13). */
  notice?: ReactNode;
  /** Traducteur de la requête (`getI18n()` de la page) ; français par défaut (rendu des essais). */
  t?: T;
}) {
  const d: DossierData = page.mode === 'record' ? page.record : page.dossier;
  const h = d.header;
  const r = d.record;
  // Date d'arrêt des indicateurs (fin de la période examinée) : retards, échéances ; la séance une fois passée (AUD-06).
  const asOf = page.mode === 'record' ? page.now : page.asOf || h.to;
  const atSeance = asOf === h.reviewOn;
  const held = h.status !== 'planifiee';
  const n = sectionCounter();
  // Plan d'actions : par source (dossier courant), ou par origine (dossier figé avant la refonte des actions, lu tel quel).
  const actionRows = d.actions?.bySource ?? d.actions?.byOrigin;
  const others = page.reviews.filter((x) => x.id !== page.review.id);
  const kind = h.kind.replace(/^Revue\s+/i, '').toLowerCase();
  const done = d.checklist.filter((c) => c.done).length;
  const participants = [...(r.participants ?? []), r.externalParticipants].filter(Boolean);

  const stopped = fill(atSeance ? t('indicators set at the meeting of {date}') : t('indicators set on {date}'), { date: fmtDate(asOf) });
  const taken = (on: string, by: string) => fill(t('on {date}'), { date: on ? fmtDate(on) : '—' }) + (by ? fill(t(' by {name}'), { name: by }) : '');
  const setAtSeance = asOf < (page.mode === 'record' ? asOf : page.now) ? fill(t(', set at the meeting of {date}'), { date: fmtDate(asOf) }) : '';
  const banner = page.mode === 'snapshot'
    ? { icon: 'ph-lock-simple', tone: 'ok' as const, text: `${fill(t('File frozen at the sign-off {taken}'), { taken: taken(page.takenOn, page.takenBy) })} · ${stopped}` }
    : page.mode === 'seance'
      ? { icon: 'ph-lock-simple-open', tone: 'accent' as const, text: `${fill(t('Meeting file frozen {taken}'), { taken: taken(page.takenOn, '') })} · ${stopped} · ${t('minutes editable until the sign-off')}` }
      : page.mode === 'record'
        ? { icon: 'ph-archive', tone: 'neutral' as const, text: t('Review earlier than Vigie · file not archived') }
        : { icon: 'ph-arrows-clockwise', tone: 'warn' as const, text: fill(t('Preparatory file · indicators computed on {date}'), { date: fmtDate(page.now) }) + setAtSeance };

  return (
    <main className="rd-doc">
      <div className="rd-toolbar rd-noprint">
        {/* Liens HTML simples (navigation complète) : la feuille globale dossier.css, et sa règle @page, ne doit pas rester chargée dans l'application. */}
        <a href={`/audits?annee=${yearOf(h.reviewOn)}&revue=${page.review.id}#revue`} className="btn btn-ghost vg-btn-sm"><i className="ph ph-arrow-left" style={{ fontSize: 13 }} aria-hidden />{t('Audits and certifications')}</a>
        <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span className="rd-muted" style={{ fontSize: 11.5 }}>{t('For the PDF: “Save as PDF” in the print dialog.')}</span>
          <PrintButton />
        </span>
      </div>
      {notice && <div className="rd-noprint">{notice}</div>}
      <div className="rd-toolbar rd-noprint">
        <ToneTag tone={banner.tone} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i className={`ph ${banner.icon}`} style={{ fontSize: 12 }} aria-hidden />{banner.text}</ToneTag>
        {others.length > 0 && (
          <nav aria-label={t('Other reviews')} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, fontSize: 12 }}>
            <span className="rd-muted">{t('Other reviews:')}</span>
            {others.map((o) => (
              <a key={o.id} href={`/revue-de-direction?revue=${o.id}`} className="rd-link" title={o.statusLabel}>{o.kindShort} {fmtDate(o.reviewOn)}</a>
            ))}
          </nav>
        )}
      </div>

      <header className="rd-head">
        <div className="vg-eyebrow" style={{ color: 'var(--color-accent)' }}>{t('Vigie · QHSE management system')}</div>
        <h1>{fill(t('{kind} management review of {date}'), { kind, date: fmtDate(h.reviewOn) })}</h1>
        <div className="rd-muted" style={{ fontSize: 12.5 }}>
          {page.mode === 'snapshot' && `${fill(t('File frozen at the management sign-off {taken}'), { taken: taken(page.takenOn, page.takenBy) })}${page.seance ? fill(t(' · meeting file of {date}'), { date: page.seance.takenOn ? fmtDate(page.seance.takenOn) : '—' }) : ''} · ${stopped}`}
          {page.mode === 'seance' && `${fill(t('Meeting file frozen {taken}'), { taken: taken(page.takenOn, page.takenBy) })} · ${stopped} · ${t('minutes editable until the sign-off')}`}
          {page.mode === 'record' && t('Minutes recorded · review earlier than Vigie: preparatory file not archived')}
          {page.mode === 'live' && fill(t('Consolidated preparatory file · generated on {date} by {name}'), { date: fmtDate(page.now), name: h.author })}
        </div>
        <dl className="rd-meta">
          {page.mode !== 'record' && <><dt>{t('Period reviewed')}</dt><dd>{fill(t('Rolling 12 months, from {from} to {to}'), { from: fmtDate(h.from), to: fmtDate(h.to) })}</dd></>}
          <dt>{t('Scope')}</dt><dd>{h.site}</dd>
          <dt>{t('Chair')}</dt><dd>{h.director}</dd>
          <dt>{t('Facilitation')}</dt><dd>{h.lead}</dd>
          <dt>{t('Participants')}</dt>
          <dd>
            {participants.length ? participants.join(', ') : (
              <><span className="rd-muted">{t('[To complete: heads of department, quality manager, staff representatives…]')}</span><Blank /></>
            )}
          </dd>
        </dl>
      </header>

      {d.previousFollowUp ? (
        <Section n={n()} title={t('Follow-up of the decisions and actions of the previous reviews')} aside={followUpAside(d.previousFollowUp, t)}>
          {d.previousFollowUp.length ? <FollowUpTable t={t} rows={d.previousFollowUp} role={role} />
            : <Empty>{t('No decision or action from the previous reviews.')}</Empty>}
        </Section>
      ) : d.previousActions && (
        // Instantané de version 1 (avant le lot 2) : actions des revues précédentes seulement.
        <Section n={n()} title={t('Follow-up of the actions of the previous reviews')} aside={plural(d.previousActions.length, t('{n} action'), t('{n} actions'))}>
          {d.previousActions.length ? <ActionTable t={t} rows={d.previousActions} role={role} review extra={(a) => a.originRef} />
            : <Empty>{t('No action from the previous reviews.')}</Empty>}
        </Section>
      )}

      {d.safety && (
        <Section n={n()} title={t('Safety indicators')} aside={d.safety.missingMonths !== undefined ? t('Last 12 full months') : t('Rolling 12 months')}>
          <div className="rd-kpis">
            <Kpi label={t('Days without lost-time accident')} value={d.safety.daysWithout} note={d.safety.daysNote} />
            <Kpi label={t('LTIFR · frequency rate')} value={d.safety.tf1}
              note={t('Lost-time accidents per million hours')
                + (d.safety.target != null ? fill(t(' · objective {target}'), { target: typeof d.safety.target === 'number' ? `≤ ${d.safety.target.toLocaleString('fr-FR')}` : d.safety.target }) : t(' · no LTIFR objective'))
                + (d.safety.missingMonths ? fill(t(' · {n} months without hours entered'), { n: d.safety.missingMonths }) : '')} />
            <Kpi label={t('Severity rate')} value={d.safety.tg} note={t('Days lost per 1,000 hours worked')} />
          </div>
          <h3 className="rd-h3">{t('Pyramid of the safety events')}</h3>
          <div className="rd-pyramid">
            {d.safety.pyramid.map((p) => <PyramidRow key={p.label} label={p.label} n={p.n} w={p.w} color={p.color} />)}
          </div>
        </Section>
      )}

      {d.events && (
        <Section n={n()} title={t('Non-conformities and events')} aside={plural(d.events.openNc?.length ?? 0, t('{n} open NC'), t('{n} open NCs'))}>
          <div className="rd-cols">
            <ScrollTable t={t}>
              <table className="table rd-table">
                <thead><tr><th>{t('Type')}</th><th className="rd-num-cell">{t('12 months')}</th><th className="rd-num-cell">{t('open#plural')}</th></tr></thead>
                <tbody>
                  {d.events.byType?.map((ty) => (
                    <tr key={ty.key}><td>{ty.label}</td><td className="rd-num-cell">{ty.n12}</td><td className="rd-num-cell">{ty.open}</td></tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
            <ScrollTable t={t}>
              <table className="table rd-table">
                <thead><tr><th>{t('Non-conformities by origin')}</th><th className="rd-num-cell">{t('12 months')}</th><th className="rd-num-cell">{t('open#fplural')}</th></tr></thead>
                <tbody>
                  {d.events.ncByOrigin?.map((o) => (
                    <tr key={o.origin}><td>{o.origin}</td><td className="rd-num-cell">{o.n12}</td><td className="rd-num-cell">{o.open}</td></tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          </div>
          <p className="rd-empty rd-muted">{t('Customer complaints are counted under the “Customer complaint” origin.')}</p>
          <h3 className="rd-h3">{t('Open non-conformities')}</h3>
          {d.events.openNc?.length ? (
            <ScrollTable t={t}>
              <table className="table rd-table">
                <thead><tr><th>{t('Ref.')}</th><th>{t('Date')}</th><th>{t('Non-conformity')}</th><th>{t('Origin')}</th><th>{t('Stage')}</th><th>{t('Actions')}</th></tr></thead>
                <tbody>
                  {d.events.openNc.map((e) => (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={e.href} role={role}>{e.id}</Ref></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.occurredOn)}</td>
                      <td>{e.title}<div className="rd-muted" style={{ fontSize: 11 }}>{t('Lead: ')}{e.pilot}</div></td>
                      <td className="rd-muted">{e.origin}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{e.step}</td>
                      <td><ActionRefs t={t} actions={e.actions} role={role} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          ) : <Empty>{t('No open non-conformity.')}</Empty>}
        </Section>
      )}

      {d.complaints && (() => {
        const open = d.complaints.filter((c) => c.open).length;
        const closed = d.complaints.length - open;
        return (
          <Section n={n()} title={t('Customer satisfaction and complaints')} aside={t('Rolling 12 months')}>
            <p className="rd-summary">
              {plural(d.complaints.length, t('{n} customer complaint recorded'), t('{n} customer complaints recorded'))}
              {d.complaints.length > 0 && ` · ${fill(t('{n} being handled'), { n: open })} · ${plural(closed, t('{n} closed#f'), t('{n} closed#fplural'))}`}
            </p>
            {d.complaints.length ? (
              <ScrollTable t={t}>
                <table className="table rd-table">
                  <thead><tr><th>{t('Ref.')}</th><th>{t('Date')}</th><th>{t('Complaint')}</th><th>{t('Keystone project')}</th><th>{t('Stage')}</th><th>{t('Actions')}</th></tr></thead>
                  <tbody>
                    {d.complaints.map((c) => (
                      <tr key={c.id}>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={c.href} role={role}>{c.id}</Ref></td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.occurredOn)}</td>
                        <td>{c.title}<div className="rd-muted" style={{ fontSize: 11 }}>{t('Lead: ')}{c.pilot}</div></td>
                        <td className="rd-muted">{c.project ?? '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{c.step}</td>
                        <td><ActionRefs t={t} actions={c.actions} role={role} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
            ) : <Empty>{t('No customer complaint over the period.')}</Empty>}
            <h3 className="rd-h3">{t('Customer perception')}</h3>
            <RecordText t={t} text={r.customerPerception} held={held} placeholder={t('satisfaction survey results, customer feedback, on-time delivery')} />
          </Section>
        );
      })()}

      {d.suppliers && (
        <Section n={n()} title={t('Supplier performance')}>
          <p className="rd-summary">
            {plural(d.suppliers.summary?.audits ?? 0, t('{n} supplier audit in the programme'), t('{n} supplier audits in the programme'))} ({plural(d.suppliers.summary?.auditsDone ?? 0, t('{n} carried out'), t('{n} carried out#plural'))})
            {' · '}{plural(d.suppliers.summary?.ncs ?? 0, t('{n} supplier non-conformity'), t('{n} supplier non-conformities'))}{plural(d.suppliers.summary?.ncOpen ?? 0, t(' over 12 months, of which {n} open#f'), t(' over 12 months, of which {n} open#fplural'))}
          </p>
          <h3 className="rd-h3">{t('Supplier audits of the programme')}</h3>
          {d.suppliers.audits?.length ? (
            <ScrollTable t={t}>
              <table className="table rd-table">
                <thead><tr><th>{t('Date')}</th><th>{t('Title')}</th><th>{t('Auditor')}</th><th>{t('State')}</th></tr></thead>
                <tbody>
                  {d.suppliers.audits.map((p) => (
                    <tr key={p.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{p.plannedOn ? fmtDate(p.plannedOn) : `${capitalize(monthName(p.month))} ${p.year}`}</td>
                      <td><Ref href={p.href} role={role}>{p.detail ?? p.label}</Ref></td>
                      <td className="rd-muted">{p.auditor ?? p.owner ?? '—'}</td>
                      <td><ToneTag tone={p.state.tone} style={{ whiteSpace: 'nowrap' }}>{p.state.label}</ToneTag></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          ) : <Empty>{t('No supplier audit over the period.')}</Empty>}
          {/* AUD-33 : constats des audits fournisseurs (dossier figé avant le paquet 13 : ils restent sous Audits). */}
          {d.suppliers.findingGroups && (
            <>
              <h3 className="rd-h3">{t('Findings of the supplier audits')}</h3>
              {d.suppliers.findingGroups.length ? <FindingGroups t={t} groups={d.suppliers.findingGroups} role={role} /> : <Empty>{t('No supplier audit finding.')}</Empty>}
            </>
          )}
          <h3 className="rd-h3">{t('Non-conformities of supplier origin')}</h3>
          {d.suppliers.ncs?.length ? (
            <ScrollTable t={t}>
              <table className="table rd-table">
                <thead><tr><th>{t('Ref.')}</th><th>{t('Date')}</th><th>{t('Non-conformity')}</th><th>{t('Stage')}</th><th>{t('Actions')}</th></tr></thead>
                <tbody>
                  {d.suppliers.ncs.map((e) => (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={e.href} role={role}>{e.id}</Ref></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.occurredOn)}</td>
                      <td>{e.title}<div className="rd-muted" style={{ fontSize: 11 }}>{t('Lead: ')}{e.pilot}</div></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{e.step}</td>
                      <td><ActionRefs t={t} actions={e.actions} role={role} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          ) : <Empty>{t('No supplier non-conformity over the period.')}</Empty>}
        </Section>
      )}

      {d.audits && (
        <Section n={n()} title={t('Audits and certifications')}>
          <h3 className="rd-h3">{t('Certifications')}</h3>
          {d.audits.certs?.length ? (
            <ScrollTable t={t}>
              <table className="table rd-table">
                <thead><tr><th>{t('Standard')}</th><th>{t('Domain')}</th><th>{t('Status')}</th><th>{t('Comment')}</th></tr></thead>
                <tbody>
                  {d.audits.certs.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{c.standard}</td>
                      <td>{c.domain}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Dot color={certDot(c.tone)} />{c.status?.label}</span>
                        <div className="rd-muted" style={{ fontSize: 11 }}>{[CERT_TONE_LABELS[c.tone as CertTone], c.organization].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="rd-muted">{c.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          ) : <Empty>{t('No standard followed')}.</Empty>}

          <h3 className="rd-h3"><Ref href={d.audits.programmeHref} role={role}>{t('Programme of audits and visits')}</Ref></h3>
          {d.audits.progFrom && d.audits.progTo && d.audits.programmeCounts && (
            <p className="rd-summary">
              {fill(t('{from} to {to} (period reviewed and year following the review)'), { from: fromMonth(d.audits.progFrom, t), to: `${monthName(+d.audits.progTo.slice(5, 7))} ${yearOf(d.audits.progTo)}` })}
              {' · '}{plural(d.audits.programmeCounts.done, t('{n} carried out'), t('{n} carried out#plural'))} · {fill(t('{n} to confirm (deadline passed)'), { n: d.audits.programmeCounts.pending })} · {fill(t('{n} upcoming'), { n: d.audits.programmeCounts.upcoming })}
              {d.audits.programmeCounts.cancelled != null && ` · ${plural(d.audits.programmeCounts.cancelled, t('{n} cancelled#m'), t('{n} cancelled#mplural'))}`}
              {d.audits.programmeCounts.postponed != null && ` · ${plural(d.audits.programmeCounts.postponed, t('{n} postponed'), t('{n} postponed#plural'))}`}
            </p>
          )}
          {d.audits.programme?.length ? (
            <ScrollTable t={t}>
              <table className="table rd-table">
                <thead><tr><th>{t('Month')}</th><th>{t('Line')}</th><th>{t('Title')}</th><th>{t('Owner')}</th><th>{t('State')}</th></tr></thead>
                <tbody>
                  {d.audits.programme.map((p) => (
                    <tr key={p.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{p.plannedOn ? fmtDate(p.plannedOn) : `${capitalize(monthName(p.month))} ${p.year}`}</td>
                      <td className="rd-muted" style={{ whiteSpace: 'nowrap' }}>{p.track}</td>
                      <td>
                        <Ref href={p.href} role={role}>{p.detail ?? p.label}</Ref>
                        {p.postponedFrom && <div className="rd-muted" style={{ fontSize: 11 }}>{t('Postponed · initially ')}{p.postponedFrom.endsWith('-01') ? `${monthName(+p.postponedFrom.slice(5, 7))} ${yearOf(p.postponedFrom)}` : fmtDate(p.postponedFrom)}</div>}
                        {p.action && <div className="rd-muted" style={{ fontSize: 11 }}><Ref href={p.action.href} role={role}>{p.action.id}</Ref> · {p.action.status}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{p.owner || '—'}</td>
                      <td><ToneTag tone={p.state.tone} style={{ whiteSpace: 'nowrap' }}>{p.state.label}</ToneTag></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          ) : <Empty>{t('No item in the programme over this period.')}</Empty>}

          <h3 className="rd-h3">{t('Audit findings')}</h3>
          {d.audits.auditGroups?.length ? <FindingGroups t={t} groups={d.audits.auditGroups} role={role} /> : <Empty>{t('No finding recorded.#audit')}</Empty>}

          {/* AUD-40 : auto-évaluation par référentiel (dossiers figés avant le paquet R3 : section absente). */}
          {d.selfAssessments && (
            <>
              <h3 className="rd-h3">{t('Self-assessment per standard')}</h3>
              {d.selfAssessments.length ? (
                <ScrollTable t={t}>
                  <table className="table rd-table">
                    <thead><tr><th>{t('Standard')}</th><th>{t('Campaign')}</th><th className="rd-num-cell">{t('Compliance')}</th><th className="rd-num-cell">{t('Trend')}</th><th className="rd-num-cell">{t('Gaps')}</th><th>{t('Weakest clauses')}</th></tr></thead>
                    <tbody>
                      {d.selfAssessments.map((a) => (
                        <tr key={a.id}>
                          <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{a.standard}<div className="rd-muted" style={{ fontSize: 11 }}>{a.site}</div></td>
                          <td style={{ whiteSpace: 'nowrap' }}><Ref href={a.href} role={role}>{a.id}</Ref> · {fmtDate(a.assessedOn)}</td>
                          <td className="rd-num-cell">{a.rate == null ? '—' : `${a.rate} %`}</td>
                          <td className="rd-num-cell">{a.previousOn ? fmtDelta(a.delta) : t('first#f')}</td>
                          <td className="rd-num-cell">{a.gaps}</td>
                          <td className="rd-muted">{[...a.clauses].filter((c) => c.rate != null).sort((x, y) => (x.rate ?? 0) - (y.rate ?? 0)).slice(0, 2).map((c) => `${c.clause} ${c.heading} (${c.rate} %)`).join(' · ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollTable>
              ) : <Empty>{t('No closed self-assessment campaign.')}</Empty>}
            </>
          )}
        </Section>
      )}

      {d.actions && (
        <Section n={n()} title={t('Action plan')} aside={`${plural(d.actions.totals?.open ?? 0, t('{n} open#f'), t('{n} open#fplural'))} · ${fill(t('{n} late'), { n: d.actions.totals?.late ?? 0 })}`}>
          {actionRows?.length ? (
            <ScrollTable t={t}>
              <table className="table rd-table">
                {/* Dossier courant : par source (plan d'actions QSE) ; dossier figé avant la refonte : par origine, tel quel. */}
                {d.actions.bySource
                  ? <thead><tr><th>{t('Source')}</th><th className="rd-num-cell">{t('Open#fcap')}</th><th className="rd-num-cell">{t('of which late')}</th><th className="rd-num-cell">{t('Finished — to verify')}</th><th className="rd-num-cell">{t('Verified · period')}</th></tr></thead>
                  : <thead><tr><th>{t('Origin')}</th><th className="rd-num-cell">{t('Open#fcap')}</th><th className="rd-num-cell">{t('of which late')}</th><th className="rd-num-cell">{t('Effectiveness to verify')}</th><th className="rd-num-cell">{t('Closed · 12 months')}</th></tr></thead>}
                <tbody>
                  {actionRows.map((o) => (
                    <tr key={o.key}>
                      <td>{o.label}</td>
                      <td className="rd-num-cell">{o.open}</td>
                      <td className="rd-num-cell" style={{ color: o.late ? TONE.danger.dot : undefined }}>{o.late}</td>
                      <td className="rd-num-cell">{o.verify}</td>
                      <td className="rd-num-cell">{o.closed}</td>
                    </tr>
                  ))}
                  {d.actions.totals && (
                    <tr className="rd-total">
                      <td>{t('Total')}</td>
                      <td className="rd-num-cell">{d.actions.totals.open}</td>
                      <td className="rd-num-cell">{d.actions.totals.late}</td>
                      <td className="rd-num-cell">{d.actions.totals.verify}</td>
                      <td className="rd-num-cell">{d.actions.totals.closed}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollTable>
          ) : <Empty>{t('No action in the action plan.')}</Empty>}
          {!!d.actions.lateActions?.length && (
            <>
              <h3 className="rd-h3">{t('Late actions')}</h3>
              <ScrollTable t={t}>
                <table className="table rd-table">
                  {d.actions.bySource
                    ? <thead><tr><th>{t('No.')}</th><th>{t('Action')}</th><th>{t('Source')}</th><th>{t('Owner')}</th><th>{t('Target date')}</th><th className="rd-num-cell">{t('Delay')}</th></tr></thead>
                    : <thead><tr><th>{t('Ref.')}</th><th>{t('Action')}</th><th>{t('Origin')}</th><th>{t('Lead')}</th><th>{t('Deadline')}</th><th className="rd-num-cell">{t('Delay')}</th></tr></thead>}
                  <tbody>
                    {d.actions.lateActions.map((a) => (
                      <tr key={a.id}>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={a.href} role={role}>{a.id}</Ref></td>
                        <td>{a.title}</td>
                        <td className="rd-muted">{a.origin} · {a.originRef}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{a.pilot}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.dueOn)}</td>
                        <td className="rd-num-cell">{fill(t('{n} d'), { n: daysBetween(a.dueOn, asOf) })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
            </>
          )}
        </Section>
      )}

      {d.watch && (
        <Section n={n()} title={t('Regulatory watch and periodic inspections')}
          aside={d.watch.requirementCounts?.filter((c) => c.n).map((c) => `${c.n} ${evalCount(c.key, c.label, c.n, t)}`).join(' · ')}>
          <h3 className="rd-h3">{t('Regulatory requirements')}</h3>
          {d.watch.requirements?.length ? (
            <ScrollTable t={t}>
              <table className="table rd-table">
                <thead><tr><th>{t('Requirement')}</th><th>{t('Domain')}</th><th>{t('Evaluation')}</th><th>{t('Deadline')}</th><th>{t('Lead')}</th><th>{t('Action')}</th></tr></thead>
                <tbody>
                  {d.watch.requirements.map((q) => (
                    <tr key={q.id}>
                      <td style={{ fontWeight: 500 }}><Ref href={q.href} role={role}>{q.text}</Ref></td>
                      <td className="rd-muted">{q.domain}</td>
                      <td>
                        <ToneTag tone={q.tone} style={{ whiteSpace: 'nowrap' }}>{q.evalLabel}</ToneTag>
                        {q.evalNote && <div className="rd-muted" style={{ fontSize: 11, marginTop: 2 }}>{q.evalNote}</div>}
                        {q.lastEvaluatedOn && <div className="rd-muted" style={{ fontSize: 11 }}>{fill(t('evaluated on {date}'), { date: fmtDate(q.lastEvaluatedOn) })}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{[q.dueOn && fmtDate(q.dueOn), q.dueNote].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{q.pilot}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{q.action ? <><Ref href={q.action.href} role={role}>{q.action.id}</Ref> · <ActionStatus a={q.action} plain t={t} /></> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          ) : <Empty>{t('No requirement followed.')}</Empty>}
          {d.watch.controls && (
            <>
              <h3 className="rd-h3">{t('Periodic inspections')}</h3>
              <p className="rd-summary">
                {plural(d.watch.controls.overdue, t('{n} overdue#m'), t('{n} overdue#plural'))} · {fill(t('{n} within 30 days'), { n: d.watch.controls.soon })} · {plural(d.watch.controls.planned, t('{n} planned'), t('{n} planned#plural'))} · {plural(d.watch.controls.withReserves, t('{n} inspection with reservations'), t('{n} inspections with reservations'))}
              </p>
              {d.watch.controls.rows?.length ? (
                <ScrollTable t={t}>
                  <table className="table rd-table">
                    <thead><tr><th>{t('Equipment')}</th><th>{t('Inspection')}</th><th>{t('Body')}</th><th>{t('Deadline')}</th><th>{t('State')}</th><th>{t('Reservations')}</th></tr></thead>
                    <tbody>
                      {d.watch.controls.rows.map((c) => (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 500 }}><Ref href={c.href} role={role}>{c.equipment}</Ref></td>
                          <td>{c.type}</td>
                          <td className="rd-muted">{c.organization}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.nextOn)}</td>
                          <td><ToneTag tone={c.status.tone} style={{ whiteSpace: 'nowrap' }}>{c.status.label}</ToneTag></td>
                          <td>
                            {c.reserves ?? '—'}
                            {c.action && <div className="rd-muted" style={{ fontSize: 11 }}><Ref href={c.action.href} role={role}>{c.action.id}</Ref> · {c.action.status}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollTable>
              ) : <Empty>{t('No inspection overdue, due within 30 days or with reservations.')}</Empty>}
            </>
          )}
        </Section>
      )}

      {d.risks && (
        <Section n={n()} title={t('Risk assessment (DUERP)')}>
          {d.risks.version ? (
            <p className="rd-summary">
              {fill(t('Version {version} of {date} · next update on {next}'), { version: d.risks.version.version, date: fmtDate(d.risks.version.updatedOn), next: fmtDate(d.risks.version.nextUpdateOn) })}
              {d.risks.version.daysToUpdate != null && d.risks.version.daysToUpdate < 0 && <span style={{ color: TONE.danger.fg }}>{fill(t(' (overdue by {n} d)'), { n: -d.risks.version.daysToUpdate })}</span>}
              {' · '}{d.risks.version.cseConsultedOn ? fill(t('CSE consulted on {date}'), { date: fmtDate(d.risks.version.cseConsultedOn) }) : t('CSE consultation not recorded')}
            </p>
          ) : <Empty>{t('No DUERP version in force.')}</Empty>}
          {d.risks.priority && (
            <>
              <h3 className="rd-h3">{t('Priority risks')}</h3>
              <p className="rd-summary">
                {plural(d.risks.priority.count, t('{n} risk rated above the action threshold'), t('{n} risks rated above the action threshold'))} · {fill(t('{n} without action in progress'), { n: d.risks.priority.withoutAction })}
              </p>
              {d.risks.priority.top?.length ? (
                <ScrollTable t={t}>
                  <table className="table rd-table">
                    <thead><tr><th>{t('Work unit')}</th><th>{t('Hazard')}</th><th className="rd-num-cell">{t('Gross → residual')}</th><th>{t('Actions')}</th></tr></thead>
                    <tbody>
                      {d.risks.priority.top.map((k) => (
                        <tr key={k.id}>
                          <td style={{ whiteSpace: 'nowrap' }}><Ref href={k.href} role={role}>{k.unit}</Ref></td>
                          <td>{k.hazard}</td>
                          <td className="rd-num-cell">{k.score} → {k.residual}</td>
                          <td>{k.actions.length ? k.actions.map((a) => (
                            <div key={a.id} style={{ whiteSpace: 'nowrap' }}><Ref href={a.href} role={role}>{a.id}</Ref> · <span style={{ color: a.tone === 'neutral' ? undefined : TONE[a.tone].dot }}>{a.status}</span></div>
                          )) : <span className="rd-muted">{t('No action#without')}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollTable>
              ) : <Empty>{t('No risk above the action threshold.')}</Empty>}
            </>
          )}
        </Section>
      )}

      {d.prevention && (
        <Section n={n()} title={t('Prevention for external companies')}>
          {!!d.prevention.kpis?.length && (
            <div className="rd-kpis">
              {d.prevention.kpis.map((k) => <Kpi key={k.label} label={k.label} value={k.value} tone={k.tone} note={[k.sub, k.note].filter(Boolean).join(' · ')} />)}
            </div>
          )}
          <h3 className="rd-h3">{t('Gaps and deadlines')}</h3>
          {d.prevention.gaps?.length ? (
            <ul className="rd-list">
              {d.prevention.gaps.map((g) => (
                <li key={`${g.href}|${g.title}`}>
                  <Dot color={TONE[g.tone].dot} />
                  <span><Ref href={g.href} role={role}>{g.title}</Ref></span>
                  <span className="rd-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(g.date)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>{t('No prevention gap or deadline.')}</Empty>}
        </Section>
      )}

      {d.documents && (
        <Section n={n()} title={t('Document control')}>
          {!!d.documents.kpis?.length && (
            <div className="rd-kpis">
              {d.documents.kpis.map((k) => <Kpi key={k.key} label={k.label} value={String(k.value)} tone={k.key === 'retard' && k.value ? 'danger' : undefined} note={[k.sub, k.note].filter(Boolean).join(' · ')} />)}
            </div>
          )}
          <h3 className="rd-h3">{t('Late periodic reviews')}</h3>
          {d.documents.overdue?.length ? (
            <ScrollTable t={t}>
              <table className="table rd-table">
                <thead><tr><th>{t('Ref.')}</th><th>{t('Document')}</th><th>{t('Owner#document')}</th><th>{t('Review planned on')}</th></tr></thead>
                <tbody>
                  {d.documents.overdue.map((x) => (
                    <tr key={x.id}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={x.href} role={role}>{x.id}</Ref></td>
                      <td>{x.title}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{x.owner}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{x.nextReviewOn ? fmtDate(x.nextReviewOn) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          ) : <Empty>{t('No overdue document review.')}</Empty>}
          <h3 className="rd-h3">{t('Revisions in the approval workflow')}</h3>
          {d.documents.pending?.length ? (
            <ScrollTable t={t}>
              <table className="table rd-table">
                <thead><tr><th>{t('Ref.')}</th><th>{t('Revision')}</th><th>{t('Document')}</th><th>{t('Submitted on')}</th></tr></thead>
                <tbody>
                  {d.documents.pending.map((x) => (
                    <tr key={`${x.docId}-${x.version}`}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={x.href} role={role}>{x.docId}</Ref></td>
                      <td>{x.version}</td>
                      <td>{x.title}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{x.submittedOn ? fmtDate(x.submittedOn) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          ) : <Empty>{t('No revision being approved.')}</Empty>}
        </Section>
      )}

      {d.environment && (
        <Section n={n()} title={t('Environmental performance')} aside={fill(t('Year {year}'), { year: d.environment.year })}>
          {d.environment.certification && (
            <p className="rd-summary">
              {d.environment.certification.standard} {d.environment.certification.engaged ? `· ${d.environment.certification.status}` : t('not committed · regulatory follow-up')}
              {d.environment.certification.note && <span className="rd-muted"> · {d.environment.certification.note}</span>}
            </p>
          )}
          {d.environment.kpis && (
            <div className="rd-kpis">
              <Kpi label={t('Waste removed')} value={`${fmtNum(d.environment.kpis.tonnes)} t`}
                note={plural(d.environment.kpis.entries, t('{n} removal'), t('{n} removals')) + (d.environment.kpis.prevTonnes != null ? fill(t(' · {n} t last year'), { n: fmtNum(d.environment.kpis.prevTonnes) }) : '')} />
              <Kpi label={t('Share of hazardous waste')} value={fmtPct(d.environment.kpis.hazardousShare)} />
              <Kpi label={t('Recovery rate')} value={fmtPct(d.environment.kpis.recoveryShare)} />
              <Kpi label={t('Missing waste tracking slips')} value={String(d.environment.kpis.missingBsd)} tone={d.environment.kpis.missingBsd ? 'danger' : undefined} note={t('Hazardous waste without a Trackdéchets slip')} />
              <Kpi label={t('Electricity')} value={`${fmtNum(d.environment.kpis.electricity.current, 0)} kWh`}
                note={[d.environment.kpis.electricity.period, d.environment.kpis.electricity.delta != null ? fill(t('{delta} % over a year'), { delta: `${d.environment.kpis.electricity.delta > 0 ? '+' : ''}${fmtNum(d.environment.kpis.electricity.delta * 100)}` }) : null].filter(Boolean).join(' · ')} />
            </div>
          )}
          <p className="rd-summary">
            {plural(d.environment.openEvents ?? 0, t('{n} open environmental event'), t('{n} open environmental events'))} · {plural(d.environment.envClosed12 ?? 0, t('{n} closed over 12 months'), t('{n} closed over 12 months#plural'))}
          </p>
        </Section>
      )}

      {d.skills && (
        <Section n={n()} title={t('Resources and competences')}>
          {d.skills.counts && (
            <p className="rd-summary">
              {plural(d.skills.counts.people, t('{n} employee followed in the'), t('{n} employees followed in the'))} <Ref href={d.skills.href} role={role}>{t('matrix')}</Ref> · {plural(d.skills.counts.expired, t('{n} title expired'), t('{n} titles expired'))} · {fill(t('{n} expiring within {days} days'), { n: d.skills.counts.soon, days: SKILL_SOON_DAYS })} · {plural(d.skills.counts.never, t('{n} required never attended'), t('{n} required never attended#plural'))}
            </p>
          )}
          {/* HAB-18 : indicateurs de compétences (absents des dossiers figés avant le paquet 13). */}
          {d.skills.indicators && (
            <div className="rd-kpis">
              <Kpi label={t('Compliance of the required titles')} value={d.skills.indicators.rate == null ? '—' : `${d.skills.indicators.rate} %`}
                note={fill(t('{n} of {total} required titles valid'), { n: d.skills.indicators.compliant, total: d.skills.indicators.required })} />
              <Kpi label={t('Titles obtained over 12 months')} value={String(d.skills.indicators.trainings12)}
                note={t('According to Cursus (HR); training effectiveness followed in Cursus')} />
              <Kpi label={t('Late renewals')} value={String(d.skills.indicators.lateRenewals)} note={t('required titles expired')} />
            </div>
          )}
          <h3 className="rd-h3">{t('Qualification alerts on the Keystone assignments')}</h3>
          {d.skills.alerts?.length ? (
            <ScrollTable t={t}>
              <table className="table rd-table">
                <thead><tr><th>{t('Employee')}</th><th>{t('Title#qualification')}</th><th>{t('State')}</th><th>{t('Assignment')}</th><th>{t('Period')}</th></tr></thead>
                <tbody>
                  {d.skills.alerts.map((a) => (
                    <tr key={`${a.person}-${a.title}-${a.assignment}-${a.startOn}`}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}><Ref href={a.href} role={role}>{a.person}</Ref></td>
                      <td>{a.title}</td>
                      <td><ToneTag tone={a.state.tone} style={{ whiteSpace: 'nowrap' }}>{a.state.label}</ToneTag></td>
                      <td>{a.assignment}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.startOn)} → {fmtDate(a.endOn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          ) : <Empty>{t('No upcoming assignment on a title missing, expired or expiring before the end of the assignment.')}</Empty>}
          <h3 className="rd-h3">{t('Resource needs')}</h3>
          <RecordText t={t} text={r.resourceNeeds} held={held} placeholder={t('headcount, equipment, budget, trainings to schedule')} />
        </Section>
      )}

      {/* AUD-13 (§9.3.2 c) : objectifs QHSE mesurables et leur degré de réalisation ; absent des dossiers figés avant le paquet 5. */}
      {d.objectives && (
        <Section n={n()} title={t('QHSE objectives')} aside={fill(t('{done}/{total} achieved'), { done: d.objectives.filter((o) => o.tone === 'ok').length, total: d.objectives.length })}>
          {d.objectives.length ? (
            <ScrollTable t={t}>
              <table className="table rd-table">
                <thead><tr><th>{t('Objective')}</th><th>{t('Indicator')}</th><th>{t('Target')}</th><th>{t('Value')}</th><th>{t('State')}</th></tr></thead>
                <tbody>
                  {d.objectives.map((o) => (
                    <tr key={`${o.label}-${o.indicator}-${o.site}`}>
                      <td style={{ fontWeight: 500 }}>{o.label}<span className="rd-muted" style={{ display: 'block', fontSize: 11.5, fontWeight: 400 }}>{o.site}</span></td>
                      <td>{o.indicator}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{o.target}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{o.value}</td>
                      <td><ToneTag tone={o.tone} style={{ whiteSpace: 'nowrap' }}>{o.status}</ToneTag></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          ) : <Empty>{t('No measurable objective recorded for the year.')}</Empty>}
        </Section>
      )}

      {/* CNF-05 (§9.3.2 b et e) : enjeux, parties intéressées, risques et opportunités. */}
      {d.context && (
        <Section n={n()} title={t('Context, risks and opportunities')} aside="ISO 9001 §4.1 · §4.2 · §6.1">
          {d.context.length ? d.context.map((g) => (
            <div key={g.kind}>
              <h3 className="rd-h3">{g.label} <span className="rd-muted" style={{ fontWeight: 400 }}>· {g.clause}</span></h3>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 12.5 }}>
                {g.items.map((i) => (
                  <li key={i.label}>
                    <span style={{ fontWeight: 500 }}>{i.label}</span>{i.detail && <> — {i.detail}</>}
                    {i.treatment && <span className="rd-muted" style={{ display: 'block' }}>{t('Treatment: ')}{i.treatment}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )) : <Empty>{t('No issue, interested party, risk or opportunity recorded.')}</Empty>}
        </Section>
      )}

      <Section n={n()} title={t('Preparation, decisions and objectives')} aside={d.checklist.length ? fill(t('{done}/{total} items provided'), { done, total: d.checklist.length }) : undefined}>
        <h3 className="rd-h3">{t('Input items of the review')}</h3>
        {d.checklist.length ? (
          <div>
            {d.checklist.map((c) => (
              <div key={c.id} className="rd-check">
                <i className={`ph ${c.done ? 'ph-check-square' : 'ph-square'}`} style={{ fontSize: 15, color: c.done ? TONE.ok.dot : 'var(--color-neutral-500)' }} aria-hidden />
                <span>{c.label}</span>
                <span className="rd-muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap', color: c.late ? TONE.danger.fg : undefined }}>{c.done ? t('Provided') : t('To provide')} · {c.ownerLabel}</span>
              </div>
            ))}
          </div>
        ) : <Empty>{t('No preparation item entered.')}</Empty>}

        {(r.minutes || page.mode === 'record') && (
          <>
            <h3 className="rd-h3">{t('Minutes and conclusions')}</h3>
            <RecordText t={t} text={r.minutes} held={held} placeholder={t('conclusions of the meeting')} />
            {page.mode === 'record' && (
              <>
                <h3 className="rd-h3">{t('Customer perception')}</h3>
                <RecordText t={t} text={r.customerPerception} held={held} placeholder="" />
                <h3 className="rd-h3">{t('Resource needs')}</h3>
                <RecordText t={t} text={r.resourceNeeds} held={held} placeholder="" />
              </>
            )}
          </>
        )}

        <h3 className="rd-h3">{t('Decisions and objectives')}</h3>
        <ScrollTable t={t}>
          <table className="table rd-table">
            <thead><tr><th>{t('Nature')}</th><th style={{ width: '46%' }}>{t('Decision, objective or resource need')}</th><th>{t('Lead')}</th><th>{t('Deadline')}</th><th>{t('Action')}</th></tr></thead>
            <tbody>
              {d.decisions.map((x) => (
                <tr key={x.id}>
                  <td><ToneTag tone={x.cancelled ? 'neutral' : x.tone} style={{ whiteSpace: 'nowrap' }}>{x.kindLabel}</ToneTag></td>
                  <td>
                    {/* AUD-36 : décision abandonnée après la séance, barrée avec son motif. */}
                    <span style={x.cancelled ? { textDecoration: 'line-through' } : undefined}>{x.text}</span>
                    {x.cancelled && <span className="rd-muted" style={{ display: 'block', fontSize: 11 }}>{fill(t('Abandoned on {date} by {name} · reason: {reason}'), { date: fmtDate(x.cancelled.on), name: x.cancelled.by, reason: x.cancelled.reason })}</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{x.pilot}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{x.dueOn ? fmtDate(x.dueOn) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{x.action ? <><Ref href={`/actions?action=${encodeURIComponent(x.action.id)}`} role={role}>{x.action.id}</Ref> · <ActionStatus a={x.action} plain t={t} /></> : x.actionId ?? '—'}</td>
                </tr>
              ))}
              {h.status === 'planifiee' && Array.from({ length: BLANK_DECISIONS }, (_, i) => (
                <tr key={`blank-${i}`} className="rd-blank-row"><td /><td /><td /><td /><td /></tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
        {!d.decisions.length && h.status !== 'planifiee' && <Empty>{t('No decision recorded.')}</Empty>}
        {d.extraActions.length > 0 && (
          <>
            <h3 className="rd-h3">{t('Other actions from the review')}</h3>
            <ActionTable t={t} rows={d.extraActions} role={role} />
          </>
        )}
        <p className="rd-empty rd-muted" style={{ marginTop: 4 }}>{t('The decisions taken are followed in the single action plan with the source “Management review” (“QSE objective” for an objective).')}</p>
        <div className="rd-sign">
          <div>{t('Date of the next review')}{r.nextReviewOn && <div className="rd-sign-value">{fmtDate(r.nextReviewOn)}</div>}</div>
          <div>{t('Management sign-off')}{r.closedOn && <div className="rd-sign-value">{fill(t('{name} on {date}'), { name: r.closedBy ?? '—', date: fmtDate(r.closedOn) })}</div>}</div>
        </div>
        {/* AUD-34 : rectificatifs signés après le visa ; le dossier figé ci-dessus reste inchangé. */}
        {'corrections' in page && page.corrections.length > 0 && (
          <>
            <h3 className="rd-h3">{t('Corrections after the sign-off')}</h3>
            <ScrollTable t={t}>
              <table className="table rd-table">
                <thead><tr><th>{t('Date')}</th><th style={{ width: '50%' }}>{t('Correction')}</th><th>{t('Reason')}</th><th>{t('Signed by')}</th></tr></thead>
                <tbody>
                  {page.corrections.map((c) => (
                    <tr key={c.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.on)}</td>
                      <td style={{ whiteSpace: 'pre-line' }}>{c.text}</td>
                      <td>{c.reason}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{c.by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          </>
        )}
      </Section>

      <div className="rd-foot">
        {page.mode === 'live' && fill(t('Document generated by Vigie on {date} · indicators computed on that date{stopped}, to validate at the meeting.'), { date: fmtDate(page.now), stopped: setAtSeance })}
        {page.mode === 'seance' && fill(t('Meeting file frozen by Vigie on {date} · {stopped} · minutes editable until the management sign-off.'), { date: page.takenOn ? fmtDate(page.takenOn) : '—', stopped })}
        {page.mode === 'snapshot' && fill(t('File frozen by Vigie on {date} at the management sign-off · {stopped}.'), { date: page.takenOn ? fmtDate(page.takenOn) : '—', stopped })}
        {page.mode === 'record' && fill(t('Minutes recorded in Vigie · viewed on {date}.'), { date: fmtDate(page.now) })}
      </div>
    </main>
  );
}

/** Constats regroupés par audit (sections Audits et Fournisseurs, AUD-33) ; plusieurs actions par constat (AUD-28). */
function FindingGroups({ groups, role, t }: { groups: { label: string; findings: DossierFinding[] }[]; role: Role; t: T }) {
  return (
    <>
      {groups.map((g) => (
            <div key={g.label} style={{ display: 'grid', gap: 4 }}>
              <h4 className="rd-h4">{g.label}</h4>
              <ScrollTable t={t}>
                <table className="table rd-table">
                  <thead><tr><th>{t('Type')}</th><th>{t('Finding')}</th><th>{t('Action')}</th><th>{t('Status of the action')}</th></tr></thead>
                  <tbody>
                    {g.findings.map((f) => {
                      // Plusieurs actions par constat (AUD-28) ; dossier figé avant : action unique (dossierFindingActions).
                      const list = dossierFindingActions(f);
                      return (
                        <tr key={f.id}>
                          <td><ToneTag tone={f.tone} style={{ whiteSpace: 'nowrap' }}>{f.kindLabel}</ToneTag></td>
                          <td>{f.text}{f.clause && <span className="rd-muted"> · {f.clause}</span>}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {list.length ? list.map((x, i) => <div key={x.id}>{i > 0 && <span className="vg-sr-only">, </span>}<Ref href={x.action?.href} role={role}>{x.id}</Ref></div>)
                              : f.kind === 'point_fort' ? '—' : <span className="rd-muted">{t('No action#without')}</span>}
                          </td>
                          <td>{list.some((x) => x.action) ? list.map((x) => <div key={x.id}>{x.action ? <ActionStatus a={x.action} t={t} /> : '—'}</div>) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollTable>
            </div>
      ))}
    </>
  );
}
