'use client';

// Fiche d'une action QSE (docs/specs/actions-qse.md § 4–11 ; plan du paquet 1, flux B) : Problème, Action,
// Planification, Source, Vérification (à l'état Vérifiée seulement, D17), Pointage et coûts, Fil, Preuves, Historique.
// Écritures (Modifier, Changer l'avancement, Vérifier, Rouvrir, Abandonner) : QHSE seulement, sur le site sélectionné
// (requireInSite) ; le responsable commente et joint des preuves, de tout site (D19) ; les droits viennent du serveur
// (ActionRights) et chaque fenêtre renvoie l'avancement affiché (`from`) pour qu'un choix devenu caduc soit refusé.

import { useRef, useState, useTransition, type ReactNode, type Ref } from 'react';
import Link from 'next/link';
import { setSite } from '@/app/actions';
import { ActionFields } from '@/components/ActionFormDialog';
import { Attachments } from '@/components/Attachments';
import { ChangeLogList } from '@/components/ChangeLog';
import { FORM_SAVED_EVENT } from '@/components/form';
import { ReasonForm } from '@/components/ReasonDialog';
import { Icon, ToneTag } from '@/components/ui';
import { actionHref, canRemoveProof, type ActionRights } from '@/lib/action-rules';
import type { ActionDetailView, ActionFormOptions } from '@/lib/action-view';
import { fmtDate } from '@/lib/dates';
import { ACTION_PRIORITIES, AVANCEMENT, FOLLOW_REASONS, TONE } from '@/lib/domain';
import type { FormState } from '@/lib/forms';
import { addActionFiles, removeActionFile } from '@/server/plan';
import { abandonAction, reopenAction } from '@/server/plan-ui';
import { ActionThread } from './detail/ActionThread';
import { CostsBlock } from './detail/CostsBlock';
import {
  commentAnchor, detailButtons, editDefaults, editOptions, missingSummary, readOnlyNotice, showPreviousVerification, showVerification,
  threadWritable, writesBlocked, type DetailButton,
} from './detail/form-helpers';
import { MoveForm } from './detail/MoveForm';
import { VerifyForm } from './detail/VerifyForm';

export type ActionDetailProps = {
  detail: ActionDetailView; rights: ActionRights; options: ActionFormOptions; currentUserId: string; today: string; verifyDefault: string;
};

type Step = 'view' | DetailButton;

const BUTTONS: Record<DetailButton, { label: string; icon: string; primary?: boolean; danger?: boolean }> = {
  edit: { label: 'Modifier', icon: 'ph-pencil-simple' },
  abandon: { label: 'Abandonner', icon: 'ph-prohibit', danger: true },
  reopen: { label: 'Rouvrir', icon: 'ph-arrow-counter-clockwise' },
  move: { label: 'Changer l’avancement', icon: 'ph-arrows-clockwise', primary: true },
  verify: { label: 'Vérifier l’efficacité', icon: 'ph-seal-check', primary: true },
};

