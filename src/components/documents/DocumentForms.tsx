'use client';

import { useState, type ReactNode } from 'react';
import { DialogButton } from '@/components/Dialog';
import { ActionForm, Checkbox, Field, FormRow, Input, Select, TextArea, type FormAction } from '@/components/form';
import { FileError, checkPickedFiles } from '@/components/watch/parts';
import type { DocumentRow, LinkedAction, VersionView } from '@/lib/data/documents';
import type { ActionFormOptions } from '@/lib/action-view';
import type { FormOptions } from '@/lib/data/options';
import { ARCHIVED_SITE_SUFFIX, LEFT_SUFFIX, withCurrent } from '@/lib/form-options';
import { nextRef, type FormState } from '@/lib/forms';
import { createDocument, recordDocumentReview, reviseDocument, updateDocument, updateDraft } from '@/server/documents';
import { DOC_ORIGINS, DOC_ORIGIN_KEYS, DOC_TYPES, DOC_TYPE_KEYS, PROCESSES, refPrefix, type DocOrigin, type DocType } from './meta';

type Option = readonly [string, string];

const ORIGIN_OPTIONS = DOC_ORIGIN_KEYS.map((k) => [k, DOC_ORIGINS[k]] as const);

/**
 * DOC-17 (ISO 9001 §7.5.3.2) : origine du document (interne, externe : norme, document client ou fournisseur), émetteur d'un
 * document externe, durée de conservation (enregistrements et versions archivées).
 */
function OriginFields({ origin: initial = 'interne', issuer, retention }: { origin?: DocOrigin; issuer?: string | null; retention?: string | null }) {
  const [origin, setOrigin] = useState<DocOrigin>(initial);
  return (
    <>
      <FormRow>
        <Field name="origin" label="Origine">
          <Select name="origin" options={ORIGIN_OPTIONS} value={origin} onChange={(e) => setOrigin(e.target.value as DocOrigin)} />
        </Field>
        {origin === 'externe' && (
          <Field name="issuer" label="Émetteur" hint="Organisme, client ou fournisseur qui publie le document.">
            <Input name="issuer" defaultValue={issuer ?? ''} maxLength={120} placeholder="Ex. AFNOR, [Client A]" />
          </Field>
        )}
      </FormRow>
      <Field name="retention" label="Durée de conservation" hint="Enregistrements et versions archivées (ex. 10 ans, durée du contrat + 5 ans).">
        <Input name="retention" defaultValue={retention ?? ''} maxLength={120} />
      </Field>
    </>
  );
}
/**
 * Listes des formulaires du domaine. `actions` (actions à rattacher à une version) et `actionForm` (formulaire d'action)
 * ne sont fournis qu'au service QHSE, seul à créer une action et à modifier ses rattachements (ACT-22) : sans elles, le
 * champ « Action liée » n'est pas affiché (le serveur conserve alors l'action actuelle).
 */
export type DocFormOptions = Pick<FormOptions, 'people' | 'sites'> & { actions: readonly Option[] | null; actionForm: ActionFormOptions | null };

// Aligné sur checkUpload (src/lib/uploads.ts) : pas de .ppt (ancien format PowerPoint refusé par le serveur).
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.pptx,.txt,.csv,.png,.jpg,.jpeg,.webp';
const FILE_HINT = 'Facultatif · PDF, Word, Excel, PowerPoint (.pptx) ou image, 10 Mo au maximum.';
const TYPE_OPTIONS: Option[] = DOC_TYPE_KEYS.map((k) => [k, DOC_TYPES[k].label]);
const PROCESS_OPTIONS: Option[] = Object.entries(PROCESSES).map(([code, label]) => [code, `${label} (${code})`]);

/** Ajoute l'action déjà liée à la liste si elle n'y figure pas (action close ou d'un autre site). */
const withAction = (options: readonly Option[], action: Pick<LinkedAction, 'id' | 'label'> | null | undefined): readonly Option[] =>
  action && !options.some(([id]) => id === action.id) ? [[action.id, `${action.id} · ${action.label}`], ...options] : options;

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
  const [fileError, setFileError] = useState<string | null>(null);
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
      <OriginFields />
      <Field name="summary" label="Objet de la version A">
        <Input name="summary" defaultValue="Création du document" />
      </Field>
      <FormRow>
        {options.actions && (
          <Field name="actionId" label="Action liée" hint="Facultatif : action du plan à l'origine du document.">
            <Select name="actionId" options={options.actions} placeholder="Aucune" defaultValue="" />
          </Field>
        )}
        <Field name="file" label="Fichier" hint={FILE_HINT}>
          <Input name="file" type="file" accept={ACCEPT} onChange={(e) => setFileError(checkPickedFiles(e.currentTarget))} />
        </Field>
      </FormRow>
      <FileError error={fileError} />
    </ActionForm>
  );
}

