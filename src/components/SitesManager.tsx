'use client';

import { useState } from 'react';
import { ActionForm, Checkbox, Field, FormRow, Input, Select } from './form';
import { ReasonButton, ReasonForm } from './ReasonDialog';
import { Dialog } from './Dialog';
import { LazyChangeLog } from './LazyChangeLog';
import { SEVESO_LEVELS } from '@/lib/rules/prevention';
import { openItemsMsgs, openTotal } from '@/lib/rules/site-transfer';
import { archiveSite, restoreSite, saveSite } from '@/server/sites';
import type { Option } from '@/lib/data/options';
import type { SiteAdminRow } from '@/lib/data/sites';
import type { ConnectorRow } from '@/lib/data/connectors';
import { MATRIX_SITE_STATES, SOURCES, SYNC_STATUSES } from '@/lib/integration-labels';
import { processInboundNow, refreshConnectors, sendOutboundNow } from '@/server/connectors';
import type { InboundOverview } from '@/lib/data/inbound';
import type { OutboundOverview } from '@/lib/data/engineering';
import { OUTBOUND_STATUSES, OUTBOUND_TARGETS, type OutboundTarget } from '@/lib/rules/outbound';
import { INBOUND_STATUSES } from '@/lib/rules/inbound';
import { InboundItem } from './InboundRequests';
import { TipButton } from '@/components/Tip';
import { ToneTag } from '@/components/ui';
import { withCurrent } from '@/lib/form-options';
import { useI18n } from '@/i18n/client';
import { labelT } from '@/i18n/labels';
import { msgT } from '@/i18n/msg';
import { fill } from '@/i18n/translate';

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
const fmtTime = (iso: string, lang = 'fr') => new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const sevesoLabel = (v: string | null) => SEVESO_LEVELS.find(([k]) => k === v)?.[1];

/** Choix du site de Matrix à suivre (création, amorçage) : sites actifs de matrix.pub_sites pas encore suivis. */
export function MatrixSiteField({ matrix }: { matrix: MatrixChoices }) {
  const { t } = useI18n();
  if (matrix.message) return <p className="vg-muted" role="status" style={{ fontSize: 12.5, margin: 0 }}>{matrix.message}</p>;
  return (
    <Field name="code" label={t('Matrix site')} hint={t('Common site register (Matrix): label and order come from Matrix; the site identifier is its code.')}>
      <Select name="code" options={matrix.choices} required placeholder={matrix.choices.length ? t('Choose a site') : t('All the sites of Matrix are already followed')} />
    </Field>
  );
}

/** Champ « Responsable QHSE » d'un site (création, modification, amorçage) : vide = poste vacant. */
export function QhseLeadField({ options, current }: { options: readonly Option[]; current?: Pick<SiteAdminRow, 'qhseLeadId' | 'qhseLead'> }) {
  const { t } = useI18n();
  const list = withCurrent(options, current?.qhseLeadId, current?.qhseLead);
  return (
    <Field name="qhseLeadId" label={t('QHSE manager')} hint={t('Receives the alerts of the site; vacant: alerts to the QHSE coordinators.')}>
      <Select name="qhseLeadId" options={[['', t('To be appointed')], ...list]} defaultValue={current?.qhseLeadId ?? ''} />
    </Field>
  );
}

/**
 * Fenêtre « Gérer les sites » (animateur QHSE, direction) : suivi d'un site de Matrix, responsable QHSE, Alsace-Moselle,
 * « ne plus suivre » (archivage avec motif), réactivation ; onglet « Connecteurs » (lectures des autres outils).
 */
