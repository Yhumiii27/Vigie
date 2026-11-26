'use client';

import { useState, useTransition } from 'react';
import { Facts, Notice } from '@/components/prevention/parts';
import { Icon, ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import { DEFAULT_SECTION } from '@/lib/pp-import/mapping';
import { FORMAT_ICONS, FORMAT_LABELS, type TemplateView } from '@/lib/pp-import/types';
import { detectFile, type DetectOk } from './DropStep';
import { fileSize, plural } from './parts';
import s from './pp-import.module.css';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

/** Étape 2 : résultat de la détection (format, champs et cases, modèle reconnu, avertissements). */
export function DetectStep({ files, det, templates, appliedTemplateId, onApplyTemplate, onRedetected, onBack, onContinue }: {
  files: File[];
  det: DetectOk;
  templates: TemplateView[];
  appliedTemplateId: number | null;
  onApplyTemplate: (id: number | null) => void;
  /** Nouvelle détection du même fichier (lecture d'un scan relancée). */
  onRedetected: (det: DetectOk) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { t } = useI18n();
  const [retrying, startRetry] = useTransition();
  const [retryError, setRetryError] = useState<string | null>(null);
  // Lecture d'un scan relancée avec le même fichier et le même modèle (choisi au dépôt).
  const retry = () => startRetry(async () => {
    setRetryError(null);
    try {
      const res = await detectFile(files, det.matchedTemplateId, true);
      if (res.ok) onRedetected(res);
      else setRetryError(res.error);
    } catch {
      setRetryError(t('Reading impossible: the connection to the server was interrupted. Try again.'));
    }
  });
  const boxes = det.fields.filter((f) => f.kind === 'checkbox');
  const inputs = det.fields.filter((f) => f.kind !== 'checkbox');
  const filled = inputs.filter((f) => f.value);
  const sections = new Map<string, { boxes: number; checked: number; inputs: number }>();
  det.fields.forEach((f) => {
    const key = f.section || DEFAULT_SECTION;
    const n = sections.get(key) ?? { boxes: 0, checked: 0, inputs: 0 };
    if (f.kind === 'checkbox') { n.boxes += 1; if (f.checked) n.checked += 1; } else n.inputs += 1;
    sections.set(key, n);
  });
  const matched = templates.find((x) => x.id === det.matchedTemplateId);
  const proposed = det.proposedTemplate ? templates.find((x) => x.id === det.proposedTemplate!.id) : undefined;
  const applied = templates.find((x) => x.id === appliedTemplateId);
  const hasFields = det.fields.length > 0;

  return (
    <div className="card" style={{ gap: 12 }}>
      <div style={{ display: 'grid', gap: 2 }}>
        <span className="card-kicker">{t('Step 2 · Detection')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Icon name={FORMAT_ICONS[det.format]} size={18} style={{ color: 'var(--color-neutral-400)' }} />
          <span className="card-title" style={{ fontSize: 15, wordBreak: 'break-word' }}>{det.fileName}</span>
          <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{fileSize(files.reduce((n, f) => n + f.size, 0), t)}{det.pageCount ? ` · ${plural(det.pageCount, t('{n} page'), t('{n} pages'))}` : ''}</span>
          <ToneTag tone="accent">{FORMAT_LABELS[det.format]}</ToneTag>
          {det.ai.used && <ToneTag tone="neutral"><Icon name="ph-sparkle" size={11} style={{ marginRight: 4 }} />{t('Read by the Claude API')}</ToneTag>}
        </div>
      </div>

      {hasFields && (
        <Facts items={[
          [t('Fields detected'), String(det.fields.length)],
          [t('Check boxes'), boxes.length ? `${boxes.length} · ${plural(boxes.filter((b) => b.checked).length, t('{n} ticked#f'), t('{n} ticked#fplural'))}` : t('None#f')],
          [t('Fields to fill'), inputs.length ? `${inputs.length} · ${plural(filled.length, t('{n} filled'), t('{n} filled#plural'))}` : t('None')],
          [t('Sections'), String(sections.size)],
        ]} />
      )}

      {hasFields && sections.size > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[...sections].map(([title, c]) => (
            <span key={title} className="vg-chip" style={{ cursor: 'default' }}>
              {title}
              <span style={{ opacity: 0.6 }}>
                {[c.boxes && `${c.checked}/${c.boxes} ☑`, c.inputs && plural(c.inputs, t('{n} field'), t('{n} fields'))].filter(Boolean).join(' · ')}
              </span>
            </span>
          ))}
        </div>
      )}

      {hasFields && (matched ? (
        <Notice tone="ok" icon="ph-seal-check">
          {t('Template recognised:')} <strong style={{ fontWeight: 500 }}>{fill(t('“{name}”'), { name: matched.name })}</strong>
          {det.format !== 'scan' && det.signature === matched.signature ? t(' (same fields)') : ''}{t(' — its mapping is applied.')}
          {' '}{fill(t('Updated on {date}#m'), { date: fmtDate(matched.updatedOn) })}{matched.updatedBy ? fill(t(' by {name}'), { name: matched.updatedBy }) : ''}.
        </Notice>
      ) : proposed ? (
        <Notice tone="accent" icon="ph-file-magnifying-glass">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <span>
              {t('Form close to the template')} <strong style={{ fontWeight: 500 }}>{fill(t('“{name}”'), { name: proposed.name })}</strong> {fill(t('({pct} % of the fields in common).'), { pct: Math.round(det.proposedTemplate!.overlap * 100) })}
              {applied ? t(' Its mapping is applied; the new fields get a suggestion.') : ''}
            </span>
            {applied
              ? <button type="button" className="vg-text-btn" onClick={() => onApplyTemplate(null)}>{t('Do not apply it')}</button>
              : <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => onApplyTemplate(proposed.id)}><Icon name="ph-check" size={13} />{t('Apply this template')}</button>}
          </div>
        </Notice>
      ) : (
        <Notice tone="neutral" icon="ph-info">
          {t('Unknown form: the mapping is proposed from the labels. Check it, then save it as a template for the next imports.')}
        </Notice>
      ))}

      {det.warnings.length > 0 && (
        <Notice tone="warn">
          {det.warnings.length === 1 ? det.warnings[0] : (
            <ul style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 2 }}>{det.warnings.map((w, i) => <li key={`${i}-${w}`}>{w}</li>)}</ul>
          )}
        </Notice>
      )}

      {det.ai.error && (
        <Notice tone="danger" icon="ph-warning-circle">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: '1 1 320px' }}>{det.ai.error}</span>
            {det.ai.retryable && (
              <button type="button" className="btn btn-secondary vg-btn-sm" disabled={retrying} onClick={retry}>
                {retrying
                  ? <><span className={s.spin} aria-hidden><Icon name="ph-circle-notch" size={13} style={{ display: 'block' }} /></span>{t('Reading in progress…')}</>
                  : <><Icon name="ph-arrow-clockwise" size={13} />{t('Read again')}</>}
              </button>
            )}
          </div>
        </Notice>
      )}
      {retryError && <div role="alert" className="vg-form-error">{retryError}</div>}

      {!hasFields && (
        <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
          {t('No field could be read automatically. Enter the plan from the document: the file will be attached to the plan as the source document.')}
        </span>
      )}

      <div className="dialog-actions" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" disabled={retrying} onClick={onBack}><Icon name="ph-arrow-counter-clockwise" size={14} />{t('Change file')}</button>
        <button type="button" className="btn btn-primary" disabled={retrying} onClick={onContinue}>
          {hasFields ? t('Check the mapping') : t('Enter the plan')}<Icon name="ph-arrow-right" size={14} />
        </button>
      </div>
    </div>
  );
}
