import * as t from '../schema';
import { iso, rel } from './dates';
import type { SeedTx } from './types';

// Jeu de démonstration : titres, matrice des habilitations, formations et affectation Keystone (QUA-26 : extrait de
// src/db/seed.ts).

// [id, libellé, validité (mois, 0 = sans échéance)]
export const TITLES: [string, string, number][] = [
  ['accueil', 'Accueil sécurité', 0], ['elec', 'Habilitation électrique', 36], ['r484', 'CACES R484', 60], ['r489', 'CACES R489', 60],
  ['sst', 'SST', 24], ['hauteur', 'Travail en hauteur', 36], ['atex', 'ATEX', 36], ['conduite', 'Autorisation de conduite', 60],
];

// Matrice : v valide · s expire sous 60 j · x expiré · r requis jamais suivi · n non requis
export const MATRIX: [string, string][] = [
  ['tnguyen', 'vvvnsxnv'], ['mgirard', 'vsnnvnnn'], ['proux', 'vnnvvnnv'], ['amartin', 'vvnnvvvn'], ['jpetit', 'vvnnvvvn'],
  ['rfontaine', 'vnnvvnnv'], ['edubois', 'vnnnvnnn'], ['lmoreau', 'vnnnvnnn'], ['sbenali', 'vvvvvvvv'], ['kbernard', 'rnnnnrnn'],
  ['ylambert', 'vnnvvnnv'],
];
// Échéances explicites des titres expirés ou proches de l'expiration.
export const EXPIRIES: Record<string, string> = { 'tnguyen:hauteur': rel(-11), 'tnguyen:sst': rel(42), 'mgirard:elec': rel(50) };
// Organismes de formation par titre (formations en cours).
export const PROVIDERS: Record<string, string> = { elec: '[Apave]', r484: '[AFPA]', r489: '[AFPA]', sst: 'Formation interne', hauteur: '[Apave]', atex: '[Organisme notifié]', conduite: 'Formation interne' };
// Formations antérieures (historique, jamais écrasé) [salarié, titre, obtention, échéance, organisme].
export const PAST_TRAININGS: [string, string, string, string, string][] = [
  ['tnguyen', 'hauteur', rel(-2202), rel(-1107), '[Apave]'],
  ['sbenali', 'elec', rel(-1459), rel(-363), '[Apave]'],
];

/** Titre de secourisme du jeu de démonstration (training_titles.first_aid). */
export const FIRST_AID_TITLE = 'sst';

/** Titres (dont un archivé), exigences de la matrice, formations (dont une annulée), affectation Keystone. */
export async function seedSkills(tx: SeedTx) {
  // Titre SST : ses titulaires valides donnent les soins du registre des accidents bénins (EVT-04).
  await tx.insert(t.trainingTitles).values(TITLES.map(([id, label, validityMonths], sort) => ({ id, label, validityMonths, sort, firstAid: id === FIRST_AID_TITLE })));
  // Titre retiré du suivi (archivé), sans exigence ni formation.
  await tx.insert(t.trainingTitles).values({
    id: 'pont-ancien', label: 'Pontier (ancien référentiel)', validityMonths: 60, sort: TITLES.length,
    archivedAt: new Date(`${rel(-267)}T10:00:00+01:00`), archivedById: 'clefevre', archiveReason: 'Remplacé par le CACES R484',
  });
  const reqs: { personId: string; titleId: string }[] = [];
  // Formations antérieures d'abord (identifiants plus anciens), puis les formations en cours.
  const quals: (typeof t.qualifications.$inferInsert)[] = PAST_TRAININGS.map(([personId, titleId, obtainedOn, expiresOn, provider]) => ({ personId, titleId, obtainedOn, expiresOn, provider }));
  MATRIX.forEach(([personId, codes], pi) => {
    [...codes].forEach((code, ti) => {
      if (code === 'n') return;
      const [titleId, , validity] = TITLES[ti];
      reqs.push({ personId, titleId });
      if (code === 'r') return;
      const explicit = EXPIRIES[`${personId}:${titleId}`];
      const obtainedOn = iso(2025, ((pi + ti) % 12) + 1, 10 + ti);
      const expiresOn = explicit ?? (validity ? iso(2025 + Math.ceil(validity / 12), ((pi + ti) % 12) + 1, 10 + ti) : null);
      quals.push({ personId, titleId, obtainedOn: explicit ? iso(+explicit.slice(0, 4) - Math.round(validity / 12), +explicit.slice(5, 7), +explicit.slice(8, 10)) : obtainedOn, expiresOn, provider: PROVIDERS[titleId] ?? null });
    });
  });
  // Formation saisie par erreur puis annulée : sans effet sur l'état de la case.
  quals.push({
    personId: 'mgirard', titleId: 'elec', obtainedOn: rel(-8), expiresOn: rel(1088), provider: 'Formation interne', recordedById: 'clefevre',
    cancelledAt: new Date(`${rel(-7)}T09:00:00Z`), cancelledById: 'clefevre', cancelReason: 'Saisie sur le mauvais salarié',
  });
  await tx.insert(t.qualificationRequirements).values(reqs);
  await tx.insert(t.qualifications).values(quals);
  // Recyclages : aucune action QSE (gérés par les RH, réponses du service QHSE du 15/10/2026) — plus de recyclage planifié
  // par une action (ancienne A-207).
  await tx.insert(t.keystoneAssignments).values({ personId: 'tnguyen', project: 'K-2025-042 · [Client A]', activity: 'Mise en service', startOn: rel(4), endOn: rel(8) });
}
