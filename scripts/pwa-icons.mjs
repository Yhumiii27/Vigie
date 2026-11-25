// Icônes du signalement installable (EVT-20) : le logo de Vigie de Norma 2.3 (norma/charte/logos/vigie.svg : tuile de
// 64 × 64 à coins arrondis, dégradé, motif blanc) rendu en PNG, sans dépendance ni accès réseau. Le SVG est lu (dégradé
// linéaire, rect à coins arrondis, cercle, chemin M/L/H/V/C/S/Z tracé à bouts et jonctions ronds) et chaque pixel est
// échantillonné 4 × 4 fois ; un élément ou un attribut non pris en charge arrête le script (un logo changé ne passe pas en
// silence). Sortie identique d'une exécution à l'autre. À relancer après un changement du logo dans Norma :
//   node scripts/pwa-icons.mjs
// Écrit public/pwa/ :
// - icon-192.png, icon-512.png (« any ») : la tuile telle quelle, coins transparents ;
// - icon-maskable-512.png (« maskable ») : fond plein de la couleur sombre du dégradé jusqu'aux bords, tuile réduite à
//   80 % au centre (motif dans la zone sûre) ;
// - apple-touch-icon.png (180 px) : opaque, tuile entière sur le même fond (iOS arrondit lui-même les coins) ;
// - icon.svg : copie du logo.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = path.resolve(import.meta.dirname, '../public/pwa');
const LOGO = path.resolve(import.meta.dirname, '../norma/charte/logos/vigie.svg');

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const nums = (s) => (s.match(NUM) ?? []).map(Number);
const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const rgb = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  if (/^#fff$/i.test(hex) || hex === 'white') return [255, 255, 255];
  throw new Error(`couleur non prise en charge : ${hex}`);
};

/** Chemin SVG → liste de polylignes (courbes de Bézier découpées en 32 segments). */
function polylines(d) {
  const out = [];
  let line = null, x = 0, y = 0, sx = 0, sy = 0, cx2 = null, cy2 = null;
  const tokens = [...d.matchAll(/([MmLlHhVvCcSsZz])([^MmLlHhVvCcSsZz]*)/g)];
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    for (let i = 1; i <= 32; i++) {
      const t = i / 32, s = 1 - t;
      line.push([s ** 3 * x + 3 * s * s * t * x1 + 3 * s * t * t * x2 + t ** 3 * x3, s ** 3 * y + 3 * s * s * t * y1 + 3 * s * t * t * y2 + t ** 3 * y3]);
    }
    cx2 = x2; cy2 = y2; x = x3; y = y3;
  };
  for (const [, cmd, args] of tokens) {
    const n = nums(args), rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = () => (rel ? x : 0), oy = () => (rel ? y : 0);
    if (C === 'Z') { line?.push([sx, sy]); x = sx; y = sy; cx2 = null; continue; }
    const step = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4 }[C];
    if (!n.length || n.length % step) throw new Error(`chemin mal formé : ${cmd}${args}`);
    for (let i = 0; i < n.length; i += step) {
      const a = n.slice(i, i + step);
      if (C === 'M' && i === 0) { x = a[0] + ox(); y = a[1] + oy(); sx = x; sy = y; line = [[x, y]]; out.push(line); cx2 = null; continue; }
      if (C === 'M' || C === 'L') { x = a[0] + ox(); y = a[1] + oy(); line.push([x, y]); cx2 = null; }
      else if (C === 'H') { x = a[0] + ox(); line.push([x, y]); cx2 = null; }
      else if (C === 'V') { y = a[0] + oy(); line.push([x, y]); cx2 = null; }
      else if (C === 'C') { const o = [ox(), oy()]; cubic(a[0] + o[0], a[1] + o[1], a[2] + o[0], a[3] + o[1], a[4] + o[0], a[5] + o[1]); }
      else if (C === 'S') {
        const o = [ox(), oy()], x1 = cx2 === null ? x : 2 * x - cx2, y1 = cy2 === null ? y : 2 * y - cy2;
        cubic(x1, y1, a[0] + o[0], a[1] + o[1], a[2] + o[0], a[3] + o[1]);
      }
    }
  }
  return out;
}

function distSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const inRounded = (px, py, x, y, w, h, r) => {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r), cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};

