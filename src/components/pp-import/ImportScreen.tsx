'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Notice } from '@/components/prevention/parts';
import { Icon } from '@/components/ui';
import type { PpFormData, PpImportMapping } from '@/lib/pp-form';
import { EMPTY_DRAFT, buildDraft, type PlanDraft } from '@/lib/pp-import/draft';
import { applyMapping, fieldsFromTemplate, initialMapping } from '@/lib/pp-import/mapping';
import type { ImportScreenData, TemplateView } from '@/lib/pp-import/types';
import { DetectStep } from './DetectStep';
import { DropStep, type DetectOk } from './DropStep';
import { MappingStep } from './MappingStep';
import { ReviewStep } from './ReviewStep';
import { TemplatesPanel } from './TemplatesPanel';
import { Stepper, type Stage } from './parts';

export type ImportTab = 'import' | 'modeles';

type Flow = {
  stage: Stage;
  file: File | null;
  det: DetectOk | null;
  mapping: PpImportMapping;
  templateId: number | null;
  review: { draft: PlanDraft; sections: PpFormData['sections']; version: number } | null;
};
const START: Flow = { stage: 'drop', file: null, det: null, mapping: {}, templateId: null, review: null };

/** Écran d'import : déroulé en quatre étapes et gestion des modèles d'import. */
export function ImportScreen({ data, canManage, initialTab }: { data: ImportScreenData; canManage: boolean; initialTab: ImportTab }) {
  const [tab, setTab] = useState<ImportTab>(canManage ? initialTab : 'modeles');
  const [flow, setFlow] = useState<Flow>(START);
  // Modification de la correspondance d'un modèle enregistré (sans fichier).
  const [editing, setEditing] = useState<{ template: TemplateView; mapping: PpImportMapping } | null>(null);

  const templateOf = (id: number | null) => data.templates.find((t) => t.id === id) ?? null;

  const switchTab = (next: ImportTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'modeles') url.searchParams.set('onglet', 'modeles');
    else url.searchParams.delete('onglet');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  };

  const onDetected = (file: File, det: DetectOk) => {
    const tpl = templateOf(det.matchedTemplateId);
    setFlow({ stage: 'detect', file, det, templateId: tpl?.id ?? null, mapping: initialMapping(det.fields, tpl?.mapping), review: null });
  };
  const applyTemplate = (id: number | null) => setFlow((f) => {
    if (!f.det) return f;
    const tpl = templateOf(id);
    return { ...f, templateId: tpl?.id ?? null, mapping: initialMapping(f.det.fields, tpl?.mapping) };
  });
  const toReview = () => setFlow((f) => {
    if (!f.det) return f;
    const applied = applyMapping(f.det.fields, f.mapping);
    const draft = f.det.fields.length
      ? buildDraft(applied, { contractors: data.contractors, projects: data.projects, today: data.today })
      : { ...EMPTY_DRAFT, hints: {} };
    return { ...f, stage: 'review', review: { draft, sections: applied.sections, version: (f.review?.version ?? 0) + 1 } };
  });
  const go = (stage: Stage) => setFlow((f) => (stage === 'drop' ? START : { ...f, stage }));
  const reachable: Stage[] = flow.det ? (flow.det.fields.length ? ['drop', 'detect', 'map'] : ['drop', 'detect']) : ['drop'];

  const tabs: [ImportTab, string, number | null][] = [
    ['import', 'Importer un formulaire', null],
    ['modeles', "Modèles d'import", data.templates.length],
  ];

  return (
    <>
      <div className="vg-tabs">
        {tabs.filter(([key]) => canManage || key === 'modeles').map(([key, label, n]) => (
          <button key={key} type="button" className={`vg-tab${tab === key ? ' is-on' : ''}`} onClick={() => switchTab(key)}
            style={{ background: 'none', border: 0, font: 'inherit' }} aria-pressed={tab === key}>
            <span>{label}</span>{n != null && <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{n}</span>}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, paddingBottom: 6 }}>
          <Link href="/prevention" className="btn btn-ghost vg-btn-sm"><Icon name="ph-arrow-left" size={13} />Plans de prévention</Link>
        </span>
      </div>

      {!canManage && (
        <Notice tone="neutral" icon="ph-info">Votre rôle permet de consulter les modèles d&apos;import ; l&apos;import d&apos;un plan de prévention est réservé à l&apos;encadrement.</Notice>
      )}

      {tab === 'modeles' && !editing && (
        <TemplatesPanel templates={data.templates} canManage={canManage}
          onEditMapping={(t) => setEditing({ template: t, mapping: { ...t.mapping } })}
          onImport={() => switchTab('import')} />
      )}
      {tab === 'modeles' && editing && (
        <MappingStep key={editing.template.id} mode="template" fields={fieldsFromTemplate(editing.template.mapping)}
          mapping={editing.mapping} onChange={(mapping) => setEditing((e) => (e ? { ...e, mapping } : e))}
          template={templateOf(editing.template.id) ?? editing.template} format={editing.template.format} signature={editing.template.signature}
          canManage={canManage} onTemplateSaved={() => undefined} onBack={() => setEditing(null)} />
      )}

      {tab === 'import' && canManage && (
        <>
          <Stepper stage={flow.stage} reachable={reachable} onGo={go} />
          {flow.stage === 'drop' && <DropStep templates={data.templates} aiStatus={data.aiStatus} onDetected={onDetected} />}
          {flow.stage === 'detect' && flow.file && flow.det && (
            <DetectStep file={flow.file} det={flow.det} templates={data.templates} appliedTemplateId={flow.templateId}
              onApplyTemplate={applyTemplate} onRedetected={(det) => onDetected(flow.file!, det)} onBack={() => go('drop')}
              onContinue={() => (flow.det!.fields.length ? setFlow((f) => ({ ...f, stage: 'map' })) : toReview())} />
          )}
          {flow.stage === 'map' && flow.det && (
            <MappingStep mode="import" fields={flow.det.fields} mapping={flow.mapping} onChange={(mapping) => setFlow((f) => ({ ...f, mapping }))}
              template={templateOf(flow.templateId)} format={flow.det.format} signature={flow.det.signature} canManage={canManage}
              onTemplateSaved={(id) => setFlow((f) => ({ ...f, templateId: id }))}
              onBack={() => go('detect')} onContinue={toReview} />
          )}
          {flow.stage === 'review' && flow.file && flow.det && flow.review && (
            <ReviewStep key={flow.review.version} data={data} draft={flow.review.draft} sections={flow.review.sections}
              file={flow.file} format={flow.det.format} templateId={flow.templateId} templateName={templateOf(flow.templateId)?.name ?? null}
              onBack={() => go(flow.det!.fields.length ? 'map' : 'detect')} />
          )}
        </>
      )}
    </>
  );
}
