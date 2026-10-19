'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ActionFields } from '@/components/ActionFormDialog';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Checkbox, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { LinkActionButton } from '@/components/LinkActionButton';
import { ReasonButton } from '@/components/ReasonDialog';
import { Dot, Icon, ToneTag } from '@/components/ui';
import { QHSE_ONLY_CREATE_MESSAGE, actionHref } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { ATTACH_ACCEPT } from '@/lib/attachments';
import { fmtDate } from '@/lib/dates';
import { REQUIREMENT_EVAL, REQUIREMENT_NEEDS_ACTION, TONE } from '@/lib/domain';
import type { FormOptions } from '@/lib/data/options';
import { LEFT_SUFFIX, withCurrent, type Option } from '@/lib/form-options';
import type { RequirementView } from '@/lib/data/watch';
import { Attachments } from '@/components/Attachments';
import { addRequirementFiles, archiveRequirement, evaluateRequirement, removeRequirementFile, restoreRequirement, saveRequirement } from '@/server/watch';
import { requirementActionDefaults } from './action-defaults';
import { ArchivedBanner, FILES_HINT, Facts, FileChips, FileError, Notice, ViewSwitch, checkPickedFiles, muted, rowOpener } from './parts';

/** `applicableSites` (VEI-10) : sites proposés pour l'applicabilité d'une exigence — périmètre complet seulement, sinon vide. */
type Opts = Pick<FormOptions, 'people' | 'sites'> & { applicableSites?: readonly Option[] };
/**
 * Plan d'actions (ACT-22, réponses du service QHSE du 15/10/2026) : `actionOptions` (listes du formulaire d'action) et
 * `linkActions` (actions ouvertes à rattacher) ne sont fournis qu'au service QHSE, seul à créer une action et à modifier
 * ses rattachements ; absents pour les autres rôles.
 */
type ActionProps = { actionOptions?: ActionFormOptions | null; linkActions?: readonly Option[] };
type Featured = { id: number; text: string } | null;
type View = 'fiche' | 'evaluer' | 'historique';
type EvalInitial = { evaluation: string; note: string | null };

const EVALS = Object.entries(REQUIREMENT_EVAL);
const EVAL_OPTIONS = EVALS.map(([k, v]) => [k, v.label] as const);
const NEEDS_ACTION = new Set<string>(REQUIREMENT_NEEDS_ACTION);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

// ─── Tableau des exigences ──────────────────────────────────────────────────

