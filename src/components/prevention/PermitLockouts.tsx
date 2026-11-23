'use client';

import { DialogButton } from '@/components/Dialog';
import { ReasonButton } from '@/components/ReasonDialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { ToneTag } from '@/components/ui';
import type { LockoutView, PermitView } from '@/lib/data/prevention';
import { LOCKOUT_ENERGIES, LOCKOUT_ENERGY_KEYS, POINTS_MAX } from '@/lib/rules/lockouts';
import { applyLockout, cancelLockout, removeLockout, saveLockout, verifyLockout } from '@/server/lockouts';
import { SectionTitle, muted, type PreventionOptions } from './parts';

/**
 * PRV-22 : consignations et isolations d'un permis (points d'isolement, poseur et vérificateur, pose, vérification et levée
 * horodatées). Le permis ne se délivre qu'avec ses consignations vérifiées et ne se clôt qu'une fois elles levées ; la
 * vérification revient au vérificateur désigné ou à l'animateur QHSE, jamais au poseur. Droits contrôlés par le serveur.
 */

type Option = readonly [string, string];

function LockoutForm({ permit, lockout, people, plans, onDone }: { permit: PermitView; lockout?: LockoutView; people: readonly Option[]; plans: readonly Option[]; onDone: () => void }) {
  const keep = (list: readonly Option[], id?: string, label?: string) => (id && !list.some(([v]) => v === id) ? [[id, label ?? id] as const, ...list] : list);
  return (
    <ActionForm action={saveLockout} hidden={{ id: lockout?.id, permitId: permit.id, version: lockout?.version }} onDone={onDone} onCancel={onDone}
      submitLabel={lockout ? 'Enregistrer' : 'Préparer la consignation'}>
      <FormRow>
        <Field name="energy" label="Énergie ou fluide"><Select name="energy" options={LOCKOUT_ENERGY_KEYS.map((k) => [k, LOCKOUT_ENERGIES[k]] as const)} defaultValue={lockout?.energy ?? 'electrique'} /></Field>
        <Field name="equipment" label="Équipement ou installation"><Input name="equipment" maxLength={200} defaultValue={lockout?.equipment} placeholder="Ex. armoire TGBT atelier 2" /></Field>
      </FormRow>
      <Field name="points" label="Points d'isolement" hint={`Un par ligne : « repère ; n° de cadenas ou dispositif » (${POINTS_MAX} au plus).`}>
        <TextArea name="points" rows={4} defaultValue={lockout?.pointsText} placeholder={'Sectionneur Q12 ; cadenas 104\nVanne V3 ; condamnation 7'} />
      </Field>
      <FormRow>
        <Field name="applierId" label="Poseur"><Select name="applierId" options={keep(people, lockout?.applierId, lockout?.applier)} placeholder="Choisir…" defaultValue={lockout?.applierId ?? ''} /></Field>
        <Field name="verifierId" label="Vérificateur" hint="Une autre personne que le poseur."><Select name="verifierId" options={keep(people, lockout?.verifierId, lockout?.verifier)} placeholder="Choisir…" defaultValue={lockout?.verifierId ?? ''} /></Field>
      </FormRow>
      {plans.length > 0 && (
        <Field name="preventionPlanId" label="Plan de prévention" hint="Facultatif : par défaut celui du permis.">
          <Select name="preventionPlanId" options={plans} placeholder="Aucun" defaultValue={lockout ? lockout.preventionPlanId ?? '' : permit.preventionPlanId ?? ''} />
        </Field>
      )}
      <Field name="notes" label="Notes"><TextArea name="notes" rows={2} maxLength={2000} defaultValue={lockout?.notes} /></Field>
    </ActionForm>
  );
}

