// Personnes lues dans Cursus (D01 de Matrix, décision CV-10 du 03/11/2026) : règles pures du rafraîchissement du cache
// people (src/server/foreign-sync.ts) et du rattachement d'une fiche ancienne (src/server/people.ts). Sans import serveur.
// Une fiche qui porte un matricule reprend de cursus.pub_salaries nom, poste, site (site suivi de même code, sinon aucun),
// sortie et, contrat D01 v2, catégorie, entreprise et e-mail ; une personne absente de la vue n'est jamais supprimée (état
// « absent », signal au QHSE). L'e-mail n'apparaît jamais en clair au journal (donnée personnelle, publiée par pub_journal
// pour le seul intitulé : l'intitulé n'en porte jamais).

import { addDays, fmtDate } from '../dates';
import { CURSUS_PERSON_STATES, PERSON_CATEGORIES, type CursusPersonState, type PersonCategory } from '../foreign/labels';

/** Motif de sortie posé par le rafraîchissement (journal « Sortie enregistrée dans Cursus »). */
export const CURSUS_LEFT_REASON = 'Sortie enregistrée dans Cursus';

/** Une personne sortie depuis plus longtemps n'est pas créée dans Vigie (Cursus publie aussi les anciens salariés). */
export const CURSUS_PEOPLE_HISTORY_DAYS = 365;

/** Personne publiée par Cursus, telle que la lit src/lib/foreign/cursus.ts (`undefined` : colonne non publiée, contrat v1). */
export type CursusPersonRow = {
  matricule: string; name: string; job: string; siteCode: string | null; leftOn: string | null;
  category?: PersonCategory | null; company?: string | null; email?: string | null;
};

/** Champs d'une fiche de Vigie repris de Cursus. */
export type CachedPerson = {
  name: string; job: string; siteId: string | null; leftOn: string | null; leftReason: string | null;
  cursusState: string | null; category: string | null; company: string | null; cursusEmail: string | null;
};

export type PersonPatch = Partial<CachedPerson>;
export type SyncDetail = { field: string; from: string | null; to: string | null };

/** Écritures d'une fiche : champs modifiés et entrées du journal (intitulé publié par pub_journal : jamais de donnée de la personne). */
export type PersonSync = {
  patch: PersonPatch;
  entries: { action: 'sync' | 'archive' | 'restore'; summary: string; reason?: string; details?: SyncDetail[] }[];
};

const masked = (v: string | null | undefined) => (v ? 'adresse publiée' : null);
const categoryLabel = (v: string | null) => (v && v in PERSON_CATEGORIES ? PERSON_CATEGORIES[v as PersonCategory].label : v);
const stateLabel = (v: string | null) => (v ? CURSUS_PERSON_STATES[v as CursusPersonState]?.label ?? v : null);

/** Site de Vigie d'une personne publiée : le site suivi (non archivé) dont l'identifiant est le code de Cursus, sinon aucun. */
export const followedSite = (siteCode: string | null, followed: ReadonlySet<string>) => (siteCode && followed.has(siteCode) ? siteCode : null);

/** Personne publiée à créer dans Vigie : présente, ou sortie depuis moins d'un an (`today` : date du jour). */
export const shouldCreate = (src: Pick<CursusPersonRow, 'leftOn'>, today: string) => !src.leftOn || src.leftOn >= addDays(today, -CURSUS_PEOPLE_HISTORY_DAYS);

/** Valeurs d'une nouvelle fiche reprise de Cursus. */
export function newCachedPerson(src: CursusPersonRow, followed: ReadonlySet<string>): CachedPerson {
  return {
    name: src.name, job: src.job, siteId: followedSite(src.siteCode, followed), leftOn: src.leftOn, leftReason: src.leftOn ? CURSUS_LEFT_REASON : null,
    cursusState: 'actif', category: src.category ?? null, company: src.company ?? null, cursusEmail: src.email ?? null,
  };
}

