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

/** Onglet « Modèles d'import » : liste, renommage, modification de la correspondance, suppression. */
export function TemplatesPanel({ templates, canManage, onEditMapping, onImport }: {
  templates: TemplateView[];
  canManage: boolean;
  onEditMapping: (t: TemplateView) => void;
  onImport: () => void;
}) {
  const [renaming, setRenaming] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const rename = (t: TemplateView) => start(async () => {
    const fd = new FormData();
    fd.set('id', String(t.id));
    fd.set('name', name);
    try {
      const r = await renamePpTemplate({}, fd);
      if (r.ok) { setRenaming(null); setError(null); } else setError(r.fieldErrors?.name ?? r.error ?? 'Renommage impossible.');
    } catch {
      setError('Renommage impossible : la connexion au serveur a été interrompue.');
    }
  });
  const remove = (t: TemplateView) => start(async () => {
    try {
      const r = await deletePpTemplate(t.id);
      setError(r.error ?? null);
    } catch {
      setError('Suppression impossible : la connexion au serveur a été interrompue.');
    }
  });

  return (
    <div className="card" style={{ gap: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty', maxWidth: 780 }}>
          Un modèle mémorise la correspondance d&apos;un formulaire. Il est reconnu automatiquement à l&apos;import suivant (même format et mêmes champs),
          ou proposé quand au moins 80 % des champs sont communs ; pour un scan, choisissez-le au dépôt du fichier.
        </span>
        {canManage && <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onImport}><Icon name="ph-file-arrow-up" size={13} />Importer un formulaire</button>}
      </div>
      <ErrorLine error={error} />
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 820 }}>
          <thead>
            <tr><th>Nom</th><th>Format</th><th>Champs</th><th>Mis à jour</th>{canManage && <th style={{ textAlign: 'right' }}>Actions</th>}</tr>
          </thead>
          <tbody>
            {templates.length === 0 && (
              <tr>
                <td colSpan={canManage ? 5 : 4} style={{ ...muted, fontSize: 12, padding: '14px 8px' }}>
                  Aucun modèle enregistré. Importez un formulaire puis « Enregistrer comme modèle » à l&apos;étape Correspondance.
                </td>
              </tr>
            )}
            {templates.map((t) => {
              const st = mappingStats(t.mapping);
              return (
                <tr key={t.id} className={s.mapRow}>
                  <td style={{ minWidth: 240 }}>
                    {renaming === t.id ? (
                      <form style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); if (name.trim()) rename(t); }}>
                        <input className={`input ${s.compact}`} value={name} maxLength={120} autoFocus aria-label="Nouveau nom du modèle"
                          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }} style={{ width: 260, maxWidth: '100%' }} />
                        <button type="submit" className="btn btn-primary vg-btn-sm" disabled={pending || !name.trim()}>Renommer</button>
                        <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => { setRenaming(null); setError(null); }}>Annuler</button>
                      </form>
                    ) : (
                      <span style={{ fontWeight: 500 }}>{t.name}</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Icon name={FORMAT_ICONS[t.format]} size={14} style={{ color: 'var(--color-neutral-400)' }} />{FORMAT_LABELS[t.format]}
                    </span>
                    {t.format !== 'scan' && !t.signature && <span style={{ display: 'block', ...muted }}>sans empreinte : choisi au dépôt</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {plural(st.total, 'champ', 'champs')}
                    <span style={{ display: 'block', ...muted }}>
                      {[st.targets && `${st.targets} vers Vigie`, st.grid && plural(st.grid, 'ligne de grille', 'lignes de grille'), st.ignored && plural(st.ignored, 'ignoré', 'ignorés')].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {fmtDate(t.updatedOn)}
                    {t.updatedBy && <span style={{ display: 'block', ...muted }}>{t.updatedBy}</span>}
                  </td>
                  {canManage && (
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending} onClick={() => { setRenaming(t.id); setName(t.name); setError(null); }}>
                          <Icon name="ph-pencil-simple" size={13} />Renommer
                        </button>
                        <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending || !st.total} onClick={() => onEditMapping(t)}>
                          <Icon name="ph-list-checks" size={13} />Modifier la correspondance
                        </button>
                        <ConfirmButton label="Supprimer" confirmLabel="Supprimer" icon="ph-trash" pending={pending}
                          question={`Supprimer le modèle « ${t.name} » ? Les plans déjà importés ne changent pas.`} onConfirm={() => remove(t)} />
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
          <ToneTag tone="neutral" style={{ fontSize: 10, padding: '1px 6px', marginRight: 6 }}>Clés</ToneTag>
          Chaque champ est identifié par sa clé : nom du champ PDF, étiquette du contrôle Word, ou section et libellé.
        </span>
      )}
    </div>
  );
}
