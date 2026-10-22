import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { canReadPlan, isQhse } from './action-rules';
import { config } from './config';
import { canEdit, canManage, canSee, canSeeEventType, canSeeHealth, isEmployee, type Role } from './domain';
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

/**
 * Enregistre un fichier sur disque et le rattache à une entité (event, document_version, control_record…).
 * - `health` : pièce médicale (certificat, avis d'arrêt, réserves…), réservée aux rôles canSeeHealth (SEC-06) ;
 * - `db` : base ou transaction de la ligne (appel dans la transaction de l'écriture : la ligne et son logChange sont
 *   atomiques). Le fichier est écrit sur disque avant la ligne : si la transaction est annulée, il reste orphelin sur
 *   disque, sans ligne qui le désigne (réserve connue PRD-13) ;
 * - `commentId` : preuve jointe à un commentaire du fil d'une action (entityType 'action', D10).
 */
export async function saveUpload(file: File, entityType: string, entityId: string, uploadedBy: string | null, opts: { health?: boolean; db?: DbOrTx; commentId?: number } = {}): Promise<Attachment> {
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
  const db = opts.db ?? (await getDb());
  const [row] = await db.insert(t.attachments).values({
    id, entityType, entityId, fileName: file.name.slice(0, 200) || 'fichier', mimeType: file.type, size: file.size, storagePath: id, uploadedBy,
    health: !!opts.health, commentId: opts.commentId ?? null,
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

export async function deleteAttachment(id: string, opts: { db?: DbOrTx } = {}) {
  const db = opts.db ?? await getDb();
  const [row] = await db.delete(t.attachments).where(eq(t.attachments.id, id)).returning();
  // Dans une transaction (`opts.db`), le fichier n'est effacé qu'après validation, par l'appelant : removeStoredFile(row).
  if (row && !opts.db) await removeStoredFile(row);
  return row ?? null;
}

/** Efface le fichier d'une pièce jointe dont la ligne a été supprimée (après validation de la transaction). */
export async function removeStoredFile(row: { storagePath: string }) {
  await unlink(path.join(/*turbopackIgnore: true*/ uploadDir(), path.basename(row.storagePath))).catch(() => {});
}

/** URL de consultation d'une pièce jointe. */
export const attachmentUrl = (id: string) => `/fichiers/${id}`;

// ─── Droit de lecture d'une pièce jointe (route /fichiers/[id]) ─────────────

export type FileSession = { role: Role; user: { id: string }; allowedSiteIds: string[] | null };
/** Ligne lue par les contrôles de lecture : `commentId` facultatif (lignes construites hors base, tests). */
export type AttachmentAccess = Omit<Attachment, 'commentId'> & { commentId?: number | null };

/** Site de l'entité propriétaire d'une pièce jointe (null = sans site, ou entité qui vaut pour tous les sites). */
async function attachmentSiteId(row: AttachmentAccess): Promise<string | null> {
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
    // Paquet 6 : justificatif d'un risque (site de son unité de travail), pièce d'un enlèvement de déchets.
    case 'risk':
      return Number.isInteger(num) ? one(db.select({ siteId: t.workUnits.siteId }).from(t.risks)
        .innerJoin(t.workUnits, eq(t.workUnits.id, t.risks.unitId)).where(eq(t.risks.id, num))) : null;
    case 'waste_entry':
      return Number.isInteger(num) ? one(db.select({ siteId: t.wasteEntries.siteId }).from(t.wasteEntries).where(eq(t.wasteEntries.id, num))) : null;
    default: return null;
  }
}

/** Responsable de l'action d'une preuve (pilot_id), ou null si l'action n'existe pas. */
async function actionPilotId(row: AttachmentAccess): Promise<string | null> {
  const db = await getDb();
  const [a] = await db.select({ pilotId: t.actions.pilotId }).from(t.actions).where(eq(t.actions.id, row.entityId));
  return a?.pilotId ?? null;
}

/**
 * Droit de lecture d'une pièce jointe : pièce médicale (attachments.health) réservée aux rôles canSeeHealth (SEC-06), quel
 * que soit l'entityType ; entité propriétaire dans le périmètre de sites de la personne (SEC-02), puis droit sur cette
 * entité. Refus par défaut pour un type inconnu (sauf encadrement). Chaque domaine qui ajoute un entityType ajoute sa
 * règle ici (et le site de l'entité dans attachmentSiteId).
 * Preuve d'une action dont la personne est responsable : lisible quel que soit le site de l'action (D19 : le responsable
 * consulte ses actions sur tous les sites) ; preuve jointe à un commentaire retiré : QHSE seulement (D23).
 */
export async function canReadAttachment(row: AttachmentAccess, s: FileSession): Promise<boolean> {
  if (row.health && !canSeeHealth(s.role)) return false;
  if (s.allowedSiteIds) {
    const ownAction = row.entityType === 'action' && (await actionPilotId(row)) === s.user.id;
    const siteId = ownAction ? null : await attachmentSiteId(row);
    if (siteId && !s.allowedSiteIds.includes(siteId)) return false;
  }
  return canReadEntity(row, s);
}

async function canReadEntity(row: AttachmentAccess, s: FileSession): Promise<boolean> {
  const db = await getDb();
  const { role, user } = s;
  switch (row.entityType) {
    case 'event': {
      if (!canSee(role, 'events')) return false;
      const [ev] = await db.select({ declarantId: t.events.declarantId, type: t.events.type }).from(t.events).where(eq(t.events.id, row.entityId));
      // Maladie professionnelle (EVT-09) : toutes ses pièces relèvent des données de santé.
      if (ev && !canSeeEventType(role, ev.type)) return false;
      if (!isEmployee(role)) return true;
      // Salarié : ses propres signalements (déclarant) ou les fichiers qu'il a lui-même joints.
      return !!ev && (ev.declarantId === user.id || row.uploadedBy === user.id);
    }
    case 'requirement':
      // Texte d'une exigence de veille (VEI-10).
      return canSee(role, 'watch');
    case 'action': {
      // Plan de son périmètre (QHSE, encadrement en lecture) ou ses propres actions (responsable, Salarié compris).
      if (!canSee(role, 'actions')) return false;
      if (!canReadPlan(role) && (await actionPilotId(row)) !== user.id) return false;
      // Preuve jointe à un commentaire retiré : masquée à qui n'est pas QHSE (D23), le QHSE la retire au besoin.
      if (row.commentId != null && !isQhse(role)) {
        const [c] = await db.select({ withdrawnAt: t.actionComments.withdrawnAt }).from(t.actionComments).where(eq(t.actionComments.id, row.commentId));
        if (!c || c.withdrawnAt) return false;
      }
      return true;
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
    case 'review':
      return canSee(role, 'audits');
    case 'review_item': {
      // Pièce d'un élément d'entrée de la revue (AUD-17) : lecteurs de l'écran Audits, ou son contributeur (« Mes contributions »).
      if (canSee(role, 'audits')) return true;
      const [i] = await db.select({ ownerId: t.reviewItems.ownerId }).from(t.reviewItems).where(eq(t.reviewItems.id, Number(row.entityId)));
      return !!i?.ownerId && i.ownerId === user.id;
    }
    case 'duerp_version':
    case 'risk':
      // DUERP signé et justificatifs (DUE-09) : mêmes lecteurs que l'écran Risques, Salarié compris (consultation du DUERP).
      return canSee(role, 'risks');
    case 'waste_entry':
      return canSee(role, 'env');
    default:
      return canManage(role);
  }
}
