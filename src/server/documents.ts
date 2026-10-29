'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { DOC_ORIGINS, DOC_ORIGIN_KEYS, DOC_TYPES, DOC_TYPE_KEYS, PROCESS_KEYS, REF_PATTERN, nextVersion, refPrefix, type DocOrigin, type DocType } from '@/components/documents/meta';
import { fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { checkLinkChange } from '@/lib/action-links';
import { isQhse } from '@/lib/action-rules';
import { canApprove, canEdit, type Role } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireApprover, requireInSite, requireManager } from '@/lib/guard';
import { hasLeft } from '@/lib/people';
import { checkUploadBatch, deleteAttachment, listAttachments, saveUpload } from '@/lib/uploads';
import { diffFields, logChange } from './changelog';
import { nextEntityReference } from './references';

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
async function readMetadata(f: Reader, db: Db, current: { ownerId: string; origin?: string; issuer?: string | null; retention?: string | null } | null) {
  const title = f.str('title', { required: true, max: 200 });
  const type = f.oneOf('type', DOC_TYPE_KEYS, { required: true });
  const processCode = f.oneOf('process', PROCESS_KEYS, { required: true });
  const ownerId = f.str('ownerId', { required: true });
  const reviewMonths = f.int('reviewMonths', { required: true, min: 1, max: 120 });
  const distribution = f.str('distribution', { required: true, max: 300 });
  const siteId = f.opt('siteId');
  // DOC-17 : origine (interne, externe), émetteur d'un document externe, durée de conservation (texte libre).
  // Champs absents du formulaire (appel antérieur au paquet 13) : valeurs enregistrées conservées.
  const keep = !f.has('origin');
  const origin = keep ? (current?.origin === 'externe' ? 'externe' : 'interne') : f.oneOf('origin', DOC_ORIGIN_KEYS) ?? 'interne';
  const issuer = origin !== 'externe' ? null : keep ? current?.issuer ?? null : f.str('issuer', { max: 120 }) || null;
  const retention = keep && !f.has('retention') ? current?.retention ?? null : f.str('retention', { max: 120 }) || null;
  if (origin === 'externe' && !issuer && !f.fieldErrors.issuer) f.fail('issuer', "Indiquez l'émetteur du document externe (organisme, client, fournisseur).");
  if (ownerId) {
    const [p] = await db.select({ id: t.people.id, leftOn: t.people.leftOn }).from(t.people).where(eq(t.people.id, ownerId));
    if (!p) f.fail('ownerId', 'Personne inconnue.');
    else if (hasLeft(p, today()) && ownerId !== current?.ownerId) f.fail('ownerId', "Propriétaire sorti de l'effectif : choisissez une personne présente.");
  }
  if (siteId) {
    const [s] = await db.select({ id: t.sites.id }).from(t.sites).where(eq(t.sites.id, siteId));
    if (!s) f.fail('siteId', 'Site inconnu.');
  }
  return { title, type, process: processCode, ownerId, reviewMonths, distribution, siteId, origin, issuer, retention };
}

/** Rattachement d'une action à une version : réservé au service QHSE (ACT-22, réponses du 15/10/2026). */
const VERSION_LINK_QHSE_ONLY = "Le rattachement d'une action à une version relève du service QHSE.";

/**
 * Action liée facultative d'une version (lien complémentaire « docversion », D15). Champ absent du formulaire (rôle hors
 * QHSE, qui ne reçoit pas la liste) ou valeur inchangée : action actuelle conservée telle quelle. Tout changement (pose,
 * remplacement, retrait) relève du service QHSE et passe par les contrôles du registre des rattachements, comme
 * linkAction / unlinkAction (DOC-13 : checkLinkChange, src/lib/action-links.ts) : l'action posée est existante, ni
 * Vérifiée ni Abandonnée, du site sélectionné et du périmètre, et du site du document (document commun : tout site) ;
 * l'action remplacée ou retirée est détachée avec les mêmes contrôles (site sélectionné, périmètre, sauf Abandonnée) ;
 * l'écran Documents est ouvert en saisie au rôle et le document du site sélectionné. `versionId` : version modifiée (null :
 * version créée par cette écriture, site du document imposé). Jamais `actions.document_id` (posé à la création seulement,
 * D15) : l'écran lit aussi document_versions.action_id.
 */
