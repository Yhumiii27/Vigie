'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
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
  DANGEROUS_WORK_HINT, EE_HEADCOUNT, MANDATORY_HOURS, MAX_PLAN_FILES, PERMIT_TYPES, PLAN_CONTENT, PLAN_CONTENT_GROUPS,
  lcfirst, ruleBasis, type PlanContentField, type PlanContentGroup,
} from './model';
import { TipButton } from '@/components/Tip';
import {
  ConfirmButton, ErrorLine, Facts, LinkedEvents, Notice, ProcedureNote, SITE_LOCK_HINT, SectionTitle, SignChip,
  contractorChoices, dropUrlParam, muted, rowOpener, ruleOf, useRun, type PreventionOptions,
} from './parts';

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
  return (
    <Field name={field.key} label={<>{field.label} <span style={muted}>{field.ref}</span></>} hint={field.hint}>
      {field.max <= 200
        ? <Input name={field.key} defaultValue={plan?.[field.key] ?? ''} placeholder={field.placeholder} />
        : <TextArea name={field.key} rows={2} defaultValue={plan?.[field.key] ?? ''} placeholder={field.placeholder} />}
    </Field>
  );
}

/** En-tête d'un bloc du contenu réglementaire : « Mesures du plan · R. 4512-8 ». */
function ContentGroupTitle({ group, note }: { group: PlanContentGroup; note?: ReactNode }) {
  const g = PLAN_CONTENT_GROUPS[group];
  return (
    <div style={{ display: 'grid', gap: 2, paddingTop: 4, borderTop: '1px solid var(--color-divider)' }}>
      <span style={{ fontSize: 12.5, fontWeight: 500, paddingTop: 8 }}>{g.label} <span style={{ ...muted, fontWeight: 400 }}>· {g.ref}</span></span>
      {note && <span className="vg-field-hint" style={{ marginTop: 0 }}>{note}</span>}
    </div>
  );
}

const contentOf = (group: PlanContentGroup) => PLAN_CONTENT.filter((c) => c.group === group);

