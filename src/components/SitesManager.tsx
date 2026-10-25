'use client';

import { useState } from 'react';
import { ActionForm, Checkbox, Field, FormRow, Input, Select, TextArea } from './form';
import { Dialog } from './Dialog';
import { LazyChangeLog } from './LazyChangeLog';
import { SEVESO_LEVELS } from './prevention/model';
import { archiveSite, restoreSite, saveSite } from '@/server/sites';
import type { Option } from '@/lib/data/options';
import type { SiteAdminRow } from '@/lib/data/sites';
import { TipButton } from '@/components/Tip';

export type { SiteAdminRow };

/** Contenu de « Gérer les sites » : sites (archivés compris) et personnes proposées comme responsable QHSE. */
export type SiteAdmin = { sites: SiteAdminRow[]; leadOptions: Option[] };

type View = 'list' | { edit: SiteAdminRow | null } | { archive: SiteAdminRow };

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const sevesoLabel = (v: string | null) => SEVESO_LEVELS.find(([k]) => k === v)?.[1];

/** Champ « Responsable QHSE » d'un site (création, modification, amorçage) : vide = poste vacant. */
export function QhseLeadField({ options, current }: { options: readonly Option[]; current?: Pick<SiteAdminRow, 'qhseLeadId' | 'qhseLead'> }) {
  const list = current?.qhseLeadId && !options.some(([v]) => v === current.qhseLeadId)
    ? [...options, [current.qhseLeadId, current.qhseLead ?? current.qhseLeadId] as const] : options;
  return (
    <Field name="qhseLeadId" label="Responsable QHSE" hint="Destinataire des alertes du site ; vacant : alertes aux animateurs QHSE.">
      <Select name="qhseLeadId" options={[['', 'À désigner'], ...list]} defaultValue={current?.qhseLeadId ?? ''} />
    </Field>
  );
}

/**
 * Fenêtre « Gérer les sites » (animateur QHSE, direction) : création, renommage, ordre, responsable QHSE,
 * archivage avec motif, réactivation.
 */
export function SitesManager({ sites, leadOptions, onClose }: SiteAdmin & { onClose: () => void }) {
  const [view, setView] = useState<View>('list');
  const back = () => setView('list');
  const active = sites.filter((s) => !s.archivedOn);
  const archived = sites.filter((s) => s.archivedOn);

  const title = view === 'list' ? 'Sites' : 'edit' in view ? (view.edit ? `Modifier « ${view.edit.label} »` : 'Nouveau site') : `Archiver « ${view.archive.label} »`;

  return (
    <Dialog open title={title} kicker="Administration" width={560} onClose={onClose}>
      {view === 'list' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 2 }}>
            {active.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px', borderBottom: '1px solid var(--color-divider)' }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  {s.label}
                  <span className="vg-muted" style={{ fontSize: 11 }}>ordre {s.sort}</span>
                  {sevesoLabel(s.seveso) && <span className="tag tag-outline" style={{ fontSize: 11 }}>Seveso {sevesoLabel(s.seveso)!.toLowerCase()}</span>}
                  {s.alsaceMoselle && <span className="tag tag-outline" style={{ fontSize: 11 }} title="Droit local d'Alsace-Moselle">Alsace-Moselle</span>}
                  <span className="vg-muted" style={{ fontSize: 11, marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    title="Responsable QHSE">{s.qhseLead ?? 'Responsable QHSE à désigner'}</span>
                </span>
                <button type="button" className="vg-text-btn" onClick={() => setView({ edit: s })}>Modifier</button>
                <TipButton className="vg-text-btn" disabled={active.length <= 1} tip={active.length <= 1 ? 'Au moins un site doit rester actif.' : undefined}
                  onClick={() => setView({ archive: s })}>Archiver</TipButton>
              </div>
            ))}
          </div>

          {archived.length > 0 && (
            <div style={{ display: 'grid', gap: 4 }}>
              <div className="vg-eyebrow">Archivés</div>
              {archived.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px', borderBottom: '1px solid var(--color-divider)' }}>
                  <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>{s.label}</span>
                    <span className="vg-muted" style={{ fontSize: 11 }}>
                      archivé le {fmt(s.archivedOn!)}{s.archivedBy ? ` par ${s.archivedBy}` : ''}{s.archiveReason ? ` · ${s.archiveReason}` : ''}
                    </span>
                  </span>
                  <RestoreButton siteId={s.id} />
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span className="vg-muted" style={{ fontSize: 11.5 }}>Le classement Seveso et la règle « plan de prévention dès la première minute » se règlent sur l&apos;écran Prévention.</span>
            <button type="button" className="btn btn-secondary vg-btn-sm" style={{ flex: 'none' }} onClick={() => setView({ edit: null })}>
              <i className="ph ph-plus" style={{ fontSize: 14 }} aria-hidden />Nouveau site
            </button>
          </div>
        </div>
      )}

      {view !== 'list' && 'edit' in view && (
        <ActionForm action={saveSite} hidden={{ id: view.edit?.id ?? '', alsaceMoselleField: '1' }} onDone={back} onCancel={back} submitLabel={view.edit ? 'Enregistrer' : 'Créer le site'}>
          <FormRow>
            <Field name="label" label="Libellé">
              <Input name="label" defaultValue={view.edit?.label} maxLength={120} required autoFocus />
            </Field>
            <Field name="sort" label="Ordre d'affichage" hint={view.edit ? undefined : 'Vide : en fin de liste.'}>
              <Input name="sort" type="number" min={0} max={9999} step={1} defaultValue={view.edit?.sort} />
            </Field>
          </FormRow>
          <QhseLeadField options={leadOptions} current={view.edit ?? undefined} />
          <Field name="alsaceMoselle" label="Calendrier" hint="Délai de déclaration d'un accident du travail : le Vendredi saint et le 26 décembre y sont aussi fériés.">
            <Checkbox name="alsaceMoselle" label="Droit local d'Alsace-Moselle (Bas-Rhin, Haut-Rhin, Moselle)" defaultChecked={view.edit?.alsaceMoselle ?? false} />
          </Field>
        </ActionForm>
      )}
      {/* Historique du site (TDB-09) : création, modifications, règle de prévention, SIRET, archivage. */}
      {view !== 'list' && 'edit' in view && view.edit && (
        <div style={{ marginTop: 12 }}><LazyChangeLog entity="site" id={view.edit.id} /></div>
      )}

      {view !== 'list' && 'archive' in view && (
        <ActionForm action={archiveSite} hidden={{ siteId: view.archive.id }} onDone={back} onCancel={back} submitLabel="Archiver le site" submitIcon="ph-archive">
          <Field name="reason" label="Motif" hint="Le site disparaît des sélecteurs ; ses données restent consultables sous « Tous les sites ».">
            <TextArea name="reason" rows={3} maxLength={500} required autoFocus placeholder="Site fermé, cédé, regroupé…" />
          </Field>
        </ActionForm>
      )}
    </Dialog>
  );
}

/** Réactivation d'un site archivé : formulaire réduit à son bouton. */
function RestoreButton({ siteId }: { siteId: string }) {
  return (
    <div style={{ flex: 'none', marginTop: -8 }}>
      <ActionForm action={restoreSite} hidden={{ siteId }} submitLabel="Réactiver">{null}</ActionForm>
    </div>
  );
}
