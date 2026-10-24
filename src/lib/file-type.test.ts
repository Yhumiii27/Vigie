import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { OOXML_TYPES, asciiFileName, detectFileType, isInlineType, safeFileName, sniffImage, stripImageMetadata } from './file-type';

const bytes = (...parts: (number[] | string | Uint8Array)[]) => {
  const arr = parts.map((p) => (typeof p === 'string' ? strToU8(p, true) : p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arr.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of arr) { out.set(a, o); o += a.length; }
  return out;
};
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u16be = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const has = (hay: Uint8Array, needle: string) => Buffer.from(hay).includes(Buffer.from(needle, 'latin1'));

const GPS = 'GPS 48.8566N 2.3522E iPhone de Jean';

function jpeg() {
  const seg = (marker: number, payload: Uint8Array | number[] | string) => {
    const body = bytes(payload);
    return bytes([0xff, marker], u16be(body.length + 2), body);
  };
  return bytes([0xff, 0xd8], seg(0xe0, 'JFIF\0\x01\x01'), seg(0xe1, `Exif\0\0${GPS}`), seg(0xe2, 'ICC_PROFILE\0profil'),
    seg(0xfe, 'commentaire de Jean'), seg(0xdb, [0, 1, 2, 3]), seg(0xda, [0, 1, 2]), [0x12, 0x34, 0xff, 0x00, 0x56], [0xff, 0xd9]);
}
const pngChunk = (type: string, data: string) => bytes(u32be(data.length), type, data, [0, 0, 0, 0]);
const png = () => bytes([0x89], 'PNG\r\n\x1a\n', pngChunk('IHDR', '0123456789abc'), pngChunk('tEXt', `Author\0${GPS}`), pngChunk('eXIf', GPS), pngChunk('IDAT', 'xx'), pngChunk('IEND', ''));
function webp() {
  const chunk = (type: string, data: Uint8Array) => bytes(type, u32le(data.length), data, data.length % 2 ? [0] : []);
  const body = bytes('WEBP', chunk('VP8X', Uint8Array.from([0x0c, 0, 0, 0, 1, 0, 0, 1, 0, 0])), chunk('VP8L', strToU8('image')), chunk('EXIF', strToU8(GPS, true)), chunk('XMP ', strToU8('<x:xmpmeta>auteur</x:xmpmeta>')));
  return bytes('RIFF', u32le(body.length), body);
}
const gif = () => bytes('GIF89a', [1, 0, 1, 0, 0, 0, 0], [0x21, 0xfe, 8], 'Jean GPS', [0], [0x21, 0xff, 11], 'XMP DataXMP', [5], 'metas', [0],
  [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0], [0x3b]);

/** HEIC minimal : ftyp, meta (iinf : élément 1 image, élément 2 Exif ; iloc v0), mdat avec les données de l'élément Exif. */
function heic() {
  const box = (type: string, ...content: (number[] | string | Uint8Array)[]) => {
    const body = bytes(...content);
    return bytes(u32be(body.length + 8), type, body);
  };
  const infe = (id: number, type: string) => box('infe', [2, 0, 0, 0], u16be(id), [0, 0], type, 'nom\0');
  const ftyp = box('ftyp', 'heic', [0, 0, 0, 0], 'mif1heic');
  const exif = strToU8(`Exif\0\0${GPS}`, true);
  const build = (exifOffset: number) => {
    const iinf = box('iinf', [0, 0, 0, 0], u16be(2), infe(1, 'hvc1'), infe(2, 'Exif'));
    const iloc = box('iloc', [0, 0, 0, 0], [0x44, 0x00], u16be(1), u16be(2), u16be(0), u16be(1), u32be(exifOffset), u32be(exif.length));
    return box('meta', [0, 0, 0, 0], box('hdlr', [0, 0, 0, 0, 0, 0, 0, 0], 'pict', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), iinf, iloc);
  };
  const meta = build(0);
  const offset = ftyp.length + meta.length + 8;
  return bytes(ftyp, build(offset), box('mdat', exif, 'image'));
}

describe('type réel des fichiers (SEC-08)', () => {
  it('images : signature des octets, SVG jamais reconnu', () => {
    expect(sniffImage(jpeg())).toBe('image/jpeg');
    expect(sniffImage(png())).toBe('image/png');
    expect(sniffImage(webp())).toBe('image/webp');
    expect(sniffImage(gif())).toBe('image/gif');
    expect(sniffImage(heic())).toBe('image/heic');
    expect(sniffImage(strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
  });

  it('type annoncé rapproché du contenu', () => {
    expect(detectFileType(png(), 'image/jpeg')).toBe('image/png'); // image : le contenu l'emporte
    expect(detectFileType(png(), 'application/pdf')).toBeNull();
    expect(detectFileType(strToU8('%PDF-1.7\n…'), 'application/pdf')).toBe('application/pdf');
    expect(detectFileType(strToU8('<html><script>…</script></html>'), 'application/pdf')).toBeNull();
    expect(detectFileType(strToU8('<html><script>…</script></html>'), 'image/png')).toBeNull();
    expect(detectFileType(strToU8('date;quantité\n2026-10-01;3\n'), 'text/csv')).toBe('text/csv');
    expect(detectFileType(Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0]), 'text/plain')).toBeNull(); // exécutable
  });

  it('Office : parties de l’archive, macros refusées, anciens formats OLE selon le type annoncé', () => {
    const docx = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w:document/>') });
    const xlsx = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'xl/workbook.xml': strToU8('<workbook/>') });
    const docm = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w:document/>'), 'word/vbaProject.bin': strToU8('macro') });
    expect(detectFileType(docx, OOXML_TYPES.docx)).toBe(OOXML_TYPES.docx);
    expect(detectFileType(xlsx, OOXML_TYPES.xlsx)).toBe(OOXML_TYPES.xlsx);
    expect(detectFileType(xlsx, OOXML_TYPES.docx)).toBeNull();
    expect(detectFileType(docm, OOXML_TYPES.docx)).toBeNull();
    expect(detectFileType(zipSync({ 'a.txt': strToU8('x') }), OOXML_TYPES.docx)).toBeNull();
    const ole = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(detectFileType(ole, 'application/msword')).toBe('application/msword');
    expect(detectFileType(ole, 'application/pdf')).toBeNull();
  });

  it('noms de fichiers et affichage dans le navigateur', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('rapport‮fdp.exe"')).toBe('rapportfdp.exe');
    expect(safeFileName('  ')).toBe('fichier');
    expect(asciiFileName('Procès-verbal "signé".pdf')).toBe('Proces-verbal _signe_.pdf');
    expect(isInlineType('application/pdf')).toBe(true);
    expect(isInlineType('text/plain')).toBe(false);
    expect(isInlineType(OOXML_TYPES.docx)).toBe(false);
  });
});

