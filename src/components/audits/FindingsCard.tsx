'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { NewActionButton } from '@/components/ActionFormDialog';
import { ChangeLogList } from '@/components/ChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ReasonButton } from '@/components/ReasonDialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { Aside, CardHead, ToneTag } from '@/components/ui';
import type { ActionDefaults, ActionFormOptions } from '@/lib/action-view';
import { fmtDate } from '@/lib/dates';
import { FINDING_KINDS, TONE } from '@/lib/domain';
import type { AuditGroup, CancelledFindingView, FindingView } from '@/lib/data/audits';
import type { Option } from '@/lib/data/options';
import { cancelFinding, convertFreeAudit, restoreFinding, saveFinding } from '@/server/audits';
import { ActionLink, ActionLinks, DialogFooter, RadioSeg, fileUrl } from './parts';
import { FINDING_KEYS, NEW_TRACK, OTHER_AUDIT, auditActionSource, isReviewPlanItem } from './shared';
import type { PlanFormOptions } from './ProgramTimeline';
import styles from './audits.module.css';

type Opts = ActionFormOptions;
type Editing = { id: number | null } | null;

const KIND_OPTIONS = FINDING_KEYS.map((k) => [k, FINDING_KINDS[k].label, TONE[FINDING_KINDS[k].tone].dot] as const);

/** Clé du groupe de constats : élément du programme, sinon libellé libre (même règle que readAudits). */
const groupKey = (planItemId: number | null, audit: string) => (planItemId != null ? `p${planItemId}` : `l${audit}`);

type Props = {
  groups: AuditGroup[];
  /** Constats annulés (filtre « Annulés »), les plus récents d'abord. */
  cancelled: CancelledFindingView[];
  /** Audits du programme proposés au rattachement (hors revues), le plus récent d'abord. */
  auditOptions: Option[];
  /** Saisie sur l'écran Audits (animateur QHSE, direction) ; consultation seule sinon (AUD-02). */
  canEdit: boolean;
  /** Service QHSE (canCreateAction) : « Créer l'action » d'un écart ou d'une piste de progrès (ACT-22). */
  canCreate?: boolean;
  /** Listes du formulaire d'action (vides sans création). */
  options: Opts;
  /** Constat à ouvrir d'emblée (lien profond `?constat=<id>`). */
  initialFindingId?: number;
  /** AUD-20 : listes du formulaire « Enregistrer comme audit hors programme » (constats à libellé libre). */
  planOptions?: PlanFormOptions;
  /** Lignes du programme proposées pour cet audit. */
  tracks?: string[];
  /** URL sans le lien profond, rétablie à la fermeture. */
  closeHref?: string;
  /** AUD-29 : nature de constat filtrée par l'URL (?nature=<clé de FINDING_KINDS>), validée par la page. */
  initialKind?: string;
};

