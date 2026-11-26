'use client';

import Link from 'next/link';
import { useOptimistic, useState, useTransition } from 'react';
import { NewActionButton } from '@/components/ActionFormDialog';
import { ChangeLogList } from '@/components/ChangeLog';
import { Dialog } from '@/components/Dialog';
import { EntityFiles } from '@/components/EntityFiles';
import { LinkActionButton } from '@/components/LinkActionButton';
import { ActionLink } from '@/components/audits/parts';
import { Aside, CardHead, Icon, ToneTag, hrefWith } from '@/components/ui';
import { admissibleSources } from '@/lib/action-rules';
import type { ActionDefaults } from '@/lib/action-view';
import { addDays, fmtDate, fmtDayMonth, yearOf } from '@/lib/dates';
import { TONE } from '@/lib/domain';
import type { ReviewCardData } from '@/lib/data/review';
import { setReviewItemDone } from '@/server/review';
import {
  AbandonDecisionButton, CancelReviewButton, CloseReviewButton, CorrectionButton, CreateReviewForm, DecisionForm, HoldForm, ItemForm, RescheduleForm,
} from './ReviewDialogs';
import styles from './review.module.css';
import { SaveStatus, safeCall } from '@/components/feedback';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

type Editing =
  | { kind: 'item'; id: number | null }
  | { kind: 'decision'; id: number | null }
  | { kind: 'hold' } | { kind: 'create' } | { kind: 'reschedule' }
  | null;

const muted = { fontSize: 11.5, color: 'var(--color-neutral-500)' } as const;

/**
 * Valeurs proposées pour l'action d'une décision (ACT-28) : source Objectif QSE pour un objectif, sinon Revue de direction
 * (D20, imposée), décision liée, problème = texte de la décision, pilote et échéance de la décision (vérification proposée
 * 30 jours après) ; le site est choisi par le service QHSE (une décision vaut pour toute l'entreprise, jamais « Tous les
 * sites » pour une action, D16).
 */
export function decisionActionDefaults(d: { id: number; kind: string; text: string; pilotId: string | null; dueOn: string | null }, originRef: string): ActionDefaults {
  const [source] = admissibleSources('reviewdecision', { decisionKind: d.kind });
  return {
    source, lockSource: true, link: `reviewdecision:${d.id}`, linkLabel: d.text.slice(0, 80), originRef, problem: d.text,
    pilotId: d.pilotId ?? undefined, dueOn: d.dueOn ?? undefined, verifyDueOn: d.dueOn ? addDays(d.dueOn, 30) : undefined,
  };
}

/** Action rattachée à la revue sans décision qui la porte : source Revue de direction imposée. */
export function reviewActionDefaults(reviewId: number, originRef: string): ActionDefaults {
  const [source] = admissibleSources('review');
  return { source, lockSource: true, link: `review:${reviewId}`, linkLabel: originRef, originRef };
}

/**
 * Revue de direction sur /audits : préparation (check-list), puis séance (compte rendu, décisions et actions),
 * visa de la direction et historique des revues (?revue=<id>, ?revues=annulees).
 */
