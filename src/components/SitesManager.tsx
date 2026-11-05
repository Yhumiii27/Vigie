'use client';

import { useState } from 'react';
import { ActionForm, Checkbox, Field, FormRow, Input, Select } from './form';
import { ReasonButton, ReasonForm } from './ReasonDialog';
import { Dialog } from './Dialog';
import { LazyChangeLog } from './LazyChangeLog';
import { SEVESO_LEVELS } from '@/lib/rules/prevention';
import { archiveSite, restoreSite, saveSite } from '@/server/sites';
import type { Option } from '@/lib/data/options';
import type { SiteAdminRow } from '@/lib/data/sites';
import type { ConnectorRow } from '@/lib/data/connectors';
import { MATRIX_SITE_STATES, SOURCES, SYNC_STATUSES } from '@/lib/foreign/labels';
import { processInboundNow, refreshConnectors, sendOutboundNow } from '@/server/connectors';
import type { InboundOverview } from '@/lib/data/inbound';
import type { OutboundOverview } from '@/lib/data/engineering';
import { OUTBOUND_STATUSES, OUTBOUND_TARGETS, type OutboundTarget } from '@/lib/rules/outbound';
import { INBOUND_STATUSES } from '@/lib/rules/inbound';
import { InboundItem } from './InboundRequests';
import { TipButton } from '@/components/Tip';
import { ToneTag } from '@/components/ui';
import { withCurrent } from '@/lib/form-options';

export type { SiteAdminRow };

/** Sites de Matrix proposés au suivi (actifs, pas encore suivis) ; `message` : source indisponible. */
export type MatrixChoices = { choices: Option[]; message: string | null };

/**
 * Contenu de « Gérer les sites » : sites suivis (archivés compris), personnes proposées comme responsable QHSE, sites de
 * Matrix proposés au suivi et état des connecteurs (lectures des autres outils, lot 0 de M-02).
 */
export type SiteAdmin = { sites: SiteAdminRow[]; leadOptions: Option[]; matrix: MatrixChoices; connectors: ConnectorRow[]; inbound: InboundOverview; outbound: OutboundOverview };

type View = 'list' | 'connectors' | { edit: SiteAdminRow | null } | { archive: SiteAdminRow };

const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fmtTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const sevesoLabel = (v: string | null) => SEVESO_LEVELS.find(([k]) => k === v)?.[1];

/** Choix du site de Matrix à suivre (création, amorçage) : sites actifs de matrix.pub_sites pas encore suivis. */
export function MatrixSiteField({ matrix }: { matrix: MatrixChoices }) {
  if (matrix.message) return <p className="vg-muted" role="status" style={{ fontSize: 12.5, margin: 0 }}>{matrix.message}</p>;
  return (
    <Field name="code" label="Site de Matrix" hint="Référentiel commun des sites (Matrix) : libellé et ordre viennent de Matrix ; l’identifiant du site est son code.">
      <Select name="code" options={matrix.choices} required placeholder={matrix.choices.length ? 'Choisir un site' : 'Tous les sites de Matrix sont déjà suivis'} />
    </Field>
  );
}

/** Champ « Responsable QHSE » d'un site (création, modification, amorçage) : vide = poste vacant. */
export function QhseLeadField({ options, current }: { options: readonly Option[]; current?: Pick<SiteAdminRow, 'qhseLeadId' | 'qhseLead'> }) {
  const list = withCurrent(options, current?.qhseLeadId, current?.qhseLead);
  return (
    <Field name="qhseLeadId" label="Responsable QHSE" hint="Destinataire des alertes du site ; vacant : alertes aux animateurs QHSE.">
      <Select name="qhseLeadId" options={[['', 'À désigner'], ...list]} defaultValue={current?.qhseLeadId ?? ''} />
    </Field>
  );
}

/**
 * Fenêtre « Gérer les sites » (animateur QHSE, direction) : suivi d'un site de Matrix, responsable QHSE, Alsace-Moselle,
 * « ne plus suivre » (archivage avec motif), réactivation ; onglet « Connecteurs » (lectures des autres outils).
 */
