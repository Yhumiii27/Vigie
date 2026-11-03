import 'server-only';
import { cache } from 'react';
import { asc, gte } from 'drizzle-orm';
import { getDb, type DbOrTx } from '@/db';
import { pubAffectations, pubFournisseurs, pubProjets } from '@/db/foreign';
import { unavailableMessage } from './labels';
import { readSource, type SourceRead } from './source';

// Lectures de Keystone. D02 : projets lus directement dans keystone.pub_projets (plus de table keystone_projects) ;
// D04 : affectations (cache keystone_assignments, src/server/foreign-sync.ts) ; D16 : fournisseurs (choix d'une entreprise
// extérieure, contractors.supplier_id).

export type KeystoneProject = { code: string; name: string; client: string | null; phase: string | null; open: boolean };

/** Projets de Keystone (internes compris), par code. */
export function readProjects(db: DbOrTx): Promise<SourceRead<KeystoneProject>> {
  return readSource(db, 'projects', async () => (await db.select({
    code: pubProjets.code, name: pubProjets.nom, client: pubProjets.client, phase: pubProjets.phase, imputable: pubProjets.imputable,
  }).from(pubProjets).orderBy(asc(pubProjets.code))).map(({ imputable, ...p }) => ({ ...p, open: imputable !== false })));
}

/** Projets de Keystone de la requête (listes de choix, affichage « code · client »). */
export const loadProjects = cache(async () => readProjects(await getDb()));

/** Index des projets par code, ou null si la source est indisponible (affichage : code seul, ou ancien libellé). */
export const loadProjectIndex = cache(async (): Promise<ReadonlyMap<string, KeystoneProject> | null> => {
  const r = await loadProjects();
  return r.ok ? new Map(r.rows.map((p) => [p.code, p])) : null;
});

export type KeystoneAssignment = {
  affectationId: string; source: string | null; matricule: string | null; projectCode: string | null; client: string | null;
  activity: string | null; from: string | null; to: string | null;
};

/** Affectations de Keystone qui finissent le `since` ou après (« AAAA-MM-JJ »). */
export function readAssignments(db: DbOrTx, since: string): Promise<SourceRead<KeystoneAssignment>> {
  return readSource(db, 'assignments', async () => (await db.select({
    affectationId: pubAffectations.affectationId, source: pubAffectations.source, matricule: pubAffectations.matricule,
    projectCode: pubAffectations.projetCode, client: pubAffectations.client, activity: pubAffectations.activite,
    from: pubAffectations.du, to: pubAffectations.au,
  }).from(pubAffectations).where(gte(pubAffectations.au, since))).filter((a): a is KeystoneAssignment => !!a.affectationId));
}

export type KeystoneSupplier = { id: string; name: string; x3Code: string | null; internal: boolean };

/** Fournisseurs de Keystone, par nom (ateliers internes compris : `internal`). */
export function readSuppliers(db: DbOrTx): Promise<SourceRead<KeystoneSupplier>> {
  return readSource(db, 'suppliers', () => db.select({
    id: pubFournisseurs.id, name: pubFournisseurs.name, x3Code: pubFournisseurs.x3Code, internal: pubFournisseurs.isInternal,
  }).from(pubFournisseurs).orderBy(asc(pubFournisseurs.name)));
}

/** Fournisseurs de Keystone de la requête. */
export const loadSuppliers = cache(async () => readSuppliers(await getDb()));

/**
 * Contrôle d'un code projet saisi (D02, pas de clé étrangère entre schémas) : vide ou inchangé (`current`, valeur déjà
 * enregistrée) admis ; sinon présent dans keystone.pub_projets. Source indisponible : saisie refusée avec un message.
 * Renvoie le message d'erreur du champ, ou null.
 */
export async function unknownProjectError(db: DbOrTx, code: string | null | undefined, current?: string | null): Promise<string | null> {
  if (!code || code === current) return null;
  const read = await readProjects(db);
  if (!read.ok) return unavailableMessage('projects');
  return read.rows.some((p) => p.code === code) ? null : 'Projet Keystone inconnu.';
}

/**
 * Contrôle d'un fournisseur choisi (D16) : vide ou inchangé admis ; sinon fournisseur de keystone.pub_fournisseurs qui
 * n'est pas un atelier interne. Renvoie le message d'erreur du champ, ou null.
 */
export async function supplierError(db: DbOrTx, id: string | null | undefined, current?: string | null): Promise<string | null> {
  if (!id || id === current) return null;
  const read = await readSuppliers(db);
  if (!read.ok) return unavailableMessage('suppliers');
  const s = read.rows.find((x) => x.id === id);
  return !s ? 'Fournisseur Keystone inconnu.' : s.internal ? 'Atelier interne : pas une entreprise extérieure.' : null;
}
