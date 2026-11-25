'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DialogButton } from '@/components/Dialog';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { ActionForm, Checkbox, Field, Input, Select } from '@/components/form';
import { ReasonButton, ReasonForm } from '@/components/ReasonDialog';
import { TONE } from '@/lib/domain';
import type { Option } from '@/lib/data/options';
import type { ArchivedUnitView, WorkUnitView, ZoneOption } from '@/lib/data/risks';
import type { FormState } from '@/lib/forms';
import { ARCHIVED_SITE_SUFFIX, withCurrent } from '@/lib/form-options';
import { archiveWorkUnit, moveWorkUnit, restoreWorkUnit, saveWorkUnit } from '@/server/risks';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

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

function UnitFields({ unit, sites, zones = [], unitLabels = {}, defaultSiteId, viewSite, onDone, onCancel }: {
  unit?: Pick<WorkUnitView, 'id' | 'label' | 'siteId' | 'version'>;
  sites: readonly Option[];
  /** DUE-20 : zones en service du plan de site (avec l'unité qui les couvre) ; libellés des unités. */
  zones?: readonly ZoneOption[];
  unitLabels?: Record<string, string>;
  defaultSiteId: string;
  viewSite: ViewSite;
  /** `siteId` : site enregistré pour l'unité. */
  onDone: (state: FormState, siteId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [siteId, setSiteId] = useState(unit?.siteId ?? defaultSiteId);
  const siteLabel = sites.find(([id]) => id === siteId)?.[1] ?? siteId;
  const hint = viewSite && hiddenFrom(viewSite, siteId)
    ? <span style={{ color: TONE.warn.fg }}>{fill(t('The unit will not appear in the list of “{view}”: it will be visible on “{site}” and in “All sites”.'), { view: viewSite.label, site: siteLabel })}</span>
    : t('The unit appears on this site and in “All sites”.');
  const siteZones = zones.filter((z) => z.siteId === siteId);
  return (
    <ActionForm action={saveWorkUnit} onDone={(state) => onDone(state, siteId)} onCancel={onCancel} submitLabel={unit ? t('Save') : t('Add the unit')} hidden={{ id: unit?.id, version: unit?.version, zonesField: '1' }}>
      <Field name="label" label={t('Label')} hint={t('Station, workshop, zone or activity grouping employees exposed to the same risks.')}>
        <Input name="label" defaultValue={unit?.label} maxLength={80} autoFocus placeholder={t('E.g. Paint workshop')} />
      </Field>
      <Field name="siteId" label={t('Site')} hint={hint}>
        <Select name="siteId" options={sites} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
      </Field>
      {/* DUE-20 : zones du plan de site couvertes par l'unité ; leurs risques sont proposés au signalement par QR code. */}
      <Field name="zoneIds" group label={t('Zones of the site plan')}
        hint={siteZones.length ? t('A zone belongs to only one unit: ticking it removes it from the unit that covered it. The unit’s risks are proposed when reporting through the station QR code.') : t('No zone in service on this site’s plan (Prevention › Site map).')}>
        {siteZones.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            {siteZones.map((z) => (
              <Checkbox key={z.id} name="zoneIds" value={String(z.id)} defaultChecked={!!unit && z.unitId === unit.id}
                label={z.unitId && z.unitId !== unit?.id ? `${z.name} (${unitLabels[z.unitId] ?? t('other unit')})` : z.name} />
            ))}
          </div>
        )}
      </Field>
    </ActionForm>
  );
}

/** Petit bouton sous la liste des unités : ajoute une unité de travail puis l'affiche (si elle relève du site affiché). */
export function AddUnitButton({ sites, zones, unitLabels, defaultSiteId, viewSite, residual }: { sites: readonly Option[]; zones?: readonly ZoneOption[]; unitLabels?: Record<string, string>; defaultSiteId: string; viewSite: ViewSite; residual: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <DialogButton label={t('Add a work unit')} icon="ph-plus" className="btn btn-ghost" style={{ fontSize: 12, justifySelf: 'start', marginTop: 4 }}
      title={t('Add a work unit')} kicker={t('Single document')} width={480}>
      {(close) => (
        <UnitFields sites={sites} zones={zones} unitLabels={unitLabels} defaultSiteId={defaultSiteId} viewSite={viewSite} onCancel={close}
          onDone={(s, siteId) => { close(); if (s.id && !hiddenFrom(viewSite, siteId)) router.push(unitHref(s.id, residual), { scroll: false }); }} />
      )}
    </DialogButton>
  );
}

type Position = { isFirst: boolean; isLast: boolean };

/** Crayon à côté du nom de l'unité : renomme l'unité, change son site, la déplace dans la liste ou l'archive si elle n'a plus de risque en vigueur. */
export function EditUnitButton({ unit, sites, zones, unitLabels, viewSite, residual, isFirst, isLast }: { unit: Pick<WorkUnitView, 'id' | 'label' | 'siteId' | 'site' | 'count' | 'version'>; sites: readonly Option[]; zones?: readonly ZoneOption[]; unitLabels?: Record<string, string>; viewSite: ViewSite; residual: boolean } & Position) {
  const { t } = useI18n();
  return (
    <DialogButton label="" icon="ph-pencil-simple" className="btn btn-ghost btn-icon" tooltip={t('Edit the work unit')}
      style={{ width: 22, height: 22, color: 'var(--color-neutral-500)' }} title={unit.label} kicker={t('Edit the work unit')} width={480}>
      {(close) => <UnitEditor unit={unit} sites={sites} zones={zones} unitLabels={unitLabels} viewSite={viewSite} residual={residual} isFirst={isFirst} isLast={isLast} onClose={close} />}
    </DialogButton>
  );
}

function UnitEditor({ unit, sites: activeSites, zones, unitLabels, viewSite, residual, isFirst, isLast, onClose }: {
  unit: Pick<WorkUnitView, 'id' | 'label' | 'siteId' | 'site' | 'count' | 'version'>;
  sites: readonly Option[];
  zones?: readonly ZoneOption[];
  unitLabels?: Record<string, string>;
  viewSite: ViewSite;
  residual: boolean;
  onClose: () => void;
} & Position) {
  const { t } = useI18n();
  const router = useRouter();
  // DUE-05 : le site archivé d'une unité reste son choix (jamais remplacé en silence par le premier site actif).
  const sites = withCurrent(activeSites, unit.siteId, `${unit.site}${ARCHIVED_SITE_SUFFIX}`);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (confirming) {
    return (
      <ReasonForm action={archiveWorkUnit} hidden={{ id: unit.id }} submitLabel={t('Archive the unit')} submitIcon="ph-archive"
        placeholder={t('E.g. workshop closed, activity grouped with another unit…')} onCancel={() => setConfirming(false)}
        onDone={() => { onClose(); router.push(unitHref(null, residual), { scroll: false }); }}
        message={<>{fill(t('The unit “{unit}” no longer carries a risk in force: it will be removed from the list and the single document, and will stay readable with its archived risks through the “Archived” filter.'), { unit: unit.label })}</>} />
    );
  }

  return (
    <>
      <div style={{ position: 'relative' }}>
        {error && <div role="alert" className="vg-form-error" style={{ marginBottom: 8 }}>{error}</div>}
        <UnitFields unit={unit} sites={sites} zones={zones} unitLabels={unitLabels} defaultSiteId={unit.siteId ?? sites[0]?.[0] ?? ''} viewSite={viewSite} onCancel={onClose}
          onDone={(_, siteId) => {
            onClose();
            // Unité déplacée vers un autre site : elle quitte la liste affichée, on revient à la première unité.
            if (hiddenFrom(viewSite, siteId)) router.push(unitHref(null, residual), { scroll: false });
          }} />
        {/* Groupe à gauche des boutons du formulaire (Annuler / Enregistrer restent à droite). */}
        <span style={{ position: 'absolute', left: 0, bottom: 0, display: 'flex', gap: 4, alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost" disabled={unit.count > 0 || pending}
            title={unit.count > 0 ? fill(unit.count > 1 ? t('Unit not empty: {n} risks in force to archive or move first.') : t('Unit not empty: {n} risk in force to archive or move first.'), { n: unit.count }) : t('Remove the unit from the single document (reason required, history kept)')}
            style={{ color: unit.count > 0 ? 'var(--vg-text-muted)' : 'var(--color-neutral-400)' }}
            onClick={() => { setError(null); setConfirming(true); }}>
            <i className="ph ph-archive" style={{ fontSize: 14 }} aria-hidden />{t('Archive')}
          </button>
          <button type="button" className="btn btn-ghost btn-icon" aria-label={t('Move up')} title={t('Move up in the list')} disabled={isFirst || pending}
            onClick={() => start(async () => { const r = await moveWorkUnit(unit.id, 'up'); setError(r.error ?? null); })}>
            <i className="ph ph-arrow-up" style={{ fontSize: 14 }} aria-hidden />
          </button>
          <button type="button" className="btn btn-ghost btn-icon" aria-label={t('Move down')} title={t('Move down in the list')} disabled={isLast || pending}
            onClick={() => start(async () => { const r = await moveWorkUnit(unit.id, 'down'); setError(r.error ?? null); })}>
            <i className="ph ph-arrow-down" style={{ fontSize: 14 }} aria-hidden />
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
  const { t } = useI18n();
  const router = useRouter();
  return (
    <ReasonButton action={restoreWorkUnit} hidden={{ id: unit.id }} label={t('Restore')} icon="ph-arrow-counter-clockwise" className="vg-text-btn"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title={unit.label} kicker={t('Restore the work unit')}
      submitLabel={t('Restore the unit')} submitIcon="ph-arrow-counter-clockwise"
      message={<>{fill(t('The unit “{unit}” will return to the list of work units. Its archived risks stay archived: restore them one by one if needed.'), { unit: unit.label })}</>}
      onDone={() => router.push(unitHref(unit.id, residual), { scroll: false })} />
  );
}
