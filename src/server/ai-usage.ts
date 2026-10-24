import 'server-only';
import { and, eq, gte, ne, sql } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { fromParisLocal, parisDay } from '@/lib/dates';
import { log } from '@/lib/log';

// Coût de la lecture des scans par l'API Claude (INT-06) : journal de consommation (table ai_usage, une ligne par appel),
// plafonds (lectures par personne sur 24 h, jetons de l'instance dans le mois civil, src/lib/env.ts : aiLimits) et cache
// en mémoire du résultat d'un même fichier (relancer la lecture, revenir à l'étape « Détection » : aucun nouvel appel).
// Sans activation (VIGIE_AI_IMPORT) ni identifiants, rien n'est appelé ni journalisé (src/lib/pp-import/ai.ts).

export type AiLimits = { dailyScansPerPerson: number; monthlyTokens: number };
export type AiUsageNumbers = { input: number; output: number; cacheCreation: number; cacheRead: number };
const FEATURE = 'pp_scan';

/** Jetons comptés par le plafond mensuel : entrée, sortie, écriture et lecture du cache. */
export const billedTokens = (u: AiUsageNumbers) => u.input + u.output + u.cacheCreation + u.cacheRead;

/** Début du mois civil de Paris contenant `now`. */
export const monthStart = (now: Date) => fromParisLocal(`${parisDay(now).slice(0, 7)}-01T00:00`) ?? now;

/** Consommation de l'instance dans le mois et lectures de la personne sur 24 h (appels réels, hors cache). */
export async function loadAiUsage(personId: string, now = new Date()) {
  const db = await getDb();
  const [month] = await db.select({
    calls: sql<number>`count(*) filter (where ${t.aiUsage.outcome} <> 'cache')`.mapWith(Number),
    tokens: sql<number>`coalesce(sum(${t.aiUsage.inputTokens} + ${t.aiUsage.outputTokens} + ${t.aiUsage.cacheCreationTokens} + ${t.aiUsage.cacheReadTokens}), 0)`.mapWith(Number),
  }).from(t.aiUsage).where(and(eq(t.aiUsage.feature, FEATURE), gte(t.aiUsage.at, monthStart(now))));
  const [day] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(t.aiUsage)
    .where(and(eq(t.aiUsage.feature, FEATURE), eq(t.aiUsage.personId, personId), ne(t.aiUsage.outcome, 'cache'), gte(t.aiUsage.at, new Date(now.getTime() - 24 * 3600_000))));
  return { monthCalls: month?.calls ?? 0, monthTokens: month?.tokens ?? 0, personDay: day?.n ?? 0 };
}

/** Motif de refus d'une nouvelle lecture (plafond atteint), ou null. Règle pure. */
export function aiQuotaProblem(usage: { monthTokens: number; personDay: number }, limits: AiLimits): string | null {
  if (usage.personDay >= limits.dailyScansPerPerson) {
    return `Plafond de ${limits.dailyScansPerPerson} lectures automatiques par personne sur 24 h atteint : saisissez le plan à partir du fichier, ou réessayez demain.`;
  }
  if (limits.monthlyTokens > 0 && usage.monthTokens >= limits.monthlyTokens) {
    return 'Plafond mensuel de consommation de la lecture automatique atteint (VIGIE_AI_MONTHLY_TOKENS) : saisissez le plan à partir du fichier, ou demandez à l’administrateur de relever le plafond.';
  }
  return null;
}

/** Appel posé avant la lecture (compté par les plafonds même s'il échoue) ; renvoie l'identifiant de la ligne. */
export async function startAiCall(personId: string, model: string, fileHash: string): Promise<number> {
  const db = await getDb();
  const [row] = await db.insert(t.aiUsage).values({ personId, feature: FEATURE, model, outcome: 'en_cours', fileHash }).returning({ id: t.aiUsage.id });
  return row.id;
}

/** Fin de l'appel : jetons (usage de la réponse), modèle qui a répondu, résultat, durée ; écrit aussi dans le journal du serveur. */
export async function finishAiCall(id: number, r: { outcome: 'ok' | 'refus' | 'erreur'; usage?: AiUsageNumbers; servedModel?: string | null; durationMs: number }) {
  const u = r.usage ?? { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  try {
    const db = await getDb();
    await db.update(t.aiUsage).set({
      outcome: r.outcome, servedModel: r.servedModel ?? null, durationMs: r.durationMs,
      inputTokens: u.input, outputTokens: u.output, cacheCreationTokens: u.cacheCreation, cacheReadTokens: u.cacheRead,
    }).where(eq(t.aiUsage.id, id));
  } catch (err) {
    log.error('ai.usage', "Consommation de l'API Claude non enregistrée", { usageId: id, error: err });
  }
  log.info('ai.call', "Lecture d'un scan par l'API Claude", { usageId: id, outcome: r.outcome, servedModel: r.servedModel ?? null, durationMs: r.durationMs, ...u });
}

/** Lecture servie par le cache (même fichier, même modèle d'import) : journalisée sans jeton, hors plafonds. */
export async function recordAiCacheHit(personId: string, model: string, fileHash: string) {
  const db = await getDb();
  await db.insert(t.aiUsage).values({ personId, feature: FEATURE, model, outcome: 'cache', fileHash, durationMs: 0 });
}

// ─── Cache des lectures (en mémoire, par processus) ──────────────────────────

const CACHE_TTL_MS = 3600_000;
const CACHE_MAX = 20;
type Cached<T> = { at: number; value: T };
const g = globalThis as unknown as { __vigieAiCache?: Map<string, Cached<unknown>> };
const cache = () => (g.__vigieAiCache ??= new Map());

/** Résultat d'une lecture déjà faite dans l'heure pour la même clé (empreinte du fichier, modèle, champs attendus). */
export function cachedScan<T>(key: string, now = Date.now()): T | null {
  const hit = cache().get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) { cache().delete(key); return null; }
  return hit.value as T;
}

export function rememberScan<T>(key: string, value: T, now = Date.now()) {
  const c = cache();
  c.delete(key);
  c.set(key, { at: now, value });
  while (c.size > CACHE_MAX) c.delete(c.keys().next().value!);
}

/** Vide le cache (tests). */
export const clearScanCache = () => cache().clear();
