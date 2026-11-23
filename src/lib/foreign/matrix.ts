import 'server-only';
import { asc } from 'drizzle-orm';
import type { DbOrTx } from '@/db';
import { pubSites } from '@/db/foreign';
import { readSource, type SourceRead } from './source';

// Lectures de Matrix (référentiels communs). D14 : matrix.pub_sites, liste unique des sites de l'entreprise ; un site de
// Vigie a pour identifiant le code d'un de ces sites (décision CV-09).

export type MatrixSite = { code: string; label: string; city: string | null; sort: number; active: boolean; subsidiary: string | null };

/** Sites publiés par Matrix, dans leur ordre d'affichage (fermés compris : actif = false). */
export function readMatrixSites(db: DbOrTx): Promise<SourceRead<MatrixSite>> {
  return readSource(db, 'sites', () => db.select({
    code: pubSites.code, label: pubSites.libelle, city: pubSites.ville, sort: pubSites.ordre, active: pubSites.actif, subsidiary: pubSites.filialeCode,
  }).from(pubSites).orderBy(asc(pubSites.ordre), asc(pubSites.code)));
}

/** Coordonnées des sites publiées par Matrix (PRV-24, carte des sites) : latitude et longitude en texte numérique, ou null. */
export type MatrixSiteCoordinates = { code: string; latitude: string | null; longitude: string | null };

/** Latitude et longitude des sites de matrix.pub_sites (colonnes en fin du contrat D14), lues à l'affichage (non mises en cache). */
export function readMatrixSiteCoordinates(db: DbOrTx): Promise<SourceRead<MatrixSiteCoordinates>> {
  return readSource(db, 'sites', () => db.select({ code: pubSites.code, latitude: pubSites.latitude, longitude: pubSites.longitude }).from(pubSites));
}
