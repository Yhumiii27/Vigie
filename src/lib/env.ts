// Configuration de Vigie : lecture et validation (zod) de toutes les variables d'environnement, en un seul endroit.
// Module sans 'server-only', pour proxy.ts, instrumentation.ts, les scripts et les tests ; le code applicatif
// passe par src/lib/config.ts (server-only). Aucun autre module ne lit process.env.
// Lecture paresseuse (premier appel de readConfig) : `next build` n'exige aucune variable de production.

import path from 'node:path';
import { z } from 'zod';
import type { Role } from './domain';

type Env = Record<string, string | undefined>;

/** Erreur de configuration : message en français, une ligne par variable à corriger. */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuration de Vigie invalide :\n${problems.map((p) => `- ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Variables transmises au SDK Anthropic (lecture des scans) : identifiants et dossier de configuration. */
export type AnthropicEnv = Readonly<Partial<Record<(typeof ANTHROPIC_KEYS)[number], string>>>;
const ANTHROPIC_KEYS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_IDENTITY_TOKEN_FILE',
  'ANTHROPIC_IDENTITY_TOKEN', 'ANTHROPIC_CONFIG_DIR', 'ANTHROPIC_PROFILE', 'APPDATA', 'XDG_CONFIG_HOME', 'HOME',
] as const;

/** Rôles applicatifs Entra ID (valeur de la revendication `roles`) par rôle Vigie, surchargeables par variable. */
export const ENTRA_ROLE_VARS: Record<Role, { env: string; fallback: string }> = {
  Direction: { env: 'ENTRA_ROLE_DIRECTION', fallback: 'Vigie.Direction' },
  'Animateur QHSE': { env: 'ENTRA_ROLE_ANIMATEUR_QHSE', fallback: 'Vigie.AnimateurQHSE' },
  'Chef de service': { env: 'ENTRA_ROLE_CHEF_SERVICE', fallback: 'Vigie.ChefService' },
  'Chef de projet': { env: 'ENTRA_ROLE_CHEF_PROJET', fallback: 'Vigie.ChefProjet' },
  Salarié: { env: 'ENTRA_ROLE_SALARIE', fallback: 'Vigie.Salarie' },
};

export type VigieConfig = {
  /** Mode démonstration (VIGIE_DEMO=1) : sélecteur de rôle, jeu de démonstration, VIGIE_TODAY, /apercu-mobile. */
  demo: boolean;
  /** Date de référence figée (AAAA-MM-JJ), démonstration seulement ; null = date du jour à Paris. */
  today: string | null;
  /** PostgreSQL (production) ; null = PGlite dans dataDir (démonstration, application Mac, tests). */
  databaseUrl: string | null;
  /** Dossier PGlite (absolu), ou « memory:// » pour une base en mémoire (tests). */
  dataDir: string;
  /** Pièces jointes (absolu). */
  uploadDir: string;
  /** Clé AES-256-GCM des pièces jointes et des sauvegardes (32 octets), null = fichiers en clair. */
  uploadKey: Buffer | null;
  /** Clé précédente, encore lue pendant une rotation (VIGIE_UPLOAD_KEY_PREVIOUS, puis npm run uploads:encrypt). */
  uploadKeyPrevious: Buffer | null;
  /** Sauvegardes (absolu). */
  backupDir: string;
  /** Sauvegarde automatique de la base avant d'appliquer une migration en attente (VIGIE_BACKUP_BEFORE_MIGRATE=0 : non). */
  backupBeforeMigrate: boolean;
  /** Origine publique (https://vigie.exemple.fr, sans « / » final) : QR codes, retour OIDC, hôtes admis. */
  publicUrl: string | null;
  /** Hôtes admis (en-tête Host, minuscules, port compris s'il est donné) : VIGIE_ALLOWED_HOSTS + hôte de publicUrl. */
  allowedHosts: string[];
  /** Secret du cookie de session Entra (≥ 32 caractères). */
  sessionSecret: string | null;
  /** Secret HMAC des jetons de poste (QR codes) ; en démonstration, repli sur un secret fixe. */
  reportSecret: string | null;
  /** Inscription de l'application Entra ID ; null tant que les trois variables ne sont pas renseignées. */
  entra: { tenantId: string; clientId: string; clientSecret: string; issuer: string } | null;
  /** Valeur du rôle applicatif Entra par rôle Vigie. */
  entraRoles: Record<Role, string>;
  /** Sites accordés par groupe Entra (VIGIE_SITE_GROUPS=groupObjectId:siteId,…). */
  siteGroups: { groupId: string; siteId: string }[];
  /**
   * Domaines de messagerie de l'entreprise (VIGIE_EMAIL_DOMAINS, minuscules, sans « @ ») : une première connexion ne
   * rapproche ou ne crée une fiche que par une adresse vérifiée (revendications email et xms_edov) de l'un d'eux.
   * Vide : toute première connexion est refusée (les comptes déjà associés se connectent toujours).
   */
  emailDomains: string[];
  /**
   * Reverse proxys de confiance devant Vigie (VIGIE_TRUSTED_PROXIES, 1 par défaut) : l'adresse du client est la
   * N-ième entrée de X-Forwarded-For en partant de la fin (src/lib/report-guard.ts).
   */
  trustedProxies: number;
  /** Lecture des scans par l'API Claude (VIGIE_AI_IMPORT=1). */
  aiImport: boolean;
  anthropicEnv: AnthropicEnv;
  /**
   * Tâches planifiées du serveur (PRD-12, src/db/scheduler.ts : rappel du mercredi par e-mail…), lancées à l'ouverture
   * de la base (VIGIE_SCHEDULER=0 : aucune ; la maintenance horaire, src/db/maintenance.ts, garde sa propre minuterie).
   */
  scheduler: boolean;
  /**
   * Transport des e-mails (ACT-33) : « fichier » = un fichier JSON par message dans mailDir, aucun envoi réel
   * (démonstration, recette) ; « aucun » = pas d'e-mail (défaut hors démonstration, en attendant le compte d'envoi ACT-34).
   */
  mailTransport: MailTransportKind;
  /** Dossier du transport « fichier » (absolu), jamais dans VIGIE_DATA_DIR. */
  mailDir: string;
  /** Expéditeur des e-mails (« Vigie <vigie@exemple.fr> » ou adresse seule). */
  mailFrom: string;
  /** Heure d'envoi du rappel du mercredi par e-mail (heure de Paris, 07:00 par défaut). */
  reminderTime: { hour: number; minute: number };
};

/** Transports d'e-mail disponibles (VIGIE_MAIL_TRANSPORT) ; SMTP ou Microsoft Graph : ACT-34. */
export const MAIL_TRANSPORTS = ['fichier', 'aucun'] as const;
export type MailTransportKind = (typeof MAIL_TRANSPORTS)[number];
/** Expéditeur par défaut (VIGIE_MAIL_FROM). */
export const DEFAULT_MAIL_FROM = 'Vigie <vigie@localhost>';

/** Secret HMAC des QR codes en démonstration (jeu de données local, sans valeur hors démonstration). */
const DEMO_REPORT_SECRET = 'vigie-demonstration-qr-codes-sans-valeur-en-production';
const SECRET_MIN = 32;

const blank = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);
const flag = z.enum(['1', 'true', 'yes', 'on', '0', 'false', 'no', 'off'], { error: 'valeur attendue : 1 ou 0' })
  .transform((v) => ['1', 'true', 'yes', 'on'].includes(v));
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'date attendue au format AAAA-MM-JJ' })
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), { error: 'date invalide' });
const origin = z.url({ protocol: /^https?$/, error: 'URL http(s) attendue' }).transform((v) => new URL(v))
  .refine((u) => u.pathname === '/' && !u.search && !u.hash, { error: "origine attendue, sans chemin (ex. https://vigie.exemple.fr)" })
  .transform((u) => u.origin);
/** Nom de domaine de messagerie (VIGIE_EMAIL_DOMAINS), en minuscules : au moins deux libellés. */
const EMAIL_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const secret = z.string().min(SECRET_MIN, { error: `au moins ${SECRET_MIN} caractères (ex. openssl rand -base64 48)` });
/** Adresse électronique simple (expéditeur) : sans espace, chevron ni retour à la ligne. */
const MAIL_ADDRESS = /^[^\s<>@"]+@[^\s<>@".]+(\.[^\s<>@".]+)*$/;
/** Expéditeur : « Nom <adresse> » ou adresse seule ; jamais de retour à la ligne (injection d'en-têtes). */
const sender = z.string().refine((v) => {
  const m = /^([^<>\r\n"]+?)\s*<([^<>]+)>$/.exec(v);
  return MAIL_ADDRESS.test(m ? m[2] : v);
}, { error: 'expéditeur attendu : « Nom <adresse@domaine> » ou adresse seule (ex. Vigie <vigie@epc2i.fr>)' });
/** Heure « HH:MM » (heure de Paris). */
const clockTime = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, { error: 'heure attendue au format HH:MM, de 00:00 à 23:59 (ex. 07:00)' })
  .transform((v) => ({ hour: Number(v.split(':')[0]), minute: Number(v.split(':')[1]) }));

/** Clé de 32 octets en base64 ou en hexadécimal. */
function decodeKey(v: string): Buffer | null {
  const hex = /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, 'hex') : null;
  const b64 = hex ?? (/^[A-Za-z0-9+/_-]+={0,2}$/.test(v) ? Buffer.from(v, 'base64') : null);
  return b64?.length === 32 ? b64 : null;
}

function absDir(value: string | undefined, fallback: string[]) {
  if (value?.startsWith('memory://')) return value;
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), value ?? path.join(...fallback));
}

type Reader = <T>(name: string, schema: z.ZodType<T>) => T | undefined;

/** Lecture d'une variable validée ; une valeur invalide ajoute une ligne à `problems`. */
function reader(env: Env, problems: string[]): Reader {
  return (name, schema) => {
    const raw = blank(env[name]);
    if (raw === undefined) return undefined;
    const r = schema.safeParse(raw);
    if (r.success) return r.data;
    problems.push(`${name} : ${r.error.issues.map((i) => i.message).join(', ')}`);
    return undefined;
  };
}

/** Stockage (base, pièces jointes, sauvegardes) : seule partie de la configuration lue par les scripts d'exploitation. */
export type StorageConfig = Pick<VigieConfig, 'databaseUrl' | 'dataDir' | 'uploadDir' | 'uploadKey' | 'uploadKeyPrevious' | 'backupDir' | 'backupBeforeMigrate'>;

function readStorage(env: Env, read: Reader, problems: string[]): StorageConfig {
  const key = (name: string) => {
    const raw = read(name, z.string());
    const k = raw === undefined ? null : decodeKey(raw);
    if (raw !== undefined && !k) problems.push(`${name} : clé de 32 octets attendue, en base64 ou en hexadécimal (ex. openssl rand -base64 32).`);
    return k;
  };
  const uploadKey = key('VIGIE_UPLOAD_KEY');
  const uploadKeyPrevious = key('VIGIE_UPLOAD_KEY_PREVIOUS');
  if (uploadKeyPrevious && !uploadKey) problems.push('VIGIE_UPLOAD_KEY_PREVIOUS : sans objet sans VIGIE_UPLOAD_KEY (nouvelle clé).');
  const databaseUrl = read('DATABASE_URL', z.string().regex(/^postgres(ql)?:\/\//, { error: 'URL postgres:// ou postgresql:// attendue' })) ?? null;
  const dataDir = absDir(blank(env.VIGIE_DATA_DIR), ['.data', 'vigie']);
  const uploadDir = absDir(blank(env.VIGIE_UPLOAD_DIR), ['.data', 'uploads']);
  const backupDir = absDir(blank(env.VIGIE_BACKUP_DIR), ['.data', 'backups']);
  // La restauration d'une base PGlite vide VIGIE_DATA_DIR : pièces jointes et sauvegardes jamais dans ce dossier.
  for (const [name, dir] of [['VIGIE_UPLOAD_DIR', uploadDir], ['VIGIE_BACKUP_DIR', backupDir]] as const) {
    if (isWithinDir(dataDir, dir)) {
      problems.push(`${name} : à placer hors de VIGIE_DATA_DIR (${dataDir}), dossier réservé à la base PGlite et vidé par sa restauration (ex. /data/db, /data/uploads, /data/backups).`);
    }
  }
  return {
    databaseUrl, dataDir, uploadDir, uploadKey, uploadKeyPrevious, backupDir,
    backupBeforeMigrate: read('VIGIE_BACKUP_BEFORE_MIGRATE', flag) ?? true,
  };
}

/** `dir` est `parent` ou se trouve dessous (chemins absolus ; une base en mémoire « memory:// » ne contient rien). */
export function isWithinDir(parent: string, dir: string): boolean {
  if (parent.startsWith('memory://') || dir.startsWith('memory://')) return false;
  const rel = path.relative(parent, dir);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Configuration du stockage seule (scripts db:backup, db:restore, uploads:encrypt…) : n'exige ni Entra ID ni adresse
 * publique ; lève ConfigError si une variable de stockage est invalide.
 */
export function parseStorageConfig(env: Env): StorageConfig {
  const problems: string[] = [];
  const storage = readStorage(env, reader(env, problems), problems);
  if (problems.length) throw new ConfigError(problems);
  return storage;
}

/** Lit et valide la configuration ; lève ConfigError en listant toutes les variables à corriger. */
export function parseConfig(env: Env): VigieConfig {
  const problems: string[] = [];
  const read = reader(env, problems);

  // L'application Mac (VIGIE_DESKTOP=1, posé par toutes ses versions) est toujours en démonstration, sauf VIGIE_DEMO=0.
  const demo = read('VIGIE_DEMO', flag) ?? read('VIGIE_DESKTOP', flag) ?? false;
  const today = read('VIGIE_TODAY', isoDay) ?? null;
  if (today && !demo) problems.push("VIGIE_TODAY : réservée à la démonstration (VIGIE_DEMO=1) ; à retirer en production.");

  const storage = readStorage(env, read, problems);
  const publicUrl = read('VIGIE_PUBLIC_URL', origin) ?? null;
  if (!publicUrl && !demo && blank(env.VIGIE_PUBLIC_URL) === undefined) problems.push("VIGIE_PUBLIC_URL : obligatoire hors démonstration (adresse publique de Vigie, ex. https://vigie.exemple.fr).");
  // SEC-05 : hors démonstration, HTTPS (cookies Secure, HSTS) ; http:// seulement pour un essai local.
  if (!demo && publicUrl?.startsWith('http://') && !isLoopbackHost(new URL(publicUrl).host)) {
    problems.push('VIGIE_PUBLIC_URL : https:// obligatoire hors démonstration (cookies Secure, HSTS) ; http:// admis pour localhost seulement (essai local).');
  }

  const hostList = read('VIGIE_ALLOWED_HOSTS', z.string().transform((v) => v.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean))
    .refine((l) => l.every((h) => /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d{1,5})?$/.test(h)), { error: 'liste d’hôtes attendue (hote[:port],…), sans schéma ni chemin' })) ?? [];
  const allowedHosts = [...new Set([...hostList, ...(publicUrl ? [new URL(publicUrl).host] : [])])];

  const sessionSecret = read('VIGIE_SESSION_SECRET', secret) ?? null;
  const reportSecret = read('VIGIE_REPORT_SECRET', secret) ?? (demo ? DEMO_REPORT_SECRET : null);

  const tenantId = read('ENTRA_TENANT_ID', z.string());
  const clientId = read('ENTRA_CLIENT_ID', z.string());
  const clientSecret = read('ENTRA_CLIENT_SECRET', z.string());
  // Émetteur de remplacement (cloud souverain, fournisseur OIDC de test) : http:// réservé à un fournisseur local.
  const issuerOverride = read('ENTRA_ISSUER', z.url({ protocol: /^https?$/, error: 'URL http(s) attendue' })
    .refine((v) => v.startsWith('https://') || isLoopbackHost(new URL(v).host), { error: 'http:// réservé à un fournisseur de test local (localhost, 127.0.0.1)' }));
  const entraParts = [tenantId, clientId, clientSecret].filter(Boolean).length;
  if (entraParts > 0 && entraParts < 3) problems.push('ENTRA_TENANT_ID, ENTRA_CLIENT_ID et ENTRA_CLIENT_SECRET : à renseigner ensemble.');
  const entra = tenantId && clientId && clientSecret
    ? { tenantId, clientId, clientSecret, issuer: (issuerOverride ?? `https://login.microsoftonline.com/${tenantId}/v2.0`).replace(/\/$/, '') }
    : null;
  const entraRoles = Object.fromEntries(
    (Object.entries(ENTRA_ROLE_VARS) as [Role, { env: string; fallback: string }][]).map(([role, v]) => [role, blank(env[v.env]) ?? v.fallback]),
  ) as Record<Role, string>;

  const siteGroups = read('VIGIE_SITE_GROUPS', z.string()
    .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split(':').map((s) => s.trim())))
    .refine((l) => l.every((p) => p.length === 2 && p[0] && p[1]), { error: 'liste attendue : groupObjectId:siteId,…' })
    .transform((l) => l.map(([groupId, siteId]) => ({ groupId, siteId })))) ?? [];

  const emailDomains = read('VIGIE_EMAIL_DOMAINS', z.string()
    .transform((v) => [...new Set(v.split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))])
    .refine((l) => l.length > 0 && l.every((d) => EMAIL_DOMAIN.test(d)), { error: 'liste de noms de domaine attendue (ex. epc2i.fr,epc2i.com)' })) ?? [];
  const trustedProxies = read('VIGIE_TRUSTED_PROXIES', z.string()
    .regex(/^\d+$/, { error: 'nombre entier attendu (1 par défaut)' })
    .transform(Number)
    .refine((n) => n >= 1 && n <= 10, { error: 'entre 1 et 10' })) ?? 1;

  const aiImport = read('VIGIE_AI_IMPORT', flag) ?? false;
  const anthropicEnv = Object.fromEntries(ANTHROPIC_KEYS.flatMap((k) => (env[k] ? [[k, env[k]]] : []))) as AnthropicEnv;

  // Tâches planifiées et e-mails (PRD-12, ACT-33). Transport « fichier » par défaut en démonstration seulement : hors
  // démonstration, aucun e-mail tant que le compte d'envoi de l'entreprise n'est pas branché (ACT-34).
  const scheduler = read('VIGIE_SCHEDULER', flag) ?? true;
  const mailTransport = read('VIGIE_MAIL_TRANSPORT', z.enum(MAIL_TRANSPORTS, { error: `valeur attendue : ${MAIL_TRANSPORTS.join(' ou ')} (SMTP et Microsoft Graph : à venir)` }))
    ?? (demo ? 'fichier' : 'aucun');
  const mailDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), blank(env.VIGIE_MAIL_DIR) ?? path.join('.data', 'mails'));
  if (isWithinDir(storage.dataDir, mailDir)) {
    problems.push(`VIGIE_MAIL_DIR : à placer hors de VIGIE_DATA_DIR (${storage.dataDir}), dossier réservé à la base PGlite et vidé par sa restauration (ex. /data/mails).`);
  }
  const mailFromValue = read('VIGIE_MAIL_FROM', sender) ?? DEFAULT_MAIL_FROM;
  const reminderTime = read('VIGIE_REMINDER_TIME', clockTime) ?? { hour: 7, minute: 0 };

  if (problems.length) throw new ConfigError(problems);
  return {
    demo, today, ...storage,
    publicUrl, allowedHosts, sessionSecret, reportSecret, entra, entraRoles, siteGroups, emailDomains, trustedProxies, aiImport, anthropicEnv,
    scheduler, mailTransport, mailDir, mailFrom: mailFromValue, reminderTime,
  };
}

