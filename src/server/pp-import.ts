'use server';

// Import du formulaire de plan de prévention : détection des champs (PDF remplissable, Word, scan),
// modèles de correspondance et création du plan.
//
// Conservation du fichier entre les étapes : aucun fichier n'est écrit avant la création du plan.
// Le navigateur garde le fichier déposé et le renvoie avec le formulaire de création ; il est alors
// enregistré comme pièce jointe du plan (importedFromId). Un import abandonné ne laisse donc aucun fichier orphelin.

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { desc, eq } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { getDb, schema as t } from '@/db';
import { planStatus } from '@/lib/rules/prevention';
import { PLAN_ATTACHMENT } from '@/lib/data/prevention';
import { fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { formReader, type FormState } from '@/lib/forms';
import { requireInSite, requireManager } from '@/lib/guard';
import type { PpFormData, PpImportFormat } from '@/lib/pp-form';
import { config } from '@/lib/config';
import { SCAN_MAX_TOKENS, acceptsServerFallback, aiStatus } from '@/lib/pp-import/ai';
import { HEIC_MESSAGE, MAX_SCAN_PAGES, importFilesError, importName } from '@/lib/pp-import/files';
import { sniffImage } from '@/lib/file-type';
import { parseDocx } from '@/lib/pp-import/docx';
import { NEW_CONTRACTOR } from '@/lib/pp-import/draft';
import { TARGET_LABELS, keyOverlap, matchTemplate, signatureSource } from '@/lib/pp-import/mapping';
import { PASSWORD_WARNING, fieldsFromWidgets, parsePdfForm, type PdfParseResult, type PdfWidget } from '@/lib/pp-import/pdf-form';
import { enrichFromText, isGenericLabel, type TextItem } from '@/lib/pp-import/pdf-text';
import { IMPORT_FORMATS, readMapping, readMappingJson, readSections } from '@/lib/pp-import/schemas';
import { SCAN_SYSTEM, scanFields, scanPrompt, scanSchema, type ExpectedField, type ScanOutput } from '@/lib/pp-import/scan';
import { cleanLabel, humanize, normalize } from '@/lib/pp-import/text';
import {
  ACCEPTED_TYPES, AI_DISABLED_MESSAGE, AI_NO_CREDENTIALS_MESSAGE, ImportError, importMimeOf,
  type DetectResponse, type ImportField, type ParseResult,
} from '@/lib/pp-import/types';
import { UploadRefusedError, checkUpload, checkUploadBatch, deleteAttachment, saveUpload, type Attachment } from '@/lib/uploads';
import { UserLimitError, consumeUserLimit } from '@/lib/rate-limit';
import { aiQuotaProblem, cachedScan, finishAiCall, loadAiUsage, recordAiCacheHit, rememberScan, startAiCall } from './ai-usage';
import { log } from '@/lib/log';
import { logChange } from './changelog';
import { nextEntityReference } from './references';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ARCHIVED_CONTRACTOR = 'Entreprise archivée : réactivez-la dans l’onglet Entreprises extérieures.';
/** Taille maximale d'une image acceptée par l'API pour la lecture. */
const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024;
/** Pages d'un PDF protégé parcourues pour en lire les champs. */
const MAX_WIDGET_PAGES = 200;
/** Suite donnée à un échec de la lecture d'un scan. */
const MANUAL_ENTRY = 'Saisissez le plan à partir du fichier, qui sera joint au plan.';

const done = (id?: string | number): FormState => {
  revalidatePath('/', 'layout');
  return { ok: true, id: id == null ? undefined : String(id) };
};

type Received = { file: File; mime: string };

/**
 * Fichiers reçus, avec un type MIME fiable (certains navigateurs n'en donnent pas pour .docx) : un fichier, ou les photos
 * des pages d'un même formulaire (INT-14, importFilesError : règle commune avec le navigateur).
 */
function receivedFiles(values: FormDataEntryValue[]): { files: Received[] } | { error: string } {
  const sent = values.filter((v): v is File => v instanceof File && v.size > 0);
  if (!sent.length) return { error: 'Choisissez un fichier à importer.' };
  const problem = importFilesError(sent);
  if (problem) return { error: problem };
  const files: Received[] = [];
  for (const value of sent) {
    const mime = importMimeOf(value.name, value.type)!;
    const file = value.type === mime ? value : new File([value], value.name, { type: mime, lastModified: value.lastModified });
    const err = checkUpload(file);
    if (err) return { error: err };
    files.push({ file, mime });
  }
  return { files };
}

/**
 * Octets d'une page photographiée et son type réel (signature, src/lib/file-type.ts) : HEIC/HEIF refusé avec la marche à
 * suivre (l'API ne le lit pas), contenu qui n'est pas une image admise refusé ; PDF et Word : tels quels.
 */
async function pageOf({ file, mime }: Received): Promise<{ bytes: Uint8Array; mime: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!mime.startsWith('image/')) return { bytes, mime };
  const real = sniffImage(bytes);
  if (real === 'image/heic' || real === 'image/heif') throw new ImportError(HEIC_MESSAGE);
  if (real !== ACCEPTED_TYPES.jpeg && real !== ACCEPTED_TYPES.png && real !== ACCEPTED_TYPES.webp) {
    throw new ImportError(`« ${file.name} » ne correspond pas à une photo JPG, PNG ou WEBP : exportez-la de nouveau.`);
  }
  return { bytes, mime: real };
}

