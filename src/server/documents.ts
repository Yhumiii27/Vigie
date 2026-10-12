'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { DOC_TYPES, DOC_TYPE_KEYS, PROCESS_KEYS, REF_PATTERN, nextVersion, refPrefix, type DocType } from '@/components/documents/meta';
import { today } from '@/lib/today';
import { canApprove, canEdit } from '@/lib/domain';
import { formReader, nextRef, type FormState } from '@/lib/forms';
import { requireApprover, requireInSite, requireManager } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import { checkUpload, deleteAttachment, listAttachments, saveUpload } from '@/lib/uploads';
import { diffFields, logChange } from './changelog';

// Documents maîtrisés : création, métadonnées et cycle de vie des versions
// (brouillon → en revue → approuvée ; la version approuvée précédente est archivée).

const ENTITY = 'document_version';

type Reader = ReturnType<typeof formReader>;
type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * Champs de métadonnées communs à la création et à la modification. `current` : document modifié (null en création) ;
 * son propriétaire sorti de l'effectif reste admis tant qu'il n'est pas remplacé (DOC-01), un nouveau choix doit viser
 * une personne présente.
 */
async function readMetadata(f: Reader, db: Db, current: { ownerId: string } | null) {
  const title = f.str('title', { required: true, max: 200 });
  const type = f.oneOf('type', DOC_TYPE_KEYS, { required: true });
  const processCode = f.oneOf('process', PROCESS_KEYS, { required: true });
  const ownerId = f.str('ownerId', { required: true });
  const reviewMonths = f.int('reviewMonths', { required: true, min: 1, max: 120 });
  const distribution = f.str('distribution', { required: true, max: 300 });
  const siteId = f.opt('siteId');
  if (ownerId) {
    const [p] = await db.select({ id: t.people.id, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, ownerId));
    if (!p) f.fail('ownerId', 'Personne inconnue.');
    else if (hasLeft(p, today()) && ownerId !== current?.ownerId) f.fail('ownerId', "Propriétaire sorti de l'effectif : choisissez une personne présente.");
  }
  if (siteId) {
    const [s] = await db.select({ id: t.sites.id }).from(t.sites).where(eq(t.sites.id, siteId));
    if (!s) f.fail('siteId', 'Site inconnu.');
  }
  return { title, type, process: processCode, ownerId, reviewMonths, distribution, siteId };
}

/** Action liée facultative (doit exister dans le plan d'actions). */
async function readAction(f: Reader, db: Db) {
  const actionId = f.opt('actionId');
  if (!actionId) return null;
  const [a] = await db.select({ id: t.actions.id }).from(t.actions).where(eq(t.actions.id, actionId));
  if (!a) f.fail('actionId', 'Action introuvable.');
  return actionId;
}

/** Fichier facultatif (un seul par version). */
function readFile(f: Reader) {
  const [file] = f.files('file');
  if (!file) return null;
  const err = checkUpload(file);
  if (err) f.fail('file', err);
  return file;
}

async function replaceFile(versionId: number, file: File, userId: string) {
  const previous = await listAttachments(ENTITY, String(versionId));
  await saveUpload(file, ENTITY, String(versionId), userId);
  await Promise.all(previous.map((p) => deleteAttachment(p.id)));
}

/** Rédaction réservée aux rôles qui ne sont pas en consultation seule sur l'écran « Documents ». */
async function requireDocEditor() {
  const { session, error } = await requireManager();
  if (error) return { session, error };
  return canEdit(session.role, 'docs') ? { session, error: null } : { session, error: 'Consultation seule : votre rôle ne permet pas de modifier les documents maîtrisés.' };
}

/** Contrôle du site sélectionné pour un document existant (un document sans site vaut pour toute l'entreprise). */
async function documentSiteError(documentId: string): Promise<string | null> {
  const db = await getDb();
  const [d] = await db.select({ siteId: t.documents.siteId }).from(t.documents).where(eq(t.documents.id, documentId));
  return d ? requireInSite(d.siteId) : null;
}

const done = (id: string): FormState => {
  revalidatePath('/', 'layout');
  return { ok: true, id };
};

