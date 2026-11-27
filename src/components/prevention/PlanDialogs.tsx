'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { newEventHref } from '@/lib/event-prefill';
import { useRouter } from 'next/navigation';
import { LazyChangeLog } from '@/components/LazyChangeLog';
import { Dialog, DialogButton } from '@/components/Dialog';
import { ReasonForm } from '@/components/ReasonDialog';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { Icon, ToneTag } from '@/components/ui';
import { actionHref } from '@/lib/action-rules';
import { MAX_BATCH_BYTES, fileBatchError } from '@/lib/attachments';
import { fmtDate, fmtDayMonth } from '@/lib/dates';
import type { PlanFormView, PlanView } from '@/lib/data/prevention';
import type { PpFormData, PpImportFormat } from '@/lib/pp-form';
import { addPlanAttachments, cancelPlan, closePlan, deletePlan, recordPlanEeSignature, removePlanAttachment, savePlan, signPlanEu } from '@/server/prevention';
import {
  DANGEROUS_WORK_HINT, EE_HEADCOUNT, GAP_MEASURES_LABEL, GAP_MEASURES_MAX, MANDATORY_HOURS, MAX_PLAN_FILES, PERMIT_TYPES, PLAN_CONTENT, PLAN_CONTENT_GROUPS,
  lcfirst, ruleBasis, type PlanContentField, type PlanContentGroup,
} from '@/lib/rules/prevention';
import { TipButton } from '@/components/Tip';
import { PlanMeetings } from './PlanMeetings';
import { PlanWorkers } from './PlanWorkers';
import {
  ConfirmButton, ErrorLine, Facts, LinkedEvents, Notice, ProcedureNote, SITE_LOCK_HINT, SectionTitle, SignChip,
  contractorChoices, contractorHref, dropUrlParam, muted, rowOpener, ruleOf, useRun, type PreventionOptions,
} from './parts';
import { withCurrent } from '@/lib/form-options';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';
import { labelT } from '@/i18n/labels';

/** Pièces jointes acceptées sur un plan : PDF, images, Word. */
const PLAN_FILE_ACCEPT = 'application/pdf,image/*,.doc,.docx';
const MB = 1024 * 1024;

/**
 * Contrôle des fichiers choisis, avant l'envoi : au-delà de la limite des server actions (next.config), l'envoi
 * échouerait sans message. Vide le champ et renvoie le motif du refus, ou null.
 */
function checkPicked(input: HTMLInputElement, maxFiles: number): string | null {
  const picked = Array.from(input.files ?? []);
  const issue = fileBatchError(picked, { maxFiles });
  if (issue) input.value = '';
  return issue;
}

// ─── Formulaire ─────────────────────────────────────────────────────────────

/** Section de texte du contenu réglementaire (PRV-02) dans le formulaire du plan. */
function ContentField({ field, plan }: { field: PlanContentField; plan?: PlanView }) {
  const { t } = useI18n();
  const label = labelT(t);
  return (
    <Field name={field.key} label={<>{label(field.label)} <span style={muted}>{field.ref}</span></>} hint={label(field.hint)}>
      {field.max <= 200
        ? <Input name={field.key} defaultValue={plan?.[field.key] ?? ''} placeholder={label(field.placeholder)} />
        : <TextArea name={field.key} rows={2} defaultValue={plan?.[field.key] ?? ''} placeholder={label(field.placeholder)} />}
    </Field>
  );
}

/** En-tête d'un bloc du contenu réglementaire : « Mesures du plan · R. 4512-8 ». */
function ContentGroupTitle({ group, note }: { group: PlanContentGroup; note?: ReactNode }) {
  const g = PLAN_CONTENT_GROUPS[group];
  const { t } = useI18n();
  return (
    <div style={{ display: 'grid', gap: 2, paddingTop: 4, borderTop: '1px solid var(--color-divider)' }}>
      <span style={{ fontSize: 12.5, fontWeight: 500, paddingTop: 8 }}>{labelT(t)(g.label)} <span style={{ ...muted, fontWeight: 400 }}>· {g.ref}</span></span>
      {note && <span className="vg-field-hint" style={{ marginTop: 0 }}>{note}</span>}
    </div>
  );
}

const contentOf = (group: PlanContentGroup) => PLAN_CONTENT.filter((c) => c.group === group);

