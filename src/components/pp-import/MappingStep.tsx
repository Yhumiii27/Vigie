'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { Notice } from '@/components/prevention/parts';
import { Icon, ToneTag } from '@/components/ui';
import { fmtDate } from '@/lib/dates';
import type { FormState } from '@/lib/forms';
import { PP_TARGETS, type PpImportFormat, type PpImportMapping, type PpTarget } from '@/lib/pp-form';
import { DEFAULT_SECTION, TARGET_LABELS, gridEntry, isTarget, suggestMapping } from '@/lib/pp-import/mapping';
import { normalize } from '@/lib/pp-import/text';
import type { ImportField, MapEntry, TemplateView } from '@/lib/pp-import/types';
import { savePpTemplate } from '@/server/pp-import';
import { FieldValue, KIND_LABELS, muted, plural } from './parts';
import s from './pp-import.module.css';

type Filter = 'all' | 'vigie' | 'grid' | 'ignore' | 'checked';
const FILTERS: [Filter, string][] = [['all', 'Tous'], ['vigie', 'Champs de Vigie'], ['grid', 'Grille du formulaire'], ['ignore', 'Ignorés'], ['checked', 'Cases cochées']];

/** Champs de Vigie à renseigner pour créer un plan (signalés s'ils ne sont alimentés par aucun champ). */
const ESSENTIAL: PpTarget[] = ['contractorName', 'title', 'location', 'startOn', 'endOn', 'estimatedHours'];

const encode = (e: MapEntry | undefined) => (!e ? 'grid' : 'target' in e ? `target:${e.target}` : 'ignore' in e ? 'ignore' : 'grid');
const kindOf = (e: MapEntry | undefined): Exclude<Filter, 'all' | 'checked'> => (!e ? 'grid' : 'target' in e ? 'vigie' : 'ignore' in e ? 'ignore' : 'grid');

type Props = {
  /** « import » : fichier en cours d'import ; « template » : modification d'un modèle enregistré (sans fichier). */
  mode: 'import' | 'template';
  fields: ImportField[];
  mapping: PpImportMapping;
  onChange: (mapping: PpImportMapping) => void;
  /** Modèle appliqué (import) ou modifié (modèle). */
  template: TemplateView | null;
  format: PpImportFormat;
  signature: string | null;
  canManage: boolean;
  onTemplateSaved: (id: number) => void;
  onBack: () => void;
  onContinue?: () => void;
};