/** Violation de clé unique (référence attribuée entre-temps par un autre utilisateur). */
const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: unknown } | null;
  return !!e && (e.code === '23505' || (e.cause != null && isUniqueViolation(e.cause)));
};

const uploadError = (err: unknown) => (err instanceof Error ? err.message : "Le fichier n'a pas pu être enregistré.");

/** Écriture conditionnelle refusée : un autre utilisateur a fait avancer la version entre-temps. */
const STALE: FormState = { error: 'Cette version a changé entre-temps : rouvrez la fiche du document.' };

/** Nouveau document : référence automatique (préfixe du type + code processus) ou saisie, version A en brouillon. */
export async function createDocument(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireDocEditor();
  if (error) return { error };
  const db = await getDb();
  const f = formReader(fd);
  const meta = await readMetadata(f, db, null);
  const rawRef = f.str('ref', { max: 30 }).toUpperCase().replace(/\s+/g, '');
  const summary = f.str('summary', { max: 300 }) || 'Création du document';
  const actionId = await readAction(f, db);
  const file = readFile(f);
  if (rawRef && !REF_PATTERN.test(rawRef)) f.fail('ref', 'Format attendu : lettres et chiffres séparés par des tirets (ex. PR-QHSE-006).');
  if (!f.ok) return f.state();
  const siteError = await requireInSite(meta.siteId, { create: true });
  if (siteError) return { error: siteError, fieldErrors: { siteId: 'Site non autorisé.' } };

  const ids = (await db.select({ id: t.documents.id }).from(t.documents)).map((d) => d.id);
  if (rawRef && ids.includes(rawRef)) return { error: 'Cette référence est déjà utilisée.', fieldErrors: { ref: `${rawRef} existe déjà.` } };
  const id = rawRef || nextRef(ids, refPrefix(meta.type as DocType, meta.process!), 3);

  let versionId: number;
  try {
    versionId = await db.transaction(async (tx) => {
      await tx.insert(t.documents).values({
        id, title: meta.title, type: meta.type!, process: meta.process!, ownerId: meta.ownerId, reviewMonths: meta.reviewMonths!,
        distribution: meta.distribution, siteId: meta.siteId,
      });
      const [v] = await tx.insert(t.documentVersions).values({
        documentId: id, version: 'A', status: 'brouillon', summary, authorId: session.user.id, actionId,
      }).returning({ id: t.documentVersions.id });
      return v.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `La référence ${id} vient d'être attribuée : enregistrez à nouveau.` };
    throw err;
  }

  if (file) {
    try {
      await saveUpload(file, ENTITY, String(versionId), session.user.id);
    } catch (err) {
      // Pas de document sans le fichier annoncé : on annule la création.
      await db.delete(t.documentVersions).where(eq(t.documentVersions.id, versionId));
      await db.delete(t.documents).where(eq(t.documents.id, id));
      return { error: uploadError(err), fieldErrors: { file: 'Fichier non enregistré.' } };
    }
  }
  return done(id);
}

/** Métadonnées du document (la référence ne change pas). */
export async function updateDocument(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireDocEditor();
  if (error) return { error };
  const db = await getDb();
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const [before] = id ? await db.select().from(t.documents).where(eq(t.documents.id, id)) : [];
  const meta = await readMetadata(f, db, before ?? null);
  if (!f.ok) return f.state();
  if (!before) return { error: 'Document introuvable.' };
  const siteError = (await requireInSite(before.siteId)) ?? (before.siteId !== meta.siteId ? await requireInSite(meta.siteId, { create: true }) : null);
  if (siteError) return { error: siteError };
  // ISO 9001 §7.5.3 : un document retiré (toutes ses versions archivées) est conservé tel quel.
  const versions = await db.select({ status: t.documentVersions.status }).from(t.documentVersions).where(eq(t.documentVersions.documentId, id));
  if (!versions.length) return { error: 'Document introuvable.' };
  if (versions.every((v) => v.status === 'archive')) return { error: 'Document obsolète : ses informations ne sont plus modifiables.' };
  const after = {
    title: meta.title, type: meta.type!, process: meta.process!, ownerId: meta.ownerId, reviewMonths: meta.reviewMonths!,
    distribution: meta.distribution, siteId: meta.siteId,
  };
  const details = diffFields(await metadataView(db, before), await metadataView(db, after), METADATA_LABELS);
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.documents).set(after).where(eq(t.documents.id, id)).returning({ id: t.documents.id });
    if (!row) return false;
    if (details.length) await logChange(tx, { entityType: 'document', entityId: id, action: 'update', summary: 'Informations du document modifiées', details });
    return true;
  });
  if (!updated) return { error: 'Document introuvable.' };
  return done(id);
}

