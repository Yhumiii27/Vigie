'use client';

import { useRef, useState, useTransition, type DragEvent } from 'react';
import { Field } from '@/components/form';
import { Notice } from '@/components/prevention/parts';
import { Icon } from '@/components/ui';
import {
  ACCEPT_ATTR, ACCEPTED_TYPES, AI_DISABLED_MESSAGE, AI_NO_CREDENTIALS_MESSAGE, FORMAT_LABELS, MAX_IMPORT_BYTES, importMimeOf,
  type AiStatus, type AiUsageView, type DetectResponse, type TemplateView,
} from '@/lib/pp-import/types';
import { detectPpImport } from '@/server/pp-import';
import s from './pp-import.module.css';

export type DetectOk = Extract<DetectResponse, { ok: true }>;

/** Taille au-delà de laquelle une photo est réduite avant lecture (l'API accepte 5 Mo par image). */
const READING_IMAGE_BYTES = 4.5 * 1024 * 1024;
const READING_MAX_EDGE = 2600;

/**
 * Copie d'une photo pour la lecture automatique : réduite (bord ≤ 2 600 px, JPEG) si elle est trop lourde.
 * Le fichier d'origine reste celui qui est joint au plan.
 */
async function readingCopy(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const edge = Math.max(bitmap.width, bitmap.height);
    if (file.size <= READING_IMAGE_BYTES && edge <= 4000) {
      bitmap.close();
      return file;
    }
    const scale = Math.min(1, READING_MAX_EDGE / edge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    for (const quality of [0.9, 0.8, 0.7, 0.6]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= READING_IMAGE_BYTES) return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
    }
  } catch {
    // Image non décodable par le navigateur : envoyée telle quelle, le serveur indiquera l'erreur.
  }
  return file;
}

/**
 * Envoie le fichier (type MIME déjà fiable) au serveur pour détection. Une photo lue par l'API Claude est envoyée
 * en copie réduite si elle est trop lourde ; `templateId` = modèle choisi au dépôt (clés réutilisées pour un scan).
 */
export async function detectFile(file: File, templateId: number | string | null, aiReady: boolean): Promise<DetectResponse> {
  const fd = new FormData();
  fd.set('file', aiReady && file.type.startsWith('image/') ? await readingCopy(file) : file);
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
  onDetected: (file: File, det: DetectOk) => void;
}) {
  const aiEnabled = aiStatus === 'ready';
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<{ name: string; mayBeScan: boolean } | null>(null);
  const [pending, start] = useTransition();
  const busy = pending || !!reading;

  const handle = (files: FileList | null | undefined) => {
    if (busy || !files?.length) return;
    if (files.length > 1) { setError('Déposez un seul fichier à la fois.'); return; }
    const file = files[0];
    const mime = importMimeOf(file.name, file.type);
    if (!mime) { setError(`Format non accepté pour « ${file.name} » : PDF, Word (.docx), JPG, PNG ou WEBP.`); return; }
    if (!file.size) { setError(`« ${file.name} » est vide.`); return; }
    if (file.size > MAX_IMPORT_BYTES) { setError(`« ${file.name} » dépasse 10 Mo.`); return; }
    setError(null);
    const typed = file.type === mime ? file : new File([file], file.name, { type: mime, lastModified: file.lastModified });
    const image = mime.startsWith('image/');
    setReading({ name: file.name, mayBeScan: aiEnabled && (image || mime === ACCEPTED_TYPES.pdf) });
    start(async () => {
      try {
        const res = await detectFile(typed, templateId, aiEnabled);
        if (res.ok) onDetected(typed, res);
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

      <div role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy} aria-label="Déposer ou choisir le formulaire à importer"
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
            <span style={{ fontSize: 11.5, color: 'var(--color-neutral-500)' }}>PDF remplissable, Word (.docx), scan PDF ou photo (JPG, PNG, WEBP) · 10 Mo au maximum</span>
          </>
        )}
      </div>
      <input ref={input} type="file" accept={ACCEPT_ATTR} hidden onChange={(e) => handle(e.currentTarget.files)} />
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
