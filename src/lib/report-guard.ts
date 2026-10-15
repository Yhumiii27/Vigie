import 'server-only';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { sql } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { RATE_LIMIT_RETENTION_MS, purgeExpiredRateLimits } from '@/db/maintenance';
import { config } from './config';

// Protections du signalement sans compte (EVT-07, formulaire public /signaler?jeton=…) : limite de débit en base
// (table report_rate_limits, partagée par toutes les instances), adresse du client, contrôle du contenu des photos.
// Le jeton du QR code de poste est vérifié par src/lib/data/report-posts.ts.

/**
 * Limites par fenêtre fixe :
 * - `ip` : tentatives par client (adresse IPv4, préfixe /64 en IPv6 ; un réseau de site peut partager la même), comptées
 *   avant la vérification du jeton (essais de jetons compris) ;
 * - `post` : signalements enregistrés par poste (QR code) et par client, comptés dans la transaction qui crée l'événement
 *   (une demande refusée ne consomme rien) ;
 * - `postTotal` : plafond d'un poste, tous clients confondus, pour la version actuelle de son QR code ; atteint, il est
 *   journalisé et signalé au responsable QHSE (QR code à régénérer s'il circule hors du site).
 */
export const REPORT_LIMITS = {
  ip: { max: 20, windowMinutes: 60 },
  post: { max: 10, windowMinutes: 60 },
  postTotal: { max: 60, windowMinutes: 60 },
} as const;
export type ReportLimitScope = keyof typeof REPORT_LIMITS;

/** Durée de conservation des compteurs : purgés à chaque passage et toutes les heures (src/db/maintenance.ts). */
export const REPORT_LIMIT_RETENTION_MS = RATE_LIMIT_RETENTION_MS;

