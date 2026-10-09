// Correspondance entre les champs détectés et Vigie : suggestions, application d'un modèle,
// empreinte et rapprochement des modèles (module pur, utilisable côté serveur et dans l'écran).

import { PP_TARGETS, type PpFormData, type PpImportFormat, type PpImportMapping, type PpTarget } from '../pp-form';
import { cleanLabel, humanize, isNo, isYes, normalize } from './text';
import type { ImportField, MapEntry } from './types';

export const TARGET_LABELS = Object.fromEntries(PP_TARGETS) as Record<PpTarget, string>;
export const TARGET_KEYS = PP_TARGETS.map(([k]) => k) as PpTarget[];
export const isTarget = (v: string): v is PpTarget => (TARGET_KEYS as string[]).includes(v);

/** Section par défaut d'une ligne de grille sans titre de section détecté. */
export const DEFAULT_SECTION = 'Formulaire';

/** Champs de Vigie qui acceptent plusieurs champs du formulaire (textes mis bout à bout). */
const MULTI_TARGETS: PpTarget[] = ['interferenceRisks', 'measures'];

type Kind = ImportField['kind'];
const TEXTUAL: Kind[] = ['text', 'date', 'choice'];

/**
 * Règles de suggestion, de la plus spécifique à la plus générale, testées sur le libellé (et la clé)
 * normalisés, puis sur « section + libellé » pour les libellés génériques (« Nom », « Date »).
 */
const EU = /\b(entreprise utilisatrice|donneur d ordre|eu)\b/;
const RULES: [PpTarget, RegExp, Kind[], RegExp?][] = [
  ['contactEmail', /\b(e ?mail|courriel|mel|adresse electronique)\b/, TEXTUAL, EU],
  ['contactPhone', /\b(telephone|tel|portable|mobile|gsm)\b/, TEXTUAL, EU],
  ['signedEuOn', /\b(signatures?|signe|visas?|vise)\b.*\b(entreprise utilisatrice|eu|donneur d ordre)\b|\b(entreprise utilisatrice|eu)\b.*\b(signatures?|signe|visas?)\b/, ['date', 'text']],
  ['signedEeOn', /\b(signatures?|signe|visas?|vise)\b.*\b(entreprise exterieure|ee|entreprise intervenante|prestataire)\b|\b(entreprise exterieure|ee|prestataire)\b.*\b(signatures?|signe|visas?)\b/, ['date', 'text']],
  ['inspectionOn', /\b(inspection commune|visite commune|visite prealable|inspection prealable|visite d inspection)\b/, ['date', 'text']],
  ['dangerousWork', /\btravaux dangereux\b/, ['checkbox', 'choice', 'text']],
  ['estimatedHours', /\b(nombre d heures|nb d heures|nb heures|heures estimees|volume horaire|duree estimee|heures)\b/, ['text', 'choice']],
  ['startOn', /\b(date de debut|debut des travaux|debut de l intervention|debut|date d intervention|a partir du)\b|^(du|date du)$/, ['date', 'text']],
  ['endOn', /\b(date de fin|fin des travaux|fin de l intervention|fin|jusqu au)\b|^(au|date au)$/, ['date', 'text']],
  ['contractorTrade', /\b(activite|corps de metier|metier|specialite)\b/, TEXTUAL, EU],
  ['contactName', /\b(interlocuteur|chef de chantier|responsable de l entreprise exterieure|responsable ee|responsable chantier|nom du responsable|personne a contacter|contact|representant)\b/, TEXTUAL, EU],
  ['keystoneProject', /\b(projet|affaire|keystone|n d affaire|numero d affaire|commande|n de commande)\b/, TEXTUAL],
  ['contractorName', /\b(raison sociale|nom de l entreprise|entreprise exterieure|entreprise intervenante|societe|prestataire|entreprise)\b/, TEXTUAL, EU],
  ['interferenceRisks', /\brisques? d interference|\brisques? (identifies|specifiques|lies a la coactivite)\b/, ['text']],
  ['measures', /\bmesures (de prevention|prises|a prendre|retenues)\b/, ['text']],
  ['title', /\b(nature des travaux|nature de l intervention|travaux a realiser|objet de l intervention|description des travaux|objet|travaux)\b/, ['text', 'choice']],
  ['location', /\b(lieu|emplacement|localisation|zone d intervention|batiment|secteur)\b/, TEXTUAL, /\b(rassemblement|secours|evacuation)\b/],
];

