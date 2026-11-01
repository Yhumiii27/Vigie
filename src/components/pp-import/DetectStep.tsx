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
      setRetryError('Lecture impossible : la connexion au serveur a été interrompue. Réessayez.');
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
  const matched = templates.find((t) => t.id === det.matchedTemplateId);
  const proposed = det.proposedTemplate ? templates.find((t) => t.id === det.proposedTemplate!.id) : undefined;
  const applied = templates.find((t) => t.id === appliedTemplateId);
  const hasFields = det.fields.length > 0;

  return (
    <div className="card" style={{ gap: 12 }}>
      <div style={{ display: 'grid', gap: 2 }}>
        <span className="card-kicker">Étape 2 · Détection</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Icon name={FORMAT_ICONS[det.format]} size={18} style={{ color: 'var(--color-neutral-400)' }} />
          <span className="card-title" style={{ fontSize: 15, wordBreak: 'break-word' }}>{det.fileName}</span>
          <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>{fileSize(files.reduce((n, f) => n + f.size, 0))}{det.pageCount ? ` · ${plural(det.pageCount, 'page', 'pages')}` : ''}</span>
          <ToneTag tone="accent">{FORMAT_LABELS[det.format]}</ToneTag>
          {det.ai.used && <ToneTag tone="neutral"><Icon name="ph-sparkle" size={11} style={{ marginRight: 4 }} />Lu par l&apos;API Claude</ToneTag>}
        </div>
      </div>

      {hasFields && (
        <Facts items={[
          ['Champs détectés', String(det.fields.length)],
          ['Cases à cocher', boxes.length ? `${boxes.length} · ${plural(boxes.filter((b) => b.checked).length, 'cochée', 'cochées')}` : 'Aucune'],
          ['Champs à remplir', inputs.length ? `${inputs.length} · ${plural(filled.length, 'rempli', 'remplis')}` : 'Aucun'],
          ['Sections', String(sections.size)],
        ]} />
      )}

      {hasFields && sections.size > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[...sections].map(([title, c]) => (
            <span key={title} className="vg-chip" style={{ cursor: 'default' }}>
              {title}
              <span style={{ opacity: 0.6 }}>
                {[c.boxes && `${c.checked}/${c.boxes} ☑`, c.inputs && plural(c.inputs, 'champ', 'champs')].filter(Boolean).join(' · ')}
              </span>
            </span>
          ))}
        </div>
      )}

      {hasFields && (matched ? (
        <Notice tone="ok" icon="ph-seal-check">
          Modèle reconnu : <strong style={{ fontWeight: 500 }}>« {matched.name} »</strong>
          {det.format !== 'scan' && det.signature === matched.signature ? ' (mêmes champs)' : ''} — sa correspondance est appliquée.
          {' '}Mis à jour le {fmtDate(matched.updatedOn)}{matched.updatedBy ? ` par ${matched.updatedBy}` : ''}.
        </Notice>
      ) : proposed ? (
        <Notice tone="accent" icon="ph-file-magnifying-glass">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <span>
              Formulaire proche du modèle <strong style={{ fontWeight: 500 }}>« {proposed.name} »</strong> ({Math.round(det.proposedTemplate!.overlap * 100)} % des champs en commun).
              {applied ? ' Sa correspondance est appliquée ; les champs nouveaux reçoivent une suggestion.' : ''}
            </span>
            {applied
              ? <button type="button" className="vg-text-btn" onClick={() => onApplyTemplate(null)}>Ne pas l&apos;appliquer</button>
              : <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => onApplyTemplate(proposed.id)}><Icon name="ph-check" size={13} />Appliquer ce modèle</button>}
          </div>
        </Notice>
      ) : (
        <Notice tone="neutral" icon="ph-info">
          Formulaire inconnu : la correspondance est proposée d&apos;après les libellés. Vérifiez-la, puis enregistrez-la comme modèle pour les prochains imports.
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
                  ? <><span className={s.spin} aria-hidden><Icon name="ph-circle-notch" size={13} style={{ display: 'block' }} /></span>Lecture en cours…</>
                  : <><Icon name="ph-arrow-clockwise" size={13} />Relancer la lecture</>}
              </button>
            )}
          </div>
        </Notice>
      )}
      {retryError && <div role="alert" className="vg-form-error">{retryError}</div>}

      {!hasFields && (
        <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
          Aucun champ n&apos;a pu être lu automatiquement. Saisissez le plan à partir du document : le fichier sera joint au plan comme document source.
        </span>
      )}

      <div className="dialog-actions" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" disabled={retrying} onClick={onBack}><Icon name="ph-arrow-counter-clockwise" size={14} />Changer de fichier</button>
        <button type="button" className="btn btn-primary" disabled={retrying} onClick={onContinue}>
          {hasFields ? 'Vérifier la correspondance' : 'Saisir le plan'}<Icon name="ph-arrow-right" size={14} />
        </button>
      </div>
    </div>
  );
}