/** AUD-29 : filtre de nature écrit dans l'URL sans aller-retour serveur (history.replaceState, convention UX-12). */
function replaceKind(kind: string) {
  const url = new URL(window.location.href);
  if (kind) url.searchParams.set('nature', kind);
  else url.searchParams.delete('nature');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/** Constats d'audit (le dernier audit par défaut), avec rattachement au plan d'actions unique. */
export function FindingsCard({ groups, cancelled, auditOptions, canEdit, canCreate = false, options, initialFindingId, closeHref, planOptions = { people: [], sites: [] }, tracks = [], initialKind = '' }: Props) {
  const router = useRouter();
  // Lien profond ?constat= : groupe du constat sélectionné et fenêtre ouverte (saisie), sinon constat surligné (animation CSS) ;
  // un constat annulé s'affiche dans le filtre « Annulés ».
  const linkGroup = initialFindingId != null ? groups.find((g) => g.findings.some((f) => f.id === initialFindingId)) : undefined;
  const linkCancelled = initialFindingId != null && !linkGroup && cancelled.some((f) => f.id === initialFindingId);
  const linkEdit: Editing = linkGroup && canEdit ? { id: initialFindingId! } : null;
  const linkFlash = (linkGroup && !canEdit) || linkCancelled ? initialFindingId : undefined;
  // Par défaut : le dernier audit qui porte des constats (un audit sans constat reste choisissable, AUD-29).
  const [selected, setSelected] = useState(linkGroup?.key ?? (groups.find((g) => g.findings.length) ?? groups[0])?.key ?? '');
  // Un lien profond vers un constat d'une autre nature retire le filtre (le constat visé reste visible).
  const linkKind = linkGroup?.findings.find((f) => f.id === initialFindingId)?.kind;
  const [kind, setKindState] = useState(FINDING_KEYS.includes(initialKind) && (!linkKind || linkKind === initialKind) ? initialKind : '');
  const setKind = (k: string) => { setKindState(k); replaceKind(k); };
  const ofKind = (list: FindingView[]) => (kind ? list.filter((f) => f.kind === kind) : list);
  const [showCancelled, setShowCancelled] = useState(linkCancelled);
  const [editing, setEditing] = useState<Editing>(linkEdit);
  const [deepLink, setDeepLink] = useState(initialFindingId != null);
  const [flashId, setFlashId] = useState(linkFlash);
  // Lien profond suivant reçu sans remonter la carte (pas de `key`) : la fermeture retire ?constat= de l'URL sans perdre
  // le groupe affiché.
  const [prevLink, setPrevLink] = useState(initialFindingId);
  if (initialFindingId !== prevLink) {
    setPrevLink(initialFindingId);
    if (initialFindingId != null) {
      if (linkGroup) setSelected(linkGroup.key);
      if (linkKind && kind && linkKind !== kind) setKindState('');
      setShowCancelled(linkCancelled);
      setEditing(linkEdit);
      setDeepLink(true);
      setFlashId(linkFlash);
    }
  }
  const scrollTo = linkGroup || linkCancelled ? initialFindingId : undefined;
  useEffect(() => {
    if (scrollTo != null) document.getElementById('constats')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [scrollTo]);

  const close = () => {
    setEditing(null);
    if (deepLink && closeHref) { setDeepLink(false); router.replace(closeHref, { scroll: false }); }
  };
  const group = groups.find((g) => g.key === selected) ?? groups[0];
  const finding = editing?.id != null ? groups.flatMap((g) => g.findings).find((f) => f.id === editing.id) : undefined;
  // Constat annulé depuis sa fenêtre : la fenêtre se ferme, sans basculer un instant sur « Nouveau constat ».
  const justCancelled = editing?.id != null && !finding && cancelled.some((f) => f.id === editing.id);
  const latest = !group || group.key === (groups.find((g) => g.findings.length) ?? groups[0])?.key;
  const shownFindings = group ? ofKind(group.findings) : [];
  const report = group?.reports.at(-1);
  const meta = group && [
    group.date && fmtDate(group.date),
    group.auditor,
    report && <a key="r" href={fileUrl(report.id)} target="_blank" rel="noopener" className="vg-link" title={report.fileName}>Rapport<span className="vg-sr-only">{` : ${report.fileName}`}</span></a>,
    group.unplanned && group.planItemId != null && <span key="u">Audit hors programme</span>,
    group.planItemId != null && (
      <Link key="p" href={`/audits?annee=${group.year}&element=${group.planItemId}`} scroll={false} className="vg-link">Voir au programme</Link>
    ),
    // AUD-20 : constats d'un audit à libellé libre (antérieurs) — enregistrer l'audit comme un vrai audit hors programme.
    group.planItemId == null && (canEdit
      ? <ConvertAuditButton key="c" label={group.label} tracks={tracks} options={planOptions} defaultOn={group.date} />
      : <span key="c">Audit à libellé libre</span>),
  ].filter(Boolean);

  return (
    <div id="constats" className="card" style={{ gap: 8, scrollMarginTop: 16 }}>
      <CardHead title={showCancelled ? 'Constats annulés' : latest ? 'Constats du dernier audit' : "Constats d'audit"}
        aside={!showCancelled && group && <Aside>{group.label}</Aside>} />
      {!showCancelled && meta && meta.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 6px', fontSize: 11.5, color: 'var(--color-neutral-500)', marginTop: -4 }}>
          {meta.map((m, i) => <span key={i} style={{ display: 'inline-flex', gap: 6 }}>{i > 0 && <span aria-hidden>·</span>}{m}</span>)}
        </div>
      )}
      {!showCancelled && groups.some((g) => g.findings.length) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--vg-text-muted)' }}>
            Nature
            <select className="input" style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Toutes</option>
              {FINDING_KEYS.map((k) => <option key={k} value={k}>{FINDING_KINDS[k].label}</option>)}
            </select>
          </label>
          {kind && (
            <button type="button" className="vg-chip is-on" onClick={() => setKind('')}>
              {FINDING_KINDS[kind].label}<i className="ph ph-x" style={{ fontSize: 11 }} aria-hidden /><span className="vg-sr-only"> : retirer ce filtre</span>
            </button>
          )}
        </div>
      )}
      {(groups.length > 1 || cancelled.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {!showCancelled && groups.length > 1 && groups.map((g) => {
            const n = ofKind(g.findings).length;
            return (
              <button key={g.key} type="button" className={`vg-chip${g.key === group?.key ? ' is-on' : ''}`} aria-pressed={g.key === group?.key} onClick={() => setSelected(g.key)}>
                {g.label}
                {g.findings.length === 0 ? <span style={{ color: 'var(--vg-text-muted)' }}>sans constat</span> : <span style={{ color: 'var(--color-neutral-500)' }}>{n}</span>}
              </button>
            );
          })}
          {cancelled.length > 0 && (
            <button type="button" className={`vg-chip${showCancelled ? ' is-on' : ''}`} aria-pressed={showCancelled} style={{ marginLeft: 'auto' }}
              onClick={() => setShowCancelled((v) => !v)}>
              <i className="ph ph-prohibit" style={{ fontSize: 12 }} aria-hidden />Annulés<span style={{ color: 'var(--color-neutral-500)' }}>{cancelled.length}</span>
            </button>
          )}
        </div>
      )}
      {showCancelled ? cancelled.map((f) => <CancelledRow key={f.id} finding={f} canEdit={canEdit} flash={f.id === flashId} />) : (
        <>
          {shownFindings.map((f) => (
            <FindingRow key={f.id} finding={f} canEdit={canEdit} canCreate={canCreate} options={options} flash={f.id === flashId} onEdit={() => setEditing({ id: f.id })} />
          ))}
          {!group && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: '4px 0' }}>Aucun constat enregistré.</div>}
          {group && group.findings.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: '4px 0' }}>Aucun constat enregistré pour cet audit.</div>}
          {group && group.findings.length > 0 && shownFindings.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-neutral-500)', padding: '4px 0' }}>Aucun constat de cette nature pour cet audit.</div>
          )}
        </>
      )}
      {canEdit && !showCancelled && (
        <button type="button" className="btn btn-secondary vg-btn-sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => setEditing({ id: null })}>
          <i className="ph ph-plus" style={{ fontSize: 13 }} aria-hidden />Ajouter un constat
        </button>
      )}

      <Dialog open={!!editing} onClose={close} kicker="Constats d'audit" title={finding ? 'Modifier le constat' : 'Nouveau constat'} width={560}>
        {editing && !justCancelled && (
          <>
            <FindingForm finding={finding} defaultPlanItemId={group ? group.planItemId : auditOptions.length ? +auditOptions[0][0] : null}
              defaultAudit={group && group.planItemId == null ? group.label : ''}
              audits={groups.filter((g) => g.planItemId == null).map((g) => g.label)} auditOptions={auditOptions}
              onDone={(key) => { setSelected(key); close(); }} onCancel={close} />
            {finding && (
              <DialogFooter>
                {finding.actions.length > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, color: 'var(--color-neutral-400)' }}>
                    {/* Élément de la source de ses actions : jamais détaché (D15) ; plusieurs actions par constat (AUD-28). */}
                    {finding.actions.length > 1 ? 'Actions liées' : 'Action liée'}
                    {finding.actions.map((a) => <ActionLink key={a.id} action={a.action} id={a.id} />)}
                  </span>
                )}
                <ReasonButton label="Annuler le constat" icon="ph-prohibit" className="btn btn-ghost vg-btn-sm"
                  style={{ color: 'var(--tone-danger-fg)', marginLeft: 'auto' }} title="Annuler le constat" kicker="Constats d'audit"
                  action={cancelFinding} hidden={{ id: finding.id }} submitLabel="Annuler le constat" submitIcon="ph-prohibit"
                  message={`Constat saisi par erreur ou en double : il n'est jamais supprimé. Il sort des constats, des échéances et du dossier de revue, et reste consultable avec le filtre « Annulés ».${finding.actions.length > 1 ? ` Les actions ${finding.actions.map((a) => a.id).join(', ')} restent dans le plan d'actions.` : finding.actions.length ? ` L'action ${finding.actions[0].id} reste dans le plan d'actions.` : ''}`}
                  placeholder="Ex. doublon du constat saisi le …" onDone={close} />
              </DialogFooter>
            )}
            {finding && <ChangeLogList entries={finding.log} />}
          </>
        )}
      </Dialog>
    </div>
  );
}

