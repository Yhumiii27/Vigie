'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionFields } from '@/components/ActionFormDialog';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Checkbox, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { LinkActionButton } from '@/components/LinkActionButton';
import { ReasonButton } from '@/components/ReasonDialog';
import { Dot, Icon, ToneTag } from '@/components/ui';
import { QHSE_ONLY_CREATE_MESSAGE, actionHref } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { ATTACH_ACCEPT } from '@/lib/attachments';
import { fmtDate } from '@/lib/dates';
import { REQUIREMENT_EVAL, REQUIREMENT_LINKS, REQUIREMENT_NEEDS_ACTION, REQUIREMENT_REVIEW_MAX, REQUIREMENT_REVIEW_MONTHS, TONE, isRequirementLink } from '@/lib/domain';
import type { FormOptions } from '@/lib/data/options';
import { LEFT_SUFFIX, withCurrent, type Option } from '@/lib/form-options';
import type { RequirementView } from '@/lib/data/watch';
import { EntityFiles } from '@/components/EntityFiles';
import { archiveRequirement, cancelRequirementEvaluation, evaluateRequirement, restoreRequirement, saveRequirement } from '@/server/watch';
import { requirementActionDefaults } from './action-defaults';
import { ArchivedBanner, filesHint, Facts, FileError, Notice, ViewSwitch, checkPickedFiles, muted, rowOpener } from './parts';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

/** `applicableSites` (VEI-10) : sites proposés pour l'applicabilité d'une exigence — périmètre complet seulement, sinon vide. */
type Opts = Pick<FormOptions, 'people' | 'sites'> & { applicableSites?: readonly Option[]; certifications?: readonly Option[] };
/**
 * Plan d'actions (ACT-22, réponses du service QHSE du 15/10/2026) : `actionOptions` (listes du formulaire d'action) et
 * `linkActions` (actions ouvertes à rattacher) ne sont fournis qu'au service QHSE, seul à créer une action et à modifier
 * ses rattachements ; absents pour les autres rôles.
 */
type ActionProps = { actionOptions?: ActionFormOptions | null; linkActions?: readonly Option[] };
type Featured = { id: number; text: string } | null;
type View = 'fiche' | 'evaluer' | 'historique';
type EvalInitial = { evaluation: string; note: string | null };

const EVALS = Object.entries(REQUIREMENT_EVAL);
const EVAL_OPTIONS = EVALS.map(([k, v]) => [k, v.label] as const);
/** VEI-07 : indicateurs calculés auxquels rattacher l'exigence (liste fermée). */
const LINK_OPTIONS = Object.entries(REQUIREMENT_LINKS).map(([k, v]) => [k, v.label] as const);
const NEEDS_ACTION = new Set<string>(REQUIREMENT_NEEDS_ACTION);
const plural = (n: number, one: string, many: string) => fill(n > 1 ? many : one, { n });

// ─── Tableau des exigences ──────────────────────────────────────────────────

