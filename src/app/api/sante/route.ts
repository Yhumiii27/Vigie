import { sql } from 'drizzle-orm';
import { connection } from 'next/server';
import { getDb, getDbEngine } from '@/db';

// Route de santé (PRD-11) : sonde du conteneur (HEALTHCHECK du Dockerfile), du reverse proxy ou de la supervision.
// Ouverte sans session et depuis localhost (src/proxy.ts). 200 si la base répond, 503 sinon ; aucun détail interne.

const TIMEOUT_MS = 5000;

const json = (body: object, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET() {
  await connection();
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Premier appel : ouverture de la base (migrations, sauvegarde préalable éventuelle) ; ensuite, une requête simple.
    const check = (async () => {
      const db = await getDb();
      await db.execute(sql`select 1`);
      return getDbEngine();
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`pas de réponse en ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS);
    });
    const engine = await Promise.race([check, timeout]);
    return json({ statut: 'ok', base: engine, dureeMs: Date.now() - started }, 200);
  } catch (err) {
    console.error('[vigie] Route de santé : base indisponible :', err instanceof Error ? err.message : err);
    return json({ statut: 'erreur', base: 'indisponible' }, 503);
  } finally {
    clearTimeout(timer);
  }
}
