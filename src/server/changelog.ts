import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { currentPersonId } from '@/lib/session';

// Journal des modifications (table change_log) : appelé par les server actions des fiches principales.
// Pas de 'use server' : ce module n'expose aucune action appelable depuis le navigateur.

/**
 * Champ modifié, pour le détail d'une entrée « update » (valeurs déjà mises en forme pour l'affichage). `fromKey` /
 * `toKey` : clés stockées correspondantes quand le libellé ne suffit pas à les retrouver (avancement d'une action, D11 :
 * journal structuré lu par les statistiques ACT-29 ; reprise 0005).
 */
export type ChangeDetail = { field: string; from: string | null; to: string | null; fromKey?: string | null; toKey?: string | null };

export type ChangeInput = {
  /** event | action | risk | work_unit | duerp_version | requirement | control | control_record | prevention_plan | permit
   * | contractor | qualification | training_title | person | audit_plan_item | certification | audit_finding | review
   * | review_item | document | waste_entry | site | benign_accident (id) | duerp_access_request (id)
   * | prevention_program (String(year))… */
  entityType: string;
  entityId: string | number;
  /** create | update | status | cancel | archive | restore | link | unlink | delete | … (libre, court) */
  action: string;
  /** Phrase affichée dans l'historique (« Échéance reportée au 20/10 », « Action annulée »). */
  summary: string;
  /** Motif saisi (annulation, archivage, réouverture, classement sans suite…). */
  reason?: string | null;
  details?: ChangeDetail[];
  /** Auteur (people.id) ; par défaut la personne connectée. */
  byId?: string | null;
};

/**
 * Ajoute une entrée au journal. À appeler dans la même transaction que la modification quand il y en a une :
 * `await logChange(tx, { entityType: 'action', entityId: id, action: 'cancel', summary: 'Action annulée', reason })`.
 */
export async function logChange(db: DbOrTx | null, entry: ChangeInput): Promise<void> {
  const byId = entry.byId !== undefined ? entry.byId : await currentPersonId();
  await (db ?? (await getDb())).insert(t.changeLog).values({
    entityType: entry.entityType,
    entityId: String(entry.entityId),
    action: entry.action,
    summary: entry.summary,
    reason: entry.reason ?? null,
    details: entry.details?.length ? entry.details : null,
    byId,
  });
}

/**
 * Identifiants déjà journalisés pour un type d'entité, fiches supprimées comprises (brouillons) : à joindre aux
 * identifiants existants avant nextRef, pour ne jamais réattribuer la référence d'une fiche supprimée (son historique la suit).
 */
export async function loggedIds(db: DbOrTx, entityType: string): Promise<string[]> {
  const rows = await db.selectDistinct({ id: t.changeLog.entityId }).from(t.changeLog).where(eq(t.changeLog.entityType, entityType));
  return rows.map((r) => r.id);
}

/** Champs modifiés entre deux états (comparaison des valeurs affichées) ; `labels` donne le libellé de chaque champ suivi. */
export function diffFields<T extends Record<string, unknown>>(before: T, after: Partial<T>, labels: Partial<Record<keyof T, string>>, fmt: (v: unknown) => string | null = (v) => (v == null || v === '' ? null : String(v))): ChangeDetail[] {
  return (Object.keys(labels) as (keyof T)[])
    .filter((k) => k in after && fmt(before[k]) !== fmt(after[k]))
    .map((k) => ({ field: labels[k]!, from: fmt(before[k]), to: fmt(after[k]) }));
}