/** Modèles enregistrés, le plus récemment mis à jour en premier (il l'emporte si deux modèles ont la même empreinte). */
async function loadTemplates() {
  const db = await getDb();
  const rows = await db.select().from(t.ppImportTemplates).orderBy(desc(t.ppImportTemplates.createdAt), desc(t.ppImportTemplates.id));
  return rows.map((r) => ({ ...r, mapping: readMapping(r.mapping) ?? {} }));
}

// ─── Lecture des scans par l'API Claude ─────────────────────────────────────

/** Erreur levée par le SDK Anthropic → message français (classes d'erreur typées, de la plus précise à la plus générale). */
function apiError(e: unknown): ImportError {
  const fail = (message: string, retryable = false) => new ImportError(message, { retryable });
  if (e instanceof Anthropic.AuthenticationError) return fail("Clé d'API Anthropic invalide : vérifiez ANTHROPIC_API_KEY sur le serveur.");
  if (e instanceof Anthropic.PermissionDeniedError) return fail("Accès refusé par l'API Anthropic pour cette clé.");
  if (e instanceof Anthropic.NotFoundError) return fail("Modèle de lecture indisponible pour cette clé d'API Anthropic.");
  if (e instanceof Anthropic.RateLimitError) return fail("Limite d'utilisation de l'API Anthropic atteinte : réessayez dans une minute.", true);
  if (e instanceof Anthropic.BadRequestError) return fail("Document refusé par l'API Anthropic (fichier trop volumineux, protégé ou illisible).");
  if (e instanceof Anthropic.APIConnectionTimeoutError) return fail('Lecture trop longue : délai dépassé, réessayez.', true);
  if (e instanceof Anthropic.APIConnectionError) return fail('API Anthropic injoignable : vérifiez la connexion du serveur à Internet.', true);
  if (e instanceof Anthropic.InternalServerError) return fail('Service de lecture momentanément indisponible : réessayez dans quelques minutes.', true);
  if (e instanceof Anthropic.APIError) return fail(`Erreur du service de lecture (code ${e.status ?? 'inconnu'}) : réessayez.`, true);
  // Erreur du client avant tout appel : profil d'identifiants introuvable, configuration incorrecte.
  if (e instanceof Anthropic.AnthropicError) return fail("Client de l'API Anthropic mal configuré sur le serveur (identifiants, profil) : consultez le journal du serveur.");
  // Erreur hors SDK pendant l'appel : en pratique, aucune méthode d'authentification trouvée par le client.
  return fail("Clé d'API Anthropic absente : définir ANTHROPIC_API_KEY sur le serveur.");
}

type ScanResult = { fields: ImportField[]; warnings: string[] };

/** Jetons d'une réponse (usage) : entrée, sortie, écriture et lecture du cache de requête (INT-06). */
const usageOf = (u: Anthropic.Beta.BetaUsage | undefined) => ({
  input: u?.input_tokens ?? 0, output: u?.output_tokens ?? 0,
  cacheCreation: u?.cache_creation_input_tokens ?? 0, cacheRead: u?.cache_read_input_tokens ?? 0,
});

type Page = { bytes: Uint8Array; mime: string };
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Lit un scan (PDF, image, ou photos des pages d'un formulaire, INT-14) avec Claude ; `expected` = champs d'un modèle
 * choisi, pour réutiliser ses clés. Modèle et délai : VIGIE_AI_MODEL, VIGIE_AI_TIMEOUT (INT-13).
 * Coût (INT-06) : mêmes fichiers relus dans l'heure → résultat du cache, sans appel ; sinon plafonds vérifiés (lectures de la
 * personne sur 24 h, jetons du mois), appel journalisé dans ai_usage avec la consommation lue dans la réponse.
 */