/** Champs suivis par le journal de modification des informations d'un document. */
const METADATA_LABELS = {
  title: 'Titre', type: 'Type', process: 'Processus', ownerId: 'Propriétaire', reviewMonths: 'Périodicité de revue (mois)',
  distribution: 'Diffusion', siteId: 'Site',
} as const;

type Metadata = { title: string; type: string; process: string; ownerId: string; reviewMonths: number; distribution: string; siteId: string | null };

/** Informations d'un document telles que le journal les affiche (personne, site et type par leur libellé). */
async function metadataView(db: Db, m: Metadata): Promise<Record<keyof typeof METADATA_LABELS, string>> {
  const [[owner], [site]] = await Promise.all([
    db.select({ name: t.people.name }).from(t.people).where(eq(t.people.id, m.ownerId)),
    m.siteId ? db.select({ label: t.sites.label }).from(t.sites).where(eq(t.sites.id, m.siteId)) : Promise.resolve([]),
  ]);
  return {
    title: m.title,
    type: Object.hasOwn(DOC_TYPES, m.type) ? DOC_TYPES[m.type as DocType].label : m.type,
    process: m.process,
    ownerId: owner?.name ?? m.ownerId,
    reviewMonths: String(m.reviewMonths),
    distribution: m.distribution,
    siteId: m.siteId ? site?.label ?? m.siteId : 'Tous les sites',
  };
}

/**
 * Nouvelle révision d'un document en vigueur : version suivante en brouillon.
 * Relance aussi un document abandonné avant toute approbation (aucune version n'a été en vigueur) ;
 * un document retiré après approbation (obsolète) ne se révise plus.
 */
export async function reviseDocument(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireDocEditor();
  if (error) return { error };
  const db = await getDb();
  const f = formReader(fd);
  const documentId = f.str('documentId', { required: true });
  const summary = f.str('summary', { required: true, max: 300 });
  const actionId = await readAction(f, db);
  const file = readFile(f);
  if (!f.ok) return f.state();
  const siteError = await documentSiteError(documentId);
  if (siteError) return { error: siteError };

  // Contrôle et insertion dans la même transaction : pas de seconde révision en cours sur un double envoi.
  const created = await db.transaction(async (tx): Promise<{ error: string } | { versionId: number }> => {
    const versions = await tx.select().from(t.documentVersions).where(eq(t.documentVersions.documentId, documentId));
    if (!versions.length) return { error: 'Document introuvable.' };
    const pending = versions.find((v) => v.status === 'brouillon' || v.status === 'en_revue');
    if (pending) return { error: `La version ${pending.version} est déjà en cours (${pending.status === 'en_revue' ? 'en revue' : 'brouillon'}).` };
    const relaunch = versions.every((v) => v.status === 'archive' && !v.approvedOn);
    if (!relaunch && !versions.some((v) => v.status === 'approuve')) return { error: 'Document obsolète : il ne peut plus être révisé.' };
    const [v] = await tx.insert(t.documentVersions).values({
      documentId, version: nextVersion(versions.map((x) => x.version)), status: 'brouillon', summary, authorId: session.user.id, actionId,
    }).returning({ id: t.documentVersions.id });
    return { versionId: v.id };
  });
  if ('error' in created) return { error: created.error };

  if (file) {
    try {
      await saveUpload(file, ENTITY, String(created.versionId), session.user.id);
    } catch (err) {
      await db.delete(t.documentVersions).where(eq(t.documentVersions.id, created.versionId));
      return { error: uploadError(err), fieldErrors: { file: 'Fichier non enregistré.' } };
    }
  }
  return done(documentId);
}