async function readAction(
  f: Reader, fd: FormData, db: Db, who: { role: Role; userId: string },
  current: { actionId: string | null; docSiteId: string | null; versionId: number | null },
) {
  if (!fd.has('actionId')) return current.actionId;
  const posted = f.opt('actionId');
  if (posted === current.actionId) return posted;
  if (!isQhse(who.role)) {
    f.fail('actionId', VERSION_LINK_QHSE_ONLY);
    return current.actionId;
  }
  const link = `docversion:${current.versionId ?? 0}`;
  const opts = { sourceSiteId: current.docSiteId, siteMismatch: posted ? `L'action ${posted} concerne un autre site que le document.` : undefined };
  // L'action détachée (remplacement, retrait) est elle aussi modifiée.
  if (current.actionId) {
    const detached = await checkLinkChange(db, who, link, current.actionId, 'unlink', opts);
    if ('error' in detached) {
      f.fail('actionId', detached.error);
      return current.actionId;
    }
  }
  if (!posted) return null;
  const attached = await checkLinkChange(db, who, link, posted, 'link', opts);
  if ('error' in attached) f.fail('actionId', attached.error);
  return posted;
}

/** Journal d'un changement d'action liée d'une version, sur les actions concernées et sur le document (dans la transaction de l'écriture). */
async function logVersionLink(tx: DbOrTx, before: string | null, after: string | null, label: string, byId: string, documentId: string) {
  if (before === after) return;
  if (before) await logChange(tx, { entityType: 'action', entityId: before, action: 'unlink', summary: `Détachée de ${label}`, byId });
  if (after) await logChange(tx, { entityType: 'action', entityId: after, action: 'link', summary: `Rattachée à ${label}`, byId });
  await logChange(tx, {
    entityType: 'document', entityId: documentId, action: after ? 'link' : 'unlink', byId,
    summary: after ? `Action ${after} rattachée à ${label}` : `Action ${before} détachée de ${label}`,
    ...(before && after ? { details: [{ field: 'Action liée', from: before, to: after }] } : {}),
  });
}

/**
 * Journal du cycle de vie d'un document (DOC-04) : création, révision, brouillon, soumission, approbation, renvoi,
 * abandon, fichier, dans la transaction de l'écriture (historique de la fiche, LazyChangeLog « document »).
 */
const logDoc = (db: DbOrTx | null, documentId: string, entry: { action: string; summary: string; reason?: string | null; details?: { field: string; from: string | null; to: string | null }[]; byId: string }) =>
  logChange(db, { entityType: 'document', entityId: documentId, ...entry });

/** DOC-05 : une version ne part en revue ni n'est approuvée sans son fichier. */
const NO_FILE = 'Joignez le fichier de la version (brouillon) avant de la soumettre ou de l’approuver.';
const hasFile = async (versionId: number) => (await listAttachments(ENTITY, String(versionId))).length > 0;

