'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ReasonForm } from '@/components/ReasonDialog';
import { ActionForm, Field, FormRow, Input } from '@/components/form';
import { Icon, ToneTag } from '@/components/ui';
import type { ContractorView } from '@/lib/data/prevention';
import { archiveContractor, restoreContractor, saveContractor } from '@/server/prevention';
import { ErrorLine, Facts, Notice, SectionTitle, muted, rowOpener, useRun } from './parts';
import { TipButton } from '@/components/Tip';

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

const telHref = (phone: string) => `tel:${phone.replace(/\s/g, '')}`;

/** Fiche d'une entreprise extérieure (tous rôles) : coordonnées, plans et permis du site, historique ; gestion pour l'encadrement. */
function ContractorSheet({ contractor: c, canManage, onEdit, onArchive }: {
  contractor: ContractorView; canManage: boolean; onEdit: () => void; onArchive: () => void;
}) {
  const { pending, error, run } = useRun();
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {c.archived && (
        <Notice tone="neutral" icon="ph-archive">
          {c.archivedLabel}{c.archiveReason ? ` : ${c.archiveReason}` : '.'} L&apos;entreprise n&apos;est plus proposée dans les formulaires ; ses plans et permis restent consultables.
        </Notice>
      )}
      <Facts items={[
        ['Corps de métier', c.trade],
        ['Interlocuteur', c.contactName ?? '—'],
        ['Téléphone', c.contactPhone ? <a href={telHref(c.contactPhone)} className="vg-link" style={{ fontSize: 12.5 }}>{c.contactPhone}</a> : '—'],
        ['E-mail', c.contactEmail ? <a href={`mailto:${c.contactEmail}`} className="vg-link" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{c.contactEmail}</a> : '—'],
        ['Statut', c.archived ? 'Archivée' : 'Active'],
      ]} />

      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle aside={<span style={muted}>sur le site sélectionné</span>}>Plans de prévention</SectionTitle>
        {c.planList.length === 0 && <span style={muted}>Aucun plan de prévention.</span>}
        {c.planList.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
            <Link href={`/prevention?plan=${encodeURIComponent(p.id)}`} className="vg-link" style={{ fontSize: 12.5 }}>{p.id}</Link>
            <span style={{ flex: 1, minWidth: 180 }}>{p.title}</span>
            <span style={muted}>{p.site} · {p.period}</span>
            <ToneTag tone={p.tone}>{p.statusLabel}</ToneTag>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle aside={<span style={muted}>sur le site sélectionné</span>}>Permis</SectionTitle>
        {c.permitList.length === 0 && <span style={muted}>Aucun permis.</span>}
        {c.permitList.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
            <Icon name={p.icon} size={14} style={{ color: 'var(--color-neutral-400)' }} />
            <Link href={`/prevention?onglet=permis&permis=${encodeURIComponent(p.id)}`} className="vg-link" style={{ fontSize: 12.5 }}>{p.id}</Link>
            <span style={{ flex: 1, minWidth: 140 }}>{p.typeLabel}</span>
            <span style={muted}>{p.validity}</span>
            <ToneTag tone={p.tone}>{p.stateLabel}</ToneTag>
          </div>
        ))}
      </div>

      <LazyChangeLog entity="contractor" id={c.id} />

      <ErrorLine error={error} />
      {canManage && (
        <div className="dialog-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {c.archived
            ? <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending} onClick={() => run(() => restoreContractor(c.id))}><Icon name="ph-arrow-counter-clockwise" size={13} />Réactiver</button>
            : (
              <TipButton className="btn btn-secondary vg-btn-sm" disabled={!!c.archiveBlock} tip={c.archiveBlock} onClick={onArchive}>
                <Icon name="ph-archive" size={13} />Archiver
              </TipButton>
            )}
          <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onEdit}><Icon name="ph-pencil-simple" size={13} />Modifier</button>
        </div>
      )}
    </div>
  );
}

type Mode = 'view' | 'edit' | 'archive';

function ContractorDialog({ contractor, onClose, canManage }: { contractor: ContractorView | null; onClose: () => void; canManage: boolean }) {
  const [mode, setMode] = useState<Mode>('view');
  const back = () => setMode('view');
  const close = () => { setMode('view'); onClose(); };
  const kicker = mode === 'edit' ? 'Modifier l’entreprise' : mode === 'archive' ? 'Archiver l’entreprise' : 'Entreprise extérieure';
  return (
    <Dialog open={!!contractor} onClose={close} title={contractor?.name ?? ''} kicker={kicker} width={640}>
      {contractor && mode === 'edit' && <ContractorForm contractor={contractor} onDone={back} onCancel={back} />}
      {contractor && mode === 'archive' && (
        <ReasonForm action={archiveContractor} hidden={{ id: contractor.id }} submitLabel="Archiver" submitIcon="ph-archive" onDone={back} onCancel={back}
          placeholder="Ex. Contrat terminé, entreprise plus référencée"
          message="L’entreprise ne sera plus proposée dans les plans, permis et activités de la carte ; son historique reste consultable et elle peut être réactivée." />
      )}
      {contractor && mode === 'view' && (
        <ContractorSheet contractor={contractor} canManage={canManage} onEdit={() => setMode('edit')} onArchive={() => setMode('archive')} />
      )}
    </Dialog>
  );
}

const count = (n: number, active: number, activeLabel: string) => (
  <>
    <span>{n}</span>
    {active > 0 && <span style={{ display: 'block', fontSize: 11, color: 'var(--tone-ok-fg)' }}>dont {active} {activeLabel}</span>}
  </>
);

/** Liste des entreprises extérieures ; un clic ouvre la fiche (tous rôles). */
export function ContractorsTable({ contractors, canManage, emptyLabel }: { contractors: ContractorView[]; canManage: boolean; emptyLabel: string }) {
  const [selId, setSelId] = useState<string | null>(null);
  const sel = contractors.find((c) => c.id === selId) ?? null;

  return (
    <>
      <div className="card" style={{ padding: '6px 14px 10px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 820 }}>
            <thead><tr><th>Entreprise</th><th>Interlocuteur</th><th>Téléphone</th><th>E-mail</th><th style={{ textAlign: 'right' }}>Plans</th><th style={{ textAlign: 'right' }}>Permis</th></tr></thead>
            <tbody>
              {contractors.length === 0 && <tr><td colSpan={6} style={{ ...muted, fontSize: 12, padding: '14px 8px' }}>{emptyLabel}</td></tr>}
              {contractors.map((c) => (
                <tr key={c.id} {...rowOpener(() => setSelId(c.id))}>
                  <td style={{ minWidth: 200 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500, flexWrap: 'wrap' }}>
                      {c.name}{c.archived && <span className="tag tag-neutral" style={{ fontWeight: 400 }}>Archivée</span>}
                    </span>
                    <span style={{ display: 'block', ...muted }}>{c.trade}</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.contactName ?? <span style={muted}>—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.contactPhone ? <a href={telHref(c.contactPhone)} className="vg-link" style={{ fontSize: 12.5 }}>{c.contactPhone}</a> : <span style={muted}>—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.contactEmail ? <a href={`mailto:${c.contactEmail}`} className="vg-link" style={{ fontSize: 12.5 }}>{c.contactEmail}</a> : <span style={muted}>—</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{count(c.plans, c.activePlans, 'en cours')}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{count(c.permits, c.activePermits, c.activePermits > 1 ? 'actifs' : 'actif')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ContractorDialog contractor={sel} onClose={() => setSelId(null)} canManage={canManage} />
    </>
  );
}
