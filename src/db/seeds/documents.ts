import { addDays, addMonths } from '../../lib/dates';
import { rel } from './dates';

// Documents du jeu de démonstration, tenus par Codex depuis le lot 4 de M-02 (décision CV-05 du 05/11/2026, D10) : ils
// remplissent les substituts de codex.pub_documents, pub_revisions_document, pub_validations et pub_types_document
// (src/db/seeds/foreign.ts, src/db/foreign-substitutes.ts), construits d'après les anciens documents maîtrisés de Vigie pour
// que la démonstration garde le même contenu : trois revues périodiques dépassées (PRO-QUA-0002, PRO-HSE-0002, FRM-HSE-0001),
// une revue sous 15 jours (PRO-HSE-0001), deux révisions en circuit de validation, trois brouillons, un document obsolète.
//
// Identifiants de Codex (TYPE-DÉPARTEMENT-SEQ, docs/modele-cible.md § 3 de Codex) ; l'ancien identifiant de Vigie est gardé
// comme alias (pub_documents.aliases), ce qui garde résolubles les liens et références écrits avant la bascule
// (SCREEN_PROCEDURES, références d'origine des actions). Correspondance des types de Vigie (proposée à Codex, § 5.3 de
// docs/specs/convergence-m02.md) : politique → POL, procédure → PRO, instruction → PRO sous-type « Instruction de travail »,
// formulaire → FRM, enregistrement → REC, document d'origine externe → NRM (« Standard client »). Département : QUA ou HSE
// (périmètre QHSE du registre, C-06) ; le processus de Vigie devient process_code.

type Row = Record<string, string | number | boolean | null>;

// [révision, état dans Vigie, objet de la modification, auteur, approbateur, soumise le, approuvée le, action liée]
type V = [letter: string, status: 'brouillon' | 'en_revue' | 'approuve' | 'archive', summary: string, author: string, approver: string | null, submittedOn: string | null, approvedOn: string | null, actionId?: string];
type D = {
  id: string; legacyId: string; title: string; type: string; subtype?: string; department: 'QUA' | 'HSE' | 'ACH'; process: string;
  owner: string; reviewMonths: number; distribution: string; site?: string; conf?: string; origin?: 'interne' | 'externe'; sourceOrg?: string;
  /** Dernière revue sans modification (DOC-15, saisie dans Vigie avant la bascule) : point de départ de la prochaine revue. */
  reviewedOn?: string; obsoleteOn?: string; versions: V[];
};

/** Noms affichés des propriétaires, auteurs et approbateurs (comptes de Codex = identifiants des personnes du jeu). */
const NAMES: Record<string, string> = {
  clefevre: '[C. Lefèvre]', hmarchand: '[H. Marchand]', lmoreau: '[L. Moreau]', edubois: '[E. Dubois]', sbenali: '[S. Benali]',
  jpetit: '[J. Petit]', tnguyen: '[T. Nguyen]', fbertrand: '[F. Bertrand]',
};

