// Lecture d'un scan (PDF numérisé, photo) par l'API Claude : schéma de sortie structurée (zod), consignes
// et conversion de la réponse en champs détectés. Module pur ; l'appel à l'API est fait par la server action.

import { z } from 'zod';
import { cleanHeading, cleanLabel, cleanValue, slug } from './text';
import type { ImportField } from './types';

/** Champ attendu d'un modèle déjà calibré (clés à réutiliser par le modèle de langage). */
export type ExpectedField = { key: string; label: string; section?: string };

const MAX_EXPECTED = 400;

/**
 * Schéma de la réponse, construit à l'exécution : la description de la clé rappelle les clés du modèle choisi.
 * Champs obligatoires et nullables (sortie structurée stricte), sans contrainte numérique.
 */
export function scanSchema(expected: ExpectedField[] = []) {
  const keyHint = expected.length
    ? 'Clé stable. Reprendre exactement la clé du modèle fournie dans les consignes pour le même élément.'
    : 'Clé stable en minuscules sans accents : section.libelle (ex. risques_interference.travail_en_hauteur).';
  return z.object({
    isPreventionPlan: z.boolean().describe('Faux si le document n’est manifestement pas un plan de prévention.'),
    fields: z.array(z.object({
      key: z.string().describe(keyHint),
      label: z.string().describe('Libellé imprimé exact de la case ou du champ.'),
      section: z.string().describe('Titre de la section du formulaire où se trouve l’élément (chaîne vide si aucun).'),
      kind: z.enum(['checkbox', 'text', 'date']),
      checked: z.boolean().nullable().describe('Cases : true si cochée (croix, coche, case noircie ou entourée), false si vide. null pour un champ.'),
      value: z.string().nullable().describe('Champs : valeur saisie ou manuscrite recopiée telle quelle ; null si non rempli ou pour une case.'),
      page: z.number().nullable().describe('Numéro de page (1 pour la première).'),
    })),
    warnings: z.array(z.string()).describe('Éléments illisibles, ambigus (case raturée, double coche) ou pages manquantes, en français.'),
  });
}
export type ScanOutput = z.infer<ReturnType<typeof scanSchema>>;

export const SCAN_SYSTEM = 'Tu lis des formulaires de plan de prévention (Code du travail, articles R. 4512-6 à R. 4512-12) remplis à la main ou à l’ordinateur, numérisés ou photographiés, pour les importer dans un logiciel QHSE. Tu restitues fidèlement ce qui est imprimé, écrit et coché, sans rien inventer ni corriger.';

/** Consigne placée après le document ; `pages` : nombre d'images d'un formulaire photographié page par page (INT-14). */
export function scanPrompt(expected: ExpectedField[] = [], pages = 1): string {
  const lines = [
    ...(pages > 1 ? [`Ce formulaire est fourni en ${pages} images : les pages 1 à ${pages}, dans l’ordre. Le numéro de page d’un élément est le rang de son image ; une page manquante ou en double est signalée dans warnings.`, ''] : []),
    'Relève tous les éléments de ce formulaire, dans l’ordre de lecture :',
    '- chaque case à cocher, y compris les cases vides : libellé exact tel qu’imprimé, titre de la section, état coché ou non ;',
    '- dans un tableau à colonnes « Oui / Non » (ou équivalent), une case par colonne, libellée « <libellé de la ligne> — <titre de la colonne> » ;',
    '- chaque champ à remplir (texte, date, nombre, nom, signature datée) : libellé imprimé et valeur saisie ou manuscrite, recopiée telle quelle (dates comprises, sans les convertir) ; valeur null si le champ est vide ;',
    '- une case dont l’état est douteux est signalée dans warnings.',
    'Ne relève pas les textes d’explication, les en-têtes et pieds de page, ni les mentions légales.',
  ];
  if (expected.length) {
    lines.push(
      '',
      'Ce formulaire suit un modèle déjà calibré. Pour chaque élément de la liste ci-dessous présent dans le document, réutilise exactement sa clé ; ne crée une nouvelle clé que pour un élément absent de la liste.',
      'clé | section | libellé',
      ...expected.slice(0, MAX_EXPECTED).map((f) => `${f.key} | ${f.section ?? ''} | ${f.label}`),
    );
  }
  return lines.join('\n');
}

/** Réponse du modèle → champs détectés (clés nettoyées et uniques, textes bornés). */
export function scanFields(out: ScanOutput, expected: ExpectedField[] = []): ImportField[] {
  const known = new Set(expected.map((f) => f.key));
  const seen = new Map<string, number>();
  return out.fields.slice(0, 800).map((f, i): ImportField => {
    const label = cleanLabel(f.label) || `Élément ${i + 1}`;
    const section = cleanHeading(f.section ?? '');
    const raw = f.key.trim();
    const base = known.has(raw) ? raw : (raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_.#/-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120)
      || `${slug(section) || 'document'}.${slug(label) || 'champ'}`);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const key = n > 1 ? `${base}#${n}` : base;
    const page = f.page != null && Number.isFinite(f.page) && f.page >= 1 ? Math.round(f.page) : undefined;
    if (f.kind === 'checkbox') return { key, label, section: section || undefined, kind: 'checkbox', checked: f.checked === true, page };
    return { key, label, section: section || undefined, kind: f.kind, value: cleanValue(f.value), page };
  });
}