function PlanForm({ plan, options, onDone, onCancel }: { plan?: PlanView; options: PreventionOptions; onDone: (id?: string) => void; onCancel: () => void }) {
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
  const legalText = [overHours && `${hours.trim()} h ≥ ${MANDATORY_HOURS} h sur 12 mois`, dangerous && 'travaux dangereux'].filter(Boolean).join(' et ');
  const signed = !!(plan?.signedEuOn || plan?.signedEeOn);
  // Intervention commencée : déplacer la date de début exige un motif (un écart R. 4512-6 ne s'efface pas sans trace).
  const startMoved = !!plan && plan.startOn <= options.today && start !== plan.startOn;
  const projects = plan?.keystoneProject && !options.projects.some(([v]) => v === plan.keystoneProject)
    ? [[plan.keystoneProject, plan.keystoneProject] as const, ...options.projects]
    : options.projects;

  return (
    <ActionForm action={savePlan} onDone={(s) => onDone(s.id)} onCancel={onCancel} submitLabel={plan ? 'Enregistrer' : 'Créer le plan'} hidden={{ id: plan?.id, version: plan?.version }}>
      {signed && (
        <Notice tone="warn" icon="ph-pen-nib">
          Modifier l&apos;entreprise, la nature des travaux, le lieu, la période, les heures, les mesures ou une section déjà renseignée du contenu réglementaire d&apos;un plan signé efface les signatures : le plan mis à jour doit être signé à nouveau.
          Compléter une section encore vide conserve les signatures.
        </Notice>
      )}
      <FormRow>
        <Field name="contractorId" label="Entreprise extérieure" hint={options.contractors.length ? undefined : "Ajoutez d'abord l'entreprise dans l'onglet « Entreprises extérieures »."}>
          <Select name="contractorId" options={contractorChoices(options, plan && { id: plan.contractorId, name: plan.contractor })} defaultValue={plan?.contractorId ?? ''} placeholder="Choisir…" autoFocus={!plan} />
        </Field>
        <Field name="siteId" label="Site" hint={options.siteLocked ? SITE_LOCK_HINT : undefined}>
          <Select name="siteId" options={options.recordSites} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
        </Field>
      </FormRow>
      <Field name="title" label="Nature des travaux">
        <Input name="title" defaultValue={plan?.title} placeholder="Ex. Maintenance du pont roulant 10 t : réglage des fins de course" />
      </Field>
      <Field name="location" label="Lieu d'intervention">
        <Input name="location" defaultValue={plan?.location} placeholder="Ex. Atelier montage · poste M3" />
      </Field>
      <FormRow cols={3}>
        <Field name="startOn" label="Début">
          <Input name="startOn" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field name="endOn" label="Fin">
          <Input name="endOn" type="date" defaultValue={plan?.endOn} />
        </Field>
        <Field name="estimatedHours" label="Heures sur 12 mois" hint={firstMinute ? 'Pour information : plan obligatoire sur ce site.' : "Total estimé pour l'entreprise extérieure."}>
          <Input name="estimatedHours" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Ex. 120" />
        </Field>
      </FormRow>
      {startMoved && (
        <Field name="reason" label="Motif de la modification de la date de début" hint="Intervention déjà commencée : la modification est tracée avec son motif.">
          <TextArea name="reason" rows={2} placeholder="Ex. Date de début saisie par erreur : l'intervention a commencé le 06/10" />
        </Field>
      )}
      <div style={{ display: 'grid', gap: 4 }}>
        <label className="vg-check">
          <input type="checkbox" name="dangerousWork" checked={dangerous} onChange={(e) => setDangerous(e.target.checked)} />
          <span className="vg-check-box"><i className="ph ph-check" aria-hidden /></span>
          <span>Travaux dangereux (arrêté du 19 mars 1993)</span>
        </label>
        <span className="vg-field-hint" style={{ paddingLeft: 24, marginTop: 0 }}>{DANGEROUS_WORK_HINT}</span>
        {firstMinute && (
          <span className="vg-field-hint" style={{ paddingLeft: 24, marginTop: 0, display: 'flex', gap: 5, alignItems: 'baseline' }}>
            <Icon name="ph-info" size={12} />Heures et travaux dangereux renseignés pour information : sur ce site, le plan est obligatoire quelles que soient la durée et la nature des travaux.
          </span>
        )}
      </div>
      <Notice tone={firstMinute || legal ? 'accent' : 'neutral'} icon={firstMinute ? 'ph-shield-warning' : legal ? 'ph-file-text' : 'ph-info'}>
        {firstMinute
          ? <>Plan de prévention écrit <strong style={{ fontWeight: 500 }}>obligatoire</strong> dès la première minute d&apos;intervention ({lcfirst(ruleBasis(rule))}) : inspection commune préalable et signature des deux entreprises avant le début des travaux.{' '}
            {legal ? `Seuil légal R. 4512-7 également atteint (${legalText}).` : `Hors règle du site, il ne serait pas obligatoire (moins de ${MANDATORY_HOURS} h sur 12 mois, sans travaux dangereux).`}</>
          : legal
            ? <>Plan de prévention écrit <strong style={{ fontWeight: 500 }}>obligatoire</strong> ({legalText}) : inspection commune préalable et signature des deux entreprises avant le début des travaux.</>
            : <>Plan écrit non obligatoire (moins de {MANDATORY_HOURS} h sur 12 mois, sans travaux dangereux) ; l&apos;analyse des risques d&apos;interférence reste requise (R. 4512-6).</>}
      </Notice>
      <FormRow>
        <Field name="inspectionOn" label="Inspection commune préalable" hint="Visite conjointe des lieux, installations et matériels.">
          <Input name="inspectionOn" type="date" defaultValue={plan?.inspectionOn ?? ''} />
        </Field>
        <Field name="ownerId" label="Responsable (entreprise utilisatrice)">
          <Select name="ownerId" options={options.people} defaultValue={plan?.ownerId ?? ''} placeholder="Choisir…" />
        </Field>
      </FormRow>
      <Field name="keystoneProject" label="Projet Keystone">
        <Select name="keystoneProject" options={projects} defaultValue={plan?.keystoneProject ?? ''} placeholder="Aucun projet" />
      </Field>
      <Field name="interferenceRisks" label="Risques d'interférence" hint="Coactivité, circulation, énergies, produits, zones à risque…">
        <TextArea name="interferenceRisks" rows={3} defaultValue={plan?.interferenceRisks ?? ''} />
      </Field>
      <ContentGroupTitle group="ee" note="Communiquées par l'entreprise extérieure avant l'intervention ; elles ne bloquent pas la signature." />
      <FormRow>
        <Field name="eeHeadcount" label={<>{EE_HEADCOUNT.label} <span style={muted}>{EE_HEADCOUNT.ref}</span></>} hint="Nombre de travailleurs affectés à l'intervention.">
          <Input name="eeHeadcount" inputMode="numeric" defaultValue={plan?.eeHeadcount ?? ''} placeholder="Ex. 3" />
        </Field>
        <ContentField field={PLAN_CONTENT.find((c) => c.key === 'eeSupervisor')!} plan={plan} />
      </FormRow>
      <ContentField field={PLAN_CONTENT.find((c) => c.key === 'subcontracting')!} plan={plan} />
      <ContentGroupTitle group="measures"
        note={<>Exigées pour signer un plan obligatoire ; indiquez « Aucun » ou « Sans objet » quand une section ne s&apos;applique pas.</>} />
      <Field name="measures" label="Mesures de prévention" hint="Répartition des mesures entre l'entreprise utilisatrice et l'entreprise extérieure.">
        <TextArea name="measures" rows={3} defaultValue={plan?.measures ?? ''} />
      </Field>
      {contentOf('measures').map((c) => <ContentField key={c.key} field={c} plan={plan} />)}
      <ContentGroupTitle group="sir" note="Exigé pour signer un plan obligatoire." />
      {contentOf('sir').map((c) => <ContentField key={c.key} field={c} plan={plan} />)}
    </ActionForm>
  );
}

