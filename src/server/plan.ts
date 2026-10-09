'use server';

import { revalidatePath } from 'next/cache';
import { TransactionRollbackError, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { MAX_BATCH_BYTES, MAX_FILES_PER_BATCH } from '@/lib/attachments';
import { fmtDate, today } from '@/lib/dates';
import { EVENT_ORIGINS, ORIGINS, canApprove, canManage } from '@/lib/domain';
import { formReader, nextRef, type FormState } from '@/lib/forms';
import { applyActionLink, checkActionLink, linkLogEntity } from '@/lib/action-links';
import { requireInSite, requireManager } from '@/lib/guard';
import { ALL_SITES, activeSiteIds, getSession, inSite } from '@/lib/session';
import { checkUpload, deleteAttachment, saveUpload } from '@/lib/uploads';
import { diffFields, logChange } from './changelog';

const ORIGIN_KEYS = Object.keys(ORIGINS);
const CANCELLED = 'Action annulée : consultation seule.';
const SITE_CHOICE = 'Une nouvelle action vaut pour le site sélectionné ou pour tous les sites.';

/**
 * Crée ou modifie une action du plan d'actions unique.
 * Champ `siteId` : '' = site sélectionné (à défaut celui de l'événement lié), 'all' = tous les sites. Une création vise
 * le site sélectionné (ou tous les sites) ; une modification peut transférer l'action vers un autre site actif.
 * Champ `eventId` (sélecteur « Événement lié ») : seulement pour les origines Événement et Client ; remis à null sinon.
 * Champ caché `link` pour rattacher la nouvelle action à son origine (registre src/lib/action-links.ts) :
 * event:<id> · risk:<id> · finding:<id> · requirement:<id> · control:<id> · plan:<id> · docversion:<id>
 * · qualification:<personId>:<titleId> · review:<id> · reviewdecision:<id>
 * — mêmes contrôles que « Rattacher une action existante » (checkActionLink : écran ouvert au rôle, site de la source).
 * Action en « Efficacité à vérifier » : la date de vérification reste obligatoire et ne peut être reportée dans le passé.
 */
export async function saveAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const title = f.str('title', { required: true, max: 200 });
  const description = f.opt('description');
  const origin = f.oneOf('origin', ORIGIN_KEYS, { required: true });
  const pilotId = f.str('pilotId', { required: true });
  const dueOn = f.date('dueOn', { required: true });
  const kind = f.oneOf('kind', ['C', 'P'] as const, { required: true });
  const verifyDueOn = f.date('verifyDueOn');
  let originRef = f.str('originRef', { max: 120 });
  const siteField = f.opt('siteId');
  const link = f.opt('link');
  if (!f.ok) return f.state();
  const eventId = origin && EVENT_ORIGINS.includes(origin) ? f.opt('eventId') : null;

  const db = await getDb();
  const [cur] = id ? await db.select().from(t.actions).where(eq(t.actions.id, id)) : [];
  if (id && !cur) return { error: 'Action introuvable.' };
  if (cur?.status === 'cancelled') return { error: CANCELLED };
  if (cur?.status === 'done' && !canApprove(session.role)) return { error: "Seuls l'animateur QHSE et la direction modifient une action clôturée." };
  if (cur) {
    const blocked = await requireInSite(cur.siteId);
    if (blocked) return { error: blocked };
  }

  let eventSite: string | null = null;
  if (eventId) {
    const [ev] = await db.select({ id: t.events.id, siteId: t.events.siteId }).from(t.events).where(eq(t.events.id, eventId));
    if (!ev) return { error: 'Événement lié introuvable.', fieldErrors: { eventId: 'Événement introuvable.' } };
    const blocked = await requireInSite(ev.siteId);
    if (blocked) return { error: blocked, fieldErrors: { eventId: 'Événement d\'un autre site.' } };
    eventSite = ev.siteId;
    // Référence par défaut : celle de l'événement, mise à jour si l'événement lié change (sauf référence saisie à part).
    if (!originRef || (cur && eventId !== cur.eventId && originRef === cur.eventId)) originRef = ev.id;
  }
  if (!originRef) return { error: "Précisez la référence d'origine (événement, audit, exigence…).", fieldErrors: { originRef: 'Champ obligatoire.' } };

  // '' = site sélectionné (ou celui de l'événement lié) ; 'all' = tous les sites.
  const selected = session.site.id !== ALL_SITES ? session.site.id : null;
  const siteId = siteField === ALL_SITES ? null : siteField ?? eventSite ?? selected;
  if (siteId) {
    const [site] = await db.select({ id: t.sites.id }).from(t.sites).where(eq(t.sites.id, siteId));
    if (!site) return { error: 'Site inconnu.', fieldErrors: { siteId: 'Site inconnu.' } };
  }
  if (!cur) {
    if (!inSite(selected, siteId)) return { error: SITE_CHOICE, fieldErrors: { siteId: SITE_CHOICE } };
    const blocked = await requireInSite(siteId, { create: true });
    if (blocked) return { error: blocked, fieldErrors: { siteId: blocked } };
  } else if (cur.siteId !== siteId && siteId && !(await activeSiteIds()).includes(siteId)) {
    // Transfert (l'action relève déjà du site sélectionné, contrôlé plus haut) : seulement vers un site actif.
    const archived = 'Site archivé ou inconnu : choisissez un site actif.';
    return { error: archived, fieldErrors: { siteId: archived } };
  }

  if (cur?.status === 'verify') {
    // Une vérification d'efficacité ne peut être ni retirée ni reportée dans le passé (signal « dépassée »).
    if (!verifyDueOn) return { error: 'Certains champs sont à corriger.', fieldErrors: { verifyDueOn: "Date obligatoire tant que l'efficacité est à vérifier." } };
    if (verifyDueOn !== cur.verifyDueOn && verifyDueOn < today()) return { error: 'Certains champs sont à corriger.', fieldErrors: { verifyDueOn: 'La vérification ne peut pas être planifiée dans le passé.' } };
  }

  if (!cur && link) {
    const checked = await checkActionLink(db, session.role, link);
    if ('error' in checked) return { error: checked.error };
  }

  const values = { title, description, origin: origin!, originRef, pilotId, dueOn: dueOn!, kind: kind!, verifyDueOn, siteId };

  if (cur) {
    let linkError: string | null = null;
    await db.transaction(async (tx) => {
      await tx.update(t.actions).set({ ...values, eventId: eventId === cur.eventId ? cur.eventId : null }).where(eq(t.actions.id, cur.id));
      // Nouvel événement lié : rattachement par le registre (contrôle de l'étape, classement sans suite).
      if (eventId && eventId !== cur.eventId) {
        linkError = await applyActionLink(tx, `event:${eventId}`, cur.id);
        if (linkError) return tx.rollback();
      }
      const [people, sites] = await Promise.all([
        tx.select({ id: t.people.id, name: t.people.name }).from(t.people),
        tx.select({ id: t.sites.id, label: t.sites.label }).from(t.sites),
      ]);
      const name = (pid: string | null) => (pid ? people.find((p) => p.id === pid)?.name ?? pid : null);
      const site = (sid: string | null) => (sid ? sites.find((s) => s.id === sid)?.label.split(' — ')[0] ?? sid : 'Tous les sites');
      const shown = (a: { title: string; pilotId: string; dueOn: string; siteId: string | null; origin: string; originRef: string; eventId: string | null }) => ({
        title: a.title, pilot: name(a.pilotId), due: fmtDate(a.dueOn), site: site(a.siteId),
        origin: `${ORIGINS[a.origin]?.label ?? a.origin} · ${a.originRef}`, event: a.eventId,
      });
      const details = diffFields(shown(cur), shown({ ...values, eventId }), { title: 'Titre', pilot: 'Pilote', due: 'Échéance', site: 'Site', origin: 'Origine', event: 'Événement' });
      await logChange(tx, { entityType: 'action', entityId: cur.id, action: 'update', summary: details.length ? `Modifiée : ${details.map((d) => d.field.toLowerCase()).join(', ')}` : 'Modifiée', details, byId: session.user.id });
    }).catch((e: unknown) => { if (!(e instanceof TransactionRollbackError)) throw e; });
    if (linkError) return { error: linkError, fieldErrors: { eventId: linkError } };
    revalidatePath('/', 'layout');
    return { ok: true, id: cur.id };
  }

  const ids = (await db.select({ id: t.actions.id }).from(t.actions)).map((r) => r.id);
  const newId = nextRef(ids, 'A-');
  let linkError: string | null = null;
  await db.transaction(async (tx) => {
    await tx.insert(t.actions).values({ id: newId, ...values, status: 'todo' });
    await logChange(tx, { entityType: 'action', entityId: newId, action: 'create', summary: 'Action créée', byId: session.user.id });
    // Rattachements (registre src/lib/action-links.ts) : événement lié, puis source de l'écran appelant ; un échec annule la création.
    for (const l of [eventId ? `event:${eventId}` : null, link]) {
      if (!l) continue;
      linkError = await applyActionLink(tx, l, newId);
      if (linkError) return tx.rollback();
      const source = linkLogEntity(l);
      if (source) await logChange(tx, { ...source, action: 'link', summary: `Action ${newId} créée et rattachée`, byId: session.user.id });
    }
  }).catch((e: unknown) => { if (!(e instanceof TransactionRollbackError)) throw e; });
  if (linkError) return { error: linkError };
  revalidatePath('/', 'layout');
  return { ok: true, id: newId };
}

