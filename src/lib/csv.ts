// CSV « tableur français » commun aux exports (IMP-04) : UTF-8 avec BOM (accents lus par Excel), séparateur « ; », fins de
// ligne CRLF, nombres à virgule décimale, cellules qui commencent comme une formule neutralisées (injection de formules à
// l'ouverture dans un tableur : =, +, -, @, tabulation, retour chariot), guillemets doublés. Règles pures (csv.test.ts).

export type CsvValue = string | number | null | undefined;

/** Une formule de tableur commence par =, +, -, @ (après d'éventuels espaces), une tabulation ou un retour chariot. */
const FORMULA = /^[\t\r]|^\s*[=+@]|^\s*-(?=\S)/;

/** Cellule CSV : nombre à virgule, texte neutralisé (préfixe « ' ») puis entre guillemets s'il contient « ; », « " » ou un saut de ligne. */
export function csvCell(v: CsvValue): string {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : '';
  const s = FORMULA.test(v) ? `'${v}` : v;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Document CSV complet (BOM, « ; », CRLF), ligne d'en-tête comprise. */
export function toCsv(rows: readonly (readonly CsvValue[])[]): string {
  return `\uFEFF${rows.map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

/** Fragment de nom de fichier sans accents ni espaces (`dots` : points gardés, ex. numéro de version « 3.2 »). */
export function fileSlug(s: string, fallback = 'export', opts: { dots?: boolean } = {}): string {
  const kept = opts.dots ? /[^a-zA-Z0-9.]+/g : /[^a-zA-Z0-9]+/g;
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(kept, '-').replace(/^-+|-+$/g, '').toLowerCase() || fallback;
}

/** Réponse HTTP d'un export CSV : téléchargé (nom ASCII et UTF-8), jamais en cache, jamais interprété. */
export function csvResponse(body: string, fileName: string): Response {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