/** Constat annulé (filtre « Annulés ») : lecture seule, avec le motif et l'historique ; « Rétablir » motivé (AUD-25). */
function CancelledRow({ finding: f, canEdit, flash }: { finding: CancelledFindingView; canEdit: boolean; flash?: boolean }) {
  const k = FINDING_KINDS[f.kind] ?? { label: f.kind, tone: 'neutral' as const };
  return (
    <div className={`vg-rule-bottom${flash ? ` ${styles.flash}` : ''}`} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'start', padding: '6px 0' }}>
      <ToneTag tone="neutral" style={{ whiteSpace: 'nowrap' }}>{k.label}</ToneTag>
      <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>
          {f.clause && <span style={{ marginRight: 6 }}>{f.clause}</span>}{f.text}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>
          {f.groupLabel} · annulé le {fmtDate(f.cancelled.on)}{f.cancelled.by && ` par ${f.cancelled.by}`}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>Motif : {f.cancelled.reason}</span>
        {canEdit && (
          <ReasonButton label="Rétablir le constat" icon="ph-arrow-counter-clockwise" className="btn btn-ghost vg-btn-sm" style={{ justifySelf: 'start' }}
            title="Rétablir le constat" kicker="Constats d'audit" action={restoreFinding} hidden={{ id: f.id }} submitLabel="Rétablir le constat"
            submitIcon="ph-arrow-counter-clockwise" placeholder="Ex. annulé par erreur, le constat figure au rapport"
            message="Le constat revient dans les constats de son audit, ses échéances et le dossier des revues à venir ; un dossier de revue déjà figé ne change pas. L'annulation reste à l'historique." />
        )}
        <ChangeLogList entries={f.log} />
      </div>
      <div style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
        <ActionLinks actions={f.actions} compact />
      </div>
    </div>
  );
}

