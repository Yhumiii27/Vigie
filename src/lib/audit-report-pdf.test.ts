import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { auditReportFileName, buildAuditReportPdf, winAnsi, wrapText } from './audit-report-pdf';

describe('rapport d’audit en PDF (AUD-39)', () => {
  it('texte réduit au jeu WinAnsi : français gardé, autres signes remplacés', () => {
    expect(winAnsi('Écart « majeur » : œuvre, 5 €, été — à reprendre…')).toBe('Écart « majeur » : œuvre, 5 €, été — à reprendre…');
    expect(winAnsi('TF1 ≥ 4 %')).toBe('TF1 >= 4 %');
    expect(winAnsi('Šárka Dvořák 北')).toBe('Šárka Dvorák ?');
    expect(winAnsi('ligne\nsuivante')).toBe('ligne suivante');
  });

  it('découpage des lignes à la largeur, mots trop longs coupés', () => {
    const measure = (s: string) => s.length;
    expect(wrapText('un deux trois quatre', 9, measure)).toEqual(['un deux', 'trois', 'quatre']);
    expect(wrapText('abcdefghijkl', 5, measure)).toEqual(['abcde', 'fghij', 'kl']);
    expect(wrapText('a\nb', 10, measure)).toEqual(['a', 'b']);
  });

  it('document PDF valide, plusieurs pages au besoin, nom de fichier sûr', async () => {
    const bytes = await buildAuditReportPdf({
      ref: 'AUD-2026-12', title: 'Audit interne ISO 45001 — atelier', kindLabel: 'Audit ISO blanc', track: 'Audits internes', site: 'Site de [Ville A]',
      doneOn: '2026-09-15', auditor: 'L. Moreau · [Organisme]', scope: 'Atelier montage', owner: 'C. Lefèvre',
      findings: Array.from({ length: 40 }, (_, i) => ({
        kindLabel: 'Écart mineur', clause: '§ 8.1.2', text: `Constat n° ${i + 1} : consignation non tracée sur le poste ; « à reprendre ».`, foundOn: '2026-09-15',
        responseDueOn: '2026-10-15', actions: [{ id: 'AC-260001', title: 'Tracer la consignation', status: 'À faire' }, { id: 'AC-260002', title: null, status: null }],
      })),
      generatedOn: '2026-10-09', generatedBy: 'C. Lefèvre',
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe("Rapport d'audit AUD-2026-12");
    expect(auditReportFileName({ ref: 'AUD-2026-12', doneOn: '2026-09-15' })).toBe('rapport-audit-AUD-2026-12-2026-09-15.pdf');
  });
});