export const DEMO_DOCUMENTS: D[] = [
  {
    id: 'POL-QUA-0001', legacyId: 'POL-QHSE-001', title: 'Politique QHSE', type: 'POL', department: 'QUA', process: 'QHSE', owner: 'clefevre', reviewMonths: 12, conf: 'public',
    distribution: "Tout le personnel · affichage accueil, ateliers et zone d'essais",
    versions: [
      ['A', 'archive', 'Création : politique qualité, sécurité et environnement unique', 'clefevre', 'hmarchand', rel(-1369), rel(-1362)],
      ['B', 'archive', 'Revue annuelle : engagements environnement (déchets, consommations)', 'clefevre', 'hmarchand', rel(-641), rel(-634)],
      ['C', 'approuve', 'Revue de direction 2025 : objectifs 2026 et engagement sur la remontée des presque-accidents', 'clefevre', 'hmarchand', rel(-277), rel(-270)],
    ],
  },
  {
    id: 'PRO-QUA-0001', legacyId: 'PR-QHSE-001', title: 'Maîtrise des documents', type: 'PRO', department: 'QUA', process: 'QHSE', owner: 'clefevre', reviewMonths: 36,
    distribution: 'Animatrice QHSE · responsables de processus · encadrement',
    versions: [
      ['A', 'archive', 'Création', 'clefevre', 'hmarchand', rel(-2720), rel(-2713)],
      ['B', 'archive', 'Codification des références par type et processus, périodicité de revue', 'clefevre', 'hmarchand', rel(-1677), rel(-1670)],
      ['C', 'approuve', 'Circuit brouillon, revue, approbation et archivage des versions', 'clefevre', 'hmarchand', rel(-620), rel(-613)],
    ],
  },
  {
    id: 'PRO-QUA-0002', legacyId: 'PR-QHSE-002', title: 'Traitement des non-conformités et réclamations', type: 'PRO', department: 'QUA', process: 'QHSE', owner: 'lmoreau', reviewMonths: 36,
    distribution: "Responsable qualité · chefs d'atelier · bureau d'études · commercial",
    versions: [
      ['A', 'archive', 'Création', 'lmoreau', 'hmarchand', rel(-2230), rel(-2223)],
      ['B', 'approuve', 'Intégration des réclamations client et de la méthode 8D', 'lmoreau', 'hmarchand', rel(-1222), rel(-1215)],
    ],
  },
  {
    id: 'PRO-QUA-0003', legacyId: 'PR-QHSE-003', title: 'Audits internes', type: 'PRO', department: 'QUA', process: 'QHSE', owner: 'edubois', reviewMonths: 36,
    distribution: 'Auditeurs internes · responsables de processus',
    versions: [
      ['A', 'archive', 'Création', 'edubois', 'hmarchand', rel(-2083), rel(-2076)],
      ['B', 'approuve', 'Programme annuel unique QHSE et qualification des auditeurs internes', 'edubois', 'clefevre', rel(-760), rel(-753)],
    ],
  },
  {
    id: 'PRO-HSE-0001', legacyId: 'PR-QHSE-004', title: 'Signalement et analyse des événements', type: 'PRO', department: 'HSE', process: 'QHSE', owner: 'clefevre', reviewMonths: 24,
    distribution: 'Tout le personnel · encadrement de proximité',
    versions: [
      ['A', 'archive', 'Création : déclaration des accidents, presque-accidents et situations dangereuses', 'clefevre', 'hmarchand', rel(-1467), rel(-1460)],
      ['B', 'approuve', 'Signalement terrain par QR code et grille de gravité potentielle G1 à G4', 'clefevre', 'hmarchand', rel(-732), rel(-725)],
      ['C', 'en_revue', "Workflow Vigie en 6 étapes et choix de la méthode d'analyse (5M, arbre des causes, 5 pourquoi, 8D)", 'clefevre', null, rel(-11), null],
    ],
  },
  {
    id: 'PRO-HSE-0002', legacyId: 'PR-QHSE-005', title: 'Plans de prévention et permis', type: 'PRO', department: 'HSE', process: 'QHSE', owner: 'clefevre', reviewMonths: 36,
    distribution: "Encadrement · magasin · zone d'essais · accueil des entreprises extérieures",
    versions: [
      ['A', 'archive', 'Création : plan de prévention et permis de feu', 'clefevre', 'hmarchand', rel(-2419), rel(-2412)],
      ['B', 'approuve', "Ajout du permis d'essai pour la zone d'essais", 'clefevre', 'hmarchand', rel(-1320), rel(-1313)],
    ],
  },
  {
    id: 'PRO-QUA-0004', legacyId: 'PR-ACH-001', title: 'Évaluation des fournisseurs', type: 'PRO', department: 'QUA', process: 'ACH', owner: 'lmoreau', reviewMonths: 36,
    distribution: 'Achats · responsable qualité · magasin (réception)',
    versions: [
      ['A', 'archive', 'Création', 'lmoreau', 'hmarchand', rel(-2937), rel(-2930)],
      ['B', 'archive', 'Grille de cotation qualité, délai, prix', 'lmoreau', 'hmarchand', rel(-1802), rel(-1796)],
      ['C', 'approuve', 'Audit fournisseur déclenché par les non-conformités répétées, seuil de déclassement', 'lmoreau', 'hmarchand', rel(-683), rel(-676)],
    ],
  },
  {
    id: 'PRO-QUA-0005', legacyId: 'PR-BE-001', title: 'Revue de conception (EN ISO 12100)', type: 'PRO', department: 'QUA', process: 'BE', owner: 'edubois', reviewMonths: 36, conf: 'restreint',
    distribution: "Bureau d'études · chefs de projet · responsable qualité",
    versions: [
      ['A', 'archive', 'Création : revues de conception aux jalons du projet', 'edubois', 'hmarchand', rel(-1628), rel(-1621)],
      ['B', 'approuve', 'Appréciation du risque selon EN ISO 12100 à chaque jalon, contenu du dossier technique', 'edubois', 'hmarchand', rel(-557), rel(-550)],
      ['C', 'brouillon', "Exigences du règlement (UE) 2023/1230 sur les machines : analyse d'écart par projet", 'edubois', null, null, null, 'A-196'],
    ],
  },
  {
    id: 'PRO-HSE-0003', legacyId: 'IT-MON-012', title: 'Retournement des bâtis > 1 t', type: 'PRO', subtype: 'Instruction de travail', department: 'HSE', process: 'MON', owner: 'sbenali', reviewMonths: 24, site: 'site_a',
    distribution: 'Atelier montage · poste M3 · pontiers',
    versions: [
      ['A', 'brouillon', "Création suite au presque-accident EV-2026-131 : dotation d'élingage par type de bâti, angle d'élingage, périmètre de basculement", 'tnguyen', null, null, null, 'A-215'],
    ],
  },
  {
    id: 'PRO-QUA-0006', legacyId: 'IT-USI-004', title: "Contrôle de l'arbre Ø45 h7", type: 'PRO', subtype: 'Instruction de travail', department: 'QUA', process: 'USI', owner: 'lmoreau', reviewMonths: 24, site: 'site_a',
    distribution: 'Atelier usinage · centre CU-2 · contrôle final',
    versions: [
      ['A', 'archive', 'Création', 'lmoreau', 'clefevre', rel(-1425), rel(-1418)],
      ['B', 'approuve', 'Contrôle au micromètre à chaque changement de lot', 'lmoreau', 'clefevre', rel(-696), rel(-690)],
      ['C', 'en_revue', "Contrôle intermédiaire tous les 10 arbres et suivi de l'usure outil (NC EV-2026-130)", 'lmoreau', null, rel(-4), null, 'A-212'],
    ],
  },
  {
    id: 'PRO-HSE-0004', legacyId: 'IT-ESS-002', title: "Consignes zone d'essais ATEX", type: 'PRO', subtype: 'Instruction de travail', department: 'HSE', process: 'ESS', owner: 'jpetit', reviewMonths: 24, site: 'site_b',
    distribution: "Zone d'essais · techniciens · entreprises extérieures intervenant en zone",
    versions: [
      ['A', 'archive', 'Création', 'jpetit', 'clefevre', rel(-1585), rel(-1579)],
      ['B', 'approuve', "Zonage ATEX zone 2, matériel certifié, permis d'essai obligatoire", 'jpetit', 'clefevre', rel(-676), rel(-669)],
    ],
  },
  {
    id: 'PRO-QUA-0007', legacyId: 'IT-MON-007', title: 'Montage du réducteur RD-5', type: 'PRO', subtype: 'Instruction de travail', department: 'QUA', process: 'MON', owner: 'sbenali', reviewMonths: 24, site: 'site_a',
    distribution: 'Atelier montage', obsoleteOn: rel(-320),
    versions: [
      ['A', 'archive', 'Création', 'sbenali', 'clefevre', rel(-2783), rel(-2776)],
      ['B', 'archive', 'Remplacement du joint à lèvre par un joint V-ring', 'sbenali', 'clefevre', rel(-1957), rel(-1950)],
    ],
  },
  {
    id: 'FRM-HSE-0001', legacyId: 'FO-QHSE-010', title: 'Fiche de visite sécurité', type: 'FRM', department: 'HSE', process: 'QHSE', owner: 'sbenali', reviewMonths: 36,
    distribution: 'Encadrement · animatrice QHSE',
    versions: [
      ['A', 'archive', 'Création', 'clefevre', 'hmarchand', rel(-2475), rel(-2468)],
      ['B', 'approuve', 'Ajout de la rubrique « situations dangereuses relevées » et du suivi des actions', 'sbenali', 'clefevre', rel(-1121), rel(-1114)],
    ],
  },
  {
    id: 'FRM-QUA-0001', legacyId: 'FO-MON-003', title: 'Fiche de réglage réducteur RD-7', type: 'FRM', department: 'QUA', process: 'MON', owner: 'sbenali', reviewMonths: 36, site: 'site_a',
    distribution: 'Atelier montage · poste de réglage des réducteurs',
    versions: [
      ['A', 'archive', 'Création', 'sbenali', 'clefevre', rel(-1838), rel(-1831)],
      ['B', 'approuve', 'Mise à jour des couples de serrage', 'sbenali', 'clefevre', rel(-949), rel(-942)],
      ['C', 'brouillon', 'Correction du couple de serrage du carter et ajout du contrôle du jeu axial (NC EV-2026-112)', 'lmoreau', null, null, null, 'A-190'],
    ],
  },
  {
    id: 'REC-HSE-0001', legacyId: 'EN-QHSE-001', title: 'Registre des accueils sécurité', type: 'REC', department: 'HSE', process: 'QHSE', owner: 'clefevre', reviewMonths: 36,
    distribution: 'Accueil · encadrement · animatrice QHSE', reviewedOn: rel(-40),
    versions: [
      ['A', 'archive', 'Création', 'clefevre', 'hmarchand', rel(-1866), rel(-1859)],
      ['B', 'approuve', "Accueil des intérimaires et des nouveaux arrivants : signature de l'arrivant et du tuteur", 'clefevre', 'hmarchand', rel(-410), rel(-403)],
    ],
  },
  {
    id: 'NRM-QUA-0001', legacyId: 'EXT-QHSE-001', title: 'Exigences qualité fournisseurs du [Client A]', type: 'NRM', subtype: 'Standard client', department: 'QUA', process: 'QHSE', owner: 'lmoreau', reviewMonths: 12,
    distribution: 'Qualité · bureau d’études · contrôle final', origin: 'externe', sourceOrg: '[Client A]',
    versions: [['A', 'approuve', 'Édition 2026 reçue du client', 'lmoreau', 'clefevre', rel(-205), rel(-200)]],
  },
  // Document confidentiel (lu par le QHSE et la direction seulement, choix par défaut du lot 4).
  {
    id: 'PRO-HSE-0005', legacyId: '', title: 'Gestion de crise et communication externe', type: 'PRO', department: 'HSE', process: 'DIR', owner: 'hmarchand', reviewMonths: 24, conf: 'confidentiel',
    distribution: 'Direction · animatrice QHSE · cellule de crise',
    versions: [['A', 'approuve', 'Création : cellule de crise, astreinte, communication aux autorités et à la presse', 'hmarchand', 'hmarchand', rel(-300), rel(-296)]],
  },
  // Hors du périmètre QHSE du registre (département Achats) : jamais listé, résolu seulement s'il est cité par une fiche.
  {
    id: 'PRO-ACH-0001', legacyId: '', title: 'Passation des commandes d’achat', type: 'PRO', department: 'ACH', process: 'ACH', owner: 'fbertrand', reviewMonths: 36,
    distribution: 'Achats · demandeurs',
    versions: [['A', 'approuve', 'Création', 'fbertrand', 'hmarchand', rel(-500), rel(-495)]],
  },
];

