'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Field, Input, Select } from '@/components/form';
import { TONE } from '@/lib/domain';
import type { Option } from '@/lib/data/options';
import type { WorkUnitView } from '@/lib/data/risks';
import type { FormState } from '@/lib/forms';
import { deleteWorkUnit, saveWorkUnit } from '@/server/risks';

/** URL de l'écran sur une unité donnée, en conservant le mode brut / résiduel. */
const unitHref = (id: string | null, residual: boolean) => {
  const qs = new URLSearchParams();
  if (id) qs.set('unite', id);
  if (residual) qs.set('mode', 'residuel');
  const s = qs.toString();
  return s ? `/risques?${s}` : '/risques';
};

/** Site affiché dans l'en-tête (null = « Tous les sites »). */
type ViewSite = { id: string; label: string } | null;

/** Vrai si une unité rattachée à `siteId` n'apparaît pas dans la liste du site affiché. */
const hiddenFrom = (viewSite: ViewSite, siteId: string) => !!viewSite && siteId !== viewSite.id;

function UnitFields({ unit, sites, defaultSiteId, viewSite, onDone, onCancel }: {
  unit?: Pick<WorkUnitView, 'id' | 'label' | 'siteId'>;
  sites: readonly Option[];
  defaultSiteId: string;
  viewSite: ViewSite;
  /** `siteId` : site enregistré pour l'unité. */
  onDone: (state: FormState, siteId: string) => void;
  onCancel: () => void;
}) {
  const [siteId, setSiteId] = useState(unit?.siteId ?? defaultSiteId);
  const siteLabel = sites.find(([id]) => id === siteId)?.[1] ?? siteId;
  const hint = viewSite && hiddenFrom(viewSite, siteId)
    ? <span style={{ color: TONE.warn.fg }}>L&apos;unité n&apos;apparaîtra pas dans la liste de « {viewSite.label} » : elle sera visible sur « {siteLabel} » et dans « Tous les sites ».</span>
    : "L'unité apparaît sur ce site et dans « Tous les sites ».";
  return (
    <ActionForm action={saveWorkUnit} onDone={(state) => onDone(state, siteId)} onCancel={onCancel} submitLabel={unit ? 'Enregistrer' : "Ajouter l'unité"} hidden={{ id: unit?.id }}>
      <Field name="label" label="Libellé" hint="Poste, atelier, zone ou activité regroupant des salariés exposés aux mêmes risques.">
        <Input name="label" defaultValue={unit?.label} maxLength={80} autoFocus placeholder="Ex. Atelier peinture" />
      </Field>
      <Field name="siteId" label="Site" hint={hint}>
        <Select name="siteId" options={sites} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
      </Field>
    </ActionForm>
  );
}

/** Petit bouton sous la liste des unités : ajoute une unité de travail puis l'affiche (si elle relève du site affiché). */
export function AddUnitButton({ sites, defaultSiteId, viewSite, residual }: { sites: readonly Option[]; defaultSiteId: string; viewSite: ViewSite; residual: boolean }) {
  const router = useRouter();
  return (
    <DialogButton label="Ajouter une unité de travail" icon="ph-plus" className="btn btn-ghost" style={{ fontSize: 12, justifySelf: 'start', marginTop: 4 }}
      title="Ajouter une unité de travail" kicker="Document unique" width={480}>
      {(close) => (
        <UnitFields sites={sites} defaultSiteId={defaultSiteId} viewSite={viewSite} onCancel={close}
          onDone={(s, siteId) => { close(); if (s.id && !hiddenFrom(viewSite, siteId)) router.push(unitHref(s.id, residual), { scroll: false }); }} />
      )}
    </DialogButton>
  );
}

/** Crayon à côté du nom de l'unité : renomme l'unité, change son site, ou la supprime si elle est vide. */
export function EditUnitButton({ unit, sites, viewSite, residual }: { unit: Pick<WorkUnitView, 'id' | 'label' | 'siteId' | 'count'>; sites: readonly Option[]; viewSite: ViewSite; residual: boolean }) {
  return (
    <DialogButton label="" icon="ph-pencil-simple" className="btn btn-ghost btn-icon" tooltip="Modifier l'unité de travail"
      style={{ width: 22, height: 22, color: 'var(--color-neutral-500)' }} title={unit.label} kicker="Modifier l'unité de travail" width={480}>
      {(close) => <UnitEditor unit={unit} sites={sites} viewSite={viewSite} residual={residual} onClose={close} />}
    </DialogButton>
  );
}

function UnitEditor({ unit, sites, viewSite, residual, onClose }: {
  unit: Pick<WorkUnitView, 'id' | 'label' | 'siteId' | 'count'>;
  sites: readonly Option[];
  viewSite: ViewSite;
  residual: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (confirming) {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <p className="dialog-body" style={{ margin: 0, fontSize: 13 }}>Supprimer l&apos;unité de travail « {unit.label} » ? Elle ne porte aucun risque.</p>
        {error && <div role="alert" className="vg-form-error">{error}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => { setConfirming(false); setError(null); }}>Annuler</button>
          <button type="button" className="btn" style={{ color: TONE.danger.fg, borderColor: TONE.danger.dot }} disabled={pending}
            onClick={() => start(async () => {
              const r = await deleteWorkUnit(unit.id);
              if (r.error) { setError(r.error); return; }
              onClose();
              router.push(unitHref(null, residual), { scroll: false });
            })}>
            <i className="ph ph-trash" style={{ fontSize: 14 }} />{pending ? 'Suppression…' : "Supprimer l'unité"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <UnitFields unit={unit} sites={sites} defaultSiteId={unit.siteId ?? sites[0]?.[0] ?? ''} viewSite={viewSite} onCancel={onClose}
        onDone={(_, siteId) => {
          onClose();
          // Unité déplacée vers un autre site : elle quitte la liste affichée, on revient à la première unité.
          if (hiddenFrom(viewSite, siteId)) router.push(unitHref(null, residual), { scroll: false });
        }} />
      <button type="button" className="btn btn-ghost" disabled={unit.count > 0}
        title={unit.count > 0 ? `Unité non vide : ${unit.count} risque${unit.count > 1 ? 's' : ''} à supprimer ou déplacer d'abord.` : undefined}
        style={{ position: 'absolute', left: 0, bottom: 0, color: unit.count > 0 ? 'var(--color-neutral-600)' : TONE.danger.fg }}
        onClick={() => setConfirming(true)}>
        <i className="ph ph-trash" style={{ fontSize: 14 }} />Supprimer
      </button>
    </div>
  );
}