/** Modification des informations du document. */
export function MetadataForm({ doc, options, onDone, onCancel }: { doc: DocumentRow; options: DocFormOptions; onDone: () => void; onCancel: () => void }) {
  // Propriétaire sorti de l'effectif, site archivé : conservés tels quels tant qu'un autre choix n'est pas fait (DOC-01).
  const owners = withCurrent(options.people, doc.ownerId, `${doc.owner}${LEFT_SUFFIX}`);
  const sites = withCurrent(options.sites, doc.siteId, `${doc.siteLabel}${ARCHIVED_SITE_SUFFIX}`);
  const ownerLeft = owners !== options.people;
  const siteArchived = sites !== options.sites;
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
        <Field name="ownerId" label="Propriétaire" hint={ownerLeft ? "Sorti de l'effectif : conservé tant qu'aucun successeur n'est choisi." : undefined}>
          <Select name="ownerId" options={owners} defaultValue={doc.ownerId} />
        </Field>
        <Field name="reviewMonths" label="Périodicité de revue (mois)">
          <Input name="reviewMonths" type="number" min={1} max={120} defaultValue={doc.reviewMonths} />
        </Field>
      </FormRow>
      <FormRow>
        <Field name="distribution" label="Diffusion">
          <Input name="distribution" defaultValue={doc.distribution} />
        </Field>
        <Field name="siteId" label="Site" hint={siteArchived ? "Site archivé : conservé tant qu'aucun autre site n'est choisi." : undefined}>
          <Select name="siteId" options={sites} placeholder="Tous les sites" defaultValue={doc.siteId ?? ''} />
        </Field>
      </FormRow>
      <OriginFields origin={doc.origin} issuer={doc.issuer} retention={doc.retention} />
    </ActionForm>
  );
}

/** Nouvelle révision d'un document en vigueur, ou relance d'un document abandonné avant approbation. */
export function RevisionForm({ doc, version, options, onDone, onCancel }: { doc: DocumentRow; version: string; options: DocFormOptions; onDone: () => void; onCancel: () => void }) {
  const suggested = doc.reviewActions[0];
  const [fileError, setFileError] = useState<string | null>(null);
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
        {options.actions && (
          <Field name="actionId" label="Action liée" hint="Facultatif : action du plan à l'origine de la révision.">
            <Select name="actionId" options={withAction(options.actions, suggested)} placeholder="Aucune" defaultValue={suggested?.id ?? ''} />
          </Field>
        )}
        <Field name="file" label="Fichier" hint={FILE_HINT}>
          <Input name="file" type="file" accept={ACCEPT} onChange={(e) => setFileError(checkPickedFiles(e.currentTarget))} />
        </Field>
      </FormRow>
      <FileError error={fileError} />
    </ActionForm>
  );
}

/** Brouillon en cours : objet, action liée, dépôt ou remplacement du fichier. */
export function DraftForm({ version, options, onDone, onCancel }: { version: VersionView; options: DocFormOptions; onDone: () => void; onCancel: () => void }) {
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <ActionForm action={updateDraft} hidden={{ versionId: version.id }} onDone={onDone} onCancel={onCancel} submitLabel="Enregistrer le brouillon" encType="multipart/form-data">
      <Field name="summary" label="Objet de la modification">
        <TextArea name="summary" rows={3} defaultValue={version.summary} autoFocus />
      </Field>
      <FormRow>
        {options.actions && (
          <Field name="actionId" label="Action liée">
            <Select name="actionId" options={withAction(options.actions, version.action)} placeholder="Aucune" defaultValue={version.action?.id ?? ''} />
          </Field>
        )}
        <Field name="file" label={version.file ? 'Remplacer le fichier' : 'Fichier'} hint={version.file ? `Fichier actuel : ${version.file.name}` : FILE_HINT}>
          <Input name="file" type="file" accept={ACCEPT} onChange={(e) => setFileError(checkPickedFiles(e.currentTarget))} />
        </Field>
      </FormRow>
      <FileError error={fileError} />
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

/** DOC-15 : revue périodique sans modification de la version en vigueur (date et conclusion). */
export function PeriodicReviewForm({ doc, onDone, onCancel }: { doc: DocumentRow; onDone: () => void; onCancel: () => void }) {
  return (
    <ActionForm action={recordDocumentReview} hidden={{ documentId: doc.id }} submitLabel="Enregistrer la revue" submitIcon="ph-seal-check" onDone={onDone} onCancel={onCancel}>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-neutral-300)', textWrap: 'pretty' }}>
        La version {doc.current?.version} reste en vigueur, sans nouvelle révision ni changement d&apos;indice ; la prochaine revue repart de cette date ({doc.reviewMonths} mois).
      </p>
      <Field name="reviewedOn" label="Revu le">
        <Input name="reviewedOn" type="date" autoFocus />
      </Field>
      <Field name="conclusion" label="Conclusion de la revue" hint="Ex. Document toujours adapté : exigences, organisation et pratiques inchangées.">
        <TextArea name="conclusion" rows={3} maxLength={1000} />
      </Field>
    </ActionForm>
  );
}