/** Fiche d'une action (problème, action, planification, source, vérification, coûts, fil, preuves, historique). */
export function ActionDetail({ detail: d, rights, options, currentUserId, today, verifyDefault }: ActionDetailProps) {
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
    const parts = [message, s.ids?.length ? `Action${s.ids.length > 1 ? 's' : ''} de suite créée${s.ids.length > 1 ? 's' : ''} : ${s.ids.join(', ')}.` : null, ...(s.warnings ?? [])];
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
        <StepHead icon="ph-pencil-simple" title={`Modifier ${d.id}`} text={d.toComplete && rights.qhse ? missingSummary(d.missing) ?? undefined : undefined} />
        <ActionFields options={editOptions(options, d)} defaults={{ ...editDefaults(d), status: from }} legacyOriginLabel={d.legacyOriginLabel}
          onDone={done('Action enregistrée.')} onCancel={back} />
      </Section>
    );
  }
  if (step === 'move') {
    return (
      <Section root={root}>
        <Meta d={d} />
        <StepHead icon="ph-arrows-clockwise" title="Changer l’avancement" text="Paliers libres (retour en arrière admis), Reportée, reprise, Terminée." />
        <MoveForm detail={d} from={from} today={today} verifyDefault={verifyDefault} onDone={done('Avancement enregistré.')} onCancel={back} />
      </Section>
    );
  }
  if (step === 'verify') {
    return (
      <Section root={root}>
        <Meta d={d} />
        <StepHead icon="ph-seal-check" title="Vérifier l’efficacité"
          text="Non efficace ou nouveau risque : l’action de suite est créée dans le même enregistrement, liée à celle-ci." />
        <VerifyForm detail={d} from={from} options={options} today={today} verifyDefault={verifyDefault} onDone={done('Vérification enregistrée.')} onCancel={back} />
      </Section>
    );
  }
  if (step === 'reopen') {
    return (
      <Section root={root}>
        <Meta d={d} />
        <StepHead icon="ph-arrow-counter-clockwise" title="Rouvrir la vérification" />
        <ReasonForm action={reopenAction} hidden={{ id: d.id, from }} submitLabel="Rouvrir" submitIcon="ph-arrow-counter-clockwise"
          message={`L’action revient à « ${AVANCEMENT.terminee.label} » ; date, nature, constat et résultat de la vérification sont effacés (conservés dans l’historique).${d.followUps.length ? ' Les actions de suite déjà créées restent en place.' : ''}`}
          onDone={done('Vérification rouverte.')} onCancel={back} />
      </Section>
    );
  }
  if (step === 'abandon') {
    const detached = d.sources.filter((s) => s.detachOnAbandon).map((s) => s.label);
    return (
      <Section root={root}>
        <Meta d={d} />
        <StepHead icon="ph-prohibit" title="Abandonner l’action" />
        <ReasonForm action={abandonAction} hidden={{ id: d.id, from }} submitLabel="Abandonner l’action" submitIcon="ph-prohibit"
          placeholder="Doublon de A-…, devenue sans objet, remplacée par…"
          message={`L’action est conservée avec ce motif (qui, quand, pourquoi), retirée du plan en cours, puis consultable seulement.${detached.length ? ` Elle sera détachée de : ${detached.join(' ; ')}.` : ''}`}
          onDone={done('Action abandonnée.')} onCancel={back} />
      </Section>
    );
  }

  return (
    <Section root={root}>
      <Meta d={d} />

      {rights.elsewhere && <ElsewhereNotice site={rights.elsewhere} siteId={d.siteId} qhse={rights.qhse} />}
      {rights.qhse && d.toComplete && d.status !== 'abandonnee' && (
        <Notice icon="ph-question" tone="warn">{missingSummary(d.missing)} — complétez-les par « Modifier ».</Notice>
      )}
      {flash && <div role="status" className="vg-flash"><Icon name="ph-check-circle" size={13} />{flash}</div>}

      {buttons.length > 0 && (
        <div className="vg-action-buttons">
          {buttons.map((b) => {
            const def = BUTTONS[b];
            return (
              <button key={b} type="button" disabled={blocked} onClick={() => go(b)}
                title={blocked ? `Sélectionnez le site ${rights.elsewhere} pour modifier cette action.` : undefined}
                className={def.primary ? 'btn btn-primary vg-btn-sm' : 'btn btn-secondary vg-btn-sm'}
                style={def.danger ? { color: TONE.danger.fg, borderColor: TONE.danger.dot } : undefined}>
                <Icon name={def.icon} size={13} />{def.label}
              </button>
            );
          })}
        </div>
      )}
      {notice && <Notice icon={d.status === 'abandonnee' ? 'ph-prohibit' : 'ph-lock-simple'}>{notice}</Notice>}

      <Block title="Problème"><Text value={d.problem} empty="À compléter." /></Block>
      <Block title="Action"><Text value={d.detail} empty="Aucun détail saisi." /></Block>

      <Block title="Planification">
        <Facts rows={[
          ['Ouverte le', d.opened],
          ['Responsable', <span key="p" className="vg-person"><span className="vg-avatar" style={{ width: 20, height: 20, fontSize: 9 }}>{d.pilotInitials}</span>{d.pilot}{d.pilotLeft && <span className="vg-muted"> · sorti de l’effectif</span>}</span>],
          ['Priorité', d.priority ? <ToneTag key="pr" tone={ACTION_PRIORITIES[d.priority].tone}>{d.priorityLabel}</ToneTag> : 'À compléter'],
          ['Domaine', d.domainLabel ?? 'À compléter'],
          ['Niveau de risque', d.riskLevelLabel ?? '—'],
          ['Site', d.site],
          ['Date cible', <span key="due" style={{ color: d.late ? TONE.danger.dot : undefined }}>{d.due}{d.late && ` · ${d.lateDays} j de retard`}</span>],
          ...(d.rescheduled ? [['Date cible initiale', fmtDate(d.initialDueOn)] as [string, ReactNode]] : []),
          ['Vérification planifiée', d.verifyDue
            ? <span key="v" style={{ color: d.verifyLate ? TONE.danger.dot : undefined }}>{d.verifyDue}{d.verifyLate && ' · dépassée'}</span>
            : '—'],
          ['Date effective', d.doneOn ? fmtDate(d.doneOn) : '—'],
          ...(d.status === 'abandonnee'
            ? [['Abandonnée le', d.cancelledOn ? fmtDate(d.cancelledOn) : '—'], ['Par', d.cancelledBy ?? '—']] as [string, ReactNode][]
            : []),
        ]} />
        {d.status === 'abandonnee' && d.cancelReason && <p className="vg-block-text">Motif : {d.cancelReason}</p>}
      </Block>

      <Block title="Source">
        <div className="vg-source-line">
          <Icon name={d.sourceIcon} size={13} />
          <span>{d.sourceLabel}</span>
          {d.source === null && d.legacyOriginLabel && <span className="vg-muted">· origine Vigie avant reprise : {d.legacyOriginLabel}</span>}
        </div>
        {d.originRef && <div className="vg-muted" style={{ fontSize: 12 }}>Référence d’origine : {d.originRef}</div>}
        {d.sources.length > 0 && (
          <ul className="vg-source-list">
            {d.sources.map((s, i) => (
              <li key={`${s.kind}-${s.href ?? ''}-${i}`}>
                {s.href ? <Link href={s.href} className="vg-link">{s.label}</Link> : <span>{s.label}</span>}
                {s.detail && <span className="vg-muted"> · {s.detail}</span>}
              </li>
            ))}
          </ul>
        )}
        {d.follows && (
          <div style={{ fontSize: 12.5 }}>
            Suite de <Link href={actionHref(d.follows.id)} className="vg-link">{d.follows.id}</Link>
            {d.follows.label && ` · ${d.follows.label}`} <span className="vg-muted">({FOLLOW_REASONS[d.follows.reason].toLowerCase()})</span>
          </div>
        )}
        {d.followUps.map((f) => (
          <div key={f.id} style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            Suivie par <Link href={actionHref(f.id)} className="vg-link">{f.id}</Link>
            <span>· {f.label}</span>
            <span className="vg-muted">({FOLLOW_REASONS[f.reason].toLowerCase()})</span>
            <ToneTag tone={f.tone}>{f.statusLabel}</ToneTag>
          </div>
        ))}
      </Block>

      {showVerification(d.status) && (
        <Block title="Vérification">
          <Facts rows={[
            ['Vérifiée le', d.closedOn ? fmtDate(d.closedOn) : '—'],
            ['Nature', d.verifyMethodLabel ?? '—'],
            ['Résultat', d.effective == null ? '—' : <ToneTag key="r" tone={d.effective ? 'ok' : 'danger'}>{d.effective ? 'Efficace' : 'Non efficace'}</ToneTag>],
            ['Vérifiée par', d.verifiedBy ?? '—'],
            ...(d.newRisk ? [['Nouveau risque', 'Généré'] as [string, ReactNode]] : []),
          ]} />
          <Text value={d.efficacyNote} empty="Aucun constat consigné." />
        </Block>
      )}
      {showPreviousVerification(d) && d.previousVerification && (
        <Block title="Constat d’une vérification précédente">
          <Text value={d.previousVerification.note} empty="" />
          {d.previousVerification.by && <div className="vg-muted" style={{ fontSize: 11.5 }}>Par {d.previousVerification.by} ; remplacé par la prochaine vérification.</div>}
        </Block>
      )}

      <CostsBlock detail={d} />

      <ActionThread actionId={d.id} comments={d.comments} rights={rights} currentUserId={currentUserId} writable={writable} healthWarning={d.healthWarning} />

      <Attachments title="Preuves" kicker={d.id} files={d.files} emptyText="Aucune preuve jointe."
        hint="Photos, PV, attestations prouvant la réalisation ou l’efficacité ; facultatives."
        canAdd={writable && rights.canAttach}
        canRemove={(f) => writable && canRemoveProof(rights, d.status, f.uploadedById, currentUserId)}
        caption={(f) => (f.commentWithdrawn
          ? <span style={{ color: 'var(--tone-warn-fg)' }}>commentaire retiré</span>
          : f.commentId != null ? <a href={`#${commentAnchor(f.commentId)}`} className="vg-link">avec un commentaire</a> : null)}
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
  const [pending, start] = useTransition();
  return (
    <Notice icon="ph-map-pin">
      <span>
        Action du site {site}.{' '}
        {qhse ? 'Sélectionnez ce site pour la modifier.' : 'Vous pouvez la commenter et y joindre des preuves sans changer de site.'}
      </span>
      {qhse && siteId && (
        <button type="button" className="vg-text-btn" disabled={pending} onClick={() => start(() => setSite(siteId))}>
          {pending ? 'Sélection…' : `Sélectionner ${site}`}
        </button>
      )}
    </Notice>
  );
}

function Meta({ d }: { d: ActionDetailView }) {
  return (
    <div className="vg-action-meta">
      <span>{d.id}</span>
      <ToneTag tone={d.tone}>{d.statusLabel}</ToneTag>
      {d.late && <span>{AVANCEMENT[d.status].label}</span>}
      {d.toComplete && <ToneTag tone="warn">À compléter</ToneTag>}
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