/** Fichier facultatif (un seul par version), contrôlé sur son contenu et les limites de la personne (checkUploadBatch). */
async function readFile(f: Reader, by: string) {
  const [file] = f.files('file');
  if (!file) return null;
  const err = await checkUploadBatch([file], by);
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
  const actionId = await readAction(f, fd, db, { role: session.role, userId: session.user.id }, { actionId: null, docSiteId: meta.siteId, versionId: null });
  const file = await readFile(f, session.user.id);
  if (rawRef && !REF_PATTERN.test(rawRef)) f.fail('ref', 'Format attendu : lettres et chiffres séparés par des tirets (ex. PR-QHSE-006).');
  if (!f.ok) return f.state();
  const siteError = await requireInSite(meta.siteId, { create: true });
  if (siteError) return { error: siteError, fieldErrors: { siteId: 'Site non autorisé.' } };

  if (rawRef && (await db.select({ id: t.documents.id }).from(t.documents).where(eq(t.documents.id, rawRef))).length) {
    return { error: 'Cette référence est déjà utilisée.', fieldErrors: { ref: `${rawRef} existe déjà.` } };
  }

  let id = rawRef;
  let versionId: number;
  try {
    versionId = await db.transaction(async (tx) => {
      // Référence automatique tirée sous verrou dans la transaction (PRD-08) ; saisie : contrôlée par la clé primaire.
      if (!id) id = await nextEntityReference(tx, 'document', refPrefix(meta.type as DocType, meta.process!), 3);
      await tx.insert(t.documents).values({
        id, title: meta.title, type: meta.type!, process: meta.process!, ownerId: meta.ownerId, reviewMonths: meta.reviewMonths!,
        distribution: meta.distribution, siteId: meta.siteId, origin: meta.origin, issuer: meta.issuer, retention: meta.retention,
      });
      const [v] = await tx.insert(t.documentVersions).values({
        documentId: id, version: 'A', status: 'brouillon', summary, authorId: session.user.id, actionId,
      }).returning({ id: t.documentVersions.id });
      await logDoc(tx, id, { action: 'create', byId: session.user.id, summary: `Document créé · version A en brouillon (${summary})` });
      await logVersionLink(tx, null, actionId, `${id} · version A`, session.user.id, id);
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
    await logDoc(null, id, { action: 'attach', byId: session.user.id, summary: 'Fichier joint à la version A', details: [{ field: 'Fichier', from: null, to: file.name }] });
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
    distribution: meta.distribution, siteId: meta.siteId, origin: meta.origin, issuer: meta.issuer, retention: meta.retention,
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
  distribution: 'Diffusion', siteId: 'Site', origin: 'Origine', issuer: 'Émetteur', retention: 'Durée de conservation',
} as const;

type Metadata = {
  title: string; type: string; process: string; ownerId: string; reviewMonths: number; distribution: string; siteId: string | null;
  origin: string; issuer: string | null; retention: string | null;
};

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
    origin: DOC_ORIGINS[m.origin as DocOrigin] ?? m.origin,
    issuer: m.issuer ?? '',
    retention: m.retention ?? '',
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
  const [doc] = documentId ? await db.select({ siteId: t.documents.siteId }).from(t.documents).where(eq(t.documents.id, documentId)) : [];
  const actionId = await readAction(f, fd, db, { role: session.role, userId: session.user.id }, { actionId: null, docSiteId: doc?.siteId ?? null, versionId: null });
  const file = await readFile(f, session.user.id);
  if (!f.ok) return f.state();
  const siteError = await documentSiteError(documentId);
  if (siteError) return { error: siteError };

  // Contrôle et insertion dans la même transaction : pas de seconde révision en cours sur un double envoi.
  const created = await db.transaction(async (tx): Promise<{ error: string } | { versionId: number; version: string }> => {
    const versions = await tx.select().from(t.documentVersions).where(eq(t.documentVersions.documentId, documentId));
    if (!versions.length) return { error: 'Document introuvable.' };
    const pending = versions.find((v) => v.status === 'brouillon' || v.status === 'en_revue');
    if (pending) return { error: `La version ${pending.version} est déjà en cours (${pending.status === 'en_revue' ? 'en revue' : 'brouillon'}).` };
    const relaunch = versions.every((v) => v.status === 'archive' && !v.approvedOn);
    if (!relaunch && !versions.some((v) => v.status === 'approuve')) return { error: 'Document obsolète : il ne peut plus être révisé.' };
    const version = nextVersion(versions.map((x) => x.version));
    const [v] = await tx.insert(t.documentVersions).values({
      documentId, version, status: 'brouillon', summary, authorId: session.user.id, actionId,
    }).returning({ id: t.documentVersions.id });
    await logDoc(tx, documentId, {
      action: 'create', byId: session.user.id,
      summary: `${relaunch ? 'Document relancé' : 'Révision ouverte'} · version ${version} en brouillon (${summary})`,
    });
    await logVersionLink(tx, null, actionId, `${documentId} · version ${version}`, session.user.id, documentId);
    return { versionId: v.id, version };
  });
  if ('error' in created) return { error: created.error };

  if (file) {
    try {
      await saveUpload(file, ENTITY, String(created.versionId), session.user.id);
    } catch (err) {
      // Version jamais diffusée retirée (brouillon de cette requête) ; son ouverture reste au journal, annulée.
      await db.delete(t.documentVersions).where(eq(t.documentVersions.id, created.versionId));
      await logDoc(null, documentId, { action: 'cancel', byId: session.user.id, summary: `Révision ${created.version} non enregistrée : le fichier n'a pas pu être stocké` });
      return { error: uploadError(err), fieldErrors: { file: 'Fichier non enregistré.' } };
    }
    await logDoc(null, documentId, { action: 'attach', byId: session.user.id, summary: `Fichier joint à la version ${created.version}`, details: [{ field: 'Fichier', from: null, to: file.name }] });
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
  const [doc] = v ? await db.select({ siteId: t.documents.siteId }).from(t.documents).where(eq(t.documents.id, v.documentId)) : [];
  const actionId = await readAction(f, fd, db, { role: session.role, userId: session.user.id }, { actionId: v?.actionId ?? null, docSiteId: doc?.siteId ?? null, versionId: v?.id ?? null });
  const file = await readFile(f, session.user.id);
  const removeFile = f.bool('removeFile');
  if (!f.ok) return f.state();
  if (!v) return { error: 'Version introuvable.' };
  if (v.status !== 'brouillon') return { error: 'Seul un brouillon peut être modifié : renvoyez la version en brouillon.' };

  // Écriture conditionnelle d'abord : le fichier d'une version soumise entre-temps reste intact. Changement d'action liée
  // journalisé sur les actions dans la même transaction.
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(t.documentVersions).set({ summary, actionId })
      .where(and(eq(t.documentVersions.id, v.id), eq(t.documentVersions.status, 'brouillon'))).returning({ id: t.documentVersions.id });
    if (updated) {
      if (summary !== v.summary) {
        await logDoc(tx, v.documentId, { action: 'update', byId: session.user.id, summary: `Brouillon de la version ${v.version} modifié`, details: [{ field: 'Objet de la modification', from: v.summary || null, to: summary }] });
      }
      await logVersionLink(tx, v.actionId, actionId, `${v.documentId} · version ${v.version}`, session.user.id, v.documentId);
    }
    return updated;
  });
  if (!row) return STALE;

  const previous = file || removeFile ? await listAttachments(ENTITY, String(v.id)) : [];
  if (file) {
    try {
      await replaceFile(v.id, file, session.user.id);
    } catch (err) {
      return { error: uploadError(err), fieldErrors: { file: 'Fichier non enregistré.' } };
    }
    await logDoc(null, v.documentId, {
      action: 'attach', byId: session.user.id, summary: `Fichier ${previous.length ? 'remplacé' : 'joint'} · version ${v.version}`,
      details: [{ field: 'Fichier', from: previous[0]?.fileName ?? null, to: file.name }],
    });
  } else if (removeFile && previous.length) {
    await Promise.all(previous.map((p) => deleteAttachment(p.id)));
    await logDoc(null, v.documentId, { action: 'detach', byId: session.user.id, summary: `Fichier retiré · version ${v.version}`, details: [{ field: 'Fichier', from: previous[0].fileName, to: null }] });
  }
  return done(v.documentId);
}

/** Brouillon → en revue. */
export async function submitVersion(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireDocEditor();
  if (error) return { error };
  const f = formReader(fd);
  const loaded = await loadVersionInSite(f);
  if ('error' in loaded) return { error: loaded.error };
  const { v } = loaded;
  if (!f.ok) return f.state();
  if (!v) return { error: 'Version introuvable.' };
  if (v.status !== 'brouillon') return { error: 'Cette version a déjà été soumise.' };
  if (!v.summary.trim()) return { error: "Précisez l'objet de la modification avant de soumettre." };
  if (!(await hasFile(v.id))) return { error: NO_FILE };
  const db = await getDb();
  const row = await db.transaction(async (tx) => {
    // Nouvelle soumission : le renvoi en brouillon précédent est traité (échéance de l'auteur levée, DOC-06).
    const [r] = await tx.update(t.documentVersions).set({ status: 'en_revue', submittedOn: today(), returnedOn: null, returnReason: null })
      .where(and(eq(t.documentVersions.id, v.id), eq(t.documentVersions.status, 'brouillon'))).returning({ id: t.documentVersions.id });
    if (r) await logDoc(tx, v.documentId, { action: 'status', byId: session.user.id, summary: `Version ${v.version} soumise en revue` });
    return r;
  });
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
  if (!(await hasFile(v.id))) return { error: NO_FILE };
  const db = await getDb();
  const approved = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.documentVersions).set({ status: 'approuve', approverId: session.user.id, approvedOn: today() })
      .where(and(eq(t.documentVersions.id, v.id), eq(t.documentVersions.status, 'en_revue'))).returning({ id: t.documentVersions.id });
    if (!row) return false;
    const archived = await tx.update(t.documentVersions).set({ status: 'archive' })
      .where(and(eq(t.documentVersions.documentId, v.documentId), eq(t.documentVersions.status, 'approuve'), ne(t.documentVersions.id, v.id)))
      .returning({ version: t.documentVersions.version });
    await logDoc(tx, v.documentId, {
      action: 'status', byId: session.user.id,
      summary: `Version ${v.version} approuvée et en vigueur${archived.length ? ` · version ${archived.map((a) => a.version).join(', ')} archivée` : ''}`,
    });
    return true;
  });
  if (!approved) return STALE;
  return done(v.documentId);
}

