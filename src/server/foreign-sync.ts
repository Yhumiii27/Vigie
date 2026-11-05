import 'server-only';
import { eq, inArray, isNotNull } from 'drizzle-orm';
import { schema as t, type Db } from '@/db';
import { addDays } from '@/lib/dates';
import { readAssignments, readProjects, readSuppliers } from '@/lib/foreign/keystone';
import { readCursusTitles, readHeldTitles } from '@/lib/foreign/cursus';
import { readMatrixSites } from '@/lib/foreign/matrix';
import { readDocumentRevisions, readDocumentTypes, readDocumentValidations, readRegisterDocuments } from '@/lib/foreign/codex';
import { QHSE_DEPARTMENTS } from '@/lib/rules/documents';
import { CURSUS_TITLE_STATES, MATRIX_SITE_STATES, SOURCES, type CursusTitleState, type MatrixSiteState, type SourceKey, type SyncStatus } from '@/lib/foreign/labels';
import type { SourceRead } from '@/lib/foreign/source';
import { log } from '@/lib/log';
import { today } from '@/lib/today';
import { logChange, type ChangeDetail } from './changelog';

// Rafraîchissement des caches lus chez les autres outils (lot 0 de M-02, docs/specs/convergence-m02.md § 2.2) : seul ce
// module écrit les caches (jamais un formulaire). Appelé à l'ouverture de la base (src/db/index.ts), par la tâche planifiée
// « Référentiels partagés » (src/db/scheduler.ts, une fois par nuit) et par le bouton « Actualiser » de l'onglet
// « Connecteurs » (src/server/connectors.ts). Une transaction par cache ; chaque passage écrit une ligne de sync_runs
// par source (nombres et message technique, aucune donnée personnelle). Les sources lues directement (projets,
// fournisseurs, titres détenus, documents de Codex) y sont seulement contrôlées (disponibilité, nombre de lignes).
//
// - sites (D14, cache de matrix.pub_sites) : libellé et ordre repris de Matrix, état actif | ferme | absent ; un site absent
//   de la vue n'est jamais supprimé ni archivé d'office (signal « fermé dans Matrix », loadSiteSignals) ; changement de
//   libellé, d'ordre ou d'état journalisé sur le site (auteur vide : tâche du serveur).
// - titres (D08, cache de cursus.pub_titres, lot 2) : intitulé (libelle_court) et validité (validite_mois, nul = sans
//   échéance → 0) des titres suivis repris de Cursus, état actif | absent ; un titre absent du catalogue n'est jamais
//   supprimé ni retiré du suivi d'office ; changement journalisé sur le titre (auteur vide). Les titres détenus
//   (cursus.pub_titres_detenus, D09) sont lus directement : seulement contrôlés ici.
// - affectations (D04, cache de keystone.pub_affectations) : affectations finies depuis moins d'un an des salariés dont le
//   matricule est connu ; une affectation disparue de la vue est retirée du cache (cache sans historique propre).

export type SyncResult = { source: SourceKey; status: SyncStatus; read: number; added: number; updated: number; removed: number; message: string | null };

/** Horizon des affectations reprises (fin il y a moins d'un an), plan de Matrix § D04. */
export const ASSIGNMENT_HISTORY_DAYS = 365;

async function record(db: Db, startedAt: Date, r: SyncResult) {
  await db.insert(t.syncRuns).values({
    source: SOURCES[r.source].view, startedAt, finishedAt: new Date(), status: r.status,
    read: r.read, added: r.added, updated: r.updated, removed: r.removed, message: r.message,
  });
  if (r.status === 'error') log.error('foreign.sync', `Rafraîchissement de ${SOURCES[r.source].view} en erreur`, { source: SOURCES[r.source].view, message: r.message });
  else if (r.status === 'ok' && (r.added || r.updated || r.removed)) {
    log.info('foreign.sync', `Cache ${SOURCES[r.source].view} rafraîchi`, { source: SOURCES[r.source].view, read: r.read, added: r.added, updated: r.updated, removed: r.removed });
  }
}

const empty = (source: SourceKey): SyncResult => ({ source, status: 'ok', read: 0, added: 0, updated: 0, removed: 0, message: null });
const failed = (source: SourceKey, read: Extract<SourceRead<unknown>, { ok: false }>): SyncResult => ({ ...empty(source), status: read.status, message: read.message });