/** Étape 3 : correspondance de chaque champ détecté vers un champ de Vigie, une ligne de la grille ou « ignoré ». */
export function MappingStep({ mode, fields, mapping, onChange, template, format, signature, canManage, onTemplateSaved, onBack, onContinue }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  // Dernière ligne de grille saisie par champ : rétablie si l'on repasse sur « Ligne de la grille ».
  const gridMemory = useRef(new Map<string, MapEntry>());

  const set = (key: string, entry: MapEntry) => {
    if ('section' in (mapping[key] ?? {})) gridMemory.current.set(key, mapping[key]);
    onChange({ ...mapping, [key]: entry });
  };
  const choose = (f: ImportField, value: string) => {
    if (value === 'ignore') set(f.key, { ignore: true });
    else if (value === 'grid') set(f.key, gridMemory.current.get(f.key) ?? gridEntry(f));
    else if (value.startsWith('target:') && isTarget(value.slice(7))) set(f.key, { target: value.slice(7) as PpTarget });
  };
  const editGrid = (f: ImportField, patch: { section?: string; label?: string }) => {
    const cur = mapping[f.key];
    const base = cur && 'section' in cur ? cur : gridEntry(f) as { section: string; label: string };
    onChange({ ...mapping, [f.key]: { ...base, ...patch } });
  };

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: fields.length, vigie: 0, grid: 0, ignore: 0, checked: 0 };
    fields.forEach((f) => {
      c[kindOf(mapping[f.key])] += 1;
      if (f.kind === 'checkbox' && f.checked) c.checked += 1;
    });
    return c;
  }, [fields, mapping]);
  const usedTargets = useMemo(() => {
    const m = new Map<PpTarget, string[]>();
    fields.forEach((f) => { const e = mapping[f.key]; if (e && 'target' in e) m.set(e.target, [...(m.get(e.target) ?? []), f.key]); });
    return m;
  }, [fields, mapping]);
  const sectionNames = useMemo(() => [...new Set(Object.values(mapping).flatMap((e) => ('section' in e && e.section ? [e.section] : [])))].sort((a, b) => a.localeCompare(b, 'fr')), [mapping]);
  const missing = ESSENTIAL.filter((t) => !usedTargets.has(t));

  const q = normalize(query);
  const shown = fields.filter((f) => {
    if (filter === 'checked' ? !(f.kind === 'checkbox' && f.checked) : filter !== 'all' && kindOf(mapping[f.key]) !== filter) return false;
    if (!q) return true;
    const e = mapping[f.key];
    return normalize(`${f.label} ${f.key} ${f.section ?? ''} ${f.value ?? ''} ${e && 'section' in e ? `${e.section} ${e.label}` : ''}`).includes(q);
  });
  const templateKeys = template ? new Set(Object.keys(template.mapping)) : null;
  const isTemplateMode = mode === 'template';

  return (
    <div className="card" style={{ gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 2 }}>
          <span className="card-kicker">{isTemplateMode ? "Modèle d'import · correspondance" : 'Étape 3 · Correspondance'}</span>
          <span className="card-title" style={{ fontSize: 15 }}>
            {isTemplateMode ? `« ${template?.name ?? ''} »` : 'Que faire de chaque champ du formulaire ?'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-500)', textWrap: 'pretty', maxWidth: 760 }}>
            Un champ alimente un champ du plan dans Vigie, devient une ligne de la grille conservée avec le plan (section et libellé modifiables), ou est ignoré.
          </span>
        </div>
        <button type="button" className="vg-text-btn" onClick={() => { gridMemory.current.clear(); onChange(isTemplateMode && template ? { ...template.mapping } : suggestMapping(fields)); }}>
          <Icon name="ph-arrow-counter-clockwise" size={12} style={{ marginRight: 4 }} />{isTemplateMode ? 'Annuler les modifications' : 'Rétablir les suggestions'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.filter(([k]) => !(isTemplateMode && k === 'checked')).map(([key, label]) => (
          <button key={key} type="button" className={`vg-chip${filter === key ? ' is-on' : ''}`} onClick={() => setFilter(key)} aria-pressed={filter === key}>
            {label}<span style={{ opacity: 0.6 }}>{counts[key]}</span>
          </button>
        ))}
        <span style={{ position: 'relative', width: 240, maxWidth: '100%', marginLeft: 'auto' }}>
          <Icon name="ph-magnifying-glass" size={13} style={{ position: 'absolute', left: 9, top: 7, color: 'var(--color-neutral-500)' }} />
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Libellé, section, valeur…" aria-label="Rechercher un champ"
            style={{ fontSize: 12, lineHeight: 1.2, minHeight: 0, padding: '5px 10px 5px 28px' }} />
        </span>
      </div>

      {!isTemplateMode && missing.length > 0 && (
        <Notice tone="neutral" icon="ph-info">
          Sans correspondance (à saisir à l&apos;étape suivante) : {missing.map((t) => TARGET_LABELS[t].replace(/^Entreprise extérieure — /, 'Entreprise extérieure : ')).join(' · ')}.
        </Notice>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: isTemplateMode ? 720 : 980 }}>
          <thead>
            <tr>
              <th>Champ détecté</th>
              {!isTemplateMode && <><th>Type</th><th>Valeur lue</th><th style={{ textAlign: 'right' }}>Page</th></>}
              <th style={{ width: 330 }}>Correspondance dans Vigie</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={isTemplateMode ? 2 : 5} style={{ ...muted, fontSize: 12, padding: '14px 8px' }}>Aucun champ pour ce filtre.</td></tr>
            )}
            {shown.map((f) => {
              const entry = mapping[f.key];
              const value = encode(entry);
              const grid = entry && 'section' in entry ? entry : null;
              const isNew = !!templateKeys && !isTemplateMode && !templateKeys.has(f.key);
              return (
                <tr key={f.key} className={`${s.mapRow} ${value === 'ignore' ? s.mapRowIgnored : ''}`}>
                  <td style={{ minWidth: 220, maxWidth: 360 }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ textWrap: 'pretty' }}>{f.label}</span>
                      {isNew && <ToneTag tone="warn" style={{ fontSize: 10, padding: '1px 6px' }}>nouveau</ToneTag>}
                    </span>
                    <span style={{ display: 'block', ...muted, wordBreak: 'break-all' }} title="Clé du champ dans le fichier">
                      {f.section ? `${f.section} · ` : ''}{f.key}
                    </span>
                  </td>
                  {!isTemplateMode && (
                    <>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--color-neutral-400)' }}>{KIND_LABELS[f.kind]}</td>
                      <td style={{ minWidth: 160, maxWidth: 300 }}><FieldValue field={f} /></td>
                      <td style={{ textAlign: 'right', color: 'var(--color-neutral-400)' }}>{f.page ?? '—'}</td>
                    </>
                  )}
                  <td>
                    <div style={{ display: 'grid', gap: 5 }}>
                      <select className={`input ${s.compact}`} value={value} disabled={!canManage} aria-label={`Correspondance de « ${f.label} »`}
                        onChange={(e) => choose(f, e.target.value)}>
                        <optgroup label="Champ du plan dans Vigie">
                          {PP_TARGETS.map(([k, label]) => {
                            const others = (usedTargets.get(k) ?? []).filter((x) => x !== f.key);
                            return <option key={k} value={`target:${k}`}>{label}{others.length ? ' · déjà associé' : ''}</option>;
                          })}
                        </optgroup>
                        <optgroup label="Formulaire">
                          <option value="grid">Ligne de la grille du formulaire</option>
                          <option value="ignore">Ignorer</option>
                        </optgroup>
                      </select>
                      {grid && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 5 }}>
                          <input className={`input ${s.compact}`} value={grid.section} list="pp-import-sections" disabled={!canManage} maxLength={200}
                            placeholder={DEFAULT_SECTION} aria-label="Section de la grille" title="Section de la grille"
                            onChange={(e) => editGrid(f, { section: e.target.value })} />
                          <input className={`input ${s.compact}`} value={grid.label} disabled={!canManage} maxLength={300}
                            aria-label="Libellé de la ligne" title="Libellé de la ligne"
                            onChange={(e) => editGrid(f, { label: e.target.value })} />
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="pp-import-sections">{sectionNames.map((n) => <option key={n} value={n} />)}</datalist>
      </div>

      {canManage && (
        <TemplateSaver mode={mode} template={template} format={format} signature={signature}
          mapping={mapping} fields={fields} onSaved={onTemplateSaved} />
      )}

      <div className="dialog-actions" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          <Icon name="ph-arrow-left" size={14} />{isTemplateMode ? 'Retour aux modèles' : 'Retour'}
        </button>
        {onContinue && (
          <button type="button" className="btn btn-primary" onClick={onContinue}>Vérifier le plan<Icon name="ph-arrow-right" size={14} /></button>
        )}
      </div>
    </div>
  );
}