async function readScan(pages: Page[], expected: ExpectedField[], personId: string): Promise<ScanResult> {
  if (pages.some((p) => p.mime !== ACCEPTED_TYPES.pdf && p.bytes.length > MAX_AI_IMAGE_BYTES)) {
    throw new ImportError('Image trop lourde pour la lecture automatique (5 Mo au maximum) : réduisez sa résolution ou numérisez-la en PDF.');
  }
  const { model } = config().aiScan;
  // Un fichier : son empreinte ; plusieurs pages : empreinte de la suite des empreintes (ordre des pages compris).
  const fileHash = pages.length === 1 ? sha256(pages[0].bytes) : sha256(new TextEncoder().encode(pages.map((p) => sha256(p.bytes)).join('|')));
  const cacheKey = `${model}|${fileHash}|${JSON.stringify(expected)}`;
  const cached = cachedScan<ScanResult>(cacheKey);
  if (cached) {
    await recordAiCacheHit(personId, model, fileHash);
    return { fields: cached.fields.map((f) => ({ ...f })), warnings: [...cached.warnings] };
  }
  const quota = aiQuotaProblem(await loadAiUsage(personId), config().aiLimits);
  if (quota) throw new ImportError(quota);
  const usageId = await startAiCall(personId, model, fileHash);
  const started = Date.now();
  const result = await callScan(pages, expected, async (outcome, response) => {
    await finishAiCall(usageId, { outcome, usage: usageOf(response?.usage), servedModel: response?.model ?? null, durationMs: Date.now() - started });
  });
  rememberScan(cacheKey, result);
  return result;
}

/** Appel de l'API Claude ; `settle` journalise le résultat de l'appel (une fois). */
async function callScan(
  pages: Page[], expected: ExpectedField[],
  settle: (outcome: 'ok' | 'refus' | 'erreur', response?: Anthropic.Beta.BetaMessage) => Promise<void>,
): Promise<ScanResult> {
  const media = pages.map(({ bytes, mime }): Anthropic.Beta.BetaContentBlockParam => {
    const data = Buffer.from(bytes).toString('base64');
    return mime === ACCEPTED_TYPES.pdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: mime as 'image/jpeg' | 'image/png' | 'image/webp', data } };
  });

  const schema = scanSchema(expected);
  const { model, timeoutMs } = config().aiScan;
  const client = new Anthropic({ timeout: timeoutMs, maxRetries: 1 });
  // Repli côté serveur si le modèle décline la lecture (classificateurs de sécurité), pour les modèles qui l'acceptent.
  const fallback = acceptsServerFallback(model);
  let response: Anthropic.Beta.BetaMessage;
  try {
    // INT-13 : appel en flux (stream + finalMessage) : ni délai HTTP d'une requête longue, ni plafond de sortie réduit.
    // Format de sortie sans fonction d'analyse : la réponse est lue après la raison d'arrêt (un refus après une sortie
    // partielle ou une sortie tronquée lèverait sinon une erreur de format).
    const { schema: jsonSchema } = betaZodOutputFormat(schema);
    response = await client.beta.messages.stream({
      model,
      max_tokens: SCAN_MAX_TOKENS,
      betas: [...(fallback ? ['server-side-fallback-2026-07-01'] : []), 'structured-outputs-2025-12-15'],
      ...(fallback ? { fallbacks: 'default' as const } : {}),
      system: SCAN_SYSTEM,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: jsonSchema } },
      messages: [{ role: 'user', content: [...media, { type: 'text', text: scanPrompt(expected, pages.length) }] }],
    }).finalMessage();
  } catch (e) {
    log.error('pp-import.error', 'lecture du scan', { error: e });
    await settle('erreur');
    throw apiError(e);
  }
  // Raison d'arrêt vérifiée avant de lire le contenu.
  if (response.stop_reason === 'refusal') {
    await settle('refus', response);
    log.warn('pp-import.refusal', 'Lecture du scan refusée par le service', { category: response.stop_details?.category ?? null });
    throw new ImportError('Lecture automatique refusée par le service pour ce document.');
  }
  if (response.stop_reason === 'max_tokens') {
    await settle('erreur', response);
    throw new ImportError('Formulaire trop long pour être lu en une fois : importez-le en plusieurs fichiers de quelques pages.');
  }
  // Après un repli sur un autre modèle, la réponse retenue est le dernier bloc de texte.
  const text = response.content.filter((b) => b.type === 'text').at(-1)?.text;
  let out: ScanOutput | null = null;
  try {
    const parsed = text ? schema.safeParse(JSON.parse(text)) : null;
    out = parsed?.success ? parsed.data : null;
  } catch {
    out = null;
  }
  if (!out) {
    await settle('erreur', response);
    log.error('pp-import.invalid-response', 'Réponse de lecture non conforme', { stopReason: response.stop_reason, length: text?.length ?? 0 });
    throw new ImportError('Réponse illisible du service de lecture : réessayez.', { retryable: true });
  }
  const warnings = [...new Set(out.warnings.map((w) => cleanLabel(w, 300)).filter(Boolean))].slice(0, 12);
  if (!out.isPreventionPlan) warnings.unshift('Ce document ne ressemble pas à un plan de prévention : vérifiez le fichier importé.');
  await settle('ok', response);
  const fields = scanFields(out, expected);
  if (!fields.length) warnings.push('Aucune case ni aucun champ lu dans ce scan : saisissez le plan à partir du fichier.');
  return { fields, warnings };
}

