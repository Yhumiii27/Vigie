import { inArray } from 'drizzle-orm';
import { DEMO_QHSE_LEAD, DEMO_ROLE_PEOPLE } from '../../lib/demo';
import type { Role } from '../../lib/domain';
import * as t from '../schema';
import { iso, rel } from './dates';
import { DEMO_MATRICULES } from './foreign';
import type { SeedTx } from './types';

// Jeu de démonstration : sites, personnes (matricules : jointure des affectations de Keystone, D04) et heures travaillées (QUA-26 : extrait de src/db/seed.ts).
// Les noms entre crochets sont des placeholders à remplacer par l'import du personnel.

// Site B = zone d'essais ; tous les autres salariés sont rattachés au site A.
export const SITE_B_PEOPLE = new Set(['amartin', 'jpetit']);
export const SITE_B_LOCATION = /zone d'essais|banc d'essais/i;

export const PEOPLE: [id: string, name: string, job: string, matrix: boolean, service: string][] = [
  ['tnguyen', '[T. Nguyen]', 'Monteur · atelier montage', true, 'Atelier montage'],
  ['mgirard', '[M. Girard]', 'Usineur · atelier usinage', true, 'Atelier usinage'],
  ['proux', '[P. Roux]', 'Usineur · atelier usinage', true, 'Atelier usinage'],
  ['amartin', '[A. Martin]', "Technicien · zone d'essais", true, "Zone d'essais"],
  ['jpetit', '[J. Petit]', 'Chef de zone · essais', true, "Zone d'essais"],
  ['rfontaine', '[R. Fontaine]', 'Magasinier', true, 'Magasin'],
  ['edubois', '[E. Dubois]', "Ingénieur · bureau d'études", true, "Bureau d'études"],
  ['lmoreau', '[L. Moreau]', 'Responsable qualité', true, 'Qualité'],
  ['sbenali', '[S. Benali]', "Chef d'atelier montage", true, 'Atelier montage'],
  ['kbernard', '[K. Bernard]', 'Monteur · arrivé le 28/09', true, 'Atelier montage'],
  ['clefevre', '[C. Lefèvre]', 'Animatrice QHSE', false, 'QHSE'],
  ['hmarchand', '[H. Marchand]', 'Direction', false, 'Direction'],
  // Sorti de l'effectif (archivé) : filtre « Sortis » de la matrice, nom conservé dans l'historique.
  ['ylambert', '[Y. Lambert]', 'Usineur · atelier usinage', true, 'Atelier usinage'],
];
/**
 * Fiche ancienne sans matricule (créée à la première connexion Entra avant D01) : « à rattacher » par le QHSE. Cursus publie
 * la même personne sous `cursusMatricule` ; le rafraîchissement en crée une fiche, que le rattachement remplace (D01).
 */
export const LEGACY_PEOPLE = [
  { id: 'nlegrand', name: '[N. Legrand]', job: 'Technicienne méthodes', siteId: 'site_a', email: 'n.legrand@epc2i.example', cursusMatricule: 'EMP-9014' },
];
export const LEFT: Record<string, { leftOn: string; leftReason: string }> = { ylambert: { leftOn: rel(-9), leftReason: 'Fin de contrat' } };
export const pid = (name: string) => {
  const p = PEOPLE.find((x) => x[1] === name);
  if (!p) throw new Error(`Personne inconnue : ${name}`);
  return p[0];
};


/** SIRET fictifs des sites de démonstration (clé de Luhn valide, jamais un SIRET réel). */
export const DEMO_SIRET: Record<string, string> = { 'site_a': '00000000000018', 'site_b': '00000000000026' };

/** Dernier rôle connu des personnes de démonstration (destinataires par rôle : animateurs QHSE, direction). */
export const DEMO_LAST_ROLES = new Map(Object.entries(DEMO_ROLE_PEOPLE).map(([role, id]) => [id, role as Role]));

/** E-mail de démonstration (domaine réservé .example) : « [C. Lefèvre] » → c.lefevre@epc2i.example. */
export const demoEmail = (name: string) =>
  `${name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')}@epc2i.example`;

/**
 * Sites (deux actifs, un archivé ; identifiants = codes de matrix.pub_sites, décision CV-09, substitut src/db/seeds/foreign.ts),
 * personnes, responsable QHSE des sites, heures travaillées sur 12 mois. Projets et affectations : vues de Keystone (D02, D04).
 */
export async function seedCore(tx: SeedTx) {
  await tx.insert(t.sites).values([
    // Établissement Seveso seuil haut : plan de prévention écrit dès la première minute d'intervention.
    // SIRET fictifs (clé de Luhn valide) : registre des déchets (DOC-02).
    { id: 'site_a', label: 'Site de [Ville A] — siège et ateliers', seveso: 'seuil_haut', ppFromFirstMinute: true, sort: 1, siret: DEMO_SIRET['site_a'] },
    { id: 'site_b', label: "Site de [Ville B] — zone d'essais", seveso: 'seuil_haut', ppFromFirstMinute: true, sort: 2, siret: DEMO_SIRET['site_b'] },
  ]);
  await tx.insert(t.people).values(PEOPLE.map(([id, name, job, inSkillsMatrix, service], sort) => ({
    id, name, job, inSkillsMatrix, service, sort, siteId: SITE_B_PEOPLE.has(id) ? 'site_b' : 'site_a', ...LEFT[id],
    email: demoEmail(name), lastRole: DEMO_LAST_ROLES.get(id) ?? null, matricule: DEMO_MATRICULES[id] ?? null,
  })));
  await tx.insert(t.people).values(LEGACY_PEOPLE.map((p, i) => ({
    id: p.id, name: p.name, job: p.job, siteId: p.siteId, email: p.email, sort: PEOPLE.length + i, lastRole: 'Salarié' as Role,
  })));
  // Responsable QHSE des deux sites actifs : l'animatrice QHSE de démonstration.
  await tx.update(t.sites).set({ qhseLeadId: DEMO_QHSE_LEAD }).where(inArray(t.sites.id, ['site_a', 'site_b']));
  // Site archivé (fermé) : absent des sélecteurs, sans autre donnée rattachée.
  await tx.insert(t.sites).values({
    id: 'site_c', label: 'Site de [Ville C] — ancien dépôt logistique', seveso: null, ppFromFirstMinute: false, sort: 3,
    archivedAt: new Date(`${rel(-192)}T16:00:00Z`), archivedById: 'hmarchand', archiveReason: 'Dépôt fermé fin mars 2026 : activité regroupée sur le site de [Ville A].',
  });

  // Heures travaillées sur 12 mois (≈ 200 ETP, dont ~10 % sur le site B) — à remplacer par la source RH.
  await tx.insert(t.hoursWorked).values(Array.from({ length: 12 }, (_, i) => {
    const m = ((8 + i) % 12) + 1, y = m >= 10 ? 2025 : 2026;
    const total = m === 8 ? 19_600 : 27_800, b = Math.round(total * 0.1);
    return [{ month: iso(y, m, 1), siteId: 'site_a', hours: total - b }, { month: iso(y, m, 1), siteId: 'site_b', hours: b }];
  }).flat());
}