/** Libellés trop génériques pour être compris sans leur section. */
const GENERIC = /^(nom|nom prenom|date|le|lieu|tel|telephone|valeur|texte|champ|zone de texte|oui|non)( \d+)?$/;

function suggestTarget(text: string, kind: Kind, used: Set<PpTarget>): PpTarget | null {
  for (const [target, re, kinds, exclude] of RULES) {
    if (!kinds.includes(kind)) continue;
    if (used.has(target) && !MULTI_TARGETS.includes(target)) continue;
    if (re.test(text) && !exclude?.test(text)) return target;
  }
  return null;
}

/** Ligne de grille par défaut d'un champ : sa section détectée et son libellé. */
export const gridEntry = (f: ImportField): MapEntry => ({ section: cleanLabel(f.section ?? '') || DEFAULT_SECTION, label: cleanLabel(f.label) || humanize(f.key) });

/**
 * Correspondance proposée sans modèle : champs de Vigie reconnus d'après les libellés,
 * toutes les autres cases et valeurs en lignes de la grille (chaque champ de Vigie au plus une fois).
 */
export function suggestMapping(fields: ImportField[]): PpImportMapping {
  const used = new Set<PpTarget>();
  const mapping: PpImportMapping = {};
  // Premier passage sur le libellé (et la clé), second sur « section + libellé » pour les libellés génériques.
  const passes: ((f: ImportField) => string | null)[] = [
    (f) => `${normalize(f.label)} ${GENERIC.test(normalize(f.label)) ? '' : normalize(humanize(f.key.split(/[./]/).pop() ?? ''))}`.trim(),
    (f) => (f.section ? `${normalize(f.section)} ${normalize(f.label)}` : null),
  ];
  for (const pass of passes) {
    for (const f of fields) {
      if (mapping[f.key]) continue;
      const text = pass(f);
      if (!text) continue;
      // Case « Non » d'une question oui / non : jamais associée à un champ de Vigie.
      if (f.kind === 'checkbox' && /\bnon$/.test(normalize(f.label))) continue;
      const target = suggestTarget(text, f.kind, used);
      if (target) {
        mapping[f.key] = { target };
        used.add(target);
      }
    }
  }
  // Case « Non » d'une question dont la case « Oui » alimente un champ de Vigie : ignorée.
  const targeted = new Set(fields.filter((f) => f.kind === 'checkbox' && 'target' in (mapping[f.key] ?? {})).map((f) => `${f.section ?? ''}|${normalize(f.label)}`));
  for (const f of fields) {
    if (mapping[f.key] || f.kind !== 'checkbox') continue;
    const label = normalize(f.label);
    if (/\bnon$/.test(label) && targeted.has(`${f.section ?? ''}|${label.replace(/non$/, 'oui')}`)) mapping[f.key] = { ignore: true };
  }
  for (const f of fields) mapping[f.key] ??= gridEntry(f);
  return mapping;
}

/** Correspondance de départ : le modèle pour les clés qu'il connaît, les suggestions pour les autres. */
export function initialMapping(fields: ImportField[], template?: PpImportMapping | null): PpImportMapping {
  const suggested = suggestMapping(fields);
  if (!template) return suggested;
  const out: PpImportMapping = {};
  for (const f of fields) out[f.key] = template[f.key] ?? suggested[f.key];
  return out;
}

// ─── Application ────────────────────────────────────────────────────────────

export type Sections = PpFormData['sections'];

/** Valeurs brutes lues pour chaque champ de Vigie, et grille du formulaire à conserver sur le plan. */
export type AppliedMapping = {
  values: Partial<Record<PpTarget, string[]>>;
  /** Case(s) associée(s) à « Travaux dangereux » : vrai si l'une est cochée. */
  dangerousWork?: boolean;
  sections: Sections;
};

const fieldText = (f: ImportField) => (f.kind === 'checkbox' ? (f.checked ? 'Oui' : '') : (f.value ?? '').trim());

