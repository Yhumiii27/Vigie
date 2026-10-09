// Validation (zod) des données de l'import transmises par le navigateur ou relues en base :
// correspondance d'un modèle et grille du formulaire conservée sur le plan.

import { z } from 'zod';
import { PP_TARGETS, type PpFormData, type PpImportFormat, type PpImportMapping, type PpTarget } from '../pp-form';

export const IMPORT_FORMATS: PpImportFormat[] = ['pdf_form', 'docx', 'scan'];
const TARGETS = PP_TARGETS.map(([k]) => k) as [PpTarget, ...PpTarget[]];

const MappingEntry = z.union([
  z.strictObject({ target: z.enum(TARGETS) }),
  z.strictObject({ section: z.string().trim().max(200), label: z.string().trim().min(1).max(300) }),
  z.strictObject({ ignore: z.literal(true) }),
]);

export const MappingSchema = z
  .record(z.string().min(1).max(200), MappingEntry)
  .refine((m) => Object.keys(m).length <= 1000, 'Modèle trop volumineux (1 000 champs au maximum).');

/**
 * Lignes de grille au plus : autant que de champs dans un modèle. Les lecteurs en renvoient au plus 800 (PDF, Word, scan),
 * réparties en autant de sections que le formulaire en compte (une section peut ne contenir qu'une ligne).
 */
export const MAX_GRID_ITEMS = 1000;

export const SectionsSchema = z.array(z.strictObject({
  title: z.string().trim().min(1).max(200),
  items: z.array(z.strictObject({
    label: z.string().trim().min(1).max(300),
    checked: z.boolean().optional(),
    value: z.string().max(4000).optional(),
  })).max(MAX_GRID_ITEMS),
})).max(MAX_GRID_ITEMS)
  .refine((sections) => sections.reduce((n, s) => n + s.items.length, 0) <= MAX_GRID_ITEMS, `Grille trop longue (${MAX_GRID_ITEMS} lignes au maximum).`);

/** Lecture tolérante d'une correspondance enregistrée (jsonb) : null si elle n'est pas conforme. */
export function readMapping(raw: unknown): PpImportMapping | null {
  const r = MappingSchema.safeParse(raw);
  return r.success ? (r.data as PpImportMapping) : null;
}

/** JSON → grille du formulaire, ou null si le contenu n'est pas conforme. */
export function readSections(json: string): PpFormData['sections'] | null {
  try {
    const r = SectionsSchema.safeParse(JSON.parse(json));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** JSON → correspondance, ou null si le contenu n'est pas conforme. */
export function readMappingJson(json: string): PpImportMapping | null {
  try {
    return readMapping(JSON.parse(json));
  } catch {
    return null;
  }
}
