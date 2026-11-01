'use client';

import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, Select, TextArea, Input } from '@/components/form';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { ReasonButton } from '@/components/ReasonDialog';
import { Aside, CardHead, ToneTag } from '@/components/ui';
import type { ContextData, ContextItemView } from '@/lib/data/context';
import { CONTEXT_KINDS, CONTEXT_KIND_KEYS, type ContextKind } from '@/lib/domain';
import { archiveContextItem, saveContextItem } from '@/server/context';

const KIND_OPTIONS = CONTEXT_KIND_KEYS.map((k) => [k, `${CONTEXT_KINDS[k].label} (${CONTEXT_KINDS[k].clause})`] as const);

function ContextForm({ item, kind, onDone }: { item?: ContextItemView; kind?: ContextKind; onDone: () => void }) {
  return (
    <ActionForm action={saveContextItem} hidden={{ id: item?.id, version: item?.version }} onDone={onDone} onCancel={onDone} submitLabel={item ? 'Enregistrer' : 'Ajouter'}>
      <Field name="kind" label="Nature">
        <Select name="kind" options={KIND_OPTIONS} defaultValue={item?.kind ?? kind ?? ''} placeholder="Choisir…" />
      </Field>
      <Field name="label" label="Intitulé">
        <Input name="label" defaultValue={item?.label ?? ''} maxLength={200} autoFocus />
      </Field>
      <Field name="detail" label="Description, exigences et attentes" hint="Partie intéressée : ses exigences pertinentes pour le système de management (§4.2).">
        <TextArea name="detail" defaultValue={item?.detail ?? ''} rows={3} maxLength={2000} />
      </Field>
      <Field name="treatment" label="Traitement" hint="Obligatoire pour un risque ou une opportunité : actions prévues, maîtrise, surveillance (§6.1.2).">
        <TextArea name="treatment" defaultValue={item?.treatment ?? ''} rows={2} maxLength={2000} />
      </Field>
    </ActionForm>
  );
}

/**
 * Contexte du système de management (CNF-05, ISO 9001 §4.1, §4.2, §6.1) : enjeux externes et internes, parties
 * intéressées, risques et opportunités avec leur traitement ; commun à l'entreprise, repris au dossier de revue.
 */
export function ContextCard({ data, canEdit }: { data: ContextData; canEdit: boolean }) {
  const total = data.groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <div id="contexte" className="card" style={{ gap: 10, scrollMarginTop: 16 }}>
      <CardHead title="Contexte, risques et opportunités" aside={<Aside>ISO 9001 §4.1 · §4.2 · §6.1</Aside>} />
      {total === 0 && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>Aucun enjeu, partie intéressée, risque ou opportunité enregistré.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        {data.groups.filter((g) => g.items.length || canEdit).map((g) => (
          <div key={g.kind} className="vg-inset" style={{ display: 'grid', gap: 6, padding: '10px 12px', alignContent: 'start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
              <ToneTag tone={g.tone}>{g.plural}</ToneTag>
              <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{g.clause}</span>
            </div>
            {g.items.map((item) => (
              <div key={item.id} style={{ display: 'grid', gap: 2, fontSize: 12.5 }}>
                {canEdit ? (
                  <DialogButton label={item.label} className="vg-text-btn" style={{ justifySelf: 'start', textAlign: 'left', fontWeight: 500 }} title="Modifier l'élément" kicker={g.label} width={560}>
                    {(close) => (
                      <div style={{ display: 'grid', gap: 12 }}>
                        <ContextForm item={item} onDone={close} />
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <ReasonButton label="Archiver" icon="ph-archive" title={`Archiver « ${item.label} »`} kicker="Contexte du système de management"
                            action={archiveContextItem} hidden={{ id: item.id }} submitLabel="Archiver" onDone={close} placeholder="Ex. enjeu sans objet depuis…" />
                        </div>
                        <LazyChangeLog entity="context_item" id={item.id} />
                      </div>
                    )}
                  </DialogButton>
                ) : <span style={{ fontWeight: 500 }}>{item.label}</span>}
                {item.detail && <span style={{ color: 'var(--color-neutral-400)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{item.detail}</span>}
                {item.treatment && <span style={{ color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>Traitement : {item.treatment}</span>}
              </div>
            ))}
            {canEdit && (
              <DialogButton label="Ajouter" icon="ph-plus" className="vg-text-btn" style={{ justifySelf: 'start' }} title={`Nouvel élément · ${g.label}`} kicker="Contexte du système de management" width={560}>
                {(close) => <ContextForm kind={g.kind} onDone={close} />}
              </DialogButton>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
