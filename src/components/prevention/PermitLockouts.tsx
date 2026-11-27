'use client';

import { DialogButton } from '@/components/Dialog';
import { ReasonButton } from '@/components/ReasonDialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ToneTag } from '@/components/ui';
import type { LockoutView, PermitView } from '@/lib/data/prevention';
import { LOCKOUT_ENERGIES, LOCKOUT_ENERGY_KEYS, POINTS_MAX } from '@/lib/rules/lockouts';
import { applyLockout, cancelLockout, removeLockout, saveLockout, verifyLockout } from '@/server/lockouts';
import { SectionTitle, muted, type PreventionOptions } from './parts';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

/**
 * PRV-22 : consignations et isolations d'un permis (points d'isolement, poseur et vérificateur, pose, vérification et levée
 * horodatées). Le permis ne se délivre qu'avec ses consignations vérifiées et ne se clôt qu'une fois elles levées ; la
 * vérification revient au vérificateur désigné ou à l'animateur QHSE, jamais au poseur. Droits contrôlés par le serveur.
 */

type Option = readonly [string, string];

function LockoutForm({ permit, lockout, people, plans, onDone }: { permit: PermitView; lockout?: LockoutView; people: readonly Option[]; plans: readonly Option[]; onDone: () => void }) {
  const { t } = useI18n();
  const keep = (list: readonly Option[], id?: string, label?: string) => (id && !list.some(([v]) => v === id) ? [[id, label ?? id] as const, ...list] : list);
  return (
    <ActionForm action={saveLockout} hidden={{ id: lockout?.id, permitId: permit.id, version: lockout?.version }} onDone={onDone} onCancel={onDone}
      submitLabel={lockout ? t('Save') : t('Prepare the lockout')}>
      <FormRow>
        <Field name="energy" label={t('Energy or fluid')}><Select name="energy" options={LOCKOUT_ENERGY_KEYS.map((k) => [k, LOCKOUT_ENERGIES[k]] as const)} defaultValue={lockout?.energy ?? 'electrique'} /></Field>
        <Field name="equipment" label={t('Equipment or installation')}><Input name="equipment" maxLength={200} defaultValue={lockout?.equipment} placeholder={t('E.g. main LV switchboard, workshop 2')} /></Field>
      </FormRow>
      <Field name="points" label={t('Isolation points')} hint={fill(t('One per line: “tag; padlock no. or device” ({max} at most).'), { max: POINTS_MAX })}>
        <TextArea name="points" rows={4} defaultValue={lockout?.pointsText} placeholder={`${t('Disconnector Q12; padlock 104')}\n${t('Valve V3; lock 7')}`} />
      </Field>
      <FormRow>
        <Field name="applierId" label={t('Applier')}><Select name="applierId" options={keep(people, lockout?.applierId, lockout?.applier)} placeholder={t('Choose…')} defaultValue={lockout?.applierId ?? ''} /></Field>
        <Field name="verifierId" label={t('Verifier')} hint={t('A person other than the applier.')}><Select name="verifierId" options={keep(people, lockout?.verifierId, lockout?.verifier)} placeholder={t('Choose…')} defaultValue={lockout?.verifierId ?? ''} /></Field>
      </FormRow>
      {plans.length > 0 && (
        <Field name="preventionPlanId" label={t('Prevention plan')} hint={t('Optional: by default the permit’s.')}>
          <Select name="preventionPlanId" options={plans} placeholder={t('None')} defaultValue={lockout ? lockout.preventionPlanId ?? '' : permit.preventionPlanId ?? ''} />
        </Field>
      )}
      <Field name="notes" label={t('Notes')}><TextArea name="notes" rows={2} maxLength={2000} defaultValue={lockout?.notes} /></Field>
    </ActionForm>
  );
}