export function SitesManager({ sites, leadOptions, matrix, connectors, inbound, outbound, onClose }: SiteAdmin & { onClose: () => void }) {
  const [view, setView] = useState<View>('list');
  const back = () => setView('list');
  const active = sites.filter((s) => !s.archivedOn);
  const archived = sites.filter((s) => s.archivedOn);

  const title = view === 'list' ? 'Sites' : view === 'connectors' ? 'Connecteurs' : 'edit' in view ? (view.edit ? `Modifier « ${view.edit.label} »` : 'Suivre un site de Matrix')
    : `Ne plus suivre « ${view.archive.label} »`;

  return (
    <Dialog open title={title} kicker="Administration" width={560} onClose={onClose}>
      {view === 'list' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 2 }}>
            {active.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px', borderBottom: '1px solid var(--color-divider)' }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  {s.label}
                  <span className="tag tag-outline" style={{ fontSize: 11 }}>{s.id}</span>
                  {s.matrixState && s.matrixState !== 'actif' && <ToneTag tone={MATRIX_SITE_STATES[s.matrixState].tone} style={{ fontSize: 11 }}>{MATRIX_SITE_STATES[s.matrixState].label}</ToneTag>}
                  {sevesoLabel(s.seveso) && <span className="tag tag-outline" style={{ fontSize: 11 }}>Seveso {sevesoLabel(s.seveso)!.toLowerCase()}</span>}
                  {s.alsaceMoselle && <span className="tag tag-outline" style={{ fontSize: 11 }} title="Droit local d'Alsace-Moselle">Alsace-Moselle</span>}
                  <span className="vg-muted" style={{ fontSize: 11, marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    title="Responsable QHSE">{s.qhseLead ?? 'Responsable QHSE à désigner'}</span>
                </span>
                <button type="button" className="vg-text-btn" onClick={() => setView({ edit: s })}>Modifier</button>
                <TipButton className="vg-text-btn" disabled={active.length <= 1} tip={active.length <= 1 ? 'Au moins un site doit rester actif.' : undefined}
                  onClick={() => setView({ archive: s })}>Ne plus suivre</TipButton>
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
            <span className="vg-muted" style={{ fontSize: 11.5 }}>Libellés et ordre : référentiel des sites de Matrix. Le classement Seveso et la règle « plan de prévention dès la première minute » se règlent sur l&apos;écran Prévention.</span>
            <span style={{ display: 'flex', gap: 8, flex: 'none' }}>
              <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setView('connectors')}>
                <i className="ph ph-plugs-connected" style={{ fontSize: 14 }} aria-hidden />Connecteurs
              </button>
              <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setView({ edit: null })}>
                <i className="ph ph-plus" style={{ fontSize: 14 }} aria-hidden />Suivre un site
              </button>
            </span>
          </div>
        </div>
      )}

      {view === 'connectors' && <Connectors rows={connectors} inbound={inbound} outbound={outbound} onBack={back} />}

      {view !== 'list' && view !== 'connectors' && 'edit' in view && (
        <ActionForm action={saveSite} hidden={{ id: view.edit?.id ?? '', alsaceMoselleField: '1' }} onDone={back} onCancel={back}
          submitLabel={view.edit ? 'Enregistrer' : 'Suivre le site'}>
          {view.edit ? (
            <FormRow>
              <Field name="labelView" label="Libellé (Matrix)" hint="Lu dans le référentiel des sites de Matrix.">
                <Input name="labelView" defaultValue={view.edit.label} readOnly data-vg-no-dirty />
              </Field>
              <Field name="codeView" label="Code (Matrix)">
                <Input name="codeView" defaultValue={view.edit.id} readOnly data-vg-no-dirty />
              </Field>
            </FormRow>
          ) : <MatrixSiteField matrix={matrix} />}
          <QhseLeadField options={leadOptions} current={view.edit ?? undefined} />
          <Field name="alsaceMoselle" label="Calendrier" hint="Délai de déclaration d'un accident du travail : le Vendredi saint et le 26 décembre y sont aussi fériés.">
            <Checkbox name="alsaceMoselle" label="Droit local d'Alsace-Moselle (Bas-Rhin, Haut-Rhin, Moselle)" defaultChecked={view.edit?.alsaceMoselle ?? false} />
          </Field>
        </ActionForm>
      )}
      {/* Historique du site (TDB-09) : création, modifications, règle de prévention, SIRET, archivage. */}
      {view !== 'list' && view !== 'connectors' && 'edit' in view && view.edit && (
        <div style={{ marginTop: 12 }}><LazyChangeLog entity="site" id={view.edit.id} /></div>
      )}

      {view !== 'list' && view !== 'connectors' && 'archive' in view && (
        <ReasonForm action={archiveSite} hidden={{ siteId: view.archive.id }} onDone={back} onCancel={back} submitLabel="Ne plus suivre" submitIcon="ph-archive"
          hint="Le site est archivé dans Vigie : il disparaît des sélecteurs ; ses données restent consultables sous « Tous les sites ». Rien n’est changé dans Matrix." placeholder="Site fermé, cédé, hors du périmètre QHSE…" />
      )}
    </Dialog>
  );
}

