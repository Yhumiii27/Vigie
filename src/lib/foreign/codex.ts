import 'server-only';
import { asc, inArray, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db';
import { pubDocuments, pubRevisionsDocument, pubTypesDocument, pubValidations } from '@/db/foreign';
import { readSource, type SourceRead } from './source';

// Lectures de Codex (lot 4 de M-02, D10, décision CV-05 du 05/11/2026 : Codex fait foi pour les documents ; Vigie les
// consulte). Lues directement à chaque requête (aucun cache) : fiches documents, révisions, circuits de validation et
// registre des types. Codex retire de ses vues les documents « tres_confidentiel » ; la confidentialité restante est
// appliquée par Vigie (src/lib/rules/documents.ts, confReadable). Aucune écriture chez Codex.

export type CodexDocument = {
  id: string;
  /** Anciens identifiants (dont l'identifiant de Vigie d'avant la bascule) : un lien ou une référence écrits avant restent résolus. */
  aliases: string[];
  title: string;
  origin: string | null;
  attachment: string | null;
  projectCode: string | null;
  typeCode: string | null;
  subtype: string | null;
  department: string | null;
  /** Site (code de Matrix = identifiant de site de Vigie) ; null = toute l'entreprise. */
  site: string | null;
  ownerName: string | null;
  ownerMatricule: string | null;
  conf: string | null;
  state: string | null;
  status: string | null;
  revInForce: string | null;
  revWorking: string | null;
  issuedAt: string | null;
  reviewDueAt: string | null;
  sourceOrg: string | null;
  externalRef: string | null;
  legalHold: boolean;
  obsoleteAt: string | null;
  archivedAt: string | null;
  modifiedAt: string | null;
  distribution: string | null;
  reviewMonths: number | null;
  processCode: string | null;
};

const documentColumns = {
  id: pubDocuments.id, aliases: pubDocuments.aliases, title: pubDocuments.title, origin: pubDocuments.origin, attachment: pubDocuments.attachment,
  projectCode: pubDocuments.projectCode, typeCode: pubDocuments.typeCode, subtype: pubDocuments.subtype, department: pubDocuments.department,
  site: pubDocuments.site, ownerName: pubDocuments.ownerName, ownerMatricule: pubDocuments.ownerMatricule, conf: pubDocuments.conf,
  state: pubDocuments.state, status: pubDocuments.status, revInForce: pubDocuments.revInForce, revWorking: pubDocuments.revWorking,
  issuedAt: pubDocuments.issuedAt, reviewDueAt: pubDocuments.reviewDueAt, sourceOrg: pubDocuments.sourceOrg, externalRef: pubDocuments.externalRef,
  legalHold: pubDocuments.legalHold, obsoleteAt: pubDocuments.obsoleteAt, archivedAt: pubDocuments.archivedAt, modifiedAt: pubDocuments.modifiedAt,
  distribution: pubDocuments.distribution, reviewMonths: pubDocuments.reviewMonths, processCode: pubDocuments.processCode,
};

const toDocument = (r: { [K in keyof typeof documentColumns]: unknown }): CodexDocument => ({
  ...(r as Omit<CodexDocument, 'aliases' | 'legalHold'>),
  aliases: Array.isArray(r.aliases) ? r.aliases.filter((a): a is string => typeof a === 'string') : [],
  legalHold: r.legalHold === true,
});

/** Documents publiés par Codex des départements donnés, sans rattachement (projet, recherche, CAPEX) : registre de Vigie. */
export function readRegisterDocuments(db: DbOrTx, departments: readonly string[]): Promise<SourceRead<CodexDocument>> {
  return readSource(db, 'documents', async () => (await db.select(documentColumns).from(pubDocuments)
    .where(sql`${pubDocuments.attachment} = 'none' and ${inArray(pubDocuments.department, [...departments])}`)
    .orderBy(asc(pubDocuments.id))).map(toDocument));
}

/**
 * Documents désignés par leur identifiant ou un ancien identifiant (alias), quel que soit leur périmètre : un document
 * cité par une fiche de Vigie (événement, action, mesure de maîtrise) reste toujours résolu.
 */
export function readDocumentsByRef(db: DbOrTx, refs: readonly string[]): Promise<SourceRead<CodexDocument>> {
  const list = [...new Set(refs.filter(Boolean))];
  return readSource(db, 'documents', async () => (list.length ? (await db.select(documentColumns).from(pubDocuments)
    .where(or(inArray(pubDocuments.id, list), sql`${pubDocuments.aliases} ?| array[${sql.join(list.map((r) => sql`${r}`), sql`, `)}]::text[]`))
    .orderBy(asc(pubDocuments.id))).map(toDocument) : []));
}

export type CodexRevision = {
  docId: string; letter: string; status: string; createdAt: string | null; approvedAt: string | null; inForceAt: string | null;
  supersededAt: string | null; changeRef: string | null; lastVersionN: number | null; lastVersionDate: string | null;
  lastVersionAuthor: string | null; comment: string | null; fileName: string | null;
};

/** Révisions des documents donnés (la plus récente d'abord par document). */
export function readDocumentRevisions(db: DbOrTx, docIds: readonly string[]): Promise<SourceRead<CodexRevision>> {
  const ids = [...new Set(docIds)];
  return readSource(db, 'revisions', async () => (ids.length ? await db.select({
    docId: pubRevisionsDocument.docId, letter: pubRevisionsDocument.letter, status: pubRevisionsDocument.status, createdAt: pubRevisionsDocument.createdAt,
    approvedAt: pubRevisionsDocument.approvedAt, inForceAt: pubRevisionsDocument.inForceAt, supersededAt: pubRevisionsDocument.supersededAt,
    changeRef: pubRevisionsDocument.changeRef, lastVersionN: pubRevisionsDocument.lastVersionN, lastVersionDate: pubRevisionsDocument.lastVersionDate,
    lastVersionAuthor: pubRevisionsDocument.lastVersionAuthorName, comment: pubRevisionsDocument.lastVersionComment, fileName: pubRevisionsDocument.fileName,
  }).from(pubRevisionsDocument).where(inArray(pubRevisionsDocument.docId, ids)).orderBy(asc(pubRevisionsDocument.docId), asc(pubRevisionsDocument.revisionId)) : [])
    .flatMap((r) => (r.docId && r.letter && r.status ? [{ ...r, docId: r.docId, letter: r.letter, status: r.status }] : [])));
}

export type CodexValidationStep = {
  workflowId: string; docId: string; revision: string | null; due: string | null; currentStep: number | null; outcome: string | null;
  createdAt: string | null; idx: number; stepLabel: string | null; assigneeName: string | null; assigneeMatricule: string | null; doneOn: string | null;
};

/** Étapes des circuits de validation des documents donnés. */
export function readDocumentValidations(db: DbOrTx, docIds: readonly string[]): Promise<SourceRead<CodexValidationStep>> {
  const ids = [...new Set(docIds)];
  return readSource(db, 'validations', async () => (ids.length ? await db.select({
    workflowId: pubValidations.workflowId, docId: pubValidations.docId, revision: pubValidations.revision, due: pubValidations.due,
    currentStep: pubValidations.currentStep, outcome: pubValidations.outcome, createdAt: pubValidations.createdAt, idx: pubValidations.idx,
    stepLabel: pubValidations.stepLabel, assigneeName: pubValidations.assigneeName, assigneeMatricule: pubValidations.assigneeMatricule, doneOn: pubValidations.doneOn,
  }).from(pubValidations).where(inArray(pubValidations.docId, ids)).orderBy(asc(pubValidations.workflowId), asc(pubValidations.idx)) : [])
    .flatMap((r) => (r.workflowId && r.docId ? [{ ...r, workflowId: r.workflowId, docId: r.docId, idx: r.idx ?? 0 }] : [])));
}

export type CodexDocType = {
  code: string; label: string; familyLabel: string | null; retentionYears: number | null; retentionTrigger: string | null;
  retentionDisposition: string | null; retentionBasis: string | null; iso: string | null;
};

/** Registre des types de Codex (libellés, conservation par type). */
export function readDocumentTypes(db: DbOrTx): Promise<SourceRead<CodexDocType>> {
  return readSource(db, 'docTypes', async () => (await db.select({
    code: pubTypesDocument.code, label: pubTypesDocument.labelFr, familyLabel: pubTypesDocument.familyLabelFr, retentionYears: pubTypesDocument.retentionYears,
    retentionTrigger: pubTypesDocument.retentionTrigger, retentionDisposition: pubTypesDocument.retentionDisposition,
    retentionBasis: pubTypesDocument.retentionBasis, iso: pubTypesDocument.iso,
  }).from(pubTypesDocument).orderBy(asc(pubTypesDocument.sort), asc(pubTypesDocument.code)))
    .flatMap((r) => (r.code ? [{ ...r, code: r.code, label: r.label ?? r.code }] : [])));
}

/** Documents dont la personne de ce matricule est propriétaire dans Codex (données d'une personne, SEC-13). */
export function readDocumentsByOwner(db: DbOrTx, matricule: string): Promise<SourceRead<{ id: string; title: string }>> {
  return readSource(db, 'documents', async () => db.select({ id: pubDocuments.id, title: pubDocuments.title }).from(pubDocuments)
    .where(sql`${pubDocuments.ownerMatricule} = ${matricule}`).orderBy(asc(pubDocuments.id)));
}