/**
 * Écart entre une fiche de Vigie (matricule posé) et sa ligne de cursus.pub_salaries (`src` absent : personne retirée de
 * la vue). `siteLabel` : libellé d'un site pour le journal. Aucune écriture si rien ne change.
 */
export function cursusPersonSync(local: CachedPerson, src: CursusPersonRow | undefined, followed: ReadonlySet<string>, siteLabel: (id: string | null) => string | null): PersonSync {
  if (!src) {
    if (local.cursusState === 'absent') return { patch: {}, entries: [] };
    return {
      patch: { cursusState: 'absent' },
      entries: [{ action: 'sync', summary: 'Personne absente de Cursus (référentiel du personnel)', details: [{ field: 'État dans Cursus', from: stateLabel(local.cursusState), to: stateLabel('absent') }] }],
    };
  }
  const next: CachedPerson = {
    ...local,
    name: src.name, job: src.job, siteId: followedSite(src.siteCode, followed), cursusState: 'actif',
    ...(src.category !== undefined ? { category: src.category } : {}),
    ...(src.company !== undefined ? { company: src.company } : {}),
    ...(src.email !== undefined ? { cursusEmail: src.email } : {}),
  };
  // Sortie : date de Cursus ; motif automatique quand la date change (une date égale garde le motif saisi avant D01).
  if ((src.leftOn ?? null) !== (local.leftOn ?? null)) {
    next.leftOn = src.leftOn;
    next.leftReason = src.leftOn ? CURSUS_LEFT_REASON : null;
  }
  const patch: PersonPatch = {};
  for (const k of Object.keys(next) as (keyof CachedPerson)[]) if ((next[k] ?? null) !== (local[k] ?? null)) (patch as Record<string, unknown>)[k] = next[k];
  if (!Object.keys(patch).length) return { patch, entries: [] };
  const details: SyncDetail[] = [
    ...('name' in patch ? [{ field: 'Nom', from: local.name, to: next.name }] : []),
    ...('job' in patch ? [{ field: 'Poste', from: local.job || null, to: next.job || null }] : []),
    ...('siteId' in patch ? [{ field: 'Site de rattachement', from: siteLabel(local.siteId), to: siteLabel(next.siteId) }] : []),
    // Première lecture (état jamais lu) : catégorie, entreprise et e-mail posés sans entrée au journal.
    ...('category' in patch && local.cursusState ? [{ field: 'Catégorie', from: categoryLabel(local.category), to: categoryLabel(next.category) }] : []),
    ...('company' in patch && local.cursusState ? [{ field: 'Agence ou entreprise', from: local.company, to: next.company }] : []),
    ...('cursusEmail' in patch && local.cursusState ? [{ field: 'E-mail publié par Cursus', from: masked(local.cursusEmail), to: masked(next.cursusEmail) }] : []),
    // Premier état lu « publiée » : sans intérêt pour l'historique.
    ...('cursusState' in patch && local.cursusState ? [{ field: 'État dans Cursus', from: stateLabel(local.cursusState), to: stateLabel('actif') }] : []),
  ];
  const entries: PersonSync['entries'] = [];
  if (details.length) entries.push({ action: 'sync', summary: 'Fiche mise à jour depuis Cursus (référentiel du personnel)', details });
  if ('leftOn' in patch) {
    entries.push(next.leftOn
      ? { action: 'archive', summary: `Sortie enregistrée dans Cursus (le ${fmtDate(next.leftOn)})`, reason: CURSUS_LEFT_REASON }
      : { action: 'restore', summary: 'Sortie annulée dans Cursus', reason: 'Sortie retirée dans Cursus' });
  }
  return { patch, entries };
}

/** Normalisation d'un nom d'entreprise (rapprochement exact, sans accents, casse, crochets ni ponctuation). */
export const companyKey = (name: string | null | undefined) =>
  (name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