/** Seize bits de chaque groupe d'une adresse IPv6 valide (forme abrégée « :: » et IPv4 finale « ::ffff:a.b.c.d » comprises). */
function ipv6Groups(addr: string): number[] {
  let s = addr.toLowerCase();
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    s = `${s.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const tl = tail ? tail.split(':') : [];
  const fill = tail !== undefined ? Array<string>(8 - h.length - tl.length).fill('0') : [];
  return [...h, ...fill, ...tl].map((g) => parseInt(g, 16));
}

/**
 * Client d'une entrée d'en-tête, sous une forme qui ne se démultiplie pas : port retiré (« 203.0.113.9:51234 »,
 * « [2001:db8::1]:51234 », ajouté par exemple par IIS ARR), IPv4 encapsulée déballée (« ::ffff:203.0.113.9 »), IPv6
 * réduite à son préfixe /64 (attribué à un seul abonné, qui dispose de toutes ses adresses). null si ce n'est pas une adresse.
 */
export function normalizeClientIp(raw: string): string | null {
  let s = raw.trim();
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(s);
  if (bracketed) s = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(s)) s = s.slice(0, s.lastIndexOf(':'));
  s = s.replace(/%[\w.-]*$/, ''); // identifiant de zone d'une adresse locale (fe80::1%eth0)
  const version = isIP(s);
  if (version === 4) return s;
  if (version !== 6) return null;
  const g = ipv6Groups(s);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff].join('.');
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

/**
 * Client d'une requête passée par `trustedProxies` reverse proxys de confiance (VIGIE_TRUSTED_PROXIES) : chaque proxy
 * ajoute en fin de X-Forwarded-For l'adresse qu'il a vue, l'entrée retenue est donc la N-ième en partant de la fin (celle
 * qu'a ajoutée le proxy le plus éloigné de Vigie) ; les entrées plus à gauche, fournies par le client, sont ignorées.
 * Un proxy qui remplace l'en-tête au lieu de le compléter (Caddy) compte pour 1 ; Next.js n'y met l'adresse de la
 * connexion que si l'en-tête est absent. Moins d'entrées que N : la plus à gauche. Sans l'en-tête : X-Real-IP.
 * Normalisée (normalizeClientIp) ; tout ce qui n'est pas une adresse partage le même compteur « inconnue ».
 */
export function clientIpFrom(headers: Headers, trustedProxies: number): string {
  const forwarded = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const raw = forwarded.length ? forwarded[Math.max(0, forwarded.length - trustedProxies)] : headers.get('x-real-ip')?.trim();
  return (raw && normalizeClientIp(raw)) || 'inconnue';
}

/** Client de la requête, selon le nombre de reverse proxys de confiance configuré (clientIpFrom). */
export const clientIp = (headers: Headers) => clientIpFrom(headers, config().trustedProxies);

/** Clé de compteur : valeur hachée (aucune adresse IP en clair dans la base), préfixée par sa nature. */
export const reportLimitKey = (scope: ReportLimitScope, value: string, secret: string) =>
  `${scope}:${createHmac('sha256', secret).update(`${scope}\n${value}`).digest('hex').slice(0, 32)}`;

/** Valeur comptée par `postTotal` : le poste et la version de son QR code (« Régénérer le QR » repart d'un compteur neuf). */
export const postTotalValue = (zoneId: number, version: number) => `${zoneId}.${version}`;

/**
 * Compte une tentative pour `value` (client, poste) dans la fenêtre courante ; renvoie le nombre de passages et false
 * dans `ok` si la limite est dépassée. Incrément atomique (INSERT … ON CONFLICT DO UPDATE), donc juste avec plusieurs
 * instances de Vigie. Avec `db` (transaction en cours), l'incrément est annulé avec elle ; sans, les compteurs de plus de
 * 24 h sont purgés au passage (hors transaction, pour ne pas y verrouiller la table).
 */
export async function countReportHit(scope: ReportLimitScope, value: string, secret: string, opts: { now?: Date; db?: DbOrTx } = {}) {
  const now = opts.now ?? new Date();
  const { max, windowMinutes } = REPORT_LIMITS[scope];
  const windowMs = windowMinutes * 60_000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const db = opts.db ?? (await getDb());
  if (!opts.db) await purgeExpiredRateLimits(db, now);
  const [row] = await db.insert(t.reportRateLimits)
    .values({ key: reportLimitKey(scope, value, secret), windowStart, hits: 1 })
    .onConflictDoUpdate({ target: [t.reportRateLimits.key, t.reportRateLimits.windowStart], set: { hits: sql`${t.reportRateLimits.hits} + 1` } })
    .returning({ hits: t.reportRateLimits.hits });
  return { hits: row.hits, max, ok: row.hits <= max };
}

/** Compte une tentative (voir countReportHit) ; renvoie false si la limite est dépassée. */
export async function hitReportLimit(scope: ReportLimitScope, value: string, secret: string, now = new Date()): Promise<boolean> {
  return (await countReportHit(scope, value, secret, { now })).ok;
}

/** Limite dépassée dans la transaction qui crée l'événement : levée pour l'annuler (compteurs compris). */
export class ReportLimitError extends Error {
  readonly scope: 'post' | 'postTotal';
  constructor(scope: 'post' | 'postTotal') {
    super(`Limite de signalements sans compte atteinte (${scope})`);
    this.scope = scope;
  }
}

/**
 * Dans la transaction qui crée le signalement sans compte : compte un signalement du poste pour ce client, puis pour le
 * poste (version actuelle du QR code). Lève ReportLimitError si une limite est dépassée (la transaction est annulée : rien
 * n'est consommé) ; renvoie `ceilingReached` quand ce signalement est le dernier admis par le plafond du poste.
 */
export async function countPostReport(tx: DbOrTx, post: { zoneId: number; version: number }, client: string, secret: string, now = new Date()) {
  const perClient = await countReportHit('post', `${post.zoneId}\n${client}`, secret, { now, db: tx });
  if (!perClient.ok) throw new ReportLimitError('post');
  const total = await countReportHit('postTotal', postTotalValue(post.zoneId, post.version), secret, { now, db: tx });
  if (!total.ok) throw new ReportLimitError('postTotal');
  return { ceilingReached: total.hits === total.max };
}

/**
 * Type d'image d'après les premiers octets du fichier (le type annoncé par le navigateur n'est pas fiable) :
 * JPEG, PNG, GIF, WebP, HEIC/HEIF ; null pour tout autre contenu.
 */
export function sniffImage(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif';
  }
  return null;
}

const PHOTO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
};

/**
 * Photo d'un signalement anonyme (SEC-09) : nom d'origine retiré (il peut désigner l'appareil ou la personne), remplacé
 * par « photo-<n>.<extension du type> » ; contenu et type conservés.
 */
export function anonymousPhoto(file: File, index: number): File {
  return new File([file], `photo-${index + 1}.${PHOTO_EXTENSIONS[file.type] ?? 'bin'}`, { type: file.type });
}

/** Photo du formulaire public : contenu contrôlé, type enregistré d'après le contenu ; null si ce n'est pas une image. */
export async function checkedPhoto(file: File): Promise<File | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  return type ? new File([bytes], file.name, { type, lastModified: file.lastModified }) : null;
}
