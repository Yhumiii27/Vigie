import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEW_CONTRACTOR, buildDraft } from './draft';
import { parseDocx } from './docx';
import { applyMapping, matchTemplate, signatureSource, suggestMapping } from './mapping';
import { parsePdfForm } from './pdf-form';
import type { ImportField } from './types';

// Import du plan de prévention sur les formulaires d'exemple (QUA-10) : résultats attendus de samples/README.md
// (format, nombre de champs et de cases, cases cochées, empreinte commune du PDF vierge et rempli, préremplissage).

const sample = (name: string) => new Uint8Array(readFileSync(path.join(process.cwd(), 'samples', name)));
const signature = (fields: ImportField[]) => createHash('sha256').update(signatureSource(fields.map((f) => f.key))).digest('hex');
const checkboxes = (fields: ImportField[]) => fields.filter((f) => f.kind === 'checkbox');
/** Référentiels du jeu de démonstration (entreprises extérieures et projets Keystone). */
const ctx = {
  contractors: [{ id: 'EE-004', name: '[Entreprise Chaudronnerie Soudure]' }, { id: 'EE-001', name: '[Entreprise Levage Express]' }],
  projects: [['K-2025-042 · [Client A]', 'K-2025-042 · [Client A]'], ['K-2026-012 · [Client B]', 'K-2026-012 · [Client B]']] as const,
  today: '2026-10-09',
};
const draftOf = (fields: ImportField[]) => buildDraft(applyMapping(fields, suggestMapping(fields)), ctx);

describe('formulaires d’exemple (samples/)', () => {
  it('PDF vierge : PDF remplissable, 42 champs dont 24 cases, aucune cochée', async () => {
    const r = await parsePdfForm(sample('plan-de-prevention-vierge.pdf'));
    expect(r.format).toBe('pdf_form');
    expect(r.pageCount).toBe(2);
    expect(r.fields).toHaveLength(42);
    expect(checkboxes(r.fields)).toHaveLength(24);
    expect(checkboxes(r.fields).filter((f) => f.checked)).toHaveLength(0);
    expect(r.warnings).toEqual([]);
  });

  it('PDF rempli : 14 cases cochées, même empreinte que le vierge (modèle reconnu), préremplissage', async () => {
    const blank = await parsePdfForm(sample('plan-de-prevention-vierge.pdf'));
    const r = await parsePdfForm(sample('plan-de-prevention-exemple.pdf'));
    expect(checkboxes(r.fields).filter((f) => f.checked)).toHaveLength(14);
    expect(signature(r.fields)).toBe(signature(blank.fields));
    const template = { id: 7, format: 'pdf_form', signature: signature(blank.fields), mapping: suggestMapping(blank.fields) };
    expect(matchTemplate('pdf_form', signature(r.fields), r.fields.map((f) => f.key), [template])).toEqual({ matchedId: 7, proposed: null });
    const d = draftOf(r.fields);
    expect(d).toMatchObject({
      contractorId: 'EE-004', startOn: '2026-10-12', endOn: '2026-10-16', estimatedHours: '60', dangerousWork: true,
      keystoneProject: 'K-2025-042 · [Client A]', inspectionOn: '2026-10-06', signedEuOn: '2026-10-07', signedEeOn: '',
    });
    expect(d.title).toMatch(/air comprimé/);
    expect(d.interferenceRisks).toMatch(/hauteur/i);
  });

  it('Word rempli : 42 champs dont 24 cases (15 cochées), entreprise à créer, signé par les deux entreprises', () => {
    const r = parseDocx(sample('plan-de-prevention-exemple.docx'));
    expect(r.format).toBe('docx');
    expect(r.fields).toHaveLength(42);
    expect(checkboxes(r.fields)).toHaveLength(24);
    expect(checkboxes(r.fields).filter((f) => f.checked)).toHaveLength(15);
    const d = draftOf(r.fields);
    expect(d).toMatchObject({ contractorId: NEW_CONTRACTOR, keystoneProject: 'K-2026-012 · [Client B]', signedEuOn: '2026-10-08', signedEeOn: '2026-10-08' });
    expect(d.contractorName).toMatch(/Échafaudages Atlantique/);
  });

  it('fichier endommagé : lu comme un scan ou refusé, jamais une exception non traitée', async () => {
    const broken = sample('plan-de-prevention-exemple.pdf').slice(0, 2000);
    const r = await parsePdfForm(broken).catch((e: Error) => ({ error: e.message }));
    expect(r).toBeTruthy();
    expect(() => parseDocx(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]))).toThrow();
  });
});