/**
 * Lit le logo : { size (côté du viewBox), dark (couleur la plus sombre du dégradé), layers }. Chaque calque a un test
 * `hit(x, y)` en unités du viewBox et une peinture `paint(x, y)` → [r, g, b, opacité].
 */
function readLogo(svg) {
  const vb = nums(/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '');
  if (vb.length !== 4 || vb[0] || vb[1] || vb[2] !== vb[3]) throw new Error('viewBox carré attendu (0 0 n n)');
  const size = vb[2];
  const gradients = new Map();
  for (const m of svg.matchAll(/<linearGradient\b([^>]*)>([\s\S]*?)<\/linearGradient>/g)) {
    const a = attrs(m[1]);
    if (a.gradientUnits && a.gradientUnits !== 'objectBoundingBox') throw new Error('dégradé : objectBoundingBox seulement');
    const stops = [...m[2].matchAll(/<stop\b([^>]*)\/?>/g)].map((s) => attrs(s[1])).map((s) => ({ at: Number(s.offset), color: rgb(s['stop-color']) }));
    gradients.set(a.id, { x1: Number(a.x1 ?? 0), y1: Number(a.y1 ?? 0), x2: Number(a.x2 ?? 1), y2: Number(a.y2 ?? 0), stops });
  }
  const paintOf = (value, opacity, bbox) => {
    const ref = /^url\(#([^)]+)\)$/.exec(value);
    if (!ref) { const c = rgb(value); return () => [...c, opacity]; }
    const g = gradients.get(ref[1]);
    if (!g) throw new Error(`dégradé inconnu : ${ref[1]}`);
    const [bx, by, bw, bh] = bbox, dx = g.x2 - g.x1, dy = g.y2 - g.y1, l = dx * dx + dy * dy;
    return (x, y) => {
      const u = (x - bx) / bw, v = (y - by) / bh;
      const t = Math.max(0, Math.min(1, ((u - g.x1) * dx + (v - g.y1) * dy) / l));
      let i = 0;
      while (i < g.stops.length - 1 && g.stops[i + 1].at < t) i++;
      const a = g.stops[i], b = g.stops[Math.min(i + 1, g.stops.length - 1)];
      const k = b.at > a.at ? Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at))) : 0;
      return [0, 1, 2].map((c) => a.color[c] + (b.color[c] - a.color[c]) * k).concat(opacity);
    };
  };
  const layers = [];
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  for (const m of body.matchAll(/<(\w+)\b([^>]*?)\/?>/g)) {
    const [, tag, raw] = m;
    if (tag === 'svg' || tag === 'title') continue;
    const a = attrs(raw), fill = a.fill ?? '#000', stroke = a.stroke ?? 'none';
    const opacity = Number(a.opacity ?? 1), sw = Number(a['stroke-width'] ?? 1);
    for (const k of Object.keys(a)) {
      if (!['x', 'y', 'width', 'height', 'rx', 'cx', 'cy', 'r', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-opacity', 'fill-opacity', 'opacity', 'stroke-linecap', 'stroke-linejoin'].includes(k)) throw new Error(`attribut non pris en charge : ${tag} ${k}`);
    }
    if (tag === 'path' && fill !== 'none') throw new Error('chemin rempli non pris en charge');
    if (tag === 'path' && (a['stroke-linecap'] !== 'round' || a['stroke-linejoin'] !== 'round')) throw new Error('trait à bouts et jonctions ronds attendu');
    let fillHit = null, strokeHit = null, bbox;
    if (tag === 'rect') {
      const x = Number(a.x ?? 0), y = Number(a.y ?? 0), w = Number(a.width), h = Number(a.height), r = Number(a.rx ?? 0);
      bbox = [x, y, w, h];
      fillHit = (px, py) => inRounded(px, py, x, y, w, h, r);
      strokeHit = (px, py) => inRounded(px, py, x - sw / 2, y - sw / 2, w + sw, h + sw, r + sw / 2) && !inRounded(px, py, x + sw / 2, y + sw / 2, w - sw, h - sw, Math.max(0, r - sw / 2));
    } else if (tag === 'circle') {
      const cx = Number(a.cx), cy = Number(a.cy), r = Number(a.r);
      bbox = [cx - r, cy - r, 2 * r, 2 * r];
      fillHit = (px, py) => Math.hypot(px - cx, py - cy) <= r;
      strokeHit = (px, py) => Math.abs(Math.hypot(px - cx, py - cy) - r) <= sw / 2;
    } else if (tag === 'path') {
      const lines = polylines(a.d), pts = lines.flat();
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs) || 1, Math.max(...ys) - Math.min(...ys) || 1];
      const segs = lines.flatMap((l) => (l.length === 1 ? [[l[0], l[0]]] : l.slice(1).map((p, i) => [l[i], p])));
      const h = sw / 2, [x0, y0] = [bbox[0] - h, bbox[1] - h], [x1, y1] = [bbox[0] + bbox[2] + h, bbox[1] + bbox[3] + h];
      // Boîte de chaque segment élargie du demi-trait : le calcul de distance n'est fait que près du segment.
      const boxes = segs.map(([p, q]) => [Math.min(p[0], q[0]) - h, Math.min(p[1], q[1]) - h, Math.max(p[0], q[0]) + h, Math.max(p[1], q[1]) + h, p, q]);
      strokeHit = (px, py) => px >= x0 && px <= x1 && py >= y0 && py <= y1
        && boxes.some(([bx0, by0, bx1, by1, p, q]) => px >= bx0 && px <= bx1 && py >= by0 && py <= by1 && distSegment(px, py, p, q) <= h);
    } else throw new Error(`élément non pris en charge : <${tag}>`);
    if (fill !== 'none') layers.push({ hit: fillHit, paint: paintOf(fill, opacity * Number(a['fill-opacity'] ?? 1), bbox) });
    if (stroke !== 'none') layers.push({ hit: strokeHit, paint: paintOf(stroke, opacity * Number(a['stroke-opacity'] ?? 1), bbox) });
  }
  const colors = [...gradients.values()].flatMap((g) => g.stops.map((s) => s.color));
  if (!colors.length) throw new Error('dégradé attendu');
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const dark = colors.reduce((d, c) => (lum(c) < lum(d) ? c : d));
  return { size, dark, layers };
}

