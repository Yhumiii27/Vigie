'use client';

// Fiche d'une action QSE (docs/specs/actions-qse.md § 4–11 ; plan du paquet 1, flux B) : Problème, Action,
// Planification, Source, Vérification (à l'état Vérifiée seulement, D17), Pointage et coûts, Fil, Preuves, Historique.
// Écritures (Modifier, Changer l'avancement, Vérifier, Rouvrir, Abandonner) : QHSE seulement, sur le site sélectionné
// (requireInSite) ; le responsable commente et joint des preuves, de tout site (D19) ; les droits viennent du serveur
// (ActionRights) et chaque fenêtre renvoie l'avancement affiché (`from`) pour qu'un choix devenu caduc soit refusé.

import { useRef, useState, type ReactNode, type Ref } from 'react';
import Link from 'next/link';
import { setSite } from '@/app/actions';
import { ActionFields } from '@/components/ActionFormDialog';
import { Attachments } from '@/components/Attachments';
import { ChangeLogList } from '@/components/ChangeLog';
import { FORM_SAVED_EVENT } from '@/components/form';
import { ReasonForm } from '@/components/ReasonDialog';
import { Icon, ToneTag } from '@/components/ui';
import { actionHref, actionPrintHref, canRemoveProof, type ActionRights } from '@/lib/action-rules';
import type { ActionDetailView, ActionFormOptions } from '@/lib/action-view';
import { fmtDate } from '@/lib/dates';
import { ACTION_PRIORITIES, AVANCEMENT, FOLLOW_REASONS, TONE } from '@/lib/domain';
import type { FormState } from '@/lib/forms';
import { addActionFiles, removeActionFile } from '@/server/plan';
import { abandonAction, reopenAction } from '@/server/plan-ui';
import { ActionThread } from './detail/ActionThread';
import { CostsBlock } from './detail/CostsBlock';
import { DetachLinkButton, LinkTargetForm } from './detail/LinkForms';
import {
  commentAnchor, detailButtons, editDefaults, editOptions, missingSummary, readOnlyNotice, showPreviousVerification, showVerification,
  threadWritable, writesBlocked, type DetailButton,
} from './detail/form-helpers';
import { MoveForm } from './detail/MoveForm';
import { VerifyForm } from './detail/VerifyForm';
import { useActionRunner } from '@/components/feedback';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';

export type ActionDetailProps = {
  detail: ActionDetailView; rights: ActionRights; options: ActionFormOptions; currentUserId: string; today: string; verifyDefault: string;
};

type Step = 'view' | DetailButton | 'link';

const buttonDefs = (t: T): Record<DetailButton, { label: string; icon: string; primary?: boolean; danger?: boolean }> => ({
  edit: { label: t('Edit'), icon: 'ph-pencil-simple' },
  abandon: { label: t('Abandon'), icon: 'ph-prohibit', danger: true },
  reopen: { label: t('Reopen'), icon: 'ph-arrow-counter-clockwise' },
  move: { label: t('Change the progress'), icon: 'ph-arrows-clockwise', primary: true },
  verify: { label: t('Verify the effectiveness'), icon: 'ph-seal-check', primary: true },
});

