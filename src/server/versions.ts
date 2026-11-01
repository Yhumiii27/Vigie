import 'server-only';
import { and, eq, inArray, max } from 'drizzle-orm';
import { schema as t, type DbOrTx } from '@/db';

// Modifications simultanées (QUA-12) : contrôle de version optimiste des fiches éditées, sans colonne de version. Toute
// écriture d'une fiche est journalisée par logChange (change_log, dans la transaction de l'écriture) : le numéro de la
// dernière entrée du journal de la fiche en est la version. Le formulaire d'édition l'envoie (champ caché `version`,
// lu à l'ouverture de la fiche) ; la server action la compare dans sa transaction, avant d'écrire (verrou d'écriture sur le
// serveur, écritures sérialisées dans PGlite) : une fiche modifiée entre-temps n'est pas écrasée.

/** Champ caché du formulaire d'édition. */
export const VERSION_FIELD = 'version';

/** Message de refus : la fiche a changé depuis son ouverture. */
export const STALE_EDIT = "Cette fiche a été modifiée entre-temps par quelqu'un d'autre : fermez la fenêtre et rechargez la page pour voir la version à jour, puis refaites votre modification.";

/** Version d'une fiche : numéro de sa dernière entrée du journal des modifications (« 0 » sans entrée). */
export async function entityVersion(db: DbOrTx, entityType: string, entityId: string | number): Promise<string> {
  const [row] = await db.select({ v: max(t.changeLog.id) }).from(t.changeLog)
    .where(and(eq(t.changeLog.entityType, entityType), eq(t.changeLog.entityId, String(entityId))));
  return String(row?.v ?? 0);
}

/** Versions de plusieurs fiches d'un même type (listes éditables) : identifiant → version (« 0 » sans entrée). */
export async function entityVersions(db: DbOrTx, entityType: string, ids: readonly (string | number)[]): Promise<Map<string, string>> {
  const keys = [...new Set(ids.map(String))];
  if (!keys.length) return new Map();
  const rows = await db.select({ id: t.changeLog.entityId, v: max(t.changeLog.id) }).from(t.changeLog)
    .where(and(eq(t.changeLog.entityType, entityType), inArray(t.changeLog.entityId, keys))).groupBy(t.changeLog.entityId);
  const found = new Map(rows.map((r) => [r.id, String(r.v ?? 0)]));
  return new Map(keys.map((k) => [k, found.get(k) ?? '0']));
}

/**
 * STALE_EDIT si la version envoyée par le formulaire n'est plus celle de la fiche, sinon null. Formulaire sans version
 * (appel direct, ancienne page encore ouverte au déploiement) : pas de contrôle.
 */
export async function staleEditError(db: DbOrTx, entityType: string, entityId: string | number, submitted: FormDataEntryValue | null): Promise<string | null> {
  if (typeof submitted !== 'string' || !/^\d+$/.test(submitted)) return null;
  return (await entityVersion(db, entityType, entityId)) === submitted ? null : STALE_EDIT;
}

/** Erreur levée dans la transaction de l'écriture (l'annule) quand la fiche a changé. */
export class StaleEditError extends Error {
  constructor() {
    super(STALE_EDIT);
    this.name = 'StaleEditError';
  }
}

/** Dans la transaction de l'écriture : lève StaleEditError si la fiche a changé depuis l'ouverture du formulaire. */
export async function assertFresh(tx: DbOrTx, entityType: string, entityId: string | number, submitted: FormDataEntryValue | null) {
  if (await staleEditError(tx, entityType, entityId, submitted)) throw new StaleEditError();
}

/**
 * Écriture d'une fiche existante dont la transaction appelle assertFresh : STALE_EDIT si la fiche a changé depuis
 * l'ouverture du formulaire (rien n'est écrit), sinon null ; toute autre erreur est relancée.
 */
export async function freshWrite(write: () => Promise<unknown>): Promise<string | null> {
  try {
    await write();
    return null;
  } catch (err) {
    if (err instanceof StaleEditError) return STALE_EDIT;
    throw err;
  }
}
