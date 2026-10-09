// Génère les formulaires d'exemple de l'import du plan de prévention (samples/) :
//   plan-de-prevention-vierge.pdf    PDF remplissable (AcroForm) non rempli
//   plan-de-prevention-exemple.pdf   même formulaire rempli (entreprise existante, plan à signer)
//   plan-de-prevention-exemple.docx  formulaire Word rempli (contrôles de contenu et cases ☒ / ☐, nouvelle entreprise)
// Usage : node scripts/pp-samples.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFHexString, PDFName, StandardFonts, rgb } from 'pdf-lib';
import { strToU8, zipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'samples');
mkdirSync(outDir, { recursive: true });

// ─── Contenu du formulaire ──────────────────────────────────────────────────

const RISKS = [
  ['circulation_engins', "Circulation d'engins (chariots, nacelles, camions)"],
  ['travail_hauteur', 'Travail en hauteur (plus de 3 m)'],
  ['zone_atex', 'Intervention en zone ATEX'],
  ['points_chauds', 'Travaux par points chauds'],
  ['levage', 'Opérations de levage'],
  ['electricite', 'Risque électrique'],
  ['produits_dangereux', 'Produits dangereux ou pyrotechniques'],
  ['bruit', 'Bruit'],
  ['coactivite_production', 'Coactivité avec la production'],
];
const MEASURES = [
  ['balisage', 'Balisage et délimitation de la zone'],
  ['consignation', 'Consignation des énergies'],
  ['permis_feu', 'Permis de feu'],
  ['permis_essai', "Permis d'essai"],
  ['epi_specifiques', 'EPI spécifiques'],
  ['surveillance', 'Surveillance par un agent de l’entreprise utilisatrice'],
  ['plan_circulation', 'Plan de circulation remis'],
];
const RESCUE = [
  ['extincteurs', 'Extincteurs adaptés à proximité'],
  ['point_rassemblement', 'Point de rassemblement communiqué'],
  ['numeros_urgence', "Numéros d'urgence affichés"],
  ['consignes_poi', 'Consignes Seveso et POI communiquées'],
  ['alarme_evacuation', "Alarme et évacuation expliquées"],
  ['sst_present', 'Sauveteur secouriste du travail présent'],
];

/** Exemple PDF : entreprise existante dans Vigie, inspection faite, signature EU seule → plan « À signer ». */
const PDF_EXAMPLE = {
  text: {
    'entreprise.raison_sociale': 'Entreprise Chaudronnerie Soudure',
    'entreprise.activite': 'Chaudronnerie et soudure',
    'entreprise.interlocuteur': '[S. Garnier]',
    'entreprise.telephone': '06 39 98 31 07',
    'entreprise.email': 'atelier@chaudronnerie-soudure.example',
    'intervention.nature_travaux': "Remplacement d'un tronçon de tuyauterie d'air comprimé et soudage de supports",
    'intervention.lieu': "Atelier usinage · réseau d'air comprimé",
    'intervention.date_debut': '12/10/2026',
    'intervention.date_fin': '16/10/2026',
    'intervention.heures': '60 h',
    'intervention.projet': 'K-2025-042 ([Client A])',
    'intervention.inspection_commune': '06/10/2026',
    'risques.autres': "Projections incandescentes à proximité des postes d'usinage",
    'mesures.precisions': 'Écrans de soudage autour du poste ; surveillance 2 h après la fin des travaux par points chauds',
    'signatures.nom_eu': '[C. Lefèvre], animatrice QHSE',
    'signatures.date_eu': '07/10/2026',
    'signatures.nom_ee': '[S. Garnier]',
    'signatures.date_ee': '',
  },
  checked: new Set([
    'travaux_dangereux.oui',
    'risques.circulation_engins', 'risques.travail_hauteur', 'risques.points_chauds', 'risques.coactivite_production',
    'mesures.balisage', 'mesures.consignation', 'mesures.permis_feu', 'mesures.epi_specifiques', 'mesures.surveillance',
    'secours.extincteurs', 'secours.point_rassemblement', 'secours.numeros_urgence', 'secours.consignes_poi',
  ]),
};

