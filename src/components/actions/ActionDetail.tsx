'use client';

import { useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { ActionFields } from '@/components/ActionFormDialog';
import { Attachments } from '@/components/Attachments';
import { ChangeLogList } from '@/components/ChangeLog';
import { ActionForm, Field, Input, TextArea } from '@/components/form';
import { Icon, ToneTag } from '@/components/ui';
import type { PlanAction } from '@/lib/data/actions';
import type { FormOptions } from '@/lib/data/options';
import { CANCEL_REASON_MAX, TONE } from '@/lib/domain';
import { addActionFiles, removeActionFile } from '@/server/plan';
import { cancelAction, moveAction } from '@/server/plan-ui';

type Step = 'view' | 'edit' | 'verify' | 'close' | 'reject' | 'cancel';

type Props = {
  a: PlanAction;
  options: Pick<FormOptions, 'people' | 'origins' | 'sites'> & Partial<Pick<FormOptions, 'events'>>;
  canManage: boolean;
  canApprove: boolean;
  /** Personne connectée : le pilote salarié fait avancer sa propre action (Démarrer, Déclarer réalisée). */
  currentUserId: string;
  today: string;
  verifyDefault: string;
};

const APPROVER_ONLY = "Réservé à l'animateur QHSE et à la direction.";

/** Contenu de la fiche d'action : détail, passage d'un statut à l'autre, modification. */
export function ActionDetail({ a, options, canManage, canApprove, currentUserId, today, verifyDefault }: Props) {
  const [step, setStep] = useState<Step>('view');
  // Statut affiché à l'ouverture de l'étape : envoyé avec la transition pour que le serveur refuse un choix devenu caduc.
  const [from, setFrom] = useState(a.status);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const back = () => { setError(null); setStep('view'); };
  const go = (s: Step) => { setError(null); setFrom(a.status); setStep(s); };

  // Transitions sans saisie (Démarrer, Rouvrir).
  const move = (to: 'doing') => start(async () => {
    const fd = new FormData();
    fd.set('id', a.id);
    fd.set('from', a.status);
    fd.set('to', to);
    const r = await moveAction({}, fd);
    setError(r.ok ? null : r.error ?? 'Le changement de statut a échoué.');
  });

  const cancelled = a.status === 'cancelled';
  const isPilot = a.pilotId === currentUserId;
  const canEdit = canManage && !cancelled && (a.status !== 'done' || canApprove);
  // Encadrement : toutes les transitions ; pilote salarié : Démarrer et Déclarer réalisée.
  const canMove = !cancelled && (canManage || (isPilot && (a.status === 'todo' || a.status === 'doing')));
  const canCancel = canApprove && (a.status === 'todo' || a.status === 'doing' || a.status === 'verify');
  // Sources détachées à l'annulation (l'événement et la revue d'origine restent lisibles, voir cancelAction).
  const linkedTo = a.sources.filter((s) => s.detachOnCancel).map((s) => s.label);

  if (step === 'edit') {
    return (
      <Section>
        <StepHead icon="ph-pencil-simple" title={`Modifier ${a.id}`} />
        <ActionFields options={options} onDone={back} onCancel={back} defaults={{
          id: a.id, title: a.title, description: a.description, origin: a.origin.key, originRef: a.originRef, eventId: a.eventId,
          siteId: a.siteId, pilotId: a.pilotId, pilotName: a.pilot, dueOn: a.dueOn, kind: a.kind, verifyDueOn: a.verifyDueOn,
        }} />
      </Section>
    );
  }

  if (step === 'verify') {
    // Une date encore à venir a été planifiée via « Modifier » (le retour « en cours » efface celle de la tentative précédente).
    const planned = a.verifyDueOn && a.verifyDueOn > today && a.verifyDueOn !== verifyDefault ? a.verifyDueOn : null;
    return (
      <Section>
        <Meta a={a} />
        <StepHead icon="ph-check" title="Déclarer l'action réalisée"
          text="L'action passe en « Efficacité à vérifier ». Elle ne sera clôturée qu'après vérification de son efficacité par l'animateur QHSE ou la direction." />
        <ActionForm action={moveAction} hidden={{ id: a.id, from, to: 'verify' }} submitLabel="Déclarer réalisée" submitIcon="ph-check" onDone={back} onCancel={back}>
          <Field name="verifyDueOn" label="Vérifier l'efficacité le"
            hint={planned ? 'Date déjà planifiée sur la fiche ; par défaut, 30 jours après la réalisation.' : 'Par défaut, 30 jours après la réalisation.'}>
            <Input name="verifyDueOn" type="date" defaultValue={planned ?? verifyDefault} min={today} style={{ maxWidth: 220 }} />
          </Field>
        </ActionForm>
      </Section>
    );
  }

  if (step === 'cancel') {
    return (
      <Section>
        <Meta a={a} />
        <StepHead icon="ph-prohibit" title="Annuler l'action"
          text={`L'action est conservée avec ce motif (qui, quand, pourquoi) et retirée du plan en cours.${linkedTo.length ? ` Elle sera détachée de : ${linkedTo.join(' ; ')}.` : ''}`} />
        <ActionForm action={cancelAction} hidden={{ id: a.id, from }} submitLabel="Annuler l'action" submitIcon="ph-prohibit" onDone={back} onCancel={back}>
          <Field name="reason" label="Motif d'annulation">
            <TextArea name="reason" rows={3} autoFocus required maxLength={CANCEL_REASON_MAX}
              placeholder="Action créée par erreur, doublon de A-…, remplacée par…, devenue sans objet…" />
          </Field>
        </ActionForm>
      </Section>
    );
  }

  if (step === 'close') {
    return (
      <Section>
        <Meta a={a} />
        <StepHead icon="ph-seal-check" title="Clôturer — efficacité vérifiée"
          text="Consignez ce qui a été vérifié pour juger l'action efficace : le constat reste attaché à l'action et à son origine." />
        <ActionForm action={moveAction} hidden={{ id: a.id, from, to: 'done' }} submitLabel="Clôturer l'action" submitIcon="ph-seal-check" onDone={back} onCancel={back}>
          <Field name="efficacyNote" label="Constat d'efficacité">
            <TextArea name="efficacyNote" rows={4} autoFocus
              placeholder="Ce qui a été vérifié, comment et avec quel résultat (visite terrain, indicateur, absence de récidive…)" />
          </Field>
        </ActionForm>
      </Section>
    );
  }

  if (step === 'reject') {
    return (
      <Section>
        <Meta a={a} />
        <StepHead icon="ph-arrow-counter-clockwise" title="Efficacité insuffisante"
          text="L'action repasse « En cours » pour être complétée ; le constat est conservé dans la fiche." />
        <ActionForm action={moveAction} hidden={{ id: a.id, from, to: 'doing' }} submitLabel="Renvoyer en cours" submitIcon="ph-arrow-counter-clockwise" onDone={back} onCancel={back}>
          <Field name="efficacyNote" label="Constat" hint="Ce qui manque ou ce qui n'a pas produit l'effet attendu.">
            <TextArea name="efficacyNote" rows={3} autoFocus />
          </Field>
        </ActionForm>
      </Section>
    );
  }

  const fields: [string, ReactNode][] = [
    ['Origine', (
      <span key="origin" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
        <Icon name={a.origin.icon} size={12} style={{ color: 'var(--color-neutral-400)', alignSelf: 'center' }} />
        <span>{a.origin.label}</span>
        {a.sources.map((s, i) => (
          <span key={`${s.href ?? ''}-${i}`} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
            <span style={{ color: 'var(--color-neutral-500)' }}>·</span>
            {s.href
              ? <Link href={s.href} className="vg-link" style={{ fontSize: 12.5 }}>{s.label}</Link>
              : <span style={{ color: 'var(--color-neutral-300)' }}>{s.label}</span>}
            {s.detail && <span style={{ color: 'var(--color-neutral-500)' }}>{s.detail}</span>}
          </span>
        ))}
        {a.sources[0]?.label !== a.originRef && <span style={{ color: 'var(--color-neutral-500)' }}>({a.originRef})</span>}
      </span>
    )],
    ['Pilote', (
      <span key="pilot" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span className="vg-avatar" style={{ width: 20, height: 20, fontSize: 9 }}>{a.pilotInitials}</span>{a.pilot}
      </span>
    )],
    ['Échéance', (
      <span key="due" style={{ color: a.late ? TONE.danger.dot : undefined }}>
        {a.dueLabel}{a.late && ` · ${a.lateDays} j de retard`}
      </span>
    )],
    ['Nature', a.kindLabel],
    ['Site', a.site],
    ["Vérification d'efficacité prévue", a.verifyDueLabel
      ? <span key="verify" style={{ color: a.verifyLate ? TONE.danger.dot : undefined }}>{a.verifyDueLabel}{a.verifyLate && ' · dépassée'}</span>
      : '—'],
    ...(cancelled
      ? [['Annulée le', a.cancelledLabel ?? '—'], ['Par', a.cancelledBy ?? '—']] as [string, ReactNode][]
      : [['Vérifiée par', a.status === 'done' ? a.verifiedBy ?? '—' : '—'], ['Clôturée le', a.closedLabel ?? '—']] as [string, ReactNode][]),
  ];

  return (
    <Section>
      <Meta a={a} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: '12px 16px' }}>
        {fields.map(([k, v]) => (
          <div key={k} style={{ display: 'grid', gap: 3, alignContent: 'start', minWidth: 0 }}>
            <span style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-600)' }}>{k}</span>
            <span style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 4 }}>
        <h6 className="vg-h6">Description</h6>
        <p style={{ margin: 0, fontSize: 12.5, color: a.description ? 'var(--color-neutral-300)' : 'var(--color-neutral-500)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>
          {a.description || 'Aucune précision saisie.'}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 4 }}>
        {/* Après « Efficacité insuffisante » ou « Rouvrir », le constat conservé est celui de la vérification précédente. */}
        <h6 className="vg-h6">{a.status !== 'done' && a.efficacyNote ? "Dernier constat d'efficacité" : "Constat d'efficacité"}</h6>
        {a.efficacyNote ? (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{a.efficacyNote}</p>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: '8px 10px', border: '1px dashed var(--color-divider)', borderRadius: 'var(--radius-md)', textWrap: 'pretty' }}>
            {a.status === 'done'
              ? 'Aucun constat consigné à la clôture.'
              : "Renseigné à la clôture, après vérification de l'efficacité par l'animateur QHSE ou la direction."}
          </div>
        )}
      </div>

      {cancelled && (
        <div style={{ display: 'grid', gap: 4 }}>
          <h6 className="vg-h6">Motif d&apos;annulation</h6>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{a.cancelReason || '—'}</p>
        </div>
      )}

      <Attachments title="Preuves" kicker={a.id} files={a.files} hint="Photos, PV, attestations prouvant la réalisation ou l'efficacité"
        emptyText="Aucune preuve jointe."
        canAdd={(canManage || isPilot) && !cancelled}
        canRemove={(f) => a.status !== 'done' && !cancelled && (canManage || f.uploadedById === currentUserId)}
        onAdd={(picked) => {
          const fd = new FormData();
          fd.set('actionId', a.id);
          picked.forEach((f) => fd.append('files', f));
          return addActionFiles(fd);
        }}
        onRemove={removeActionFile} />

      {error && <div role="alert" className="vg-form-error">{error}</div>}

      {cancelled ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
          <Icon name="ph-prohibit" size={13} />Action annulée — consultation seule.
        </div>
      ) : canMove ? (
        <div className="dialog-actions" style={{ flexWrap: 'wrap' }}>
          {(canEdit || canCancel) && (
            <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', marginRight: 'auto' }}>
              {canEdit && (
                <button type="button" className="btn btn-secondary" onClick={() => go('edit')} disabled={pending}>
                  <Icon name="ph-pencil-simple" />Modifier
                </button>
              )}
              {canCancel && (
                <button type="button" className="btn" onClick={() => go('cancel')} disabled={pending}
                  style={{ color: TONE.danger.fg, borderColor: TONE.danger.dot }}>
                  <Icon name="ph-prohibit" />Annuler l&apos;action
                </button>
              )}
            </span>
          )}
          {a.status === 'todo' && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => go('verify')} disabled={pending}><Icon name="ph-check" />Déclarer réalisée</button>
              <button type="button" className="btn btn-primary" onClick={() => move('doing')} disabled={pending}><Icon name="ph-play" />{pending ? 'Enregistrement…' : 'Démarrer'}</button>
            </>
          )}
          {a.status === 'doing' && (
            <button type="button" className="btn btn-primary" onClick={() => go('verify')} disabled={pending}><Icon name="ph-check" />Déclarer réalisée</button>
          )}
          {a.status === 'verify' && canManage && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => go('reject')} disabled={pending}><Icon name="ph-arrow-counter-clockwise" />Efficacité insuffisante</button>
              <button type="button" className="btn btn-primary" onClick={() => go('close')} disabled={pending || !canApprove} title={canApprove ? undefined : APPROVER_ONLY}>
                <Icon name="ph-seal-check" />Clôturer — efficacité vérifiée
              </button>
            </>
          )}
          {a.status === 'done' && canManage && (
            <button type="button" className="btn btn-secondary" onClick={() => move('doing')} disabled={pending || !canApprove} title={canApprove ? undefined : APPROVER_ONLY}>
              <Icon name="ph-arrow-counter-clockwise" />{pending ? 'Enregistrement…' : 'Rouvrir'}
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
          <Icon name="ph-lock-simple" size={13} />
          {isPilot
            ? "Vous pilotez cette action : la vérification d'efficacité et la clôture reviennent à l'animateur QHSE ou à la direction."
            : "Consultation seule : la mise à jour du plan d'actions est réservée à l'encadrement."}
        </div>
      )}
      {canMove && !canManage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
          <Icon name="ph-user-circle" size={13} />Vous pilotez cette action : déclarez-la réalisée une fois terminée.
        </div>
      )}

      <ChangeLogList entries={a.history} />
    </Section>
  );
}

function Meta({ a }: { a: PlanAction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
      <span>{a.id}</span>
      <ToneTag tone={a.tone}>{a.statusLabel}</ToneTag>
      {a.late && <span>{a.status === 'doing' ? 'en cours' : 'non démarrée'}</span>}
    </div>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>{children}</div>;
}

function StepHead({ icon, title, text }: { icon: string; title: string; text?: string }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 500 }}>
        <Icon name={icon} size={15} style={{ color: 'var(--color-accent)' }} />{title}
      </div>
      {text && <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>{text}</p>}
    </div>
  );
}
