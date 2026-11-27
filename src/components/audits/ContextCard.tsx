'use client';

import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, Select, TextArea, Input } from '@/components/form';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { ReasonButton } from '@/components/ReasonDialog';
import { Aside, CardHead, ToneTag } from '@/components/ui';
import type { ContextData, ContextItemView } from '@/lib/data/context';
import { CONTEXT_KINDS, CONTEXT_KIND_KEYS, type ContextKind } from '@/lib/domain';
import { archiveContextItem, saveContextItem } from '@/server/context';
import { useI18n } from '@/i18n/client';
import { fill, type T } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

const KIND_OPTIONS = (t: T) => CONTEXT_KIND_KEYS.map((k) => [k, `${labelT(t)(CONTEXT_KINDS[k].label)} (${CONTEXT_KINDS[k].clause})`] as const);

function ContextForm({ item, kind, onDone }: { item?: ContextItemView; kind?: ContextKind; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <ActionForm action={saveContextItem} hidden={{ id: item?.id, version: item?.version }} onDone={onDone} onCancel={onDone} submitLabel={item ? t('Save') : t('Add')}>
      <Field name="kind" label={t('Nature')}>
        <Select name="kind" options={KIND_OPTIONS(t)} defaultValue={item?.kind ?? kind ?? ''} placeholder={t('Choose…')} />
      </Field>
      <Field name="label" label={t('Title')}>
        <Input name="label" defaultValue={item?.label ?? ''} maxLength={200} autoFocus />
      </Field>
      <Field name="detail" label={t('Description, requirements and expectations')} hint={t('Interested party: its requirements relevant to the management system (§4.2).')}>
        <TextArea name="detail" defaultValue={item?.detail ?? ''} rows={3} maxLength={2000} />
      </Field>
      <Field name="treatment" label={t('Treatment')} hint={t('Required for a risk or an opportunity: planned actions, control, monitoring (§6.1.2).')}>
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
  const { t } = useI18n();
  const total = data.groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <div id="contexte" className="card" style={{ gap: 10, scrollMarginTop: 16 }}>
      <CardHead title={t('Context, risks and opportunities')} aside={<Aside>ISO 9001 §4.1 · §4.2 · §6.1</Aside>} />
      {total === 0 && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{t('No issue, interested party, risk or opportunity recorded.')}</div>}
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
                  <DialogButton label={item.label} className="vg-text-btn" style={{ justifySelf: 'start', textAlign: 'left', fontWeight: 500 }} title={t('Edit the item')} kicker={g.label} width={560}>
                    {(close) => (
                      <div style={{ display: 'grid', gap: 12 }}>
                        <ContextForm item={item} onDone={close} />
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <ReasonButton label={t('Archive')} icon="ph-archive" title={fill(t('Archive “{text}”'), { text: item.label })} kicker={t('Context of the management system')}
                            action={archiveContextItem} hidden={{ id: item.id }} submitLabel={t('Archive')} onDone={close} placeholder={t('E.g. issue no longer relevant since…')} />
                        </div>
                        <LazyChangeLog entity="context_item" id={item.id} />
                      </div>
                    )}
                  </DialogButton>
                ) : <span style={{ fontWeight: 500 }}>{item.label}</span>}
                {item.detail && <span style={{ color: 'var(--color-neutral-400)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{item.detail}</span>}
                {item.treatment && <span style={{ color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{t('Treatment: ')}{item.treatment}</span>}
              </div>
            ))}
            {canEdit && (
              <DialogButton label={t('Add')} icon="ph-plus" className="vg-text-btn" style={{ justifySelf: 'start' }} title={`${t('New item')} · ${g.label}`} kicker={t('Context of the management system')} width={560}>
                {(close) => <ContextForm kind={g.kind} onDone={close} />}
              </DialogButton>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