/**
 * Valeurs proposées pour l'action d'un constat (ACT-28) : source selon la ligne du programme (auditActionSource), constat
 * lié (un seul élément d'audit par action, D15 : jamais rattaché ni détaché ensuite), problème = texte du constat ; site
 * choisi par le service QHSE pour un constat commun à l'entreprise, sinon celui du constat (AUD-22).
 */
export function findingActionDefaults(f: Pick<FindingView, 'id' | 'kind' | 'audit' | 'clause' | 'text' | 'track' | 'siteId'>): ActionDefaults {
  const k = FINDING_KINDS[f.kind]?.label ?? f.kind;
  return {
    ...auditActionSource('finding', f.track), link: `finding:${f.id}`, linkLabel: `${k}${f.clause ? ` ${f.clause}` : ''} — ${f.audit}`,
    originRef: f.audit.slice(0, 120), problem: `${k} — ${f.audit}${f.clause ? ` (${f.clause})` : ''} : ${f.text}`,
    // AUD-22 : site du constat imposé à l'action (constat commun : le service QHSE choisit).
    ...(f.siteId ? { siteId: f.siteId } : {}),
  };
}

function FindingRow({ finding: f, canEdit, canCreate, options, flash, onEdit }: { finding: FindingView; canEdit: boolean; canCreate: boolean; options: Opts; flash?: boolean; onEdit: () => void }) {
  const k = FINDING_KINDS[f.kind] ?? { label: f.kind, tone: 'neutral' as const };
  const needsAction = f.kind !== 'point_fort';
  const text = (
    <>
      {f.clause && <span className="tag tag-outline" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', marginRight: 6, verticalAlign: '1px' }}>{f.clause}</span>}
      {f.text}
      {f.responseDueOn && !f.actions.length && (
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--tone-warn-fg)' }}>Réponse attendue le {fmtDate(f.responseDueOn)}</span>
      )}
    </>
  );
  return (
    <div className={`vg-rule-bottom${flash ? ` ${styles.flash}` : ''}`} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'start', padding: '6px 0' }}>
      <ToneTag tone={k.tone} style={{ whiteSpace: 'nowrap' }}>{k.label}</ToneTag>
      {canEdit ? (
        <button type="button" className={styles.textBtn} style={{ fontSize: 12.5, textWrap: 'pretty' }} title="Modifier le constat" onClick={onEdit}>{text}<span className="vg-sr-only"> : modifier le constat</span></button>
      ) : (
        <span style={{ fontSize: 12.5, textWrap: 'pretty' }}>{text}</span>
      )}
      <div style={{ fontSize: 12, whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        {f.actions.length > 0 && <ActionLinks actions={f.actions} compact />}
        {needsAction && canEdit && canCreate ? (
          // Pas de « Rattacher une action existante » : le constat est l'élément de la source, posé à la création (D15) ;
          // plusieurs actions par constat (AUD-28) : « Autre action » une fois la première créée.
          <NewActionButton options={options} label={f.actions.length ? 'Autre action' : "Créer l'action"} className="vg-text-btn" icon="ph-plus"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} defaults={findingActionDefaults(f)} />
        ) : !f.actions.length && (
          <span style={{ color: 'var(--vg-text-muted)' }}>—</span>
        )}
      </div>
    </div>
  );
}

