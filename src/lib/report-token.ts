// Jetons des QR codes de poste (EVT-07) : le QR code collé au poste ouvre /signaler?jeton=<jeton>, qui donne accès au
// formulaire de signalement sans compte. Module sans dépendance serveur ni base (tests, page, server action) ;
// la résolution du jeton (zone, site actif, version) est dans src/lib/data/report-posts.ts.
//
// Jeton : « <zoneId>.<version>.<signature> », signature = HMAC-SHA256(VIGIE_REPORT_SECRET, site, zone, version) tronquée
// à 132 bits (22 caractères base64url). Incrémenter map_zones.qr_version (« Régénérer le QR ») révoque les QR codes déjà
// imprimés ; changer VIGIE_REPORT_SECRET les révoque tous.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { REPORT_PATH, REPORT_TOKEN_PARAM } from './auth/paths';

/** Poste désigné par un jeton : zone du plan de site, son site et la version de son QR code. */
export type ReportPostRef = { siteId: string; zoneId: number; version: number };

const SIG_CHARS = 22;
const TOKEN = /^(\d{1,9})\.(\d{1,6})\.([A-Za-z0-9_-]{22})$/;

function signature(secret: string, ref: ReportPostRef): string {
  return createHmac('sha256', secret)
    .update(`vigie:poste:v1\n${ref.siteId}\n${ref.zoneId}\n${ref.version}`)
    .digest('base64url')
    .slice(0, SIG_CHARS);
}

/** Jeton signé du QR code d'un poste. */
export function signReportToken(secret: string, ref: ReportPostRef): string {
  return `${ref.zoneId}.${ref.version}.${signature(secret, ref)}`;
}

/** Zone et version annoncées par un jeton (non vérifiées), ou null si le jeton est mal formé. */
export function readReportToken(token: string | null | undefined): { zoneId: number; version: number } | null {
  const m = token ? TOKEN.exec(token) : null;
  if (!m) return null;
  const zoneId = Number(m[1]), version = Number(m[2]);
  return zoneId > 0 && version > 0 ? { zoneId, version } : null;
}

/** Vrai si le jeton est celui de ce poste dans cette version (comparaison à temps constant). */
export function reportTokenMatches(secret: string, token: string, ref: ReportPostRef): boolean {
  const parsed = readReportToken(token);
  if (!parsed || parsed.zoneId !== ref.zoneId || parsed.version !== ref.version) return false;
  const given = Buffer.from(token.slice(token.lastIndexOf('.') + 1));
  const expected = Buffer.from(signature(secret, ref));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Chemin encodé dans le QR code d'un poste. */
export const reportTokenPath = (token: string) => `${REPORT_PATH}?${REPORT_TOKEN_PARAM}=${encodeURIComponent(token)}`;

/**
 * État d'un QR code de poste d'après la zone qu'il désigne (EVT-19) : `invalid` (zone inconnue, site archivé, signature
 * fausse), `revoked` (étiquette remplacée par « Régénérer le QR » : version antérieure), `archived` (zone archivée de la
 * carte : le formulaire s'ouvre sur le site du poste, sans lieu, avec « ce poste n'existe plus, choisissez le lieu »),
 * sinon `ok`. La signature est contrôlée avant tout : un jeton falsifié n'apprend rien de la zone.
 */
export type ReportPostStatus = 'ok' | 'revoked' | 'archived' | 'invalid';
export function reportPostStatus(
  zone: { qrVersion: number; archived: boolean; siteArchived: boolean } | null,
  token: { version: number; signatureValid: boolean },
): ReportPostStatus {
  if (!zone || zone.siteArchived || !token.signatureValid) return 'invalid';
  if (token.version !== zone.qrVersion) return 'revoked';
  return zone.archived ? 'archived' : 'ok';
}