export function RequirementsPanel({ rows, archives = false, canManage, canApprove, options, actionOptions, linkActions, today, initialId, closeHref }: ActionProps & {
  /** Toutes les exigences (archivées comprises) : la fiche ouverte reste affichée après son archivage. */
  rows: RequirementView[];
  /** Liste des exigences archivées (`?archives=1`) au lieu des exigences en vigueur. */
  archives?: boolean;
  canManage: boolean;
  /** Animateur QHSE, direction : restauration d'une exigence archivée. */
  canApprove: boolean;
  options: Opts;
  today: string;
  /** Exigence à ouvrir d'emblée (lien profond `?exigence=<id>`). */
  initialId?: number;
  /** URL sans le lien profond, rétablie à la fermeture. */
  closeHref?: string;
}) {
  const router = useRouter();
  const [selId, setSelId] = useState<number | null>(initialId ?? null);
  const sel = rows.find((r) => r.id === selId) ?? null;
  const shown = rows.filter((r) => r.archived === archives);
  const featured = rows.find((r) => r.featured && !r.archived);
  const close = () => {
    setSelId(null);
    if (closeHref) router.replace(closeHref, { scroll: false });
  };

  return (
    <div className="card" style={{ padding: '6px 14px 10px' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 980 }}>
          <thead><tr><th>Texte</th><th>Domaine</th><th>Ce qu&apos;il exige</th><th>Échéance</th><th>Évaluation</th><th>Pilote</th><th>Action</th></tr></thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={7} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
                {archives ? 'Aucune exigence archivée.' : 'Aucune exigence suivie pour l’instant.'}
              </td></tr>
            )}
            {shown.map((r) => (
              <tr key={r.id} {...rowOpener(() => setSelId(r.id))} style={r.archived ? { opacity: 0.75 } : undefined}>
                <td style={{ fontWeight: 500, minWidth: 160 }}>
                  {r.text}
                  {r.featured && (
                    <span title="Mise en avant sur le tableau de bord" style={{ marginLeft: 6, color: 'var(--color-accent)', verticalAlign: 'middle' }}>
                      <Icon name="ph-push-pin" size={12} />
                    </span>
                  )}
                  {r.archivedLabel && <div style={{ ...muted, fontWeight: 400, marginTop: 2 }}>{r.archivedLabel}</div>}
                </td>
                <td style={{ color: 'var(--color-neutral-400)', minWidth: 130 }}>{r.domain}</td>
                <td style={{ color: 'var(--color-neutral-300)', maxWidth: 340, textWrap: 'pretty' }}>{r.summary}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.due || '—'}</td>
                <td>
                  <ToneTag tone={r.tone} style={{ whiteSpace: 'nowrap' }}>{r.evalLabel}</ToneTag>
                  {r.lastEvaluated && (
                    <div style={{ ...muted, marginTop: 3, whiteSpace: 'nowrap' }}>
                      {r.evaluation === 'a_evaluer' ? 'Revue le' : 'Évaluée le'} {r.lastEvaluated}
                    </div>
                  )}
                  {r.nextReview && r.nextReview.tone !== 'neutral' && (
                    <div style={{ ...muted, marginTop: 2, whiteSpace: 'nowrap', color: TONE[r.nextReview.tone].dot }}>{r.nextReview.label}</div>
                  )}
                  {r.indicator && (
                    <div title="Indicateur calculé par Vigie" style={{ ...muted, marginTop: 2, maxWidth: 220, color: r.indicator.tone === 'ok' ? muted.color : TONE[r.indicator.tone].dot }}>
                      <Icon name="ph-calculator" size={11} /> {r.indicator.label}
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.pilot || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.actionId ? (
                    <>
                      <Link href={actionHref(r.actionId)} className="vg-link">{r.actionId}</Link>
                      {r.action && <div style={{ ...muted, marginTop: 2, color: r.action.late ? TONE.danger.dot : muted.color }}>{r.action.statusLabel}</div>}
                    </>
                  ) : r.needsAction ? (
                    <span style={{ color: TONE.danger.dot }}>À définir</span>
                  ) : (
                    <span style={{ color: 'var(--color-neutral-600)' }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!sel} onClose={close} width={660}
        kicker={sel ? `Veille réglementaire · ${sel.domain}${sel.archived ? ' · archivée' : ''}` : undefined} title={sel?.text ?? ''}>
        {sel && (
          <RequirementDetail key={sel.id} r={sel} canManage={canManage} canApprove={canApprove} options={options} actionOptions={actionOptions}
            linkActions={linkActions} today={today}
            featured={featured && featured.id !== sel.id ? { id: featured.id, text: featured.text } : null} onClose={close} />
        )}
      </Dialog>
    </div>
  );
}

/** Bouton « Ajouter une exigence ». */
export function AddRequirementButton({ options, featured }: { options: Opts; featured: Featured }) {
  return (
    <DialogButton label="Ajouter une exigence" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouvelle exigence" kicker="Veille réglementaire" width={660}>
      {(close) => <RequirementForm options={options} featured={featured} onDone={close} onCancel={close} />}
    </DialogButton>
  );
}

// ─── Fiche d'une exigence ───────────────────────────────────────────────────

function RequirementDetail({ r, canManage, canApprove, options, actionOptions, linkActions, today, featured, onClose }: ActionProps & {
  r: RequirementView; canManage: boolean; canApprove: boolean; options: Opts; today: string; featured: Featured; onClose: () => void;
}) {
  const editable = canManage && !r.archived;
  // Création et rattachements d'actions : service QHSE seulement (ACT-22), sur une exigence en vigueur.
  const creatable = !r.archived && actionOptions ? actionOptions : null;
  const [view, setView] = useState<View>('fiche');
  // « Créer l'action » s'affiche dans cette fenêtre, à la place du formulaire de la fiche : une fenêtre
  // NewActionButton imbriquée dupliquerait les identifiants de champs de la fiche (pilotId, dueOn).
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<'evaluated' | 'action' | 'restored' | null>(null);
  // Évaluation préremplie (suggestion « Écart » quand un contrôle rattaché est dépassé).
  const [evalInitial, setEvalInitial] = useState<EvalInitial | undefined>(undefined);
  const show = (v: View) => { setNotice(null); setEvalInitial(undefined); setView(v); };
  const views: (readonly [View, string, string])[] = [
    ['fiche', 'Fiche', editable ? 'ph-pencil-simple' : 'ph-file-text'],
    ...(editable ? [['evaluer', 'Évaluer', 'ph-seal-check'] as const] : []),
    ['historique', `Historique · ${r.evaluations.length}`, 'ph-clock-counter-clockwise'],
  ];

  return (
    <>
      <Facts items={[
        ['Évaluation', <ToneTag key="e" tone={r.tone} style={{ marginTop: 1 }}>{r.evalLabel}</ToneTag>],
        ['Dernière évaluation', r.lastEvaluated ?? (r.evaluation === 'a_evaluer' ? 'Jamais évaluée' : 'Non datée')],
        r.nextReview && ['Réévaluation', <span key="r" style={{ color: r.nextReview.tone === 'neutral' ? undefined : TONE[r.nextReview.tone].dot }}>{r.nextReview.label.replace('Réévaluation avant', 'Avant')}</span>],
        ['Échéance', r.due || '—'],
        r.indicator && ['Indicateur calculé', (
          <Link key="i" href={r.indicator.href} className="vg-link" style={{ fontSize: 12.5, color: r.indicator.tone === 'ok' ? undefined : TONE[r.indicator.tone].dot }}>
            {r.indicator.label}
          </Link>
        )],
        ['Pilote', r.pilot || '—'],
        // VEI-10 : applicabilité par site et lien vers le texte.
        ['Sites concernés', r.siteLabels.length ? r.siteLabels.join(', ') : 'Tous les sites'],
        !!r.legifranceUrl && ['Texte', <a key="t" href={r.legifranceUrl} target="_blank" rel="noreferrer noopener" className="vg-link" style={{ fontSize: 12.5 }}>Consulter le texte officiel</a>],
        r.projects.count != null && ['Projets Keystone', `${plural(r.projects.count, 'concerné', 'concernés')}${r.projects.manual ? ' · saisie manuelle' : ''}`],
        r.featured && ['Tableau de bord', <span key="f" style={{ color: 'var(--color-accent)' }}><Icon name="ph-push-pin" size={12} /> À la une</span>],
      ]} />

      {r.archived && (
        <ArchivedBanner title="Texte abrogé · exigence archivée" label={r.archivedLabel}>
          {canApprove && (
            <ReasonButton label="Restaurer" icon="ph-arrow-counter-clockwise" title={`Restaurer « ${r.text} »`} kicker="Veille réglementaire"
              action={restoreRequirement} hidden={{ id: r.id }} submitLabel="Restaurer l'exigence" submitIcon="ph-arrow-counter-clockwise"
              message="L'exigence revient dans la veille en vigueur, avec son historique d'évaluations."
              placeholder="Ex. archivage par erreur, texte remis en vigueur" onDone={() => setNotice('restored')} />
          )}
        </ArchivedBanner>
      )}

      {notice && (
        <Notice>
          {notice === 'action' ? "Action créée et rattachée à l'exigence."
            : notice === 'restored' ? 'Exigence restaurée dans la veille en vigueur.'
              : `Évaluation enregistrée le ${fmtDate(today)}.`}
        </Notice>
      )}

      {editable && r.suggestGap && view !== 'evaluer' && !creating && (
        <div className="vg-inset" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', fontSize: 12.5, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${TONE.warn.dot} 45%, transparent)` }}>
          <Icon name="ph-warning" size={15} style={{ color: TONE.warn.dot }} />
          <span style={{ flex: 1, minWidth: 180, textWrap: 'pretty' }}>
            {r.suggestReason} : envisager l&apos;évaluation « Écart ».
            {r.suggestNote && <span style={{ ...muted, display: 'block' }}>{r.suggestNote}</span>}
          </span>
          <button type="button" className="btn btn-secondary vg-btn-sm"
            onClick={() => { setNotice(null); setView('evaluer'); setEvalInitial({ evaluation: 'ecart', note: r.suggestNote }); }}>
            <Icon name="ph-seal-check" size={13} />Évaluer
          </button>
        </div>
      )}

      <LinkedAction r={r} actions={linkActions && !r.archived ? linkActions : undefined} canUnlink={!!linkActions} showQhseNotice={editable && !creatable}
        onCreate={creatable && !creating ? () => { setNotice(null); setCreating(true); } : undefined} />

      {creatable && creating ? (
        <>
          <div className="vg-eyebrow">Nouvelle action · plan d&apos;actions unique</div>
          {/* Rendu sur un état local seulement : l'action liée arrive avec le même rafraîchissement que le succès du formulaire. */}
          <ActionFields options={creatable} defaults={requirementActionDefaults(r, today)}
            onCancel={() => setCreating(false)} onDone={() => { setCreating(false); setView('fiche'); setNotice('action'); }} />
        </>
      ) : (
        <>
          <ViewSwitch name={`requirement-view-${r.id}`} value={view} onChange={show} options={views} />
          {/* Pas de `key` dérivée des données : l'enregistrement les modifie et remonterait le formulaire avant son onDone. */}
          {view === 'fiche' && (
            <>
              <LinkedControls r={r} />
              <KeystoneProjects r={r} />
              <Attachments title="Texte réglementaire joint" kicker={r.text} files={r.textFiles} canAdd={editable} emptyText="Aucun texte joint."
                hint="PDF du texte ou extrait applicable · 10 Mo par fichier."
                onAdd={(picked) => {
                  const fd = new FormData();
                  fd.set('requirementId', String(r.id));
                  picked.forEach((file) => fd.append('files', file));
                  return addRequirementFiles(fd);
                }}
                onRemove={removeRequirementFile} />
              {editable ? (
                <>
                  <RequirementForm r={r} options={options} featured={featured} onDone={onClose} onCancel={onClose} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 10, borderTop: '1px solid var(--color-divider)' }}>
                    <span style={{ ...muted, flex: 1, minWidth: 200, textWrap: 'pretty' }}>Texte abrogé ou sans objet ? L&apos;exigence est archivée avec son motif, jamais supprimée.</span>
                    <ReasonButton label="Archiver l'exigence" icon="ph-archive" title={`Archiver « ${r.text} »`} kicker="Veille réglementaire · texte abrogé"
                      action={archiveRequirement} hidden={{ id: r.id }} submitLabel="Archiver" submitIcon="ph-archive"
                      message={`L'action liée reste dans le plan d'actions ; l'historique des évaluations est conservé.${r.featured ? ' L’exigence est retirée du tableau de bord.' : ''}`}
                      placeholder="Ex. texte abrogé par le décret du …" />
                  </div>
                </>
              ) : (
                <ReadOnly r={r} />
              )}
            </>
          )}
          {view === 'evaluer' && editable && (
            <EvaluateForm r={r} today={today} initial={evalInitial} onCancel={onClose}
              onDone={(evaluation) => {
                setEvalInitial(undefined);
                if (NEEDS_ACTION.has(evaluation) && !r.actionId) { setView('fiche'); setNotice('evaluated'); } else onClose();
              }} />
          )}
          {view === 'historique' && (
            <>
              <EvaluationHistory r={r} />
              <LazyChangeLog entity="requirement" id={r.id} title="Journal des modifications" />
            </>
          )}
        </>
      )}
    </>
  );
}

function ReadOnly({ r }: { r: RequirementView }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <div className="vg-eyebrow" style={{ marginBottom: 4 }}>Ce qu&apos;il exige</div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{r.summary}</p>
      </div>
      {r.impact && (
        <div>
          <div className="vg-eyebrow" style={{ marginBottom: 4 }}>Impact</div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{r.impact}</p>
        </div>
      )}
    </div>
  );
}

