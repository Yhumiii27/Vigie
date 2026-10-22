'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { ActionFields } from '@/components/ActionFormDialog';
import { EntityFiles } from '@/components/EntityFiles';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { LinkedEvents } from '@/components/LinkedEvents';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { LinkActionButton } from '@/components/LinkActionButton';
import { ReasonButton } from '@/components/ReasonDialog';
import { Icon, ToneTag } from '@/components/ui';
import { QHSE_ONLY_CREATE_MESSAGE, actionHref } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { addMonths, fmtDate } from '@/lib/dates';
import { CONTROL_RESULTS, CONTROL_RESULT_KEYS, TONE } from '@/lib/domain';
import type { FormOptions, Option } from '@/lib/data/options';
import { ARCHIVED_SITE_SUFFIX, LEFT_SUFFIX, withCurrent } from '@/lib/form-options';
import type { ControlFilter, ControlView } from '@/lib/data/watch';
import {
  archiveControl, cancelControlRecord, recordControl, restoreControl, saveControl, type CancelRecordState,
} from '@/server/watch';
import { controlOverdueDefaults, controlReserveDefaults } from './action-defaults';
import { ArchivedBanner, Facts, FileError, Notice, ViewSwitch, checkPickedFiles, muted, rowOpener } from './parts';

type Opts = Pick<FormOptions, 'people' | 'sites'>;
/**
 * Plan d'actions (ACT-22) : `actionOptions` (formulaire d'action) et `linkActions` (actions ouvertes à rattacher) ne sont
 * fournis qu'au service QHSE, seul à créer une action et à modifier ses rattachements.
 */
type ActionProps = { actionOptions?: ActionFormOptions | null; linkActions?: readonly Option[] };
export type ControlSuggestions = { types: string[]; organizations: string[] };
type View = 'fiche' | 'historique' | 'realise';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Périodicité après « tous les » : « tous les mois » plutôt que « tous les 1 mois ». */
const months = (n: number) => (n === 1 ? 'mois' : `${n} mois`);

/** Prochain contrôle = dernier + périodicité (vide tant que la saisie est incomplète). */
function nextFrom(lastOn: string, period: string) {
  const n = Number(period);
  return ISO.test(lastOn) && Number.isInteger(n) && n >= 1 && n <= 120 ? addMonths(lastOn, n) : '';
}

// ─── Tableau des contrôles ──────────────────────────────────────────────────