// ─── PDF remplissable ───────────────────────────────────────────────────────

const A4 = [595.28, 841.89];
const M = 42; // marge
const FIELD_X = 223; // colonne des champs
const INK = rgb(0.13, 0.14, 0.17);
const MUTED = rgb(0.38, 0.4, 0.45);
const RULE = rgb(0.72, 0.74, 0.78);
const BAR = rgb(0.9, 0.91, 0.93);

async function buildPdf(values) {
  const doc = await PDFDocument.create();
  doc.setTitle('Plan de prévention — Établissement Seveso seuil haut');
  doc.setAuthor('[Entreprise X]');
  doc.setSubject('Formulaire de plan de prévention (Code du travail R. 4512-6 à R. 4512-12)');
  doc.setLanguage('fr-FR');
  // Dates fixes : fichiers identiques d'une génération à l'autre.
  doc.setCreationDate(new Date('2026-10-08T08:00:00Z'));
  doc.setModificationDate(new Date('2026-10-08T08:00:00Z'));
  doc.setProducer('Vigie · scripts/pp-samples.mjs');
  doc.setCreator('Vigie');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  const tooltip = (field, text) => field.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(text));
  const parentTooltip = (field, text) => { const parent = field.acroField.getParent(); if (parent) parent.dict.set(PDFName.of('TU'), PDFHexString.fromText(text)); };

  let page, y, pageNo = 0;
  const newPage = () => {
    page = doc.addPage(A4);
    pageNo += 1;
    y = A4[1] - M;
    page.drawText(`[Entreprise X] · Plan de prévention · page ${pageNo}/2`, { x: M, y: 22, size: 7.5, font, color: MUTED });
  };
  const text = (s, x, size = 9.5, f = font, color = INK) => page.drawText(s, { x, y, size, font: f, color });
  const section = (title) => {
    y -= 10;
    page.drawRectangle({ x: M, y: y - 5, width: A4[0] - 2 * M, height: 18, color: BAR });
    text(title.toUpperCase(), M + 6, 9.5, bold);
    y -= 24;
  };
  const textField = (name, label, tip, { width = 330, height = 16, multiline = false } = {}) => {
    text(label, M, 9);
    const f = form.createTextField(name);
    if (multiline) f.enableMultiline();
    f.addToPage(page, { x: FIELD_X, y: y - height + 11, width, height, font, borderColor: RULE, borderWidth: 0.6, textColor: INK });
    f.setFontSize(multiline ? 8.5 : 9);
    const v = values?.text[name];
    if (v) f.setText(v);
    tooltip(f, tip);
    y -= height + 8;
    return f;
  };
  const checkBox = (name, label, x, tip = label) => {
    const f = form.createCheckBox(name);
    f.addToPage(page, { x, y: y - 2, width: 10, height: 10, borderColor: INK, borderWidth: 0.8, textColor: INK });
    if (values?.checked.has(name)) f.check();
    tooltip(f, tip);
    page.drawText(label, { x: x + 15, y, size: 9, font, color: INK });
    return f;
  };
  const checkList = (group, title, items) => {
    section(title);
    let first;
    items.forEach(([key, label], i) => {
      const col = i % 2;
      const f = checkBox(`${group}.${key}`, label, col ? A4[0] / 2 + 4 : M + 4);
      first ??= f;
      if (col || i === items.length - 1) y -= 17;
    });
    parentTooltip(first, title);
  };

  // Page 1
  newPage();
  text('PLAN DE PRÉVENTION — Établissement Seveso seuil haut', M, 14, bold);
  y -= 16;
  text('[Entreprise X] · Code du travail, articles R. 4512-6 à R. 4512-12 · arrêté du 19 mars 1993', M, 8.5, font, MUTED);
  y -= 12;
  text('Plan écrit exigé dès la première minute d’intervention d’une entreprise extérieure sur le site (règle interne Seveso).', M, 8.5, font, MUTED);
  y -= 8;

  section('Entreprise extérieure');
  const first = textField('entreprise.raison_sociale', 'Raison sociale', "Raison sociale de l'entreprise extérieure");
  parentTooltip(first, 'Entreprise extérieure');
  textField('entreprise.activite', 'Activité / corps de métier', 'Activité / corps de métier');
  textField('entreprise.interlocuteur', 'Interlocuteur', "Interlocuteur de l'entreprise extérieure");
  textField('entreprise.telephone', 'Téléphone', 'Téléphone');
  textField('entreprise.email', 'E-mail', 'E-mail');

  section('Intervention');
  const nature = textField('intervention.nature_travaux', 'Nature des travaux', 'Nature des travaux', { height: 36, multiline: true });
  parentTooltip(nature, 'Intervention');
  textField('intervention.lieu', "Lieu d'intervention", "Lieu d'intervention");
  textField('intervention.date_debut', 'Date de début', 'Date de début', { width: 120 });
  textField('intervention.date_fin', 'Date de fin', 'Date de fin', { width: 120 });
  textField('intervention.heures', "Nombre d'heures sur 12 mois", "Nombre d'heures estimé sur 12 mois", { width: 120 });
  textField('intervention.projet', 'Projet Keystone / affaire', 'Projet Keystone / affaire', { width: 200 });
  textField('intervention.inspection_commune', 'Inspection commune préalable le', "Date de l'inspection commune préalable", { width: 120 });
  text('Travaux dangereux (arrêté du 19 mars 1993)', M, 9);
  const oui = checkBox('travaux_dangereux.oui', 'Oui', FIELD_X + 8, 'Oui');
  checkBox('travaux_dangereux.non', 'Non', FIELD_X + 78, 'Non');
  parentTooltip(oui, 'Travaux dangereux (arrêté du 19 mars 1993)');
  y -= 14;

  checkList('risques', "Risques d'interférence", RISKS);
  textField('risques.autres', 'Autres risques', 'Autres risques', { height: 36, multiline: true });

  // Page 2
  newPage();
  checkList('mesures', 'Mesures de prévention', MEASURES);
  textField('mesures.precisions', 'Précisions sur les mesures', 'Précisions sur les mesures', { height: 40, multiline: true });
  checkList('secours', 'Moyens de secours et consignes', RESCUE);

  section('Signatures');
  const nomEu = textField('signatures.nom_eu', 'Entreprise utilisatrice — nom du signataire', "Nom du signataire de l'entreprise utilisatrice");
  parentTooltip(nomEu, 'Signatures');
  textField('signatures.date_eu', 'Entreprise utilisatrice — date de signature', "Signature de l'entreprise utilisatrice — date", { width: 120 });
  textField('signatures.nom_ee', 'Entreprise extérieure — nom du signataire', "Nom du signataire de l'entreprise extérieure");
  textField('signatures.date_ee', 'Entreprise extérieure — date de signature', "Signature de l'entreprise extérieure — date", { width: 120 });
  y -= 6;
  text('Le plan est établi après l’inspection commune préalable et signé par les deux entreprises avant le début des travaux.', M, 8, font, MUTED);

  form.updateFieldAppearances(font);
  return doc.save();
}

