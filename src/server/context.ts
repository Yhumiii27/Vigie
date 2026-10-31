'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, max } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { CONTEXT_KINDS, CONTEXT_KIND_KEYS, contextNeedsTreatment, type ContextKind } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireEditor } from '@/lib/guard';
import { diffFields, logChange } from './changelog';
import { VERSION_FIELD, assertFresh, freshWrite } from './versions';

// Contexte du système de management (CNF-05, ISO 9001 §4.1, §4.2, §6.1) : enjeux, parties intéressées, risques et
// opportunités. Élément commun à l'entreprise (sans site), saisi par les rôles qui saisissent sur l'écran « Audits »
// (animateur QHSE, direction) ; jamais supprimé (archivage motivé), chaque écriture au journal (context_item).

const requireContextEditor = () => requireEditor('audits');

const LABELS = { kind: 'Nature', label: 'Intitulé', detail: 'Description, attentes', treatment: 'Traitement' } as const;

/**
 * Crée ou modifie un élément du contexte : nature, intitulé, description (exigences et attentes pour une partie
 * intéressée) ; traitement (actions prévues) exigé pour un risque ou une opportunité (§6.1.2).
 */
export async function saveContextItem(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireContextEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { min: 1 });
  const kind = f.oneOf('kind', CONTEXT_KIND_KEYS, { required: true });
  const label = f.str('label', { required: true, max: 200 });
  const detail = f.str('detail', { max: 2000 });
  const treatment = f.str('treatment', { max: 2000 });
  if (kind && contextNeedsTreatment(kind) && !treatment) f.fail('treatment', 'Indiquez le traitement prévu (actions, maîtrise, surveillance).');
  if (!f.ok) return f.state();
  const db = await getDb();
  const [current] = id ? await db.select().from(t.contextItems).where(eq(t.contextItems.id, id)) : [];
  if (id && !current) return { error: 'Élément introuvable.' };
  if (current?.archivedAt) return { error: 'Élément archivé : il ne se modifie plus.' };
  const values: { kind: string; label: string; detail: string; treatment: string } = { kind: kind!, label, detail, treatment };
  const byId = session.user.id;
  const shown = (v: typeof values) => ({ ...v, kind: CONTEXT_KINDS[v.kind as ContextKind]?.label ?? v.kind });
  if (current) {
    const details = diffFields(shown(current), shown(values), LABELS);
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      // QUA-12 : élément modifié depuis l'ouverture du formulaire : rien n'est écrasé.
      await assertFresh(tx, 'context_item', current.id, fd.get(VERSION_FIELD));
      await tx.update(t.contextItems).set(values).where(eq(t.contextItems.id, current.id));
      if (details.length) await logChange(tx, { entityType: 'context_item', entityId: current.id, action: 'update', summary: 'Élément du contexte modifié', details, byId });
    }));
    if (stale) return { error: stale };
    revalidatePath('/', 'layout');
    return { ok: true, id: String(current.id) };
  }
  const newId = await db.transaction(async (tx) => {
    const [{ m }] = await tx.select({ m: max(t.contextItems.sort) }).from(t.contextItems);
    const [row] = await tx.insert(t.contextItems).values({ ...values, sort: (m ?? -1) + 1, createdById: byId }).returning({ id: t.contextItems.id });
    await logChange(tx, { entityType: 'context_item', entityId: row.id, action: 'create', summary: `${CONTEXT_KINDS[kind!].label} ajouté au contexte : ${label}`, byId });
    return row.id;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(newId) };
}

/** Archive un élément du contexte devenu sans objet : jamais supprimé, motif obligatoire, journal. */
export async function archiveContextItem(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireContextEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const done = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.contextItems).set({ archivedAt: new Date(), archivedById: session.user.id, archiveReason: reason })
      .where(and(eq(t.contextItems.id, id!), isNull(t.contextItems.archivedAt))).returning({ id: t.contextItems.id, label: t.contextItems.label });
    if (!row) return false;
    await logChange(tx, { entityType: 'context_item', entityId: row.id, action: 'archive', summary: `Élément du contexte archivé : ${row.label}`, reason, byId: session.user.id });
    return true;
  });
  if (!done) return { error: 'Élément introuvable ou déjà archivé.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(id) };
}
