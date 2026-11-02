'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { NewActionButton } from '@/components/ActionFormDialog';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { useActionRunner } from '@/components/feedback';
import { ReasonButton } from '@/components/ReasonDialog';
import { ToneTag } from '@/components/ui';
import { Facts, Notice, muted, rowOpener } from '@/components/watch/parts';
import { actionHref } from '@/lib/action-rules';
import type { ActionFormOptions } from '@/lib/action-view';
import { fmtDate } from '@/lib/dates';
import { withCurrent, type Option } from '@/lib/form-options';
import type { StudyView } from '@/lib/data/process-safety';
import {
  FACILITATOR_EXTERNAL_MAX, REPORT_REF_MAX, STUDY_CONCLUSIONS, STUDY_CONCLUSION_KEYS, STUDY_MILESTONES, STUDY_MILESTONE_KEYS, STUDY_TYPES,
  typesOfMilestone, type StudyMilestone,
} from '@/lib/rules/process-safety';
import {
  cancelProcessSafetyStudy, liftStudyReserve, markStudyReserve, reopenProcessSafetyStudy, saveProcessSafetyStudy, validateProcessSafetyStudy,
} from '@/server/process-safety';

// Études de sécurité des procédés (VG-01 à VG-05, méthode DIG-PRODI) : vue ?vue=etudes de l'écran « Évaluation des risques »,
// fiche ?etude=<référence> (VG-04) avec ses recommandations (actions QSE). Lecture : rôles de l'écran sauf le Salarié ;
// saisie, validation, réouverture et annulation (motif), réserves bloquantes : animateur QHSE et direction.

type Opts = { sites: readonly Option[]; people: readonly Option[] };

const MILESTONE_OPTIONS = STUDY_MILESTONE_KEYS.map((m) => [m, `${STUDY_MILESTONES[m].label} — ${STUDY_MILESTONES[m].hint}`] as const);
const CONCLUSION_OPTIONS = STUDY_CONCLUSION_KEYS.map((c) => [c, STUDY_CONCLUSIONS[c].label] as const);
const STATUS_OPTIONS = [['planifiee', 'Planifiée'], ['realisee', 'Réalisée (séance tenue)']] as const;

export function ProcessSafetyPanel({ rows, cancelled, canManage, options, actionOptions, today, showSite, versions, defaultSite, initialId, closeHref }: {
  rows: StudyView[]; cancelled: StudyView[]; canManage: boolean; options: Opts; actionOptions: ActionFormOptions; today: string; showSite: boolean;
  versions: Record<string, string>; defaultSite: string; initialId?: string; closeHref: string;
}) {
  const router = useRouter();
  const [selId, setSelId] = useState<string | null>(initialId ?? null);
  const [showCancelled, setShowCancelled] = useState(initialId != null && cancelled.some((a) => a.id === initialId));
  const sel = [...rows, ...cancelled].find((r) => r.id === selId) ?? null;
  const close = () => {
    setSelId(null);
    if (initialId != null) router.replace(closeHref, { scroll: false });
  };
  const list = showCancelled ? cancelled : rows;
  return (
    <div className="card" style={{ gap: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="card-title" style={{ fontSize: 14 }}>Études de sécurité des procédés</span>
        <span style={{ ...muted, fontSize: 12 }}>Méthode DIG-PRODI — jalons HS 2, HS 3, HS 4, PSSR et HS 6 des CAPEX et projets</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {cancelled.length > 0 && (
            <button type="button" className={`vg-chip${showCancelled ? ' is-on' : ''}`} aria-pressed={showCancelled} onClick={() => setShowCancelled((v) => !v)}>
              <i className="ph ph-prohibit" style={{ fontSize: 12 }} aria-hidden />Annulées<span style={{ color: 'var(--color-neutral-500)' }}>{cancelled.length}</span>
            </button>
          )}
          {canManage && (
            <DialogButton label="Nouvelle étude" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouvelle étude de sécurité" kicker="Études de sécurité des procédés" width={680}>
              {(done) => <StudyForm options={options} defaultSite={defaultSite} today={today} onDone={done} onCancel={done} />}
            </DialogButton>
          )}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ fontSize: 12.5, minWidth: 760 }}>
          <thead><tr><th>Étude</th><th>CAPEX / projet</th><th>Jalon</th><th>Séance</th><th>Statut</th><th>Recommandations</th></tr></thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--color-neutral-500)', padding: '14px 8px' }}>
                {showCancelled ? 'Aucune étude annulée.' : 'Aucune étude de sécurité des procédés sur ce site.'}
              </td></tr>
            )}
            {list.map((r) => (
              <tr key={r.id} {...rowOpener(() => setSelId(r.id))} data-obsolete={r.cancelled ? true : undefined}>
                <td>
                  <span style={{ fontWeight: 500 }}>{r.id}</span> · {r.typeLabel}
                  {showSite && <div style={{ ...muted, marginTop: 2 }}>{r.siteLabel}</div>}
                </td>
                <td>{r.capexCode ?? '—'}{r.projectCode && <div style={{ ...muted, marginTop: 2 }}>Projet {r.projectCode}</div>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.milestoneLabel}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {fmtDate(r.sessionOn)}
                  {r.sessionOverdue && <div style={{ fontSize: 11.5, color: 'var(--tone-danger-fg)' }}>Séance passée</div>}
                </td>
                <td>
                  <ToneTag tone={r.statusTone}>{r.statusLabel}</ToneTag>
                  {r.conclusionLabel && <div style={{ ...muted, marginTop: 2 }}>{r.conclusionLabel}</div>}
                </td>
                <td><Counts r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!sel} onClose={close} width={760} kicker={sel ? `Étude de sécurité · ${sel.siteLabel}` : undefined} title={sel ? `${sel.id} · ${sel.typeLabel} ${sel.capexCode ?? sel.projectCode ?? ''}` : ''}>
        {sel && <StudyDetail key={sel.id} s={sel} canManage={canManage} options={options} actionOptions={actionOptions} today={today} version={versions[sel.id]} onClose={close} />}
      </Dialog>
    </div>
  );
}

