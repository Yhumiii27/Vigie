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
import { planStatus } from '@/components/prevention/model';
import { PLAN_ATTACHMENT } from '@/lib/data/prevention';
import { fmtDate, today } from '@/lib/dates';
import { formReader, nextRef, type FormState } from '@/lib/forms';
import { requireManager } from '@/lib/guard';
import type { PpFormData, PpImportFormat } from '@/lib/pp-form';
import { aiStatus } from '@/lib/pp-import/ai';
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
import { checkUpload, deleteAttachment, saveUpload } from '@/lib/uploads';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Modèle Claude utilisé pour la lecture des scans. */
const SCAN_MODEL = 'claude-opus-5-5';
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

/** Fichier reçu, avec un type MIME fiable (certains navigateurs n'en donnent pas pour .docx). */
function receivedFile(value: FormDataEntryValue | null): { file: File; mime: string } | { error: string } {
  if (!(value instanceof File) || !value.size) return { error: 'Choisissez un fichier à importer.' };
  const mime = importMimeOf(value.name, value.type);
  if (!mime) return { error: `Format non accepté pour « ${value.name} » : PDF, Word (.docx), JPG, PNG ou WEBP.` };
  const file = value.type === mime ? value : new File([value], value.name, { type: mime, lastModified: value.lastModified });
  const err = checkUpload(file);
  return err ? { error: err } : { file, mime };
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

/** Lit un scan (PDF ou image) avec Claude ; `expected` = champs d'un modèle choisi, pour réutiliser ses clés. */
async function readScan(bytes: Uint8Array, mime: string, expected: ExpectedField[]): Promise<{ fields: ImportField[]; warnings: string[] }> {
  if (mime !== ACCEPTED_TYPES.pdf && bytes.length > MAX_AI_IMAGE_BYTES) {
    throw new ImportError('Image trop lourde pour la lecture automatique (5 Mo au maximum) : réduisez sa résolution ou numérisez-la en PDF.');
  }
  const data = Buffer.from(bytes).toString('base64');
  const media: Anthropic.Beta.BetaContentBlockParam = mime === ACCEPTED_TYPES.pdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: mime as 'image/jpeg' | 'image/png' | 'image/webp', data } };

  const schema = scanSchema(expected);
  const client = new Anthropic({ timeout: 5 * 60_000, maxRetries: 1 });
  let response: Anthropic.Beta.BetaMessage;
  try {
    // create() et non parse() : parse() analyse la réponse avant que la raison d'arrêt puisse être lue
    // (un refus après une sortie partielle ou une sortie tronquée lèverait une erreur de format).
    response = await client.beta.messages.create({
      model: SCAN_MODEL,
      max_tokens: 16000,
      // Repli côté serveur si le modèle décline la lecture (classificateurs de sécurité) ; sorties structurées.
      betas: ['server-side-fallback-2026-07-01', 'structured-outputs-2025-12-15'],
      fallbacks: 'default',
      system: SCAN_SYSTEM,
      output_config: { effort: 'high', format: betaZodOutputFormat(schema) },
      messages: [{ role: 'user', content: [media, { type: 'text', text: scanPrompt(expected) }] }],
    });
  } catch (e) {
    console.error('[pp-import] lecture du scan', e);
    throw apiError(e);
  }
  // Raison d'arrêt vérifiée avant de lire le contenu.
  if (response.stop_reason === 'refusal') {
    console.error('[pp-import] lecture du scan refusée', response.stop_details);
    throw new ImportError('Lecture automatique refusée par le service pour ce document.');
  }
  if (response.stop_reason === 'max_tokens') throw new ImportError('Formulaire trop long pour être lu en une fois : importez-le en plusieurs fichiers de quelques pages.');
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
    console.error('[pp-import] réponse de lecture non conforme', response.stop_reason, text?.slice(0, 500));
    throw new ImportError('Réponse illisible du service de lecture : réessayez.', { retryable: true });
  }
  const warnings = [...new Set(out.warnings.map((w) => cleanLabel(w, 300)).filter(Boolean))].slice(0, 12);
  if (!out.isPreventionPlan) warnings.unshift('Ce document ne ressemble pas à un plan de prévention : vérifiez le fichier importé.');
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
    console.error('[pp-import] PDF protégé', e);
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
    console.error('[pp-import] texte du PDF', e);
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
  const { error } = await requireManager();
  if (error) return { ok: false, error };
  const received = receivedFile(fd.get('file'));
  if ('error' in received) return { ok: false, error: received.error };
  const { file, mime } = received;
  const chosenId = Number(fd.get('templateId')) || null;

  const templates = await loadTemplates();
  const chosen = chosenId ? templates.find((x) => x.id === chosenId) : undefined;
  if (chosenId && !chosen) return { ok: false, error: "Modèle d'import introuvable : il a peut-être été supprimé." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ai = aiStatus();
  let result: ParseResult;
  let used = false;
  let aiError: { error: string; retryable: boolean } | undefined;
  // PDF à mot de passe d'ouverture : illisible aussi pour l'API Claude, il n'est pas envoyé.
  let locked = false;
  try {
    if (mime === ACCEPTED_TYPES.pdf) {
      let pdf = await parsePdfForm(bytes);
      if (pdf.encrypted) pdf = await readEncryptedPdf(bytes, pdf);
      locked = pdf.warnings.includes(PASSWORD_WARNING);
      if (pdf.format === 'pdf_form') await enrichPdfLabels(bytes, pdf);
      result = { format: pdf.format, fields: pdf.fields, warnings: pdf.warnings, pageCount: pdf.pageCount };
    } else if (mime === ACCEPTED_TYPES.docx) result = parseDocx(bytes);
    else result = { format: 'scan', fields: [], warnings: [] };
  } catch (e) {
    if (e instanceof ImportError) return { ok: false, error: e.message };
    console.error('[pp-import] lecture du fichier', e);
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
        const scan = await readScan(bytes, mime, expected);
        result = { ...result, fields: scan.fields, warnings: [...result.warnings, ...scan.warnings] };
        used = true;
      } catch (e) {
        // Échec de la lecture (refus, panne, réponse illisible) : le plan reste saisissable à partir du fichier.
        if (!(e instanceof ImportError)) console.error('[pp-import] lecture du scan', e);
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
    fileName: file.name,
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
  const received = receivedFile(fd.get('file'));
  if ('error' in received) return { error: fd.get('file') instanceof File ? received.error : 'Fichier importé manquant : recommencez l’import.' };
  // « 1 200 » : séparateur de milliers usuel en français.
  const hoursRaw = fd.get('estimatedHours');
  if (typeof hoursRaw === 'string') fd.set('estimatedHours', hoursRaw.replace(/\s/g, ''));
  const f = formReader(fd);
  const format = f.oneOf<PpImportFormat>('format', IMPORT_FORMATS, { required: true });
  const templateId = f.int('templateId', { min: 1 });
  const sections = readSections(f.str('sections') || '[]');
  if (!sections) return { error: 'Grille du formulaire invalide : recommencez l’import.' };

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
    db.select({ id: t.contractors.id, name: t.contractors.name }).from(t.contractors),
    db.select({ id: t.sites.id }).from(t.sites),
    db.select({ id: t.people.id }).from(t.people),
    db.select({ id: t.keystoneProjects.id, client: t.keystoneProjects.client }).from(t.keystoneProjects),
    db.select({ id: t.ppImportTemplates.id }).from(t.ppImportTemplates),
  ]);
  // Entreprise à créer déjà connue sous le même nom : le plan lui est rattaché.
  const existingByName = isNew ? contractors.find((c) => sameName(c.name, newName)) : undefined;
  if (!isNew && contractorChoice && !contractors.some((c) => c.id === contractorChoice)) f.fail('contractorId', 'Entreprise introuvable.');
  if (siteId && !sites.some((s) => s.id === siteId)) f.fail('siteId', 'Site inconnu.');
  if (ownerId && !people.some((p) => p.id === ownerId)) f.fail('ownerId', 'Personne inconnue.');
  if (keystoneProject && !projects.some((p) => `${p.id} · ${p.client}` === keystoneProject)) f.fail('keystoneProject', 'Projet Keystone inconnu.');
  if (!f.ok) return f.state();

  const planIds = (await db.select({ id: t.preventionPlans.id }).from(t.preventionPlans)).map((r) => r.id);
  const planId = nextRef(planIds, `PP-${now.slice(0, 4)}-`, 3);
  const newContractorId = isNew && !existingByName ? nextRef(contractors.map((c) => c.id), 'EE-', 3) : null;
  const contractorId = existingByName?.id ?? newContractorId ?? contractorChoice;
  const formData: PpFormData = {
    source: {
      fileName: received.file.name.slice(0, 200),
      format: format!,
      templateId: templateId && templates.some((x) => x.id === templateId) ? templateId : null,
      importedOn: now,
    },
    sections,
  };
  const values = {
    siteId, contractorId, title, location, startOn: startOn!, endOn: endOn!, estimatedHours: estimatedHours!, dangerousWork,
    keystoneProject, inspectionOn, interferenceRisks, measures, ownerId,
    signedEuOn: signedEuOn ?? null, signedEeOn: signedEeOn ?? null,
  };
  const status = planStatus({ ...values, status: 'brouillon' }, now);

  // Fichier source d'abord (clé étrangère importedFromId), retiré si le plan ne peut pas être créé.
  let attachmentId: string;
  try {
    attachmentId = (await saveUpload(received.file, PLAN_ATTACHMENT, planId, session.user.id)).id;
  } catch (e) {
    console.error('[pp-import] enregistrement du fichier', e);
    return { error: "Le fichier importé n'a pas pu être enregistré : réessayez." };
  }
  try {
    await db.transaction(async (tx) => {
      if (newContractorId) {
        await tx.insert(t.contractors).values({ id: newContractorId, name: newName, trade: newTrade, contactName, contactPhone, contactEmail });
      }
      await tx.insert(t.preventionPlans).values({ id: planId, ...values, status, formData, importedFromId: attachmentId });
    });
  } catch (e) {
    console.error('[pp-import] création du plan', e);
    await deleteAttachment(attachmentId);
    return { error: "Le plan n'a pas pu être créé (enregistrement concurrent ?) : réessayez." };
  }
  return done(planId);
}
