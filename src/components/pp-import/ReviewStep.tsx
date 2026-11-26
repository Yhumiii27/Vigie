'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { DANGEROUS_WORK_HINT, MANDATORY_HOURS, PLAN_STATUS, lcfirst, planStatus, ruleBasis } from '@/lib/rules/prevention';
import { Notice, SITE_LOCK_HINT, SectionTitle } from '@/components/prevention/parts';
import { Icon, ToneTag } from '@/components/ui';
import type { FormState } from '@/lib/forms';
import type { PpFormData, PpImportFormat } from '@/lib/pp-form';
import { NEW_CONTRACTOR, type PlanDraft } from '@/lib/pp-import/draft';
import { importName } from '@/lib/pp-import/files';
import { FORMAT_LABELS, type ImportScreenData } from '@/lib/pp-import/types';
import { createPlanFromImport } from '@/server/pp-import';
import { CheckMark, fileSize, muted, plural } from './parts';
import s from './pp-import.module.css';
import { useI18n } from '@/i18n/client';
import { fill } from '@/i18n/translate';

type Props = {
  data: ImportScreenData;
  draft: PlanDraft;
  sections: PpFormData['sections'];
  files: File[];
  format: PpImportFormat;
  templateId: number | null;
  templateName: string | null;
  onBack: () => void;
};

