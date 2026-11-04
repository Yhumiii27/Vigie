import 'server-only';
import { cache } from 'react';
import { asc } from 'drizzle-orm';
import { getDb, type DbOrTx } from '@/db';
import { pubTitres, pubTitresDetenus } from '@/db/foreign';
import { readSource, type SourceRead } from './source';

// Lectures de Cursus (lot 2 de M-02, décision CV-01 du 04/11/2026 : Vigie consulte, Cursus fait foi). D08 : catalogue des
// titres (cache training_titles, src/server/foreign-sync.ts ; id = titre_id) ; D09 : titres détenus, lus directement et
// joints par people.matricule et training_titles.id (src/lib/data/held-titles.ts). Aucune écriture chez Cursus.

export type CursusTitle = {
  id: string; nature: string | null; code: string | null; label: string; shortLabel: string;
  /** Mois de validité ; null = sans échéance. */
  validityMonths: number | null;
};

/** Catalogue des titres de Cursus (formations et habilitations), par identifiant. */
export function readCursusTitles(db: DbOrTx): Promise<SourceRead<CursusTitle>> {
  return readSource(db, 'titles', async () => (await db.select({
    id: pubTitres.titreId, nature: pubTitres.nature, code: pubTitres.code, label: pubTitres.libelle, shortLabel: pubTitres.libelleCourt,
    validityMonths: pubTitres.validiteMois,
  }).from(pubTitres).orderBy(asc(pubTitres.titreId))).flatMap((r) => (r.id ? [{
    ...r, id: r.id, label: r.label ?? r.shortLabel ?? r.id, shortLabel: r.shortLabel ?? r.label ?? r.id,
  }] : [])));
}

/** Catalogue des titres de Cursus de la requête (choix « Suivre un titre »). */
export const loadCursusTitles = cache(async () => readCursusTitles(await getDb()));

/** Titre détenu d'après Cursus (une ligne par salarié et titre : dernière formation suivie, habilitation délivrée). */
export type CursusHeldTitle = {
  ref: string;
  matricule: string;
  titleId: string;
  nature: string | null;
  obtainedOn: string | null;
  /** Échéance du titre (dernier jour de validité) ; null = sans échéance. */
  expiresOn: string | null;
  /** Dernier jour où le titre est utilisable (échéance bornée par les prérequis, une suspension ou un retrait). */
  usableUntil: string | null;
  prerequisiteMissing: boolean;
  /** Organisme de formation (formations) ou signataire de la délivrance (habilitations). */
  provider: string | null;
  issuedBy: string | null;
  /** Prochaine session prévue dans Cursus (recyclage planifié). */
  sessionOn: string | null;
  /** Suspension ou retrait d'une habilitation (motif jamais publié). */
  measure: 'suspension' | 'retrait' | null;
  measureOn: string | null;
};

/** Titres détenus publiés par Cursus (lignes sans matricule ni titre ignorées). */
export function readHeldTitles(db: DbOrTx): Promise<SourceRead<CursusHeldTitle>> {
  return readSource(db, 'heldTitles', async () => (await db.select({
    ref: pubTitresDetenus.cursusRef, matricule: pubTitresDetenus.matricule, titleId: pubTitresDetenus.titreId, nature: pubTitresDetenus.nature,
    obtainedOn: pubTitresDetenus.obtenuLe, expiresOn: pubTitresDetenus.expireLe, usableUntil: pubTitresDetenus.utilisableJusquAu,
    prerequisiteMissing: pubTitresDetenus.prerequisManquant, provider: pubTitresDetenus.organisme, issuedBy: pubTitresDetenus.delivrePar,
    sessionOn: pubTitresDetenus.sessionPrevueLe, measure: pubTitresDetenus.mesure, measureOn: pubTitresDetenus.mesureLe,
  }).from(pubTitresDetenus)).flatMap((r) => (r.matricule && r.titleId ? [{
    ...r, ref: r.ref ?? `${r.matricule}|${r.titleId}`, matricule: r.matricule, titleId: r.titleId, prerequisiteMissing: r.prerequisiteMissing === true,
    measure: r.measure === 'suspension' || r.measure === 'retrait' ? r.measure : null,
  }] : [])));
}
