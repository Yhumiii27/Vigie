import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { config } from './config';
import { canEdit, canManage, canSee, isEmployee, type Role } from './domain';
import { decryptBuffer, encryptBuffer, fileKeys, isEncrypted } from './encryption';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|application\/msword|application\/vnd\.ms-excel|text\/plain|text\/csv)$/;

/** Dossier des pièces jointes (VIGIE_UPLOAD_DIR, absolu ; .data/uploads par défaut). */
const uploadDir = () => config().uploadDir;
/**
 * Clés des pièces jointes (PRD-02) : VIGIE_UPLOAD_KEY chiffre les nouveaux fichiers (AES-256-GCM, src/lib/encryption.ts) ;
 * VIGIE_UPLOAD_KEY_PREVIOUS reste lisible pendant une rotation. Sans clé, fichiers en clair ; les fichiers en clair
 * existants restent lisibles (npm run uploads:encrypt les chiffre).
 */
const uploadKeys = () => fileKeys([config().uploadKey, config().uploadKeyPrevious], 'pieces-jointes');

export type Attachment = typeof t.attachments.$inferSelect;

/** Contrôle un fichier avant enregistrement ; renvoie un message d'erreur ou null. */
export function checkUpload(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return `« ${file.name} » dépasse ${MAX_UPLOAD_BYTES / 1024 / 1024} Mo.`;
  if (!ALLOWED.test(file.type)) return `Format non accepté pour « ${file.name} » (images, PDF, Word, Excel, texte).`;
  return null;
}

/** Enregistre un fichier sur disque et le rattache à une entité (event, document_version, control_record…). */
export async function saveUpload(file: File, entityType: string, entityId: string, uploadedBy: string | null): Promise<Attachment> {
  const err = checkUpload(file);
  if (err) throw new Error(err);
  const id = randomUUID();
  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  const data = Buffer.from(await file.arrayBuffer());
  // Contenu qui commence par l'en-tête de chiffrement de Vigie (aucun fichier légitime) : il serait pris, à la lecture,
  // pour un fichier chiffré (illisible sans clé, « autre clé » avec) et fausserait npm run uploads:encrypt.
  if (isEncrypted(data)) throw new Error(`« ${file.name} » est refusé : son contenu imite un fichier chiffré par Vigie.`);
  const [key] = uploadKeys();
  await writeFile(path.join(/*turbopackIgnore: true*/ dir, id), key ? encryptBuffer(data, key) : data);
  const db = await getDb();
  const [row] = await db.insert(t.attachments).values({
    id, entityType, entityId, fileName: file.name.slice(0, 200) || 'fichier', mimeType: file.type, size: file.size, storagePath: id, uploadedBy,
  }).returning();
  return row;
}

export async function listAttachments(entityType: string, entityId: string) {
  const db = await getDb();
  return db.select().from(t.attachments).where(and(eq(t.attachments.entityType, entityType), eq(t.attachments.entityId, entityId)));
}

export async function readAttachment(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(t.attachments).where(eq(t.attachments.id, id));
  if (!row) return null;
  let stored: Buffer;
  try {
    stored = await readFile(path.join(/*turbopackIgnore: true*/ uploadDir(), path.basename(row.storagePath)));
  } catch {
    return null;
  }
  try {
    return { row, data: decryptBuffer(stored, uploadKeys()) };
  } catch (err) {
    // Clé absente ou différente, fichier altéré : la pièce est indisponible (404), l'exploitant en est averti.
    console.error(`[vigie] Pièce jointe ${row.id} illisible : ${(err as Error).message}`);
    return null;
  }
}

export async function deleteAttachment(id: string) {
  const db = await getDb();
  const [row] = await db.delete(t.attachments).where(eq(t.attachments.id, id)).returning();
  if (row) await unlink(path.join(/*turbopackIgnore: true*/ uploadDir(), path.basename(row.storagePath))).catch(() => {});
  return row ?? null;
}

/** URL de consultation d'une pièce jointe. */
export const attachmentUrl = (id: string) => `/fichiers/${id}`;

// ─── Droit de lecture d'une pièce jointe (route /fichiers/[id]) ─────────────

export type FileSession = { role: Role; user: { id: string }; allowedSiteIds: string[] | null };