/** Ancien identifiant de Vigie → identifiant de Codex (réécriture de la démonstration, migration 0028). */
export const DEMO_DOCUMENT_IDS: Record<string, string> = Object.fromEntries(DEMO_DOCUMENTS.filter((d) => d.legacyId).map((d) => [d.legacyId, d.id]));

const CODEX_STATUS = { brouillon: 'draft', en_revue: 'in_review', approuve: 'in_force' } as const;

/** Lignes du substitut de codex.pub_documents (`matricules` : people.matricule des personnes du jeu). */
export function demoCodexDocuments(matricules: Record<string, string>): Row[] {
  return DEMO_DOCUMENTS.map((d) => {
    const inForce = d.versions.find((v) => v[1] === 'approuve');
    const working = d.versions.find((v) => v[1] === 'brouillon' || v[1] === 'en_revue');
    const [, , , , , submittedOn, approvedOn] = d.versions[0];
    const created = submittedOn ?? approvedOn ?? rel(-4);
    // Prochaine revue : approbation de la révision en vigueur, ou revue sans modification plus récente, + périodicité.
    const last = inForce?.[6] ? (d.reviewedOn && d.reviewedOn > inForce[6] ? d.reviewedOn : inForce[6]) : null;
    const state = d.obsoleteOn ? 'obsolete' : 'active';
    return {
      id: d.id, aliases: JSON.stringify(d.legacyId ? [d.legacyId] : []), title: d.title, origin: d.origin ?? 'interne', attachment: 'none',
      project_code: null, program_code: null, family: TYPE_ROWS[d.type]?.family ?? null, type_code: d.type, subtype: d.subtype ?? null,
      department: d.department, site: d.site ?? null, owner_id: d.owner, owner_name: NAMES[d.owner] ?? d.owner, author_id: d.versions[0][3],
      author_name: NAMES[d.versions[0][3]] ?? null, conf: d.conf ?? 'interne', keywords: '[]', lang: 'fr', state,
      status: state !== 'active' ? state : inForce ? 'in_force' : working ? CODEX_STATUS[working[1] as 'brouillon' | 'en_revue'] : 'draft',
      rev_in_force: state === 'active' ? inForce?.[0] ?? null : null, rev_working: state === 'active' ? working?.[0] ?? null : null,
      issued_at: inForce?.[6] ?? null, review_due_at: last && state === 'active' ? addMonths(last, d.reviewMonths) : null, expires_at: null,
      discipline: null, project_phase: null, work_package: null, source_org: d.sourceOrg ?? null, external_ref: null, legal_hold: false,
      obsolete_at: d.obsoleteOn ?? null, archived_at: null, created_at: created, modified_at: working?.[5] ?? inForce?.[6] ?? created,
      distribution: d.distribution, review_months: d.reviewMonths, process_code: d.process, owner_matricule: matricules[d.owner] ?? null,
    };
  });
}

