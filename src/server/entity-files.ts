'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { fmtDate } from '@/lib/dates';
import { canApprove, canEdit, canManage, canSee, type Role } from '@/lib/domain';
import { ENTITY_FILE_KINDS, attachSummary, detachSummary, isEntityFileKind, validEntityId, type EntityFileKind } from '@/lib/entity-files';
import { formReader, reasonError } from '@/lib/forms';
import { requireInSite } from '@/lib/guard';
import { getSession } from '@/lib/session';
import { deleteAttachment, removeStoredFile, saveUpload } from '@/lib/uploads';
import { filesProblem } from './action-create';
import { logChange } from './changelog';

// Pièces jointes génériques des fiches (paquet 6 : DUE-09, VEI-08, AUD-17, DOC-11) : ajout et retrait après la saisie.
// Ordre des contrôles : type et identifiant → droit du rôle sur l'écran → chargement de l'entité → site (requireInSite)
// → fiche figée (archivée, annulée, revue clôturée, version du DUERP archivée) → écriture et journal (logChange) dans
// une transaction. Retrait : motif obligatoire, ligne `attachments` supprimée et journalisée dans la transaction, fichier
// effacé après validation (removeStoredFile), comme les preuves d'action. Lecture : /fichiers/[id] (canReadAttachment).

type Result = { error?: string; count?: number };
type Session = Awaited<ReturnType<typeof getSession>>;

const DENIED = 'Votre rôle ne permet pas cette modification.';

/** Propriétaire d'une pièce jointe : site à contrôler, entrée de journal, précision et état figé. */
type Owner = {
  /** Site de l'entité (requireInSite) ; undefined = entité commune, sans contrôle de site (DUERP, veille, revue). */
  siteId?: string | null;
  journalId: string | number;
  /** Précision ajoutée à la phrase du journal (« enregistrement du 12/03/2026 »). */
  context?: string;
  /** Raison pour laquelle la fiche n'accepte plus d'ajout ni de retrait (null : modifiable). */
  frozen: string | null;
  /** Retrait limité aux fichiers envoyés par la personne (contributeur d'un élément de revue sans droit de saisie). */
  ownFilesOnly?: boolean;
};

/** Droit du rôle sur l'écran du type d'entité (avant tout chargement). */
function roleError(kind: EntityFileKind, role: Role): string | null {
  switch (kind) {
    case 'duerp_version': return canApprove(role) && canEdit(role, 'risks') ? null : "Réservé à l'animateur QHSE et à la direction.";
    case 'risk': return canEdit(role, 'risks') ? null : DENIED;
    case 'requirement':
    case 'requirement_evaluation':
    case 'control_record': return canManage(role) && canSee(role, 'watch') ? null : DENIED;
    case 'review': return canEdit(role, 'audits') ? null : DENIED;
    case 'review_item': return null; // contributeur de l'élément, quel que soit son rôle (contrôlé au chargement)
    case 'waste_entry': return canEdit(role, 'env') ? null : DENIED;
  }
}