function LockoutItem({ permit, l, canManage, people, plans }: { permit: PermitView; l: LockoutView; canManage: boolean; people: readonly Option[]; plans: readonly Option[] }) {
  const kicker = `${permit.id} · ${l.id}`;
  return (
    <li style={{ display: 'grid', gap: 4, fontSize: 12.5, padding: '6px 0', borderTop: '1px solid var(--color-neutral-900)' }}>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong style={{ fontWeight: 500 }}>{l.id}</strong>
        <span>{l.energyLabel} · {l.equipment}</span>
        <ToneTag tone={l.tone}>{l.statusLabel}</ToneTag>
      </span>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 1 }}>
        {l.points.map((p, i) => <li key={i}>{p.label}{p.device && <span style={muted}> · {p.device}</span>}</li>)}
      </ul>
      <span style={muted}>
        Poseur : {l.applier} · vérificateur : {l.verifier}
        {l.appliedLabel && ` · posée le ${l.appliedLabel}`}
        {l.verifiedLabel && ` · vérifiée le ${l.verifiedLabel}`}
        {l.removedLabel && ` · levée le ${l.removedLabel}`}
        {l.preventionPlanId && ` · plan ${l.preventionPlanId}`}
      </span>
      {l.notes && <span style={muted}>{l.notes}</span>}
      {l.cancelled && <span style={muted}>Annulée le {l.cancelled.on}{l.cancelled.by ? ` par ${l.cancelled.by}` : ''} — {l.cancelled.reason}</span>}
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {canManage && l.status === 'preparee' && (
          <>
            <DialogButton label="Modifier" icon="ph-pencil-simple" className="vg-text-btn" title={`Modifier ${l.id}`} kicker={permit.id} width={600}>
              {(close) => <LockoutForm permit={permit} lockout={l} people={people} plans={plans} onDone={close} />}
            </DialogButton>
            <DialogButton label="Poser" icon="ph-lock-simple" className="vg-text-btn" title={`Poser ${l.id}`} kicker={kicker}>
              {(close) => (
                <ActionForm action={applyLockout} hidden={{ id: l.id }} submitLabel="Consignation posée" submitIcon="ph-lock-simple" onDone={close} onCancel={close}>
                  <p style={{ margin: 0, fontSize: 13 }}>Tous les points d&apos;isolement sont posés et condamnés par {l.applier} ? La pose est horodatée ; la vérification revient à {l.verifier} (ou à l&apos;animateur QHSE).</p>
                </ActionForm>
              )}
            </DialogButton>
            <ReasonButton label="Annuler" icon="ph-prohibit" className="vg-text-btn" title={`Annuler ${l.id}`} kicker={permit.id} action={cancelLockout} hidden={{ id: l.id }}
              submitLabel="Annuler la consignation" message="Consignation jamais posée : elle reste au journal du permis avec le motif." placeholder="Ex. installation déjà hors tension par le fournisseur" />
          </>
        )}
        {l.status === 'posee' && !l.verifyBlock && (
          <DialogButton label="Vérifier" icon="ph-check-circle" className="vg-text-btn" title={`Vérifier ${l.id}`} kicker={kicker}>
            {(close) => (
              <ActionForm action={verifyLockout} hidden={{ id: l.id }} submitLabel="Consignation vérifiée" submitIcon="ph-check-circle" onDone={close} onCancel={close}>
                <p style={{ margin: 0, fontSize: 13 }}>Points d&apos;isolement contrôlés et absence d&apos;énergie vérifiée (essai de démarrage, VAT, purge) ? La vérification est horodatée à votre nom.</p>
              </ActionForm>
            )}
          </DialogButton>
        )}
        {l.status === 'posee' && l.verifyBlock && <span style={muted}>{l.verifyBlock}</span>}
        {canManage && (l.status === 'posee' || l.status === 'verifiee') && (
          <DialogButton label="Lever" icon="ph-lock-simple-open" className="vg-text-btn" title={`Lever ${l.id}`} kicker={kicker}>
            {(close) => (
              <ActionForm action={removeLockout} hidden={{ id: l.id }} submitLabel="Consignation levée" submitIcon="ph-lock-simple-open" onDone={close} onCancel={close}>
                <p style={{ margin: 0, fontSize: 13 }}>Travaux terminés, personnel retiré et installation rendue à l&apos;exploitant ?</p>
                <Field name="removedById" label="Levée par"><Select name="removedById" options={people} defaultValue={people.some(([v]) => v === l.applierId) ? l.applierId : ''} placeholder="Choisir…" /></Field>
              </ActionForm>
            )}
          </DialogButton>
        )}
      </span>
    </li>
  );
}

export function PermitLockouts({ permit, canManage, options }: { permit: PermitView; canManage: boolean; options: PreventionOptions }) {
  const open = permit.status === 'demande' || permit.status === 'delivre';
  if (!permit.lockouts.length && !(canManage && open)) return null;
  const people = options.workers ?? [];
  const plans = options.plans.filter((p) => p.siteId === permit.siteId && !p.closed).map((p) => [p.id, `${p.id} · ${p.title}`] as const);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <SectionTitle aside={<span style={muted}>Pose et vérification avant la délivrance, levée avant la clôture</span>}>Consignations</SectionTitle>
      {permit.lockouts.length === 0 && <span style={muted}>Aucune consignation sur ce permis.</span>}
      {permit.lockouts.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {permit.lockouts.map((l) => <LockoutItem key={l.id} permit={permit} l={l} canManage={canManage} people={people} plans={plans} />)}
        </ul>
      )}
      {canManage && open && (
        <DialogButton label="Ajouter une consignation" icon="ph-plus" className="vg-text-btn" title="Nouvelle consignation" kicker={permit.id} width={600}>
          {(close) => <LockoutForm permit={permit} people={people} plans={plans} onDone={close} />}
        </DialogButton>
      )}
    </div>
  );
}