export function applyMapping(fields: ImportField[], mapping: PpImportMapping): AppliedMapping {
  const values: AppliedMapping['values'] = {};
  let dangerousWork: boolean | undefined;
  const sections = new Map<string, Sections[number]['items']>();
  for (const f of fields) {
    const entry = mapping[f.key];
    if (!entry || 'ignore' in entry) continue;
    if ('target' in entry) {
      if (entry.target === 'dangerousWork') {
        const yes = f.kind === 'checkbox' ? !!f.checked : isYes(f.value);
        dangerousWork = (dangerousWork ?? false) || yes;
        continue;
      }
      const text = fieldText(f);
      if (text) (values[entry.target] ??= []).push(text);
      continue;
    }
    const title = cleanLabel(entry.section) || DEFAULT_SECTION;
    const label = cleanLabel(entry.label) || humanize(f.key);
    const items = sections.get(title) ?? [];
    if (f.kind === 'checkbox') {
      items.push({ label, checked: !!f.checked });
    } else {
      const value = (f.value ?? '').trim();
      if (!value) continue; // champ vide : rien à conserver
      // Réponse oui / non d'un bouton radio ou d'une liste : conservée aussi comme case.
      items.push(isYes(value) || isNo(value) ? { label, checked: isYes(value), value } : { label, value });
    }
    sections.set(title, items);
  }
  return {
    values,
    dangerousWork,
    sections: [...sections].filter(([, items]) => items.length).map(([title, items]) => ({ title, items })),
  };
}

/** Points cochés des sections dont le titre correspond, mis en phrase (« Travail en hauteur ; zone ATEX. »). */
export function checkedSummary(sections: Sections, titleRe: RegExp): string {
  const parts: string[] = [];
  for (const s of sections) {
    if (!titleRe.test(normalize(s.title))) continue;
    for (const i of s.items) {
      // Grille « Oui / Non » : la case « Non » cochée signale l'absence du risque ou de la mesure.
      if (/\bnon$/.test(normalize(i.label))) continue;
      const label = i.label.replace(/\s*(?:—|–|-|:)\s*oui$/i, '');
      if (i.checked && (!i.value || isYes(i.value))) parts.push(label);
      else if (i.checked === undefined && i.value) parts.push(`${label} : ${i.value}`);
    }
  }
  if (!parts.length) return '';
  // Minuscule initiale après le premier point, sauf sigles (« EPI spécifiques »).
  const text = parts.map((p, n) => (n === 0 || /^.[A-ZÀ-Ý0-9]/.test(p) ? p : p[0].toLocaleLowerCase('fr') + p.slice(1))).join(' ; ');
  return `${text}.`;
}

// ─── Modèles : empreinte et rapprochement ───────────────────────────────────

/** Texte dont l'empreinte (sha256) identifie un modèle de formulaire : clés détectées triées. */
export const signatureSource = (keys: string[]) => [...new Set(keys)].sort().join('\n');

/** Part des champs communs entre deux jeux de clés (0 à 1, rapportée au plus grand des deux). */
export function keyOverlap(a: string[], b: string[]): number {
  const sa = new Set(a), sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let common = 0;
  sa.forEach((k) => { if (sb.has(k)) common += 1; });
  return common / Math.max(sa.size, sb.size);
}

export const PROPOSE_OVERLAP = 0.8;

/** Modèle reconnu (même format et même empreinte), sinon modèle proche à proposer (≥ 80 % de clés communes). */
export function matchTemplate(
  format: PpImportFormat,
  signature: string | null,
  keys: string[],
  templates: { id: number; format: string; signature: string | null; mapping: PpImportMapping }[],
): { matchedId: number | null; proposed: { id: number; overlap: number } | null } {
  const sameFormat = templates.filter((t) => t.format === format);
  const exact = signature ? sameFormat.find((t) => t.signature === signature) : undefined;
  if (exact) return { matchedId: exact.id, proposed: null };
  let proposed: { id: number; overlap: number } | null = null;
  for (const t of sameFormat) {
    const overlap = keyOverlap(keys, Object.keys(t.mapping));
    if (overlap >= PROPOSE_OVERLAP && (!proposed || overlap > proposed.overlap)) proposed = { id: t.id, overlap };
  }
  return { matchedId: null, proposed };
}

/** Résumé d'une correspondance (nombre de champs vers Vigie, lignes de grille, ignorés). */
export function mappingStats(mapping: PpImportMapping) {
  const entries = Object.values(mapping);
  return {
    total: entries.length,
    targets: entries.filter((e) => 'target' in e).length,
    grid: entries.filter((e) => 'section' in e).length,
    ignored: entries.filter((e) => 'ignore' in e).length,
  };
}

/** Champs reconstitués à partir des clés d'un modèle (modification d'un modèle sans fichier). */
export function fieldsFromTemplate(mapping: PpImportMapping): ImportField[] {
  return Object.entries(mapping).map(([key, entry]) => {
    const fallback = humanize(key.split(/[./]/).pop()?.replace(/#\d+$/, '') ?? key);
    return {
      key,
      label: 'section' in entry ? entry.label : fallback,
      section: 'section' in entry ? entry.section : undefined,
      kind: 'text' as const,
    };
  });
}
