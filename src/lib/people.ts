import * as t from '@/db/schema';

// Fiche personne telle que l'application la charge : sans les données de connexion (objectId Entra, dernière connexion),
// qui ne servent qu'à l'authentification et ne doivent pas partir dans les pages.

export type Person = Omit<typeof t.people.$inferSelect, 'entraObjectId' | 'lastLoginAt'>;

/** Colonnes de `Person` pour `db.select(PERSON_COLUMNS).from(t.people)`. */
export const PERSON_COLUMNS = {
  id: t.people.id,
  name: t.people.name,
  job: t.people.job,
  siteId: t.people.siteId,
  inSkillsMatrix: t.people.inSkillsMatrix,
  sort: t.people.sort,
  service: t.people.service,
  leftOn: t.people.leftOn,
  leftReason: t.people.leftReason,
  email: t.people.email,
  matricule: t.people.matricule,
  lastRole: t.people.lastRole,
  cursusState: t.people.cursusState,
  category: t.people.category,
  company: t.people.company,
  cursusEmail: t.people.cursusEmail,
  siteMatricule: t.people.siteMatricule,
  replacedById: t.people.replacedById,
} satisfies Record<keyof Person, unknown>;

/** Sorti de l'effectif à la date `now` (archivé : hors matrice, signaux et listes de choix). */
export const hasLeft = (p: Pick<Person, 'leftOn'>, now: string) => !!p.leftOn && p.leftOn <= now;

/** Fiche « à rattacher » : sans matricule Cursus (saisie avant D01 ou créée à la connexion Entra), ni remplacée, ni sortie. */
export const toAttach = (p: Pick<Person, 'matricule' | 'replacedById' | 'leftOn'>, now: string) => !p.matricule && !p.replacedById && !hasLeft(p, now);
