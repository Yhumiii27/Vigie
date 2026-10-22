import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { toAttachmentItem, type AttachmentItem } from '../attachments';
import type { EntityFileKind } from '../entity-files';
import { loadPeople } from '../queries';

/**
 * Pièces jointes de plusieurs entités d'un même type (paquet 6), par identifiant d'entité, de la plus ancienne à la plus
 * récente, avec le nom de la personne qui les a jointes. Jamais une pièce médicale (attachments.health) : ces types n'en
 * portent pas. La lecture du fichier reste contrôlée par /fichiers/[id] (canReadAttachment).
 */
export async function loadEntityFiles(kind: EntityFileKind, ids: readonly (string | number)[]): Promise<Map<string, AttachmentItem[]>> {
  const keys = [...new Set(ids.map(String))];
  const out = new Map<string, AttachmentItem[]>();
  if (!keys.length) return out;
  const db = await getDb();
  const [rows, people] = await Promise.all([
    db.select().from(t.attachments)
      .where(and(eq(t.attachments.entityType, kind), inArray(t.attachments.entityId, keys), eq(t.attachments.health, false)))
      .orderBy(asc(t.attachments.createdAt)),
    loadPeople(),
  ]);
  rows.forEach((r) => {
    const list = out.get(r.entityId) ?? [];
    list.push(toAttachmentItem(r, r.uploadedBy ? people.get(r.uploadedBy)?.name : undefined));
    out.set(r.entityId, list);
  });
  return out;
}
