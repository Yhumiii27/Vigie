import type { ForeignSourceKey } from '../foreign';
import { rel } from './dates';
import { demoCodexDocTypes, demoCodexDocuments, demoCodexRevisions, demoCodexValidations } from './documents';
import { AUDITOR_TITLE, DRIVING_TITLE, MATRIX, PROVIDERS, TITLES, demoHeld } from './skills';
import { LEFT, LEGACY_PEOPLE, PEOPLE, SITE_B_PEOPLE, demoEmail } from './core';

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

/**
 * Articles de keystone.pub_articles cités par les modifications techniques du jeu (D12, lot 5) ; l'arbre de malaxeur
 * ARB-MAL-045 est aussi l'article de la NC EV-2026-130 (demande de Keystone du jeu, D13).
 */
export const DEMO_ARTICLES: Row[] = [
  { ref: 'ARB-MAL-045', name: 'Arbre de malaxeur Ø45 h7', revision: 'B', status: 'validated', part_type: 'manufactured', make_buy: 'make' },
  { ref: 'RED-RD5-010', name: 'Réducteur RD-5', revision: 'C', status: 'validated', part_type: 'purchased', make_buy: 'buy' },
  { ref: 'JNT-MAL-012', name: 'Joint d’étanchéité de cuve', revision: 'A', status: 'validated', part_type: 'purchased', make_buy: 'buy' },
  { ref: 'VER-HYD-300', name: 'Vérin hydraulique 300 t', revision: 'D', status: 'validated', part_type: 'purchased', make_buy: 'buy' },
  { ref: 'CAP-PRS-400', name: 'Capot de presse PC-400', revision: 'A', status: 'obsolete', part_type: 'manufactured', make_buy: 'make' },
];

/** Cas d'emploi de keystone.pub_nomenclatures : articles des projets du jeu (effectivité proposée d'un ordre). */
export const DEMO_BOM: Row[] = [
  { project_code: 'K-2025-042', stage: 'commissioning', part_ref: 'ARB-MAL-045', quantity: 2 },
  { project_code: 'K-2025-042', stage: 'commissioning', part_ref: 'RED-RD5-010', quantity: 1 },
  { project_code: 'K-2025-042', stage: 'commissioning', part_ref: 'JNT-MAL-012', quantity: 4 },
  { project_code: 'K-2025-077', stage: 'manufacturing', part_ref: 'ARB-MAL-045', quantity: 2 },
  { project_code: 'K-2025-077', stage: 'manufacturing', part_ref: 'RED-RD5-010', quantity: 1 },
  { project_code: 'K-2024-097', stage: 'warranty', part_ref: 'VER-HYD-300', quantity: 4 },
  { project_code: 'K-2026-003', stage: 'design', part_ref: 'VER-HYD-300', quantity: 2 },
];

/** Parc installé de keystone.pub_parc_machines : une ligne par machine et article monté (révision montée). */
export function demoFleet(): Row[] {
  const m = (number: string, name: string, client: string, site: string, project: string | null, type: string, delivered: number, parts: [string, string][]): Row[] =>
    (parts.length ? parts : [[null, null] as unknown as [string, string]]).map(([part, rev]) => ({
      number, name, client_name: client, site_text: site, project_code: project, warranty_status: delivered > -730 ? 'in_warranty' : 'expired',
      part_ref: part, fitted_revision: rev, type_machine_code: type, livree_le: rel(delivered), maj_le: `${rel(-3)}T07:30:00Z`,
    }));
  return [
    ...m('MCH-031', 'Malaxeur MX-1', '[Client A]', '[Ville du client A] · atelier 2', 'K-2025-042', 'MAL', -40, [['ARB-MAL-045', 'A'], ['RED-RD5-010', 'B']]),
    ...m('MCH-035', 'Malaxeur MX-1 (seconde machine)', '[Client B]', '[Ville du client B] · hall 1', null, 'MAL', -400, [['ARB-MAL-045', 'A']]),
    ...m('MCH-022', 'Presse à cartoucher PC-400', '[Client C]', '[Ville du client C]', 'K-2024-097', 'PRS', -900, [['VER-HYD-300', 'C'], ['CAP-PRS-400', 'A']]),
  ];
}

/** Fournisseur Keystone rattaché d'office à une entreprise extérieure du jeu (contractors.supplier_id). */
export const DEMO_CONTRACTOR_SUPPLIERS: Record<string, string> = { 'EE-001': '5f000000-0000-4000-8000-000000000001' };

/**
 * Catalogue de cursus.pub_titres (D08) : les titres suivis du jeu (identifiant = titre_id, libellé court = intitulé de Vigie),
 * le titre qui n'est plus suivi, le titre d'auditeur interne et trois titres non suivis (choix de « Suivre un titre »).
 * validite_mois NULL = sans échéance.
 */