function LockoutItem({ permit, l, canManage, people, plans }: { permit: PermitView; l: LockoutView; canManage: boolean; people: readonly Option[]; plans: readonly Option[] }) {
  const { t } = useI18n();
  const kicker = `${permit.id} · ${l.id}`;
  return (
    <li style={{ display: 'grid', gap: 4, fontSize: 12.5, padding: '6px 0', borderTop: '1px solid var(--color-neutral-900)' }}>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong style={{ fontWeight: 500 }}>{l.id}</strong>
        <span>{l.energyLabel} · {l.equipment}</span>
        <ToneTag tone={l.tone}>{labelT(t)(l.statusLabel)}</ToneTag>
      </span>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 1 }}>
        {l.points.map((p, i) => <li key={i}>{p.label}{p.device && <span style={muted}> · {p.device}</span>}</li>)}
      </ul>
      <span style={muted}>
        {fill(t('Applier: {applier} · verifier: {verifier}'), { applier: l.applier, verifier: l.verifier })}
        {l.appliedLabel && fill(t(' · applied on {date}'), { date: l.appliedLabel })}
        {l.verifiedLabel && fill(t(' · verified on {date}'), { date: l.verifiedLabel })}
        {l.removedLabel && fill(t(' · removed on {date}'), { date: l.removedLabel })}
        {l.preventionPlanId && fill(t(' · plan {id}'), { id: l.preventionPlanId })}
      </span>
      {l.notes && <span style={muted}>{l.notes}</span>}
      {l.cancelled && <span style={muted}>{fill(t('Cancelled on {date}#f'), { date: l.cancelled.on })}{l.cancelled.by ? fill(t(' by {name}'), { name: l.cancelled.by }) : ''} — {l.cancelled.reason}</span>}
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {canManage && l.status === 'preparee' && (
          <>
            <DialogButton label={t('Edit')} icon="ph-pencil-simple" className="vg-text-btn" title={fill(t('Edit {id}'), { id: l.id })} kicker={permit.id} width={600}>
              {(close) => <LockoutForm permit={permit} lockout={l} people={people} plans={plans} onDone={close} />}
            </DialogButton>
            <DialogButton label={t('Apply#lockout')} icon="ph-lock-simple" className="vg-text-btn" title={fill(t('Apply {id}'), { id: l.id })} kicker={kicker}>
              {(close) => (
                <ActionForm action={applyLockout} hidden={{ id: l.id }} submitLabel={t('Lockout applied')} submitIcon="ph-lock-simple" onDone={close} onCancel={close}>
                  <p style={{ margin: 0, fontSize: 13 }}>{fill(t('All isolation points applied and locked by {applier}? The application is time-stamped; the verification falls to {verifier} (or to the QHSE coordinator).'), { applier: l.applier, verifier: l.verifier })}</p>
                </ActionForm>
              )}
            </DialogButton>
            <ReasonButton label={t('Cancel')} icon="ph-prohibit" className="vg-text-btn" title={fill(t('Cancel {id}'), { id: l.id })} kicker={permit.id} action={cancelLockout} hidden={{ id: l.id }}
              submitLabel={t('Cancel the lockout')} message={t('Lockout never applied: it stays in the permit’s log with the reason.')} placeholder={t('E.g. installation already de-energised by the supplier')} />
          </>
        )}
        {l.status === 'posee' && !l.verifyBlock && (
          <DialogButton label={t('Verify')} icon="ph-check-circle" className="vg-text-btn" title={fill(t('Verify {id}'), { id: l.id })} kicker={kicker}>
            {(close) => (
              <ActionForm action={verifyLockout} hidden={{ id: l.id }} submitLabel={t('Lockout verified')} submitIcon="ph-check-circle" onDone={close} onCancel={close}>
                <p style={{ margin: 0, fontSize: 13 }}>{t('Isolation points checked and absence of energy verified (start test, voltage check, purge)? The verification is time-stamped in your name.')}</p>
              </ActionForm>
            )}
          </DialogButton>
        )}
        {l.status === 'posee' && l.verifyBlock && <span style={muted}>{l.verifyBlock}</span>}
        {canManage && (l.status === 'posee' || l.status === 'verifiee') && (
          <DialogButton label={t('Remove#lockout')} icon="ph-lock-simple-open" className="vg-text-btn" title={fill(t('Remove {id}#lockout'), { id: l.id })} kicker={kicker}>
            {(close) => (
              <ActionForm action={removeLockout} hidden={{ id: l.id }} submitLabel={t('Lockout removed')} submitIcon="ph-lock-simple-open" onDone={close} onCancel={close}>
                <p style={{ margin: 0, fontSize: 13 }}>{t('Work finished, staff withdrawn and installation handed back to the operator?')}</p>
                <Field name="removedById" label={t('Removed by')}><Select name="removedById" options={people} defaultValue={people.some(([v]) => v === l.applierId) ? l.applierId : ''} placeholder={t('Choose…')} /></Field>
              </ActionForm>
            )}
          </DialogButton>
        )}
      </span>
    </li>
  );
}

export function PermitLockouts({ permit, canManage, options }: { permit: PermitView; canManage: boolean; options: PreventionOptions }) {
  const { t } = useI18n();
  const open = permit.status === 'demande' || permit.status === 'delivre';
  if (!permit.lockouts.length && !(canManage && open)) return null;
  const people = options.workers ?? [];
  const plans = options.plans.filter((p) => p.siteId === permit.siteId && !p.closed).map((p) => [p.id, `${p.id} · ${p.title}`] as const);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <SectionTitle aside={<span style={muted}>{t('Application and verification before issue, removal before closure')}</span>}>{t('Lockouts')}</SectionTitle>
      {permit.lockouts.length === 0 && <span style={muted}>{t('No lockout on this permit.')}</span>}
      {permit.lockouts.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {permit.lockouts.map((l) => <LockoutItem key={l.id} permit={permit} l={l} canManage={canManage} people={people} plans={plans} />)}
        </ul>
      )}
      {canManage && open && (
        <DialogButton label={t('Add a lockout')} icon="ph-plus" className="vg-text-btn" title={t('New lockout')} kicker={permit.id} width={600}>
          {(close) => <LockoutForm permit={permit} people={people} plans={plans} onDone={close} />}
        </DialogButton>
      )}
    </div>
  );
}