async function loadVersion(f: Reader) {
  const versionId = f.int('versionId', { required: true });
  if (versionId == null) return null;
  const db = await getDb();
  const [v] = await db.select().from(t.documentVersions).where(eq(t.documentVersions.id, versionId));
  return v ?? null;
}

/** Version du formulaire et contrôle du site de son document : erreur, ou version (null si introuvable). */
async function loadVersionInSite(f: Reader): Promise<{ error: string } | { v: Awaited<ReturnType<typeof loadVersion>> }> {
  const v = await loadVersion(f);
  const error = v ? await documentSiteError(v.documentId) : null;
  return error ? { error } : { v };
}

/** Brouillon : objet de la modification, action liée et fichier (ajout, remplacement ou retrait). */
export async function updateDraft(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireDocEditor();
  if (error) return { error };
  const db = await getDb();
  const f = formReader(fd);
  const loaded = await loadVersionInSite(f);
  if ('error' in loaded) return { error: loaded.error };
  const { v } = loaded;
  const summary = f.str('summary', { required: true, max: 300 });
  const actionId = await readAction(f, db);
  const file = readFile(f);
  const removeFile = f.bool('removeFile');
  if (!f.ok) return f.state();
  if (!v) return { error: 'Version introuvable.' };
  if (v.status !== 'brouillon') return { error: 'Seul un brouillon peut être modifié : renvoyez la version en brouillon.' };

  // Écriture conditionnelle d'abord : le fichier d'une version soumise entre-temps reste intact.
  const [row] = await db.update(t.documentVersions).set({ summary, actionId })
    .where(and(eq(t.documentVersions.id, v.id), eq(t.documentVersions.status, 'brouillon'))).returning({ id: t.documentVersions.id });
  if (!row) return STALE;

  if (file) {
    try {
      await replaceFile(v.id, file, session.user.id);
    } catch (err) {
      return { error: uploadError(err), fieldErrors: { file: 'Fichier non enregistré.' } };
    }
  } else if (removeFile) {
    const previous = await listAttachments(ENTITY, String(v.id));
    await Promise.all(previous.map((p) => deleteAttachment(p.id)));
  }
  return done(v.documentId);
}

/** Brouillon → en revue. */
export async function submitVersion(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireDocEditor();
  if (error) return { error };
  const f = formReader(fd);
  const loaded = await loadVersionInSite(f);
  if ('error' in loaded) return { error: loaded.error };
  const { v } = loaded;
  if (!f.ok) return f.state();
  if (!v) return { error: 'Version introuvable.' };
  if (v.status !== 'brouillon') return { error: 'Cette version a déjà été soumise.' };
  if (!v.summary.trim()) return { error: "Précisez l'objet de la modification avant de soumettre." };
  const db = await getDb();
  const [row] = await db.update(t.documentVersions).set({ status: 'en_revue', submittedOn: today() })
    .where(and(eq(t.documentVersions.id, v.id), eq(t.documentVersions.status, 'brouillon'))).returning({ id: t.documentVersions.id });
  if (!row) return STALE;
  return done(v.documentId);
}

/** En revue → approuvée ; la version précédemment en vigueur est archivée. */
export async function approveVersion(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const loaded = await loadVersionInSite(f);
  if ('error' in loaded) return { error: loaded.error };
  const { v } = loaded;
  if (!f.ok) return f.state();
  if (!v) return { error: 'Version introuvable.' };
  if (v.status !== 'en_revue') return { error: "Seule une version en revue peut être approuvée." };
  const db = await getDb();
  const approved = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.documentVersions).set({ status: 'approuve', approverId: session.user.id, approvedOn: today() })
      .where(and(eq(t.documentVersions.id, v.id), eq(t.documentVersions.status, 'en_revue'))).returning({ id: t.documentVersions.id });
    if (!row) return false;
    await tx.update(t.documentVersions).set({ status: 'archive' })
      .where(and(eq(t.documentVersions.documentId, v.documentId), eq(t.documentVersions.status, 'approuve'), ne(t.documentVersions.id, v.id)));
    return true;
  });
  if (!approved) return STALE;
  return done(v.documentId);
}

