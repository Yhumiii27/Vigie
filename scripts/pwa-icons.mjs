// Icônes du signalement installable (EVT-20) : PNG et SVG aux couleurs du design system Nocturne (fond --color-bg,
// accent --color-accent), sans dépendance ni accès réseau. À relancer après un changement de dessin :
//   node scripts/pwa-icons.mjs
// Écrit public/pwa/ : icon-192.png, icon-512.png (coins arrondis, « any »), icon-maskable-512.png (plein cadre, motif dans
// la zone sûre de 80 %), apple-touch-icon.png (180 px, plein cadre) et icon.svg.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = path.resolve(import.meta.dirname, '../public/pwa');
const BG = [0x16, 0x18, 0x26];
const ACCENT = [0x91, 0x84, 0xd9];

// Motif en coordonnées unitaires : triangle d'avertissement (accent) et point d'exclamation (fond).
const TRIANGLE = [[0.5, 0.2], [0.84, 0.78], [0.16, 0.78]];
const BAR = { x1: 0.465, x2: 0.535, y1: 0.4, y2: 0.62 };
const DOT = { cx: 0.5, cy: 0.69, r: 0.04 };

const inTriangle = (x, y, [a, b, c]) => {
  const s = (p, q) => (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1]);
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const inRounded = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** Couleur d'un point (null = transparent) ; `scale` réduit le motif autour du centre (icône masquable). */
function colorAt(x, y, { rounded, scale }) {
  if (rounded && !inRounded(x, y, 0.22)) return null;
  const u = 0.5 + (x - 0.5) / scale, v = 0.5 + (y - 0.5) / scale;
  const bar = u >= BAR.x1 && u <= BAR.x2 && v >= BAR.y1 && v <= BAR.y2;
  const dot = (u - DOT.cx) ** 2 + (v - DOT.cy) ** 2 <= DOT.r ** 2;
  if (inTriangle(u, v, TRIANGLE) && !bar && !dot) return ACCENT;
  return BG;
}

function render(size, opts) {
  const SS = 4; // suréchantillonnage 4 × 4 : bords lissés
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, opts);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a += 1;
        }
      }
      const o = 1 + px * 4;
      if (a) { row[o] = Math.round(r / a); row[o + 1] = Math.round(g / a); row[o + 2] = Math.round(b / a); }
      row[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
    rows.push(row);
  }
  return png(size, Buffer.concat(rows));
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8 bits, RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (c) => `#${c.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="113" fill="${hex(BG)}"/>
  <path d="${TRIANGLE.map(([x, y], i) => `${i ? 'L' : 'M'}${x * 512} ${y * 512}`).join(' ')} Z" fill="${hex(ACCENT)}"/>
  <rect x="${BAR.x1 * 512}" y="${BAR.y1 * 512}" width="${(BAR.x2 - BAR.x1) * 512}" height="${(BAR.y2 - BAR.y1) * 512}" fill="${hex(BG)}"/>
  <circle cx="${DOT.cx * 512}" cy="${DOT.cy * 512}" r="${DOT.r * 512}" fill="${hex(BG)}"/>
</svg>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'icon-192.png'), render(192, { rounded: true, scale: 1 }));
writeFileSync(path.join(OUT, 'icon-512.png'), render(512, { rounded: true, scale: 1 }));
writeFileSync(path.join(OUT, 'icon-maskable-512.png'), render(512, { rounded: false, scale: 0.78 }));
writeFileSync(path.join(OUT, 'apple-touch-icon.png'), render(180, { rounded: false, scale: 0.86 }));
writeFileSync(path.join(OUT, 'icon.svg'), svg);
console.log(`Icônes écrites dans ${path.relative(process.cwd(), OUT)}/`);