export function demoCursusTitles(): Row[] {
  const row = (id: string, libelle: string, court: string, months: number | null): Row => {
    const [nature, ...code] = id.split('.');
    return { titre_id: id, nature, code: code.join('.'), libelle, libelle_court: court, validite_mois: months };
  };
  return [
    ...TITLES.map(([id, label, months]) => row(id, label, label, months || null)),
    row('formation.pontier', 'Pontier (ancien référentiel)', 'Pontier (ancien référentiel)', 60),
    row(AUDITOR_TITLE, 'Auditeur interne (ISO 19011)', 'Auditeur interne (ISO 19011)', null),
    row('formation.elec', "Préparation à l'habilitation électrique", 'Préparation habilitation électrique', 36),
    row('formation.aipr', 'Autorisation d’intervention à proximité des réseaux', 'AIPR', 60),
    row('habilitation.ac484', 'Autorisation de conduite R484', 'Autorisation de conduite R484', 60),
  ];
}

/**
 * Titres détenus de cursus.pub_titres_detenus (D09), construits d'après la matrice du jeu (src/db/seeds/skills.ts) pour
 * garder les mêmes états : valides, à renouveler (SST de [T. Nguyen], habilitation électrique de [M. Girard]), expiré
 * (travail en hauteur de [T. Nguyen]), suspendu faute de prérequis (autorisation de conduite de [K. Bernard], délivrée
 * sans CACES valide), jamais suivi (cases « r ») ; plus le titre d'auditeur interne de [L. Moreau] (AUD-27). Une ligne par
 * salarié et titre (dernière formation, habilitation délivrée), comme la vue de Cursus. Formation : organisme ;
 * habilitation : signataire (delivre_par). Prérequis et mesures : calculés par Cursus, posés ici à la main.
 */
export function demoHeldTitles(): Row[] {
  let n = 0;
  const row = (personId: string, titleId: string, obtainedOn: string, expiresOn: string | null, provider: string | null, missing = false): Row => {
    const habilitation = titleId.startsWith('habilitation.');
    n += 1;
    return {
      cursus_ref: `${habilitation ? 'hab_titre' : 'certification'}.${9000 + n}`, matricule: DEMO_MATRICULES[personId], titre_id: titleId,
      nature: habilitation ? 'habilitation' : 'formation', code: titleId.split('.').slice(1).join('.'), obtenu_le: obtainedOn, expire_le: expiresOn,
      // Prérequis manquant : jamais utilisable (veille de la délivrance), comme la vue de Cursus.
      utilisable_jusqu_au: missing ? rel(-9) : expiresOn, prerequis_manquant: missing,
      organisme: habilitation ? null : provider, delivre_par: habilitation ? provider : null, session_prevue_le: null, mesure: null, mesure_le: null,
    };
  };
  const rows: Row[] = [];
  MATRIX.forEach(([personId, codes], pi) => {
    [...codes].forEach((code, ti) => {
      if (code === 'n' || code === 'r') return;
      const titleId = TITLES[ti][0];
      const { obtainedOn, expiresOn } = demoHeld(pi, ti, personId);
      rows.push(row(personId, titleId, obtainedOn, expiresOn, PROVIDERS[titleId] ?? null));
    });
  });
  rows.push(row('kbernard', DRIVING_TITLE, rel(-8), rel(1818), 'Formation interne', true));
  rows.push(row('lmoreau', AUDITOR_TITLE, rel(-900), null, '[Organisme de formation]'));
  return rows;
}

/**
 * Intérimaires (matricule « I… ») et salariés d'entreprises extérieures (« E… ») publiés par Cursus (décision CV-10) :
 * matricule, nom, poste, site, catégorie, agence ou entreprise. Repris par le rafraîchissement (cache people).
 */
export const DEMO_VISITORS: [matricule: string, name: string, job: string, site: string, category: 'interimaire' | 'exterieur', company: string][] = [
  ['I-9101', '[D. Garnier]', 'Cariste intérimaire', 'site_a', 'interimaire', '[Agence Intérim Ouest]'],
  ['I-9102', '[C. Barbier]', 'Opérateur intérimaire', 'site_b', 'interimaire', '[Agence Intérim Ouest]'],
  ['E-9201', '[F. Rousseau]', 'Technicien levage', 'site_a', 'exterieur', '[Entreprise Levage Ouest]'],
  ['E-9202', '[B. Morel]', 'Soudeur', 'site_a', 'exterieur', '[Entreprise Chaudronnerie Soudure]'],
  ['E-9203', '[L. Fabre]', 'Électricien', 'site_a', 'exterieur', '[Entreprise Élec Industrie]'],
  ['E-9204', '[P. Henry]', 'Technicien incendie', 'site_a', 'exterieur', '[Entreprise Sécurité Incendie]'],
];

