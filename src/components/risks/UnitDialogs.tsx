'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DialogButton } from '@/components/Dialog';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { ActionForm, Field, Input, Select } from '@/components/form';
import { ReasonButton, ReasonForm } from '@/components/ReasonDialog';
import { TONE } from '@/lib/domain';
import type { Option } from '@/lib/data/options';
import type { ArchivedUnitView, WorkUnitView } from '@/lib/data/risks';
import type { FormState } from '@/lib/forms';
import { archiveWorkUnit, moveWorkUnit, restoreWorkUnit, saveWorkUnit } from '@/server/risks';

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

type Position = { isFirst: boolean; isLast: boolean };

/** Crayon à côté du nom de l'unité : renomme l'unité, change son site, la déplace dans la liste ou l'archive si elle n'a plus de risque en vigueur. */
export function EditUnitButton({ unit, sites, viewSite, residual, isFirst, isLast }: { unit: Pick<WorkUnitView, 'id' | 'label' | 'siteId' | 'count'>; sites: readonly Option[]; viewSite: ViewSite; residual: boolean } & Position) {
  return (
    <DialogButton label="" icon="ph-pencil-simple" className="btn btn-ghost btn-icon" tooltip="Modifier l'unité de travail"
      style={{ width: 22, height: 22, color: 'var(--color-neutral-500)' }} title={unit.label} kicker="Modifier l'unité de travail" width={480}>
      {(close) => <UnitEditor unit={unit} sites={sites} viewSite={viewSite} residual={residual} isFirst={isFirst} isLast={isLast} onClose={close} />}
    </DialogButton>
  );
}

function UnitEditor({ unit, sites, viewSite, residual, isFirst, isLast, onClose }: {
  unit: Pick<WorkUnitView, 'id' | 'label' | 'siteId' | 'count'>;
  sites: readonly Option[];
  viewSite: ViewSite;
  residual: boolean;
  onClose: () => void;
} & Position) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (confirming) {
    return (
      <ReasonForm action={archiveWorkUnit} hidden={{ id: unit.id }} submitLabel="Archiver l'unité" submitIcon="ph-archive"
        placeholder="Ex. atelier fermé, activité regroupée avec une autre unité…" onCancel={() => setConfirming(false)}
        onDone={() => { onClose(); router.push(unitHref(null, residual), { scroll: false }); }}
        message={<>L&apos;unité « {unit.label} » ne porte plus de risque en vigueur : elle sera retirée de la liste et du document unique, et restera consultable avec ses risques archivés via le filtre « Archivés ».</>} />
    );
  }

  return (
    <>
      <div style={{ position: 'relative' }}>
        {error && <div role="alert" className="vg-form-error" style={{ marginBottom: 8 }}>{error}</div>}
        <UnitFields unit={unit} sites={sites} defaultSiteId={unit.siteId ?? sites[0]?.[0] ?? ''} viewSite={viewSite} onCancel={onClose}
          onDone={(_, siteId) => {
            onClose();
            // Unité déplacée vers un autre site : elle quitte la liste affichée, on revient à la première unité.
            if (hiddenFrom(viewSite, siteId)) router.push(unitHref(null, residual), { scroll: false });
          }} />
        {/* Groupe à gauche des boutons du formulaire (Annuler / Enregistrer restent à droite). */}
        <span style={{ position: 'absolute', left: 0, bottom: 0, display: 'flex', gap: 4, alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost" disabled={unit.count > 0 || pending}
            title={unit.count > 0 ? `Unité non vide : ${unit.count} risque${unit.count > 1 ? 's' : ''} en vigueur à archiver ou déplacer d'abord.` : "Retirer l'unité du document unique (motif obligatoire, historique conservé)"}
            style={{ color: unit.count > 0 ? 'var(--color-neutral-600)' : 'var(--color-neutral-400)' }}
            onClick={() => { setError(null); setConfirming(true); }}>
            <i className="ph ph-archive" style={{ fontSize: 14 }} />Archiver
          </button>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Monter" title="Monter dans la liste" disabled={isFirst || pending}
            onClick={() => start(async () => { const r = await moveWorkUnit(unit.id, 'up'); setError(r.error ?? null); })}>
            <i className="ph ph-arrow-up" style={{ fontSize: 14 }} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Descendre" title="Descendre dans la liste" disabled={isLast || pending}
            onClick={() => start(async () => { const r = await moveWorkUnit(unit.id, 'down'); setError(r.error ?? null); })}>
            <i className="ph ph-arrow-down" style={{ fontSize: 14 }} />
          </button>
        </span>
      </div>
      {/* Historique de l'unité (DUE-06), chargé à l'ouverture. */}
      <div style={{ marginTop: 14 }}><LazyChangeLog entity="work_unit" id={unit.id} /></div>
    </>
  );
}

/** Restauration d'une unité archivée (animateur QHSE, direction), depuis le filtre « Archivés » ; ses risques archivés le restent. */
export function RestoreUnitButton({ unit, residual }: { unit: Pick<ArchivedUnitView, 'id' | 'label'>; residual: boolean }) {
  const router = useRouter();
  return (
    <ReasonButton action={restoreWorkUnit} hidden={{ id: unit.id }} label="Restaurer" icon="ph-arrow-counter-clockwise" className="vg-text-btn"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title={unit.label} kicker="Restaurer l'unité de travail"
      submitLabel="Restaurer l'unité" submitIcon="ph-arrow-counter-clockwise"
      message={<>L&apos;unité « {unit.label} » reviendra dans la liste des unités de travail. Ses risques archivés le restent : restaurez-les un par un si besoin.</>}
      onDone={() => router.push(unitHref(unit.id, residual), { scroll: false })} />
  );
}