/** Contrôles périodiques rattachés à l'exigence (tous les sites du périmètre, VEI-06), statut calculé. */
function LinkedControls({ r }: { r: RequirementView }) {
  if (!r.controls.length) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="vg-eyebrow">Contrôles périodiques rattachés</div>
      {r.controls.map((c) => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
          <Link href={`/veille?onglet=controles&controle=${c.id}`} className="vg-link" style={{ fontSize: 12.5, flex: 1, minWidth: 180 }}>
            {c.controlType} · {c.equipment}
          </Link>
          <span style={muted}>{c.siteLabel} · prochain le {c.next}</span>
          <ToneTag tone={c.tone} style={{ whiteSpace: 'nowrap' }}>{c.status}</ToneTag>
        </div>
      ))}
    </div>
  );
}

/** Projets Keystone livrés après la date d'application (calculés depuis le référentiel Keystone). */
function KeystoneProjects({ r }: { r: RequirementView }) {
  if (!r.projects.list.length) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="vg-eyebrow">Projets Keystone concernés</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {r.projects.list.map((p) => (
          <li key={p.id} style={{ fontSize: 12.5, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500 }}>{p.id}</span>
            <span style={{ color: 'var(--color-neutral-300)' }}>{p.client} · {p.title}</span>
            <span style={muted}>livraison le {p.delivery}</span>
          </li>
        ))}
      </ul>
      <span style={muted}>
        Lecture depuis le référentiel Keystone · lien direct à venir
        {r.projects.manual && r.projects.computed != null ? ` · nombre saisi (${r.projects.count}) en surcharge du calcul (${r.projects.computed})` : ''}
      </span>
    </div>
  );
}

