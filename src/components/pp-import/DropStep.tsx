'use client';

import { useRef, useState, useTransition, type DragEvent } from 'react';
import { Field } from '@/components/form';
import { Notice } from '@/components/prevention/parts';
import { Icon } from '@/components/ui';
import { HEIC_MESSAGE, MAX_SCAN_PAGES, importFilesError, isHeic, pageBudget } from '@/lib/pp-import/files';
import {
  ACCEPT_ATTR, ACCEPTED_TYPES, AI_DISABLED_MESSAGE, AI_NO_CREDENTIALS_MESSAGE, FORMAT_LABELS, importMimeOf,
  type AiStatus, type AiUsageView, type DetectResponse, type TemplateView,
} from '@/lib/pp-import/types';
import { detectPpImport } from '@/server/pp-import';
import s from './pp-import.module.css';

export type DetectOk = Extract<DetectResponse, { ok: true }>;

/** Taille au-delà de laquelle une photo est réduite avant lecture (l'API accepte 5 Mo par image). */
const READING_IMAGE_BYTES = 4.5 * 1024 * 1024;
const READING_MAX_EDGE = 2600;

const jpegName = (name: string) => `${name.replace(/\.[^.]+$/, '')}.jpg`;

/**
 * Copie JPEG d'une photo, réduite (bord ≤ `maxEdge` px) jusqu'à `maxBytes` ; null si le navigateur ne sait pas la décoder.
 * `force` : copie faite même si la photo tient déjà dans les limites (conversion d'une photo HEIC, INT-14).
 */
async function jpegCopy(file: File, { maxBytes, maxEdge, force = false }: { maxBytes: number; maxEdge: number; force?: boolean }): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const edge = Math.max(bitmap.width, bitmap.height);
    if (!force && file.size <= maxBytes && edge <= 4000) {
      bitmap.close();
      return file;
    }
    const scale = Math.min(1, maxEdge / edge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= maxBytes) return new File([blob], jpegName(file.name), { type: 'image/jpeg' });
    }
  } catch {
    // Image non décodable par ce navigateur.
  }
  return null;
}

/**
 * Copie d'une photo pour la lecture automatique : réduite (bord ≤ 2 600 px, JPEG) si elle est trop lourde.
 * Le fichier d'origine reste celui qui est joint au plan ; image non décodable : envoyée telle quelle (le serveur
 * indiquera l'erreur).
 */
const readingCopy = async (file: File) => (await jpegCopy(file, { maxBytes: READING_IMAGE_BYTES, maxEdge: READING_MAX_EDGE })) ?? file;

/**
 * Fichiers déposés prêts à l'envoi (INT-14) : photos HEIC/HEIF converties en JPEG quand le navigateur sait les décoder
 * (Safari), sinon refusées ; plusieurs pages : chaque photo réduite à sa part du volume d'un envoi (copies jointes au plan).
 */
async function prepareFiles(list: File[]): Promise<{ files: File[] } | { error: string }> {
  const converted: File[] = [];
  for (const file of list) {
    if (!isHeic(file)) { converted.push(file); continue; }
    const jpeg = await jpegCopy(file, { maxBytes: READING_IMAGE_BYTES, maxEdge: READING_MAX_EDGE, force: true });
    if (!jpeg) return { error: HEIC_MESSAGE };
    converted.push(jpeg);
  }
  const typed = converted.map((f) => {
    const mime = importMimeOf(f.name, f.type);
    return mime && f.type !== mime ? new File([f], f.name, { type: mime, lastModified: f.lastModified }) : f;
  });
  if (typed.length > 1 && typed.length <= MAX_SCAN_PAGES && typed.every((f) => f.type.startsWith('image/'))) {
    const budget = pageBudget(typed.length);
    for (let i = 0; i < typed.length; i++) {
      if (typed[i].size > budget) typed[i] = (await jpegCopy(typed[i], { maxBytes: budget, maxEdge: READING_MAX_EDGE })) ?? typed[i];
    }
  }
  const error = importFilesError(typed);
  return error ? { error } : { files: typed };
}

/**
 * Envoie le fichier (type MIME déjà fiable), ou les pages d'un formulaire, au serveur pour détection. Une photo seule lue
 * par l'API Claude est envoyée en copie réduite si elle est trop lourde ; `templateId` = modèle choisi au dépôt (clés
 * réutilisées pour un scan).
 */
export async function detectFile(files: File[], templateId: number | string | null, aiReady: boolean): Promise<DetectResponse> {
  const fd = new FormData();
  if (files.length === 1) fd.set('file', aiReady && files[0].type.startsWith('image/') ? await readingCopy(files[0]) : files[0]);
  else files.forEach((f) => fd.append('file', f, f.name));
  if (templateId) fd.set('templateId', String(templateId));
  return detectPpImport(fd);
}

/** Étape 1 : dépôt du fichier (glisser-déposer ou sélection), puis détection des champs par le serveur. */
/** Consommation de la lecture des scans (INT-06), affichée sous l'avis « Lecture des scans activée ». */
export function aiUsageText(u: AiUsageView): string {
  const n = (x: number) => x.toLocaleString('fr-FR');
  const month = `Ce mois-ci : ${n(u.monthCalls)} lecture${u.monthCalls > 1 ? 's' : ''}, ${n(u.monthTokens)} jetons${u.monthlyTokens > 0 ? ` sur un plafond de ${n(u.monthlyTokens)}` : ''}`;
  return `${month} ; vous : ${n(u.personDay)} sur ${n(u.dailyScans)} lectures par 24 h. Un même fichier relu dans l'heure n'est pas renvoyé.`;
}