// ─── PDF remplissables : pdf.js (libellés, PDF protégés) ─────────────────────

/** pdf.js, chargé à l'exécution (hors bundle serveur). */
const loadPdfJs = () => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ 'pdfjs-dist/legacy/build/pdf.mjs');

/**
 * Widgets de formulaire de toutes les pages, lus avec pdf.js : il déchiffre un PDF protégé par un simple
 * mot de passe propriétaire (« protégé contre la modification »), ce que pdf-lib ne fait pas.
 * Renvoie null si le PDF exige un mot de passe d'ouverture.
 */
async function pdfWidgets(bytes: Uint8Array): Promise<PdfWidget[] | null> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const widgets: PdfWidget[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_WIDGET_PAGES); n++) {
      const page = await doc.getPage(n);
      for (const a of await page.getAnnotations({ intent: 'any' })) {
        if (a?.subtype === 'Widget') widgets.push({ ...a, page: n });
      }
      page.cleanup();
    }
    return widgets;
  } catch (e) {
    if (e instanceof pdfjs.PasswordException) return null;
    throw e;
  } finally {
    await task.destroy();
  }
}

/** PDF chiffré : champs relus avec pdf.js ; à défaut, le PDF reste traité comme un scan. */
async function readEncryptedPdf(bytes: Uint8Array, pdf: PdfParseResult): Promise<PdfParseResult> {
  try {
    const widgets = await pdfWidgets(bytes);
    if (!widgets) return { ...pdf, warnings: [PASSWORD_WARNING] };
    const read = fieldsFromWidgets(widgets, pdf.pageCount ?? 0);
    // Aucun champ : PDF protégé mais aplati ou numérisé, traité comme un scan sans autre avertissement.
    return read.fields.length ? read : { ...pdf, warnings: [] };
  } catch (e) {
    log.error('pp-import.error', 'PDF protégé', { error: e });
    return pdf;
  }
}

/** Texte des pages d'un PDF, lu avec pdf.js. */
async function pdfTextItems(bytes: Uint8Array, pages: number[]): Promise<TextItem[]> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const items: TextItem[] = [];
    for (const n of pages) {
      if (n < 1 || n > doc.numPages) continue;
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        items.push({ page: n, str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) });
      }
      page.cleanup();
    }
    return items;
  } finally {
    await task.destroy();
  }
}

/**
 * Champs sans infobulle au nom générique (« Case à cocher 12 »), ou d'un PDF protégé sans infobulle lisible :
 * libellé et section tirés du texte voisin sur la page.
 */
async function enrichPdfLabels(bytes: Uint8Array, pdf: PdfParseResult) {
  const prefer = new Set(pdf.preferText);
  const needs = pdf.fields.filter((f) => pdf.boxes[f.key] && (isGenericLabel(f.label) || !f.section || prefer.has(f.key)));
  if (!needs.length) return;
  try {
    const pages = [...new Set(needs.map((f) => pdf.boxes[f.key].page))].slice(0, 40);
    enrichFromText(needs, pdf.boxes, await pdfTextItems(bytes, pages), prefer);
    // Libellé imprimé « Date de … » : zone de date, comme pour un champ à infobulle.
    for (const f of needs) if (f.kind === 'text' && prefer.has(f.key) && /\bdate\b/.test(normalize(f.label))) f.kind = 'date';
  } catch (e) {
    log.error('pp-import.error', 'texte du PDF', { error: e });
  }
  const unnamed = pdf.fields.filter((f) => isGenericLabel(f.label)).length;
  if (unnamed) {
    pdf.warnings.push(unnamed > 1
      ? `${unnamed} champs sans libellé lisible (nom technique générique) : nommez-les à l'étape Correspondance, puis enregistrez le modèle.`
      : "Un champ sans libellé lisible (nom technique générique) : nommez-le à l'étape Correspondance, puis enregistrez le modèle.");
  }
}

// ─── Détection ──────────────────────────────────────────────────────────────