/**
 * Personnes de cursus.pub_salaries (D01, contrat v2) : les salariés du jeu (matricules EMP-9…, sortie de [Y. Lambert]),
 * les intérimaires et extérieurs, et le salarié dont Vigie garde une fiche ancienne sans matricule ([N. Legrand], fiche
 * « à rattacher » : LEGACY_PEOPLE de src/db/seeds/core.ts). Base PGlite hors démonstration : aucune personne (le
 * rafraîchissement créerait sinon des fiches fictives).
 */
export function demoCursusPeople(): Row[] {
  const site = (id: string) => (SITE_B_PEOPLE.has(id) ? 'site_b' : 'site_a');
  return [
    ...PEOPLE.map(([id, name, job]) => ({
      matricule: DEMO_MATRICULES[id], nom: name, poste: job, unite_code: null, site_code: site(id), entree: null, sortie: LEFT[id]?.leftOn ?? null,
      actif: !LEFT[id], categorie: 'salarie', entreprise: null, email: demoEmail(name),
    })),
    ...LEGACY_PEOPLE.map((p) => ({
      matricule: p.cursusMatricule, nom: p.name, poste: p.job, unite_code: null, site_code: p.siteId, entree: rel(-20), sortie: null, actif: true,
      categorie: 'salarie', entreprise: null, email: p.email,
    })),
    ...DEMO_VISITORS.map(([matricule, nom, poste, siteCode, categorie, entreprise]) => ({
      matricule, nom, poste, unite_code: null, site_code: siteCode, entree: null, sortie: null, actif: true, categorie, entreprise, email: null,
    })),
  ];
}

/**
 * Présences prévues de cursus.pub_presences_prevues (PRV-25) : arrivées et départs autour de la date du jeu ; trois
 * recoupent un plan de prévention de la même entreprise sur le même site (PP-2026-015, PP-2026-016, PP-2026-017), une est
 * annulée, une porte un matricule inconnu de Vigie.
 */
export function demoPresences(): Row[] {
  const row = (n: number, matricule: string, site: string, company: string | null, from: number, to: number, objet: string, statut = 'validee'): Row => ({
    declaration_ref: `PRS-2026-${String(n).padStart(4, '0')}`, matricule, site_code: site, entreprise: company, du: rel(from), au: rel(to), objet, statut,
    maj_le: `${rel(-2)}T09:00:00Z`,
  });
  return [
    row(1, 'E-9202', 'site_a', '[Entreprise Chaudronnerie Soudure]', -3, 7, 'Renfort de la mezzanine du magasin'),
    row(2, 'I-9101', 'site_a', '[Agence Intérim Ouest]', 2, 30, 'Renfort de l’atelier montage'),
    row(3, 'E-9204', 'site_a', '[Entreprise Sécurité Incendie]', 4, 4, 'Vérification annuelle des extincteurs et RIA'),
    row(4, 'E-9203', 'site_a', '[Entreprise Élec Industrie]', 10, 14, 'Travaux sur le TGBT et le poste d’essais'),
    row(5, 'E-9201', 'site_a', '[Entreprise Levage Ouest]', 17, 19, 'Maintenance du pont roulant 5 t'),
    row(6, 'I-9102', 'site_b', '[Agence Intérim Ouest]', 1, 5, 'Renfort de la zone d’essais', 'annulee'),
    row(7, 'E-9299', 'site_b', '[Fournisseur Hydraulique Nord]', 3, 3, 'Livraison et mise en place d’un vérin'),
  ];
}

/** Lignes de chaque substitut (même forme que la vue publiée). */
export function demoForeignRows({ demo = true }: { demo?: boolean } = {}): Record<ForeignSourceKey, Row[]> {
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
    articles: DEMO_ARTICLES,
    bom: DEMO_BOM,
    fleet: demoFleet(),
    titles: demoCursusTitles(),
    heldTitles: demoHeldTitles(),
    // D01 et PRV-25 (décision CV-10) : personnes et présences prévues, en démonstration seulement.
    people: demo ? demoCursusPeople() : [],
    presences: demo ? demoPresences() : [],
    // D10 (lot 4) : documents de Codex construits d'après les anciens documents maîtrisés du jeu (src/db/seeds/documents.ts).
    documents: demoCodexDocuments(DEMO_MATRICULES),
    revisions: demoCodexRevisions(),
    validations: demoCodexValidations(DEMO_MATRICULES),
    docTypes: demoCodexDocTypes(),
  };
}