export function DropStep({ templates, aiStatus, aiUsage = null, onDetected }: {
  templates: TemplateView[];
  aiStatus: AiStatus;
  aiUsage?: AiUsageView | null;
  onDetected: (files: File[], det: DetectOk) => void;
}) {
  const aiEnabled = aiStatus === 'ready';
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<{ name: string; mayBeScan: boolean } | null>(null);
  const [pending, start] = useTransition();
  const busy = pending || !!reading;

  const handle = (list: FileList | null | undefined) => {
    if (busy || !list?.length) return;
    // Contrôles sûrs avant toute conversion (nombre de pages, formats) ; volume vérifié après la réduction des pages.
    const dropped = [...list];
    const plain = dropped.filter((f) => !isHeic(f));
    const early = dropped.length > MAX_SCAN_PAGES ? importFilesError(dropped) : plain.length ? importFilesError(plain) : null;
    // Volume de plusieurs pages : contrôlé après leur réduction (prepareFiles).
    if (early && !(dropped.length > 1 && dropped.length <= MAX_SCAN_PAGES && /trop lourdes/.test(early))) { setError(early); return; }
    setError(null);
    const first = dropped[0];
    const mime = importMimeOf(first.name, first.type);
    const image = isHeic(first) || !!mime?.startsWith('image/');
    setReading({ name: dropped.length > 1 ? `${dropped.length} pages` : first.name, mayBeScan: aiEnabled && (image || mime === ACCEPTED_TYPES.pdf) });
    start(async () => {
      try {
        const prepared = await prepareFiles(dropped);
        if ('error' in prepared) { setError(prepared.error); return; }
        const res = await detectFile(prepared.files, templateId, aiEnabled);
        if (res.ok) onDetected(prepared.files, res);
        else setError(res.error);
      } catch {
        setError('Lecture impossible : la connexion au serveur a été interrompue. Réessayez.');
      } finally {
        setReading(null);
        if (input.current) input.current.value = '';
      }
    });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    handle(e.dataTransfer.files);
  };

  return (
    <div className="card" style={{ gap: 12 }}>
      <div style={{ display: 'grid', gap: 2 }}>
        <span className="card-kicker">Étape 1 · Dépôt du fichier</span>
        <span className="card-title" style={{ fontSize: 15 }}>Formulaire de plan de prévention rempli</span>
      </div>

      <div role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy}
        className={`${s.drop} ${dragging ? s.dragging : ''} ${busy ? s.busy : ''}`}
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => { if (!busy && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}>
        {reading ? (
          <>
            <span className={s.spin} aria-hidden><Icon name="ph-circle-notch" size={28} style={{ color: 'var(--color-accent)', display: 'block' }} /></span>
            <span style={{ fontSize: 13 }}>Lecture de « {reading.name} »…</span>
            {reading.mayBeScan && <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>Un scan ou une photo est lu par l&apos;API Claude : jusqu&apos;à une minute.</span>}
          </>
        ) : (
          <>
            <Icon name="ph-file-arrow-up" size={30} style={{ color: dragging ? 'var(--color-accent)' : 'var(--color-neutral-400)' }} />
            <span style={{ fontSize: 13 }}>Déposez le formulaire ici ou <span style={{ color: 'var(--color-accent)' }}>choisissez un fichier</span></span>
            <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>PDF remplissable, Word (.docx), scan PDF ou photo (JPG, PNG, WEBP, HEIC) · 10 Mo au maximum</span>
            <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>Formulaire papier photographié page par page : sélectionnez toutes les photos ensemble ({MAX_SCAN_PAGES} au plus).</span>
          </>
        )}
      </div>
      <input ref={input} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={(e) => handle(e.currentTarget.files)} />
      {error && <div role="alert" className="vg-form-error">{error}</div>}

      <div className="vg-form" style={{ gap: 10 }}>
        <Field name="templateId" label="Modèle d'import"
          hint={templates.length
            ? 'Facultatif : un formulaire déjà calibré est reconnu automatiquement. Choisir un modèle sert surtout pour un scan, lu avec les champs du modèle.'
            : "Aucun modèle enregistré : la correspondance est proposée d'après les libellés, puis s'enregistre comme modèle."}>
          <select id="templateId" className="input" value={templateId} disabled={busy || !templates.length} onChange={(e) => setTemplateId(e.target.value)} style={{ maxWidth: 460 }}>
            <option value="">Reconnaissance automatique</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {FORMAT_LABELS[t.format]}</option>)}
          </select>
        </Field>
      </div>

      {aiStatus === 'ready' ? (
        <Notice tone="accent" icon="ph-sparkle">
          Lecture des scans activée : un scan ou une photo est envoyé à l&apos;API Claude (Anthropic) pour en lire les cases cochées et les champs remplis.
          Les PDF remplissables et les fichiers Word sont lus sur le serveur Vigie, sans envoi extérieur.
          {aiUsage && <> {aiUsageText(aiUsage)}</>}
        </Notice>
      ) : aiStatus === 'no_credentials' ? (
        <Notice tone="warn" icon="ph-key">
          {AI_NO_CREDENTIALS_MESSAGE}. En attendant, les PDF remplissables et les fichiers Word sont lus sur le serveur Vigie ; un scan ou une photo est joint au plan et le plan se saisit à partir du fichier.
        </Notice>
      ) : (
        <Notice tone="neutral" icon="ph-info">
          {AI_DISABLED_MESSAGE}. Les PDF remplissables et les fichiers Word sont lus sur le serveur Vigie ; un scan ou une photo est joint au plan et le plan se saisit à partir du fichier.
        </Notice>
      )}
    </div>
  );
}