/** Étape 2 : lit le fichier déposé et rapproche ses champs des modèles enregistrés. */
export async function detectPpImport(fd: FormData): Promise<DetectResponse> {
  const { session, error } = await requireManager();
  if (error) return { ok: false, error };
  // SEC-07 : analyses de fichiers limitées par personne et par heure.
  try {
    await consumeUserLimit('ppDetect', session.user.id);
  } catch (e) {
    if (e instanceof UserLimitError) return { ok: false, error: e.message };
    throw e;
  }
  const received = receivedFiles(fd.getAll('file'));
  if ('error' in received) return { ok: false, error: received.error };
  const [{ mime }] = received.files;
  const chosenId = Number(fd.get('templateId')) || null;

  const templates = await loadTemplates();
  const chosen = chosenId ? templates.find((x) => x.id === chosenId) : undefined;
  if (chosenId && !chosen) return { ok: false, error: "Modèle d'import introuvable : il a peut-être été supprimé." };

  const ai = aiStatus(config());
  let result: ParseResult;
  let used = false;
  let aiError: { error: string; retryable: boolean } | undefined;
  // PDF à mot de passe d'ouverture : illisible aussi pour l'API Claude, il n'est pas envoyé.
  let locked = false;
  let pages: Page[];
  try {
    pages = await Promise.all(received.files.map(pageOf));
    const { bytes } = pages[0];
    // Plusieurs pages photographiées (INT-14) : un scan, lu en une fois.
    if (pages.length > 1) result = { format: 'scan', fields: [], warnings: [], pageCount: pages.length };
    else if (mime === ACCEPTED_TYPES.pdf) {
      let pdf = await parsePdfForm(bytes);
      if (pdf.encrypted) pdf = await readEncryptedPdf(bytes, pdf);
      locked = pdf.warnings.includes(PASSWORD_WARNING);
      if (pdf.format === 'pdf_form') await enrichPdfLabels(bytes, pdf);
      result = { format: pdf.format, fields: pdf.fields, warnings: pdf.warnings, pageCount: pdf.pageCount };
    } else if (mime === ACCEPTED_TYPES.docx) result = parseDocx(bytes);
    else result = { format: 'scan', fields: [], warnings: [] };
  } catch (e) {
    if (e instanceof ImportError) return { ok: false, error: e.message };
    log.error('pp-import.error', 'lecture du fichier', { error: e });
    return { ok: false, error: 'Lecture du fichier impossible : fichier endommagé ou format non reconnu.' };
  }

  if (result.format === 'scan' && !locked) {
    if (ai === 'ready') {
      // Modèle choisi au dépôt (même formulaire calibré en PDF, Word ou scan) : ses clés sont réutilisées.
      const expected: ExpectedField[] = chosen
        ? Object.entries(chosen.mapping).map(([key, e]) => ({
          key,
          label: 'label' in e ? e.label : 'target' in e ? TARGET_LABELS[e.target] : humanize(key.split(/[./]/).pop() ?? key),
          section: 'section' in e ? e.section : undefined,
        }))
        : [];
      try {
        const scan = await readScan(pages, expected, session.user.id);
        result = { ...result, fields: scan.fields, warnings: [...result.warnings, ...scan.warnings] };
        used = true;
      } catch (e) {
        // Échec de la lecture (refus, panne, réponse illisible) : le plan reste saisissable à partir du fichier.
        if (!(e instanceof ImportError)) log.error('pp-import.error', 'lecture du scan', { error: e });
        aiError = e instanceof ImportError
          ? { error: e.message, retryable: e.retryable }
          : { error: 'Lecture du scan impossible : réessayez.', retryable: true };
      }
    } else {
      result.warnings.push(`${ai === 'no_credentials' ? AI_NO_CREDENTIALS_MESSAGE : AI_DISABLED_MESSAGE}. ${MANUAL_ENTRY}`);
    }
  }

  const keys = result.fields.map((f) => f.key);
  const signature = result.format !== 'scan' && keys.length
    ? createHash('sha256').update(signatureSource(keys)).digest('hex')
    : null;
  let matchedTemplateId: number | null = null;
  let proposedTemplate: { id: number; overlap: number } | null = null;
  if (chosen) {
    matchedTemplateId = chosen.id;
    const overlap = keyOverlap(keys, Object.keys(chosen.mapping));
    if (keys.length && overlap < 0.5) {
      result.warnings.push(`Le modèle « ${chosen.name} » ne correspond qu'à ${Math.round(overlap * 100)} % des champs détectés : vérifiez la correspondance.`);
    }
  } else if (keys.length) {
    const m = matchTemplate(result.format, signature, keys, templates);
    matchedTemplateId = m.matchedId;
    proposedTemplate = m.proposed;
  }

  return {
    ok: true,
    fileName: importName(received.files.map((x) => x.file.name)),
    format: result.format,
    fields: result.fields,
    signature,
    matchedTemplateId,
    proposedTemplate,
    warnings: [...new Set(result.warnings)],
    pageCount: result.pageCount,
    ai: { used, available: ai === 'ready', ...aiError },
  };
}