/** En revue → brouillon (corrections demandées par l'approbateur). */
export async function returnToDraft(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const loaded = await loadVersionInSite(f);
  if ('error' in loaded) return { error: loaded.error };
  const { v } = loaded;
  // DOC-06 : corrections demandées, motif obligatoire ; échéance de l'auteur jusqu'à la nouvelle soumission.
  const reason = f.reason();
  if (!f.ok) return f.state();
  if (!v) return { error: 'Version introuvable.' };
  if (v.status !== 'en_revue') return { error: "Cette version n'est pas en revue." };
  const db = await getDb();
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.update(t.documentVersions).set({ status: 'brouillon', submittedOn: null, returnedOn: today(), returnReason: reason })
      .where(and(eq(t.documentVersions.id, v.id), eq(t.documentVersions.status, 'en_revue'))).returning({ id: t.documentVersions.id });
    if (r) await logDoc(tx, v.documentId, { action: 'status', byId: session.user.id, reason, summary: `Version ${v.version} renvoyée en brouillon : corrections demandées` });
    return r;
  });
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
  // Abandon = archivage de la version sans approbation : motif obligatoire (DOC-04).
  const reason = f.reason();
  if (!f.ok) return f.state();
  if (!v) return { error: 'Version introuvable.' };
  if (v.status !== 'brouillon') return { error: 'Seul un brouillon peut être abandonné.' };
  const db = await getDb();
  const inForce = await db.select({ id: t.documentVersions.id }).from(t.documentVersions)
    .where(and(eq(t.documentVersions.documentId, v.documentId), eq(t.documentVersions.status, 'approuve')));
  if (!inForce.length && !canApprove(session.role)) {
    return { error: "Sans version en vigueur, abandonner ce brouillon retire le document : réservé à l'animateur QHSE et à la direction." };
  }
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.update(t.documentVersions).set({ status: 'archive', returnedOn: null, returnReason: null })
      .where(and(eq(t.documentVersions.id, v.id), eq(t.documentVersions.status, 'brouillon'))).returning({ id: t.documentVersions.id });
    if (r) {
      await logDoc(tx, v.documentId, {
        action: 'archive', byId: session.user.id, reason,
        summary: inForce.length ? `Brouillon de la version ${v.version} abandonné` : `Brouillon de la version ${v.version} abandonné : document classé « Abandonné »`,
      });
    }
    return r;
  });
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