// ─── Fiche ──────────────────────────────────────────────────────────────────

/** Nom et qualité du signataire (PRV-07, R. 4512-7 : chef d'entreprise ou son représentant). */
function SignerFields({ prefix, defaultName }: { prefix: 'signedEu' | 'signedEe'; defaultName?: string }) {
  return (
    <FormRow>
      <Field name={`${prefix}Name`} label="Nom du signataire">
        <Input name={`${prefix}Name`} defaultValue={defaultName ?? ''} maxLength={120} autoComplete="off" />
      </Field>
      <Field name={`${prefix}Quality`} label="Qualité" hint="Chef d'entreprise ou son représentant : fonction.">
        <Input name={`${prefix}Quality`} maxLength={120} placeholder="Directeur de site, chef de chantier…" />
      </Field>
    </FormRow>
  );
}

function EuSignatureForm({ plan, today, onDone, onCancel }: { plan: PlanView; today: string; onDone: () => void; onCancel: () => void }) {
  return (
    <ActionForm action={signPlanEu} onDone={onDone} onCancel={onCancel} submitLabel="Enregistrer la signature" hidden={{ id: plan.id }}>
      <Field name="signedEuOn" label="Signé pour l'entreprise utilisatrice le">
        <Input name="signedEuOn" type="date" defaultValue={today} max={today} min={plan.inspectionOn ?? undefined} />
      </Field>
      <SignerFields prefix="signedEu" defaultName={plan.owner ?? undefined} />
    </ActionForm>
  );
}

function EeSignatureForm({ plan, today, onDone, onCancel }: { plan: PlanView; today: string; onDone: () => void; onCancel: () => void }) {
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <ActionForm action={recordPlanEeSignature} onDone={onDone} onCancel={onCancel} submitLabel="Enregistrer la signature" encType="multipart/form-data" hidden={{ id: plan.id }}>
      <SignerFields prefix="signedEe" />
      <FormRow>
        <Field name="signedEeOn" label={`Signé par ${plan.contractor} le`}>
          <Input name="signedEeOn" type="date" defaultValue={today} max={today} min={plan.inspectionOn ?? undefined} />
        </Field>
        <Field name="file" label="Exemplaire signé" hint="Facultatif : PDF ou photo, 10 Mo au maximum.">
          <Input name="file" type="file" accept="application/pdf,image/*" onChange={(e) => setFileError(checkPicked(e.currentTarget, 1))} />
        </Field>
      </FormRow>
      <ErrorLine error={fileError} />
    </ActionForm>
  );
}