/** Sites suivis par Vigie : libellé, ordre et état repris de matrix.pub_sites. */
async function refreshSites(db: Db): Promise<SyncResult> {
  const read = await readMatrixSites(db);
  if (!read.ok) return failed('sites', read);
  const byCode = new Map(read.rows.map((s) => [s.code, s]));
  const result = { ...empty('sites'), read: read.rows.length };
  await db.transaction(async (tx) => {
    const local = await tx.select({ id: t.sites.id, label: t.sites.label, sort: t.sites.sort, matrixState: t.sites.matrixState }).from(t.sites);
    for (const s of local) {
      const src = byCode.get(s.id);
      const state: MatrixSiteState = !src ? 'absent' : src.active ? 'actif' : 'ferme';
      const label = src?.label ?? s.label;
      const sort = src?.sort ?? s.sort;
      if (label === s.label && sort === s.sort && state === s.matrixState) continue;
      await tx.update(t.sites).set({ label, sort, matrixState: state }).where(eq(t.sites.id, s.id));
      result.updated++;
      if (state === 'absent' && s.matrixState !== 'absent') result.removed++;
      const details: ChangeDetail[] = [
        ...(label !== s.label ? [{ field: 'Libellé', from: s.label, to: label }] : []),
        ...(sort !== s.sort ? [{ field: 'Ordre', from: String(s.sort), to: String(sort) }] : []),
        // Premier état lu « actif » : sans intérêt pour l'historique.
        ...(state !== s.matrixState && (s.matrixState || state !== 'actif')
          ? [{ field: 'État dans Matrix', from: s.matrixState ? MATRIX_SITE_STATES[s.matrixState as MatrixSiteState].label : null, to: MATRIX_SITE_STATES[state].label }] : []),
      ];
      if (details.length) {
        await logChange(tx, { byId: null, entityType: 'site', entityId: s.id, action: 'sync', summary: 'Site mis à jour depuis Matrix (référentiel des sites)', details });
      }
    }
  });
  return result;
}

/** Titres suivis par Vigie : intitulé, validité et état repris de cursus.pub_titres. */
async function refreshTitles(db: Db): Promise<SyncResult> {
  const read = await readCursusTitles(db);
  if (!read.ok) return failed('titles', read);
  const byId = new Map(read.rows.map((x) => [x.id, x]));
  const result = { ...empty('titles'), read: read.rows.length };
  await db.transaction(async (tx) => {
    const local = await tx.select({ id: t.trainingTitles.id, label: t.trainingTitles.label, validityMonths: t.trainingTitles.validityMonths, cursusState: t.trainingTitles.cursusState }).from(t.trainingTitles);
    for (const x of local) {
      const src = byId.get(x.id);
      const state: CursusTitleState = src ? 'actif' : 'absent';
      const label = src?.shortLabel ?? x.label;
      const validityMonths = src ? src.validityMonths ?? 0 : x.validityMonths;
      if (label === x.label && validityMonths === x.validityMonths && state === x.cursusState) continue;
      await tx.update(t.trainingTitles).set({ label, validityMonths, cursusState: state }).where(eq(t.trainingTitles.id, x.id));
      result.updated++;
      if (state === 'absent' && x.cursusState !== 'absent') result.removed++;
      const months = (n: number) => (n ? `${n} mois` : 'sans échéance');
      const details: ChangeDetail[] = [
        ...(label !== x.label ? [{ field: 'Intitulé', from: x.label, to: label }] : []),
        ...(validityMonths !== x.validityMonths ? [{ field: 'Validité', from: months(x.validityMonths), to: months(validityMonths) }] : []),
        // Premier état lu « au catalogue » : sans intérêt pour l'historique.
        ...(state !== x.cursusState && (x.cursusState || state !== 'actif')
          ? [{ field: 'Catalogue de Cursus', from: x.cursusState ? CURSUS_TITLE_STATES[x.cursusState as CursusTitleState].label : null, to: CURSUS_TITLE_STATES[state].label }] : []),
      ];
      if (details.length) {
        await logChange(tx, { byId: null, entityType: 'training_title', entityId: x.id, action: 'sync', summary: 'Titre mis à jour depuis Cursus (catalogue des titres)', details });
      }
    }
  });
  return result;
}