// ─── Revue périodique sans modification (DOC-15) ────────────────────────────

/**
 * Revue périodique d'un document en vigueur sans modification (DOC-15, ISO 9001 §7.5.2) : le document reste adapté, sans
 * nouvelle révision ni changement d'indice ; la prochaine revue repart de cette date. Propriétaire du document ou
 * approbateurs (animateur QHSE, direction), rôle qui rédige sur l'écran Documents ; document du site sélectionné ; refusée
 * pendant une révision en cours (la révision tient lieu de revue). Journal du document dans la transaction.
 */
export async function recordDocumentReview(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireDocEditor();
  if (error) return { error };
  const f = formReader(fd);
  const documentId = f.str('documentId', { required: true });
  const reviewedOn = f.date('reviewedOn', { required: true });
  const conclusion = f.str('conclusion', { required: true, max: 1000 });
  if (reviewedOn && reviewedOn > today()) f.fail('reviewedOn', 'Date postérieure à aujourd’hui.');
  if (!f.ok) return f.state();
  const db = await getDb();
  const [doc] = await db.select().from(t.documents).where(eq(t.documents.id, documentId));
  if (!doc) return { error: 'Document introuvable.' };
  const siteError = await requireInSite(doc.siteId);
  if (siteError) return { error: siteError };
  if (doc.ownerId !== session.user.id && !canApprove(session.role)) return { error: 'Revue périodique : propriétaire du document, animateur QHSE ou direction.' };
  const saved = await db.transaction(async (tx): Promise<string | null> => {
    const versions = await tx.select().from(t.documentVersions).where(eq(t.documentVersions.documentId, documentId));
    const current = versions.find((v) => v.status === 'approuve');
    if (!current) return "Aucune version en vigueur : la revue porte sur la version approuvée.";
    const pending = versions.find((v) => v.status === 'brouillon' || v.status === 'en_revue');
    if (pending) return `Révision ${pending.version} en cours : son approbation tiendra lieu de revue.`;
    if (current.approvedOn && reviewedOn! < current.approvedOn) return `La revue suit l'approbation de la version ${current.version} (${fmtDate(current.approvedOn)}).`;
    await tx.insert(t.documentReviews).values({ documentId, version: current.version, reviewedOn: reviewedOn!, reviewerId: session.user.id, conclusion });
    await logDoc(tx, documentId, {
      action: 'review', byId: session.user.id,
      summary: `Revue périodique sans modification · version ${current.version} maintenue (${fmtDate(reviewedOn!)})`,
      details: [{ field: 'Conclusion', from: null, to: conclusion }],
    });
    return null;
  });
  if (saved) return { error: saved };
  return done(documentId);
}

/** Annule une revue périodique saisie par erreur (motif obligatoire, jamais supprimée) : animateur QHSE et direction. */
export async function cancelDocumentReview(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [row] = await db.select({ review: t.documentReviews, siteId: t.documents.siteId }).from(t.documentReviews)
    .innerJoin(t.documents, eq(t.documents.id, t.documentReviews.documentId)).where(eq(t.documentReviews.id, id!));
  if (!row) return { error: 'Revue introuvable.' };
  const siteError = await requireInSite(row.siteId);
  if (siteError) return { error: siteError };
  if (row.review.cancelledAt) return { error: 'Revue déjà annulée.' };
  await db.transaction(async (tx) => {
    await tx.update(t.documentReviews).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.documentReviews.id, row.review.id));
    await logDoc(tx, row.review.documentId, { action: 'cancel', reason, byId: session.user.id, summary: `Revue périodique du ${fmtDate(row.review.reviewedOn)} annulée` });
  });
  return done(row.review.documentId);
}