/** Lignes du substitut de codex.pub_revisions_document (une ligne par révision, dernière version de travail). */
export function demoCodexRevisions(): Row[] {
  let id = 900;
  return DEMO_DOCUMENTS.flatMap((d) => d.versions.map((v, i) => {
    const [letter, status, summary, author, , submittedOn, approvedOn] = v;
    const next = d.versions[i + 1];
    id += 1;
    const created = submittedOn ?? approvedOn ?? rel(-4);
    const codexStatus = status === 'archive' ? (approvedOn ? 'superseded' : 'cancelled') : status === 'approuve' && d.obsoleteOn ? 'superseded' : CODEX_STATUS[status];
    const hasFile = status !== 'brouillon';
    return {
      revision_id: id, doc_id: d.id, letter, status: codexStatus, created_at: created, effective_at: approvedOn, approved_at: approvedOn, in_force_at: approvedOn,
      superseded_at: codexStatus === 'superseded' ? next?.[6] ?? d.obsoleteOn ?? null : null, modifier_id: author, change_ref: null, working_versions: 1,
      last_version_id: id * 10, last_version_n: 1, last_version_date: created, last_version_author_id: author, last_version_author_name: NAMES[author] ?? author,
      last_version_comment: summary, file_name: hasFile ? `${d.id}_${letter}.1.pdf` : null, mime: hasFile ? 'application/pdf' : null, size: hasFile ? 182_000 + id : null,
    };
  }));
}