export function ReviewPanel({ data, params, showCancelled, allSites }: {
  data: ReviewCardData; params: Record<string, string | undefined>; showCancelled: boolean; allSites: boolean;
}) {
  const { t } = useI18n();
  const { now, review, reviewFiles, corrections, items, decisions, extraActions, previous, changes, options, people, linkable, defaults, flags, programme } = data;
  const [list, setDone] = useOptimistic(items, (state, { id, done }: { id: number; done: boolean }) => state.map((r) => (r.id === id ? { ...r, done } : r)));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);

  const edit = flags.canEdit && flags.editable;
  // Actions QSE : création et rattachements par le service QHSE seulement (ACT-22).
  const actionEdit = edit && flags.canCreateActions;
  const provided = list.filter((r) => r.done).length;
  const item = editing?.kind === 'item' && editing.id != null ? items.find((r) => r.id === editing.id) : undefined;
  const decision = editing?.kind === 'decision' && editing.id != null ? decisions.find((d) => d.id === editing.id) : undefined;
  const notYet = !!review && review.reviewOn > now;
  const held = review && (review.status === 'tenue' || review.status === 'cloturee');
  // AUD-36 : abandon motivé d'une décision après la séance — revue tenue : rôles qui saisissent ; clôturée : la direction.
  const canAbandon = !!review && ((review.status === 'tenue' && edit) || (review.status === 'cloturee' && flags.canEdit && flags.canSign));

  const toggle = (r: (typeof items)[number]) => start(async () => {
    setError(null);
    setDone({ id: r.id, done: !r.done });
    const res = await safeCall(() => setReviewItemDone(r.id, !r.done));
    if (res.error) setError(res.error);
  });

  const history = data.reviews.filter((r) => showCancelled || !r.cancelled || r.id === review?.id);
  const cancelledCount = data.reviews.filter((r) => r.cancelled).length;
  const kicker = review ? fill(t('Management review of {date}'), { date: fmtDate(review.reviewOn) }) : t('Management review');
  const title = (() => {
    switch (editing?.kind) {
      case 'item': return item ? t('Edit the item') : t('New item to prepare');
      case 'decision': return decision ? t('Edit the decision') : t('New decision, objective or need');
      case 'hold': return t('Minutes of the review');
      case 'create': return t('Prepare the next review');
      case 'reschedule': return t('Postpone the review');
      default: return '';
    }
  })();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, alignItems: 'start' }}>
      {/* ── Préparation ── */}
      <div className="card" style={{ gap: 8 }}>
        <CardHead title={t('Preparation of the management review')}
          aside={review ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Aside>{review.kindShort} {fmtDate(review.reviewOn)} · {fill(t('{done}/{total} items provided'), { done: provided, total: list.length })}</Aside>
              <ToneTag tone={review.statusTone} style={{ whiteSpace: 'nowrap' }}>{review.statusLabel}</ToneTag>
            </span>
          ) : <Aside>{t('No review planned')}</Aside>} />
        {review?.status === 'annulee' && (
          <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
            {fill(t('Cancelled on {date}'), { date: review.cancelledOn ? fmtDate(review.cancelledOn) : '—' })}{review.cancelledBy ? fill(t(' by {name}'), { name: review.cancelledBy }) : ''} · {review.cancelReason}
          </div>
        )}
        {list.map((r) => {
          const icon = <Icon name={r.done ? 'ph-check-circle' : 'ph-circle'} size={15} style={{ color: r.done ? TONE.ok.dot : 'var(--color-neutral-600)' }} />;
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0', fontSize: 12.5 }}>
              {r.auto ? (
                <span className={styles.auto} title={`${t('Computed by Vigie')} · ${r.done ? t('data available') : t('no data yet')}`}>{icon}</span>
              ) : r.canToggle ? (
                // Rôles qui saisissent, ou le contributeur lui-même (consultation de l'écran comprise, AUD-04).
                <button type="button" className={styles.check} aria-pressed={r.done} aria-label={r.label} title={r.done ? t('Mark as not provided') : t('Mark as provided')} onClick={() => toggle(r)}>{icon}</button>
              ) : <span className={styles.auto}>{icon}</span>}
              {edit ? (
                <button type="button" className={styles.textBtn} title={t('Edit the item')} onClick={() => setEditing({ kind: 'item', id: r.id })}
                  style={{ flex: 1, color: r.done ? 'var(--color-neutral-400)' : 'var(--color-text)' }}>{r.label}<span className="vg-sr-only">{t(': edit the item')}</span></button>
              ) : (
                <span style={{ flex: 1, color: r.done ? 'var(--color-neutral-400)' : 'var(--color-text)' }}>{r.label}</span>
              )}
              {r.files.length > 0 && (
                <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--color-neutral-400)' }} title={r.files.map((f) => f.name).join(', ')}>
                  <Icon name="ph-paperclip" size={12} /> {r.files.length}
                </span>
              )}
              <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: r.late ? TONE.danger.fg : 'var(--color-neutral-500)' }}
                title={r.late && r.dueOn ? fill(t('Expected on {date}'), { date: fmtDate(r.dueOn) }) : r.sourceLabel}>{r.ownerLabel}</span>
            </div>
          );
        })}
        {review && !list.length && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: '4px 0' }}>{t('No item to prepare yet.')}</div>}
        {!review && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: '4px 0' }}>{t('Plan the next review to prepare its checklist.')}</div>}
        <SaveStatus pending={pending} />
        {error && <div role="alert" style={{ fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>{error}</div>}
        {review && review.status !== 'annulee' && (
          // Échéance de la revue au programme annuel (AUD-01).
          <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
            {programme ? (
              <>{t('In the programme: ')}<Link href={`/audits?annee=${programme.year}&element=${programme.id}`} scroll={false} className="vg-link">{programme.label}</Link> · {programme.stateLabel}</>
            ) : t('Outside the annual programme')}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4 }}>
          {review && review.status !== 'annulee' && flags.canDossier && (
            // Lien HTML simple : la feuille globale du dossier ne doit pas rester chargée dans l'application.
            <a href={`/revue-de-direction?revue=${review.id}`} target="_blank" rel="noopener" className="btn btn-primary vg-btn-sm">
              <i className="ph ph-file-text" style={{ fontSize: 13 }} aria-hidden />{review.status === 'cloturee' ? t('See the file') : t('Generate the review file')}
            </a>
          )}
          {edit && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setEditing({ kind: 'item', id: null })}>
              <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />{t('Add an item')}
            </button>
          )}
          {flags.canEdit && review?.status === 'planifiee' && (
            <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => setEditing({ kind: 'reschedule' })}>
              <i className="ph ph-calendar-blank" style={{ fontSize: 13 }} aria-hidden />{t('Postpone')}
            </button>
          )}
          {flags.canApprove && review?.status === 'planifiee' && <CancelReviewButton review={review} />}
          {flags.mine && (
            <Link href={review ? `/audits/contributions?revue=${review.id}` : '/audits/contributions'} className="vg-link" style={{ fontSize: 12 }}>
              {t('My contributions')}
            </Link>
          )}
        </div>
      </div>

      {/* ── Séance, décisions et objectifs ── */}
      <div className="card" style={{ gap: 10 }}>
        <CardHead title={t('Meeting, decisions and objectives')} aside={previous ? <Aside>{t('Previous: ')}{previous.kindShort} {fmtDate(previous.reviewOn)}</Aside> : undefined} />

        {review && held && (
          <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
            <div><span style={muted}>{t('Participants · ')}</span>{[...review.participants, review.externalParticipants].filter(Boolean).join(', ') || '—'}</div>
            {review.minutes && <div style={{ color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{review.minutes}</div>}
            {/* AUD-35 : perception des clients (§9.3.2 c1) et besoins en ressources (§9.3.3 c) saisis au compte rendu. */}
            {review.customerPerception && <div style={{ whiteSpace: 'pre-line', textWrap: 'pretty' }}><span style={muted}>{t('Customer perception · ')}</span>{review.customerPerception}</div>}
            {review.resourceNeeds && <div style={{ whiteSpace: 'pre-line', textWrap: 'pretty' }}><span style={muted}>{t('Resource needs · ')}</span>{review.resourceNeeds}</div>}
            {review.closedOn && <div style={muted}>{fill(t('Management sign-off: {name} on {date}'), { name: review.closedBy ?? '—', date: fmtDate(review.closedOn) })}</div>}
          </div>
        )}
        {review?.nextReviewOn && <div style={{ fontSize: 12.5 }}><span style={muted}>{t('Next review on ')}</span>{fmtDate(review.nextReviewOn)}</div>}

        {review && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="vg-h6">{t('Decisions and objectives')}</div>
            {decisions.map((d) => (
              <div key={d.id} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '2px 8px', alignItems: 'baseline', fontSize: 12.5 }}>
                <ToneTag tone={d.cancelled ? 'neutral' : d.tone} style={{ whiteSpace: 'nowrap', fontSize: 11 }}>{d.kindLabel}</ToneTag>
                {/* AUD-36 : décision abandonnée après la séance, barrée (consultation seule). */}
                {d.cancelled ? <span style={{ textDecoration: 'line-through', color: 'var(--color-neutral-400)' }}>{d.text}</span> : edit ? (
                  <button type="button" className={styles.textBtn} onClick={() => setEditing({ kind: 'decision', id: d.id })} title={t('Edit')}>{d.text}</button>
                ) : <span>{d.text}</span>}
                <span />
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', ...muted }}>
                  <span>{d.pilot}{d.dueOn ? ` · ${fmtDayMonth(d.dueOn)}` : ''}</span>
                  {d.cancelled ? (
                    <span>{fill(t('Abandoned on {date} by {name} · reason: {reason}'), { date: fmtDate(d.cancelled.on), name: d.cancelled.by, reason: d.cancelled.reason })}</span>
                  ) : d.actionId ? (
                    <>
                      <ActionLink action={d.action} id={d.actionId} />
                      {actionEdit && <LinkActionButton link={`reviewdecision:${d.id}`} current={d.actionId} tooltip={fill(t('Unlink {id} from the decision (the action stays in the plan, linked to the review)'), { id: d.actionId })} />}
                    </>
                  ) : actionEdit && (
                    <>
                      <NewActionButton label={t('Create the action')} icon="ph-plus" className="vg-text-btn" options={options}
                        defaults={decisionActionDefaults(d, defaults.originRef)} />
                      <LinkActionButton link={`reviewdecision:${d.id}`} actions={linkable} label={t('Link')} />
                    </>
                  )}
                  {!d.cancelled && !d.actionId && canAbandon && <AbandonDecisionButton decision={d} />}
                </span>
              </div>
            ))}
            {!decisions.length && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{t('No decision entered.')}</div>}
            {extraActions.length > 0 && (
              <>
                <div className="vg-h6" style={{ marginTop: 4 }}>{t('Other linked actions')}</div>
                {extraActions.map((a) => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                    <ActionLink action={a} id={a.id} compact />
                    <span style={{ flex: 1, minWidth: 140 }}>{a.title}</span>
                    {actionEdit && <LinkActionButton link={`review:${review.id}`} current={a.id} />}
                  </div>
                ))}
              </>
            )}
            {edit && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                <button type="button" className="vg-text-btn" onClick={() => setEditing({ kind: 'decision', id: null })}>
                  <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden /> {t('Add a decision')}
                </button>
                {actionEdit && (
                  <>
                    <NewActionButton label={t('New action')} className="vg-text-btn" options={options} defaults={reviewActionDefaults(review.id, defaults.originRef)} />
                    <LinkActionButton link={`review:${review.id}`} actions={linkable} />
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* AUD-17 : pièces de la revue (présentation, liste d'émargement…), figées au visa de la direction. */}
        {review && review.status !== 'annulee' && (reviewFiles.length > 0 || (edit && flags.editable)) && (
          <EntityFiles kind="review" entityId={review.id} title={t('Review documents')} kicker={fill(t('Review of {date}'), { date: fmtDate(review.reviewOn) })} files={reviewFiles}
            canAdd={edit && flags.editable} emptyText={t('No attachment.')} hint={t('Presentation, attendance sheet, signed minutes · 10 MB per file.')} />
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {edit && review && (
            <button type="button" className={`btn ${review.status === 'tenue' ? 'btn-secondary' : 'btn-primary'} vg-btn-sm`} disabled={notYet}
              title={notYet ? fill(t('The review has not taken place yet (planned on {date}).'), { date: fmtDate(review.reviewOn) }) : undefined}
              onClick={() => setEditing({ kind: 'hold' })}>
              <i className="ph ph-note-pencil" style={{ fontSize: 13 }} aria-hidden />{review.status === 'tenue' ? t('Edit the minutes') : t('Enter the minutes')}
            </button>
          )}
          {flags.canSign && review?.status === 'tenue' && !flags.closeBlockers.length && <CloseReviewButton id={review.id} allSites={allSites} />}
          {flags.canApprove && review?.status === 'tenue' && flags.closeBlockers.length > 0 && (
            <span role="note" style={{ flexBasis: '100%', fontSize: 12, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
              <i className="ph ph-seal-warning" style={{ fontSize: 13, marginRight: 4 }} aria-hidden />
              {t('Before the management sign-off: ')}{flags.closeBlockers.join(' ')}
            </span>
          )}
          {flags.canApprove && !flags.canSign && review?.status === 'tenue' && !flags.closeBlockers.length && (
            <span style={{ fontSize: 12, color: 'var(--color-neutral-300)' }}>{t('Awaiting the management sign-off.')}</span>
          )}
          {flags.canEdit && (
            <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => setEditing({ kind: 'create' })}>
              <i className="ph ph-calendar-plus" style={{ fontSize: 13 }} aria-hidden />{t('Prepare the next review')}
            </button>
          )}
        </div>

        {/* ── Historique des revues ── */}
        {data.reviews.length > 0 && (
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <div className="vg-h6">{t('History of the reviews')}</div>
              {cancelledCount > 0 && (
                <Link href={hrefWith('/audits', params, { revues: showCancelled ? undefined : 'annulees' })} scroll={false} className="vg-link">
                  {showCancelled ? t('Hide the cancelled ones') : fill(t('Show the cancelled ones ({n})'), { n: cancelledCount })}
                </Link>
              )}
            </div>
            {history.map((r) => (
              <div key={r.id} className={styles.histRow} aria-current={r.id === review?.id} title={r.cancelled && r.cancelReason ? `${t('Reason: ')}${r.cancelReason}` : undefined}>
                <Link href={hrefWith('/audits', params, { annee: String(yearOf(r.reviewOn)), revue: String(r.id) })} scroll={false} className={`vg-link ${styles.histDate}`}>
                  {fmtDate(r.reviewOn)}
                </Link>
                <span style={{ color: 'var(--color-neutral-400)', minWidth: 64 }}>{r.kindShort}</span>
                <ToneTag tone={r.statusTone} style={{ whiteSpace: 'nowrap', fontSize: 11 }}>{r.statusLabel}</ToneTag>
                {!r.cancelled && flags.canDossier && (
                  <a href={`/revue-de-direction?revue=${r.id}`} target="_blank" rel="noopener" className="vg-link" style={{ marginLeft: 'auto' }}>
                    <i className="ph ph-file-text" style={{ fontSize: 12 }} aria-hidden /> {t('File#dossier')}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* AUD-34 : rectificatifs d'une revue clôturée (dossier figé inchangé), signés par la direction. */}
        {review?.status === 'cloturee' && (corrections.length > 0 || (flags.canEdit && flags.canSign)) && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="vg-h6">{t('Corrections after the sign-off')}</div>
            {corrections.map((c) => (
              <div key={c.id} style={{ display: 'grid', gap: 2, fontSize: 12.5 }}>
                <span style={{ whiteSpace: 'pre-line', textWrap: 'pretty' }}>{c.text}</span>
                <span style={muted}>{fill(t('Signed by {name} on {date} · reason: {reason}'), { name: c.by, date: fmtDate(c.on), reason: c.reason })}</span>
              </div>
            ))}
            {!corrections.length && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{t('No correction.')}</div>}
            {flags.canEdit && flags.canSign && <span><CorrectionButton review={review} /></span>}
          </div>
        )}

        {review && <ChangeLogList entries={changes} title={t('History of the review')} />}
      </div>

      <Dialog open={!!editing} onClose={close} kicker={kicker} width={editing?.kind === 'hold' ? 620 : 500} title={title}>
        {editing?.kind === 'item' && review && (
          <>
            <ItemForm reviewId={review.id} version={data.version} item={item} people={people} canDelete={review.status === 'planifiee' && !item?.files.length} onClose={close} />
            {/* AUD-17 : pièces de l'élément d'entrée (rapport, tableau de bord fourni par le contributeur). */}
            {item && !item.auto && (
              <EntityFiles kind="review_item" entityId={item.id} title={t('Item documents')} kicker={item.label} files={item.files}
                canAdd={item.canAttach} emptyText={t('No attachment.')} />
            )}
          </>
        )}
        {editing?.kind === 'decision' && review && (
          <DecisionForm reviewId={review.id} version={data.version} decision={decision} people={people} canDelete={review.status === 'planifiee'} onClose={close} />
        )}
        {editing?.kind === 'hold' && review && <HoldForm review={review} version={data.version} people={people} now={now} next={defaults.holdNext} allSites={allSites} onClose={close} />}
        {editing?.kind === 'reschedule' && review && <RescheduleForm review={review} onClose={close} />}
        {editing?.kind === 'create' && (
          <CreateReviewForm nextOn={defaults.nextOn} kind={review?.kind === 'ordinaire' ? 'intermediaire' : 'ordinaire'} copyFrom={defaults.copyFrom}
            copyLabel={review ? fill(t('review of {date}'), { date: fmtDate(review.reviewOn) }) : null} onClose={close} />
        )}
      </Dialog>
    </div>
  );
}