export function SitesManager({ sites, leadOptions, matrix, connectors, inbound, outbound, onClose }: SiteAdmin & { onClose: () => void }) {
  const { t } = useI18n();
  const label = labelT(t);
  const [view, setView] = useState<View>('list');
  const back = () => setView('list');
  const active = sites.filter((s) => !s.archivedOn);
  const archived = sites.filter((s) => s.archivedOn);

  const title = view === 'list' ? t('Sites') : view === 'connectors' ? t('Connectors') : 'edit' in view ? (view.edit ? fill(t('Edit “{label}”'), { label: view.edit.label }) : t('Follow a Matrix site'))
    : fill(t('Stop following “{label}”'), { label: view.archive.label });

  return (
    <Dialog open title={title} kicker={t('Administration')} width={560} onClose={onClose}>
      {view === 'list' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 2 }}>
            {active.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px', borderBottom: '1px solid var(--color-divider)' }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  {s.label}
                  <span className="tag tag-outline" style={{ fontSize: 11 }}>{s.id}</span>
                  {s.matrixState && s.matrixState !== 'actif' && <ToneTag tone={MATRIX_SITE_STATES[s.matrixState].tone} style={{ fontSize: 11 }}>{label(MATRIX_SITE_STATES[s.matrixState].label)}</ToneTag>}
                  {sevesoLabel(s.seveso) && <span className="tag tag-outline" style={{ fontSize: 11 }}>{fill(t('Seveso {level}'), { level: label(sevesoLabel(s.seveso)!).toLowerCase() })}</span>}
                  {s.alsaceMoselle && <span className="tag tag-outline" style={{ fontSize: 11 }} title={t('Local law of Alsace-Moselle')}>Alsace-Moselle</span>}
                  <span className="vg-muted" style={{ fontSize: 11, marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    title={t('QHSE manager')}>{s.qhseLead ?? t('QHSE manager to be appointed')}</span>
                </span>
                <button type="button" className="vg-text-btn" onClick={() => setView({ edit: s })}>{t('Edit')}</button>
                <TipButton className="vg-text-btn" disabled={active.length <= 1} tip={active.length <= 1 ? t('At least one site must stay active.') : undefined}
                  onClick={() => setView({ archive: s })}>{t('Stop following')}</TipButton>
              </div>
            ))}
          </div>

          {archived.length > 0 && (
            <div style={{ display: 'grid', gap: 4 }}>
              <div className="vg-eyebrow">{t('Archived#mplural')}</div>
              {archived.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px', borderBottom: '1px solid var(--color-divider)' }}>
                  <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>{s.label}</span>
                    <span className="vg-muted" style={{ fontSize: 11 }}>
                      {fill(t('archived on {date}#m'), { date: fmt(s.archivedOn!) })}{s.archivedBy ? fill(t(' by {name}'), { name: s.archivedBy }) : ''}{s.archiveReason ? ` · ${s.archiveReason}` : ''}
                    </span>
                  </span>
                  <RestoreButton siteId={s.id} />
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span className="vg-muted" style={{ fontSize: 11.5 }}>{t('Labels and order: site register of Matrix. The Seveso classification and the “prevention plan from the first minute” rule are set on the Prevention screen.')}</span>
            <span style={{ display: 'flex', gap: 8, flex: 'none' }}>
              <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setView('connectors')}>
                <i className="ph ph-plugs-connected" style={{ fontSize: 14 }} aria-hidden />{t('Connectors')}
              </button>
              <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setView({ edit: null })}>
                <i className="ph ph-plus" style={{ fontSize: 14 }} aria-hidden />{t('Follow a site')}
              </button>
            </span>
          </div>
        </div>
      )}

      {view === 'connectors' && <Connectors rows={connectors} inbound={inbound} outbound={outbound} onBack={back} />}

      {view !== 'list' && view !== 'connectors' && 'edit' in view && (
        <ActionForm action={saveSite} hidden={{ id: view.edit?.id ?? '', alsaceMoselleField: '1' }} onDone={back} onCancel={back}
          submitLabel={view.edit ? t('Save') : t('Follow the site')}>
          {view.edit ? (
            <FormRow>
              <Field name="labelView" label={t('Label (Matrix)')} hint={t('Read in the site register of Matrix.')}>
                <Input name="labelView" defaultValue={view.edit.label} readOnly data-vg-no-dirty />
              </Field>
              <Field name="codeView" label={t('Code (Matrix)')}>
                <Input name="codeView" defaultValue={view.edit.id} readOnly data-vg-no-dirty />
              </Field>
            </FormRow>
          ) : <MatrixSiteField matrix={matrix} />}
          <QhseLeadField options={leadOptions} current={view.edit ?? undefined} />
          <Field name="alsaceMoselle" label={t('Calendar')} hint={t('Deadline to declare an occupational accident: Good Friday and 26 December are also public holidays there.')}>
            <Checkbox name="alsaceMoselle" label={t('Local law of Alsace-Moselle (Bas-Rhin, Haut-Rhin, Moselle)')} defaultChecked={view.edit?.alsaceMoselle ?? false} />
          </Field>
        </ActionForm>
      )}
      {/* Historique du site (TDB-09) : création, modifications, règle de prévention, SIRET, archivage. */}
      {view !== 'list' && view !== 'connectors' && 'edit' in view && view.edit && (
        <div style={{ marginTop: 12 }}><LazyChangeLog entity="site" id={view.edit.id} /></div>
      )}

      {view !== 'list' && view !== 'connectors' && 'archive' in view && (
        <ReasonForm action={archiveSite} hidden={{ siteId: view.archive.id }} onDone={back} onCancel={back} submitLabel={t('Stop following')} submitIcon="ph-archive"
          before={openTotal(view.archive.openItems) > 0 && (
            // TDB-08 : avertissement avec le décompte et transfert en masse proposé (facultatif).
            <>
              <p role="status" style={{ margin: 0, fontSize: 12.5, color: 'var(--tone-warn-fg)', textWrap: 'pretty' }}>
                {fill(t('This site still holds {items}. Transfer them to another site, or archive without transfer (they stay attached to the archived site).'), { items: openItemsMsgs(view.archive.openItems).map(msgT(t)).join(', ') })}
              </p>
              <Field name="transferTo" label={t('Transfer the open items to')} hint={t('Optional · each transferred item is logged with the reason. Select “All sites” to transfer.')}>
                <Select name="transferTo" options={[['', t('Do not transfer')], ...active.filter((s) => s.id !== view.archive.id).map((s): [string, string] => [s.id, s.label])]} defaultValue="" />
              </Field>
            </>
          )}
          hint={t('The site is archived in Vigie: it disappears from the selectors; its data can still be read under “All sites”. Nothing is changed in Matrix.')} placeholder={t('Site closed, sold, outside the QHSE scope…')} />
      )}
    </Dialog>
  );
}