/**
 * Lignes du substitut de codex.pub_validations : circuit en cours des révisions soumises (une ligne par étape). Circuit du
 * type PRO de Codex : responsable qualité puis direction ; PRO-HSE-0001 C a passé la première étape.
 */
export function demoCodexValidations(matricules: Record<string, string>): Row[] {
  return DEMO_DOCUMENTS.flatMap((d) => d.versions.filter((v) => v[1] === 'en_revue').flatMap(([letter, , , , , submittedOn]) => {
    const submitted = submittedOn ?? rel(-1);
    const firstDone = d.id === 'PRO-HSE-0001' ? addDays(submitted, 5) : null;
    const steps: [string, string, string, string | null][] = [
      ['resp_qualite', 'Responsable qualité', 'lmoreau', firstDone],
      ['direction', 'Direction', 'hmarchand', null],
    ];
    return steps.map(([fn, label, who, done], idx) => ({
      workflow_id: `WF-${d.id}-${letter}`, doc_id: d.id, revision: letter, requester_id: d.owner, due: addDays(submitted, 14), current_step: firstDone ? 1 : 0,
      outcome: null, created_at: submitted, idx, function_key: fn, step_label: label, assignee_id: who, assignee_name: NAMES[who] ?? who, done_on: done,
      assignee_matricule: matricules[who] ?? null,
    }));
  }));
}