function PlanForm({ plan, options, onDone, onCancel }: { plan?: PlanView; options: PreventionOptions; onDone: (id?: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [hours, setHours] = useState(plan ? String(plan.estimatedHours) : '');
  const [start, setStart] = useState(plan?.startOn ?? '');
  const [dangerous, setDangerous] = useState(plan?.dangerousWork ?? false);
  const [siteId, setSiteId] = useState(plan?.siteId ?? options.defaultSiteId);
  const rule = ruleOf(options, siteId);
  // Site « dès la première minute » (établissement Seveso) : plan toujours obligatoire, heures et travaux dangereux pour information.
  const firstMinute = !!rule?.ppFromFirstMinute;
  const h = Number(hours.replace(/\s/g, '').replace(',', '.'));
  const overHours = hours.trim() !== '' && Number.isFinite(h) && h >= MANDATORY_HOURS;
  const legal = overHours || dangerous;
  const legalText = [overHours && fill(t('{hours} h ≥ {min} h over 12 months'), { hours: hours.trim(), min: MANDATORY_HOURS }), dangerous && t('dangerous work')].filter(Boolean).join(t(' and '));
  const signed = !!(plan?.signedEuOn || plan?.signedEeOn);
  // Intervention commencée : déplacer la date de début exige un motif (un écart R. 4512-6 ne s'efface pas sans trace).
  const startMoved = !!plan && plan.startOn <= options.today && start !== plan.startOn;
  // D02 : projet de la fiche absent de keystone.pub_projets (ou source indisponible) gardé comme choix.
  const projects = withCurrent(options.projects, plan?.keystoneProjectCode, plan?.keystoneProject, 'start');

  return (
    <ActionForm action={savePlan} onDone={(s) => onDone(s.id)} onCancel={onCancel} submitLabel={plan ? t('Save') : t('Create the plan')} hidden={{ id: plan?.id, version: plan?.version }}>
      {signed && (
        <Notice tone="warn" icon="ph-pen-nib">
          {t('Changing the company, the nature of the work, the location, the period, the hours, the measures or an already filled section of the regulatory content of a signed plan clears the signatures: the updated plan must be signed again.')}
          {' '}{t('Completing a section still empty keeps the signatures.')}
        </Notice>
      )}
      <FormRow>
        <Field name="contractorId" label={t('External company')} hint={options.contractors.length ? undefined : t('First add the company in the “External companies” tab.')}>
          <Select name="contractorId" options={contractorChoices(options, t, plan && { id: plan.contractorId, name: plan.contractor })} defaultValue={plan?.contractorId ?? ''} placeholder={t('Choose…')} autoFocus={!plan} />
        </Field>
        <Field name="siteId" label={t('Site')} hint={options.siteLocked ? t(SITE_LOCK_HINT) : undefined}>
          <Select name="siteId" options={options.recordSites} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
        </Field>
      </FormRow>
      <Field name="title" label={t('Nature of the work')}>
        <Input name="title" defaultValue={plan?.title} placeholder={t('E.g. Maintenance of the 10 t overhead crane: adjusting the limit switches')} />
      </Field>
      <Field name="location" label={t('Place of intervention')}>
        <Input name="location" defaultValue={plan?.location} placeholder={t('E.g. Assembly workshop · station M3')} />
      </Field>
      <FormRow cols={3}>
        <Field name="startOn" label={t('Start')}>
          <Input name="startOn" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field name="endOn" label={t('End')}>
          <Input name="endOn" type="date" defaultValue={plan?.endOn} />
        </Field>
        <Field name="estimatedHours" label={t('Hours over 12 months')} hint={firstMinute ? t('For information: plan required on this site.') : t('Estimated total for the external company.')}>
          <Input name="estimatedHours" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} placeholder={t('E.g. 120')} />
        </Field>
      </FormRow>
      {startMoved && (
        <Field name="reason" label={t('Reason for changing the start date')} hint={t('Intervention already started: the change is traced with its reason.')}>
          <TextArea name="reason" rows={2} placeholder={t('E.g. Start date entered by mistake: the intervention started on 06/10')} />
        </Field>
      )}
      <div style={{ display: 'grid', gap: 4 }}>
        <label className="vg-check">
          <input type="checkbox" name="dangerousWork" checked={dangerous} onChange={(e) => setDangerous(e.target.checked)} />
          <span className="vg-check-box"><i className="ph ph-check" aria-hidden /></span>
          <span>{t('Dangerous work (order of 19 March 1993)')}</span>
        </label>
        <span className="vg-field-hint" style={{ paddingLeft: 24, marginTop: 0 }}>{DANGEROUS_WORK_HINT}</span>
        {firstMinute && (
          <span className="vg-field-hint" style={{ paddingLeft: 24, marginTop: 0, display: 'flex', gap: 5, alignItems: 'baseline' }}>
            <Icon name="ph-info" size={12} />{t('Hours and dangerous work entered for information: on this site, the plan is required whatever the duration and nature of the work.')}
          </span>
        )}
      </div>
      <Notice tone={firstMinute || legal ? 'accent' : 'neutral'} icon={firstMinute ? 'ph-shield-warning' : legal ? 'ph-file-text' : 'ph-info'}>
        {firstMinute
          ? <>{t('Written prevention plan')} <strong style={{ fontWeight: 500 }}>{t('required')}</strong> {fill(t('from the first minute of the intervention ({basis}): prior joint inspection and signature of both companies before the work starts.'), { basis: lcfirst(ruleBasis(rule)) })}{' '}
            {legal ? fill(t('Legal threshold R. 4512-7 also reached ({reasons}).'), { reasons: legalText }) : fill(t('Outside the site rule, it would not be required (less than {min} h over 12 months, no dangerous work).'), { min: MANDATORY_HOURS })}</>
          : legal
            ? <>{t('Written prevention plan')} <strong style={{ fontWeight: 500 }}>{t('required')}</strong> {fill(t('({reasons}): prior joint inspection and signature of both companies before the work starts.'), { reasons: legalText })}</>
            : fill(t('Written plan not required (less than {min} h over 12 months, no dangerous work); the analysis of interference risks is still required (R. 4512-6).'), { min: MANDATORY_HOURS })}
      </Notice>
      <FormRow>
        <Field name="inspectionOn" label={t('Prior joint inspection')} hint={t('Joint visit of the premises, installations and equipment.')}>
          <Input name="inspectionOn" type="date" defaultValue={plan?.inspectionOn ?? ''} />
        </Field>
        <Field name="ownerId" label={t('Manager (host company)')}>
          <Select name="ownerId" options={options.people} defaultValue={plan?.ownerId ?? ''} placeholder={t('Choose…')} />
        </Field>
      </FormRow>
      <Field name="keystoneProjectCode" label={t('Keystone project')} hint={options.projectsMessage ?? (plan?.keystoneProject && !plan.keystoneProjectCode ? fill(t('Former label: {label}'), { label: plan.keystoneProject }) : undefined)}>
        <Select name="keystoneProjectCode" options={projects} defaultValue={plan?.keystoneProjectCode ?? ''} placeholder={t('No project')} />
      </Field>
      <Field name="interferenceRisks" label={t('Interference risks')} hint={t('Co-activity, traffic, energies, products, risk areas…')}>
        <TextArea name="interferenceRisks" rows={3} defaultValue={plan?.interferenceRisks ?? ''} />
      </Field>
      <ContentGroupTitle group="ee" note={t('Provided by the external company before the intervention; they do not block the signature.')} />
      <FormRow>
        <Field name="eeHeadcount" label={<>{EE_HEADCOUNT.label} <span style={muted}>{EE_HEADCOUNT.ref}</span></>} hint={t('Number of workers assigned to the intervention.')}>
          <Input name="eeHeadcount" inputMode="numeric" defaultValue={plan?.eeHeadcount ?? ''} placeholder={t('E.g. 3')} />
        </Field>
        <ContentField field={PLAN_CONTENT.find((c) => c.key === 'eeSupervisor')!} plan={plan} />
      </FormRow>
      <ContentField field={PLAN_CONTENT.find((c) => c.key === 'subcontracting')!} plan={plan} />
      <ContentGroupTitle group="measures"
        note={t('Required to sign a mandatory plan; enter “None” or “Not applicable” when a section does not apply.')} />
      <Field name="measures" label={t('Prevention measures')} hint={t('Split of the measures between the host company and the external company.')}>
        <TextArea name="measures" rows={3} defaultValue={plan?.measures ?? ''} />
      </Field>
      {contentOf('measures').map((c) => <ContentField key={c.key} field={c} plan={plan} />)}
      <ContentGroupTitle group="sir" note={t('Required to sign a mandatory plan.')} />
      {contentOf('sir').map((c) => <ContentField key={c.key} field={c} plan={plan} />)}
    </ActionForm>
  );
}

// ─── Fiche ──────────────────────────────────────────────────────────────────

/** Nom et qualité du signataire (PRV-07, R. 4512-7 : chef d'entreprise ou son représentant). */
function SignerFields({ prefix, defaultName }: { prefix: 'signedEu' | 'signedEe'; defaultName?: string }) {
  const { t } = useI18n();
  return (
    <FormRow>
      <Field name={`${prefix}Name`} label={t('Name of the signatory')}>
        <Input name={`${prefix}Name`} defaultValue={defaultName ?? ''} maxLength={120} autoComplete="off" />
      </Field>
      <Field name={`${prefix}Quality`} label={t('Capacity')} hint={t('Company head or their representative: position.')}>
        <Input name={`${prefix}Quality`} maxLength={120} placeholder={t('Site director, site manager…')} />
      </Field>
    </FormRow>
  );
}

function EuSignatureForm({ plan, today, onDone, onCancel }: { plan: PlanView; today: string; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <ActionForm action={signPlanEu} onDone={onDone} onCancel={onCancel} submitLabel={t('Save the signature')} hidden={{ id: plan.id }}>
      <Field name="signedEuOn" label={t('Signed for the host company on')}>
        <Input name="signedEuOn" type="date" defaultValue={today} max={today} min={plan.inspectionOn ?? undefined} />
      </Field>
      <SignerFields prefix="signedEu" defaultName={plan.owner ?? undefined} />
    </ActionForm>
  );
}

function EeSignatureForm({ plan, today, onDone, onCancel }: { plan: PlanView; today: string; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <ActionForm action={recordPlanEeSignature} onDone={onDone} onCancel={onCancel} submitLabel={t('Save the signature')} encType="multipart/form-data" hidden={{ id: plan.id }}>
      <SignerFields prefix="signedEe" />
      <FormRow>
        <Field name="signedEeOn" label={fill(t('Signed by {company} on'), { company: plan.contractor ?? '' })}>
          <Input name="signedEeOn" type="date" defaultValue={today} max={today} min={plan.inspectionOn ?? undefined} />
        </Field>
        <Field name="file" label={t('Signed copy')} hint={t('Optional: PDF or photo, 10 MB at most.')}>
          <Input name="file" type="file" accept="application/pdf,image/*" onChange={(e) => setFileError(checkPicked(e.currentTarget, 1))} />
        </Field>
      </FormRow>
      <ErrorLine error={fileError} />
    </ActionForm>
  );
}

function SignatureBox({ title, signedOn, signer, children }: { title: string; signedOn: string | null; signer?: { name: string; quality: string | null } | null; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="vg-inset" style={{ display: 'grid', gap: 8, padding: '10px 12px', alignContent: 'start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name={signedOn ? 'ph-seal-check' : 'ph-pen-nib'} size={16} style={{ color: signedOn ? 'var(--tone-ok-dot)' : 'var(--color-neutral-500)' }} />
        <span style={{ fontWeight: 500, fontSize: 12.5 }}>{title}</span>
      </div>
      <span style={{ fontSize: 12, color: signedOn ? 'var(--tone-ok-fg)' : 'var(--color-neutral-400)' }}>
        {signedOn ? `${fill(t('Signed on {date}'), { date: fmtDate(signedOn) })}${signer ? `${fill(t(' by {name}'), { name: signer.name })}${signer.quality ? ` (${signer.quality})` : ''}` : ''}` : t('Signature expected')}
      </span>
      {children}
    </div>
  );
}

const FORMAT_ICON: Record<PpImportFormat, string> = { pdf_form: 'ph-file-pdf', docx: 'ph-file-doc', scan: 'ph-scan' };

function FormItem({ item }: { item: PpFormData['sections'][number]['items'][number] }) {
  const box = item.checked;
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 12 }}>
      <Icon name={box === true ? 'ph-check-square' : box === false ? 'ph-square' : 'ph-text-align-left'} size={14}
        style={{ flex: 'none', marginTop: 1, color: box === true ? 'var(--tone-ok-dot)' : 'var(--color-neutral-600)' }} />
      <span style={{ minWidth: 0, color: box === false ? 'var(--color-neutral-500)' : 'var(--color-text)', textWrap: 'pretty' }}>
        {item.label}
        {item.value && <span style={{ display: 'block', color: box === false ? 'var(--color-neutral-500)' : 'var(--color-neutral-300)', whiteSpace: 'pre-line' }}>{item.value}</span>}
      </span>
    </div>
  );
}

