'use client';

import { useState, useTransition } from 'react';
import { ConfirmButton, ErrorLine } from '@/components/prevention/parts';
import { Icon, ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { mappingStats } from '@/lib/pp-import/mapping';
import { FORMAT_ICONS, FORMAT_LABELS, type TemplateView } from '@/lib/pp-import/types';
import { deletePpTemplate, renamePpTemplate } from '@/server/pp-import';
import { muted, plural } from './parts';
import s from './pp-import.module.css';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

/** Onglet « Modèles d'import » : liste, renommage, modification de la correspondance, suppression. */
export function TemplatesPanel({ templates, canManage, onEditMapping, onImport }: {
  templates: TemplateView[];
  canManage: boolean;
  onEditMapping: (tpl: TemplateView) => void;
  onImport: () => void;
}) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const rename = (tpl: TemplateView) => start(async () => {
    const fd = new FormData();
    fd.set('id', String(tpl.id));
    fd.set('name', name);
    try {
      const r = await renamePpTemplate({}, fd);
      if (r.ok) { setRenaming(null); setError(null); } else setError(r.fieldErrors?.name ?? r.error ?? t('Renaming impossible.'));
    } catch {
      setError(t('Renaming impossible: the connection to the server was interrupted.'));
    }
  });
  const remove = (tpl: TemplateView) => start(async () => {
    try {
      const r = await deletePpTemplate(tpl.id);
      setError(r.error ?? null);
    } catch {
      setError(t('Deletion impossible: the connection to the server was interrupted.'));
    }
  });

  return (
    <div className="card" style={{ gap: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty', maxWidth: 780 }}>
          {t('A template remembers the mapping of a form. It is recognised automatically at the next import (same format and same fields), or proposed when at least 80 % of the fields are common; for a scan, choose it when uploading the file.')}
        </span>
        {canManage && <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onImport}><Icon name="ph-file-arrow-up" size={13} />{t('Import a form')}</button>}
      </div>
      <ErrorLine error={error} />
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 820 }}>
          <thead>
            <tr><th>{t('Name')}</th><th>{t('Format')}</th><th>{t('Fields')}</th><th>{t('Updated')}</th>{canManage && <th style={{ textAlign: 'right' }}>{t('Actions')}</th>}</tr>
          </thead>
          <tbody>
            {templates.length === 0 && (
              <tr>
                <td colSpan={canManage ? 5 : 4} style={{ ...muted, fontSize: 12, padding: '14px 8px' }}>
                  {t('No template recorded. Import a form then “Save as a template” at the Mapping step.')}
                </td>
              </tr>
            )}
            {templates.map((tpl) => {
              const st = mappingStats(tpl.mapping);
              return (
                <tr key={tpl.id} className={s.mapRow}>
                  <td style={{ minWidth: 240 }}>
                    {renaming === tpl.id ? (
                      <form style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); if (name.trim()) rename(tpl); }}>
                        <input className={`input ${s.compact}`} value={name} maxLength={120} autoFocus aria-label={t('New name of the template')}
                          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} style={{ width: 260, maxWidth: '100%' }} />
                        <button type="submit" className="btn btn-primary vg-btn-sm" disabled={pending || !name.trim()}>{t('Rename')}</button>
                        <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => { setRenaming(null); setError(null); }}>{t('Cancel')}</button>
                      </form>
                    ) : (
                      <span style={{ fontWeight: 500 }}>{tpl.name}</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon name={FORMAT_ICONS[tpl.format]} size={14} style={{ color: 'var(--color-neutral-400)' }} />{FORMAT_LABELS[tpl.format]}
                    </span>
                    {tpl.format !== 'scan' && !tpl.signature && <span style={{ display: 'block', ...muted }}>{t('without fingerprint: chosen at upload')}</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {plural(st.total, t('{n} field'), t('{n} fields'))}
                    <span style={{ display: 'block', ...muted }}>
                      {[st.targets && fill(t('{n} to Vigie'), { n: st.targets }), st.grid && plural(st.grid, t('{n} grid line'), t('{n} grid lines')), st.ignored && plural(st.ignored, t('{n} ignored'), t('{n} ignored#plural'))].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {fmtDate(tpl.updatedOn)}
                    {tpl.updatedBy && <span style={{ display: 'block', ...muted }}>{tpl.updatedBy}</span>}
                  </td>
                  {canManage && (
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending} onClick={() => { setRenaming(tpl.id); setName(tpl.name); setError(null); }}>
                          <Icon name="ph-pencil-simple" size={13} />{t('Rename')}
                        </button>
                        <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending || !st.total} onClick={() => onEditMapping(tpl)}>
                          <Icon name="ph-list-checks" size={13} />{t('Edit the mapping')}
                        </button>
                        <ConfirmButton label={t('Delete')} confirmLabel={t('Delete')} icon="ph-trash" pending={pending}
                          question={fill(t('Delete the template “{name}”? The plans already imported do not change.'), { name: tpl.name })} onConfirm={() => remove(tpl)} />
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {templates.length > 0 && (
        <span style={muted}>
          <ToneTag tone="neutral" style={{ fontSize: 11, padding: '1px 6px', marginRight: 6 }}>{t('Keys')}</ToneTag>
          {t('Each field is identified by its key: PDF field name, Word control tag, or section and label.')}
        </span>
      )}
    </div>
  );
}