/** Charge l'entité propriétaire ; null si introuvable, `{ error }` si refusée à la personne. */
async function ownerOf(db: DbOrTx, kind: EntityFileKind, id: string, session: Session): Promise<Owner | { error: string } | null> {
  const num = Number(id);
  switch (kind) {
    case 'duerp_version': {
      const [v] = await db.select({ version: t.duerpVersions.version, current: t.duerpVersions.current, archivedOn: t.duerpVersions.archivedOn })
        .from(t.duerpVersions).where(eq(t.duerpVersions.version, id));
      if (!v) return null;
      return { journalId: v.version, frozen: !v.current || v.archivedOn ? `Version ${v.version} archivée : ses pièces sont figées.` : null };
    }
    case 'risk': {
      const [r] = await db.select({ archivedAt: t.risks.archivedAt, siteId: t.workUnits.siteId, unitArchivedAt: t.workUnits.archivedAt })
        .from(t.risks).innerJoin(t.workUnits, eq(t.workUnits.id, t.risks.unitId)).where(eq(t.risks.id, num));
      if (!r) return null;
      return { siteId: r.siteId, journalId: num, frozen: r.archivedAt || r.unitArchivedAt ? 'Risque archivé : restaurez-le pour modifier ses justificatifs.' : null };
    }
    case 'requirement': {
      const [r] = await db.select({ archivedAt: t.requirements.archivedAt }).from(t.requirements).where(eq(t.requirements.id, num));
      if (!r) return null;
      return { journalId: num, frozen: r.archivedAt ? 'Exigence archivée : restaurez-la pour la modifier.' : null };
    }
    case 'requirement_evaluation': {
      const [e] = await db.select({ requirementId: t.requirementEvaluations.requirementId, evaluatedOn: t.requirementEvaluations.evaluatedOn, archivedAt: t.requirements.archivedAt })
        .from(t.requirementEvaluations).innerJoin(t.requirements, eq(t.requirements.id, t.requirementEvaluations.requirementId))
        .where(eq(t.requirementEvaluations.id, num));
      if (!e) return null;
      return { journalId: e.requirementId, context: `évaluation du ${fmtDate(e.evaluatedOn)}`, frozen: e.archivedAt ? 'Exigence archivée : restaurez-la pour la modifier.' : null };
    }
    case 'control_record': {
      const [r] = await db.select({
        controlId: t.controlRecords.controlId, performedOn: t.controlRecords.performedOn, cancelledAt: t.controlRecords.cancelledAt,
        siteId: t.controls.siteId, archivedAt: t.controls.archivedAt,
      }).from(t.controlRecords).innerJoin(t.controls, eq(t.controls.id, t.controlRecords.controlId)).where(eq(t.controlRecords.id, num));
      if (!r) return null;
      const frozen = r.cancelledAt ? 'Enregistrement annulé : ses pièces jointes sont conservées pour la trace.'
        : r.archivedAt ? 'Contrôle archivé : restaurez-le pour le modifier.' : null;
      return { siteId: r.siteId, journalId: r.controlId, context: `enregistrement du ${fmtDate(r.performedOn)}`, frozen };
    }
    case 'review':
    case 'review_item': {
      const [row] = kind === 'review'
        ? await db.select({ review: t.reviews, ownerId: t.reviews.recordedById, label: t.reviews.reviewOn }).from(t.reviews).where(eq(t.reviews.id, num))
        : await db.select({ review: t.reviews, ownerId: t.reviewItems.ownerId, label: t.reviewItems.label }).from(t.reviewItems)
          .innerJoin(t.reviews, eq(t.reviews.id, t.reviewItems.reviewId)).where(eq(t.reviewItems.id, num));
      if (!row) return null;
      const editor = canEdit(session.role, 'audits');
      const contributor = kind === 'review_item' && !!row.ownerId && row.ownerId === session.user.id;
      if (!editor && !contributor) return { error: DENIED };
      const frozen = row.review.status === 'cloturee' ? 'Revue clôturée : dossier figé au visa, pièces jointes comprises.'
        : row.review.status === 'annulee' ? 'Revue annulée : pièces jointes figées.' : null;
      return {
        journalId: row.review.id, context: kind === 'review_item' ? `élément « ${row.label} »` : undefined, frozen,
        ownFilesOnly: !editor,
      };
    }
    case 'waste_entry': {
      const [e] = await db.select({ siteId: t.wasteEntries.siteId, cancelledAt: t.wasteEntries.cancelledAt, removedOn: t.wasteEntries.removedOn })
        .from(t.wasteEntries).where(eq(t.wasteEntries.id, num));
      if (!e) return null;
      return { siteId: e.siteId, journalId: num, frozen: e.cancelledAt ? 'Enlèvement annulé : ses pièces sont conservées pour la trace.' : null };
    }
  }
}