/**
 * Saisie d'un constat, rattaché à un audit du programme ou à un audit hors programme (libellé libre).
 * Réutilisé par la fenêtre d'un élément du programme (audit présélectionné). `onDone` reçoit la clé du groupe.
 */
export function FindingForm({ finding, defaultPlanItemId, defaultAudit, audits, auditOptions, onDone, onCancel }: {
  finding?: FindingView; defaultPlanItemId: number | null; defaultAudit: string; audits: string[]; auditOptions: Option[];
  onDone: (key: string) => void; onCancel: () => void;
}) {
  const initialPlan = finding ? finding.planItemId : defaultPlanItemId;
  // L'audit d'un constat existant reste proposé, même s'il n'est plus dans la liste (AUD-11 : audits réalisés seulement).
  const options: Option[] = finding?.planItemId != null && !auditOptions.some(([v]) => v === String(finding.planItemId))
    ? [[String(finding.planItemId), finding.audit], ...auditOptions] : auditOptions;
  const known = initialPlan != null && options.some(([v]) => v === String(initialPlan));
  // AUD-20 : libellé d'audit libre pour un constat antérieur seulement ; un nouveau constat se rattache à un audit enregistré.
  const legacy = !!finding && finding.planItemId == null;
  const [choice, setChoice] = useState(known ? String(initialPlan) : legacy || !options.length ? OTHER_AUDIT : options[0][0]);
  const [audit, setAudit] = useState(finding?.audit ?? defaultAudit);
  const other = choice === OTHER_AUDIT;
  return (
    <ActionForm action={saveFinding} onDone={() => onDone(other ? groupKey(null, audit.trim()) : groupKey(+choice, ''))} onCancel={onCancel}
      submitLabel={finding ? 'Enregistrer' : 'Ajouter le constat'} hidden={{ id: finding?.id }}>
      <Field name="planItemId" label="Audit" hint={other && !legacy
        ? "Aucun audit réalisé : déclarez l'audit réalisé au programme, ou enregistrez un « Audit hors programme » (date, auditeur, rapport)."
        : other ? undefined : "Le libellé et la date par défaut viennent de l'élément du programme (audit hors programme compris)."}>
        <Select name="planItemId" value={choice} onChange={(e) => setChoice(e.target.value)}
          options={legacy ? [...options, [OTHER_AUDIT, 'Audit à libellé libre (antérieur)…'] as const] : options.length ? options : [[OTHER_AUDIT, 'Aucun audit réalisé'] as const]} />
      </Field>
      {other && legacy && (
        <>
          <Field name="audit" label="Audit hors programme" hint="Choisissez un audit existant ou saisissez-en un nouveau (ex. Audit client [Client A] · mars 2026).">
            <Input name="audit" list="vg-audit-labels" value={audit} onChange={(e) => setAudit(e.target.value)} />
          </Field>
          <datalist id="vg-audit-labels">
            {audits.map((a) => <option key={a} value={a} />)}
          </datalist>
        </>
      )}
      <FormRow>
        <Field name="clause" label="Exigence" hint="Ex. §8.2.3">
          <Input name="clause" defaultValue={finding?.clause ?? ''} maxLength={40} />
        </Field>
        <Field name="foundOn" label="Date du constat" hint={other ? undefined : "Par défaut, date de l'audit."}>
          <Input name="foundOn" type="date" defaultValue={finding?.foundOn ?? ''} />
        </Field>
      </FormRow>
      <Field name="kind" label="Type de constat">
        <RadioSeg name="kind" options={KIND_OPTIONS} defaultValue={finding?.kind ?? 'ecart_mineur'} />
      </Field>
      <Field name="text" label="Constat">
        <TextArea name="text" defaultValue={finding?.text} rows={3} autoFocus />
      </Field>
      {/* AUD-09 : délai de réponse fixé par l'organisme ou l'auditeur (écarts seulement). */}
      <Field name="responseDueOn" label="Réponse attendue le" hint="Écart majeur ou mineur : date limite de réponse (plan d'actions) fixée par l'organisme ou l'auditeur. Ignorée pour les autres constats.">
        <Input name="responseDueOn" type="date" defaultValue={finding?.responseDueOn ?? ''} />
      </Field>
    </ActionForm>
  );
}

