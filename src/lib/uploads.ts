import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|application\/msword|application\/vnd\.ms-excel|text\/plain|text\/csv)$/;

const uploadDir = () => process.env.VIGIE_UPLOAD_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), '.data', 'uploads');

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
  await writeFile(path.join(/*turbopackIgnore: true*/ dir, id), Buffer.from(await file.arrayBuffer()));
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
  try {
    return { row, data: await readFile(path.join(/*turbopackIgnore: true*/ uploadDir(), path.basename(row.storagePath))) };
  } catch {
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