// ─── Modèles d'import ───────────────────────────────────────────────────────

const sameName = (a: string, b: string) => a.toLocaleLowerCase('fr') === b.toLocaleLowerCase('fr');

/**
 * Enregistre un modèle (nouveau ou existant). `merge` conserve les clés déjà connues du modèle
 * (mise à jour depuis un autre fichier du même formulaire) ; sinon la correspondance est remplacée.
 */
export async function savePpTemplate(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { min: 1 });
  const name = f.str('name', { required: true, max: 120 });
  const format = f.oneOf('format', IMPORT_FORMATS, { required: true });
  const signature = f.opt('signature');
  const merge = f.bool('merge');
  const mapping = readMappingJson(f.str('mapping'));
  if (signature && !/^[0-9a-f]{64}$/.test(signature)) f.fail('signature', 'Empreinte invalide.');
  if (!mapping) return { error: 'Correspondance invalide : rechargez la page puis recommencez.' };
  if (!Object.keys(mapping).length) return { error: 'Aucun champ à enregistrer dans le modèle.' };
  if (!f.ok) return f.state();

  const db = await getDb();
  const rows = await db.select({
    id: t.ppImportTemplates.id, name: t.ppImportTemplates.name, format: t.ppImportTemplates.format, signature: t.ppImportTemplates.signature,
  }).from(t.ppImportTemplates);
  if (rows.some((r) => r.id !== id && sameName(r.name, name))) {
    return { error: 'Un modèle porte déjà ce nom.', fieldErrors: { name: 'Nom déjà utilisé.' } };
  }
  // Un formulaire (même format, même empreinte) n'est reconnu que par un seul modèle.
  const twinOf = (fmt: string, sig: string | null) => (sig ? rows.find((r) => r.id !== id && r.format === fmt && r.signature === sig) : undefined);
  const twinError = (twin: { name: string }): FormState => ({
    error: `Ce formulaire est déjà reconnu par le modèle « ${twin.name} » : mettez à jour ce modèle-là.`,
    fieldErrors: { name: `Formulaire déjà reconnu par le modèle « ${twin.name} ».` },
  });
  // La colonne created_at sert de date de dernière mise à jour (le schéma n'a pas de colonne dédiée).
  const stamp = { createdAt: new Date(), updatedById: session.user.id };
  if (id) {
    const [existing] = await db.select().from(t.ppImportTemplates).where(eq(t.ppImportTemplates.id, id));
    if (!existing) return { error: "Modèle d'import introuvable." };
    const next = merge ? { ...(readMapping(existing.mapping) ?? {}), ...mapping } : mapping;
    if (Object.keys(next).length > 1000) return { error: 'Modèle trop volumineux (1 000 champs au maximum).' };
    // Le format d'un modèle est fixé à sa création (un scan lu avec un modèle PDF ne le transforme pas en modèle de scan).
    const nextSignature = existing.format === format ? signature ?? existing.signature : existing.signature;
    const twin = twinOf(existing.format, nextSignature);
    if (twin) return twinError(twin);
    await db.update(t.ppImportTemplates)
      .set({ name, signature: nextSignature, mapping: next, ...stamp })
      .where(eq(t.ppImportTemplates.id, id));
    return done(id);
  }
  const twin = twinOf(format!, signature);
  if (twin) return twinError(twin);
  const [row] = await db.insert(t.ppImportTemplates)
    .values({ name, format: format!, signature, mapping, ...stamp })
    .returning({ id: t.ppImportTemplates.id });
  return done(row.id);
}

/** Renomme un modèle. */
export async function renamePpTemplate(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const name = f.str('name', { required: true, max: 120 });
  if (!f.ok) return f.state();
  const db = await getDb();
  const rows = await db.select({ id: t.ppImportTemplates.id, name: t.ppImportTemplates.name }).from(t.ppImportTemplates);
  if (!rows.some((r) => r.id === id)) return { error: "Modèle d'import introuvable." };
  if (rows.some((r) => r.id !== id && sameName(r.name, name))) {
    return { error: 'Un modèle porte déjà ce nom.', fieldErrors: { name: 'Nom déjà utilisé.' } };
  }
  await db.update(t.ppImportTemplates).set({ name, createdAt: new Date(), updatedById: session.user.id }).where(eq(t.ppImportTemplates.id, id!));
  return done(id!);
}

