import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, vi } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { cookieJar } from './next-mocks';
import { closeDb, getDb, schema as t } from '@/db';
import { resetConfig } from '@/lib/env';
import type { Role } from '@/lib/domain';

// Outils communs aux tests d'intégration des server actions (QUA-04) : base de démonstration neuve par fichier
// (PGlite en mémoire, ou PostgreSQL avec TEST_DATABASE_URL — test/setup-postgres.ts), rôle et site de la requête
// simulée, journal des modifications, fichiers joints. À importer après '../next-mocks' (lui-même en tête du fichier).

/** Date de référence du jeu de démonstration. */
export const DEMO_TODAY = '2026-10-09';

/**
 * Base de démonstration neuve pour le fichier de test : migrations et jeu de démonstration (VIGIE_DEMO=1), date figée,
 * pièces jointes dans un dossier temporaire supprimé à la fin. Renvoie le dossier des pièces jointes.
 */
export function freshDemoDatabase({ today = DEMO_TODAY }: { today?: string } = {}) {
  const uploads = mkdtempSync(path.join(tmpdir(), 'vigie-test-uploads-'));
  beforeAll(async () => {
    Object.assign(process.env, { VIGIE_DEMO: '1', VIGIE_DATA_DIR: 'memory://', VIGIE_TODAY: today, VIGIE_UPLOAD_DIR: uploads });
    resetConfig();
    cookieJar.clear();
    await closeDb();
    await getDb();
  });
  afterAll(async () => {
    cookieJar.clear();
    await closeDb();
    delete process.env.VIGIE_UPLOAD_DIR;
    resetConfig();
    rmSync(uploads, { recursive: true, force: true });
  });
  return uploads;
}

/**
 * Heure courante figée (Date seulement, l'horloge avance ensuite normalement) pour le fichier de test. En démonstration,
 * « maintenant » est la date figée du jour avec l'heure réelle (`referenceNow`) : un test qui saisit une heure du jour de
 * démonstration (soins à 15 h 15…) échouerait s'il tournait plus tôt dans la journée.
 */
export function freezeClock(iso: string) {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(iso));
  });
  afterAll(() => { vi.useRealTimers(); });
}

/** Rôle de démonstration (personne associée : src/lib/demo.ts) et site sélectionné de la requête simulée. */
export function actAs(role: Role, site = 'ville-a') {
  cookieJar.set('vigie_role', role);
  cookieJar.set('vigie_site', site);
}

/** Entrées du journal des modifications d'un élément, dans l'ordre d'écriture. */
export async function changeLog(entityType: string, entityId: string | number) {
  const db = await getDb();
  return db.select().from(t.changeLog)
    .where(and(eq(t.changeLog.entityType, entityType), eq(t.changeLog.entityId, String(entityId))))
    .orderBy(asc(t.changeLog.id));
}

/** Dernière entrée du journal d'un élément. */
export async function lastLog(entityType: string, entityId: string | number) {
  return (await changeLog(entityType, entityId)).at(-1);
}

/** Fichier joint (PDF par défaut). */
export const file = (name = 'exemplaire-signe.pdf', type = 'application/pdf', content = '%PDF-1.4 test') => new File([content], name, { type });

/** FormData à partir de champs texte et de fichiers (même nom de champ répété). */
export function formWith(fields: Record<string, string>, files: Record<string, File[]> = {}) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  Object.entries(files).forEach(([k, list]) => list.forEach((f) => fd.append(k, f, f.name)));
  return fd;
}