/**
 * Pixels RGBA (non prémultipliés) d'une icône de `px` pixels : le logo réduit à `scale` du côté, centré, sur un fond
 * plein de `background` (couleur) ou transparent (null).
 */
function rasterize(logo, px, { scale = 1, background = null } = {}) {
  const N = 4, out = new Uint8Array(px * px * 4), half = logo.size / 2;
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < N; sj++) {
        for (let si = 0; si < N; si++) {
          const x = half + (((i + (si + 0.5) / N) / px) * logo.size - half) / scale;
          const y = half + (((j + (sj + 0.5) / N) / px) * logo.size - half) / scale;
          // Composition « source-over », en couleurs prémultipliées.
          let cr = 0, cg = 0, cb = 0, ca = 0;
          if (background) { [cr, cg, cb] = background; ca = 1; }
          for (const l of logo.layers) {
            if (!l.hit(x, y)) continue;
            const [pr, pg, pb, po] = l.paint(x, y);
            cr = pr * po + cr * (1 - po); cg = pg * po + cg * (1 - po); cb = pb * po + cb * (1 - po); ca = po + ca * (1 - po);
          }
          r += cr; g += cg; b += cb; a += ca;
        }
      }
      const k = (j * px + i) * 4;
      if (a) { out[k] = Math.round(r / a); out[k + 1] = Math.round(g / a); out[k + 2] = Math.round(b / a); }
      out[k + 3] = Math.round((a / (N * N)) * 255);
    }
  }
  return out;
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
/** PNG RGBA 8 bits, lignes sans filtre, compressées par zlib. */
function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) Buffer.from(rgba.buffer, j * size * 4, size * 4).copy(raw, j * (size * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8 bits, RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const svg = readFileSync(LOGO, 'utf8');
const logo = readLogo(svg);
const full = { scale: 1, background: logo.dark };
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, 'icon-192.png'), png(192, rasterize(logo, 192)));
writeFileSync(path.join(OUT, 'icon-512.png'), png(512, rasterize(logo, 512)));
writeFileSync(path.join(OUT, 'icon-maskable-512.png'), png(512, rasterize(logo, 512, { scale: 0.8, background: logo.dark })));
writeFileSync(path.join(OUT, 'apple-touch-icon.png'), png(180, rasterize(logo, 180, full)));
writeFileSync(path.join(OUT, 'icon.svg'), svg.endsWith('\n') ? svg : `${svg}\n`);
console.log(`Icônes écrites dans ${path.relative(process.cwd(), OUT)}/`);