// ─── Preuves (pièces jointes de l'action) ───────────────────────────────────

/** Ajoute des preuves (photos, PV, attestations) : encadrement ou pilote de l'action, tant qu'elle n'est pas annulée. */
export async function addActionFiles(fd: FormData): Promise<{ error?: string; count?: number }> {
  const session = await getSession();
  const f = formReader(fd);
  const actionId = f.str('actionId', { required: true });
  const files = f.files('files');
  const db = await getDb();
  const [a] = await db.select().from(t.actions).where(eq(t.actions.id, actionId));
  if (!a) return { error: 'Action introuvable.' };
  if (!canManage(session.role) && a.pilotId !== session.user.id) return { error: 'Votre rôle ne permet pas cette modification.' };
  if (a.status === 'cancelled') return { error: CANCELLED };
  const blocked = await requireInSite(a.siteId);
  if (blocked) return { error: blocked };
  if (!files.length) return { error: 'Choisissez au moins un fichier.' };
  if (files.length > MAX_FILES_PER_BATCH) return { error: `${MAX_FILES_PER_BATCH} fichiers au maximum par envoi.` };
  if (files.reduce((s, x) => s + x.size, 0) > MAX_BATCH_BYTES) return { error: `L'envoi dépasse ${MAX_BATCH_BYTES / 1024 / 1024} Mo : ajoutez les fichiers en plusieurs fois.` };
  const invalid = files.map(checkUpload).find(Boolean);
  if (invalid) return { error: invalid };
  for (const file of files) await saveUpload(file, 'action', actionId, session.user.id);
  await logChange(null, {
    entityType: 'action', entityId: actionId, action: 'attach', byId: session.user.id,
    summary: `${files.length} preuve${files.length > 1 ? 's' : ''} ajoutée${files.length > 1 ? 's' : ''}`,
    details: files.map((file) => ({ field: 'Fichier', from: null, to: file.name })),
  });
  revalidatePath('/', 'layout');
  return { count: files.length };
}