/** Fiche d'une action (problème, action, planification, source, vérification, coûts, fil, preuves, historique). */
export function ActionDetail({ detail: d, rights, options, currentUserId, today, verifyDefault }: ActionDetailProps) {
  const { t } = useI18n();
  const BUTTONS = buttonDefs(t);
  const [step, setStep] = useState<Step>('view');
  // Avancement affiché à l'ouverture de la fenêtre : envoyé en « from » (refus d'un choix devenu caduc).
  const [from, setFrom] = useState(d.status);
  const [flash, setFlash] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const go = (s: Step) => { setFlash(null); setFrom(d.status); setStep(s); };
  // Fenêtre annulée : la saisie est abandonnée, la fiche (Dialog) se ferme ensuite sans demander confirmation.
  const back = () => { root.current?.dispatchEvent(new CustomEvent(FORM_SAVED_EVENT, { bubbles: true })); setStep('view'); };
  const done = (message?: string) => (s: FormState) => {
    setStep('view');
    const parts = [message, s.ids?.length ? fill(s.ids.length > 1 ? t('Follow-up actions created: {ids}.') : t('Follow-up action created: {ids}.'), { ids: s.ids.join(', ') }) : null, ...(s.warnings ?? [])];
    setFlash(parts.filter(Boolean).join(' ') || null);
  };

  const blocked = writesBlocked(rights);
  const buttons = detailButtons(rights);
  const notice = readOnlyNotice(rights, d.status);
  const writable = threadWritable(rights);

  if (step === 'edit') {
    return (
      <Section root={root}>
        <Meta d={d} />
        <StepHead icon="ph-pencil-simple" title={fill(t('Edit {id}'), { id: d.id })} text={d.toComplete && rights.qhse ? missingSummary(d.missing) ?? undefined : undefined} />
        <ActionFields options={editOptions(options, d)} defaults={{ ...editDefaults(d), status: from }} legacyOriginLabel={d.legacyOriginLabel}
          onDone={done(t('Action saved.'))} onCancel={back} />
      </Section>
    );
  }
  if (step === 'move') {
    return (
      <Section root={root}>
        <Meta d={d} />
        <StepHead icon="ph-arrows-clockwise" title={t('Change the progress')} text={t('Free steps (going back allowed), Postponed, resumption, Completed.')} />
        <MoveForm detail={d} from={from} today={today} verifyDefault={verifyDefault} onDone={done(t('Progress saved.'))} onCancel={back} />
      </Section>
    );
  }
  if (step === 'verify') {
    return (
      <Section root={root}>
        <Meta d={d} />
        <StepHead icon="ph-seal-check" title={t('Verify the effectiveness')}
          text={t('Not effective or new risk: the follow-up action is created in the same save, linked to this one.')} />
        <VerifyForm detail={d} from={from} options={options} today={today} verifyDefault={verifyDefault} onDone={done(t('Verification saved.'))} onCancel={back} />
      </Section>
    );
  }
  if (step === 'reopen') {
    return (
      <Section root={root}>
        <Meta d={d} />
        <StepHead icon="ph-arrow-counter-clockwise" title={t('Reopen the verification')} />
        <ReasonForm action={reopenAction} hidden={{ id: d.id, from }} submitLabel={t('Reopen')} submitIcon="ph-arrow-counter-clockwise"
          message={`${fill(t('The action returns to “{status}”; date, nature, finding and result of the verification are cleared (kept in the history).'), { status: AVANCEMENT.terminee.label })}${d.followUps.length ? t(' The follow-up actions already created stay in place.') : ''}`}
          onDone={done(t('Verification reopened.'))} onCancel={back} />
      </Section>
    );
  }
  if (step === 'link') {
    return (
      <Section root={root}>
        <Meta d={d} />
        <StepHead icon="ph-link" title={t('Link an item')}
          text={t('Complementary link (risk, requirement, inspection, document version, review, decision): logged on the action and on the item.')} />
        <LinkTargetForm actionId={d.id} targets={d.linkTargets} onDone={(label) => { setStep('view'); setFlash(fill(t('Linked to {label}.'), { label })); }} onCancel={back} />
      </Section>
    );
  }
  if (step === 'abandon') {
    const detached = d.sources.filter((s) => s.detachOnAbandon).map((s) => s.label);
    return (
      <Section root={root}>
        <Meta d={d} />
        <StepHead icon="ph-prohibit" title={t('Abandon the action')} />
        <ReasonForm action={abandonAction} hidden={{ id: d.id, from }} submitLabel={t('Abandon the action')} submitIcon="ph-prohibit"
          placeholder={t('Duplicate of A-…, no longer relevant, replaced by…')}
          message={`${t('The action is kept with this reason (who, when, why), removed from the current plan, then read-only.')}${detached.length ? fill(t(' It will be detached from: {items}.'), { items: detached.join(' ; ') }) : ''}`}
          onDone={done(t('Action abandoned.'))} onCancel={back} />
      </Section>
    );
  }

  return (
    <Section root={root}>
      <Meta d={d} />

      {rights.elsewhere && <ElsewhereNotice site={rights.elsewhere} siteId={d.siteId} qhse={rights.qhse} />}
      {rights.qhse && d.toComplete && d.status !== 'abandonnee' && (
        <Notice icon="ph-question" tone="warn">{missingSummary(d.missing)}{t(' — complete them with “Edit”.')}</Notice>
      )}
      {flash && <div role="status" className="vg-flash"><Icon name="ph-check-circle" size={13} />{flash}</div>}

      {buttons.length > 0 && (
        <div className="vg-action-buttons">
          {buttons.map((b) => {
            const def = BUTTONS[b];
            return (
              <button key={b} type="button" disabled={blocked} onClick={() => go(b)}
                title={blocked ? fill(t('Select the site {site} to edit this action.'), { site: rights.elsewhere ?? '' }) : undefined}
                className={def.primary ? 'btn btn-primary vg-btn-sm' : 'btn btn-secondary vg-btn-sm'}
                style={def.danger ? { color: TONE.danger.fg, borderColor: TONE.danger.dot } : undefined}>
                <Icon name={def.icon} size={13} />{def.label}
              </button>
            );
          })}
        </div>
      )}
      {notice && <Notice icon={d.status === 'abandonnee' ? 'ph-prohibit' : 'ph-lock-simple'}>{notice}</Notice>}
      {/* IMP-07 : fiche imprimable (mêmes droits que la fiche) ; lien HTML simple (print.css). */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <a href={actionPrintHref(d.id)} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm">
          <Icon name="ph-printer" size={13} />{t('Print the sheet')}
        </a>
      </div>

      <Block title={t('Problem')}><Text value={d.problem} empty={t('To complete.')} /></Block>
      <Block title={t('Action')}><Text value={d.detail} empty={t('No detail entered.')} /></Block>

      <Block title={t('Planning')}>
        <Facts rows={[
          [t('Opened on'), d.opened],
          [t('Owner'), <span key="p" className="vg-person"><span className="vg-avatar" style={{ width: 20, height: 20, fontSize: 11 }}>{d.pilotInitials}</span>{d.pilot}{d.pilotLeft && <span className="vg-muted">{t(' · left the workforce')}</span>}</span>],
          [t('Priority'), d.priority ? <ToneTag key="pr" tone={ACTION_PRIORITIES[d.priority].tone}>{d.priorityLabel}</ToneTag> : t('To complete')],
          [t('Domain'), d.domainLabel ?? t('To complete')],
          [t('Risk level'), d.riskLevelLabel ?? '—'],
          [t('Site'), d.site],
          [t('Target date'), <span key="due" style={{ color: d.late ? TONE.danger.dot : undefined }}>{d.due}{d.late && ` · ${fill(t('{n} d late'), { n: d.lateDays })}`}</span>],
          ...(d.rescheduled ? [[t('Initial target date'), fmtDate(d.initialDueOn)] as [string, ReactNode]] : []),
          [t('Planned verification'), d.verifyDue
            ? <span key="v" style={{ color: d.verifyLate ? TONE.danger.dot : undefined }}>{d.verifyDue}{d.verifyLate && t(' · overdue')}</span>
            : '—'],
          [t('Actual date'), d.doneOn ? fmtDate(d.doneOn) : '—'],
          ...(d.status === 'abandonnee'
            ? [[t('Abandoned on'), d.cancelledOn ? fmtDate(d.cancelledOn) : '—'], [t('By'), d.cancelledBy ?? '—']] as [string, ReactNode][]
            : []),
        ]} />
        {d.status === 'abandonnee' && d.cancelReason && <p className="vg-block-text">{fill(t('Reason: {reason}'), { reason: d.cancelReason })}</p>}
      </Block>

      <Block title={t('Source')}>
        <div className="vg-source-line">
          <Icon name={d.sourceIcon} size={13} />
          <span>{d.sourceLabel}</span>
          {d.source === null && d.legacyOriginLabel && <span className="vg-muted">{fill(t('· Vigie origin before migration: {origin}'), { origin: d.legacyOriginLabel })}</span>}
        </div>
        {d.originRef && <div className="vg-muted" style={{ fontSize: 12 }}>{fill(t('Origin reference: {ref}'), { ref: d.originRef })}</div>}
        {d.sources.length > 0 && (
          <ul className="vg-source-list">
            {d.sources.map((s, i) => (
              <li key={`${s.kind}-${s.href ?? ''}-${i}`}>
                {s.href ? <Link href={s.href} className="vg-link">{s.label}</Link> : <span>{s.label}</span>}
                {s.detail && <span className="vg-muted"> · {s.detail}</span>}
                {s.link && rights.canUnlink && (
                  <DetachLinkButton actionId={d.id} link={s.link} label={s.label} disabled={blocked}
                    onDone={(label) => setFlash(fill(t('Detached from {label}; the action stays in the plan.'), { label }))} />
                )}
              </li>
            ))}
          </ul>
        )}
        {rights.canLink && d.linkTargets.length > 0 && (
          <div>
            <button type="button" className="vg-text-btn" disabled={blocked} onClick={() => go('link')}
              title={blocked ? fill(t('Select the site {site} to edit this action.'), { site: rights.elsewhere ?? '' }) : t('Complementary link: risk, requirement, inspection, document version, review, decision')}>
              <Icon name="ph-link" size={12} />{t('Link an item')}
            </button>
          </div>
        )}
        {d.follows && (
          <div style={{ fontSize: 12.5 }}>
            {t('Follow-up of ')}<Link href={actionHref(d.follows.id)} className="vg-link">{d.follows.id}</Link>
            {d.follows.label && ` · ${d.follows.label}`} <span className="vg-muted">({FOLLOW_REASONS[d.follows.reason].toLowerCase()})</span>
          </div>
        )}
        {d.followUps.map((f) => (
          <div key={f.id} style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {t('Followed by ')}<Link href={actionHref(f.id)} className="vg-link">{f.id}</Link>
            <span>· {f.label}</span>
            <span className="vg-muted">({FOLLOW_REASONS[f.reason].toLowerCase()})</span>
            <ToneTag tone={f.tone}>{f.statusLabel}</ToneTag>
          </div>
        ))}
      </Block>

      {showVerification(d.status) && (
        <Block title={t('Verification')}>
          <Facts rows={[
            [t('Verified on'), d.closedOn ? fmtDate(d.closedOn) : '—'],
            [t('Nature'), d.verifyMethodLabel ?? '—'],
            [t('Result'), d.effective == null ? '—' : <ToneTag key="r" tone={d.effective ? 'ok' : 'danger'}>{d.effective ? t('Effective') : t('Not effective')}</ToneTag>],
            [t('Verified by'), d.verifiedBy ?? '—'],
            ...(d.newRisk ? [[t('New risk'), t('Generated')] as [string, ReactNode]] : []),
          ]} />
          <Text value={d.efficacyNote} empty={t('No finding recorded.')} />
        </Block>
      )}
      {showPreviousVerification(d) && d.previousVerification && (
        <Block title={t('Finding of a previous verification')}>
          <Text value={d.previousVerification.note} empty="" />
          {d.previousVerification.by && <div className="vg-muted" style={{ fontSize: 11.5 }}>{fill(t('By {by}; replaced by the next verification.'), { by: d.previousVerification.by })}</div>}
        </Block>
      )}

      <CostsBlock detail={d} />

      <ActionThread actionId={d.id} comments={d.comments} rights={rights} currentUserId={currentUserId} writable={writable} healthWarning={d.healthWarning} />

      <Attachments title={t('Evidence')} kicker={d.id} files={d.files} emptyText={t('No evidence attached.')}
        hint={t('Photos, reports, certificates proving completion or effectiveness; optional.')}
        canAdd={writable && rights.canAttach}
        canRemove={(f) => writable && canRemoveProof(rights, d.status, f.uploadedById, currentUserId)}
        caption={(f) => (f.commentWithdrawn
          ? <span style={{ color: 'var(--tone-warn-fg)' }}>{t('comment withdrawn')}</span>
          : f.commentId != null ? <a href={`#${commentAnchor(f.commentId)}`} className="vg-link">{t('with a comment')}</a> : null)}
        onAdd={(picked) => {
          const fd = new FormData();
          fd.set('actionId', d.id);
          picked.forEach((f) => fd.append('files', f));
          return addActionFiles(fd);
        }}
        onRemove={removeActionFile} />

      <ChangeLogList entries={d.history} />
    </Section>
  );
}

/** Action d'un autre site que le site sélectionné : écritures du QHSE refusées par requireInSite, d'où le changement de site. */
function ElsewhereNotice({ site, siteId, qhse }: { site: string; siteId: string | null; qhse: boolean }) {
  const { t } = useI18n();
  const { pending, run } = useActionRunner();
  return (
    <Notice icon="ph-map-pin">
      <span>
        {fill(t('Action of the site {site}.'), { site })}{' '}
        {qhse ? t('Select this site to edit it.') : t('You can comment on it and attach evidence without changing site.')}
      </span>
      {qhse && siteId && (
        <button type="button" className="vg-text-btn" disabled={pending} onClick={() => run(() => setSite(siteId), { success: fill(t('Site selected: {site}.'), { site }) })}>
          {pending ? t('Selecting…') : fill(t('Select {site}'), { site })}
        </button>
      )}
    </Notice>
  );
}

function Meta({ d }: { d: ActionDetailView }) {
  const { t } = useI18n();
  return (
    <div className="vg-action-meta">
      <span>{d.id}</span>
      <ToneTag tone={d.tone}>{d.statusLabel}</ToneTag>
      {d.late && <span>{AVANCEMENT[d.status].label}</span>}
      {d.toComplete && <ToneTag tone="warn">{t('To complete')}</ToneTag>}
      <span className="vg-action-label">{d.label}</span>
    </div>
  );
}

function Section({ root, children }: { root: Ref<HTMLDivElement>; children: ReactNode }) {
  return <div ref={root} className="vg-action-detail">{children}</div>;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <section className="vg-action-block" aria-label={title}><h6 className="vg-h6">{title}</h6>{children}</section>;
}

function Text({ value, empty }: { value: string | null | undefined; empty: string }) {
  return value?.trim()
    ? <p className="vg-block-text">{value}</p>
    : <p className="vg-block-text vg-muted">{empty}</p>;
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="vg-facts">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

function Notice({ icon, tone, children }: { icon: string; tone?: 'warn'; children: ReactNode }) {
  return (
    <div className={`vg-notice${tone ? ` is-${tone}` : ''}`}>
      <Icon name={icon} size={13} />
      <div>{children}</div>
    </div>
  );
}

function StepHead({ icon, title, text }: { icon: string; title: string; text?: string }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 500 }}>
        <Icon name={icon} size={15} style={{ color: 'var(--color-accent)' }} />{title}
      </div>
      {text && <p className="vg-step-note">{text}</p>}
    </div>
  );
}
