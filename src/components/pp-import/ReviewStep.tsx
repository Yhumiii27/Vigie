'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm, Field, FormRow, Input, Select, TextArea } from '@/components/form';
import { DANGEROUS_WORK_HINT, MANDATORY_HOURS, PLAN_STATUS, lcfirst, planStatus, ruleBasis } from '@/components/prevention/model';
import { Notice, SITE_LOCK_HINT, SectionTitle } from '@/components/prevention/parts';
import { Icon, ToneTag } from '@/components/ui';
import type { FormState } from '@/lib/forms';
import type { PpFormData, PpImportFormat } from '@/lib/pp-form';
import { NEW_CONTRACTOR, type PlanDraft } from '@/lib/pp-import/draft';
import { FORMAT_LABELS, type ImportScreenData } from '@/lib/pp-import/types';
import { createPlanFromImport } from '@/server/pp-import';
import { CheckMark, fileSize, muted, plural } from './parts';
import s from './pp-import.module.css';

type Props = {
  data: ImportScreenData;
  draft: PlanDraft;
  sections: PpFormData['sections'];
  file: File;
  format: PpImportFormat;
  templateId: number | null;
  templateName: string | null;
  onBack: () => void;
};

/** Étape 4 : plan prérempli à vérifier, aperçu de la grille conservée, création du plan avec le fichier source joint. */
export function ReviewStep({ data, draft, sections, file, format, templateId, templateName, onBack }: Props) {
  const router = useRouter();
  const [contractorId, setContractorId] = useState(draft.contractorId);
  const [siteId, setSiteId] = useState(data.sites.some((x) => x.id === data.defaultSiteId) ? data.defaultSiteId : data.sites[0]?.id ?? '');
  const [hours, setHours] = useState(draft.estimatedHours);
  const [dangerous, setDangerous] = useState(draft.dangerousWork);
  const [inspectionOn, setInspectionOn] = useState(draft.inspectionOn);
  const [signedEuOn, setSignedEuOn] = useState(draft.signedEuOn);
  const [signedEeOn, setSignedEeOn] = useState(draft.signedEeOn);

  // Le fichier déposé à l'étape 1 est renvoyé avec le formulaire : il devient la pièce jointe source du plan.
  const action = async (prev: FormState, fd: FormData) => {
    fd.set('file', file);
    return createPlanFromImport(prev, fd);
  };

  const h = Number(hours.replace(/\s/g, '').replace(',', '.'));
  const overHours = hours.trim() !== '' && Number.isFinite(h) && h >= MANDATORY_HOURS;
  const site = data.sites.find((x) => x.id === siteId);
  const firstMinute = !!site?.ppFromFirstMinute;
  const legalText = [overHours && `${hours.trim()} h ≥ ${MANDATORY_HOURS} h sur 12 mois`, dangerous && 'travaux dangereux'].filter(Boolean).join(' et ');
  const status = planStatus({
    status: 'brouillon', startOn: '', endOn: '', estimatedHours: Number.isFinite(h) ? h : 0, dangerousWork: dangerous,
    inspectionOn: inspectionOn || null, signedEuOn: signedEuOn || null, signedEeOn: signedEeOn || null,
  }, data.today);

  const contractorOptions = [
    ...data.contractors.map((c) => [c.id, `${c.name} — ${c.trade}`] as const),
    [NEW_CONTRACTOR, draft.contractorName ? `Créer l'entreprise « ${draft.contractorName} »` : 'Nouvelle entreprise…'] as const,
  ];
  const matchedContractor = data.contractors.find((c) => c.id === draft.contractorId);
  const contractorHint = !draft.contractorName ? 'Aucune raison sociale lue dans le formulaire.'
    : matchedContractor ? `Lu dans le formulaire : « ${draft.contractorName} » — entreprise reconnue.`
      : `Lu dans le formulaire : « ${draft.contractorName} » — aucune entreprise connue sous ce nom.`;
  const owner = data.people.some(([id]) => id === data.currentUserId) ? data.currentUserId : '';
  const boxes = sections.flatMap((x) => x.items).filter((i) => i.checked !== undefined);

  return (
    <div className="card" style={{ gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 2 }}>
          <span className="card-kicker">Étape 4 · Vérification</span>
          <span className="card-title" style={{ fontSize: 15 }}>Plan de prévention prérempli</span>
        </div>
        <button type="button" className="btn btn-secondary vg-btn-sm" onClick={onBack}><Icon name="ph-arrow-left" size={13} />Retour</button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '2 1 520px', minWidth: 0 }}>
          <ActionForm action={action} submitLabel="Créer le plan" submitIcon="ph-check"
            hidden={{ format, templateId, sections: JSON.stringify(sections) }}
            onDone={(st) => { if (st.id) router.push(`/prevention?plan=${st.id}`); else router.push('/prevention'); }}>
            <SectionTitle>Entreprise extérieure</SectionTitle>
            <Field name="contractorId" label="Entreprise extérieure" hint={contractorHint}>
              <Select name="contractorId" options={contractorOptions} value={contractorId} onChange={(e) => setContractorId(e.target.value)} placeholder="Choisir…" />
            </Field>
            {contractorId === NEW_CONTRACTOR && (
              <>
                <FormRow>
                  <Field name="contractorName" label="Raison sociale">
                    <Input name="contractorName" defaultValue={draft.contractorName} maxLength={120} />
                  </Field>
                  <Field name="contractorTrade" label="Corps de métier">
                    <Input name="contractorTrade" defaultValue={draft.contractorTrade} maxLength={120} placeholder="Ex. Montage d'échafaudages" />
                  </Field>
                </FormRow>
                <FormRow cols={3}>
                  <Field name="contactName" label="Interlocuteur">
                    <Input name="contactName" defaultValue={draft.contactName} maxLength={120} />
                  </Field>
                  <Field name="contactPhone" label="Téléphone">
                    <Input name="contactPhone" defaultValue={draft.contactPhone} maxLength={40} inputMode="tel" />
                  </Field>
                  <Field name="contactEmail" label="E-mail">
                    <Input name="contactEmail" defaultValue={draft.contactEmail} maxLength={160} inputMode="email" />
                  </Field>
                </FormRow>
              </>
            )}

            <SectionTitle>Intervention</SectionTitle>
            <FormRow>
              <Field name="siteId" label="Site" hint={data.siteLocked ? SITE_LOCK_HINT : undefined}>
                <Select name="siteId" options={data.sites.map((x) => [x.id, x.label] as const)} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
              </Field>
              <Field name="ownerId" label="Responsable (entreprise utilisatrice)">
                <Select name="ownerId" options={data.people} defaultValue={owner} placeholder="Choisir…" />
              </Field>
            </FormRow>
            <Field name="title" label="Nature des travaux">
              <Input name="title" defaultValue={draft.title} maxLength={200} placeholder="Ex. Maintenance du pont roulant 10 t : réglage des fins de course" />
            </Field>
            <Field name="location" label="Lieu d'intervention">
              <Input name="location" defaultValue={draft.location} maxLength={160} placeholder="Ex. Atelier montage · poste M3" />
            </Field>
            <FormRow cols={3}>
              <Field name="startOn" label="Début" hint={draft.hints.startOn}>
                <Input name="startOn" type="date" defaultValue={draft.startOn} />
              </Field>
              <Field name="endOn" label="Fin" hint={draft.hints.endOn}>
                <Input name="endOn" type="date" defaultValue={draft.endOn} />
              </Field>
              <Field name="estimatedHours" label="Heures sur 12 mois" hint={draft.hints.estimatedHours ?? "Total estimé pour l'entreprise extérieure."}>
                <Input name="estimatedHours" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Ex. 120" />
              </Field>
            </FormRow>
            <div style={{ display: 'grid', gap: 4 }}>
              <label className="vg-check">
                <input type="checkbox" name="dangerousWork" checked={dangerous} onChange={(e) => setDangerous(e.target.checked)} />
                <span className="vg-check-box"><i className="ph ph-check" aria-hidden /></span>
                <span>Travaux dangereux (arrêté du 19 mars 1993)</span>
              </label>
              <span className="vg-field-hint" style={{ paddingLeft: 24, marginTop: 0 }}>{DANGEROUS_WORK_HINT}</span>
            </div>
            {firstMinute && site ? (
              // Fondement de la règle propre au site : Seveso seuil haut ou bas, ou règle interne.
              <Notice tone="accent" icon="ph-shield-check">
                {site.label} : plan de prévention écrit <strong style={{ fontWeight: 500 }}>obligatoire</strong> dès la première minute d&apos;intervention ({lcfirst(ruleBasis(site))}).
                {legalText ? ` Seuil légal R. 4512-7 également atteint (${legalText}).` : ''}
              </Notice>
            ) : (
              <Notice tone={overHours || dangerous ? 'accent' : 'neutral'} icon={overHours || dangerous ? 'ph-file-text' : 'ph-info'}>
                {overHours || dangerous
                  ? <>Plan de prévention écrit <strong style={{ fontWeight: 500 }}>obligatoire</strong> ({legalText}) : inspection commune préalable et signature des deux entreprises avant le début des travaux.</>
                  : <>Plan écrit non obligatoire (moins de {MANDATORY_HOURS} h sur 12 mois, sans travaux dangereux) ; l&apos;analyse des risques d&apos;interférence reste requise (R. 4512-6).</>}
              </Notice>
            )}
            <Field name="keystoneProject" label="Projet Keystone" hint={draft.hints.keystoneProject}>
              <Select name="keystoneProject" options={data.projects} defaultValue={draft.keystoneProject} placeholder="Aucun projet" />
            </Field>

            <SectionTitle>Inspection commune et analyse des risques</SectionTitle>
            <Field name="inspectionOn" label="Inspection commune préalable" hint={draft.hints.inspectionOn ?? 'Visite conjointe des lieux, installations et matériels.'}>
              <Input name="inspectionOn" type="date" value={inspectionOn} onChange={(e) => setInspectionOn(e.target.value)} style={{ maxWidth: 220 }} />
            </Field>
            <Field name="interferenceRisks" label="Risques d'interférence" hint="Prérempli avec les risques cochés dans le formulaire et les précisions écrites.">
              <TextArea name="interferenceRisks" rows={4} defaultValue={draft.interferenceRisks} maxLength={4000} />
            </Field>
            <Field name="measures" label="Mesures de prévention" hint="Prérempli avec les mesures, moyens de secours et consignes cochés, et les précisions écrites.">
              <TextArea name="measures" rows={4} defaultValue={draft.measures} maxLength={4000} />
            </Field>

            <SectionTitle aside={<ToneTag tone={PLAN_STATUS[status].tone}>Statut à la création : {PLAN_STATUS[status].label}</ToneTag>}>Signatures</SectionTitle>
            <FormRow>
              <Field name="signedEuOn" label="Entreprise utilisatrice — signé le" hint={draft.hints.signedEuOn}>
                <Input name="signedEuOn" type="date" value={signedEuOn} max={data.today} onChange={(e) => setSignedEuOn(e.target.value)} />
              </Field>
              <Field name="signedEeOn" label="Entreprise extérieure — signé le" hint={draft.hints.signedEeOn}>
                <Input name="signedEeOn" type="date" value={signedEeOn} max={data.today} onChange={(e) => setSignedEeOn(e.target.value)} />
              </Field>
            </FormRow>
            <span className="vg-field-hint" style={{ marginTop: -6 }}>
              Dates lues sur le formulaire signé. Une signature suppose l&apos;inspection commune préalable réalisée et les mesures de prévention renseignées.
            </span>
          </ActionForm>
        </div>

        <aside className="vg-inset" style={{ flex: '1 1 280px', minWidth: 0, display: 'grid', gap: 10, padding: '12px 14px', alignContent: 'start' }}>
          <SectionTitle>Fichier source</SectionTitle>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5 }}>
            <Icon name="ph-paperclip" size={15} style={{ color: 'var(--color-neutral-400)', marginTop: 1 }} />
            <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
              {file.name}
              <span style={{ display: 'block', ...muted }}>
                {FORMAT_LABELS[format]} · {fileSize(file.size)}{templateName ? ` · modèle « ${templateName} »` : ''} — joint au plan
              </span>
            </span>
          </div>
          <SectionTitle aside={boxes.length ? <span style={muted}>{boxes.filter((b) => b.checked).length}/{boxes.length} cochées</span> : undefined}>
            Grille du formulaire conservée
          </SectionTitle>
          {sections.length === 0 && <span style={{ ...muted, fontSize: 12 }}>Aucune ligne de grille : seuls les champs du plan sont enregistrés.</span>}
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
              {plural(sections.reduce((n, x) => n + x.items.length, 0), 'ligne enregistrée', 'lignes enregistrées')} avec le plan (réponses du formulaire importé).
            </span>
          )}
        </aside>
      </div>
    </div>
  );
}