/** Enregistrement de la correspondance comme modèle (nouveau, mise à jour du modèle appliqué ou modifié). */
function TemplateSaver({ mode, template, format, signature, mapping, fields, onSaved }: {
  mode: 'import' | 'template';
  template: TemplateView | null;
  format: PpImportFormat;
  signature: string | null;
  mapping: PpImportMapping;
  fields: ImportField[];
  onSaved: (id: number) => void;
}) {
  const [asNew, setAsNew] = useState(!template);
  const [name, setName] = useState('');
  const [state, setState] = useState<FormState & { message?: string }>({});
  const [pending, start] = useTransition();
  const empty = !fields.length || !Object.keys(mapping).length;

  const save = (opts: { id?: number; name: string; merge: boolean; signature: string | null; format: PpImportFormat }) => start(async () => {
    const fd = new FormData();
    if (opts.id) fd.set('id', String(opts.id));
    fd.set('name', opts.name);
    fd.set('format', opts.format);
    if (opts.signature) fd.set('signature', opts.signature);
    if (opts.merge) fd.set('merge', '1');
    // Seules les clés du fichier (ou du modèle) sont enregistrées ; un libellé de grille effacé reprend le libellé détecté.
    fd.set('mapping', JSON.stringify(Object.fromEntries(fields.map((f) => {
      const entry = mapping[f.key] ?? gridEntry(f);
      if (!('section' in entry)) return [f.key, entry];
      const fallback = gridEntry(f) as { section: string; label: string };
      return [f.key, { section: entry.section.trim().slice(0, 200), label: (entry.label.trim() || fallback.label).slice(0, 300) }];
    }))));
    try {
      const r = await savePpTemplate({}, fd);
      if (r.ok && r.id) {
        setState({ ok: true, message: `Modèle « ${opts.name.trim()} » enregistré${mode === 'import' ? ' : il sera reconnu au prochain import de ce formulaire' : ''}.` });
        setAsNew(false);
        setName('');
        onSaved(Number(r.id));
      } else {
        setState(r);
      }
    } catch {
      setState({ error: "Enregistrement impossible : la connexion au serveur a été interrompue." });
    }
  });

  if (mode === 'template' && template) {
    return (
      <div className="vg-inset" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px' }}>
        <Icon name="ph-floppy-disk" size={16} style={{ color: 'var(--color-neutral-400)' }} />
        <span style={{ fontSize: 12.5, flex: 1, minWidth: 220 }}>
          {plural(fields.length, 'champ', 'champs')} · mis à jour le {fmtDate(template.updatedOn)}{template.updatedBy ? ` par ${template.updatedBy}` : ''}
        </span>
        {state.error && <span role="alert" style={{ fontSize: 12, color: 'var(--tone-danger-fg)' }}>{state.error}</span>}
        {state.message && <span role="status" style={{ fontSize: 12, color: 'var(--tone-ok-fg)' }}>{state.message}</span>}
        <button type="button" className="btn btn-primary vg-btn-sm" disabled={pending || empty}
          onClick={() => save({ id: template.id, name: template.name, merge: false, signature: template.signature, format: template.format })}>
          <Icon name="ph-floppy-disk" size={13} />{pending ? 'Enregistrement…' : 'Enregistrer le modèle'}
        </button>
      </div>
    );
  }

  return (
    <div className="vg-inset" style={{ display: 'grid', gap: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Icon name="ph-floppy-disk" size={16} style={{ color: 'var(--color-neutral-400)' }} />
        {template && !asNew ? (
          <>
            <span style={{ fontSize: 12.5, flex: 1, minWidth: 220 }}>
              Modèle appliqué : <strong style={{ fontWeight: 500 }}>« {template.name} »</strong>
              <span style={{ display: 'block', ...muted }}>Mettre à jour le modèle y ajoute les champs nouveaux et les corrections de cette correspondance.</span>
            </span>
            {/* Même formulaire (même empreinte) : un seul modèle le reconnaît, on le met à jour. */}
            {!(signature && template.format === format && template.signature === signature) && (
              <button type="button" className="vg-text-btn" onClick={() => { setAsNew(true); setState({}); }}>Enregistrer comme nouveau modèle</button>
            )}
            <button type="button" className="btn btn-secondary vg-btn-sm" disabled={pending || empty}
              onClick={() => save({ id: template.id, name: template.name, merge: true, signature, format })}>
              <Icon name="ph-floppy-disk" size={13} />{pending ? 'Enregistrement…' : 'Mettre à jour le modèle'}
            </button>
          </>
        ) : (
          <form style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}
            onSubmit={(e) => { e.preventDefault(); if (name.trim()) save({ name, merge: false, signature, format }); }}>
            <label htmlFor="pp-template-name" style={{ fontSize: 12.5 }}>Enregistrer comme modèle</label>
            <input id="pp-template-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Plan de prévention [Entreprise X] — PDF" aria-invalid={!!state.fieldErrors?.name || undefined}
              style={{ fontSize: 12.5, minHeight: 0, padding: '5px 10px', width: 320, maxWidth: '100%' }} />
            <button type="submit" className="btn btn-secondary vg-btn-sm" disabled={pending || empty || !name.trim()}>
              <Icon name="ph-floppy-disk" size={13} />{pending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {template && <button type="button" className="vg-text-btn" onClick={() => { setAsNew(false); setState({}); }}>Annuler</button>}
          </form>
        )}
      </div>
      {(state.fieldErrors?.name || state.error) && <span role="alert" style={{ fontSize: 12, color: 'var(--tone-danger-fg)' }}>{state.fieldErrors?.name ?? state.error}</span>}
      {state.message && <span role="status" style={{ fontSize: 12, color: 'var(--tone-ok-fg)' }}>{state.message}</span>}
    </div>
  );
}
