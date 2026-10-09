'use client';

import { useState } from 'react';
import { NewActionButton } from '@/components/ActionFormDialog';
import { Dialog } from '@/components/Dialog';
import { ActionForm, Field, Input, TextArea } from '@/components/form';
import { Aside, CardHead, ToneTag } from '@/components/ui';
import { FINDING_KINDS, TONE } from '@/lib/domain';
import type { AuditGroup, FindingView } from '@/lib/data/audits';
import type { FormOptions } from '@/lib/data/options';
import { deleteFinding, saveFinding } from '@/server/audits';
import { ActionLink, DeleteButton, DialogFooter, RadioSeg } from './parts';
import { FINDING_KEYS } from './shared';
import styles from './audits.module.css';

type Opts = Pick<FormOptions, 'people' | 'origins' | 'sites'>;
type Editing = { id: number | null } | null;

const KIND_OPTIONS = FINDING_KEYS.map((k) => [k, FINDING_KINDS[k].label, TONE[FINDING_KINDS[k].tone].dot] as const);

/** Constats d'audit (le dernier audit par défaut), avec rattachement au plan d'actions unique. */
export function FindingsCard({ groups, defaultAudit, canManage, options }: { groups: AuditGroup[]; defaultAudit: string; canManage: boolean; options: Opts }) {
  const [selected, setSelected] = useState(groups[0]?.label ?? defaultAudit);
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);
  const group = groups.find((g) => g.label === selected) ?? groups[0];
  const finding = editing?.id != null ? groups.flatMap((g) => g.findings).find((f) => f.id === editing.id) : undefined;
  const latest = !group || group.label === groups[0]?.label;

  return (
    <div className="card" style={{ gap: 8 }}>
      <CardHead title={latest ? 'Constats du dernier audit' : "Constats d'audit"} aside={group && <Aside>{group.label}</Aside>} />
      {groups.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {groups.map((g) => (
            <button key={g.label} type="button" className={`vg-chip${g.label === group?.label ? ' is-on' : ''}`} aria-pressed={g.label === group?.label} onClick={() => setSelected(g.label)}>
              {g.label}<span style={{ color: 'var(--color-neutral-500)' }}>{g.findings.length}</span>
            </button>
          ))}
        </div>
      )}
      {group?.findings.map((f) => (
        <FindingRow key={f.id} finding={f} canManage={canManage} options={options} onEdit={() => setEditing({ id: f.id })} />
      ))}
      {!group && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: '4px 0' }}>Aucun constat enregistré.</div>}
      {canManage && (
        <button type="button" className="btn btn-secondary vg-btn-sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => setEditing({ id: null })}>
          <i className="ph ph-plus" style={{ fontSize: 13 }} />Ajouter un constat
        </button>
      )}

      <Dialog open={!!editing} onClose={close} kicker="Constats d'audit" title={finding ? 'Modifier le constat' : 'Nouveau constat'} width={540}>
        {editing && (
          <>
            <FindingForm finding={finding} defaultAudit={group?.label ?? defaultAudit} audits={groups.map((g) => g.label)}
              onDone={(audit) => { setSelected(audit); close(); }} onCancel={close} />
            {finding && (
              <DialogFooter>
                {finding.actionId && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-neutral-400)' }}>
                    Action liée <ActionLink action={finding.action} id={finding.actionId} />
                  </span>
                )}
                <DeleteButton run={() => deleteFinding(finding.id)} onDone={close}
                  note={finding.actionId ? "L'action liée reste dans le plan d'actions." : undefined} />
              </DialogFooter>
            )}
          </>
        )}
      </Dialog>
    </div>
  );
}

function FindingRow({ finding: f, canManage, options, onEdit }: { finding: FindingView; canManage: boolean; options: Opts; onEdit: () => void }) {
  const k = FINDING_KINDS[f.kind] ?? { label: f.kind, tone: 'neutral' as const };
  const needsAction = f.kind !== 'point_fort';
  return (
    <div className="vg-rule-bottom" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'start', padding: '6px 0' }}>
      <ToneTag tone={k.tone} style={{ whiteSpace: 'nowrap' }}>{k.label}</ToneTag>
      {canManage ? (
        <button type="button" className={styles.textBtn} style={{ fontSize: 12.5, textWrap: 'pretty' }} title="Modifier le constat" onClick={onEdit}>{f.text}</button>
      ) : (
        <span style={{ fontSize: 12.5, textWrap: 'pretty' }}>{f.text}</span>
      )}
      <div style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
        {f.actionId ? (
          <ActionLink action={f.action} id={f.actionId} compact />
        ) : needsAction && canManage ? (
          <NewActionButton options={options} label="Créer l'action" className="vg-text-btn" icon="ph-plus"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            defaults={{
              description: `${k.label} — ${f.audit} : ${f.text}`, origin: 'audit', originRef: f.audit,
              kind: f.kind === 'ecart_mineur' ? 'C' : 'P', link: `finding:${f.id}`, lockOrigin: true,
            }} />
        ) : (
          <span style={{ color: 'var(--color-neutral-600)' }}>—</span>
        )}
      </div>
    </div>
  );
}

function FindingForm({ finding, defaultAudit, audits, onDone, onCancel }: {
  finding?: FindingView; defaultAudit: string; audits: string[]; onDone: (audit: string) => void; onCancel: () => void;
}) {
  const [audit, setAudit] = useState(finding?.audit ?? defaultAudit);
  return (
    <ActionForm action={saveFinding} onDone={() => onDone(audit.trim())} onCancel={onCancel} submitLabel={finding ? 'Enregistrer' : 'Ajouter le constat'}
      hidden={{ id: finding?.id }}>
      <Field name="audit" label="Audit" hint="Choisissez un audit existant ou saisissez-en un nouveau (ex. Audit de suivi ISO 9001 · novembre 2026).">
        <Input name="audit" list="vg-audit-labels" value={audit} onChange={(e) => setAudit(e.target.value)} />
      </Field>
      <datalist id="vg-audit-labels">
        {audits.map((a) => <option key={a} value={a} />)}
      </datalist>
      <Field name="kind" label="Type de constat">
        <RadioSeg name="kind" options={KIND_OPTIONS} defaultValue={finding?.kind ?? 'ecart_mineur'} />
      </Field>
      <Field name="text" label="Constat" hint="Pour un écart, citez l'exigence concernée (ex. §8.2.3).">
        <TextArea name="text" defaultValue={finding?.text} rows={3} autoFocus />
      </Field>
    </ActionForm>
  );
}
