'use client';

import { useState, type ReactNode } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Checkbox, Field, FormRow, Input, Select, TextArea, type FormAction } from '@/components/form';
import type { DocumentRow, LinkedAction, VersionView } from '@/lib/data/documents';
import type { FormOptions } from '@/lib/data/options';
import { nextRef, type FormState } from '@/lib/forms';
import { createDocument, reviseDocument, updateDocument, updateDraft } from '@/server/documents';
import { DOC_TYPES, DOC_TYPE_KEYS, PROCESSES, refPrefix, type DocType } from './meta';

type Option = readonly [string, string];
export type DocFormOptions = Pick<FormOptions, 'people' | 'sites' | 'origins'> & { actions: readonly Option[] };

// Aligné sur checkUpload (src/lib/uploads.ts) : pas de .ppt (ancien format PowerPoint refusé par le serveur).
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.pptx,.txt,.csv,.png,.jpg,.jpeg,.webp';
const FILE_HINT = 'Facultatif · PDF, Word, Excel, PowerPoint (.pptx) ou image, 10 Mo au maximum.';
const TYPE_OPTIONS: Option[] = DOC_TYPE_KEYS.map((k) => [k, DOC_TYPES[k].label]);
const PROCESS_OPTIONS: Option[] = Object.entries(PROCESSES).map(([code, label]) => [code, `${label} (${code})`]);

/** Ajoute l'action déjà liée à la liste si elle n'y figure pas (action clôturée ou d'un autre site). */
const withAction = (options: readonly Option[], action: Pick<LinkedAction, 'id' | 'title'> | null | undefined): readonly Option[] =>
  action && !options.some(([id]) => id === action.id) ? [[action.id, `${action.id} · ${action.title}`], ...options] : options;

const Note = ({ children }: { children: ReactNode }) => (
  <div style={{ fontSize: 12, color: 'var(--color-neutral-400)', textWrap: 'pretty' }}>{children}</div>
);

/** Bouton « Nouveau document » : création avec la version A en brouillon. */
export function NewDocumentButton({ options, existingIds, defaultSiteId, onCreated }: {
  options: DocFormOptions; existingIds: string[]; defaultSiteId: string | null; onCreated?: (id: string) => void;
}) {
  return (
    <DialogButton label="Nouveau document" icon="ph-plus" className="btn btn-primary vg-btn-sm" title="Nouveau document" kicker="Documents maîtrisés" width={600}>
      {(close) => (
        <NewDocumentForm options={options} existingIds={existingIds} defaultSiteId={defaultSiteId} onCancel={close}
          onDone={(s) => { close(); if (s.id) onCreated?.(s.id); }} />
      )}
    </DialogButton>
  );
}

function NewDocumentForm({ options, existingIds, defaultSiteId, onDone, onCancel }: {
  options: DocFormOptions; existingIds: string[]; defaultSiteId: string | null; onDone: (s: FormState) => void; onCancel: () => void;
}) {
  const [type, setType] = useState<DocType>('procedure');
  const [processCode, setProcessCode] = useState('QHSE');
  const [months, setMonths] = useState(String(DOC_TYPES.procedure.reviewMonths));
  const auto = nextRef(existingIds, refPrefix(type, processCode), 3);
  return (
    <ActionForm action={createDocument} onDone={onDone} onCancel={onCancel} submitLabel="Créer le document" encType="multipart/form-data">
      <FormRow>
        <Field name="type" label="Type">
          <Select name="type" options={TYPE_OPTIONS} value={type}
            onChange={(e) => { const v = e.target.value as DocType; setType(v); setMonths(String(DOC_TYPES[v].reviewMonths)); }} />
        </Field>
        <Field name="process" label="Processus">
          <Select name="process" options={PROCESS_OPTIONS} value={processCode} onChange={(e) => setProcessCode(e.target.value)} />
        </Field>
      </FormRow>
      <Field name="title" label="Titre">
        <Input name="title" autoFocus placeholder="Ex. Maîtrise des produits non conformes" />
      </Field>
      <FormRow>
        <Field name="ref" label="Référence" hint={`Laisser vide pour attribuer ${auto}.`}>
          <Input name="ref" placeholder={auto} autoComplete="off" style={{ textTransform: 'uppercase' }} />
        </Field>
        <Field name="ownerId" label="Propriétaire" hint="Rédige les révisions et suit la revue périodique.">
          <Select name="ownerId" options={options.people} placeholder="Choisir…" defaultValue="" />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="reviewMonths" label="Périodicité de revue (mois)">
          <Input name="reviewMonths" type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} />
        </Field>
        <Field name="siteId" label="Site" hint="« Tous les sites » pour un document commun à l'entreprise.">
          <Select name="siteId" options={options.sites} placeholder="Tous les sites" defaultValue={defaultSiteId ?? ''} />
        </Field>
      </FormRow>
      <Field name="distribution" label="Diffusion" hint="Services, postes ou affichages qui reçoivent la version en vigueur.">
        <Input name="distribution" placeholder="Ex. Atelier montage · chefs d'équipe, affichage poste M3" />
      </Field>
      <Field name="summary" label="Objet de la version A">
        <Input name="summary" defaultValue="Création du document" />
      </Field>
      <FormRow>
        <Field name="actionId" label="Action liée" hint="Facultatif : action du plan à l'origine du document.">
          <Select name="actionId" options={options.actions} placeholder="Aucune" defaultValue="" />
        </Field>
        <Field name="file" label="Fichier" hint={FILE_HINT}>
          <Input name="file" type="file" accept={ACCEPT} />
        </Field>
      </FormRow>
    </ActionForm>
  );
}