/** Étape 4 : plan prérempli à vérifier, aperçu de la grille conservée, création du plan avec le fichier source joint. */
export function ReviewStep({ data, draft, sections, files, format, templateId, templateName, onBack }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [contractorId, setContractorId] = useState(draft.contractorId);
  const [siteId, setSiteId] = useState(data.sites.some((x) => x.id === data.defaultSiteId) ? data.defaultSiteId : data.sites[0]?.id ?? '');
  const [hours, setHours] = useState(draft.estimatedHours);
  const [dangerous, setDangerous] = useState(draft.dangerousWork);
  const [inspectionOn, setInspectionOn] = useState(draft.inspectionOn);
  const [signedEuOn, setSignedEuOn] = useState(draft.signedEuOn);
  const [signedEeOn, setSignedEeOn] = useState(draft.signedEeOn);

  // Le fichier déposé à l'étape 1 (ou ses pages, INT-14) est renvoyé avec le formulaire : il devient la pièce jointe
  // source du plan, les pages suivantes sont jointes au plan.
  const action = async (prev: FormState, fd: FormData) => {
    fd.delete('file');
    files.forEach((f) => fd.append('file', f, f.name));
    return createPlanFromImport(prev, fd);
  };

  const h = Number(hours.replace(/\s/g, '').replace(',', '.'));
  const overHours = hours.trim() !== '' && Number.isFinite(h) && h >= MANDATORY_HOURS;
  const site = data.sites.find((x) => x.id === siteId);
  const firstMinute = !!site?.ppFromFirstMinute;
  const legalText = [overHours && fill(t('{hours} h ≥ {min} h over 12 months'), { hours: hours.trim(), min: MANDATORY_HOURS }), dangerous && t('dangerous work')].filter(Boolean).join(t(' and '));
  const status = planStatus({
    status: 'brouillon', startOn: '', endOn: '', estimatedHours: Number.isFinite(h) ? h : 0, dangerousWork: dangerous,
    inspectionOn: inspectionOn || null, signedEuOn: signedEuOn || null, signedEeOn: signedEeOn || null,
  }, data.today);

  const contractorOptions = [
    ...data.contractors.map((c) => [c.id, `${c.name} — ${c.trade}`] as const),
    [NEW_CONTRACTOR, draft.contractorName ? fill(t('Create the company “{name}”'), { name: draft.contractorName }) : t('New company…')] as const,
  ];
  const matchedContractor = data.contractors.find((c) => c.id === draft.contractorId);
  const contractorHint = !draft.contractorName ? t('No company name read in the form.')
    : fill(matchedContractor ? t('Read in the form: “{name}” — company recognised.') : t('Read in the form: “{name}” — no known company under this name.'), { name: draft.contractorName });
  const owner = data.people.some(([id]) => id === data.currentUserId) ? data.currentUserId : '';
  const boxes = sections.flatMap((x) => x.items).filter((i) => i.checked !== undefined);

  return (
    <div className="card" style={{ gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 2 }}>
          <span className="card-kicker">{t('Step 4 · Review')}</span>
          <span className="card-title" style={{ fontSize: 15 }}>{t('Prefilled prevention plan')}</span>
        </div>
        <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onBack}><Icon name="ph-arrow-left" size={13} />{t('Back')}</button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '2 1 520px', minWidth: 0 }}>
          <ActionForm action={action} submitLabel={t('Create the plan')} submitIcon="ph-check"
            hidden={{ format, templateId, sections: JSON.stringify(sections) }}
            onDone={(st) => { if (st.id) router.push(`/prevention?plan=${st.id}`); else router.push('/prevention'); }}>
            <SectionTitle>{t('External company')}</SectionTitle>
            <Field name="contractorId" label={t('External company')} hint={contractorHint}>
              <Select name="contractorId" options={contractorOptions} value={contractorId} onChange={(e) => setContractorId(e.target.value)} placeholder={t('Choose…')} />
            </Field>
            {contractorId === NEW_CONTRACTOR && (
              <>
                <FormRow>
                  <Field name="contractorName" label={t('Company name')}>
                    <Input name="contractorName" defaultValue={draft.contractorName} maxLength={120} />
                  </Field>
                  <Field name="contractorTrade" label={t('Trade')}>
                    <Input name="contractorTrade" defaultValue={draft.contractorTrade} maxLength={120} placeholder={t('E.g. Scaffolding erection')} />
                  </Field>
                </FormRow>
                <FormRow cols={3}>
                  <Field name="contactName" label={t('Contact')}>
                    <Input name="contactName" defaultValue={draft.contactName} maxLength={120} />
                  </Field>
                  <Field name="contactPhone" label={t('Phone')}>
                    <Input name="contactPhone" defaultValue={draft.contactPhone} maxLength={40} inputMode="tel" />
                  </Field>
                  <Field name="contactEmail" label={t('E-mail')}>
                    <Input name="contactEmail" defaultValue={draft.contactEmail} maxLength={160} inputMode="email" />
                  </Field>
                </FormRow>
              </>
            )}

            <SectionTitle>{t('Intervention')}</SectionTitle>
            <FormRow>
              <Field name="siteId" label={t('Site')} hint={data.siteLocked ? t(SITE_LOCK_HINT) : undefined}>
                <Select name="siteId" options={data.sites.map((x) => [x.id, x.label] as const)} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
              </Field>
              <Field name="ownerId" label={t('Manager (host company)')}>
                <Select name="ownerId" options={data.people} defaultValue={owner} placeholder={t('Choose…')} />
              </Field>
            </FormRow>
            <Field name="title" label={t('Nature of the work')}>
              <Input name="title" defaultValue={draft.title} maxLength={200} placeholder={t('E.g. Maintenance of the 10 t overhead crane: adjusting the limit switches')} />
            </Field>
            <Field name="location" label={t('Place of intervention')}>
              <Input name="location" defaultValue={draft.location} maxLength={160} placeholder={t('E.g. Assembly workshop · station M3')} />
            </Field>
            <FormRow cols={3}>
              <Field name="startOn" label={t('Start')} hint={draft.hints.startOn}>
                <Input name="startOn" type="date" defaultValue={draft.startOn} />
              </Field>
              <Field name="endOn" label={t('End')} hint={draft.hints.endOn}>
                <Input name="endOn" type="date" defaultValue={draft.endOn} />
              </Field>
              <Field name="estimatedHours" label={t('Hours over 12 months')} hint={draft.hints.estimatedHours ?? t('Estimated total for the external company.')}>
                <Input name="estimatedHours" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} placeholder={t('E.g. 120')} />
              </Field>
            </FormRow>
            <div style={{ display: 'grid', gap: 4 }}>
              <label className="vg-check">
                <input type="checkbox" name="dangerousWork" checked={dangerous} onChange={(e) => setDangerous(e.target.checked)} />
                <span className="vg-check-box"><i className="ph ph-check" aria-hidden /></span>
                <span>{t('Dangerous work (order of 19 March 1993)')}</span>
              </label>
              <span className="vg-field-hint" style={{ paddingLeft: 24, marginTop: 0 }}>{DANGEROUS_WORK_HINT}</span>
            </div>
            {firstMinute && site ? (
              // Fondement de la règle propre au site : Seveso seuil haut ou bas, ou règle interne.
              <Notice tone="accent" icon="ph-shield-check">
                {fill(t('{site}: written prevention plan'), { site: site.label })} <strong style={{ fontWeight: 500 }}>{t('required')}</strong> {fill(t('from the first minute of the intervention ({basis}).'), { basis: lcfirst(ruleBasis(site)) })}
                {legalText ? ` ${fill(t('Legal threshold R. 4512-7 also reached ({reasons}).'), { reasons: legalText })}` : ''}
              </Notice>
            ) : (
              <Notice tone={overHours || dangerous ? 'accent' : 'neutral'} icon={overHours || dangerous ? 'ph-file-text' : 'ph-info'}>
                {overHours || dangerous
                  ? <>{t('Written prevention plan')} <strong style={{ fontWeight: 500 }}>{t('required')}</strong> {fill(t('({reasons}): prior joint inspection and signature of both companies before the work starts.'), { reasons: legalText })}</>
                  : fill(t('Written plan not required (less than {min} h over 12 months, no dangerous work); the analysis of interference risks is still required (R. 4512-6).'), { min: MANDATORY_HOURS })}
              </Notice>
            )}
            <Field name="keystoneProjectCode" label={t('Keystone project')} hint={draft.hints.keystoneProject ?? data.projectsMessage ?? undefined}>
              <Select name="keystoneProjectCode" options={data.projects} defaultValue={draft.keystoneProject} placeholder={t('No project')} />
            </Field>

            <SectionTitle>{t('Joint inspection and risk analysis')}</SectionTitle>
            <Field name="inspectionOn" label={t('Prior joint inspection')} hint={draft.hints.inspectionOn ?? t('Joint visit of the premises, installations and equipment.')}>
              <Input name="inspectionOn" type="date" value={inspectionOn} onChange={(e) => setInspectionOn(e.target.value)} style={{ maxWidth: 220 }} />
            </Field>
            <Field name="interferenceRisks" label={t('Interference risks')} hint={t('Prefilled with the risks ticked in the form and the written details.')}>
              <TextArea name="interferenceRisks" rows={4} defaultValue={draft.interferenceRisks} maxLength={4000} />
            </Field>
            <Field name="measures" label={t('Prevention measures')} hint={t('Prefilled with the measures, emergency means and instructions ticked, and the written details.')}>
              <TextArea name="measures" rows={4} defaultValue={draft.measures} maxLength={4000} />
            </Field>

            <SectionTitle aside={<ToneTag tone={PLAN_STATUS[status].tone}>{fill(t('Status at creation: {status}'), { status: PLAN_STATUS[status].label })}</ToneTag>}>{t('Signatures')}</SectionTitle>
            <FormRow>
              <Field name="signedEuOn" label={t('Host company — signed on')} hint={draft.hints.signedEuOn}>
                <Input name="signedEuOn" type="date" value={signedEuOn} max={data.today} onChange={(e) => setSignedEuOn(e.target.value)} />
              </Field>
              <Field name="signedEeOn" label={t('External company — signed on')} hint={draft.hints.signedEeOn}>
                <Input name="signedEeOn" type="date" value={signedEeOn} max={data.today} onChange={(e) => setSignedEeOn(e.target.value)} />
              </Field>
            </FormRow>
            <span className="vg-field-hint" style={{ marginTop: -6 }}>
              {t('Dates read on the signed form. A signature assumes the prior joint inspection carried out and the prevention measures entered.')}
            </span>
          </ActionForm>
        </div>

        <aside className="vg-inset" style={{ flex: '1 1 280px', minWidth: 0, display: 'grid', gap: 10, padding: '12px 14px', alignContent: 'start' }}>
          <SectionTitle>{t('Source file')}</SectionTitle>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5 }}>
            <Icon name="ph-paperclip" size={15} style={{ color: 'var(--color-neutral-400)', marginTop: 1 }} />
            <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
              {importName(files.map((f) => f.name))}
              <span style={{ display: 'block', ...muted }}>
                {FORMAT_LABELS[format]} · {fileSize(files.reduce((n, f) => n + f.size, 0), t)}{templateName ? fill(t(' · template “{name}”'), { name: templateName }) : ''}{t(' — attached to the plan')}
              </span>
            </span>
          </div>
          <SectionTitle aside={boxes.length ? <span style={muted}>{fill(t('{checked}/{total} ticked'), { checked: boxes.filter((b) => b.checked).length, total: boxes.length })}</span> : undefined}>
            {t('Form grid kept')}
          </SectionTitle>
          {sections.length === 0 && <span style={{ ...muted, fontSize: 12 }}>{t('No grid line: only the plan’s fields are recorded.')}</span>}
          {sections.map((sec) => (
            <div key={sec.title} style={{ display: 'grid', gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{sec.title}</span>
              <ul className={s.previewList}>
                {sec.items.map((i, n) => (
                  <li key={`${i.label}-${n}`}>
                    {i.checked !== undefined
                      ? <CheckMark checked={i.checked} label={<span style={{ color: i.checked ? 'var(--color-text)' : 'var(--color-neutral-400)' }}>{i.label}{i.value && !/^(oui|non)$/i.test(i.value) ? ` : ${i.value}` : ''}</span>} />
                      : <span><Icon name="ph-text-aa" size={13} style={{ color: 'var(--color-neutral-500)', marginRight: 6, verticalAlign: '-2px' }} />{i.label} : <span style={{ color: 'var(--color-neutral-300)' }}>{i.value}</span></span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {sections.length > 0 && (
            <span style={muted}>
              {plural(sections.reduce((n, x) => n + x.items.length, 0), t('{n} line recorded with the plan (answers of the imported form).'), t('{n} lines recorded with the plan (answers of the imported form).'))}
            </span>
          )}
        </aside>
      </div>
    </div>
  );
}
