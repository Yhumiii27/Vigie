import 'server-only';
import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/db';
import { FOREIGN_CONTRACTS } from '@/db/foreign';
import { log } from '@/lib/log';
import { SOURCES, type SourceKey } from './labels';

// Lecture d'une vue publiée par un autre outil (lot 0 de M-02, docs/specs/convergence-m02.md § 2.1). Seul src/lib/foreign/
// lit un autre schéma, par SELECT seulement (décision M-17 de Matrix). Disponibilité contrôlée à chaque lecture :
// vue absente (outil pas encore sur le serveur, lien retiré) ou lecture refusée (lien de lecture non accordé) → état
// « source indisponible », jamais une erreur de la page ; avertissement dans le journal du serveur (au plus une fois par
// source et par 10 minutes).

export type SourceRead<T> = { ok: true; rows: T[] } | { ok: false; status: 'unavailable' | 'error'; message: string };

const WARN_EVERY_MS = 10 * 60_000;
const warned = new Map<SourceKey, number>();

function warn(key: SourceKey, message: string, fields: Record<string, unknown> = {}) {
  const now = Date.now();
  if ((warned.get(key) ?? 0) > now - WARN_EVERY_MS) return;
  warned.set(key, now);
  log.warn('foreign.unavailable', message, { source: SOURCES[key].view, ...fields });
}

/** Vue présente et lisible par le rôle de la base ? (`to_regclass`, `has_table_privilege`, sans lever d'erreur.) */
export async function sourceState(db: DbOrTx, key: SourceKey): Promise<'ok' | 'absente' | 'refusee'> {
  const c = FOREIGN_CONTRACTS[key];
  const name = `${c.schema}.${c.view}`;
  const res = (await db.execute(sql`select case when to_regclass(${name}) is null then 'absente'
    when has_table_privilege(to_regclass(${name}), 'SELECT') then 'ok' else 'refusee' end as state`)) as unknown as { rows: { state: string }[] };
  return res.rows[0]?.state as 'ok' | 'absente' | 'refusee';
}

/** Lit une source : `read` n'est appelé que si la vue est présente et lisible ; toute erreur devient un état. */
export async function readSource<T>(db: DbOrTx, key: SourceKey, read: () => Promise<T[]>): Promise<SourceRead<T>> {
  try {
    const state = await sourceState(db, key);
    if (state !== 'ok') {
      const message = state === 'absente' ? `Vue ${SOURCES[key].view} absente` : `Lecture de ${SOURCES[key].view} refusée au rôle de Vigie`;
      warn(key, message, { state });
      return { ok: false, status: 'unavailable', message };
    }
    return { ok: true, rows: await read() };
  } catch (err) {
    warn(key, `Lecture de ${SOURCES[key].view} en erreur`, { error: err });
    return { ok: false, status: 'error', message: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) };
  }
}