/** Supprime un modèle (les plans déjà importés gardent leur grille). */
export async function deletePpTemplate(id: number): Promise<{ error?: string }> {
  const { error } = await requireManager();
  if (error) return { error };
  if (!Number.isInteger(id) || id < 1) return { error: "Modèle d'import introuvable." };
  const db = await getDb();
  const [row] = await db.delete(t.ppImportTemplates).where(eq(t.ppImportTemplates.id, id)).returning({ id: t.ppImportTemplates.id });
  if (!row) return { error: "Modèle d'import introuvable." };
  revalidatePath('/', 'layout');
  return {};
}

// ─── Création du plan ───────────────────────────────────────────────────────

/**
 * Crée le plan de prévention vérifié à l'étape 4 : entreprise existante ou créée, statut dérivé
 * (brouillon → à signer → signé), grille du formulaire (formData) et fichier source joint (importedFromId).
 */
export async function createPlanFromImport(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const received = receivedFiles(fd.getAll('file'));
  if ('error' in received) return { error: fd.get('file') instanceof File ? received.error : 'Fichier importé manquant : recommencez l’import.' };
  const files = received.files.map((x) => x.file);
  // « 1 200 » : séparateur de milliers usuel en français.
  const hoursRaw = fd.get('estimatedHours');
  if (typeof hoursRaw === 'string') fd.set('estimatedHours', hoursRaw.replace(/\s/g, ''));
  const f = formReader(fd);
  const format = f.oneOf<PpImportFormat>('format', IMPORT_FORMATS, { required: true });
  const templateId = f.int('templateId', { min: 1 });
  const sections = readSections(f.str('sections') || '[]');
  if (!sections) return { error: 'Grille du formulaire invalide : recommencez l’import.' };
  if (files.length > 1 && format !== 'scan') return { error: 'Plusieurs pages : import d’un scan seulement, recommencez l’import.' };

  const contractorChoice = f.str('contractorId', { required: true });
  const isNew = contractorChoice === NEW_CONTRACTOR;
  const newName = isNew ? f.str('contractorName', { required: true, max: 120 }) : '';
  const newTrade = isNew ? f.str('contractorTrade', { required: true, max: 120 }) : '';
  const contactName = isNew ? f.str('contactName', { max: 120 }) || null : null;
  const contactPhone = isNew ? f.str('contactPhone', { max: 40 }) || null : null;
  const contactEmail = isNew ? f.str('contactEmail', { max: 160 }) || null : null;
  if (contactEmail && !EMAIL.test(contactEmail)) f.fail('contactEmail', 'Adresse e-mail invalide.');

  const siteId = f.str('siteId', { required: true });
  const title = f.str('title', { required: true, max: 200 });
  const location = f.str('location', { required: true, max: 160 });
  const startOn = f.date('startOn', { required: true });
  const endOn = f.date('endOn', { required: true });
  const estimatedHours = f.int('estimatedHours', { required: true, min: 0, max: 100_000 });
  const dangerousWork = f.bool('dangerousWork');
  const keystoneProject = f.opt('keystoneProject');
  const inspectionOn = f.date('inspectionOn');
  const interferenceRisks = f.str('interferenceRisks', { max: 4000 });
  const measures = f.str('measures', { max: 4000 });
  const ownerId = f.opt('ownerId');
  const signedEuOn = f.date('signedEuOn');
  const signedEeOn = f.date('signedEeOn');
  const now = today();
  if (startOn && endOn && endOn < startOn) f.fail('endOn', 'La fin ne peut pas précéder le début.');
  if (inspectionOn && endOn && inspectionOn > endOn) f.fail('inspectionOn', "L'inspection commune doit avoir lieu au plus tard le dernier jour de l'intervention.");
  if (signedEuOn && signedEuOn > now) f.fail('signedEuOn', 'La date de signature ne peut pas être future.');
  if (signedEeOn && signedEeOn > now) f.fail('signedEeOn', 'La date de signature ne peut pas être future.');
  const firstSignature = [signedEuOn, signedEeOn].filter((d): d is string => !!d).sort()[0];
  if (firstSignature) {
    if (!inspectionOn) f.fail('inspectionOn', "Plan signé : renseignez la date de l'inspection commune préalable.");
    else if (inspectionOn > firstSignature) f.fail('inspectionOn', `L'inspection commune doit précéder les signatures (au plus tard le ${fmtDate(firstSignature)}).`);
    if (!measures) f.fail('measures', 'Plan signé : complétez les mesures de prévention.');
  }

  const db = await getDb();
  const [contractors, sites, people, projects, templates] = await Promise.all([
    db.select({ id: t.contractors.id, name: t.contractors.name, archivedAt: t.contractors.archivedAt }).from(t.contractors),
    db.select({ id: t.sites.id }).from(t.sites),
    db.select({ id: t.people.id }).from(t.people),
    db.select({ id: t.keystoneProjects.id, client: t.keystoneProjects.client }).from(t.keystoneProjects),
    db.select({ id: t.ppImportTemplates.id }).from(t.ppImportTemplates),
  ]);
  // Entreprise à créer déjà connue sous le même nom : le plan lui est rattaché, sauf si elle est archivée (comme savePlan).
  const existingByName = isNew ? contractors.find((c) => sameName(c.name, newName)) : undefined;
  const chosen = isNew ? undefined : contractors.find((c) => c.id === contractorChoice);
  if (!isNew && contractorChoice && !chosen) f.fail('contractorId', 'Entreprise introuvable.');
  else if (chosen?.archivedAt) f.fail('contractorId', ARCHIVED_CONTRACTOR);
  if (existingByName?.archivedAt) f.fail('contractorName', 'Entreprise archivée sous ce nom : réactivez-la dans l’onglet Entreprises extérieures.');
  if (siteId && !sites.some((s) => s.id === siteId)) f.fail('siteId', 'Site inconnu.');
  if (ownerId && !people.some((p) => p.id === ownerId)) f.fail('ownerId', 'Personne inconnue.');
  if (keystoneProject && !projects.some((p) => `${p.id} · ${p.client}` === keystoneProject)) f.fail('keystoneProject', 'Projet Keystone inconnu.');
  if (!f.ok) return f.state();
  const siteError = await requireInSite(siteId, { create: true });
  if (siteError) return { error: siteError };
  // Contenu, antivirus et limites de la personne contrôlés avant de réserver la référence (pages jointes au plan, INT-14).
  const uploadError = await checkUploadBatch(files, session.user.id, { maxFiles: MAX_SCAN_PAGES });
  if (uploadError) return { error: uploadError };

  // Référence du plan réservée sous verrou avant l'enregistrement du fichier source, qui la porte (PRD-08) : jamais
  // réattribuée, même si la création échoue ensuite (brouillons supprimés compris). Celle d'une nouvelle entreprise est
  // tirée dans la transaction de création.
  const planId = await db.transaction((tx) => nextEntityReference(tx, 'prevention_plan', `PP-${now.slice(0, 4)}-`, 3));
  const createContractor = isNew && !existingByName;
  const formData: PpFormData = {
    source: {
      fileName: importName(files.map((x) => x.name)).slice(0, 200),
      format: format!,
      templateId: templateId && templates.some((x) => x.id === templateId) ? templateId : null,
      importedOn: now,
    },
    sections,
  };
  const values = {
    siteId, title, location, startOn: startOn!, endOn: endOn!, estimatedHours: estimatedHours!, dangerousWork,
    keystoneProject, inspectionOn, interferenceRisks, measures, ownerId,
    signedEuOn: signedEuOn ?? null, signedEeOn: signedEeOn ?? null,
  };
  const status = planStatus({ ...values, status: 'brouillon' }, now);

  // Fichier source d'abord (clé étrangère importedFromId : la première page), pages suivantes jointes au plan ; tous retirés
  // si le plan ne peut pas être créé.
  const saved: Attachment[] = [];
  const removeSaved = async () => { for (const a of saved) await deleteAttachment(a.id); };
  try {
    for (const file of files) saved.push(await saveUpload(file, PLAN_ATTACHMENT, planId, session.user.id));
  } catch (e) {
    await removeSaved();
    if (e instanceof UploadRefusedError) return { error: e.message };
    log.error('pp-import.error', 'enregistrement du fichier', { error: e });
    return { error: "Le fichier importé n'a pas pu être enregistré : réessayez." };
  }
  const attachmentId = saved[0].id;
  try {
    await db.transaction(async (tx) => {
      const newContractorId = createContractor ? await nextEntityReference(tx, 'contractor', 'EE-', 3) : null;
      if (newContractorId) {
        await tx.insert(t.contractors).values({ id: newContractorId, name: newName, trade: newTrade, contactName, contactPhone, contactEmail });
        await logChange(tx, { entityType: 'contractor', entityId: newContractorId, action: 'create', summary: 'Entreprise ajoutée (import d’un plan de prévention)', byId: session.user.id });
      }
      const contractorId = existingByName?.id ?? newContractorId ?? contractorChoice;
      await tx.insert(t.preventionPlans).values({ id: planId, ...values, contractorId, status, formData, importedFromId: attachmentId });
      await logChange(tx, { entityType: 'prevention_plan', entityId: planId, action: 'create', summary: `Plan de prévention créé par import (${formData.source.fileName})`, byId: session.user.id });
    });
  } catch (e) {
    log.error('pp-import.error', 'création du plan', { error: e });
    await removeSaved();
    return { error: "Le plan n'a pas pu être créé (enregistrement concurrent ?) : réessayez." };
  }
  return done(planId);
}