/**
 * AUD-20 : enregistre un audit à libellé libre (constats antérieurs) comme un audit hors programme réalisé : ligne, date de
 * réalisation, auditeur, périmètre et site ; ses constats sans audit y sont rattachés (journal de chacun).
 */
function ConvertAuditButton({ label, tracks, options, defaultOn }: { label: string; tracks: string[]; options: PlanFormOptions; defaultOn: string | null }) {
  const lines = tracks.filter((tr) => !isReviewPlanItem({ track: tr, label: '', detail: null }));
  const [track, setTrack] = useState(lines[0] ?? NEW_TRACK);
  return (
    <DialogButton label="Enregistrer comme audit hors programme" className="vg-text-btn" title="Audit hors programme" kicker={label} width={560}>
      {(close) => (
        <ActionForm action={convertFreeAudit} hidden={{ audit: label }} submitLabel="Enregistrer l'audit" onCancel={close} onDone={close}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
            L&apos;audit « {label} » devient un audit hors programme réalisé ; ses constats y sont rattachés et prennent son site.
          </p>
          <FormRow>
            <Field name="track" label="Ligne du programme">
              <Select name="track" value={track} onChange={(e) => setTrack(e.target.value)} options={[...lines.map((t) => [t, t] as const), [NEW_TRACK, 'Nouvelle ligne…'] as const]} />
            </Field>
            <Field name="doneOn" label="Réalisé le">
              <Input name="doneOn" type="date" defaultValue={defaultOn ?? ''} />
            </Field>
          </FormRow>
          {track === NEW_TRACK && (
            <Field name="newTrack" label="Nom de la nouvelle ligne"><Input name="newTrack" maxLength={40} /></Field>
          )}
          <Field name="label" label="Libellé court" hint="Affiché dans la cellule du programme (30 caractères au maximum).">
            <Input name="label" defaultValue={label.slice(0, 30)} maxLength={30} />
          </Field>
          <FormRow>
            <Field name="auditorId" label="Auditeur interne">
              <Select name="auditorId" options={options.people} placeholder="Aucun" />
            </Field>
            <Field name="auditor" label="Auditeur externe"><Input name="auditor" maxLength={120} /></Field>
          </FormRow>
          <FormRow>
            <Field name="scope" label="Périmètre"><Input name="scope" maxLength={200} /></Field>
            <Field name="siteId" label="Site">
              <Select name="siteId" options={options.sites} defaultValue={options.sites[0]?.[0] ?? ''} />
            </Field>
          </FormRow>
        </ActionForm>
      )}
    </DialogButton>
  );
}