/** Historique des évaluations de conformité : la plus récente d'abord. */
function EvaluationHistory({ r }: { r: RequirementView }) {
  if (!r.evaluations.length) {
    return (
      <div className="vg-inset" style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--color-neutral-400)' }}>
        Aucune évaluation enregistrée dans Vigie.
      </div>
    );
  }
  return (
    <div style={{ display: 'grid' }}>
      {r.evaluations.map((e, i) => (
        <div key={e.id} className={i < r.evaluations.length - 1 ? 'vg-rule-bottom' : undefined}
          style={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', gap: 12, padding: '10px 0' }}>
          <div style={{ display: 'grid', gap: 2, alignContent: 'start' }}>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>{e.date}</span>
            {i === 0 && <span style={muted}>Dernière</span>}
          </div>
          <div style={{ display: 'grid', gap: 5, minWidth: 0 }}>
            <div><ToneTag tone={e.tone}>{e.label}</ToneTag></div>
            {e.note && <p style={{ margin: 0, fontSize: 12, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{e.note}</p>}
            <FileChips files={e.files} />
            {e.by && <span style={muted}>Évaluée par {e.by}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Action liée (lecture seule ; détachable par le QHSE) ou, pour un écart ou une analyse d'écart sans action, « Créer
 * l'action » / « Rattacher » (QHSE seulement, ACT-22) ; l'encadrement qui saisit la veille lit QHSE_ONLY_CREATE_MESSAGE.
 */
function LinkedAction({ r, actions, canUnlink, showQhseNotice, onCreate }: {
  r: RequirementView; actions?: readonly Option[]; canUnlink: boolean; showQhseNotice: boolean; onCreate?: () => void;
}) {
  const box = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 12px', fontSize: 12.5 } as const;
  const link = `requirement:${r.id}`;
  if (r.actionId) {
    return (
      <div className="vg-inset" style={box}>
        <Icon name="ph-list-checks" size={15} style={{ color: 'var(--color-accent)' }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ color: 'var(--color-neutral-500)' }}>Action liée </span>
          <Link href={actionHref(r.actionId)} className="vg-link" style={{ fontSize: 12.5 }}>{r.actionId}</Link>
          {r.action && <span> · {r.action.label}</span>}
          {r.action && <span style={{ ...muted, display: 'block', color: r.action.late ? TONE.danger.dot : muted.color }}>Date cible {r.action.due}</span>}
        </span>
        {r.action && <ToneTag tone={r.action.tone} style={{ whiteSpace: 'nowrap' }}>{r.action.statusLabel}</ToneTag>}
        {canUnlink && !r.archived && <LinkActionButton link={link} current={r.actionId} />}
      </div>
    );
  }
  if (!NEEDS_ACTION.has(r.evaluation) || r.archived) return null;
  return (
    <div className="vg-inset" style={{ ...box, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${TONE.danger.dot} 45%, transparent)` }}>
      <Icon name="ph-warning-circle" size={15} style={{ color: TONE.danger.dot }} />
      <span style={{ flex: 1, minWidth: 180, textWrap: 'pretty' }}>
        {r.evaluation === 'ecart'
          ? "Écart sans action de mise en conformité dans le plan d'actions."
          : "Analyse d'écart à suivre dans le plan d'actions."}
        {showQhseNotice && <span style={{ ...muted, display: 'block' }}>{QHSE_ONLY_CREATE_MESSAGE}</span>}
      </span>
      {actions && <LinkActionButton link={link} actions={actions} label="Rattacher" />}
      {onCreate && (
        <button type="button" className="btn btn-primary vg-btn-sm" onClick={onCreate}>
          <Icon name="ph-plus" size={13} />Créer l&apos;action
        </button>
      )}
    </div>
  );
}

// ─── Formulaires ────────────────────────────────────────────────────────────

function RequirementForm({ r, options, featured, onDone, onCancel }: {
  r?: RequirementView; options: Opts; featured: Featured; onDone: () => void; onCancel: () => void;
}) {
  const computed = r?.projects.computed;
  // Pilote sorti de l'effectif : conservé comme choix tant qu'aucun successeur n'est désigné (VEI-01).
  const pilots = withCurrent(options.people, r?.pilotId, r ? `${r.pilot || r.pilotId}${LEFT_SUFFIX}` : undefined);
  const applicable = options.applicableSites ?? [];
  const chosen = new Set(r?.siteIds ?? []);
  return (
    <ActionForm action={saveRequirement} hidden={{ id: r?.id, siteIdsField: applicable.length ? '1' : undefined }} onDone={onDone} onCancel={onCancel} submitLabel={r ? 'Enregistrer' : "Ajouter l'exigence"}>
      <FormRow>
        <Field name="text" label="Texte">
          <Input name="text" defaultValue={r?.text} placeholder="Ex. Code du travail — R. 4512-6" maxLength={120} autoFocus={!r} />
        </Field>
        <Field name="domain" label="Domaine">
          <Input name="domain" defaultValue={r?.domain} placeholder="Ex. Plans de prévention" maxLength={120} />
        </Field>
      </FormRow>
      <Field name="legifranceUrl" label="Lien vers le texte" hint="Légifrance ou EUR-Lex (règlements européens). Le texte peut aussi être joint à la fiche.">
        <Input name="legifranceUrl" type="url" defaultValue={r?.legifranceUrl ?? ''} placeholder="https://www.legifrance.gouv.fr/…" maxLength={500} />
      </Field>
      {applicable.length > 0 && (
        <Field name="siteIds" label="Sites concernés" hint="Aucun site coché : l'exigence s'applique à tous les sites.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            {applicable.map(([id, label]) => <Checkbox key={id} name="siteIds" value={id} label={label} defaultChecked={chosen.has(id)} />)}
          </div>
        </Field>
      )}
      <Field name="summary" label="Ce qu'il exige">
        <TextArea name="summary" defaultValue={r?.summary} rows={3} maxLength={1000} placeholder="Obligations concrètes pour l'entreprise." />
      </Field>
      <FormRow>
        <Field name="dueOn" label="Échéance" hint={r?.dueFromControl
          ? "Suivie par des contrôles : l'échéance affichée est celle du prochain contrôle rattaché ; cette date n'est pas utilisée."
          : "Date d'application ou de mise en conformité."}>
          <Input name="dueOn" type="date" defaultValue={r?.dueOn ?? ''} />
        </Field>
        <Field name="dueNote" label="Note d'échéance" hint="Ex. Permanent, audit de suivi.">
          <Input name="dueNote" defaultValue={r?.dueNote ?? ''} maxLength={60} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="evaluation" label="Évaluation">
          <Select name="evaluation" options={EVAL_OPTIONS} defaultValue={r?.evaluation ?? 'a_evaluer'} />
        </Field>
        <Field name="evaluationNote" label="Précision" hint="Affichée avec l'évaluation.">
          <Input name="evaluationNote" defaultValue={r?.evaluationNote ?? ''} placeholder="Ex. 2 interventions sans plan signé" maxLength={160} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="pilotId" label="Pilote" hint={pilots !== options.people ? "Pilote sorti de l'effectif : désignez un successeur." : undefined}>
          <Select name="pilotId" options={pilots} defaultValue={r?.pilotId ?? ''} placeholder="Non désigné" />
        </Field>
        <Field name="keystoneProjects" label="Surcharge du nombre de projets"
          hint={computed != null ? `Vide = calculé (${plural(computed, 'projet', 'projets')})` : 'Vide = calculé depuis Keystone (case ci-dessous).'}>
          <Input name="keystoneProjects" type="number" min={0} max={999} step={1} inputMode="numeric" defaultValue={r?.keystoneProjects ?? ''} />
        </Field>
      </FormRow>
      <div style={{ display: 'grid', gap: 4 }}>
        <Checkbox name="affectsProjects" label="Concerne les projets Keystone livrés après l'échéance" defaultChecked={r?.affectsProjects} />
        <span style={{ ...muted, paddingLeft: 24 }}>Projets dont la livraison planifiée suit la date d&apos;application ; une échéance datée est nécessaire.</span>
      </div>
      <Field name="impact" label="Impact" hint="Suite de la phrase du tableau de bord « Applicable au …, dans … jours : … ».">
        <TextArea name="impact" defaultValue={r?.impact ?? ''} rows={2} maxLength={300} placeholder="Ex. toute machine mise sur le marché après cette date doit y être conforme." style={{ minHeight: 56 }} />
      </Field>
      <div style={{ display: 'grid', gap: 4 }}>
        <Checkbox name="featured" label="Mettre en avant sur le tableau de bord" defaultChecked={r?.featured} />
        <span style={{ ...muted, paddingLeft: 24 }}>
          {r?.featured
            ? 'Exigence actuellement à la une.'
            : featured
              ? `Une seule exigence à la une : la cocher retire « ${featured.text} » du tableau de bord.`
              : 'Une seule exigence à la une ; une échéance datée est nécessaire.'}
        </span>
      </div>
    </ActionForm>
  );
}

function EvaluateForm({ r, today, initial, onDone, onCancel }: {
  r: RequirementView; today: string; initial?: EvalInitial; onDone: (evaluation: string) => void; onCancel: () => void;
}) {
  const [evaluation, setEvaluation] = useState(initial?.evaluation ?? r.evaluation);
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <ActionForm action={evaluateRequirement} hidden={{ id: r.id }} encType="multipart/form-data" onDone={() => onDone(evaluation)} onCancel={onCancel}
      submitLabel="Enregistrer l'évaluation" submitIcon="ph-seal-check">
      <div>
        <div className="vg-eyebrow" style={{ marginBottom: 4 }}>Ce qu&apos;il exige</div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{r.summary}</p>
      </div>
      {/* Pas de `name` : le libellé ne vise aucun champ unique, le groupe radio porte son propre aria-label. */}
      <Field label="Évaluation de conformité">
        <div role="radiogroup" aria-label="Évaluation de conformité" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {EVALS.map(([k, v]) => (
            <label key={k} className="seg-opt" style={{ fontSize: 12, padding: '5px 10px', border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)' }}>
              <input type="radio" name="evaluation" value={k} checked={evaluation === k} onChange={() => setEvaluation(k)} />
              <Dot color={TONE[v.tone].dot} />{v.label}
            </label>
          ))}
        </div>
      </Field>
      <Field name="evaluationNote" label="Précision" hint="Facultatif — constat, écart relevé, référence de la preuve.">
        <Input name="evaluationNote" defaultValue={initial ? initial.note ?? '' : r.evaluationNote ?? ''} maxLength={160} placeholder="Ex. VGP pont roulant dépassée" />
      </Field>
      <Field name="proof" label="Preuve (facultatif)" hint={FILES_HINT}>
        <Input name="proof" type="file" multiple accept={ATTACH_ACCEPT} onChange={(e) => setFileError(checkPickedFiles(e.currentTarget))} />
      </Field>
      <FileError error={fileError} />
      <span style={muted}>
        {`Évaluation datée du ${fmtDate(today)}${r.lastEvaluated ? ` · précédente le ${r.lastEvaluated}` : ''}, ajoutée à l'historique.`}
        {NEEDS_ACTION.has(evaluation) && !r.actionId ? " Un écart ou une analyse d'écart se suit par une action du plan d'actions unique." : ''}
      </span>
    </ActionForm>
  );
}