/** Retire une preuve ajoutée par erreur (seule suppression admise, avant clôture) : encadrement ou auteur de l'envoi. */
export async function removeActionFile(attachmentId: string): Promise<{ error?: string }> {
  const session = await getSession();
  const db = await getDb();
  const [row] = await db.select().from(t.attachments).where(eq(t.attachments.id, attachmentId));
  if (!row || row.entityType !== 'action') return { error: 'Pièce jointe introuvable.' };
  const [a] = await db.select().from(t.actions).where(eq(t.actions.id, row.entityId));
  if (!a) return { error: 'Action introuvable.' };
  if (a.status === 'done' || a.status === 'cancelled') return { error: 'Action clôturée ou annulée : les preuves ne peuvent plus être retirées.' };
  if (!canManage(session.role) && row.uploadedBy !== session.user.id) return { error: 'Seul l\'auteur de l\'envoi ou l\'encadrement peut retirer cette pièce.' };
  const blocked = await requireInSite(a.siteId);
  if (blocked) return { error: blocked };
  await deleteAttachment(attachmentId);
  await logChange(null, {
    entityType: 'action', entityId: a.id, action: 'detach', byId: session.user.id,
    summary: 'Preuve retirée', details: [{ field: 'Fichier', from: row.fileName, to: null }],
  });
  revalidatePath('/', 'layout');
  return {};
}