/** Réactivation d'un site archivé, avec motif (QUA-22). */
function RestoreButton({ siteId }: { siteId: string }) {
  return (
    <div style={{ flex: 'none' }}>
      <ReasonButton action={restoreSite} hidden={{ siteId }} label="Réactiver" icon="ph-arrow-counter-clockwise" title="Réactiver le site" kicker="Gérer les sites"
        submitLabel="Réactiver le site" message="Le site revient dans les sélecteurs et les formulaires." placeholder="Ex. reprise d'activité sur le site" />
    </div>
  );
}

/** Onglet « Connecteurs » (INT-01) : dernier passage de chaque source lue chez un autre outil ; « Actualiser » relit tout. */
function Connectors({ rows, inbound, outbound, onBack }: { rows: ConnectorRow[]; inbound: InboundOverview; outbound: OutboundOverview; onBack: () => void }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p className="vg-muted" style={{ fontSize: 12, margin: 0 }}>
        Vigie lit les référentiels communs dans les vues publiées par les autres outils (lecture seule). Les sites et les affectations sont
        gardés en cache et relus chaque nuit ; les projets et les fournisseurs sont lus à chaque saisie.
      </p>
      <div style={{ display: 'grid', gap: 2 }}>
        {rows.map((r) => {
          const src = SOURCES[r.key];
          const status = r.last ? SYNC_STATUSES[r.last.status] : null;
          return (
            <div key={r.key} style={{ display: 'grid', gap: 2, padding: '7px 4px', borderBottom: '1px solid var(--color-divider)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ fontWeight: 500 }}>{src.label}</span>
                <span className="vg-muted" style={{ fontSize: 11 }}>{src.tool} · {src.view}{src.cache ? ' · cache' : ''}</span>
                <ToneTag tone={status?.tone ?? 'neutral'} style={{ fontSize: 11, marginLeft: 'auto' }}>{status?.label ?? 'Jamais lu'}</ToneTag>
              </span>
              {r.last && (
                <span className="vg-muted" style={{ fontSize: 11 }}>
                  Dernier passage le {fmtTime(r.last.at)} · {r.last.read} ligne(s) lue(s)
                  {src.cache ? ` · ${r.last.added} ajoutée(s), ${r.last.updated} mise(s) à jour, ${r.last.removed} retirée(s)` : ''}
                  {r.last.status !== 'ok' ? ` · dernière lecture réussie : ${r.lastOkAt ? fmtTime(r.lastOkAt) : 'jamais'}` : ''}
                  {r.last.message ? ` · ${r.last.message}` : ''}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <ActionForm action={refreshConnectors} onCancel={onBack} submitLabel="Actualiser" submitIcon="ph-arrows-clockwise">{null}</ActionForm>
      <InboundBox inbound={inbound} />
      <OutboxBox outbound={outbound} />
    </div>
  );
}

/**
 * Boîte de réception Keystone (D13, décision CV-08) : demandes déposées par vigie.pub_signaler_avancement_nc, nombres par
 * état, refus à prendre en compte ; « Traiter maintenant » sans attendre la tâche planifiée « Demandes reçues ».
 */
function InboundBox({ inbound }: { inbound: InboundOverview }) {
  const { counts, rejected, lastReceivedAt } = inbound;
  return (
    <div style={{ display: 'grid', gap: 8, paddingTop: 8, borderTop: '1px solid var(--color-divider)' }}>
      <h6 className="vg-h6">Boîte de réception (Keystone, Codex)</h6>
      <p className="vg-muted" style={{ fontSize: 12, margin: 0 }}>
        Keystone signale l’avancement de ses NC de projet et de ses ordres de modification (vigie.pub_signaler_avancement_nc,
        vigie.pub_signaler_avancement_eco), Codex crée ses demandes de modification (vigie.pub_creer_demande_modification) ; Vigie traite chaque demande
        avec ses propres règles, toutes les 10 minutes.{lastReceivedAt ? ` Dernière demande reçue le ${fmtTime(lastReceivedAt)}.` : ' Aucune demande reçue.'}
      </p>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(Object.keys(INBOUND_STATUSES) as (keyof typeof INBOUND_STATUSES)[]).map((k) => (
          <ToneTag key={k} tone={counts[k] ? INBOUND_STATUSES[k].tone : 'neutral'} style={{ fontSize: 11 }}>{INBOUND_STATUSES[k].label} : {counts[k]}</ToneTag>
        ))}
      </span>
      {rejected.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Refus à prendre en compte">
          {rejected.map((r) => <InboundItem key={r.id} r={r} canAcknowledge showTarget />)}
        </ul>
      )}
      <ActionForm action={processInboundNow} submitLabel="Traiter maintenant" submitIcon="ph-tray-arrow-down">{null}</ActionForm>
    </div>
  );
}

const fmtTimeOrDash = (iso: string | null) => (iso ? fmtTime(iso) : '—');

/**
 * File d'envoi (D12, lot 5 de M-02) : décisions transmises aux autres outils (webhook de Codex), nombres par état,
 * messages à reprendre et refusés ; « Envoyer maintenant » sans attendre la tâche planifiée « Envois aux outils ».
 */
function OutboxBox({ outbound }: { outbound: OutboundOverview }) {
  const { counts, failed, pending, lastSentAt } = outbound;
  const line = (m: OutboundOverview['failed'][number]) => (
    <li key={m.id} style={{ display: 'grid', gap: 2, fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid var(--color-divider)' }}>
      <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span>{OUTBOUND_TARGETS[m.target as OutboundTarget]?.label ?? m.target} · {m.entityId}</span>
        <ToneTag tone={OUTBOUND_STATUSES[m.status].tone} style={{ fontSize: 11, marginLeft: 'auto' }}>{OUTBOUND_STATUSES[m.status].label}</ToneTag>
      </span>
      <span style={{ fontSize: 11, color: 'var(--vg-text-muted)' }}>
        Message n° {m.id} · {m.attempts} tentative(s){m.lastError ? ` · ${m.lastError}` : ''}{m.nextAttemptAt ? ` · prochain essai ${fmtTimeOrDash(m.nextAttemptAt)}` : ''}
      </span>
    </li>
  );
  return (
    <div style={{ display: 'grid', gap: 8, paddingTop: 8, borderTop: '1px solid var(--color-divider)' }}>
      <h6 className="vg-h6">File d’envoi (Codex)</h6>
      <p className="vg-muted" style={{ fontSize: 12, margin: 0 }}>
        Les décisions sur les demandes de modification de Codex lui sont envoyées par son webhook (POST /api/integrations/vigie), toutes les
        10 minutes, avec reprises espacées. Sans VIGIE_CODEX_URL et jeton ou secret du webhook, elles restent à envoyer.
        {lastSentAt ? ` Dernier envoi le ${fmtTime(lastSentAt)}.` : ' Aucun envoi.'}
      </p>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(Object.keys(OUTBOUND_STATUSES) as (keyof typeof OUTBOUND_STATUSES)[]).map((k) => (
          <ToneTag key={k} tone={counts[k] ? OUTBOUND_STATUSES[k].tone : 'neutral'} style={{ fontSize: 11 }}>{OUTBOUND_STATUSES[k].label} : {counts[k]}</ToneTag>
        ))}
      </span>
      {(pending.length > 0 || failed.length > 0) && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Messages à reprendre ou refusés">
          {[...failed, ...pending].map(line)}
        </ul>
      )}
      <ActionForm action={sendOutboundNow} submitLabel="Envoyer maintenant" submitIcon="ph-paper-plane-tilt">{null}</ActionForm>
    </div>
  );
}