// Mémorisée par instance du module (rechargée avec lui en développement, après une modification de .env.local).
let cached: VigieConfig | undefined;

/** Configuration du processus (process.env), validée au premier appel puis mémorisée. */
export function readConfig(): VigieConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

/** Oublie la configuration mémorisée (tests qui modifient process.env). */
export function resetConfig() {
  cached = undefined;
}

/** Variables qui manquent pour l'authentification Entra ID (page « Configuration incomplète »). */
export function entraMissing(c: VigieConfig = readConfig()): string[] {
  return [
    ...(c.entra ? [] : ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET']),
    ...(c.sessionSecret ? [] : ['VIGIE_SESSION_SECRET']),
    ...(c.publicUrl ? [] : ['VIGIE_PUBLIC_URL']),
  ];
}

/** Phase et moteur d'exécution de Next.js (instrumentation : rien à valider pendant `next build`). */
export const nextRuntime = () => ({ runtime: process.env.NEXT_RUNTIME, phase: process.env.NEXT_PHASE });

/** Environnement d'un outil externe (pg_dump, pg_restore) : celui du processus, plus `extra` (PGPASSWORD…). */
export const childProcessEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...process.env, ...extra });

/**
 * Construction pour l'image Docker (VIGIE_STANDALONE=1, posé par le Dockerfile) : sortie `standalone` de Next.js
 * (next.config.ts). Sans elle, `next build` reste celle de `next start` (npm start, démonstration, application Mac).
 */
export const standaloneBuild = () => process.env.VIGIE_STANDALONE === '1';

/** Serveur de développement (`next dev`) : la CSP y admet 'unsafe-eval' (débogage React) et le rechargement à chaud. */
export const isDevServer = () => process.env.NODE_ENV === 'development';

/**
 * Cookies « Secure » (et préfixe __Host-) dès que l'adresse publique est en HTTPS ; en HTTP local (démonstration,
 * application Mac, fournisseur de test), cookies sans Secure, que le navigateur refuserait sinon.
 */
export const secureCookies = (c: VigieConfig = readConfig()) => !!c.publicUrl?.startsWith('https://');

/** Hôte de bouclage (localhost, 127.0.0.1, ::1), port compris ou non. */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  const name = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.replace(/:\d+$/, '');
  return name === 'localhost' || name === '[::1]' || /^127(\.\d{1,3}){3}$/.test(name);
}
