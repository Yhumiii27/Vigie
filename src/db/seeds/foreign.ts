import type { ForeignSourceKey } from '../foreign';
import { rel } from './dates';

// Contenu des substituts des vues des autres outils (lot 0 de M-02, src/db/foreign-substitutes.ts) : vues de même forme
// que les publications de Matrix et de Keystone, créées seulement en PGlite ou en démonstration, quand le schéma de l'outil
// est absent (jamais sur le serveur commun). Identifiants de démonstration : ici et dans les autres seeds seulement.
// Colonnes = noms du contrat (src/db/foreign.ts, FOREIGN_CONTRACTS) ; une colonne absente d'une ligne vaut NULL.

type Row = Record<string, string | number | boolean | null>;

/**
 * Sites de matrix.pub_sites : les trois sites de démonstration de Vigie (site_c fermé dans Matrix, archivé dans Vigie) et
 * un site encore non suivi par Vigie (choix proposé par « Gérer les sites »).
 */
export const DEMO_MATRIX_SITES: Row[] = [
  { code: 'site_a', libelle: 'Site de [Ville A] — siège et ateliers', ville: '[Ville A]', pays_iso2: 'FR', ordre: 1, actif: true },
  { code: 'site_b', libelle: "Site de [Ville B] — zone d'essais", ville: '[Ville B]', pays_iso2: 'FR', ordre: 2, actif: true },
  { code: 'site_c', libelle: 'Site de [Ville C] — ancien dépôt logistique', ville: '[Ville C]', pays_iso2: 'FR', ordre: 3, actif: false },
  { code: 'site_d', libelle: 'Site de [Ville D] — atelier de maintenance', ville: '[Ville D]', pays_iso2: 'FR', ordre: 4, actif: true },
];

/** Clients de démonstration de Keystone (identifiant fixe, nom entre crochets). */
const CLIENTS: Record<string, string> = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c, i) => [`[Client ${c}]`, `c1e00000-0000-4000-8000-00000000000${i + 1}`]));

/**
 * Projets de keystone.pub_projets repris par les événements, plans de prévention, permis, activités et études du jeu
 * (codes de l'ancien référentiel keystone_projects, gardés : Keystone n'impose pas de format à pub_projets.code).
 */
export const DEMO_PROJECTS: [code: string, client: string, nom: string, phase: string][] = [
  ['K-2024-097', '[Client C]', 'Presse à cartoucher PC-400', 'garantie'],
  ['K-2024-118', '[Client B]', "Ligne de convoyage et banc d'essais", 'mise_en_service'],
  ['K-2025-042', '[Client A]', 'Malaxeur et poste de retournement', 'mise_en_service'],
  ['K-2025-061', '[Client E]', 'Cellule de remplissage automatisée', 'fabrication'],
  ['K-2025-077', '[Client A]', 'Malaxeur MX-2 — seconde ligne', 'fabrication'],
  ['K-2026-003', '[Client F]', 'Presse hydraulique 400 t', 'etudes'],
  ['K-2026-007', '[Client D]', 'Machine spéciale de sertissage', 'etudes'],
  ['K-2026-012', '[Client B]', 'Convoyeur à rouleaux CV-20', 'etudes'],
  ['K-2026-019', '[Client G]', 'Banc de test hydraulique', 'etudes'],
  ['K-2026-024', '[Client C]', 'Rétrofit presse PC-400', 'etudes'],
];
const PHASES: Record<string, string> = { etudes: 'Études', fabrication: 'Fabrication', mise_en_service: 'Mise en service', garantie: 'Garantie' };

/** Matricules de démonstration (people.matricule) : clé de jointure des affectations de Keystone (D04) et de Cursus (D01). */
export const DEMO_MATRICULES: Record<string, string> = {
  tnguyen: 'EMP-9001', mgirard: 'EMP-9002', proux: 'EMP-9003', amartin: 'EMP-9004', jpetit: 'EMP-9005', rfontaine: 'EMP-9006',
  edubois: 'EMP-9007', lmoreau: 'EMP-9008', sbenali: 'EMP-9009', kbernard: 'EMP-9010', clefevre: 'EMP-9011', hmarchand: 'EMP-9012',
  ylambert: 'EMP-9013',
};

/** Fournisseurs de keystone.pub_fournisseurs : entreprises extérieures du jeu, plus un atelier interne (exclu des choix). */
export const DEMO_SUPPLIERS: Row[] = [
  { id: '5f000000-0000-4000-8000-000000000001', name: '[Entreprise Levage Ouest]', x3_code: 'F-LEV01', is_internal: false },
  { id: '5f000000-0000-4000-8000-000000000002', name: '[Entreprise Élec Industrie]', x3_code: 'F-ELE02', is_internal: false },
  { id: '5f000000-0000-4000-8000-000000000003', name: '[Entreprise Contrôle ATEX]', x3_code: 'F-ATX03', is_internal: false },
  { id: '5f000000-0000-4000-8000-000000000004', name: '[Fournisseur Hydraulique Nord]', x3_code: 'F-HYD04', is_internal: false },
  { id: '5f000000-0000-4000-8000-000000000009', name: '[Atelier interne de chaudronnerie]', x3_code: null, is_internal: true },
];

/** Fournisseur Keystone rattaché d'office à une entreprise extérieure du jeu (contractors.supplier_id). */
export const DEMO_CONTRACTOR_SUPPLIERS: Record<string, string> = { 'EE-001': '5f000000-0000-4000-8000-000000000001' };

/** Lignes de chaque substitut (même forme que la vue publiée). */
export function demoForeignRows(): Record<ForeignSourceKey, Row[]> {
  return {
    sites: DEMO_MATRIX_SITES,
    projects: DEMO_PROJECTS.map(([code, client, nom, phase]) => ({
      code, numero: null, code_analytique: null, nature: 'client', nom, client_id: CLIENTS[client], client, client_code3: null,
      phase_code: phase, phase: PHASES[phase], imputable: true, chef_projet_matricule: 'EMP-9007', chef_projet_nom: '[E. Dubois]',
      ville: null, pays: 'France', fournisseurs: null, maj_le: `${rel(-1)}T08:00:00Z`, capex_code: null, besoin_ref: null,
      client_interne: false, filiale_code: null, categorie: 'client',
    })),
    // Affectation du planning de [T. Nguyen] (alerte d'habilitation de la matrice) et une rotation ancienne de plus d'un an
    // (filtrée par le rafraîchissement).
    assignments: [
      {
        source: 'planning', affectation_id: 'af000000-0000-4000-8000-000000000001', matricule: DEMO_MATRICULES.tnguyen, personne_nom: '[T. Nguyen]',
        projet_code: 'K-2025-042', projet_nom: 'Malaxeur et poste de retournement', client: '[Client A]', activite_code: 'MES', activite: 'Mise en service',
        du: rel(4), au: rel(8), lieu: null, pays: 'France', pays_iso2: 'FR', heures_prevues: 32,
      },
      {
        source: 'rotation', affectation_id: 'af000000-0000-4000-8000-000000000002', matricule: DEMO_MATRICULES.mgirard, personne_nom: '[M. Girard]',
        projet_code: 'K-2024-097', projet_nom: 'Presse à cartoucher PC-400', client: '[Client C]', activite_code: null, activite: 'Montage sur site',
        du: rel(-420), au: rel(-400), lieu: '[Site client C]', pays: 'France', pays_iso2: 'FR', heures_prevues: null,
      },
    ],
    suppliers: DEMO_SUPPLIERS,
  };
}