/** En revue → brouillon (corrections demandées par l'approbateur). */
export async function returnToDraft(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const loaded = await loadVersionInSite(f);
  if ('error' in loaded) return { error: loaded.error };
  const { v } = loaded;
  if (!f.ok) return f.state();
  if (!v) return { error: 'Version introuvable.' };
  if (v.status !== 'en_revue') return { error: "Cette version n'est pas en revue." };
  const db = await getDb();
  const [row] = await db.update(t.documentVersions).set({ status: 'brouillon', submittedOn: null })
    .where(and(eq(t.documentVersions.id, v.id), eq(t.documentVersions.status, 'en_revue'))).returning({ id: t.documentVersions.id });
  if (!row) return STALE;
  return done(v.documentId);
}

/**
 * Abandon d'un brouillon : la version est conservée, archivée sans approbation.
 * Sans version en vigueur, l'abandon retire le document : comme « Rendre obsolète », il est réservé aux approbateurs
 * (le document « Abandonné » peut ensuite être relancé par une nouvelle révision).
 */
export async function abandonDraft(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireDocEditor();
  if (error) return { error };
  const f = formReader(fd);
  const loaded = await loadVersionInSite(f);
  if ('error' in loaded) return { error: loaded.error };
  const { v } = loaded;
  if (!f.ok) return f.state();
  if (!v) return { error: 'Version introuvable.' };
  if (v.status !== 'brouillon') return { error: 'Seul un brouillon peut être abandonné.' };
  const db = await getDb();
  const inForce = await db.select({ id: t.documentVersions.id }).from(t.documentVersions)
    .where(and(eq(t.documentVersions.documentId, v.documentId), eq(t.documentVersions.status, 'approuve')));
  if (!inForce.length && !canApprove(session.role)) {
    return { error: "Sans version en vigueur, abandonner ce brouillon retire le document : réservé à l'animateur QHSE et à la direction." };
  }
  const [row] = await db.update(t.documentVersions).set({ status: 'archive' })
    .where(and(eq(t.documentVersions.id, v.id), eq(t.documentVersions.status, 'brouillon'))).returning({ id: t.documentVersions.id });
  if (!row) return STALE;
  return done(v.documentId);
}

/**
 * Retrait du document, avec motif : la version en vigueur (et une éventuelle révision en cours) est archivée.
 * Qui, quand et pourquoi sont tracés dans l'historique du document (fiche « Obsolète »).
 */
export async function obsoleteDocument(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const documentId = f.str('documentId', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const siteError = await documentSiteError(documentId);
  if (siteError) return { error: siteError };
  const db = await getDb();
  // Contrôle et archivage dans la même transaction : un seul retrait tracé sur un double envoi.
  const retired = await db.transaction(async (tx): Promise<{ error: string } | null> => {
    const versions = await tx.select().from(t.documentVersions).where(eq(t.documentVersions.documentId, documentId));
    if (!versions.length) return { error: 'Document introuvable.' };
    const current = versions.find((v) => v.status === 'approuve');
    if (!current) return { error: "Le document n'a pas de version en vigueur." };
    const pending = versions.find((v) => v.status === 'brouillon' || v.status === 'en_revue');
    const live = versions.filter((v) => v.status !== 'archive').map((v) => v.id);
    await tx.update(t.documentVersions).set({ status: 'archive' })
      .where(and(inArray(t.documentVersions.id, live), ne(t.documentVersions.status, 'archive')));
    await logChange(tx, {
      entityType: 'document', entityId: documentId, action: 'archive', reason, byId: session.user.id,
      summary: `Document rendu obsolète : version ${current.version} retirée${pending ? `, révision ${pending.version} abandonnée` : ''}`,
    });
    return null;
  });
  if (retired) return retired;
  return done(documentId);
}