/** Affectations des salariés rattachés par matricule, depuis keystone.pub_affectations. */
async function refreshAssignments(db: Db): Promise<SyncResult> {
  const read = await readAssignments(db, addDays(today(), -ASSIGNMENT_HISTORY_DAYS));
  if (!read.ok) return failed('assignments', read);
  const result = { ...empty('assignments'), read: read.rows.length };
  await db.transaction(async (tx) => {
    const people = await tx.select({ id: t.people.id, matricule: t.people.matricule }).from(t.people).where(isNotNull(t.people.matricule));
    const byMatricule = new Map(people.map((p) => [p.matricule!, p.id]));
    const wanted = new Map(read.rows.flatMap((a) => {
      const personId = a.matricule ? byMatricule.get(a.matricule) : undefined;
      if (!personId || !a.from || !a.to) return [];
      const project = a.projectCode ? (a.client ? `${a.projectCode} · ${a.client}` : a.projectCode) : '';
      return [[a.affectationId, {
        personId, project, activity: a.activity ?? '', startOn: a.from, endOn: a.to, affectationId: a.affectationId,
        source: a.source === 'rotation' || a.source === 'planning' ? a.source : null, projectCode: a.projectCode,
      }] as const];
    }));
    const current = await tx.select().from(t.keystoneAssignments);
    const stale = current.filter((c) => !c.affectationId || !wanted.has(c.affectationId)).map((c) => c.id);
    if (stale.length) await tx.delete(t.keystoneAssignments).where(inArray(t.keystoneAssignments.id, stale));
    result.removed = stale.length;
    const byId = new Map(current.filter((c) => c.affectationId).map((c) => [c.affectationId!, c]));
    for (const [id, row] of wanted) {
      const before = byId.get(id);
      if (!before) {
        await tx.insert(t.keystoneAssignments).values(row);
        result.added++;
      } else if ((Object.keys(row) as (keyof typeof row)[]).some((k) => (before[k] ?? null) !== (row[k] ?? null))) {
        await tx.update(t.keystoneAssignments).set(row).where(eq(t.keystoneAssignments.id, before.id));
        result.updated++;
      }
    }
  });
  return result;
}

/** Source lue directement : disponibilité et nombre de lignes. */
async function checkDirect(source: 'projects' | 'suppliers' | 'heldTitles' | 'documents' | 'revisions' | 'validations' | 'docTypes', read: Promise<SourceRead<unknown>>): Promise<SyncResult> {
  const r = await read;
  return r.ok ? { ...empty(source), read: r.rows.length } : failed(source, r);
}

/**
 * Rafraîchit les caches et contrôle les lectures directes ; jamais d'exception (erreur d'une source : ligne « error » de
 * sync_runs et journal du serveur, les autres sources continuent).
 */
export async function refreshSharedReferences(db: Db): Promise<SyncResult[]> {
  const steps: [SourceKey, () => Promise<SyncResult>][] = [
    ['sites', () => refreshSites(db)],
    ['assignments', () => refreshAssignments(db)],
    ['projects', () => checkDirect('projects', readProjects(db))],
    ['suppliers', () => checkDirect('suppliers', readSuppliers(db))],
    ['titles', () => refreshTitles(db)],
    ['heldTitles', () => checkDirect('heldTitles', readHeldTitles(db))],
    // D10 (lot 4) : documents de Codex lus directement (registre, révisions et circuits du périmètre QHSE, types).
    ['documents', () => checkDirect('documents', readRegisterDocuments(db, QHSE_DEPARTMENTS))],
    ['revisions', () => checkDirect('revisions', readRegisterDocuments(db, QHSE_DEPARTMENTS).then((d) => (d.ok ? readDocumentRevisions(db, d.rows.map((x) => x.id)) : d)))],
    ['validations', () => checkDirect('validations', readRegisterDocuments(db, QHSE_DEPARTMENTS).then((d) => (d.ok ? readDocumentValidations(db, d.rows.map((x) => x.id)) : d)))],
    ['docTypes', () => checkDirect('docTypes', readDocumentTypes(db))],
  ];
  const results: SyncResult[] = [];
  for (const [source, run] of steps) {
    const startedAt = new Date();
    let r: SyncResult;
    try {
      r = await run();
    } catch (err) {
      r = { ...empty(source), status: 'error', message: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) };
    }
    try {
      await record(db, startedAt, r);
    } catch (err) {
      log.error('foreign.sync', 'Journal des rafraîchissements non écrit', { error: err });
    }
    results.push(r);
  }
  return results;
}