/** Contrôles communs à l'ajout et au retrait ; renvoie le propriétaire ou un message d'erreur. */
async function checkOwner(db: DbOrTx, kind: EntityFileKind, id: string, session: Session): Promise<Owner | string> {
  const denied = roleError(kind, session.role);
  if (denied) return denied;
  const owner = await ownerOf(db, kind, id, session);
  if (!owner) return 'Fiche introuvable.';
  if ('error' in owner) return owner.error;
  if (owner.siteId !== undefined) {
    const blocked = await requireInSite(owner.siteId);
    if (blocked) return blocked;
  }
  if (owner.frozen) return owner.frozen;
  return owner;
}

/**
 * Joint des fichiers à une fiche (champs `kind`, `entityId`, `files`) : droit de saisie sur l'écran, site de la fiche,
 * fiche modifiable ; une entrée « attach » au journal de la fiche, dans la transaction des lignes.
 */
export async function addEntityFiles(fd: FormData): Promise<Result> {
  const session = await getSession();
  const f = formReader(fd);
  const kind = f.str('kind');
  const entityId = f.str('entityId');
  const files = f.files('files');
  if (!isEntityFileKind(kind) || !validEntityId(kind, entityId)) return { error: 'Fiche introuvable.' };
  const db = await getDb();
  const owner = await checkOwner(db, kind, entityId, session);
  if (typeof owner === 'string') return { error: owner };
  if (!files.length) return { error: 'Choisissez au moins un fichier.' };
  const invalid = await filesProblem(files, session.user.id);
  if (invalid) return { error: invalid };
  const label = ENTITY_FILE_KINDS[kind].label;
  await db.transaction(async (tx) => {
    for (const file of files) await saveUpload(file, kind, entityId, session.user.id, { db: tx });
    await logChange(tx, {
      entityType: ENTITY_FILE_KINDS[kind].journal, entityId: owner.journalId, action: 'attach', byId: session.user.id,
      summary: attachSummary(kind, files.length, owner.context),
      details: files.map((file) => ({ field: label, from: null, to: file.name.slice(0, 200) || 'fichier' })),
    });
  });
  revalidatePath('/', 'layout');
  return { count: files.length };
}

/**
 * Retire une pièce jointe d'une fiche, avec un motif obligatoire : mêmes contrôles qu'à l'ajout ; ligne supprimée et
 * journalisée (« detach », motif) dans une transaction, fichier effacé après validation. Deux retraits simultanés : un
 * seul supprime la ligne, donc un seul est journalisé.
 */
export async function removeEntityFile(attachmentId: string, reason: string): Promise<Result> {
  const session = await getSession();
  if (typeof attachmentId !== 'string' || !attachmentId) return { error: 'Pièce jointe introuvable.' };
  // Règle commune des motifs (QUA-22) : obligatoire, REASON_MAX caractères au plus.
  const reasonIssue = reasonError(reason);
  if (reasonIssue) return { error: reasonIssue };
  const motive = String(reason).trim();
  const db = await getDb();
  const [row] = await db.select().from(t.attachments).where(eq(t.attachments.id, attachmentId));
  if (!row || !isEntityFileKind(row.entityType) || row.health) return { error: 'Pièce jointe introuvable.' };
  const kind = row.entityType;
  const owner = await checkOwner(db, kind, row.entityId, session);
  if (typeof owner === 'string') return { error: owner };
  if (owner.ownFilesOnly && row.uploadedBy !== session.user.id) return { error: 'Seul le service QHSE ou la personne qui a joint ce fichier peut le retirer.' };
  const removed = await db.transaction(async (tx) => {
    const gone = await deleteAttachment(row.id, { db: tx });
    if (!gone) return null;
    await logChange(tx, {
      entityType: ENTITY_FILE_KINDS[kind].journal, entityId: owner.journalId, action: 'detach', byId: session.user.id, reason: motive,
      summary: detachSummary(kind, row.fileName, owner.context),
      details: [{ field: ENTITY_FILE_KINDS[kind].label, from: row.fileName, to: null }],
    });
    return gone;
  });
  if (!removed) return { error: 'Pièce jointe introuvable.' };
  await removeStoredFile(removed);
  revalidatePath('/', 'layout');
  return {};
}