/** Site de l'entité propriétaire d'une pièce jointe (null = sans site, ou entité qui vaut pour tous les sites). */
async function attachmentSiteId(row: Attachment): Promise<string | null> {
  const db = await getDb();
  const one = async (q: Promise<{ siteId: string | null }[]>) => (await q)[0]?.siteId ?? null;
  const num = Number(row.entityId);
  switch (row.entityType) {
    case 'event': return one(db.select({ siteId: t.events.siteId }).from(t.events).where(eq(t.events.id, row.entityId)));
    case 'action': return one(db.select({ siteId: t.actions.siteId }).from(t.actions).where(eq(t.actions.id, row.entityId)));
    case 'prevention_plan': return one(db.select({ siteId: t.preventionPlans.siteId }).from(t.preventionPlans).where(eq(t.preventionPlans.id, row.entityId)));
    case 'site_map': return row.entityId;
    case 'document_version':
      return Number.isInteger(num) ? one(db.select({ siteId: t.documents.siteId }).from(t.documentVersions)
        .innerJoin(t.documents, eq(t.documents.id, t.documentVersions.documentId)).where(eq(t.documentVersions.id, num))) : null;
    case 'control_record':
      return Number.isInteger(num) ? one(db.select({ siteId: t.controls.siteId }).from(t.controlRecords)
        .innerJoin(t.controls, eq(t.controls.id, t.controlRecords.controlId)).where(eq(t.controlRecords.id, num))) : null;
    case 'qualification':
      return Number.isInteger(num) ? one(db.select({ siteId: t.people.siteId }).from(t.qualifications)
        .innerJoin(t.people, eq(t.people.id, t.qualifications.personId)).where(eq(t.qualifications.id, num))) : null;
    default: return null;
  }
}

/**
 * Droit de lecture d'une pièce jointe : entité propriétaire dans le périmètre de sites de la personne (SEC-02), puis
 * droit sur cette entité. Refus par défaut pour un type inconnu (sauf encadrement). Chaque domaine qui ajoute un
 * entityType ajoute sa règle ici (et le site de l'entité dans attachmentSiteId).
 */
export async function canReadAttachment(row: Attachment, s: FileSession): Promise<boolean> {
  if (s.allowedSiteIds) {
    const siteId = await attachmentSiteId(row);
    if (siteId && !s.allowedSiteIds.includes(siteId)) return false;
  }
  return canReadEntity(row, s);
}

async function canReadEntity(row: Attachment, s: FileSession): Promise<boolean> {
  const db = await getDb();
  const { role, user } = s;
  switch (row.entityType) {
    case 'event': {
      if (!canSee(role, 'events')) return false;
      if (!isEmployee(role)) return true;
      // Salarié : ses propres signalements (déclarant) ou les fichiers qu'il a lui-même joints.
      const [ev] = await db.select({ declarantId: t.events.declarantId }).from(t.events).where(eq(t.events.id, row.entityId));
      return !!ev && (ev.declarantId === user.id || row.uploadedBy === user.id);
    }
    case 'action': {
      if (!canSee(role, 'actions')) return false;
      if (!isEmployee(role)) return true;
      const [a] = await db.select({ pilotId: t.actions.pilotId }).from(t.actions).where(eq(t.actions.id, row.entityId));
      return a?.pilotId === user.id;
    }
    case 'document_version': {
      if (!canSee(role, 'docs')) return false;
      const [v] = await db.select({ status: t.documentVersions.status }).from(t.documentVersions).where(eq(t.documentVersions.id, Number(row.entityId)));
      // Version en vigueur : consultable par tous ; brouillon, revue, archive : rédacteurs et approbateurs.
      return !!v && (v.status === 'approuve' || canEdit(role, 'docs'));
    }
    case 'control_record':
    case 'requirement_evaluation':
      return canSee(role, 'watch');
    case 'prevention_plan':
    case 'site_map':
      return canSee(role, 'prevention');
    case 'qualification': {
      if (!canSee(role, 'skills')) return false;
      if (!isEmployee(role)) return true;
      const [q] = await db.select({ personId: t.qualifications.personId }).from(t.qualifications).where(eq(t.qualifications.id, Number(row.entityId)));
      return q?.personId === user.id;
    }
    case 'audit_plan_item':
    case 'certification':
      return canSee(role, 'audits');
    default:
      return canManage(role);
  }
}
