'use client';

import { useState } from 'react';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input } from '@/components/form';
import { Icon } from '@/components/ui';
import type { ContractorView } from '@/lib/data/prevention';
import { saveContractor } from '@/server/prevention';
import { muted, rowOpener } from './parts';

function ContractorForm({ contractor, onDone, onCancel }: { contractor?: ContractorView; onDone: () => void; onCancel: () => void }) {
  return (
    <ActionForm action={saveContractor} onDone={onDone} onCancel={onCancel} submitLabel={contractor ? 'Enregistrer' : "Ajouter l'entreprise"} hidden={{ id: contractor?.id }}>
      <FormRow>
        <Field name="name" label="Raison sociale">
          <Input name="name" defaultValue={contractor?.name} placeholder="Ex. [Entreprise Levage Ouest]" autoFocus />
        </Field>
        <Field name="trade" label="Corps de métier">
          <Input name="trade" defaultValue={contractor?.trade} placeholder="Ex. Maintenance des appareils de levage" />
        </Field>
      </FormRow>
      <Field name="contactName" label="Interlocuteur" hint="Responsable de l'intervention côté entreprise extérieure.">
        <Input name="contactName" defaultValue={contractor?.contactName ?? ''} placeholder="Ex. [M. Lebrun]" />
      </Field>
      <FormRow>
        <Field name="contactPhone" label="Téléphone">
          <Input name="contactPhone" type="tel" defaultValue={contractor?.contactPhone ?? ''} />
        </Field>
        <Field name="contactEmail" label="E-mail">
          <Input name="contactEmail" type="email" defaultValue={contractor?.contactEmail ?? ''} />
        </Field>
      </FormRow>
    </ActionForm>
  );
}

export function NewContractorButton() {
  return (
    <DialogButton label="Ajouter une entreprise" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouvelle entreprise extérieure" kicker="Entreprises extérieures" width={600}>
      {(close) => <ContractorForm onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

const count = (n: number, active: number, activeLabel: string) => (
  <>
    <span>{n}</span>
    {active > 0 && <span style={{ display: 'block', fontSize: 11, color: 'var(--tone-ok-fg)' }}>dont {active} {activeLabel}</span>}
  </>
);

/** Liste des entreprises extérieures ; un clic ouvre la fiche de modification (encadrement). */
export function ContractorsTable({ contractors, canManage }: { contractors: ContractorView[]; canManage: boolean }) {
  const [selId, setSelId] = useState<string | null>(null);
  const sel = contractors.find((c) => c.id === selId) ?? null;
  const close = () => setSelId(null);

  return (
    <>
      <div className="card" style={{ padding: '6px 14px 10px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 820 }}>
            <thead><tr><th>Entreprise</th><th>Interlocuteur</th><th>Téléphone</th><th>E-mail</th><th style={{ textAlign: 'right' }}>Plans</th><th style={{ textAlign: 'right' }}>Permis</th>{canManage && <th aria-label="Modifier" />}</tr></thead>
            <tbody>
              {contractors.length === 0 && <tr><td colSpan={canManage ? 7 : 6} style={{ ...muted, fontSize: 12, padding: '14px 8px' }}>Aucune entreprise extérieure enregistrée.</td></tr>}
              {contractors.map((c) => (
                <tr key={c.id} {...(canManage ? rowOpener(() => setSelId(c.id)) : {})}>
                  <td style={{ minWidth: 200 }}>
                    <span style={{ display: 'block', fontWeight: 500 }}>{c.name}</span>
                    <span style={{ display: 'block', ...muted }}>{c.trade}</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.contactName ?? <span style={muted}>—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.contactPhone ? <a href={`tel:${c.contactPhone.replace(/\s/g, '')}`} className="vg-link" style={{ fontSize: 12.5 }}>{c.contactPhone}</a> : <span style={muted}>—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.contactEmail ? <a href={`mailto:${c.contactEmail}`} className="vg-link" style={{ fontSize: 12.5 }}>{c.contactEmail}</a> : <span style={muted}>—</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{count(c.plans, c.activePlans, 'en cours')}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{count(c.permits, c.activePermits, c.activePermits > 1 ? 'actifs' : 'actif')}</td>
                  {canManage && <td style={{ textAlign: 'right', width: 32 }}><Icon name="ph-pencil-simple" size={13} style={{ color: 'var(--color-neutral-500)' }} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Dialog open={!!sel} onClose={close} title={sel?.name ?? ''} kicker="Entreprise extérieure" width={600}>
        {sel && <ContractorForm contractor={sel} onDone={close} onCancel={close} />}
      </Dialog>
    </>
  );
}
