// Journal du serveur (PRD-10) : une entrée par ligne sur la sortie standard (debug, info) ou d'erreur (warn, error), lue par
// Docker, Coolify ou le superviseur de l'application Mac. Format JSON hors démonstration (horodatage, niveau, événement,
// message, champs), texte lisible en démonstration (VIGIE_LOG_FORMAT) ; niveau minimal VIGIE_LOG_LEVEL (info par défaut).
//
// Ce que le journal ne contient jamais : secret, jeton, cookie, mot de passe, clé (champs masqués d'après leur nom) ; donnée
// de santé ni contenu saisi (description, blessure, lésion… : champs masqués) ; adresse IP ou en-tête d'un signalement sans
// compte ou anonyme (SEC-09 : les appelants n'en passent pas, et `ip`, `adresse`, `user-agent` sont masqués par sécurité) ;
// paramètres d'URL (filtres de liste, jeton de poste : `path` est réduit à son chemin).
//
// Module sans 'server-only' ni dépendance vers la base : utilisable par instrumentation.ts, la base, les scripts et les tests.

import { ConfigError, readConfig, type LogFormat, type LogLevel } from './env';

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Clés dont la valeur n'est jamais écrite (secrets, données de santé, saisie libre, identification d'un client). */
const MASKED_KEY = /secret|password|passwd|mot.?de.?passe|token|jeton|cookie|authori[sz]ation|api.?key|cl[eé]$|^key$|signature|description|blessure|injur|l[eé]sion|sant[eé]|health|medic|m[eé]dical|soin|arr[eê]t|^ip$|^ips$|adresse.?ip|client.?ip|forwarded|user.?agent|^body$|contenu/i;
const MASK = '[masqué]';
const MAX_STRING = 500;
const MAX_STACK = 2000;

export type LogFields = Record<string, unknown>;
type Settings = { level: LogLevel; format: LogFormat };

let override: Partial<Settings> | null = null;
/** Réglages imposés (tests) ; null revient à la configuration. */
export function setLogSettings(s: Partial<Settings> | null) {
  override = s;
}

/** Réglages du journal : configuration validée, ou valeurs par défaut si elle est invalide (le journal ne lève jamais). */
function settings(): Settings {
  let base: Settings = { level: 'info', format: 'json' };
  try {
    base = readConfig().log;
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
  }
  return { ...base, ...override };
}

/** Chemin d'une URL ou d'un chemin de requête, sans paramètres ni fragment (`/evenements?blessure=…` → `/evenements`). */
export const pathOnly = (p: string) => p.split(/[?#]/)[0];

/** Adresses d'une chaîne sans identifiants (https://utilisateur:mot-de-passe@…) ni paramètres (?jeton=…). */
export const scrubUrls = (s: string) => s
  .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1…@')
  .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?…');

const clip = (s: string, max = MAX_STRING) => {
  const t = scrubUrls(s);
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/** Erreur → champs sûrs : nom, code, message tronqué (sans paramètres d'URL), pile tronquée. */
export function errorFields(err: unknown): LogFields {
  if (!(err instanceof Error)) return { message: clip(String(err)) };
  const e = err as Error & { code?: unknown; digest?: unknown };
  return {
    name: e.name,
    ...(typeof e.code === 'string' || typeof e.code === 'number' ? { code: e.code } : {}),
    ...(typeof e.digest === 'string' ? { digest: e.digest } : {}),
    message: clip(e.message),
    ...(e.stack ? { stack: clip(e.stack, MAX_STACK) } : {}),
  };
}

/** Valeur journalisable : masquée d'après sa clé, erreurs réduites, chaînes tronquées, profondeur limitée. */
export function sanitize(value: unknown, key = '', depth = 0): unknown {
  if (key && MASKED_KEY.test(key)) return value == null ? value : MASK;
  if (value instanceof Error) return errorFields(value);
  if (typeof value === 'string') return clip(key === 'path' || key === 'url' ? pathOnly(value) : value);
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= 3) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, '', depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([k, v]) => [k, sanitize(v, k, depth + 1)]));
  }
  return String(value);
}

/** Ligne du journal (pure, testée) : JSON ou texte. */
export function formatEntry(level: LogLevel, event: string, message: string, fields: LogFields, format: LogFormat, now = new Date()): string {
  const safe = sanitize(fields) as LogFields;
  if (format === 'json') return JSON.stringify({ time: now.toISOString(), level, app: 'vigie', event, msg: clip(message, 2000), ...safe });
  const extra = Object.entries(safe).filter(([k]) => k !== 'stack')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? (/\s/.test(v) ? JSON.stringify(v) : v) : JSON.stringify(v)}`).join(' ');
  const stack = typeof safe.stack === 'string' ? `\n${safe.stack}` : '';
  return `[vigie] ${level.toUpperCase()} ${event} : ${message}${extra ? ` (${extra})` : ''}${stack}`;
}

function write(level: LogLevel, event: string, message: string, fields: LogFields = {}) {
  const s = settings();
  if (RANK[level] < RANK[s.level]) return;
  const line = formatEntry(level, event, message, fields, s.format);
  if (RANK[level] >= RANK.warn) process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

/**
 * Journal du serveur. `event` : nom stable, en points (`auth.login`, `upload.refused`…), pour filtrer dans l'outil de
 * l'hébergeur ; `message` : phrase en français, sans donnée saisie ; `fields` : contexte (identifiants techniques).
 */
export const log = {
  debug: (event: string, message: string, fields?: LogFields) => write('debug', event, message, fields),
  info: (event: string, message: string, fields?: LogFields) => write('info', event, message, fields),
  warn: (event: string, message: string, fields?: LogFields) => write('warn', event, message, fields),
  error: (event: string, message: string, fields?: LogFields) => write('error', event, message, fields),
};
