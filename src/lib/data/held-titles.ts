import 'server-only';
import { cache } from 'react';
import { isNotNull } from 'drizzle-orm';
import { getDb, schema as t, type DbOrTx } from '@/db';
import { readHeldTitles, type CursusHeldTitle } from '@/lib/foreign/cursus';
import { unavailableMessage } from '@/lib/foreign/labels';

// Titres détenus d'après Cursus (D09, décision CV-01 du 04/11/2026), rattachés aux personnes de Vigie par leur matricule
// (people.matricule) : base commune de la matrice, des alertes et échéances, de l'espace salarié, des données
// personnelles, des secouristes du registre des accidents bénins, des auditeurs internes, du bilan SSCT et des mesures de
// maîtrise « titre » du DUERP. Une personne sans matricule n'a aucun titre lu.
//
// Source indisponible (vue absente ou lecture refusée) : `ok: false` et le message du bandeau ; les lecteurs ne calculent
// alors aucune alerte qui dépend des titres détenus (jamais de fausse alerte « jamais suivi »), et l'écran le dit.

export type HeldTitle = CursusHeldTitle & { personId: string };

export type HeldTitles = {
  ok: boolean;
  /** Message « source indisponible » (bandeau, champ de formulaire), null si la source est lue. */
  message: string | null;
  /** Titre détenu par case « personne|titre ». */
  byCase: ReadonlyMap<string, HeldTitle>;
  list: readonly HeldTitle[];
};

/** Clé d'une case de la matrice (aussi clé du journal de l'exigence et des attestations reprises). */
export const caseKey = (personId: string, titleId: string) => `${personId}|${titleId}`;

/** Titres détenus rattachés aux personnes (sans contrôle de session : appelé aussi par les server actions). */
export async function readPeopleHeldTitles(db: DbOrTx): Promise<HeldTitles> {
  const [read, people] = await Promise.all([
    readHeldTitles(db),
    db.select({ id: t.people.id, matricule: t.people.matricule }).from(t.people).where(isNotNull(t.people.matricule)),
  ]);
  if (!read.ok) return { ok: false, message: unavailableMessage('heldTitles'), byCase: new Map(), list: [] };
  const byMatricule = new Map(people.map((p) => [p.matricule!, p.id]));
  const list = read.rows.flatMap((r) => {
    const personId = byMatricule.get(r.matricule);
    return personId ? [{ ...r, personId }] : [];
  });
  return { ok: true, message: null, byCase: new Map(list.map((h) => [caseKey(h.personId, h.titleId), h])), list };
}

/** Titres détenus de la requête. */
export const loadHeldTitles = cache(async () => readPeopleHeldTitles(await getDb()));