// ─── Word (.docx) ───────────────────────────────────────────────────────────

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let sdtId = 1000;

const run = (t, { bold = false, size } = {}) =>
  `<w:r>${bold || size ? `<w:rPr>${bold ? '<w:b/>' : ''}${size ? `<w:sz w:val="${size}"/>` : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const para = (content, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${content}</w:p>`;
const heading = (t) => para(run(t), 'Heading1');

const ccCheckbox = (tag, checked, alias) => `<w:sdt><w:sdtPr><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic"/></w:rPr>${alias ? `<w:alias w:val="${esc(alias)}"/>` : ''}<w:tag w:val="${tag}"/><w:id w:val="${++sdtId}"/><w14:checkbox><w14:checked w14:val="${checked ? 1 : 0}"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:hint="eastAsia"/></w:rPr><w:t>${checked ? '☒' : '☐'}</w:t></w:r></w:sdtContent></w:sdt>`;
const ccText = (tag, value, alias) => `<w:sdt><w:sdtPr>${alias ? `<w:alias w:val="${esc(alias)}"/>` : ''}<w:tag w:val="${tag}"/><w:id w:val="${++sdtId}"/><w:text/></w:sdtPr><w:sdtContent>${run(value)}</w:sdtContent></w:sdt>`;
const ccDate = (tag, iso, alias) => `<w:sdt><w:sdtPr>${alias ? `<w:alias w:val="${esc(alias)}"/>` : ''}<w:tag w:val="${tag}"/><w:id w:val="${++sdtId}"/><w:date w:fullDate="${iso}T00:00:00Z"><w:dateFormat w:val="dd/MM/yyyy"/><w:lid w:val="fr-FR"/><w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date></w:sdtPr><w:sdtContent>${run(`${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`)}</w:sdtContent></w:sdt>`;
const glyph = (checked) => run(checked ? '☒' : '☐');

const BORDERS = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="A6A6A6"/><w:left w:val="single" w:sz="4" w:color="A6A6A6"/><w:bottom w:val="single" w:sz="4" w:color="A6A6A6"/><w:right w:val="single" w:sz="4" w:color="A6A6A6"/><w:insideH w:val="single" w:sz="4" w:color="A6A6A6"/><w:insideV w:val="single" w:sz="4" w:color="A6A6A6"/></w:tblBorders>';
const cell = (content, width, { shaded = false } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shaded ? '<w:shd w:val="clear" w:color="auto" w:fill="E7E9EC"/>' : ''}</w:tcPr>${content}</w:tc>`;
const table = (widths, rows) =>
  `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${BORDERS}<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
const row = (cells, { header = false } = {}) => `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.join('')}</w:tr>`;
const headerRow = (labels, widths) => row(labels.map((l, i) => cell(para(l ? run(l, { bold: true }) : ''), widths[i], { shaded: true })), { header: true });

/** Exemple Word : nouvelle entreprise (à créer dans Vigie), inspection faite et plan signé par les deux entreprises. */
function buildDocumentXml() {
  const risksChecked = new Set(['circulation_engins', 'travail_hauteur', 'levage', 'produits_dangereux', 'coactivite_production']);
  const measuresChecked = new Set(['balisage', 'epi_specifiques', 'surveillance', 'plan_circulation']);
  const rescueChecked = new Set(['extincteurs', 'point_rassemblement', 'numeros_urgence', 'consignes_poi', 'alarme_evacuation']);
  const W2 = [3400, 5600];
  const body = [
    para(run('PLAN DE PRÉVENTION — Établissement Seveso seuil haut'), 'Title'),
    para(run('[Entreprise X] · Code du travail, articles R. 4512-6 à R. 4512-12 · arrêté du 19 mars 1993')),
    heading('1. Entreprise extérieure'),
    table(W2, [
      row([cell(para(run('Raison sociale', { bold: true })), W2[0]), cell(para(ccText('ee_raison_sociale', '[Entreprise Échafaudages Atlantique]', 'Raison sociale')), W2[1])]),
      row([cell(para(run('Activité / corps de métier', { bold: true })), W2[0]), cell(para(ccText('ee_activite', "Montage d'échafaudages", 'Activité')), W2[1])]),
      row([cell(para(run('Interlocuteur', { bold: true })), W2[0]), cell(para(ccText('ee_interlocuteur', '[P. Morel], chef de chantier')), W2[1])]),
      row([cell(para(run('Téléphone', { bold: true })), W2[0]), cell(para(ccText('ee_telephone', '02 61 91 52 08')), W2[1])]),
      row([cell(para(run('E-mail', { bold: true })), W2[0]), cell(para(ccText('ee_email', 'chantiers@echafaudages-atlantique.example')), W2[1])]),
    ]),
    heading('2. Intervention'),
    para(run('Nature des travaux : ') + ccText('nature_travaux', "Montage d'un échafaudage pour la réfection de la toiture du magasin de stockage")),
    para(run("Lieu d'intervention : ") + ccText('lieu', "Zone d'essais · magasin de stockage des produits inertes")),
    para(run('Du ') + ccDate('date_debut', '2026-10-19', 'Date de début') + run(' au ') + ccDate('date_fin', '2026-10-23', 'Date de fin')),
    para(run("Nombre d'heures estimé sur 12 mois : ") + ccText('heures', '80')),
    para(run('Projet Keystone / affaire : ') + ccText('projet', 'K-2026-012 – [Client B]')),
    para(run('Inspection commune préalable réalisée le : ') + ccDate('inspection_commune', '2026-10-07')),
    para(run('Travaux dangereux (arrêté du 19 mars 1993) : ') + glyph(true) + run(' Oui   ') + glyph(false) + run(' Non')),
    heading("3. Risques d'interférence"),
    table([7000, 2000], [
      headerRow(['Risque identifié', 'Concerné'], [7000, 2000]),
      ...RISKS.map(([key, label], i) => row([
        cell(para(run(label)), 7000),
        cell(para(i < 5 ? ccCheckbox(`risque_${key}`, risksChecked.has(key)) : glyph(risksChecked.has(key))), 2000),
      ])),
    ]),
    para(run('Autres risques : ') + ccText('autres_risques', 'Chute d’objets depuis l’échafaudage sur l’allée de circulation')),
    heading('4. Mesures de prévention'),
    table([9000], MEASURES.map(([key, label], i) => row([
      cell(para((i % 2 === 0 ? ccCheckbox(`mesure_${key}`, measuresChecked.has(key)) : glyph(measuresChecked.has(key))) + run(` ${label}`)), 9000),
    ]))),
    para(run('Précisions sur les mesures : ') + ccText('precisions_mesures', 'Échafaudage réceptionné avant utilisation ; allée balisée et interdite au chariot pendant le montage ; harnais pour le montage')),
    heading('5. Moyens de secours et consignes'),
    ...RESCUE.map(([key, label], i) => para(i % 2 === 0 ? glyph(rescueChecked.has(key)) + run(` ${label}`) : ccCheckbox(`secours_${key}`, rescueChecked.has(key)) + run(` ${label}`))),
    heading('6. Signatures'),
    table([3000, 3000, 3000], [
      headerRow(['', 'Entreprise utilisatrice', 'Entreprise extérieure'], [3000, 3000, 3000]),
      row([cell(para(run('Nom du signataire', { bold: true })), 3000), cell(para(ccText('signataire_eu', '[C. Lefèvre]')), 3000), cell(para(ccText('signataire_ee', '[P. Morel]')), 3000)]),
      row([cell(para(run('Date de signature', { bold: true })), 3000), cell(para(ccDate('date_signature_eu', '2026-10-08')), 3000), cell(para(ccDate('date_signature_ee', '2026-10-08')), 3000)]),
    ]),
    para(run('Le plan est établi après l’inspection commune préalable et signé par les deux entreprises avant le début des travaux.', { size: 16 })),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:caps/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

function buildDocx() {
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Plan de prévention — Établissement Seveso seuil haut</dc:title><dc:creator>[Entreprise X]</dc:creator><dc:language>fr-FR</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">2026-10-08T08:00:00Z</dcterms:created></cp:coreProperties>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'word/styles.xml': STYLES,
    'word/document.xml': buildDocumentXml(),
  };
  // Date fixe : fichiers identiques d'une génération à l'autre.
  const mtime = new Date('2026-10-08T08:00:00Z');
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, [strToU8(content), { mtime }]])), { level: 6 });
}

// ─── Écriture ───────────────────────────────────────────────────────────────

const outputs = [
  ['plan-de-prevention-vierge.pdf', await buildPdf(null)],
  ['plan-de-prevention-exemple.pdf', await buildPdf(PDF_EXAMPLE)],
  ['plan-de-prevention-exemple.docx', buildDocx()],
];
for (const [name, bytes] of outputs) {
  writeFileSync(path.join(outDir, name), bytes);
  console.log(`samples/${name} · ${(bytes.length / 1024).toFixed(1)} Ko`);
}