function SignatureBox({ title, signedOn, signer, children }: { title: string; signedOn: string | null; signer?: { name: string; quality: string | null } | null; children?: ReactNode }) {
  return (
    <div className="vg-inset" style={{ display: 'grid', gap: 8, padding: '10px 12px', alignContent: 'start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name={signedOn ? 'ph-seal-check' : 'ph-pen-nib'} size={16} style={{ color: signedOn ? 'var(--tone-ok-dot)' : 'var(--color-neutral-500)' }} />
        <span style={{ fontWeight: 500, fontSize: 12.5 }}>{title}</span>
      </div>
      <span style={{ fontSize: 12, color: signedOn ? 'var(--tone-ok-fg)' : 'var(--color-neutral-400)' }}>
        {signedOn ? `Signé le ${fmtDate(signedOn)}${signer ? ` par ${signer.name}${signer.quality ? ` (${signer.quality})` : ''}` : ''}` : 'Signature attendue'}
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
  const boxes = form.sections.flatMap((s) => s.items).filter((i) => i.checked !== undefined);
  const checked = boxes.filter((i) => i.checked).length;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <SectionTitle aside={<span style={muted}>{form.formatLabel}{form.importedOn ? ` · importé le ${form.importedOn}` : ''}</span>}>Formulaire importé</SectionTitle>
      <div className="vg-inset" style={{ display: 'grid', gap: 10, padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
          <Icon name={FORMAT_ICON[form.format]} size={15} style={{ color: 'var(--color-neutral-400)' }} />
          {form.fileUrl
            ? <a href={form.fileUrl} target="_blank" rel="noreferrer" className="vg-link" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{form.fileName}</a>
            : <span style={{ wordBreak: 'break-all' }}>{form.fileName}</span>}
          {!form.fileUrl && <span style={muted}>fichier source indisponible</span>}
          {boxes.length > 0 && <span style={{ ...muted, marginLeft: 'auto' }}>{checked}/{boxes.length} cases cochées</span>}
        </div>
        {form.sections.length === 0
          ? <span style={muted}>Aucune réponse enregistrée.</span>
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
  const [adding, setAdding] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const { pending, error, run } = useRun();
  const closeForm = () => { setAdding(false); setFileError(null); };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <SectionTitle aside={editable && !adding && (
        <button type="button" className="vg-text-btn" onClick={() => setAdding(true)}><Icon name="ph-paperclip" size={13} />Joindre un fichier</button>
      )}>Pièces jointes</SectionTitle>
      {plan.attachments.length === 0 && !adding && (
        <span style={muted}>Aucune pièce jointe (exemplaire signé, compte rendu d&apos;inspection commune, avenant…).</span>
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
                <ConfirmButton label="Retirer" confirmLabel="Retirer" question="Retirer ?" icon="ph-x" pending={pending} className="vg-text-btn"
                  onConfirm={() => run(() => removePlanAttachment(a.id))} />
              )}
            </div>
          ))}
        </div>
      )}
      <ErrorLine error={error} />
      {adding && (
        <div className="vg-inset" style={{ padding: '10px 12px' }}>
          <ActionForm action={addPlanAttachments} encType="multipart/form-data" hidden={{ id: plan.id }} submitLabel="Joindre" submitIcon="ph-paperclip"
            onDone={closeForm} onCancel={closeForm}>
            <Field name="files" label="Fichiers" hint={`PDF, image ou Word · ${MAX_PLAN_FILES} fichiers et ${MAX_BATCH_BYTES / MB} Mo au maximum par envoi.`}>
              <Input name="files" type="file" multiple accept={PLAN_FILE_ACCEPT} onChange={(e) => setFileError(checkPicked(e.currentTarget, MAX_PLAN_FILES))} />
            </Field>
            <ErrorLine error={fileError} />
          </ActionForm>
        </div>
      )}
    </div>
  );
}