/** Types de Codex du jeu (registre de Codex, src/db/registry.ts, origin/main 8f41630) : lignes de codex.pub_types_document. */
const TYPE_ROWS: Record<string, Row> = {
  POL: {
    code: 'POL', label_fr: 'Politique', label_en: 'Policy', family: 'gouvernance_management', family_label_fr: 'Gouvernance & Management', family_label_en: 'Governance & Management',
    family_group: 'DI', family_sort: 0, origins: '["interne"]', attachments: '["none"]', subtypes: '[{"fr":"Politique groupe","en":"Group policy"}]',
    circuit: '["resp_departement","resp_qualite","direction"]', retention_years: 10, retention_trigger: 'superseded', retention_disposition: 'archive',
    retention_basis: 'Usage gouvernance : version remplacée conservée 10 ans puis versement aux archives historiques (ISO 9001 §5.2, §7.5.3)',
    conf_allowed: '["public","restreint","interne","confidentiel"]', conf_default: 'interne', iso: '5.2 Politique', client_deliverable: false, active: true, source: 'deck', sort: 0,
  },
  PRO: {
    code: 'PRO', label_fr: 'Procédure', label_en: 'Procedure', family: 'gouvernance_management', family_label_fr: 'Gouvernance & Management', family_label_en: 'Governance & Management',
    family_group: 'DI', family_sort: 0, origins: '["interne"]', attachments: '["none","project","capex"]',
    subtypes: '[{"fr":"Procédure standard","en":"Standard procedure"},{"fr":"SOP","en":"SOP"},{"fr":"Instruction de travail","en":"Work instruction"}]',
    circuit: '["resp_qualite","direction"]', retention_years: 3, retention_trigger: 'superseded', retention_disposition: 'review',
    retention_basis: "Valeur Keystone : remplacé + 3 ans (cycle de certification ISO 9001, §7.5.3 durée fixée par l'organisme)",
    conf_allowed: '["restreint","interne","confidentiel"]', conf_default: 'interne', iso: '7.5 Informations documentées', client_deliverable: false, active: true, source: 'both', sort: 1,
  },
  FRM: {
    code: 'FRM', label_fr: 'Formulaire / modèle', label_en: 'Form / template', family: 'gouvernance_management', family_label_fr: 'Gouvernance & Management', family_label_en: 'Governance & Management',
    family_group: 'DI', family_sort: 0, origins: '["interne"]', attachments: '["none"]', subtypes: '[{"fr":"Formulaire","en":"Form"},{"fr":"Modèle de document","en":"Document template"}]',
    circuit: '["resp_qualite"]', retention_years: 3, retention_trigger: 'superseded', retention_disposition: 'destroy',
    retention_basis: 'Valeur Keystone : remplacé + 3 ans (ISO 9001 §7.5.3) ; les formulaires remplis relèvent de REC',
    conf_allowed: '["restreint","interne","confidentiel"]', conf_default: 'interne', iso: '7.5 Informations documentées', client_deliverable: false, active: true, source: 'keystone', sort: 4,
  },
  REC: {
    code: 'REC', label_fr: 'Enregistrement qualité', label_en: 'Quality record', family: 'qualite_qhse', family_label_fr: 'Qualité / QHSE', family_label_en: 'Quality / QHSE',
    family_group: 'DI', family_sort: 1, origins: '["interne"]', attachments: '["none","project","capex"]', subtypes: '[{"fr":"Enregistrement de contrôle","en":"Inspection record"}]',
    circuit: '["resp_qualite"]', retention_years: 10, retention_trigger: 'creation', retention_disposition: 'destroy',
    retention_basis: 'Valeur Keystone : 10 ans (ISO 9001 §7.5.3 ; C. civ. 1245-15 et 1792-4-1)',
    conf_allowed: '["restreint","interne","confidentiel"]', conf_default: 'interne', iso: '7.5.3 Maîtrise des informations documentées', client_deliverable: false, active: true, source: 'both', sort: 7,
  },
  NRM: {
    code: 'NRM', label_fr: 'Norme / Référentiel', label_en: 'Standard / Framework', family: 'reglementaire_normatif', family_label_fr: 'Réglementaire & Normatif', family_label_en: 'Regulatory & Standards',
    family_group: 'DE', family_sort: 4, origins: '["externe"]', attachments: '["none","project","capex"]', subtypes: '[{"fr":"Norme ISO","en":"ISO standard"},{"fr":"Standard client","en":"Client standard"}]',
    circuit: '["resp_qualite"]', retention_years: 10, retention_trigger: 'superseded', retention_disposition: 'destroy',
    retention_basis: 'Usage : preuve de la norme applicable lors de la conception, couvre la décennale (C. civ. 1792-4-1)',
    conf_allowed: '["restreint","interne","confidentiel"]', conf_default: 'interne', iso: null, client_deliverable: false, active: true, source: 'deck', sort: 16,
  },
};

/** Lignes du substitut de codex.pub_types_document. */
export const demoCodexDocTypes = (): Row[] => Object.values(TYPE_ROWS);

/**
 * Révisions de démonstration rattachées à une action (ancienne colonne document_versions.action_id, table
 * document_actions depuis la migration 0028) : [identifiant Codex, révision, action].
 */
export const DEMO_DOCUMENT_ACTIONS: [codexId: string, revision: string, actionId: string][] = DEMO_DOCUMENTS.flatMap((d) =>
  d.versions.filter((v) => v.length > 7 && v[7]).map((v) => [d.id, v[0], v[7]!] as [string, string, string]));
