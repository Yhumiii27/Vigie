import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

// Rapport d'audit en PDF (AUD-39, réponse du service QHSE du 09/11/2026 : pas d'envoi, mais un PDF téléchargeable une fois
// l'audit enregistré). Construit côté serveur avec pdf-lib (dépendance existante) et les polices standard du format PDF
// (Helvetica) : aucune police à télécharger ni à embarquer. Ces polices ne couvrent que le jeu WinAnsi (Latin-1 et quelques
// signes : œ, €, guillemets, tirets, points de suspension) — tout le français y figure ; un autre caractère est remplacé
// (winAnsi) plutôt que de faire échouer le document. Module pur (sans session ni base) : données préparées par
// loadAuditReport (src/lib/data/audits.ts), servi par /audits/rapport/<id>.

export type AuditReportAction = { id: string; title: string | null; status: string | null };
export type AuditReportFinding = {
  kindLabel: string; clause: string | null; text: string; foundOn: string | null; responseDueOn: string | null;
  /** Actions du constat : numéro, intitulé et état seulement si la personne peut lire l'action (sinon numéro seul). */
  actions: AuditReportAction[];
};
export type AuditReportData = {
  /** Référence affichée (« AUD-2026-12 »). */
  ref: string;
  title: string;
  kindLabel: string;
  track: string;
  site: string;
  /** Date de réalisation (AAAA-MM-JJ). */
  doneOn: string | null;
  auditor: string;
  scope: string | null;
  owner: string;
  findings: AuditReportFinding[];
  /** Édité le (AAAA-MM-JJ) et par. */
  generatedOn: string;
  generatedBy: string;
};

/** Caractères hors ASCII du jeu WinAnsi (CP1252) en plus de Latin-1 (U+00A0 à U+00FF). */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACEMENTS: Record<string, string> = {
  ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '✓': 'v', '✔': 'v',
  '×': 'x', '−': '-', '‐': '-', '‑': '-', '\t': ' ',
};

/** Texte réduit au jeu WinAnsi des polices standard : signes connus remplacés, accents hors jeu retirés, sinon « ? ». */
export function winAnsi(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)) { out += ch; continue; }
    if (ch in REPLACEMENTS) { out += REPLACEMENTS[ch]; continue; }
    if (ch === '\n' || ch === '\r') { out += ' '; continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base && base !== ch && [...base].every((c) => c.charCodeAt(0) <= 0x7e) ? base : '?';
  }
  return out;
}

/** Découpe un texte en lignes d'au plus `width` points (mots trop longs coupés). */
export function wrapText(text: string, width: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of winAnsi(paragraph).split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      let rest = word;
      while (measure(rest) > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n)) > width) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/** Date AAAA-MM-JJ → JJ/MM/AAAA. */
const fr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const ACCENT = rgb(0.13, 0.36, 0.55);
const MUTED = rgb(0.35, 0.35, 0.35);

/** Rapport d'audit en PDF (octets du fichier). */
export async function buildAuditReportPdf(r: AuditReportData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(`Rapport d'audit ${r.ref}`));
  pdf.setSubject(winAnsi(r.title));
  pdf.setProducer('Vigie QHSE');
  pdf.setCreator('Vigie QHSE');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = A4[0] - 2 * MARGIN;

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - MARGIN;
  const newPage = () => { page = pdf.addPage(A4); y = A4[1] - MARGIN; };
  const write = (text: string, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) => {
    const font = o.font ?? regular;
    const size = o.size ?? 10;
    const indent = o.indent ?? 0;
    for (const line of wrapText(text, width - indent, (s) => font.widthOfTextAtSize(s, size))) {
      if (y - size < MARGIN + 20) newPage();
      page.drawText(line, { x: MARGIN + indent, y: y - size, size, font, color: o.color ?? rgb(0, 0, 0) });
      y -= size * 1.35;
    }
    y -= o.gap ?? 0;
  };
  const rule = () => {
    if (y < MARGIN + 30) newPage();
    page.drawLine({ start: { x: MARGIN, y }, end: { x: A4[0] - MARGIN, y }, thickness: 0.5, color: MUTED });
    y -= 10;
  };

  write('Vigie · Audits et certifications', { size: 9, color: ACCENT, gap: 2 });
  write("Rapport d'audit", { font: bold, size: 18, gap: 4 });
  write(r.title, { font: bold, size: 12, gap: 8 });
  rule();
  const facts: [string, string][] = [
    ['Référence', r.ref], ["Type d'audit", r.kindLabel], ['Ligne du programme', r.track], ['Site', r.site],
    ['Réalisé le', fr(r.doneOn)], ['Auditeur', r.auditor || '—'], ['Responsable', r.owner || '—'], ...(r.scope ? [['Périmètre', r.scope] as [string, string]] : []),
  ];
  for (const [k, v] of facts) {
    const label = winAnsi(`${k} : `);
    if (y - 10 < MARGIN + 20) newPage();
    page.drawText(label, { x: MARGIN, y: y - 10, size: 10, font: bold });
    const lines = wrapText(v, width - 130, (s) => regular.widthOfTextAtSize(s, 10));
    lines.forEach((line, i) => {
      if (i && y - 10 < MARGIN + 20) newPage();
      page.drawText(line, { x: MARGIN + 130, y: y - 10, size: 10, font: regular });
      y -= 13.5;
    });
  }
  y -= 6;
  rule();
  write(`Constats (${r.findings.length})`, { font: bold, size: 13, gap: 4 });
  if (!r.findings.length) write('Aucun constat enregistré pour cet audit.', { color: MUTED });
  r.findings.forEach((f, i) => {
    write(`${i + 1}. ${f.kindLabel}${f.clause ? ` · ${f.clause}` : ''}${f.foundOn ? ` · constaté le ${fr(f.foundOn)}` : ''}`, { font: bold, size: 10.5, gap: 1 });
    write(f.text, { indent: 12, gap: 2 });
    if (f.responseDueOn) write(`Réponse attendue au plus tard le ${fr(f.responseDueOn)}`, { indent: 12, size: 9, color: MUTED });
    if (f.actions.length) {
      write('Actions :', { indent: 12, size: 9, font: bold });
      for (const a of f.actions) write(`${a.id}${a.title ? ` · ${a.title}` : ''}${a.status ? ` (${a.status})` : ''}`, { indent: 24, size: 9 });
    }
    y -= 6;
  });
  // Pied de page : édition et pagination.
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const foot = winAnsi(`Vigie · rapport d'audit ${r.ref} · édité le ${fr(r.generatedOn)} par ${r.generatedBy} · page ${i + 1}/${pages.length}`);
    p.drawText(foot, { x: MARGIN, y: MARGIN - 20, size: 8, font: regular, color: MUTED });
  });
  return pdf.save();
}

/** Nom du fichier téléchargé : « rapport-audit-<référence>-<date>.pdf » (caractères sûrs seulement). */
export function auditReportFileName(r: Pick<AuditReportData, 'ref' | 'doneOn'>): string {
  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `rapport-audit-${slug(r.ref)}${r.doneOn ? `-${r.doneOn}` : ''}.pdf`;
}