const contentText = (value: string | number | null, empty = 'Non renseigné') => (
  <span style={{ fontSize: 12.5, color: value != null && value !== '' ? 'var(--color-neutral-300)' : 'var(--color-neutral-500)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>
    {value != null && value !== '' ? value : empty}
  </span>
);

/** Contenu réglementaire du plan (PRV-02) : entreprise extérieure (R. 4511-10), mesures (R. 4512-8), suivi individuel renforcé (R. 4512-9). */
function PlanContentView({ plan }: { plan: PlanView }) {
  const section = (c: PlanContentField) => (
    <div key={c.key} style={{ display: 'grid', gap: 2, alignContent: 'start' }}>
      <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{c.label} · {c.ref}</span>
      {contentText(plan[c.key])}
    </div>
  );
  return (
    <>
      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle aside={<span style={muted}>{PLAN_CONTENT_GROUPS.ee.ref}</span>}>{PLAN_CONTENT_GROUPS.ee.label}</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <div style={{ display: 'grid', gap: 2, alignContent: 'start' }}>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{EE_HEADCOUNT.label}</span>
            {contentText(plan.eeHeadcount != null ? `${plan.eeHeadcount} ${plan.eeHeadcount > 1 ? 'personnes' : 'personne'}` : null)}
          </div>
          {contentOf('ee').map(section)}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle aside={<span style={muted}>{PLAN_CONTENT_GROUPS.measures.ref}</span>}>{PLAN_CONTENT_GROUPS.measures.label}</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          {contentOf('measures').map(section)}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle aside={<span style={muted}>{PLAN_CONTENT_GROUPS.sir.ref}</span>}>{PLAN_CONTENT_GROUPS.sir.label}</SectionTitle>
        {contentOf('sir').map(section)}
      </div>
    </>
  );
}

function PlanSheet({ plan, options, canManage, onEdit, onCancelPlan, onDeleted }: {
  plan: PlanView; options: PreventionOptions; canManage: boolean; onEdit: () => void; onCancelPlan: () => void; onDeleted: () => void;
}) {
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
  const signBlock = !plan.inspectionDone ? "Inspection commune préalable à réaliser avant toute signature."
    : !plan.measures.trim() ? 'Mesures de prévention à compléter avant toute signature.'
      : plan.contentMissing.length ? `Contenu réglementaire à compléter avant toute signature : ${plan.contentMissing.join(', ')}.` : null;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <ToneTag tone={plan.tone}>{plan.statusLabel}</ToneTag>
        {plan.mandatory
          ? <span title={plan.mandatoryReason} style={{ display: 'inline-flex' }}><ToneTag tone="accent">Plan écrit obligatoire · {plan.mandatoryShort}</ToneTag></span>
          : <span className="tag tag-neutral">Plan écrit non obligatoire</span>}
        {plan.missingSignature && <ToneTag tone="danger">Intervention en cours sans plan signé</ToneTag>}
        {plan.overdue && <ToneTag tone="warn">Période échue · à clore</ToneTag>}
        {plan.startGap?.past && (
          <span title="Écart compté dans l'indicateur « Écarts R. 4512-6 sur 12 mois »" style={{ display: 'inline-flex' }}>
            <ToneTag tone="warn">
              Écart R. 4512-6 · {plan.startGap.signedOn
                ? `signé le ${fmtDayMonth(plan.startGap.signedOn)} après le début (${fmtDayMonth(plan.startOn)})`
                : 'réalisée sans plan signé'}
            </ToneTag>
          </span>
        )}
        <span className="tag tag-neutral" title="Sections renseignées : effectif prévisible, responsable, sous-traitance, R. 4512-8 1° à 5°, R. 4512-9">
          Contenu R. 4512-8/9 : {plan.contentStats.filled}/{plan.contentStats.total}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {/* Lien HTML simple (navigation complète, nouvel onglet) : la feuille d'impression ne reste pas chargée dans l'application. */}
          <a href={`/prevention/imprimer/plan/${encodeURIComponent(plan.id)}`} target="_blank" rel="noreferrer" className="btn btn-ghost vg-btn-sm">
            <Icon name="ph-printer" size={13} />Imprimer
          </a>
          {plan.status !== 'annule' && (
            <Link href={`/prevention/carte?plan=${encodeURIComponent(plan.id)}`} className="btn btn-ghost vg-btn-sm">
              <Icon name="ph-map-trifold" size={13} />Voir sur la carte
            </Link>
          )}
        </span>
      </div>

      {plan.cancelled && (
        <Notice tone="neutral" icon="ph-prohibit">
          Plan annulé le {plan.cancelled.on}{plan.cancelled.by ? ` par ${plan.cancelled.by}` : ''}{plan.cancelled.reason ? ` : ${plan.cancelled.reason}` : '.'}
        </Notice>
      )}

      {plan.missingSignature && (
        <Notice tone="danger">
          {plan.firstMinute ? `${plan.mandatoryReason}. L'intervention` : "Code du travail R. 4512-7 : l'intervention"} a commencé le {fmtDate(plan.startOn)} alors que le plan écrit obligatoire n&apos;est pas signé par les deux entreprises
          {plan.inspectionDone ? '.' : ' et que l\'inspection commune préalable n\'est pas enregistrée.'}
        </Notice>
      )}

      <Facts items={[
        ['Entreprise extérieure', <>{plan.contractor}<span style={{ display: 'block', ...muted }}>{plan.contractorTrade}</span></>],
        ['Lieu', plan.location],
        ['Site', plan.site],
        ['Période', plan.period],
        ['Heures sur 12 mois', `${plan.estimatedHours} h`],
        ['Travaux dangereux', plan.dangerousWork ? 'Oui' : 'Non'],
        plan.firstMinute ? ['Seuil légal R. 4512-7', plan.legalMandatory ? `Atteint (${plan.legalReason})` : 'Non atteint · plan exigé par la règle du site'] : null,
        ['Inspection commune', plan.inspectionOn ? `${plan.inspectionDone ? 'Réalisée le' : 'Prévue le'} ${fmtDate(plan.inspectionOn)}` : 'Non réalisée'],
        ['Responsable', plan.owner ?? '—'],
        ['Projet Keystone', plan.keystoneProject ?? '—'],
      ]} />

      <div style={{ display: 'grid', gap: 4 }}>
        <SectionTitle>Nature des travaux</SectionTitle>
        <span style={{ fontSize: 12.5 }}>{plan.title}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <div style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
          <SectionTitle>Risques d&apos;interférence</SectionTitle>
          <span style={{ fontSize: 12.5, color: plan.interferenceRisks ? 'var(--color-neutral-300)' : 'var(--color-neutral-500)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{plan.interferenceRisks || 'Non renseignés.'}</span>
        </div>
        <div style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
          <SectionTitle>Mesures de prévention</SectionTitle>
          <span style={{ fontSize: 12.5, color: plan.measures ? 'var(--color-neutral-300)' : 'var(--color-neutral-500)', whiteSpace: 'pre-line', textWrap: 'pretty' }}>{plan.measures || 'Non renseignées.'}</span>
        </div>
      </div>

      <PlanContentView plan={plan} />

      <div style={{ display: 'grid', gap: 6 }}>
        <SectionTitle>Signatures</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          <SignatureBox title="Entreprise utilisatrice" signedOn={plan.signedEuOn} signer={plan.signedEu}>
            {editable && !plan.signedEuOn && !euOpen && (
              <button type="button" className="btn btn-primary vg-btn-sm" style={{ justifySelf: 'start' }} disabled={pending || !!signBlock}
                title={signBlock ?? undefined} onClick={() => setEuOpen(true)}>
                <Icon name="ph-pen-nib" size={13} />Signer pour l&apos;entreprise utilisatrice
              </button>
            )}
          </SignatureBox>
          <SignatureBox title={`Entreprise extérieure · ${plan.contractor}`} signedOn={plan.signedEeOn} signer={plan.signedEe}>
            {editable && !plan.signedEeOn && !eeOpen && (
              <button type="button" className="btn btn-secondary vg-btn-sm" style={{ justifySelf: 'start' }} disabled={!!signBlock}
                title={signBlock ?? undefined} onClick={() => setEeOpen(true)}>
                <Icon name="ph-signature" size={13} />Enregistrer la signature de l&apos;entreprise extérieure
              </button>
            )}
          </SignatureBox>
        </div>
        {editable && signBlock && (!plan.signedEuOn || !plan.signedEeOn) && (
          <span style={{ ...muted, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
            {signBlock}
            <button type="button" className="vg-text-btn" onClick={onEdit}>{plan.inspectionDone ? 'Compléter le plan' : "Renseigner l'inspection commune"}</button>
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

      <PlanAttachments plan={plan} editable={editable} />

      {plan.form && <ImportedForm form={plan.form} />}

      {plan.permits.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          <SectionTitle>Permis rattachés</SectionTitle>
          <div style={{ display: 'grid', gap: 4 }}>
            {plan.permits.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
                <Icon name={PERMIT_TYPES[p.type].icon} size={14} style={{ color: 'var(--color-neutral-400)' }} />
                <Link href={`/prevention?onglet=permis&permis=${encodeURIComponent(p.id)}`} className="vg-link" style={{ fontSize: 12.5 }}>{p.id}</Link>
                <span>{p.validity}</span>
                <ToneTag tone={p.tone}>{p.stateLabel}</ToneTag>
                {p.gap && <span style={{ fontSize: 11, color: 'var(--tone-danger-fg)' }}>{plan.missingSignature ? 'Écart · compté avec ce plan' : 'Écart · sans plan signé'}</span>}
                {!p.gap && p.requested && !(plan.signedEuOn && plan.signedEeOn) && (plan.mandatory || p.type === 'feu') && <span style={muted}>Délivrance bloquée jusqu&apos;aux signatures</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions reprises seulement (consultation) : la Prévention ne crée plus d'action QSE (15/10/2026). */}
      {plan.actions.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          <SectionTitle>Actions reprises du plan d&apos;actions</SectionTitle>
          {plan.actions.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
              <Link href={actionHref(a.id)} className="vg-link" style={{ fontSize: 12.5 }}>{a.id}</Link>
              <span style={{ flex: 1, minWidth: 180 }}>{a.label}</span>
              <span style={muted}>{a.pilot} · {a.due}</span>
              <ToneTag tone={a.tone}>{a.statusLabel}</ToneTag>
            </div>
          ))}
        </div>
      )}

      <LinkedEvents events={plan.events} emptyLabel="Aucun événement rattaché à ce plan."
        reportHref={canManage ? `/evenements?nouveau=1&plan=${encodeURIComponent(plan.id)}` : null} />

      <LazyChangeLog entity="prevention_plan" id={plan.id} />

      <ErrorLine error={error} />
      {editable && (
        <div className="dialog-actions" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onEdit}><Icon name="ph-pencil-simple" size={13} />Modifier</button>
          {plan.deletable
            ? <ConfirmButton label="Supprimer le brouillon" confirmLabel="Supprimer" icon="ph-trash" pending={pending}
              question="Supprimer ce brouillon saisi par erreur ? Ses pièces jointes sont supprimées."
              onConfirm={() => run(() => deletePlan(plan.id), onDeleted)} />
            : <TipButton className="btn btn-secondary vg-btn-sm" disabled={!!plan.cancelBlock} tip={plan.cancelBlock} onClick={onCancelPlan}>
              <Icon name="ph-prohibit" size={13} />Annuler le plan
            </TipButton>}
          <ConfirmButton label="Clore le plan" confirmLabel="Clore" icon="ph-archive" pending={pending}
            question={unsignedAfterWork ? "Clore ce plan non signé par les deux entreprises ? L'écart reste tracé dans les indicateurs et l'historique du plan."
              : signedLate ? "Clore ce plan signé après le début de l'intervention ? L'écart R. 4512-6 reste tracé dans les indicateurs et l'historique du plan."
                : 'Clore définitivement ce plan ?'}
            disabled={!!plan.closeBlock} tooltip={plan.closeBlock ?? undefined}
            onConfirm={() => run(() => closePlan(plan.id))} />
        </div>
      )}
      {options.procedure && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><ProcedureNote procedure={options.procedure} /></div>}
    </div>
  );
}

type Mode = 'view' | 'edit' | 'cancel';

/** Fiche d'un plan de prévention (consultation, signatures, modification, annulation). */
export function PlanDialog({ plan, open, onClose, options, canManage }: { plan: PlanView | null; open: boolean; onClose: () => void; options: PreventionOptions; canManage: boolean }) {
  const [mode, setMode] = useState<Mode>('view');
  const back = () => setMode('view');
  const close = () => { setMode('view'); onClose(); };
  const kicker = mode === 'edit' ? `Modifier le plan ${plan?.id ?? ''}`
    : mode === 'cancel' ? `Annuler le plan ${plan?.id ?? ''}` : 'Plan de prévention · R. 4512-6';
  return (
    <Dialog open={open && !!plan} onClose={close} width={760} kicker={kicker} title={plan ? `${plan.id} · ${plan.contractor}` : ''}>
      {plan && mode === 'edit' && <PlanForm plan={plan} options={options} onDone={back} onCancel={back} />}
      {plan && mode === 'cancel' && (
        <ReasonForm action={cancelPlan} hidden={{ id: plan.id }} submitLabel="Annuler le plan" submitIcon="ph-prohibit" onDone={back} onCancel={back}
          placeholder="Ex. Intervention reportée à 2027 : un nouveau plan sera établi"
          message={<>Le plan reste consultable avec le motif de l&apos;annulation ; il ne compte plus dans les interventions ni dans les plans à signer.</>} />
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
  const router = useRouter();
  return (
    <DialogButton label="Nouveau plan" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouveau plan de prévention" kicker="Code du travail R. 4512-6 à R. 4512-12" width={720}>
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
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 6, flex: 'none', flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-secondary vg-btn-sm" onClick={() => setOpen(true)}><Icon name="ph-pen-nib" size={13} />Signer</button>
      <PlanDialog plan={plan} open={open} onClose={() => setOpen(false)} options={options} canManage />
    </div>
  );
}

const inspectionCell = (p: PlanView) => {
  if (p.inspectionOn) return <span style={{ color: p.inspectionDone ? 'var(--color-neutral-300)' : 'var(--tone-warn-fg)' }}>{p.inspectionDone ? fmtDate(p.inspectionOn) : `Prévue le ${fmtDate(p.inspectionOn)}`}</span>;
  if (p.status === 'clos' || p.status === 'annule') return <span style={muted}>—</span>;
  return <span style={{ color: p.mandatory ? 'var(--tone-danger-fg)' : 'var(--color-neutral-500)' }}>À réaliser</span>;
};

/** Tableau des plans de prévention ; un clic ouvre la fiche. */
export function PlansTable({ plans, options, canManage, openId, emptyLabel }: { plans: PlanView[]; options: PreventionOptions; canManage: boolean; openId?: string; emptyLabel: string }) {
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
                <th>Réf.</th><th>Entreprise</th><th>Travaux</th><th>Lieu</th><th>Période</th><th style={{ textAlign: 'right' }}>Heures</th>
                <th>Dangereux</th><th>Plan écrit</th><th>Inspection commune</th><th>Signatures</th><th>Statut</th><th>Projet Keystone</th>
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
                    {p.inProgress && <span style={{ display: 'block', ...muted }}>en cours</span>}
                    {p.overdue && <span style={{ display: 'block', fontSize: 11, color: 'var(--tone-warn-fg)' }}>période échue · à clore</span>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', color: p.estimatedHours >= MANDATORY_HOURS ? 'var(--color-text)' : 'var(--color-neutral-300)' }}>{p.estimatedHours} h</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {p.dangerousWork ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--tone-warn-fg)' }}><Icon name="ph-warning" size={12} />Oui</span> : <span style={muted}>Non</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }} title={p.mandatory ? `Obligatoire — ${p.mandatoryReason}` : `Moins de ${MANDATORY_HOURS} h sur 12 mois, sans travaux dangereux`}>
                    {p.mandatory ? 'Obligatoire' : <span style={muted}>Non requis</span>}
                    {p.firstMinute && <span style={{ display: 'block', ...muted }}>dès la 1re minute</span>}
                    {p.contentMissing.length > 0 && p.status !== 'clos' && p.status !== 'annule' && (
                      <span style={{ display: 'block', ...muted }} title={`À compléter : ${p.contentMissing.join(', ')}`}>contenu incomplet</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{inspectionCell(p)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <SignChip label="EU" on={!!p.signedEuOn} title={p.signedEuOn ? `Entreprise utilisatrice · signé le ${fmtDate(p.signedEuOn)}` : 'Entreprise utilisatrice · signature attendue'} />
                      <SignChip label="EE" on={!!p.signedEeOn} title={p.signedEeOn ? `Entreprise extérieure · signé le ${fmtDate(p.signedEeOn)}` : 'Entreprise extérieure · signature attendue'} />
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <ToneTag tone={p.tone}>{p.statusLabel}</ToneTag>
                    {p.missingSignature && <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--tone-danger-fg)' }}>Écart · sans plan signé</span>}
                    {p.startGap?.past && (
                      <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--tone-warn-fg)' }}>
                        Écart passé · {p.startGap.kind === 'signe_apres' ? 'signé après le démarrage' : 'réalisé sans plan signé'}
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