/** Décomptes d'une étude : ouvertes / total, retards, réserves bloquantes ouvertes. */
function Counts({ r }: { r: StudyView }) {
  const c = r.counts;
  if (!c.total) return <span style={muted}>Aucune</span>;
  return (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span>{c.open} ouverte{c.open > 1 ? 's' : ''} / {c.total}</span>
      {c.late > 0 && <ToneTag tone="danger">{c.late} en retard</ToneTag>}
      {c.blocking > 0 && <ToneTag tone="warn">{c.blocking} bloquante{c.blocking > 1 ? 's' : ''}</ToneTag>}
    </span>
  );
}

function StudyDetail({ s, canManage, options, actionOptions, today, version, onClose }: {
  s: StudyView; canManage: boolean; options: Opts; actionOptions: ActionFormOptions; today: string; version?: string; onClose: () => void;
}) {
  const editable = canManage && !s.cancelled;
  const [view, setView] = useState<'fiche' | 'valider' | 'modifier'>('fiche');
  const [notice, setNotice] = useState<string | null>(null);
  const { pending, run } = useActionRunner();
  const markBlocking = (actionId: string) => {
    const fd = new FormData();
    fd.set('actionId', actionId);
    run(() => markStudyReserve({}, fd), { success: `Recommandation ${actionId} marquée réserve bloquante.` });
  };
  return (
    <>
      <Facts items={[
        ['Site', s.siteLabel],
        ['CAPEX', s.capexCode ?? '—'],
        !!s.projectCode && ['Projet EPC2i', s.projectCode],
        ['Jalon', `${s.milestoneLabel} — ${STUDY_MILESTONES[s.milestone].hint}`],
        ['Statut', <ToneTag key="s" tone={s.statusTone}>{s.statusLabel}</ToneTag>],
        ['Séance', `${fmtDate(s.sessionOn)}${s.sessionOverdue ? ' — passée, étude encore planifiée' : ''}`],
        !!s.validatedOn && ['Validée le', fmtDate(s.validatedOn)],
        !!s.conclusion && ['Conclusion', <ToneTag key="c" tone={STUDY_CONCLUSIONS[s.conclusion].tone}>{s.conclusionLabel}</ToneTag>],
        ['Animateur', s.facilitator || '—'],
        ['Rapport (Codex)', s.reportRef ?? '—'],
        s.status !== 'annulee' && ['Franchissement du jalon', s.clears ? 'Franchi par cette étude' : 'Non franchi par cette étude'],
      ]} />
      {s.cancelled && <Notice tone="warn" icon="ph-prohibit">Annulée le {fmtDate(s.cancelled.on)}{s.cancelled.by && ` par ${s.cancelled.by}`} — motif : {s.cancelled.reason}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {s.scope && (
        <div>
          <div className="vg-eyebrow" style={{ marginBottom: 4 }}>Périmètre et objet</div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{s.scope}</p>
        </div>
      )}

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="vg-eyebrow">Recommandations</div>
          <Counts r={s} />
          {editable && (
            <span style={{ marginLeft: 'auto' }}>
              <NewActionButton options={actionOptions} label="Nouvelle recommandation" className="btn btn-secondary vg-btn-sm"
                defaults={{ link: `safetystudy:${s.id}`, linkLabel: `${s.id} · ${s.typeLabel} ${s.capexCode ?? s.projectCode ?? ''}`, source: 'hazop', lockSource: true, siteId: s.siteId, domain: 'securite' }} />
            </span>
          )}
        </div>
        {s.recommendations.length === 0 && <span style={{ fontSize: 12, color: 'var(--vg-text-muted)' }}>Aucune recommandation suivie au plan d’actions.</span>}
        {s.recommendations.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12.5, minWidth: 560 }}>
              <thead><tr><th>Action</th><th>Recommandation</th><th>Responsable</th><th>Échéance</th><th>Avancement</th><th>Réserve</th></tr></thead>
              <tbody>
                {s.recommendations.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{a.readable ? <Link href={actionHref(a.id)} className="vg-link">{a.id}</Link> : a.id}</td>
                    <td>{a.readable ? a.label : <span style={muted}>Action d’un autre périmètre</span>}</td>
                    <td>{a.pilot || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{a.dueOn ? fmtDate(a.dueOn) : '—'}</td>
                    <td>{a.statusLabel ? <ToneTag tone={a.statusTone}>{a.statusLabel}</ToneTag> : '—'}</td>
                    <td>
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {a.blocking ? <ToneTag tone={a.closed ? 'neutral' : 'warn'}>{a.closed ? 'Bloquante (levée)' : 'Bloquante'}</ToneTag> : <span style={muted}>Non bloquante</span>}
                        {editable && !a.closed && (a.blocking ? (
                          <ReasonButton label="Lever" className="vg-text-btn" title="Lever la réserve bloquante" kicker={`${s.id} · ${a.id}`}
                            action={liftStudyReserve} hidden={{ actionId: a.id }} submitLabel="Lever la réserve"
                            message="La recommandation reste suivie au plan d'actions ; elle ne bloque plus le jalon de l'étude."
                            placeholder="Ex. mesure compensatoire validée par la SSE groupe" onDone={() => setNotice(`Réserve ${a.id} levée.`)} />
                        ) : (
                          <button type="button" className="vg-text-btn" disabled={pending} onClick={() => markBlocking(a.id)}>Rendre bloquante</button>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editable && view === 'fiche' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {s.storedStatus !== 'validee' && (
            <button type="button" className="btn btn-primary vg-btn-sm" onClick={() => setView('valider')}><i className="ph ph-seal-check" aria-hidden />Valider l’étude</button>
          )}
          <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setView('modifier')}><i className="ph ph-pencil-simple" aria-hidden />Modifier</button>
          {s.storedStatus === 'validee' && (
            <ReasonButton label="Rouvrir" icon="ph-arrow-counter-clockwise" title="Rouvrir l'étude" kicker={s.id} action={reopenProcessSafetyStudy} hidden={{ id: s.id }}
              submitLabel="Rouvrir" message="L'étude repasse « réalisée » ; sa conclusion et sa date de validation sont retirées (gardées à l'historique)."
              placeholder="Ex. conclusion à revoir après la revue du rapport" onDone={() => setNotice('Étude rouverte.')} />
          )}
          <ReasonButton label="Annuler l'étude" icon="ph-prohibit" title="Annuler l'étude" kicker={s.id} action={cancelProcessSafetyStudy} hidden={{ id: s.id }}
            submitLabel="Annuler l'étude" message="L'étude reste consultable avec son historique ; elle ne compte plus pour le jalon. Ses recommandations restent au plan d'actions."
            placeholder="Ex. saisie en double, CAPEX abandonné" onDone={onClose} />
        </div>
      )}
      {editable && view === 'valider' && (
        <ActionForm action={validateProcessSafetyStudy} hidden={{ id: s.id, version }} submitLabel="Valider l'étude"
          onDone={() => { setView('fiche'); setNotice('Étude validée.'); }} onCancel={() => setView('fiche')}>
          <FormRow>
            <Field name="validatedOn" label="Validée le">
              <Input name="validatedOn" type="date" defaultValue={today} min={s.sessionOn} max={today} />
            </Field>
            <Field name="conclusion" label="Conclusion">
              <Select name="conclusion" options={CONCLUSION_OPTIONS} defaultValue="" placeholder="Choisir…" />
            </Field>
          </FormRow>
          <Field name="reportRef" label="Rapport (référence Codex)" hint="Facultatif. Ex. NOT-CPX-APM-2026-01-002.">
            <Input name="reportRef" defaultValue={s.reportRef ?? ''} maxLength={REPORT_REF_MAX} />
          </Field>
        </ActionForm>
      )}
      {editable && view === 'modifier' && (
        <StudyForm s={s} options={options} defaultSite={s.siteId} today={today} version={version} onDone={() => { setView('fiche'); setNotice('Étude enregistrée.'); }} onCancel={() => setView('fiche')} />
      )}
      <LazyChangeLog entity="process_safety_study" id={s.id} title="Journal des modifications" />
    </>
  );
}

function StudyForm({ s, options, defaultSite, today, version, onDone, onCancel }: {
  s?: StudyView; options: Opts; defaultSite: string; today: string; version?: string; onDone: () => void; onCancel: () => void;
}) {
  const sites = s ? withCurrent(options.sites, s.siteId, s.siteLabel) : options.sites;
  const people = s ? withCurrent(options.people, s.facilitatorId, `${s.facilitator || s.facilitatorId} — sorti de l'effectif`) : options.people;
  const [milestone, setMilestone] = useState<StudyMilestone>(s?.milestone ?? 'HS2');
  const types = typesOfMilestone(milestone).map((k) => [k, STUDY_TYPES[k].label] as const);
  const validated = s?.storedStatus === 'validee';
  return (
    <ActionForm action={saveProcessSafetyStudy} hidden={{ id: s?.id, version: s ? version : undefined }}
      onDone={onDone} onCancel={onCancel} submitLabel={s ? 'Enregistrer' : 'Créer l’étude'}>
      <FormRow>
        <Field name="capexCode" label="Code CAPEX" hint="Ex. CPX-APM-2026-01 (Arche). Au moins le CAPEX ou le projet.">
          <Input name="capexCode" defaultValue={s?.capexCode ?? ''} maxLength={44} autoFocus={!s} />
        </Field>
        <Field name="keystoneProjectCode" label="Projet EPC2i" hint="Code du projet Keystone, facultatif.">
          <Input name="keystoneProjectCode" defaultValue={s?.projectCode ?? ''} maxLength={40} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="milestone" label="Jalon">
          <Select name="milestone" options={MILESTONE_OPTIONS} value={milestone} onChange={(e) => setMilestone(e.target.value as StudyMilestone)} />
        </Field>
        <Field name="type" label="Type d’étude">
          <Select key={milestone} name="type" options={types} defaultValue={s && s.milestone === milestone ? s.type : types[0]?.[0]} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="siteId" label="Site (usine)">
          <Select name="siteId" options={sites} defaultValue={s?.siteId ?? (sites.some(([v]) => v === defaultSite) ? defaultSite : sites[0]?.[0] ?? '')} />
        </Field>
        {validated ? (
          <Field name="status" label="Statut" hint="Validée : « Rouvrir » (motif) pour la modifier.">
            <output id="status" className="input vg-readonly" aria-live="off">Validée le {fmtDate(s!.validatedOn!)}</output>
          </Field>
        ) : (
          <Field name="status" label="Statut">
            <Select name="status" options={STATUS_OPTIONS} defaultValue={s?.storedStatus ?? 'planifiee'} />
          </Field>
        )}
      </FormRow>
      <FormRow>
        <Field name="sessionOn" label="Séance" hint="Date prévue (planifiée) ou tenue.">
          <Input name="sessionOn" type="date" defaultValue={s?.sessionOn ?? today} />
        </Field>
        <Field name="reportRef" label="Rapport (référence Codex)" hint="Facultatif.">
          <Input name="reportRef" defaultValue={s?.reportRef ?? ''} maxLength={REPORT_REF_MAX} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="facilitatorId" label="Animateur (effectif)" hint="Reçoit l’échéance d’une séance passée.">
          <Select name="facilitatorId" options={people} defaultValue={s?.facilitatorId ?? ''} placeholder="Non désigné" />
        </Field>
        <Field name="facilitatorExternal" label="ou animateur extérieur" hint="Bureau d’études, prestataire.">
          <Input name="facilitatorExternal" defaultValue={s?.facilitatorExternal ?? ''} maxLength={FACILITATOR_EXTERNAL_MAX} />
        </Field>
      </FormRow>
      <Field name="scope" label="Périmètre et objet" hint="Installations, nœuds étudiés, documents d’entrée.">
        <TextArea name="scope" rows={3} maxLength={2000} defaultValue={s?.scope ?? ''} />
      </Field>
    </ActionForm>
  );
}