/** Modification des informations du document. */
export function MetadataForm({ doc, options, onDone, onCancel }: { doc: DocumentRow; options: DocFormOptions; onDone: () => void; onCancel: () => void }) {
  return (
    <ActionForm action={updateDocument} hidden={{ id: doc.id }} onDone={onDone} onCancel={onCancel}>
      <Field name="title" label="Titre">
        <Input name="title" defaultValue={doc.title} autoFocus />
      </Field>
      <FormRow>
        <Field name="type" label="Type" hint={`La référence ${doc.id} reste inchangée.`}>
          <Select name="type" options={TYPE_OPTIONS} defaultValue={doc.type} />
        </Field>
        <Field name="process" label="Processus">
          <Select name="process" options={PROCESS_OPTIONS} defaultValue={doc.process} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="ownerId" label="Propriétaire">
          <Select name="ownerId" options={options.people} defaultValue={doc.ownerId} />
        </Field>
        <Field name="reviewMonths" label="Périodicité de revue (mois)">
          <Input name="reviewMonths" type="number" min={1} max={120} defaultValue={doc.reviewMonths} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="distribution" label="Diffusion">
          <Input name="distribution" defaultValue={doc.distribution} />
        </Field>
        <Field name="siteId" label="Site">
          <Select name="siteId" options={options.sites} placeholder="Tous les sites" defaultValue={doc.siteId ?? ''} />
        </Field>
      </FormRow>
    </ActionForm>
  );
}

/** Nouvelle révision d'un document en vigueur, ou relance d'un document abandonné avant approbation. */
export function RevisionForm({ doc, version, options, onDone, onCancel }: { doc: DocumentRow; version: string; options: DocFormOptions; onDone: () => void; onCancel: () => void }) {
  const suggested = doc.reviewActions[0];
  return (
    <ActionForm action={reviseDocument} hidden={{ documentId: doc.id }} onDone={onDone} onCancel={onCancel} submitLabel={`Créer la version ${version}`} encType="multipart/form-data">
      <Note>
        {doc.abandoned
          ? <>Le document, abandonné avant toute approbation, repasse en rédaction : la version {version} est créée en brouillon.</>
          : <>La version {version} est créée en brouillon{doc.current ? <> ; la version {doc.current.version} reste en vigueur jusqu&apos;à son approbation</> : null}.</>}
      </Note>
      <Field name="summary" label="Objet de la modification">
        <TextArea name="summary" rows={3} autoFocus placeholder="Ce qui change et pourquoi (ex. suite à EV-2026-130, revue périodique sans modification…)" />
      </Field>
      <FormRow>
        <Field name="actionId" label="Action liée" hint="Facultatif : action du plan à l'origine de la révision.">
          <Select name="actionId" options={withAction(options.actions, suggested)} placeholder="Aucune" defaultValue={suggested?.id ?? ''} />
        </Field>
        <Field name="file" label="Fichier" hint={FILE_HINT}>
          <Input name="file" type="file" accept={ACCEPT} />
        </Field>
      </FormRow>
    </ActionForm>
  );
}

/** Brouillon en cours : objet, action liée, dépôt ou remplacement du fichier. */
export function DraftForm({ version, options, onDone, onCancel }: { version: VersionView; options: DocFormOptions; onDone: () => void; onCancel: () => void }) {
  return (
    <ActionForm action={updateDraft} hidden={{ versionId: version.id }} onDone={onDone} onCancel={onCancel} submitLabel="Enregistrer le brouillon" encType="multipart/form-data">
      <Field name="summary" label="Objet de la modification">
        <TextArea name="summary" rows={3} defaultValue={version.summary} autoFocus />
      </Field>
      <FormRow>
        <Field name="actionId" label="Action liée">
          <Select name="actionId" options={withAction(options.actions, version.action)} placeholder="Aucune" defaultValue={version.action?.id ?? ''} />
        </Field>
        <Field name="file" label={version.file ? 'Remplacer le fichier' : 'Fichier'} hint={version.file ? `Fichier actuel : ${version.file.name}` : FILE_HINT}>
          <Input name="file" type="file" accept={ACCEPT} />
        </Field>
      </FormRow>
      {version.file && <Checkbox name="removeFile" label="Retirer le fichier actuel sans le remplacer" />}
    </ActionForm>
  );
}

/** Confirmation d'une étape du cycle de vie (soumission, approbation, renvoi, abandon, obsolescence). */
export function ConfirmForm({ action, hidden, message, submitLabel, submitIcon, onDone, onCancel }: {
  action: FormAction; hidden: Record<string, string | number>; message: ReactNode; submitLabel: string; submitIcon?: string; onDone: () => void; onCancel: () => void;
}) {
  return (
    <ActionForm action={action} hidden={hidden} onDone={onDone} onCancel={onCancel} submitLabel={submitLabel} submitIcon={submitIcon}>
      <Note>{message}</Note>
    </ActionForm>
  );
}