/** Réponses du formulaire de plan de prévention importé (lecture seule). */
function ImportedForm({ form }: { form: PlanFormView }) {
  const { t } = useI18n();
  const boxes = form.sections.flatMap((s) => s.items).filter((i) => i.checked !== undefined);
  const checked = boxes.filter((i) => i.checked).length;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <SectionTitle aside={<span style={muted}>{form.formatLabel}{form.importedOn ? fill(t(' · imported on {date}'), { date: form.importedOn }) : ''}</span>}>{t('Imported form')}</SectionTitle>
      <div className="vg-inset" style={{ display: 'grid', gap: 10, padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
          <Icon name={FORMAT_ICON[form.format]} size={15} style={{ color: 'var(--color-neutral-400)' }} />
          {form.fileUrl
            ? <a href={form.fileUrl} target="_blank" rel="noreferrer" className="vg-link" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{form.fileName}</a>
            : <span style={{ wordBreak: 'break-all' }}>{form.fileName}</span>}
          {!form.fileUrl && <span style={muted}>{t('source file unavailable')}</span>}
          {boxes.length > 0 && <span style={{ ...muted, marginLeft: 'auto' }}>{fill(t('{checked}/{total} boxes ticked'), { checked, total: boxes.length })}</span>}
        </div>
        {form.sections.length === 0
          ? <span style={muted}>{t('No answer recorded.')}</span>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px 18px' }}>
              {form.sections.map((sec, i) => (
                <div key={`${i}-${sec.title}`} style={{ display: 'grid', gap: 5, alignContent: 'start' }}>
                  {sec.title && <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-neutral-500)' }}>{sec.title}</span>}
                  {sec.items.map((item, j) => <FormItem key={`${j}-${item.label}`} item={item} />)}
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

/** Pièces jointes du plan : consultation, ajout et retrait tant que le plan n'est ni clos ni annulé. */
function PlanAttachments({ plan, editable }: { plan: PlanView; editable: boolean }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const { pending, error, run } = useRun();
  const closeForm = () => { setAdding(false); setFileError(null); };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <SectionTitle aside={editable && !adding && (
        <button type="button" className="vg-text-btn" onClick={() => setAdding(true)}><Icon name="ph-paperclip" size={13} />{t('Attach a file')}</button>
      )}>{t('Attachments')}</SectionTitle>
      {plan.attachments.length === 0 && !adding && (
        <span style={muted}>{t('No attachment (signed copy, joint inspection report, amendment…).')}</span>
      )}
      {plan.attachments.length > 0 && (
        <div className="vg-thumbs">
          {plan.attachments.map((a) => (
            <div key={a.id} style={{ display: 'grid', gap: 3, justifyItems: 'center', alignContent: 'start' }}>
              <a href={a.url} target="_blank" rel="noreferrer" className="vg-thumb" title={a.name}>
                {a.isImage
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={a.url} alt={a.name} />
                  : <span style={{ display: 'grid', justifyItems: 'center', gap: 4, padding: 6, textAlign: 'center' }}><Icon name={a.icon} size={22} /><span style={{ fontSize: 11, wordBreak: 'break-all', lineHeight: 1.2 }}>{a.name.length > 28 ? `${a.name.slice(0, 26)}…` : a.name}</span></span>}
              </a>
              {editable && (
                <ConfirmButton label={t('Remove')} confirmLabel={t('Remove')} question={t('Remove?')} icon="ph-x" pending={pending} className="vg-text-btn"
                  onConfirm={() => run(() => removePlanAttachment(a.id))} />
              )}
            </div>
          ))}
        </div>
      )}
      <ErrorLine error={error} />
      {adding && (
        <div className="vg-inset" style={{ padding: '10px 12px' }}>
          <ActionForm action={addPlanAttachments} encType="multipart/form-data" hidden={{ id: plan.id }} submitLabel={t('Attach')} submitIcon="ph-paperclip"
            onDone={closeForm} onCancel={closeForm}>
            <Field name="files" label={t('Files')} hint={fill(t('PDF, image or Word · {n} files and {mb} MB at most per upload.'), { n: MAX_PLAN_FILES, mb: MAX_BATCH_BYTES / MB })}>
              <Input name="files" type="file" multiple accept={PLAN_FILE_ACCEPT} onChange={(e) => setFileError(checkPicked(e.currentTarget, MAX_PLAN_FILES))} />
            </Field>
            <ErrorLine error={fileError} />
          </ActionForm>
        </div>
      )}
    </div>
  );
}

const contentText = (value: string | number | null, empty: string) => (
  <span style={{ fontSize: 12.5, color: value != null && value !== '' ? 'var(--color-neutral-300)' : 'var(--color-neutral-500)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>
    {value != null && value !== '' ? value : empty}
  </span>
);

/** Contenu réglementaire du plan (PRV-02) : entreprise extérieure (R. 4511-10), mesures (R. 4512-8), suivi individuel renforcé (R. 4512-9). */
function PlanContentView({ plan }: { plan: PlanView }) {
  const { t } = useI18n();
  const section = (c: PlanContentField) => (
    <div key={c.key} style={{ display: 'grid', gap: 2, alignContent: 'start' }}>
      <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{c.label} · {c.ref}</span>
      {contentText(plan[c.key], t('Not entered'))}
    </div>
  );
  return (
    <>
      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle aside={<span style={muted}>{PLAN_CONTENT_GROUPS.ee.ref}</span>}>{labelT(t)(PLAN_CONTENT_GROUPS.ee.label)}</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <div style={{ display: 'grid', gap: 2, alignContent: 'start' }}>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{EE_HEADCOUNT.label}</span>
            {contentText(plan.eeHeadcount != null ? fill(plan.eeHeadcount > 1 ? t('{n} people') : t('{n} person'), { n: plan.eeHeadcount }) : null, t('Not entered'))}
          </div>
          {contentOf('ee').map(section)}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle aside={<span style={muted}>{PLAN_CONTENT_GROUPS.measures.ref}</span>}>{labelT(t)(PLAN_CONTENT_GROUPS.measures.label)}</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          {contentOf('measures').map(section)}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle aside={<span style={muted}>{PLAN_CONTENT_GROUPS.sir.ref}</span>}>{labelT(t)(PLAN_CONTENT_GROUPS.sir.label)}</SectionTitle>
        {contentOf('sir').map(section)}
      </div>
    </>
  );
}

function PlanSheet({ plan, options, canManage, onEdit, onCancelPlan, onDeleted }: {
  plan: PlanView; options: PreventionOptions; canManage: boolean; onEdit: () => void; onCancelPlan: () => void; onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [eeOpen, setEeOpen] = useState(false);
  const [euOpen, setEuOpen] = useState(false);
  const { pending, error, run } = useRun();
  const ended = plan.status === 'clos' || plan.status === 'annule';
  const editable = canManage && !ended;
  // Plan obligatoire non signé, intervention terminée : clôture possible, l'écart reste tracé par les indicateurs et le
  // journal du plan (aucune action QSE : actions immédiates, réponses du service QHSE du 15/10/2026).
  const unsignedAfterWork = plan.mandatory && !(plan.signedEuOn && plan.signedEeOn) && plan.startOn <= options.today;
  const signedLate = plan.startGap?.kind === 'signe_apres';
  // Même règle que planSignIssue (serveur) : inspection commune, mesures, puis contenu R. 4512-8 et R. 4512-9 d'un plan obligatoire.
  const signBlock = !plan.inspectionDone ? t('Prior joint inspection to carry out before any signature.')
    : !plan.measures.trim() ? t('Prevention measures to complete before any signature.')
      : plan.contentMissing.length ? fill(t('Regulatory content to complete before any signature: {list}.'), { list: plan.contentMissing.join(', ') }) : null;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <ToneTag tone={plan.tone}>{labelT(t)(plan.statusLabel)}</ToneTag>
        {plan.mandatory
          ? <span title={plan.mandatoryReason} style={{ display: 'inline-flex' }}><ToneTag tone="accent">{t('Written plan required')} · {plan.mandatoryShort}</ToneTag></span>
          : <span className="tag tag-neutral">{t('Written plan not required')}</span>}
        {plan.missingSignature && <ToneTag tone="danger">{t('Intervention in progress without a signed plan')}</ToneTag>}
        {plan.overdue && <ToneTag tone="warn">{t('Period over · to close')}</ToneTag>}
        {plan.startGap?.past && (
          <span title={t('Gap counted in the indicator “R. 4512-6 gaps over 12 months”')} style={{ display: 'inline-flex' }}>
            <ToneTag tone="warn">
              {t('R. 4512-6 gap')} · {plan.startGap.signedOn
                ? fill(t('signed on {date} after the start ({start})'), { date: fmtDayMonth(plan.startGap.signedOn), start: fmtDayMonth(plan.startOn) })
                : t('carried out without a signed plan')}
            </ToneTag>
          </span>
        )}
        <span className="tag tag-neutral" title={t('Sections filled: expected headcount, manager, subcontracting, R. 4512-8 1° to 5°, R. 4512-9')}>
          {fill(t('Content R. 4512-8/9: {filled}/{total}'), { filled: plan.contentStats.filled, total: plan.contentStats.total })}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {/* Lien HTML simple (navigation complète, nouvel onglet) : la feuille d'impression ne reste pas chargée dans l'application. */}
          <a href={`/prevention/imprimer/plan/${encodeURIComponent(plan.id)}`} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm">
            <Icon name="ph-printer" size={13} />{t('Print')}
          </a>
          {plan.status !== 'annule' && (
            <Link href={`/prevention/carte?plan=${encodeURIComponent(plan.id)}`} className="btn btn-ghost vg-btn-sm">
              <Icon name="ph-map-trifold" size={13} />{t('See on the map')}
            </Link>
          )}
        </span>
      </div>

      {plan.cancelled && (
        <Notice tone="neutral" icon="ph-prohibit">
          {fill(t('Plan cancelled on {date}'), { date: plan.cancelled.on })}{plan.cancelled.by ? fill(t(' by {name}'), { name: plan.cancelled.by }) : ''}{plan.cancelled.reason ? fill(t(': {reason}'), { reason: plan.cancelled.reason }) : '.'}
        </Notice>
      )}

      {plan.gapMeasures && (
        <Notice tone="neutral" icon="ph-first-aid-kit">{GAP_MEASURES_LABEL} : {plan.gapMeasures}</Notice>
      )}

      {plan.missingSignature && (
        <Notice tone="danger">
          {plan.legalMandatory && !plan.firstMinute ? t('French Labour Code R. 4512-7: the intervention') : fill(t('{reason}. The intervention'), { reason: plan.mandatoryReason ?? '' })} {fill(t('started on {date} although the mandatory written plan is not signed by both companies'), { date: fmtDate(plan.startOn) })}
          {plan.inspectionDone ? '.' : t(' and the prior joint inspection is not recorded.')}
        </Notice>
      )}

      <Facts items={[
        // PRV-14 : accès direct à la fiche de l'entreprise (onglet Entreprises extérieures).
        [t('External company'), <><Link href={contractorHref(plan.contractorId)} className="vg-link" style={{ fontSize: 12.5 }}>{plan.contractor}</Link><span style={{ display: 'block', ...muted }}>{plan.contractorTrade}</span></>],
        [t('Location'), plan.location],
        [t('Site'), plan.site],
        [t('Period'), plan.period],
        [t('Hours over 12 months'), `${plan.estimatedHours} h`],
        [t('Dangerous work'), plan.dangerousWork ? t('Yes') : t('No')],
        [t('Legal threshold R. 4512-7'), plan.legalMandatory ? fill(t('Reached ({reason})'), { reason: plan.legalReason ?? '' }) : plan.firstMinute ? t('Not reached · plan required by the site rule') : t('Not reached · plan required by the company rule')],
        [t('Joint inspection'), plan.inspectionOn ? fill(plan.inspectionDone ? t('Carried out on {date}') : t('Planned for {date}'), { date: fmtDate(plan.inspectionOn) }) : t('Not carried out')],
        [t('Owner'), plan.owner ?? '—'],
        [t('Keystone project'), plan.keystoneProject ?? '—'],
      ]} />

      <div style={{ display: 'grid', gap: 4 }}>
        <SectionTitle>{t('Nature of the work')}</SectionTitle>
        <span style={{ fontSize: 12.5 }}>{plan.title}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
          <SectionTitle>{t('Interference risks')}</SectionTitle>
          <span style={{ fontSize: 12.5, color: plan.interferenceRisks ? 'var(--color-neutral-300)' : 'var(--color-neutral-500)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{plan.interferenceRisks || t('Not entered#mplural')}</span>
        </div>
        <div style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
          <SectionTitle>{t('Prevention measures')}</SectionTitle>
          <span style={{ fontSize: 12.5, color: plan.measures ? 'var(--color-neutral-300)' : 'var(--color-neutral-500)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{plan.measures || t('Not entered#fplural')}</span>
        </div>
      </div>

      <PlanContentView plan={plan} />

      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle>{t('Signatures')}</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          <SignatureBox title={t('Host company')} signedOn={plan.signedEuOn} signer={plan.signedEu}>
            {editable && !plan.signedEuOn && !euOpen && (
              <button type="button" className="btn btn-primary vg-btn-sm" style={{ justifySelf: 'start' }} disabled={pending || !!signBlock}
                title={signBlock ?? undefined} onClick={() => setEuOpen(true)}>
                <Icon name="ph-pen-nib" size={13} />{t('Sign for the host company')}
              </button>
            )}
          </SignatureBox>
          <SignatureBox title={`${t('External company')} · ${plan.contractor}`} signedOn={plan.signedEeOn} signer={plan.signedEe}>
            {editable && !plan.signedEeOn && !eeOpen && (
              <button type="button" className="btn btn-secondary vg-btn-sm" style={{ justifySelf: 'start' }} disabled={!!signBlock}
                title={signBlock ?? undefined} onClick={() => setEeOpen(true)}>
                <Icon name="ph-signature" size={13} />{t('Record the external company’s signature')}
              </button>
            )}
          </SignatureBox>
        </div>
        {editable && signBlock && (!plan.signedEuOn || !plan.signedEeOn) && (
          <span style={{ ...muted, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
            {signBlock}
            <button type="button" className="vg-text-btn" onClick={onEdit}>{plan.inspectionDone ? t('Complete the plan') : t('Enter the joint inspection')}</button>
          </span>
        )}
        {euOpen && !plan.signedEuOn && (
          <div className="vg-inset" style={{ padding: '10px 12px' }}>
            <EuSignatureForm plan={plan} today={options.today} onDone={() => setEuOpen(false)} onCancel={() => setEuOpen(false)} />
          </div>
        )}
        {eeOpen && !plan.signedEeOn && (
          <div className="vg-inset" style={{ padding: '10px 12px' }}>
            <EeSignatureForm plan={plan} today={options.today} onDone={() => setEeOpen(false)} onCancel={() => setEeOpen(false)} />
          </div>
        )}
      </div>

      <PlanWorkers plan={plan} editable={editable} options={options} />

      <PlanMeetings plan={plan} editable={editable} today={options.today} />

      <PlanAttachments plan={plan} editable={editable} />

      {plan.form && <ImportedForm form={plan.form} />}

      {plan.permits.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          <SectionTitle>{t('Linked permits')}</SectionTitle>
          <div style={{ display: 'grid', gap: 4 }}>
            {plan.permits.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
                <Icon name={PERMIT_TYPES[p.type].icon} size={14} style={{ color: 'var(--color-neutral-400)' }} />
                <Link href={`/prevention?onglet=permis&permis=${encodeURIComponent(p.id)}`} className="vg-link" style={{ fontSize: 12.5 }}>{p.id}</Link>
                <span>{p.validity}</span>
                <ToneTag tone={p.tone}>{labelT(t)(p.stateLabel)}</ToneTag>
                {p.gap && <span style={{ fontSize: 11, color: 'var(--tone-danger-fg)' }}>{plan.missingSignature ? t('Gap · counted with this plan') : t('Gap · without a signed plan')}</span>}
                {!p.gap && p.requested && !(plan.signedEuOn && plan.signedEeOn) && (plan.mandatory || p.type === 'feu') && <span style={muted}>{t('Issue blocked until the signatures')}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions reprises seulement (consultation) : la Prévention ne crée plus d'action QSE (15/10/2026). */}
      {plan.actions.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          <SectionTitle>{t('Actions taken over from the action plan')}</SectionTitle>
          {plan.actions.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
              <Link href={actionHref(a.id)} className="vg-link" style={{ fontSize: 12.5 }}>{a.id}</Link>
              <span style={{ flex: 1, minWidth: 180 }}>{a.label}</span>
              <span style={muted}>{a.pilot} · {a.due}</span>
              <ToneTag tone={a.tone}>{labelT(t)(a.statusLabel)}</ToneTag>
            </div>
          ))}
        </div>
      )}

      <LinkedEvents events={plan.events} emptyLabel={t('No event linked to this plan.')}
        reportHref={canManage ? newEventHref('plan', plan.id) : null} />

      <LazyChangeLog entity="prevention_plan" id={plan.id} />

      <ErrorLine error={error} />
      {editable && (
        <div className="dialog-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onEdit}><Icon name="ph-pencil-simple" size={13} />{t('Edit')}</button>
          {plan.deletable
            ? <ConfirmButton label={t('Delete the draft')} confirmLabel={t('Delete')} icon="ph-trash" pending={pending}
              question={t('Delete this draft entered by mistake? Its attachments are deleted.')}
              onConfirm={() => run(() => deletePlan(plan.id), onDeleted)} />
            : <TipButton className="btn btn-secondary vg-btn-sm" disabled={!!plan.cancelBlock} tip={plan.cancelBlock} onClick={onCancelPlan}>
              <Icon name="ph-prohibit" size={13} />{t('Cancel the plan')}
            </TipButton>}
          {plan.startGap ? (
            // PRV-21 : clôture après un écart R. 4512-6 avec la trace des mesures immédiates prises.
            <GapCloseButton disabled={!!plan.closeBlock} tooltip={plan.closeBlock ?? undefined} pending={pending}
              question={unsignedAfterWork ? t('Plan not signed by both companies: the gap stays traced in the indicators and the plan’s history.')
                : signedLate ? t('Plan signed after the start of the intervention: the R. 4512-6 gap stays traced in the indicators and the plan’s history.') : t('R. 4512-6 gap found at the start.')}
              onClose={(measures) => run(() => closePlan(plan.id, measures))} />
          ) : (
            <ConfirmButton label={t('Close the plan')} confirmLabel={t('Close#verb')} icon="ph-archive" pending={pending}
              question={t('Close this plan for good?')}
              disabled={!!plan.closeBlock} tooltip={plan.closeBlock ?? undefined}
              onConfirm={() => run(() => closePlan(plan.id))} />
          )}
        </div>
      )}
      {options.procedure && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><ProcedureNote procedure={options.procedure} /></div>}
    </div>
  );
}

/**
 * Clôture d'un plan qui porte un écart R. 4512-6 (PRV-21) : les mesures immédiates prises sont décrites avant de clore
 * (champ exigé, contrôlé aussi par le serveur : gapMeasuresError).
 */
function GapCloseButton({ question, onClose, disabled, tooltip, pending }: {
  question: string; onClose: (measures: string) => void; disabled: boolean; tooltip?: string; pending: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [measures, setMeasures] = useState('');
  if (!open) {
    return (
      <TipButton className="btn btn-secondary vg-btn-sm" disabled={disabled || pending} tip={tooltip} onClick={() => setOpen(true)}>
        <Icon name="ph-archive" size={13} />{t('Close the plan')}
      </TipButton>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 6, width: '100%' }}>
      <span style={{ fontSize: 12, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>{question}</span>
      <label htmlFor="plan-gap-measures" style={{ fontSize: 12 }}>{GAP_MEASURES_LABEL}</label>
      <textarea id="plan-gap-measures" className="input" value={measures} maxLength={GAP_MEASURES_MAX} onChange={(e) => setMeasures(e.target.value)}
        placeholder={t('E.g. Work stopped, joint inspection done the same day, plan signed before resuming')} style={{ minHeight: 64 }} />
      <span style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost vg-btn-sm" onClick={() => setOpen(false)}>{t('Cancel')}</button>
        <button type="button" className="btn btn-primary vg-btn-sm" disabled={pending || !measures.trim()} onClick={() => onClose(measures)}>{t('Close#verb')}</button>
      </span>
    </div>
  );
}

type Mode = 'view' | 'edit' | 'cancel';

/** Fiche d'un plan de prévention (consultation, signatures, modification, annulation). */
export function PlanDialog({ plan, open, onClose, options, canManage }: { plan: PlanView | null; open: boolean; onClose: () => void; options: PreventionOptions; canManage: boolean }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('view');
  const back = () => setMode('view');
  const close = () => { setMode('view'); onClose(); };
  const kicker = mode === 'edit' ? fill(t('Edit the plan {id}'), { id: plan?.id ?? '' })
    : mode === 'cancel' ? fill(t('Cancel the plan {id}'), { id: plan?.id ?? '' }) : t('Prevention plan · R. 4512-6');
  return (
    <Dialog open={open && !!plan} onClose={close} width={760} kicker={kicker} title={plan ? `${plan.id} · ${plan.contractor}` : ''}>
      {plan && mode === 'edit' && <PlanForm plan={plan} options={options} onDone={back} onCancel={back} />}
      {plan && mode === 'cancel' && (
        <ReasonForm action={cancelPlan} hidden={{ id: plan.id }} submitLabel={t('Cancel the plan')} submitIcon="ph-prohibit" onDone={back} onCancel={back}
          placeholder={t('E.g. Intervention postponed to 2027: a new plan will be drawn up')}
          message={t('The plan stays readable with the reason for the cancellation; it no longer counts in the interventions or in the plans to sign.')} />
      )}
      {plan && mode === 'view' && (
        <PlanSheet plan={plan} options={options} canManage={canManage} onEdit={() => setMode('edit')}
          onCancelPlan={() => setMode('cancel')} onDeleted={close} />
      )}
    </Dialog>
  );
}

// ─── Boutons et tableau ─────────────────────────────────────────────────────

/** « Nouveau plan » : après création, la fiche du plan s'ouvre pour l'inspection et les signatures. */
export function NewPlanButton({ options }: { options: PreventionOptions }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <DialogButton label={t('New plan')} icon="ph-plus" className="btn btn-primary vg-btn-sm" title={t('New prevention plan')} kicker={t('French Labour Code R. 4512-6 to R. 4512-12')} width={720}>
      {(close) => (
        <PlanForm options={options} onCancel={close} onDone={(id) => {
          close();
          if (id) router.push(`/prevention?plan=${id}`, { scroll: false });
        }} />
      )}
    </DialogButton>
  );
}

/** Bouton de l'alerte « intervention sans plan signé » : ouvrir la fiche pour signer (aucune action QSE, 15/10/2026). */
export function PlanAlertActions({ plan, options }: { plan: PlanView; options: PreventionOptions }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 6, flex: 'none', flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setOpen(true)}><Icon name="ph-pen-nib" size={13} />{t('Sign')}</button>
      <PlanDialog plan={plan} open={open} onClose={() => setOpen(false)} options={options} canManage />
    </div>
  );
}

const inspectionCell = (p: PlanView, t: (s: string) => string) => {
  if (p.inspectionOn) return <span style={{ color: p.inspectionDone ? 'var(--color-neutral-300)' : 'var(--tone-warn-fg)' }}>{p.inspectionDone ? fmtDate(p.inspectionOn) : fill(t('Planned for {date}'), { date: fmtDate(p.inspectionOn) })}</span>;
  if (p.status === 'clos' || p.status === 'annule') return <span style={muted}>—</span>;
  return <span style={{ color: p.mandatory ? 'var(--tone-danger-fg)' : 'var(--color-neutral-500)' }}>{t('To carry out')}</span>;
};

/** Tableau des plans de prévention ; un clic ouvre la fiche. */
export function PlansTable({ plans, options, canManage, openId, emptyLabel }: { plans: PlanView[]; options: PreventionOptions; canManage: boolean; openId?: string; emptyLabel: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [selId, setSelId] = useState<string | null>(openId ?? null);
  const sel = plans.find((p) => p.id === selId) ?? null;
  const close = () => { setSelId(null); dropUrlParam((href, o) => router.replace(href, o), 'plan'); };

  return (
    <>
      <div className="card" style={{ padding: '6px 14px 10px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: 12.5, minWidth: 1240 }}>
            <thead>
              <tr>
                <th>{t('Ref.')}</th><th>{t('Company')}</th><th>{t('Work')}</th><th>{t('Location')}</th><th>{t('Period')}</th><th style={{ textAlign: 'right' }}>{t('Hours')}</th>
                <th>{t('Dangerous')}</th><th>{t('Written plan')}</th><th>{t('Joint inspection')}</th><th>{t('Signatures')}</th><th>{t('Status')}</th><th>{t('Keystone project')}</th>
              </tr>
            </thead>
            <tbody>
              {plans.length === 0 && <tr><td colSpan={12} style={{ ...muted, fontSize: 12, padding: '14px 8px' }}>{emptyLabel}</td></tr>}
              {plans.map((p) => (
                <tr key={p.id} {...rowOpener(() => setSelId(p.id))}>
                  <td style={{ color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{p.id}</td>
                  <td style={{ minWidth: 170 }}>
                    <span style={{ display: 'block' }}>{p.contractor}</span>
                    <span style={{ display: 'block', ...muted }}>{p.contractorTrade}</span>
                  </td>
                  <td style={{ minWidth: 220, maxWidth: 300, textWrap: 'pretty' }}>{p.title}</td>
                  <td style={{ color: 'var(--color-neutral-400)', minWidth: 150, maxWidth: 220, textWrap: 'pretty' }}>{p.location}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {p.period}
                    {p.inProgress && <span style={{ display: 'block', ...muted }}>{t('in progress')}</span>}
                    {p.overdue && <span style={{ display: 'block', fontSize: 11, color: 'var(--tone-warn-fg)' }}>{t('period over · to close')}</span>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: p.estimatedHours >= MANDATORY_HOURS ? 'var(--color-text)' : 'var(--color-neutral-300)' }}>{p.estimatedHours} h</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {p.dangerousWork ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--tone-warn-fg)' }}><Icon name="ph-warning" size={12} />{t('Yes')}</span> : <span style={muted}>{t('No')}</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }} title={p.mandatory ? fill(t('Required — {reason}'), { reason: p.mandatoryReason ?? '' }) : fill(t('Less than {min} h over 12 months, no dangerous work'), { min: MANDATORY_HOURS })}>
                    {p.mandatory ? t('Required') : <span style={muted}>{t('Not required')}</span>}
                    {p.firstMinute && <span style={{ display: 'block', ...muted }}>{t('from the 1st minute')}</span>}
                    {p.contentMissing.length > 0 && p.status !== 'clos' && p.status !== 'annule' && (
                      <span style={{ display: 'block', ...muted }} title={fill(t('To complete: {list}'), { list: p.contentMissing.join(', ') })}>{t('content incomplete')}</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{inspectionCell(p, t)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <SignChip label="EU" on={!!p.signedEuOn} title={p.signedEuOn ? fill(t('Host company · signed on {date}'), { date: fmtDate(p.signedEuOn) }) : t('Host company · signature expected')} />
                      <SignChip label="EE" on={!!p.signedEeOn} title={p.signedEeOn ? fill(t('External company · signed on {date}'), { date: fmtDate(p.signedEeOn) }) : t('External company · signature expected')} />
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <ToneTag tone={p.tone}>{labelT(t)(p.statusLabel)}</ToneTag>
                    {p.missingSignature && <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--tone-danger-fg)' }}>{t('Gap · without a signed plan')}</span>}
                    {p.startGap?.past && (
                      <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--tone-warn-fg)' }}>
                        {t('Past gap')} · {p.startGap.kind === 'signe_apres' ? t('signed after the start') : t('carried out without a signed plan#m')}
                      </span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--color-neutral-400)' }} title={p.keystoneProject ?? undefined}>
                    {p.keystoneProject ? p.keystoneProject : <span style={muted}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <PlanDialog plan={sel} open={!!sel} onClose={close} options={options} canManage={canManage} />
    </>
  );
}
