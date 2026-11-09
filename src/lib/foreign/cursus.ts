import 'server-only';
import { cache } from 'react';
import { and, asc, gte, lte } from 'drizzle-orm';
import { getDb, type DbOrTx } from '@/db';
import { PRESENCES_OPTIONAL_COLUMNS, SALARIES_OPTIONAL_COLUMNS, pubPresencesPrevues, pubSalaries, pubTitres, pubTitresDetenus } from '@/db/foreign';
import { siteMatriculeOf } from '@/lib/rules/people-sync';
import { readSource, viewColumns, type SourceRead } from './source';

// Lectures de Cursus (lot 2 de M-02, décision CV-01 du 04/11/2026 : Vigie consulte, Cursus fait foi). D08 : catalogue des
// titres (cache training_titles, src/server/foreign-sync.ts ; id = titre_id) ; D09 : titres détenus, lus directement et
// joints par people.matricule et training_titles.id (src/lib/data/held-titles.ts). D01 (décision CV-10 du 03/11/2026) :
// personnes (cache people, src/server/foreign-sync.ts) et présences prévues sur site (poste de garde, PRV-25). Aucune
// écriture chez Cursus.

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

/**
 * Personne publiée par Cursus (salarié, intérimaire ou salarié d'entreprise extérieure, CV-10 ; matricule Cursus « EMP-… »
 * pour tous, matricule de site « I… » / « E… » à part, lot 14 de Cursus). `category`, `company`, `email`, `siteMatricule` :
 * `undefined` quand la vue du serveur ne porte pas encore la colonne (contrat D01 v1, ou v2 sans `matricule_site`) — la
 * valeur de Vigie est alors gardée —, `null` quand elle est publiée vide (ou, pour le matricule de site, hors format).
 */
export type CursusPerson = {
  matricule: string;
  name: string;
  job: string;
  unitCode: string | null;
  siteCode: string | null;
  enteredOn: string | null;
  /** Date de sortie (Cursus) ; null = présent. */
  leftOn: string | null;
  active: boolean;
  category?: 'salarie' | 'interimaire' | 'exterieur' | null;
  company?: string | null;
  email?: string | null;
  siteMatricule?: string | null;
};

const CATEGORY_CODES = new Set(['salarie', 'interimaire', 'exterieur']);

/**
 * Personnes publiées par cursus.pub_salaries (lignes sans matricule ignorées). Colonnes ajoutées en fin de vue (contrat v2 :
 * categorie, entreprise, email ; lot 14 de Cursus : matricule_site) lues seulement si la vue les porte (`viewColumns`, une
 * fois par lecture) : une vue au contrat v1 reste une source disponible.
 */
export function readCursusPeople(db: DbOrTx): Promise<SourceRead<CursusPerson>> {
  return readSource(db, 'people', async () => {
    const present = await viewColumns(db, 'people');
    const has = Object.fromEntries(SALARIES_OPTIONAL_COLUMNS.map((c) => [c, present.has(c)])) as Record<(typeof SALARIES_OPTIONAL_COLUMNS)[number], boolean>;
    const rows = await db.select({
      matricule: pubSalaries.matricule, name: pubSalaries.nom, job: pubSalaries.poste, unitCode: pubSalaries.uniteCode, siteCode: pubSalaries.siteCode,
      enteredOn: pubSalaries.entree, leftOn: pubSalaries.sortie, active: pubSalaries.actif,
      ...(has.categorie ? { category: pubSalaries.categorie } : {}),
      ...(has.entreprise ? { company: pubSalaries.entreprise } : {}),
      ...(has.email ? { email: pubSalaries.email } : {}),
      ...(has.matricule_site ? { siteMatricule: pubSalaries.matriculeSite } : {}),
    }).from(pubSalaries).orderBy(asc(pubSalaries.matricule));
    return rows.flatMap((r) => {
      const x = r as typeof r & { category?: string | null; company?: string | null; email?: string | null; siteMatricule?: string | null };
      if (!x.matricule?.trim()) return [];
      const person: CursusPerson = {
        matricule: x.matricule.trim(), name: x.name?.trim() || x.matricule.trim(), job: x.job?.trim() ?? '', unitCode: x.unitCode, siteCode: x.siteCode,
        enteredOn: x.enteredOn, leftOn: x.leftOn, active: x.active === true,
      };
      if (has.categorie) person.category = x.category && CATEGORY_CODES.has(x.category) ? (x.category as CursusPerson['category']) : null;
      if (has.entreprise) person.company = x.company?.trim() || null;
      if (has.email) person.email = x.email?.trim().toLowerCase() || null;
      if (has.matricule_site) person.siteMatricule = siteMatriculeOf(x.siteMatricule);
      return [person];
    });
  });
}

/**
 * Présence prévue sur un site, déclarée dans Cursus et validée (ou annulée) par les RH (PRV-25). `matricule` : matricule
 * Cursus « EMP-… » ou, variante du lot 14 de Cursus, matricule de site ; `siteMatricule` : colonne `matricule_site` de fin
 * de vue (null si la vue ne la porte pas ou la publie vide).
 */
export type PlannedPresence = {
  ref: string;
  matricule: string | null;
  siteMatricule: string | null;
  siteCode: string | null;
  company: string | null;
  from: string;
  to: string;
  purpose: string | null;
  status: 'validee' | 'annulee';
};

/**
 * Présences prévues qui recoupent la période [from, to] (arrivée ou départ, en jours), statut reconnu seulement. Colonne
 * `matricule_site` lue seulement si la vue la porte.
 */
export function readPlannedPresences(db: DbOrTx, from: string, to: string): Promise<SourceRead<PlannedPresence>> {
  return readSource(db, 'presences', async () => {
    const present = await viewColumns(db, 'presences');
    const has = Object.fromEntries(PRESENCES_OPTIONAL_COLUMNS.map((c) => [c, present.has(c)])) as Record<(typeof PRESENCES_OPTIONAL_COLUMNS)[number], boolean>;
    const rows = await db.select({
      ref: pubPresencesPrevues.declarationRef, matricule: pubPresencesPrevues.matricule, siteCode: pubPresencesPrevues.siteCode,
      company: pubPresencesPrevues.entreprise, from: pubPresencesPrevues.du, to: pubPresencesPrevues.au, purpose: pubPresencesPrevues.objet,
      status: pubPresencesPrevues.statut,
      ...(has.matricule_site ? { siteMatricule: pubPresencesPrevues.matriculeSite } : {}),
    }).from(pubPresencesPrevues).where(and(lte(pubPresencesPrevues.du, to), gte(pubPresencesPrevues.au, from)))
      .orderBy(asc(pubPresencesPrevues.du), asc(pubPresencesPrevues.declarationRef));
    return rows.flatMap((r) => {
      const x = r as typeof r & { siteMatricule?: string | null };
      return x.ref && x.from && x.to && (x.status === 'validee' || x.status === 'annulee')
        ? [{
          ref: x.ref, matricule: x.matricule?.trim() || null, siteMatricule: siteMatriculeOf(x.siteMatricule), siteCode: x.siteCode, company: x.company,
          from: x.from, to: x.to, purpose: x.purpose, status: x.status,
        }] : [];
    });
  });
}