export function RequirementsPanel({ rows, archives = false, canManage, canApprove, options, actionOptions, linkActions, today, initialId, closeHref, emptyText }: ActionProps & {
  /** Liste vide par l'effet des filtres (VEI-13). */
  emptyText?: string;
  /** Toutes les exigences (archivées comprises) : la fiche ouverte reste affichée après son archivage. */
  rows: RequirementView[];
  /** Liste des exigences archivées (`?etat=archives`, UX-12) au lieu des exigences en vigueur. */
  archives?: boolean;
  canManage: boolean;
  /** Animateur QHSE, direction : restauration d'une exigence archivée. */
  canApprove: boolean;
  options: Opts;
  today: string;
  /** Exigence à ouvrir d'emblée (lien profond `?exigence=<id>`). */
  initialId?: number;
  /** URL sans le lien profond, rétablie à la fermeture. */
  closeHref?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [selId, setSelId] = useState<number | null>(initialId ?? null);
  const sel = rows.find((r) => r.id === selId) ?? null;
  const shown = rows.filter((r) => r.archived === archives);
  const featured = rows.find((r) => r.featured && !r.archived);
  const close = () => {
    setSelId(null);
    if (closeHref) router.replace(closeHref, { scroll: false });
  };

  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 980 }}>
          <thead><tr><th>{t('Text')}</th><th>{t('Domain')}</th><th>{t('What it requires')}</th><th>{t('Deadline')}</th><th>{t('Evaluation')}</th><th>{t('Lead')}</th><th>{t('Action')}</th></tr></thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={7} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
                {emptyText ?? (archives ? t('No archived requirement.') : t('No requirement followed yet.'))}
              </td></tr>
            )}
            {shown.map((r) => (
              <tr key={r.id} {...rowOpener(() => setSelId(r.id))} data-obsolete={r.archived || undefined}>
                <td style={{ fontWeight: 500, minWidth: 160 }}>
                  {r.text}
                  {r.featured && (
                    <span title={t('Highlighted on the dashboard')} style={{ marginLeft: 6, color: 'var(--color-accent)', verticalAlign: 'middle' }}>
                      <Icon name="ph-push-pin" size={12} />
                    </span>
                  )}
                  {r.archivedLabel && <div style={{ ...muted, fontWeight: 400, marginTop: 2 }}>{r.archivedLabel}</div>}
                </td>
                <td style={{ color: 'var(--color-neutral-400)', minWidth: 130 }}>{r.domain}</td>
                <td style={{ color: 'var(--color-neutral-300)', maxWidth: 340, textWrap: 'pretty' }}>{r.summary}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.due || '—'}</td>
                <td>
                  <ToneTag tone={r.tone} style={{ whiteSpace: 'nowrap' }}>{r.evalLabel}</ToneTag>
                  {r.lastEvaluated && (
                    <div style={{ ...muted, marginTop: 3, whiteSpace: 'nowrap' }}>
                      {r.evaluation === 'a_evaluer' ? t('Reviewed on') : t('Evaluated on')} {r.lastEvaluated}
                    </div>
                  )}
                  {r.nextReview && r.nextReview.tone !== 'neutral' && (
                    <div style={{ ...muted, marginTop: 2, whiteSpace: 'nowrap', color: TONE[r.nextReview.tone].dot }}>{r.nextReview.label}</div>
                  )}
                  {r.indicator && (
                    <div title={t('Indicator computed by Vigie')} style={{ ...muted, marginTop: 2, maxWidth: 220, color: r.indicator.tone === 'ok' ? muted.color : TONE[r.indicator.tone].dot }}>
                      <Icon name="ph-calculator" size={11} /> {r.indicator.label}
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.pilot || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.actionId ? (
                    <>
                      <Link href={actionHref(r.actionId)} className="vg-link">{r.actionId}</Link>
                      {r.action && <div style={{ ...muted, marginTop: 2, color: r.action.late ? TONE.danger.dot : muted.color }}>{labelT(t)(r.action.statusLabel)}</div>}
                    </>
                  ) : r.needsAction ? (
                    <span style={{ color: TONE.danger.dot }}>{t('To define')}</span>
                  ) : (
                    <span style={{ color: 'var(--vg-text-muted)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!sel} onClose={close} width={660}
        kicker={sel ? `${t('Regulatory watch')} · ${sel.domain}${sel.archived ? t(' · archived#f') : ''}` : undefined} title={sel?.text ?? ''}>
        {sel && (
          <RequirementDetail key={sel.id} r={sel} canManage={canManage} canApprove={canApprove} options={options} actionOptions={actionOptions}
            linkActions={linkActions} today={today}
            featured={featured && featured.id !== sel.id ? { id: featured.id, text: featured.text } : null} onClose={close} />
        )}
      </Dialog>
    </div>
  );
}

/** Bouton « Ajouter une exigence ». */
export function AddRequirementButton({ options, featured }: { options: Opts; featured: Featured }) {
  const { t } = useI18n();
  return (
    <DialogButton label={t('Add a requirement')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('New requirement')} kicker={t('Regulatory watch')} width={660}>
      {(close) => <RequirementForm options={options} featured={featured} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

// ─── Fiche d'une exigence ───────────────────────────────────────────────────

function RequirementDetail({ r, canManage, canApprove, options, actionOptions, linkActions, today, featured, onClose }: ActionProps & {
  r: RequirementView; canManage: boolean; canApprove: boolean; options: Opts; today: string; featured: Featured; onClose: () => void;
}) {
  const { t } = useI18n();
  const editable = canManage && !r.archived;
  // Création et rattachements d'actions : service QHSE seulement (ACT-22), sur une exigence en vigueur.
  const creatable = !r.archived && actionOptions ? actionOptions : null;
  const [view, setView] = useState<View>('fiche');
  // « Créer l'action » s'affiche dans cette fenêtre, à la place du formulaire de la fiche : une fenêtre
  // NewActionButton imbriquée dupliquerait les identifiants de champs de la fiche (pilotId, dueOn).
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<'evaluated' | 'action' | 'restored' | null>(null);
  // Évaluation préremplie (suggestion « Écart » quand un contrôle rattaché est dépassé).
  const [evalInitial, setEvalInitial] = useState<EvalInitial | undefined>(undefined);
  const show = (v: View) => { setNotice(null); setEvalInitial(undefined); setView(v); };
  const views: (readonly [View, string, string])[] = [
    ['fiche', t('Record'), editable ? 'ph-pencil-simple' : 'ph-file-text'],
    ...(editable ? [['evaluer', t('Evaluate'), 'ph-seal-check'] as const] : []),
    ['historique', `${t('History')} · ${r.evaluations.length}`, 'ph-clock-counter-clockwise'],
  ];

  return (
    <>
      <Facts items={[
        [t('Evaluation'), <ToneTag key="e" tone={r.tone} style={{ marginTop: 1 }}>{r.evalLabel}</ToneTag>],
        [t('Last evaluation'), r.lastEvaluated ?? (r.evaluation === 'a_evaluer' ? t('Never evaluated') : t('Not dated'))],
        r.nextReview && [t('Re-evaluation'), <span key="r" style={{ color: r.nextReview.tone === 'neutral' ? undefined : TONE[r.nextReview.tone].dot }}>{r.nextReview.label.replace('Réévaluation avant', 'Avant')}</span>],
        // VEI-18 : périodicité propre à l'exigence (12 mois par défaut).
        [t('Frequency'), fill(t('Re-evaluation every {n} months'), { n: r.reviewEvery }) + (r.reviewMonths == null ? t(' (default)') : '')],
        [t('Deadline'), r.due || '—'],
        r.indicator && [t('Computed indicator'), (
          <Link key="i" href={r.indicator.href} className="vg-link" style={{ fontSize: 12.5, color: r.indicator.tone === 'ok' ? undefined : TONE[r.indicator.tone].dot }}>
            {r.indicator.label}
          </Link>
        )],
        // VEI-07 : indicateur rattaché sans état calculé ici (registre et bordereaux des déchets : écran Environnement).
        !r.indicator && isRequirementLink(r.linkedTo) && [t('Linked indicator'), r.linkedTo.startsWith('waste')
          ? <Link key="l" href="/environnement" className="vg-link" style={{ fontSize: 12.5 }}>{labelT(t)(REQUIREMENT_LINKS[r.linkedTo].label)}</Link>
          : labelT(t)(REQUIREMENT_LINKS[r.linkedTo].label)],
        [t('Lead'), r.pilot || '—'],
        // VEI-10 : applicabilité par site et lien vers le texte.
        [t('Sites concerned'), r.siteLabels.length ? r.siteLabels.join(', ') : t('All sites')],
        !!r.legifranceUrl && [t('Text'), <a key="t" href={r.legifranceUrl} target="_blank" rel="noreferrer noopener" className="vg-link" style={{ fontSize: 12.5 }}>{t('See the official text')}</a>],
        r.projects.count != null && [t('Keystone projects'), plural(r.projects.count, t('{n} concerned'), t('{n} concerned#plural'))],
        r.featured && [t('Dashboard'), <span key="f" style={{ color: 'var(--color-accent)' }}><Icon name="ph-push-pin" size={12} /> {t('Featured')}</span>],
      ]} />

      {r.archived && (
        <ArchivedBanner title={t('Text repealed · requirement archived')} label={r.archivedLabel}>
          {canApprove && (
            <ReasonButton label={t('Restore')} icon="ph-arrow-counter-clockwise" title={fill(t('Restore “{text}”'), { text: r.text })} kicker={t('Regulatory watch')}
              action={restoreRequirement} hidden={{ id: r.id }} submitLabel={t('Restore the requirement')} submitIcon="ph-arrow-counter-clockwise"
              message={t('The requirement comes back in the watch in force, with its evaluation history.')}
              placeholder={t('E.g. archived by mistake, text back in force')} onDone={() => setNotice('restored')} />
          )}
        </ArchivedBanner>
      )}

      {notice && (
        <Notice>
          {notice === 'action' ? t('Action created and linked to the requirement.')
            : notice === 'restored' ? t('Requirement restored in the watch in force.')
              : fill(t('Evaluation recorded on {date}.'), { date: fmtDate(today) })}
        </Notice>
      )}

      {editable && r.suggestGap && view !== 'evaluer' && !creating && (
        <div className="vg-inset" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', fontSize: 12.5, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${TONE.warn.dot} 45%, transparent)` }}>
          <Icon name="ph-warning" size={15} style={{ color: TONE.warn.dot }} />
          <span style={{ flex: 1, minWidth: 180, textWrap: 'pretty' }}>
            {r.suggestReason}{t(': consider the “Gap” evaluation.')}
            {r.suggestNote && <span style={{ ...muted, display: 'block' }}>{r.suggestNote}</span>}
          </span>
          <button type="button" className="btn btn-secondary vg-btn-sm"
            onClick={() => { setNotice(null); setView('evaluer'); setEvalInitial({ evaluation: 'ecart', note: r.suggestNote }); }}>
            <Icon name="ph-seal-check" size={13} />{t('Evaluate')}
          </button>
        </div>
      )}

      <LinkedAction r={r} actions={linkActions && !r.archived ? linkActions : undefined} canUnlink={!!linkActions} showQhseNotice={editable && !creatable}
        onCreate={creatable && !creating ? () => { setNotice(null); setCreating(true); } : undefined}
        onEvaluate={editable && !creating ? () => { setNotice(null); setView('evaluer'); } : undefined} />

      {creatable && creating ? (
        <>
          <div className="vg-eyebrow">{t('New action · single action plan')}</div>
          {/* Rendu sur un état local seulement : l'action liée arrive avec le même rafraîchissement que le succès du formulaire. */}
          <ActionFields options={creatable} defaults={requirementActionDefaults(r, today)}
            onCancel={() => setCreating(false)} onDone={() => { setCreating(false); setView('fiche'); setNotice('action'); }} />
        </>
      ) : (
        <>
          <ViewSwitch name={`requirement-view-${r.id}`} value={view} onChange={show} options={views} />
          {/* Pas de `key` dérivée des données : l'enregistrement les modifie et remonterait le formulaire avant son onDone. */}
          {view === 'fiche' && (
            <>
              <LinkedControls r={r} />
              <EntityFiles kind="requirement" entityId={r.id} title={t('Regulatory text attached')} kicker={r.text} files={r.textFiles} canAdd={editable}
                emptyText={t('No text attached.')} hint={t('PDF of the text or applicable extract · 10 MB per file.')} />
              {editable ? (
                <>
                  <RequirementForm r={r} options={options} featured={featured} onDone={onClose} onCancel={onClose} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
                    <span style={{ ...muted, flex: 1, minWidth: 200, textWrap: 'pretty' }}>{t('Text repealed or no longer relevant? The requirement is archived with its reason, never deleted.')}</span>
                    <ReasonButton label={t('Archive the requirement')} icon="ph-archive" title={fill(t('Archive “{text}”'), { text: r.text })} kicker={t('Regulatory watch · text repealed')}
                      action={archiveRequirement} hidden={{ id: r.id }} submitLabel={t('Archive')} submitIcon="ph-archive"
                      message={t('The linked action stays in the action plan; the evaluation history is kept.') + (r.featured ? t(' The requirement is removed from the dashboard.') : '')}
                      placeholder={t('E.g. text repealed by the decree of …')} />
                  </div>
                </>
              ) : (
                <ReadOnly r={r} />
              )}
            </>
          )}
          {view === 'evaluer' && editable && (
            <EvaluateForm r={r} today={today} initial={evalInitial} onCancel={onClose}
              onDone={(evaluation) => {
                setEvalInitial(undefined);
                if (NEEDS_ACTION.has(evaluation) && !r.actionId) { setView('fiche'); setNotice('evaluated'); } else onClose();
              }} />
          )}
          {view === 'historique' && (
            <>
              <EvaluationHistory r={r} editable={editable} canCancel={canApprove && !r.archived} />
              <LazyChangeLog entity="requirement" id={r.id} title={t('Change log')} />
            </>
          )}
        </>
      )}
    </>
  );
}

function ReadOnly({ r }: { r: RequirementView }) {
  const { t } = useI18n();
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <div className="vg-eyebrow" style={{ marginBottom: 4 }}>{t('What it requires')}</div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{r.summary}</p>
      </div>
      {r.impact && (
        <div>
          <div className="vg-eyebrow" style={{ marginBottom: 4 }}>{t('Impact')}</div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{r.impact}</p>
        </div>
      )}
    </div>
  );
}

/** Contrôles périodiques rattachés à l'exigence (tous les sites du périmètre, VEI-06), statut calculé. */
function LinkedControls({ r }: { r: RequirementView }) {
  const { t } = useI18n();
  if (!r.controls.length) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="vg-eyebrow">{t('Linked periodic inspections')}</div>
      {r.controls.map((c) => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
          <Link href={`/veille?onglet=controles&controle=${c.id}`} className="vg-link" style={{ fontSize: 12.5, flex: 1, minWidth: 180 }}>
            {c.controlType} · {c.equipment}
          </Link>
          <span style={muted}>{c.siteLabel} · prochain le {c.next}</span>
          <ToneTag tone={c.tone} style={{ whiteSpace: 'nowrap' }}>{c.status}</ToneTag>
        </div>
      ))}
    </div>
  );
}

/**
 * Historique des évaluations de conformité : la plus récente d'abord. Une évaluation saisie par erreur s'annule avec un motif
 * (VEI-16, service QHSE et direction) : barrée, gardée à l'historique, l'évaluation courante est recalculée.
 */
function EvaluationHistory({ r, editable, canCancel }: { r: RequirementView; editable: boolean; canCancel: boolean }) {
  const { t } = useI18n();
  const latest = r.evaluations.find((e) => !e.cancelled)?.id;
  if (!r.evaluations.length) {
    return (
      <div className="vg-inset" style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--color-neutral-400)' }}>
        {t('No evaluation recorded in Vigie.')}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid' }}>
      {r.evaluations.map((e, i) => (
        <div key={e.id} className={i < r.evaluations.length - 1 ? 'vg-rule-bottom' : undefined}
          style={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', gap: 12, padding: '10px 0' }}>
          <div style={{ display: 'grid', gap: 2, alignContent: 'start' }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, textDecoration: e.cancelled ? 'line-through' : undefined }}>{e.date}</span>
            {e.id === latest && <span style={muted}>{t('Latest')}</span>}
            {e.cancelled && <span style={muted}>{t('Cancelled')}</span>}
          </div>
          <div style={{ display: 'grid', gap: 5, minWidth: 0 }}>
            <div style={e.cancelled ? { textDecoration: 'line-through' } : undefined}><ToneTag tone={e.cancelled ? 'neutral' : e.tone}>{e.label}</ToneTag></div>
            {e.note && <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{e.note}</p>}
            {e.cancelled && (
              <span style={{ fontSize: 11.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
                {fill(t('Cancelled on {date}'), { date: e.cancelled.on })}{e.cancelled.by && fill(t(' by {name}'), { name: e.cancelled.by })}{t(' — reason: ')}{e.cancelled.reason}
              </span>
            )}
            {/* VEI-08 : preuves complétées ou retirées (motif) après l'évaluation ; figées une fois l'évaluation annulée. */}
            {(e.files.length > 0 || (editable && !e.cancelled)) && (
              <EntityFiles kind="requirement_evaluation" entityId={e.id} title={t('Evidence')} kicker={`${r.text} · ${fill(t('evaluation of {date}'), { date: e.date })}`} files={e.files}
                canAdd={editable && !e.cancelled} emptyText={t('No evidence attached.')} />
            )}
            {e.by && <span style={muted}>{fill(t('Evaluated by {name}'), { name: e.by })}</span>}
            {canCancel && !e.cancelled && (
              <ReasonButton label={t('Cancel this evaluation')} icon="ph-prohibit" className="btn btn-ghost vg-btn-sm" style={{ justifySelf: 'start' }}
                title={t('Cancel the evaluation')} kicker={`${r.text} · ${fill(t('evaluation of {date}'), { date: e.date })}`} action={cancelRequirementEvaluation} hidden={{ id: e.id }}
                submitLabel={t('Cancel the evaluation')} submitIcon="ph-prohibit" placeholder={t('E.g. entered on the wrong requirement')}
                message={t('Evaluation entered by mistake: it is never deleted. It stays struck through in the history with its evidence, and the current evaluation of the requirement is recomputed from the remaining evaluations (“To evaluate” if none remains).')} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Action liée (lecture seule ; détachable par le QHSE) ou, pour un écart ou une analyse d'écart sans action, « Créer
 * l'action » / « Rattacher » (QHSE seulement, ACT-22) ; l'encadrement qui saisit la veille lit QHSE_ONLY_CREATE_MESSAGE.
 */
function LinkedAction({ r, actions, canUnlink, showQhseNotice, onCreate, onEvaluate }: {
  r: RequirementView; actions?: readonly Option[]; canUnlink: boolean; showQhseNotice: boolean; onCreate?: () => void;
  /** VEI-05 : « Réévaluer » (vue « Évaluer »), pour qui saisit la veille. */
  onEvaluate?: () => void;
}) {
  const { t } = useI18n();
  const box = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', fontSize: 12.5 } as const;
  const link = `requirement:${r.id}`;
  if (r.actionId) {
    return (
      <div className="vg-inset" style={box}>
        <Icon name="ph-list-checks" size={15} style={{ color: 'var(--color-accent)' }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: 'var(--color-neutral-500)' }}>{t('Linked action ')}</span>
          <Link href={actionHref(r.actionId)} className="vg-link" style={{ fontSize: 12.5 }}>{r.actionId}</Link>
          {r.action && <span> · {r.action.label}</span>}
          {r.action && <span style={{ ...muted, display: 'block', color: r.action.late ? TONE.danger.dot : muted.color }}>{fill(t('Target date {date}'), { date: r.action.due })}</span>}
        </span>
        {r.action && <ToneTag tone={r.action.tone} style={{ whiteSpace: 'nowrap' }}>{labelT(t)(r.action.statusLabel)}</ToneTag>}
        {canUnlink && !r.archived && <LinkActionButton link={link} current={r.actionId} />}
        {/* VEI-05 : action close, exigence toujours en écart : boucler par une nouvelle évaluation. */}
        {r.loopBack && (
          <span role="status" style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 8, borderTop: '1px solid var(--color-divider)' }}>
            <Icon name="ph-arrows-clockwise" size={15} style={{ color: TONE.warn.dot }} />
            <span style={{ flex: 1, minWidth: 180, textWrap: 'pretty' }}>
              {fill(t('Action {state}, requirement still {evaluation}: re-evaluate the compliance'), {
                state: r.loopBack.abandoned ? t('abandoned#f') : t('verified#f'),
                evaluation: r.evaluation === 'analyse' ? t('under gap analysis') : t('in gap'),
              })}
              {canUnlink ? t(', or unlink the action to create a new one.') : '.'}
            </span>
            {onEvaluate && (
              <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onEvaluate}>
                <Icon name="ph-seal-check" size={13} />{t('Re-evaluate')}
              </button>
            )}
          </span>
        )}
      </div>
    );
  }
  if (!NEEDS_ACTION.has(r.evaluation) || r.archived) return null;
  return (
    <div className="vg-inset" style={{ ...box, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${TONE.danger.dot} 45%, transparent)` }}>
      <Icon name="ph-warning-circle" size={15} style={{ color: TONE.danger.dot }} />
      <span style={{ flex: 1, minWidth: 180, textWrap: 'pretty' }}>
        {r.evaluation === 'ecart'
          ? t('Gap without a compliance action in the action plan.')
          : t('Gap analysis to follow in the action plan.')}
        {showQhseNotice && <span style={{ ...muted, display: 'block' }}>{QHSE_ONLY_CREATE_MESSAGE}</span>}
      </span>
      {actions && <LinkActionButton link={link} actions={actions} label={t('Link')} />}
      {onCreate && (
        <button type="button" className="btn btn-primary vg-btn-sm" onClick={onCreate}>
          <Icon name="ph-plus" size={13} />{t('Create the action')}
        </button>
      )}
    </div>
  );
}

// ─── Formulaires ────────────────────────────────────────────────────────────

function RequirementForm({ r, options, featured, onDone, onCancel }: {
  r?: RequirementView; options: Opts; featured: Featured; onDone: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  // Pilote sorti de l'effectif : conservé comme choix tant qu'aucun successeur n'est désigné (VEI-01).
  const pilots = withCurrent(options.people, r?.pilotId, r ? `${r.pilot || r.pilotId}${LEFT_SUFFIX}` : undefined);
  const applicable = options.applicableSites ?? [];
  const chosen = new Set(r?.siteIds ?? []);
  // VEI-12 : la certification n'est demandée que pour l'indicateur « certification ».
  const [linkedTo, setLinkedTo] = useState(r?.linkedTo ?? '');
  return (
    <ActionForm action={saveRequirement} hidden={{ id: r?.id, version: r?.version, siteIdsField: applicable.length ? '1' : undefined, linkedToField: '1' }} onDone={onDone} onCancel={onCancel} submitLabel={r ? t('Save') : t('Add the requirement')}>
      <FormRow>
        <Field name="text" label={t('Text')}>
          <Input name="text" defaultValue={r?.text} placeholder={t('E.g. Labour Code — R. 4512-6')} maxLength={120} autoFocus={!r} />
        </Field>
        <Field name="domain" label={t('Domain')}>
          <Input name="domain" defaultValue={r?.domain} placeholder={t('E.g. Prevention plans')} maxLength={120} />
        </Field>
      </FormRow>
      <Field name="legifranceUrl" label={t('Link to the text')} hint={t('Légifrance or EUR-Lex (European regulations). The text can also be attached to the record.')}>
        <Input name="legifranceUrl" type="url" defaultValue={r?.legifranceUrl ?? ''} placeholder="https://www.legifrance.gouv.fr/…" maxLength={500} />
      </Field>
      <Field name="linkedTo" label={t('Linked indicator')}
        hint={isRequirementLink(r?.linkedTo) ? REQUIREMENT_LINKS[r.linkedTo].hint : t('Optional: the state of the requirement is then taken from an indicator computed by Vigie (one indicator per requirement in force).')}>
        <Select name="linkedTo" options={LINK_OPTIONS.map(([k, l]) => [k, labelT(t)(l)] as const)} value={linkedTo} onChange={(e) => setLinkedTo(e.target.value)} placeholder={t('No indicator')} />
      </Field>
      {linkedTo === 'certification' && (
        <Field name="certificationId" label={t('Linked certification')} hint={t('One requirement in force per certification; state taken from the certificate status (Audits screen).')}>
          <Select name="certificationId" options={options.certifications ?? []} defaultValue={r?.certificationId ?? ''} placeholder={t('Choose…')} />
        </Field>
      )}
      <Field name="reviewMonths" label={t('Compliance re-evaluation every (months)')}
        hint={fill(t('Empty = {n} months. Frequency specific to the requirement (1 to {max} months), counted from the last evaluation.'), { n: REQUIREMENT_REVIEW_MONTHS, max: REQUIREMENT_REVIEW_MAX })}>
        <Input name="reviewMonths" type="number" min={1} max={REQUIREMENT_REVIEW_MAX} step={1} inputMode="numeric" defaultValue={r?.reviewMonths ?? ''} placeholder={String(REQUIREMENT_REVIEW_MONTHS)} />
      </Field>
      {applicable.length > 0 && (
        <Field name="siteIds" label={t('Sites concerned')} hint={t('No site ticked: the requirement applies to every site.')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            {applicable.map(([id, label]) => <Checkbox key={id} name="siteIds" value={id} label={label} defaultChecked={chosen.has(id)} />)}
          </div>
        </Field>
      )}
      <Field name="summary" label={t('What it requires')}>
        <TextArea name="summary" defaultValue={r?.summary} rows={3} maxLength={1000} placeholder={t('Concrete obligations for the company.')} />
      </Field>
      <FormRow>
        <Field name="dueOn" label={t('Deadline')} hint={r?.dueFromControl
          ? t('Followed by inspections: the deadline shown is that of the next linked inspection; this date is not used.')
          : t('Date of application or of compliance.')}>
          <Input name="dueOn" type="date" defaultValue={r?.dueOn ?? ''} />
        </Field>
        <Field name="dueNote" label={t('Deadline note')} hint={t('E.g. Permanent, surveillance audit.')}>
          <Input name="dueNote" defaultValue={r?.dueNote ?? ''} maxLength={60} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="evaluation" label={t('Evaluation')}>
          <Select name="evaluation" options={EVAL_OPTIONS.map(([k, l]) => [k, labelT(t)(l)] as const)} defaultValue={r?.evaluation ?? 'a_evaluer'} />
        </Field>
        <Field name="evaluationNote" label={t('Detail')} hint={t('Shown with the evaluation.')}>
          <Input name="evaluationNote" defaultValue={r?.evaluationNote ?? ''} placeholder={t('E.g. 2 interventions without a signed plan')} maxLength={160} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="pilotId" label={t('Lead')} hint={pilots !== options.people ? t('Lead who left the workforce: appoint a successor.') : undefined}>
          <Select name="pilotId" options={pilots} defaultValue={r?.pilotId ?? ''} placeholder={t('Not appointed')} />
        </Field>
        <Field name="keystoneProjects" label={t('Number of projects concerned')}
          hint={t('Entered: Keystone does not publish the delivery date of the projects yet (question CV-11).')}>
          <Input name="keystoneProjects" type="number" min={0} max={999} step={1} inputMode="numeric" defaultValue={r?.keystoneProjects ?? ''} />
        </Field>
      </FormRow>
      <div style={{ display: 'grid', gap: 4 }}>
        <Checkbox name="affectsProjects" label={t('Concerns the Keystone projects delivered after the deadline')} defaultChecked={r?.affectsProjects} />
        <span style={{ ...muted, paddingLeft: 24 }}>{t('Projects whose planned delivery follows the date of application; a dated deadline is required.')}</span>
      </div>
      <Field name="impact" label={t('Impact')} hint={t('End of the dashboard sentence “Applicable on …, in … days: …”.')}>
        <TextArea name="impact" defaultValue={r?.impact ?? ''} rows={2} maxLength={300} placeholder={t('E.g. any machine placed on the market after this date must comply with it.')} style={{ minHeight: 56 }} />
      </Field>
      <div style={{ display: 'grid', gap: 4 }}>
        <Checkbox name="featured" label={t('Highlight on the dashboard')} defaultChecked={r?.featured} />
        <span style={{ ...muted, paddingLeft: 24 }}>
          {r?.featured
            ? t('Requirement currently featured.')
            : featured
              ? fill(t('One featured requirement only: ticking it removes “{text}” from the dashboard.'), { text: featured.text })
              : t('One featured requirement only; a dated deadline is required.')}
        </span>
      </div>
    </ActionForm>
  );
}

function EvaluateForm({ r, today, initial, onDone, onCancel }: {
  r: RequirementView; today: string; initial?: EvalInitial; onDone: (evaluation: string) => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const [evaluation, setEvaluation] = useState(initial?.evaluation ?? r.evaluation);
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <ActionForm action={evaluateRequirement} hidden={{ id: r.id }} encType="multipart/form-data" onDone={() => onDone(evaluation)} onCancel={onCancel}
      submitLabel={t('Save the evaluation')} submitIcon="ph-seal-check">
      <div>
        <div className="vg-eyebrow" style={{ marginBottom: 4 }}>{t('What it requires')}</div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{r.summary}</p>
      </div>
      {/* Groupe de boutons radio : libellé du groupe, erreur du champ `evaluation` affichée sous le groupe (UX-04). */}
      <Field name="evaluation" group label={t('Compliance evaluation')}>
        <div role="radiogroup" aria-label={t('Compliance evaluation')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {EVALS.map(([k, v]) => (
            <label key={k} className="seg-opt" style={{ fontSize: 12, padding: '5px 10px', border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)' }}>
              <input type="radio" name="evaluation" value={k} checked={evaluation === k} onChange={() => setEvaluation(k)} />
              <Dot color={TONE[v.tone].dot} />{labelT(t)(v.label)}
            </label>
          ))}
        </div>
      </Field>
      <Field name="evaluationNote" label={t('Detail')} hint={t('Optional — finding, gap noted, reference of the evidence.')}>
        <Input name="evaluationNote" defaultValue={initial ? initial.note ?? '' : r.evaluationNote ?? ''} maxLength={160} placeholder={t('E.g. overhead crane periodic check overdue')} />
      </Field>
      <Field name="proof" label={t('Evidence (optional)')} hint={filesHint(t)}>
        <Input name="proof" type="file" multiple accept={ATTACH_ACCEPT} onChange={(e) => setFileError(checkPickedFiles(e.currentTarget))} />
      </Field>
      <FileError error={fileError} />
      <span style={muted}>
        {fill(t('Evaluation dated {date}{previous}, added to the history.'), { date: fmtDate(today), previous: r.lastEvaluated ? fill(t(' · previous on {date}'), { date: r.lastEvaluated }) : '' })}
        {NEEDS_ACTION.has(evaluation) && !r.actionId ? t(' A gap or a gap analysis is followed by an action of the single action plan.') : ''}
      </span>
    </ActionForm>
  );
}