export function ControlsPanel({ rows, filter, canManage, canApprove, options, actionOptions, linkActions, requirementOptions, today, showSite, suggestions, initialId, closeHref }: ActionProps & {
  /** Contrôles du site, archivés compris (filtre « Archivés ») : la fiche ouverte reste affichée après son archivage. */
  rows: ControlView[];
  filter?: ControlFilter;
  canManage: boolean;
  /** Animateur QHSE, direction : annulation d'un enregistrement, restauration d'un contrôle archivé. */
  canApprove: boolean;
  options: Opts;
  /** Exigences en vigueur, pour rattacher le contrôle à son exigence réglementaire. */
  requirementOptions: readonly Option[];
  today: string;
  /** « Tous les sites » : rappelle le site de chaque équipement. */
  showSite: boolean;
  suggestions: ControlSuggestions;
  /** Contrôle à ouvrir d'emblée (lien profond `?controle=<id>`). */
  initialId?: number;
  /** URL sans le lien profond, rétablie à la fermeture. */
  closeHref?: string;
}) {
  const router = useRouter();
  const firstView = (c?: ControlView): View => (canManage && c && !c.archived ? 'fiche' : 'historique');
  const [sel, setSel] = useState<{ id: number; view: View } | null>(initialId ? { id: initialId, view: firstView(rows.find((c) => c.id === initialId)) } : null);
  const control = sel ? rows.find((c) => c.id === sel.id) ?? null : null;
  // « Tous » : contrôles en service ; les équipements réformés ne s'affichent qu'avec le filtre « Archivés ».
  const shown = filter ? rows.filter((c) => c.filter === filter) : rows.filter((c) => !c.archived);
  const open = (id: number, view: View) => setSel({ id, view });
  const close = () => {
    setSel(null);
    if (closeHref) router.replace(closeHref, { scroll: false });
  };

  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 960 }}>
          <thead>
            <tr>
              <th>Équipement</th><th>Contrôle</th><th>Périodicité</th><th>Organisme</th><th>Dernier</th><th>Prochain</th><th>Statut</th><th>Réserves</th>
              {canManage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={canManage ? 9 : 8} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
                {filter === 'archives' ? 'Aucun contrôle archivé.' : rows.some((c) => !c.archived) ? 'Aucun contrôle dans cette catégorie.' : showSite ? 'Aucun contrôle périodique suivi.' : 'Aucun contrôle périodique suivi sur ce site.'}
              </td></tr>
            )}
            {shown.map((c) => (
              <tr key={c.id} {...rowOpener(() => open(c.id, firstView(c)))} style={c.archived ? { opacity: 0.75 } : undefined}>
                <td style={{ fontWeight: 500, minWidth: 180 }}>
                  {c.equipment}
                  {(showSite || c.responsible) && (
                    <div style={{ ...muted, fontWeight: 400, marginTop: 2 }}>{[showSite && c.siteLabel, c.responsible].filter(Boolean).join(' · ')}</div>
                  )}
                  {c.archivedLabel && <div style={{ ...muted, fontWeight: 400, marginTop: 2 }}>{c.archivedLabel}</div>}
                </td>
                <td style={{ color: 'var(--color-neutral-300)' }}>{c.controlType}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{c.period}</td>
                <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{c.organization}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--color-neutral-400)' }}>{c.last}</td>
                <td style={{ whiteSpace: 'nowrap', color: c.tone === 'neutral' ? 'var(--color-neutral-300)' : TONE[c.tone].dot }}>{c.next}</td>
                <td>
                  <ToneTag tone={c.tone} style={{ whiteSpace: 'nowrap' }}>{c.status}</ToneTag>
                  {/* Contrôle dépassé sans réserve ni action (les réserves sans action sont signalées dans la colonne suivante). */}
                  {canManage && c.days < 0 && !c.archived && !c.actionId && !c.reserves && (
                    <div style={{ ...muted, marginTop: 2, color: TONE.danger.dot, whiteSpace: 'nowrap' }}>Action à définir</div>
                  )}
                </td>
                <td style={{ color: 'var(--color-neutral-300)', whiteSpace: 'nowrap' }}>
                  {c.reserves ?? '—'}
                  {c.actionId ? (
                    <div style={{ marginTop: 2 }}>
                      <Link href={actionHref(c.actionId)} className="vg-link" style={{ fontSize: 11 }}>{c.actionId}</Link>
                      {c.action && <span style={{ ...muted, color: c.action.late ? TONE.danger.dot : muted.color }}> · {c.action.statusLabel}</span>}
                    </div>
                  ) : c.reserves && canManage && !c.archived ? (
                    <div style={{ ...muted, marginTop: 2, color: TONE.danger.dot }}>Action à définir</div>
                  ) : null}
                </td>
                {canManage && (
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {!c.archived && (
                      <button type="button" className="vg-text-btn" title="Enregistrer un contrôle réalisé" onClick={() => open(c.id, 'realise')}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Icon name="ph-check-square-offset" size={13} />Réalisé
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!control} onClose={close} width={660}
        kicker={control ? `Contrôle périodique · ${control.siteLabel}${control.archived ? ' · archivé' : ''}` : undefined} title={control?.equipment ?? ''}>
        {control && sel && (
          <ControlDetail key={control.id} c={control} initialView={sel.view} canManage={canManage} canApprove={canApprove} options={options}
            actionOptions={actionOptions} linkActions={linkActions} requirementOptions={requirementOptions} today={today} suggestions={suggestions} onClose={close} />
        )}
      </Dialog>
    </div>
  );
}

/** Bouton « Ajouter un contrôle ». */
export function AddControlButton({ options, requirementOptions, defaultSite, suggestions, today }: {
  options: Opts; requirementOptions: readonly Option[]; defaultSite: string; suggestions: ControlSuggestions; today: string;
}) {
  return (
    <DialogButton label="Ajouter un contrôle" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouveau contrôle périodique" kicker="Contrôles périodiques" width={660}>
      {(close) => <ControlForm options={options} requirementOptions={requirementOptions} defaultSite={defaultSite} suggestions={suggestions} today={today} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

// ─── Fiche d'un contrôle ────────────────────────────────────────────────────

function ControlDetail({ c, initialView, canManage, canApprove, options, actionOptions, linkActions, requirementOptions, today, suggestions, onClose }: ActionProps & {
  c: ControlView; initialView: View; canManage: boolean; canApprove: boolean; options: Opts; requirementOptions: readonly Option[];
  today: string; suggestions: ControlSuggestions; onClose: () => void;
}) {
  const editable = canManage && !c.archived;
  const [view, setView] = useState<View>(editable ? initialView : 'historique');
  // Confirmation après un enregistrement (la vue bascule sur l'historique) ou une restauration.
  const [notice, setNotice] = useState<string | null>(null);
  // « Lever les réserves » / « Créer une action » s'affichent dans cette fenêtre (pas de NewActionButton imbriqué : identifiants de champs en double).
  const [creating, setCreating] = useState(false);
  const show = (v: View) => { setNotice(null); setView(v); };
  const current = editable ? view : 'historique';
  const views: (readonly [View, string, string])[] = editable
    ? [['fiche', 'Fiche', 'ph-pencil-simple'], ['historique', `Historique · ${c.records.length}`, 'ph-clock-counter-clockwise'], ['realise', 'Contrôle réalisé', 'ph-check-square-offset']]
    : [];

  return (
    <>
      <Facts items={[
        ['Statut', <ToneTag key="s" tone={c.tone} style={{ marginTop: 1 }}>{c.status}</ToneTag>],
        ['Prochain', <span key="n" style={{ color: c.tone === 'neutral' ? undefined : TONE[c.tone].dot }}>{c.next}</span>],
        ['Dernier', c.last],
        ['Périodicité', `Tous les ${months(c.periodMonths)}`],
        ['Organisme', c.organization],
        ['Responsable', c.responsible || '—'],
        ['Réserves', c.reserves ?? 'Aucune'],
        c.requirement && ['Exigence', (
          <Link key="r" href={`/veille?exigence=${c.requirement.id}`} className="vg-link" style={{ fontSize: 12.5 }}>
            {c.requirement.text}{c.requirement.archived ? ' (archivée)' : ''}
          </Link>
        )],
      ]} />

      {c.archived && (
        <ArchivedBanner title="Équipement réformé · contrôle archivé" label={c.archivedLabel}>
          {canApprove && (
            <ReasonButton label="Restaurer" icon="ph-arrow-counter-clockwise" title={`Restaurer « ${c.equipment} »`} kicker="Contrôles périodiques"
              action={restoreControl} hidden={{ id: c.id }} submitLabel="Restaurer le contrôle" submitIcon="ph-arrow-counter-clockwise"
              message="Le contrôle revient dans le suivi, avec ses échéances et son historique."
              placeholder="Ex. archivage par erreur, équipement remis en service" onDone={() => setNotice('Contrôle restauré dans le suivi.')} />
          )}
        </ArchivedBanner>
      )}

      {notice && <Notice>{notice}</Notice>}

      <FollowUp c={c} today={today} actionOptions={c.archived ? null : actionOptions} linkActions={c.archived ? undefined : linkActions} editable={editable}
        creating={creating} setCreating={setCreating}
        onCreated={() => { setCreating(false); setNotice('Action créée et rattachée au contrôle.'); }} />

      {/* EVT-14 : événements rattachés à l'équipement (pannes, presque-accidents, non-conformités). */}
      {!creating && <LinkedEvents events={c.events} />}

      {!creating && (
        <>
          {views.length > 0 && <ViewSwitch name={`control-view-${c.id}`} value={current} onChange={show} options={views} />}

          {/* Pas de `key` dérivée des données : l'enregistrement les modifie et remonterait le formulaire avant son onDone. */}
          {current === 'fiche' && (
            <>
              <ControlForm c={c} options={options} requirementOptions={requirementOptions} defaultSite={c.siteId ?? ''} suggestions={suggestions} today={today} onDone={onClose} onCancel={onClose} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
                <span style={{ ...muted, flex: 1, minWidth: 200, textWrap: 'pretty' }}>Équipement réformé ? Le contrôle est archivé avec son motif ; son historique est conservé.</span>
                <ReasonButton label="Archiver le contrôle" icon="ph-archive" title={`Archiver « ${c.equipment} »`} kicker="Contrôles périodiques · équipement réformé"
                  action={archiveControl} hidden={{ id: c.id }} submitLabel="Archiver" submitIcon="ph-archive"
                  message="Le contrôle sort du suivi et des échéances. L'historique des contrôles réalisés et l'action liée sont conservés."
                  placeholder="Ex. équipement réformé, remplacé par …" />
              </div>
            </>
          )}
          {current === 'historique' && (
            <>
              <History c={c} canApprove={canApprove && !c.archived} canEditFiles={editable} onNotice={setNotice} />
              <LazyChangeLog entity="control" id={c.id} title="Journal des modifications" />
            </>
          )}
          {current === 'realise' && (
            <RecordForm c={c} today={today} suggestions={suggestions}
              onDone={() => { setView('historique'); setNotice("Contrôle réalisé enregistré dans l'historique."); }} onCancel={onClose} />
          )}
        </>
      )}
    </>
  );
}

/**
 * Suivi du contrôle dans le plan d'actions : action liée (détachable par le QHSE) ; sinon, réserves en cours ou contrôle
 * dépassé, avec « Lever les réserves » / « Créer une action » ou le rattachement d'une action existante (service QHSE
 * seulement, ACT-22 ; l'encadrement qui suit le contrôle lit QHSE_ONLY_CREATE_MESSAGE).
 */
function FollowUp({ c, today, actionOptions, linkActions, editable, creating, setCreating, onCreated }: ActionProps & {
  c: ControlView; today: string; editable: boolean; creating: boolean; setCreating: (v: boolean) => void; onCreated: () => void;
}) {
  const qhse = !!actionOptions;
  const overdue = c.days < 0 && !c.archived;
  if (!c.reserves && !c.actionId && !overdue) return null;
  const box = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', fontSize: 12.5 } as const;
  const link = `control:${c.id}`;
  if (c.actionId) {
    return (
      <div className="vg-inset" style={box}>
        <Icon name="ph-list-checks" size={15} style={{ color: 'var(--color-accent)' }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: 'var(--color-neutral-500)' }}>{c.reserves ? `Réserves en cours · ${c.reserves} · action ` : 'Action liée '}</span>
          <Link href={actionHref(c.actionId)} className="vg-link" style={{ fontSize: 12.5 }}>{c.actionId}</Link>
          {c.action && <span> · {c.action.label}</span>}
          {c.action && <span style={{ ...muted, display: 'block', color: c.action.late ? TONE.danger.dot : muted.color }}>Date cible {c.action.due}</span>}
        </span>
        {c.action && <ToneTag tone={c.action.tone} style={{ whiteSpace: 'nowrap' }}>{c.action.statusLabel}</ToneTag>}
        {linkActions && <LinkActionButton link={link} current={c.actionId} />}
      </div>
    );
  }
  if (creating && actionOptions) {
    return (
      <>
        <div className="vg-eyebrow">{c.reserves ? 'Lever les réserves' : 'Contrôle dépassé'} · plan d&apos;actions unique</div>
        {/* Rendu sur un état local seulement : l'action liée arrive avec le même rafraîchissement que le succès du formulaire. */}
        <ActionFields options={actionOptions} defaults={c.reserves ? controlReserveDefaults(c, today) : controlOverdueDefaults(c, today)}
          onCancel={() => setCreating(false)} onDone={onCreated} />
      </>
    );
  }
  if (!c.reserves) {
    // Contrôle dépassé, sans réserve ni action : signalé à qui peut agir seulement (le statut « Dépassé » suffit sinon).
    if (!editable && !qhse) return null;
    return (
      <div className="vg-inset" style={{ ...box, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${TONE.danger.dot} 45%, transparent)` }}>
        <Icon name="ph-warning-octagon" size={15} style={{ color: TONE.danger.dot }} />
        <span style={{ flex: 1, minWidth: 180, textWrap: 'pretty' }}>
          <span style={{ color: 'var(--color-neutral-500)' }}>Contrôle dépassé depuis le </span>{c.next}
          <span style={{ ...muted, display: 'block' }}>Aucune action dans le plan d&apos;actions.{qhse ? '' : ` ${QHSE_ONLY_CREATE_MESSAGE}`}</span>
        </span>
        {linkActions && <LinkActionButton link={link} actions={linkActions} label="Rattacher" />}
        {qhse && (
          <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setCreating(true)}>
            <Icon name="ph-plus" size={13} />Créer une action
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="vg-inset" style={{ ...box, boxShadow: editable ? `inset 0 0 0 1px color-mix(in srgb, ${TONE.warn.dot} 45%, transparent)` : undefined }}>
      <Icon name="ph-warning" size={15} style={{ color: TONE.warn.dot }} />
      <span style={{ flex: 1, minWidth: 180, textWrap: 'pretty' }}>
        <span style={{ color: 'var(--color-neutral-500)' }}>Réserves en cours · </span>{c.reserves}
        {(editable || qhse) && (
          <span style={{ ...muted, display: 'block' }}>Aucune action de levée dans le plan d&apos;actions.{qhse ? '' : ` ${QHSE_ONLY_CREATE_MESSAGE}`}</span>
        )}
      </span>
      {linkActions && <LinkActionButton link={link} actions={linkActions} label="Rattacher" />}
      {qhse && (
        <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setCreating(true)}>
          <Icon name="ph-plus" size={13} />Lever les réserves
        </button>
      )}
    </div>
  );
}

function History({ c, canApprove, canEditFiles, onNotice }: {
  c: ControlView; canApprove: boolean; canEditFiles: boolean; onNotice: (msg: string) => void;
}) {
  if (!c.records.length) {
    return (
      <div className="vg-inset" style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
        Aucun contrôle enregistré dans Vigie pour cet équipement. Dernier contrôle connu : {c.last}{c.reserves ? ` (réserves : ${c.reserves})` : ''}.
      </div>
    );
  }
  return (
    <div style={{ display: 'grid' }}>
      {c.records.map((r, i) => (
        <div key={r.id} className={i < c.records.length - 1 ? 'vg-rule-bottom' : undefined}
          style={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', gap: 12, padding: '10px 0', opacity: r.cancelled ? 0.6 : undefined }}>
          <div style={{ display: 'grid', gap: 2, alignContent: 'start' }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, textDecoration: r.cancelled ? 'line-through' : undefined }}>{r.date}</span>
            {r.latest && <span style={muted}>Dernier</span>}
            {r.cancelled && <span style={muted}>Annulé</span>}
          </div>
          <div style={{ display: 'grid', gap: 5, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, textDecoration: r.cancelled ? 'line-through' : undefined }}>
              <span>{r.organization}</span>
              {r.result && <ToneTag tone={r.cancelled ? 'neutral' : r.result.tone}>{r.result.label}</ToneTag>}
              <ToneTag tone={r.cancelled ? 'neutral' : r.reserves ? 'warn' : 'ok'}>{r.reserves ? `Réserves · ${r.reserves}` : 'Sans réserve'}</ToneTag>
            </div>
            {r.cancelLabel && <span style={{ ...muted, fontSize: 11.5, color: 'var(--color-neutral-300)' }}>{r.cancelLabel}</span>}
            {r.notes && <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{r.notes}</p>}
            {/* VEI-08 : rapport complété ou retiré (motif) après la saisie ; figé sur un enregistrement annulé. */}
            <EntityFiles kind="control_record" entityId={r.id} title="Rapport et pièces jointes" kicker={`${c.equipment} · contrôle du ${r.date}`} files={r.files}
              canAdd={canEditFiles && !r.cancelled} emptyText="Pas de rapport joint." />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {r.recordedBy && <span style={muted}>Saisi par {r.recordedBy}</span>}
              {canApprove && !r.cancelled && (
                <ReasonButton label="Annuler l'enregistrement" icon="ph-arrow-u-up-left" className="vg-text-btn" style={{ fontSize: 11.5 }}
                  title={`Annuler le contrôle du ${r.date}`} kicker={c.equipment}
                  action={cancelControlRecord} hidden={{ id: r.id }} submitLabel="Annuler l'enregistrement" submitIcon="ph-arrow-u-up-left"
                  message={r.latest
                    ? "Saisie erronée : l'enregistrement reste visible, barré, avec son motif. L'état du contrôle (dernier, prochain, réserves) est recalculé."
                    : "Saisie erronée : l'enregistrement reste visible, barré, avec son motif. L'échéance du contrôle n'est pas modifiée."}
                  placeholder="Ex. date erronée, contrôle saisi sur le mauvais équipement"
                  onDone={(s) => onNotice((s as CancelRecordState).notice ?? `Enregistrement du ${r.date} annulé.`)} />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Formulaires ────────────────────────────────────────────────────────────

function Suggestions({ id, values }: { id: string; values: string[] }) {
  return <datalist id={id}>{values.map((v) => <option key={v} value={v} />)}</datalist>;
}

const RECORD_HINT = '« Enregistrer un contrôle » le met à jour (historique, réserves et action de levée).';

function ControlForm({ c, options, requirementOptions, defaultSite, suggestions, today, onDone, onCancel }: {
  c?: ControlView; options: Opts; requirementOptions: readonly Option[]; defaultSite: string; suggestions: ControlSuggestions; today: string;
  onDone: () => void; onCancel: () => void;
}) {
  const uid = useId();
  // Exigence archivée encore rattachée : conservée comme choix (la modification renvoie toujours une valeur).
  const reqs = c?.requirement && !requirementOptions.some(([v]) => v === String(c.requirement!.id))
    ? [...requirementOptions, [String(c.requirement.id), `${c.requirement.text} (archivée)`] as const]
    : requirementOptions;
  // Responsable sorti de l'effectif, site archivé : conservés comme choix tant qu'un autre n'est pas fait (VEI-01).
  const responsibles = withCurrent(options.people, c?.responsibleId, c ? `${c.responsible || c.responsibleId}${LEFT_SUFFIX}` : undefined);
  const sites = withCurrent(options.sites, c?.siteId, c ? `${c.siteLabel}${ARCHIVED_SITE_SUFFIX}` : undefined);
  const [lastOn, setLastOn] = useState(c?.lastOn ?? '');
  const [period, setPeriod] = useState(c ? String(c.periodMonths) : '12');
  // Échéance saisie à la main (null = calculée).
  const [manualNext, setManualNext] = useState<string | null>(c && c.nextOn !== nextFrom(c.lastOn, String(c.periodMonths)) ? c.nextOn : null);
  const computed = nextFrom(lastOn, period);
  const nextOn = manualNext ?? computed;

  return (
    <ActionForm action={saveControl} hidden={{ id: c?.id }} onDone={onDone} onCancel={onCancel} submitLabel={c ? 'Enregistrer' : 'Ajouter le contrôle'}>
      <Field name="equipment" label="Équipement">
        <Input name="equipment" defaultValue={c?.equipment} placeholder="Ex. Pont roulant 10 t — atelier montage" maxLength={160} autoFocus={!c} />
      </Field>
      <FormRow>
        <Field name="controlType" label="Type de contrôle">
          <Input name="controlType" defaultValue={c?.controlType} placeholder="Ex. VGP levage" list={`${uid}-types`} maxLength={120} />
        </Field>
        <Field name="periodMonths" label="Périodicité (mois)">
          <Input name="periodMonths" type="number" min={1} max={120} step={1} inputMode="numeric" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="organization" label="Organisme" hint="Organisme agréé ou « Interne — service ».">
          <Input name="organization" defaultValue={c?.organization} placeholder="Ex. [Apave]" list={`${uid}-orgs`} maxLength={120} />
        </Field>
        <Field name="responsibleId" label="Responsable" hint={responsibles !== options.people ? "Sorti de l'effectif : conservé tant qu'aucun successeur n'est choisi." : undefined}>
          <Select name="responsibleId" options={responsibles} defaultValue={c?.responsibleId ?? ''} placeholder="Non désigné" />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="siteId" label="Site" hint={sites !== options.sites ? "Site archivé : conservé tant qu'aucun autre site n'est choisi." : undefined}>
          <Select name="siteId" options={sites} defaultValue={c ? c.siteId ?? '' : defaultSite} placeholder="Tous les sites" />
        </Field>
        <Field name="reserves" label="Réserves en cours" hint={c ? RECORD_HINT : 'Vide = aucune. Mises à jour à chaque contrôle enregistré.'}>
          {/* VEI-09 : à la modification, champ en lecture (non envoyé) ; il change par un contrôle enregistré. */}
          <Input name="reserves" defaultValue={c?.reserves ?? ''} placeholder={c ? 'Aucune' : 'Ex. 1 · fin de course à régler'} maxLength={160} disabled={!!c} />
        </Field>
      </FormRow>
      <Field name="requirementId" label="Exigence réglementaire" hint="Texte dont relève le contrôle : un contrôle dépassé y suggère un écart.">
        <Select name="requirementId" options={reqs} defaultValue={c?.requirementId != null ? String(c.requirementId) : ''} placeholder="Aucune" />
      </Field>
      <FormRow>
        <Field name="lastOn" label="Dernier contrôle" hint={c ? RECORD_HINT : undefined}>
          <Input name="lastOn" type="date" value={lastOn} max={today} onChange={(e) => setLastOn(e.target.value)} disabled={!!c} />
        </Field>
        <Field name="nextOn" label="Prochain contrôle"
          hint={manualNext !== null ? (
            <>Saisie manuelle · <button type="button" className="vg-text-btn" style={{ fontSize: 11 }} onClick={() => setManualNext(null)}>
              recalculer{computed ? ` (${fmtDate(computed)})` : ''}
            </button></>
          ) : 'Calculé : dernier contrôle + périodicité.'}>
          <Input name="nextOn" type="date" value={nextOn} min={lastOn || undefined} onChange={(e) => setManualNext(e.target.value)} />
        </Field>
      </FormRow>
      <Suggestions id={`${uid}-types`} values={suggestions.types} />
      <Suggestions id={`${uid}-orgs`} values={suggestions.organizations} />
    </ActionForm>
  );
}

const RESULT_OPTIONS = CONTROL_RESULT_KEYS.map((k) => [k, CONTROL_RESULTS[k].label] as const);

function RecordForm({ c, today, suggestions, onDone, onCancel }: {
  c: ControlView; today: string; suggestions: ControlSuggestions; onDone: () => void; onCancel: () => void;
}) {
  const uid = useId();
  const [date, setDate] = useState(today);
  const [fileError, setFileError] = useState<string | null>(null);
  const valid = ISO.test(date);
  const older = valid && date < c.lastOn;

  return (
    <ActionForm action={recordControl} hidden={{ controlId: c.id }} encType="multipart/form-data" onDone={onDone} onCancel={onCancel}
      submitLabel="Enregistrer le contrôle" submitIcon="ph-check-square-offset">
      <FormRow>
        <Field name="performedOn" label="Date du contrôle">
          <Input name="performedOn" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field name="organization" label="Organisme">
          <Input name="organization" defaultValue={c.organization} list={`${uid}-orgs`} maxLength={120} />
        </Field>
      </FormRow>
      {/* VEI-11 : avis de l'organisme ; défavorable ou mise à l'arrêt : équipement signalé jusqu'à un contrôle favorable. */}
      <Field name="result" label="Résultat du contrôle" hint="Défavorable ou mise à l'arrêt : l'équipement est signalé jusqu'à un nouveau contrôle favorable.">
        <Select name="result" options={RESULT_OPTIONS} defaultValue="" placeholder="Choisir…" />
      </Field>
      <Field name="reserves" label="Réserves"
        hint={`Nombre et objet, ex. « 1 · fin de course à régler ». Vide = aucune réserve.${c.actionId ? ` Des réserves différentes détachent ${c.actionId}, qui reste dans le plan d'actions.` : ''}`}>
        <Input name="reserves" placeholder="Aucune" maxLength={160} />
      </Field>
      <Field name="notes" label="Observations">
        <TextArea name="notes" rows={2} maxLength={2000} placeholder="Points relevés, levée de réserves, suites données…" style={{ minHeight: 56 }} />
      </Field>
      <Field name="report" label="Rapport" hint="PDF, image ou document Office · 10 Mo maximum.">
        <Input name="report" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,.doc,.docx,.xls,.xlsx,.pptx,.txt,.csv"
          onChange={(e) => setFileError(checkPickedFiles(e.currentTarget))} />
      </Field>
      <FileError error={fileError} />
      <div className="vg-inset" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, color: 'var(--color-neutral-300)' }}>
        <Icon name="ph-calendar-check" size={15} style={{ color: older ? 'var(--color-neutral-500)' : 'var(--color-accent)', flex: 'none' }} />
        <span style={{ textWrap: 'pretty' }}>
          {!valid
            ? 'Saisissez la date du contrôle réalisé.'
            : older
              ? `Antérieur au dernier contrôle connu (${c.last}) : ajouté à l'historique sans modifier l'échéance.`
              : <>Prochain contrôle le <strong style={{ fontWeight: 500, color: 'var(--color-text)' }}>{fmtDate(addMonths(date, c.periodMonths))}</strong> (tous les {months(c.periodMonths)}).</>}
        </span>
      </div>
      <Suggestions id={`${uid}-orgs`} values={suggestions.organizations} />
    </ActionForm>
  );
}