/** Réactivation d'un site archivé, avec motif (QUA-22). */
function RestoreButton({ siteId }: { siteId: string }) {
  const { t } = useI18n();
  return (
    <div style={{ flex: 'none' }}>
      <ReasonButton action={restoreSite} hidden={{ siteId }} label={t('Reactivate')} icon="ph-arrow-counter-clockwise" title={t('Reactivate the site')} kicker={t('Manage sites')}
        submitLabel={t('Reactivate the site')} message={t('The site is back in the selectors and the forms.')} placeholder={t('E.g. activity resumed on the site')} />
    </div>
  );
}

/** Onglet « Connecteurs » (INT-01) : dernier passage de chaque source lue chez un autre outil ; « Actualiser » relit tout. */
function Connectors({ rows, inbound, outbound, onBack }: { rows: ConnectorRow[]; inbound: InboundOverview; outbound: OutboundOverview; onBack: () => void }) {
  const { t, lang } = useI18n();
  const label = labelT(t);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p className="vg-muted" style={{ fontSize: 12, margin: 0 }}>
        {t('Vigie reads the common registers in the views published by the other tools (read only). Sites and assignments are cached and read again every night; projects and suppliers are read at each entry.')}
      </p>
      <div style={{ display: 'grid', gap: 2 }}>
        {rows.map((r) => {
          const src = SOURCES[r.key];
          const status = r.last ? SYNC_STATUSES[r.last.status] : null;
          return (
            <div key={r.key} style={{ display: 'grid', gap: 2, padding: '7px 4px', borderBottom: '1px solid var(--color-divider)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ fontWeight: 500 }}>{label(src.label)}</span>
                <span className="vg-muted" style={{ fontSize: 11 }}>{src.tool} · {src.view}{src.cache ? ` · ${t('cache')}` : ''}</span>
                <ToneTag tone={status?.tone ?? 'neutral'} style={{ fontSize: 11, marginLeft: 'auto' }}>{status ? label(status.label) : t('Never read')}</ToneTag>
              </span>
              {r.last && (
                <span className="vg-muted" style={{ fontSize: 11 }}>
                  {fill(t('Last run on {at} · {n} row(s) read'), { at: fmtTime(r.last.at, lang), n: r.last.read })}
                  {src.cache ? fill(t(' · {added} added, {updated} updated, {removed} removed'), { added: r.last.added, updated: r.last.updated, removed: r.last.removed }) : ''}
                  {r.last.status !== 'ok' ? fill(t(' · last successful read: {at}'), { at: r.lastOkAt ? fmtTime(r.lastOkAt, lang) : t('never') }) : ''}
                  {r.last.message ? ` · ${r.last.message}` : ''}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <ActionForm action={refreshConnectors} onCancel={onBack} submitLabel={t('Refresh')} submitIcon="ph-arrows-clockwise">{null}</ActionForm>
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
  const { t, lang } = useI18n();
  const label = labelT(t);
  const { counts, rejected, lastReceivedAt } = inbound;
  return (
    <div style={{ display: 'grid', gap: 8, paddingTop: 8, borderTop: '1px solid var(--color-divider)' }}>
      <h6 className="vg-h6">{t('Inbox (Keystone, Codex)')}</h6>
      <p className="vg-muted" style={{ fontSize: 12, margin: 0 }}>
        {t('Keystone reports the progress of its project NCs and of its engineering change orders (vigie.pub_signaler_avancement_nc, vigie.pub_signaler_avancement_eco), Codex creates its change requests (vigie.pub_creer_demande_modification); Vigie processes each request with its own rules, every 10 minutes.')}
        {lastReceivedAt ? fill(t(' Last request received on {at}.'), { at: fmtTime(lastReceivedAt, lang) }) : t(' No request received.')}
      </p>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(Object.keys(INBOUND_STATUSES) as (keyof typeof INBOUND_STATUSES)[]).map((k) => (
          <ToneTag key={k} tone={counts[k] ? INBOUND_STATUSES[k].tone : 'neutral'} style={{ fontSize: 11 }}>{fill(t('{label}: {n}'), { label: label(INBOUND_STATUSES[k].label), n: counts[k] })}</ToneTag>
        ))}
      </span>
      {rejected.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label={t('Refusals to take into account')}>
          {rejected.map((r) => <InboundItem key={r.id} r={r} canAcknowledge showTarget />)}
        </ul>
      )}
      <ActionForm action={processInboundNow} submitLabel={t('Process now')} submitIcon="ph-tray-arrow-down">{null}</ActionForm>
    </div>
  );
}

const fmtTimeOrDash = (iso: string | null, lang = 'fr') => (iso ? fmtTime(iso, lang) : '—');

/**
 * File d'envoi (D12, lot 5 de M-02) : décisions transmises aux autres outils (webhook de Codex), nombres par état,
 * messages à reprendre et refusés ; « Envoyer maintenant » sans attendre la tâche planifiée « Envois aux outils ».
 */
function OutboxBox({ outbound }: { outbound: OutboundOverview }) {
  const { t, lang } = useI18n();
  const label = labelT(t);
  const { counts, failed, pending, lastSentAt } = outbound;
  const line = (m: OutboundOverview['failed'][number]) => (
    <li key={m.id} style={{ display: 'grid', gap: 2, fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid var(--color-divider)' }}>
      <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span>{OUTBOUND_TARGETS[m.target as OutboundTarget]?.label ?? m.target} · {m.entityId}</span>
        <ToneTag tone={OUTBOUND_STATUSES[m.status].tone} style={{ fontSize: 11, marginLeft: 'auto' }}>{label(OUTBOUND_STATUSES[m.status].label)}</ToneTag>
      </span>
      <span style={{ fontSize: 11, color: 'var(--vg-text-muted)' }}>
        {fill(t('Message no. {id} · {n} attempt(s)'), { id: m.id, n: m.attempts })}{m.lastError ? ` · ${m.lastError}` : ''}{m.nextAttemptAt ? fill(t(' · next attempt {at}'), { at: fmtTimeOrDash(m.nextAttemptAt, lang) }) : ''}
      </span>
    </li>
  );
  return (
    <div style={{ display: 'grid', gap: 8, paddingTop: 8, borderTop: '1px solid var(--color-divider)' }}>
      <h6 className="vg-h6">{t('Outbox (Codex)')}</h6>
      <p className="vg-muted" style={{ fontSize: 12, margin: 0 }}>
        {t('The decisions on the change requests of Codex are sent to it by its webhook (POST /api/integrations/vigie), every 10 minutes, with spaced retries. Without VIGIE_CODEX_URL and the token or secret of the webhook, they stay to send.')}
        {lastSentAt ? fill(t(' Last sending on {at}.'), { at: fmtTime(lastSentAt, lang) }) : t(' Nothing sent.')}
      </p>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(Object.keys(OUTBOUND_STATUSES) as (keyof typeof OUTBOUND_STATUSES)[]).map((k) => (
          <ToneTag key={k} tone={counts[k] ? OUTBOUND_STATUSES[k].tone : 'neutral'} style={{ fontSize: 11 }}>{fill(t('{label}: {n}'), { label: label(OUTBOUND_STATUSES[k].label), n: counts[k] })}</ToneTag>
        ))}
      </span>
      {(pending.length > 0 || failed.length > 0) && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label={t('Messages to retry or refused')}>
          {[...failed, ...pending].map(line)}
        </ul>
      )}
      <ActionForm action={sendOutboundNow} submitLabel={t('Send now')} submitIcon="ph-paper-plane-tilt">{null}</ActionForm>
    </div>
  );
}