describe('retrait des métadonnées des photos (SEC-09)', () => {
  it('JPEG : EXIF et commentaire retirés, profil ICC et données gardés', () => {
    const out = stripImageMetadata(jpeg(), 'image/jpeg')!;
    expect(has(out, GPS)).toBe(false);
    expect(has(out, 'commentaire')).toBe(false);
    expect(has(out, 'ICC_PROFILE')).toBe(true);
    expect(sniffImage(out)).toBe('image/jpeg');
    expect([...out.slice(-7)]).toEqual([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]);
  });
  it('PNG : textes et EXIF retirés', () => {
    const out = stripImageMetadata(png(), 'image/png')!;
    expect(has(out, GPS)).toBe(false);
    expect(has(out, 'IHDR') && has(out, 'IDAT') && has(out, 'IEND')).toBe(true);
  });
  it('WebP : EXIF et XMP retirés, indicateurs et taille RIFF à jour', () => {
    const out = stripImageMetadata(webp(), 'image/webp')!;
    expect(has(out, GPS) || has(out, 'auteur')).toBe(false);
    expect(out[20] & 0x0c).toBe(0); // indicateurs du VP8X
    expect(out[4] | (out[5] << 8) | (out[6] << 16)).toBe(out.length - 8);
  });
  it('GIF : commentaire et XMP retirés', () => {
    const out = stripImageMetadata(gif(), 'image/gif')!;
    expect(has(out, 'Jean') || has(out, 'XMP')).toBe(false);
    expect(out.at(-1)).toBe(0x3b);
  });
  it('HEIC : données de l’élément Exif effacées, structure inchangée', () => {
    const src = heic();
    const out = stripImageMetadata(src, 'image/heic')!;
    expect(out.length).toBe(src.length);
    expect(has(src, GPS)).toBe(true);
    expect(has(out, GPS)).toBe(false);
    expect(has(out, 'image')).toBe(true);
  });
  it('fichier mal formé ou format inconnu : null (photo refusée)', () => {
    expect(stripImageMetadata(jpeg().slice(0, 12), 'image/jpeg')).toBeNull();
    expect(stripImageMetadata(png(), 'image/svg+xml')).toBeNull();
  });
});
