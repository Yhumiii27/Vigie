import * as t from '../schema';
import { iso, rel } from './dates';
import type { SeedTx } from './types';

// Jeu de démonstration : titres suivis et matrice des habilitations (QUA-26 : extrait de src/db/seed.ts). Lot 2 de M-02
// (décision CV-01 du 04/11/2026) : les titres détenus ne sont plus enregistrés dans Vigie ; ils viennent du substitut de
// cursus.pub_titres_detenus (src/db/seeds/foreign.ts, demoHeldTitles), construit d'après les mêmes constantes pour garder
// les mêmes états (valide, à renouveler, expiré, suspendu, jamais suivi). Identifiants des titres = titre_id du catalogue
// de Cursus, d'après le rapprochement proposé par le plan de Matrix (C-01, choix par défaut à confirmer).

// [id = titre_id de Cursus, libellé (libelle_court), validité (mois, 0 = sans échéance)]
export const TITLES: [string, string, number][] = [
  ['formation.accueil', 'Accueil sécurité', 0], ['habilitation.he', 'Habilitation électrique', 36], ['formation.caces484', 'CACES R484', 60],
  ['formation.caces489', 'CACES R489', 60], ['formation.sst', 'SST', 24], ['habilitation.hauteur', 'Travail en hauteur', 36],
  ['habilitation.atex', 'ATEX', 36], ['habilitation.ac489', 'Autorisation de conduite', 60],
];

// Matrice : v valide · s expire sous 90 j · x expiré · r requis jamais suivi · n non requis
export const MATRIX: [string, string][] = [
  ['tnguyen', 'vvvnsxnv'], ['mgirard', 'vsnnvnnn'], ['proux', 'vnnvvnnv'], ['amartin', 'vvnnvvvn'], ['jpetit', 'vvnnvvvn'],
  ['rfontaine', 'vnnvvnnv'], ['edubois', 'vnnnvnnn'], ['lmoreau', 'vnnnvnnn'], ['sbenali', 'vvvvvvvv'], ['kbernard', 'rnnnnrnn'],
  ['ylambert', 'vnnvvnnv'],
];
// Échéances explicites des titres expirés ou proches de l'expiration.
export const EXPIRIES: Record<string, string> = {
  'tnguyen:habilitation.hauteur': rel(-11), 'tnguyen:formation.sst': rel(42), 'mgirard:habilitation.he': rel(50),
};
// Organismes de formation (ou signataires d'une habilitation) par titre.
export const PROVIDERS: Record<string, string> = {
  'habilitation.he': '[Apave]', 'formation.caces484': '[AFPA]', 'formation.caces489': '[AFPA]', 'formation.sst': 'Formation interne',
  'habilitation.hauteur': '[Apave]', 'habilitation.atex': '[Organisme notifié]', 'habilitation.ac489': 'Formation interne',
};

/** Titre de secourisme du jeu de démonstration (training_titles.first_aid). */
export const FIRST_AID_TITLE = 'formation.sst';

/** Autorisation de conduite du jeu (exigée de [K. Bernard], délivrée sans CACES valide : suspendue dans Cursus). */
export const DRIVING_TITLE = 'habilitation.ac489';

/** Titre qui qualifie un auditeur interne (AUD-27, src/db/seeds/paquet13b.ts). */
export const AUDITOR_TITLE = 'formation.auditeur_interne';

/** Titre détenu d'une case de la matrice du jeu (obtention, échéance), d'après les constantes ci-dessus. */
export function demoHeld(personIndex: number, titleIndex: number, personId: string): { obtainedOn: string; expiresOn: string | null } {
  const [titleId, , validity] = TITLES[titleIndex];
  const explicit = EXPIRIES[`${personId}:${titleId}`];
  if (explicit) return { obtainedOn: iso(+explicit.slice(0, 4) - Math.round(validity / 12), +explicit.slice(5, 7), +explicit.slice(8, 10)), expiresOn: explicit };
  const month = ((personIndex + titleIndex) % 12) + 1;
  return { obtainedOn: iso(2025, month, 10 + titleIndex), expiresOn: validity ? iso(2025 + Math.ceil(validity / 12), month, 10 + titleIndex) : null };
}

/** Titres suivis (dont un qui ne l'est plus) et exigences de la matrice. */
export async function seedSkills(tx: SeedTx) {
  // Titre SST : ses titulaires valides donnent les soins du registre des accidents bénins (EVT-04).
  await tx.insert(t.trainingTitles).values(TITLES.map(([id, label, validityMonths], sort) => ({ id, label, validityMonths, sort, firstAid: id === FIRST_AID_TITLE })));
  // Titre qui n'est plus suivi (archivé), sans exigence.
  await tx.insert(t.trainingTitles).values({
    id: 'formation.pontier', label: 'Pontier (ancien référentiel)', validityMonths: 60, sort: TITLES.length,
    archivedAt: new Date(`${rel(-267)}T10:00:00+01:00`), archivedById: 'clefevre', archiveReason: 'Remplacé par le CACES R484',
  });
  const reqs: { personId: string; titleId: string }[] = [];
  MATRIX.forEach(([personId, codes]) => {
    [...codes].forEach((code, ti) => { if (code !== 'n') reqs.push({ personId, titleId: TITLES[ti][0] }); });
  });
  await tx.insert(t.qualificationRequirements).values(reqs);
  // Recyclages : aucune action QSE (gérés par les RH, réponses du service QHSE du 15/10/2026). Affectation de [T. Nguyen]
  // (alerte d'habilitation) : lue dans keystone.pub_affectations (substitut src/db/seeds/foreign.ts, D04).
}
