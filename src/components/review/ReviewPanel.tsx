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
  const kicker = review ? `Revue de direction du ${fmtDate(review.reviewOn)}` : 'Revue de direction';
  const title = (() => {
    switch (editing?.kind) {
      case 'item': return item ? "Modifier l'élément" : 'Nouvel élément à préparer';
      case 'decision': return decision ? 'Modifier la décision' : 'Nouvelle décision, objectif ou besoin';
      case 'hold': return 'Compte rendu de la revue';
      case 'create': return 'Préparer la prochaine revue';
      case 'reschedule': return 'Reporter la revue';
      default: return '';
    }
  })();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, alignItems: 'start' }}>
      {/* ── Préparation ── */}
      <div className="card" style={{ gap: 8 }}>
        <CardHead title="Préparation de la revue de direction"
          aside={review ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Aside>{review.kindShort} {fmtDate(review.reviewOn)} · {provided}/{list.length} éléments fournis</Aside>
              <ToneTag tone={review.statusTone} style={{ whiteSpace: 'nowrap' }}>{review.statusLabel}</ToneTag>
            </span>
          ) : <Aside>Aucune revue planifiée</Aside>} />
        {review?.status === 'annulee' && (
          <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
            Annulée le {review.cancelledOn ? fmtDate(review.cancelledOn) : '—'}{review.cancelledBy ? ` par ${review.cancelledBy}` : ''} · {review.cancelReason}
          </div>
        )}
        {list.map((r) => {
          const icon = <Icon name={r.done ? 'ph-check-circle' : 'ph-circle'} size={15} style={{ color: r.done ? TONE.ok.dot : 'var(--color-neutral-600)' }} />;
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0', fontSize: 12.5 }}>
              {r.auto ? (
                <span className={styles.auto} title={`Calculé par Vigie · ${r.done ? 'données disponibles' : 'pas encore de données'}`}>{icon}</span>
              ) : r.canToggle ? (
                // Rôles qui saisissent, ou le contributeur lui-même (consultation de l'écran comprise, AUD-04).
                <button type="button" className={styles.check} aria-pressed={r.done} aria-label={r.label} title={r.done ? 'Marquer comme non fourni' : 'Marquer comme fourni'} onClick={() => toggle(r)}>{icon}</button>
              ) : <span className={styles.auto}>{icon}</span>}
              {edit ? (
                <button type="button" className={styles.textBtn} title="Modifier l'élément" onClick={() => setEditing({ kind: 'item', id: r.id })}
                  style={{ flex: 1, color: r.done ? 'var(--color-neutral-400)' : 'var(--color-text)' }}>{r.label}<span className="vg-sr-only"> : modifier l&apos;élément</span></button>
              ) : (
                <span style={{ flex: 1, color: r.done ? 'var(--color-neutral-400)' : 'var(--color-text)' }}>{r.label}</span>
              )}
              {r.files.length > 0 && (
                <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--color-neutral-400)' }} title={r.files.map((f) => f.name).join(', ')}>
                  <Icon name="ph-paperclip" size={12} /> {r.files.length}
                </span>
              )}
              <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: r.late ? TONE.danger.fg : 'var(--color-neutral-500)' }}
                title={r.late && r.dueOn ? `Attendu le ${fmtDate(r.dueOn)}` : r.sourceLabel}>{r.ownerLabel}</span>
            </div>
          );
        })}
        {review && !list.length && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: '4px 0' }}>Aucun élément à préparer pour l&apos;instant.</div>}
        {!review && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: '4px 0' }}>Planifiez la prochaine revue pour préparer sa check-list.</div>}
        <SaveStatus pending={pending} />
        {error && <div role="alert" style={{ fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>{error}</div>}
        {review && review.status !== 'annulee' && (
          // Échéance de la revue au programme annuel (AUD-01).
          <div style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
            {programme ? (
              <>Au programme : <Link href={`/audits?annee=${programme.year}&element=${programme.id}`} scroll={false} className="vg-link">{programme.label}</Link> · {programme.stateLabel}</>
            ) : 'Hors programme annuel'}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4 }}>
          {review && review.status !== 'annulee' && flags.canDossier && (
            // Lien HTML simple : la feuille globale du dossier ne doit pas rester chargée dans l'application.
            <a href={`/revue-de-direction?revue=${review.id}`} target="_blank" rel="noopener" className="btn btn-primary vg-btn-sm">
              <i className="ph ph-file-text" style={{ fontSize: 13 }} aria-hidden />{review.status === 'cloturee' ? 'Consulter le dossier' : 'Générer le dossier de revue'}
            </a>
          )}
          {edit && (
            <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setEditing({ kind: 'item', id: null })}>
              <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />Ajouter un élément
            </button>
          )}
          {flags.canEdit && review?.status === 'planifiee' && (
            <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => setEditing({ kind: 'reschedule' })}>
              <i className="ph ph-calendar-blank" style={{ fontSize: 13 }} aria-hidden />Reporter
            </button>
          )}
          {flags.canApprove && review?.status === 'planifiee' && <CancelReviewButton review={review} />}
          {flags.mine && (
            <Link href={review ? `/audits/contributions?revue=${review.id}` : '/audits/contributions'} className="vg-link" style={{ fontSize: 12 }}>
              Mes contributions
            </Link>
          )}
        </div>
      </div>

      {/* ── Séance, décisions et objectifs ── */}
      <div className="card" style={{ gap: 10 }}>
        <CardHead title="Séance, décisions et objectifs" aside={previous ? <Aside>Précédente : {previous.kindShort} {fmtDate(previous.reviewOn)}</Aside> : undefined} />

        {review && held && (
          <div style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
            <div><span style={muted}>Participants · </span>{[...review.participants, review.externalParticipants].filter(Boolean).join(', ') || '—'}</div>
            {review.minutes && <div style={{ color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{review.minutes}</div>}
            {/* AUD-35 : perception des clients (§9.3.2 c1) et besoins en ressources (§9.3.3 c) saisis au compte rendu. */}
            {review.customerPerception && <div style={{ whiteSpace: 'pre-line', textWrap: 'pretty' }}><span style={muted}>Perception des clients · </span>{review.customerPerception}</div>}
            {review.resourceNeeds && <div style={{ whiteSpace: 'pre-line', textWrap: 'pretty' }}><span style={muted}>Besoins en ressources · </span>{review.resourceNeeds}</div>}
            {review.closedOn && <div style={muted}>Visa de la direction : {review.closedBy ?? '—'} le {fmtDate(review.closedOn)}</div>}
          </div>
        )}
        {review?.nextReviewOn && <div style={{ fontSize: 12.5 }}><span style={muted}>Prochaine revue le </span>{fmtDate(review.nextReviewOn)}</div>}

        {review && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="vg-h6">Décisions et objectifs</div>
            {decisions.map((d) => (
              <div key={d.id} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '2px 8px', alignItems: 'baseline', fontSize: 12.5 }}>
                <ToneTag tone={d.cancelled ? 'neutral' : d.tone} style={{ whiteSpace: 'nowrap', fontSize: 11 }}>{d.kindLabel}</ToneTag>
                {/* AUD-36 : décision abandonnée après la séance, barrée (consultation seule). */}
                {d.cancelled ? <span style={{ textDecoration: 'line-through', color: 'var(--color-neutral-400)' }}>{d.text}</span> : edit ? (
                  <button type="button" className={styles.textBtn} onClick={() => setEditing({ kind: 'decision', id: d.id })} title="Modifier">{d.text}</button>
                ) : <span>{d.text}</span>}
                <span />
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', ...muted }}>
                  <span>{d.pilot}{d.dueOn ? ` · ${fmtDayMonth(d.dueOn)}` : ''}</span>
                  {d.cancelled ? (
                    <span>Abandonnée le {fmtDate(d.cancelled.on)} par {d.cancelled.by} · motif : {d.cancelled.reason}</span>
                  ) : d.actionId ? (
                    <>
                      <ActionLink action={d.action} id={d.actionId} />
                      {actionEdit && <LinkActionButton link={`reviewdecision:${d.id}`} current={d.actionId} tooltip={`Détacher ${d.actionId} de la décision (l'action reste dans le plan, rattachée à la revue)`} />}
                    </>
                  ) : actionEdit && (
                    <>
                      <NewActionButton label="Créer l'action" icon="ph-plus" className="vg-text-btn" options={options}
                        defaults={decisionActionDefaults(d, defaults.originRef)} />
                      <LinkActionButton link={`reviewdecision:${d.id}`} actions={linkable} label="Rattacher" />
                    </>
                  )}
                  {!d.cancelled && !d.actionId && canAbandon && <AbandonDecisionButton decision={d} />}
                </span>
              </div>
            ))}
            {!decisions.length && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Aucune décision saisie.</div>}
            {extraActions.length > 0 && (
              <>
                <div className="vg-h6" style={{ marginTop: 4 }}>Autres actions rattachées</div>
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
                  <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden /> Ajouter une décision
                </button>
                {actionEdit && (
                  <>
                    <NewActionButton label="Nouvelle action" className="vg-text-btn" options={options} defaults={reviewActionDefaults(review.id, defaults.originRef)} />
                    <LinkActionButton link={`review:${review.id}`} actions={linkable} />
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* AUD-17 : pièces de la revue (présentation, liste d'émargement…), figées au visa de la direction. */}
        {review && review.status !== 'annulee' && (reviewFiles.length > 0 || (edit && flags.editable)) && (
          <EntityFiles kind="review" entityId={review.id} title="Pièces de la revue" kicker={`Revue du ${fmtDate(review.reviewOn)}`} files={reviewFiles}
            canAdd={edit && flags.editable} emptyText="Aucune pièce jointe." hint="Présentation, liste d'émargement, compte rendu signé · 10 Mo par fichier." />
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {edit && review && (
            <button type="button" className={`btn ${review.status === 'tenue' ? 'btn-secondary' : 'btn-primary'} vg-btn-sm`} disabled={notYet}
              title={notYet ? `La revue n'a pas encore eu lieu (prévue le ${fmtDate(review.reviewOn)}).` : undefined}
              onClick={() => setEditing({ kind: 'hold' })}>
              <i className="ph ph-note-pencil" style={{ fontSize: 13 }} aria-hidden />{review.status === 'tenue' ? 'Modifier le compte rendu' : 'Saisir le compte rendu'}
            </button>
          )}
          {flags.canSign && review?.status === 'tenue' && !flags.closeBlockers.length && <CloseReviewButton id={review.id} allSites={allSites} />}
          {flags.canApprove && review?.status === 'tenue' && flags.closeBlockers.length > 0 && (
            <span role="note" style={{ flexBasis: '100%', fontSize: 12, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
              <i className="ph ph-seal-warning" style={{ fontSize: 13, marginRight: 4 }} aria-hidden />
              Avant le visa de la direction : {flags.closeBlockers.join(' ')}
            </span>
          )}
          {flags.canApprove && !flags.canSign && review?.status === 'tenue' && !flags.closeBlockers.length && (
            <span style={{ fontSize: 12, color: 'var(--color-neutral-300)' }}>En attente du visa de la direction.</span>
          )}
          {flags.canEdit && (
            <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => setEditing({ kind: 'create' })}>
              <i className="ph ph-calendar-plus" style={{ fontSize: 13 }} aria-hidden />Préparer la prochaine revue
            </button>
          )}
        </div>

        {/* ── Historique des revues ── */}
        {data.reviews.length > 0 && (
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <div className="vg-h6">Historique des revues</div>
              {cancelledCount > 0 && (
                <Link href={hrefWith('/audits', params, { revues: showCancelled ? undefined : 'annulees' })} scroll={false} className="vg-link">
                  {showCancelled ? 'Masquer les annulées' : `Afficher les annulées (${cancelledCount})`}
                </Link>
              )}
            </div>
            {history.map((r) => (
              <div key={r.id} className={styles.histRow} aria-current={r.id === review?.id} title={r.cancelled && r.cancelReason ? `Motif : ${r.cancelReason}` : undefined}>
                <Link href={hrefWith('/audits', params, { annee: String(yearOf(r.reviewOn)), revue: String(r.id) })} scroll={false} className={`vg-link ${styles.histDate}`}>
                  {fmtDate(r.reviewOn)}
                </Link>
                <span style={{ color: 'var(--color-neutral-400)', minWidth: 64 }}>{r.kindShort}</span>
                <ToneTag tone={r.statusTone} style={{ whiteSpace: 'nowrap', fontSize: 11 }}>{r.statusLabel}</ToneTag>
                {!r.cancelled && flags.canDossier && (
                  <a href={`/revue-de-direction?revue=${r.id}`} target="_blank" rel="noopener" className="vg-link" style={{ marginLeft: 'auto' }}>
                    <i className="ph ph-file-text" style={{ fontSize: 12 }} aria-hidden /> Dossier
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* AUD-34 : rectificatifs d'une revue clôturée (dossier figé inchangé), signés par la direction. */}
        {review?.status === 'cloturee' && (corrections.length > 0 || (flags.canEdit && flags.canSign)) && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="vg-h6">Rectificatifs après le visa</div>
            {corrections.map((c) => (
              <div key={c.id} style={{ display: 'grid', gap: 2, fontSize: 12.5 }}>
                <span style={{ whiteSpace: 'pre-line', textWrap: 'pretty' }}>{c.text}</span>
                <span style={muted}>Signé par {c.by} le {fmtDate(c.on)} · motif : {c.reason}</span>
              </div>
            ))}
            {!corrections.length && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Aucun rectificatif.</div>}
            {flags.canEdit && flags.canSign && <span><CorrectionButton review={review} /></span>}
          </div>
        )}

        {review && <ChangeLogList entries={changes} title="Historique de la revue" />}
      </div>

      <Dialog open={!!editing} onClose={close} kicker={kicker} width={editing?.kind === 'hold' ? 620 : 500} title={title}>
        {editing?.kind === 'item' && review && (
          <>
            <ItemForm reviewId={review.id} item={item} people={people} canDelete={review.status === 'planifiee' && !item?.files.length} onClose={close} />
            {/* AUD-17 : pièces de l'élément d'entrée (rapport, tableau de bord fourni par le contributeur). */}
            {item && !item.auto && (
              <EntityFiles kind="review_item" entityId={item.id} title="Pièces de l'élément" kicker={item.label} files={item.files}
                canAdd={item.canAttach} emptyText="Aucune pièce jointe." />
            )}
          </>
        )}
        {editing?.kind === 'decision' && review && (
          <DecisionForm reviewId={review.id} decision={decision} people={people} canDelete={review.status === 'planifiee'} onClose={close} />
        )}
        {editing?.kind === 'hold' && review && <HoldForm review={review} people={people} now={now} next={defaults.holdNext} allSites={allSites} onClose={close} />}
        {editing?.kind === 'reschedule' && review && <RescheduleForm review={review} onClose={close} />}
        {editing?.kind === 'create' && (
          <CreateReviewForm nextOn={defaults.nextOn} kind={review?.kind === 'ordinaire' ? 'intermediaire' : 'ordinaire'} copyFrom={defaults.copyFrom}
            copyLabel={review ? `revue du ${fmtDate(review.reviewOn)}` : null} onClose={close} />
        )}
      </Dialog>
    </div>
  );
}
