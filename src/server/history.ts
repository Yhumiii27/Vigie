'use server';

import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { ChangeEntry } from '@/components/ChangeLog';
import { loadChangeLog } from '@/lib/data/changelog';
import { canSee, type ScreenKey } from '@/lib/domain';
import { getSession, siteFilter } from '@/lib/session';

// Historique d'une fiche chargé à son ouverture (QUA-11 ; composant LazyChangeLog) plutôt qu'avec toute la liste de
// l'écran. Lecture seule, aucun journal. Mêmes droits que la page qui affichait l'historique : écran ouvert au rôle
// (canSee) et fiche visible sur le site sélectionné (siteFilter('site') : site sélectionné, « Tous les sites » = périmètre)
// quand elle porte un site ; exigences et entreprises extérieures : communes à l'entreprise. Fiche introuvable ou
// invisible : même réponse, sans rien révéler.

export type HistoryEntity = 'requirement' | 'control' | 'prevention_plan' | 'contractor';

type Rule = { screen: ScreenKey; siteOf(id: string): Promise<{ siteId: string | null } | undefined> };

const num = (id: string) => (/^\d{1,9}$/.test(id) ? Number(id) : null);

const RULES: Record<HistoryEntity, Rule> = {
  requirement: {
    screen: 'watch',
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [r] = await (await getDb()).select({ id: t.requirements.id }).from(t.requirements).where(eq(t.requirements.id, n));
      return r && { siteId: null };
    },
  },
  control: {
    screen: 'watch',
    async siteOf(id) {
      const n = num(id);
      if (n === null) return undefined;
      const [c] = await (await getDb()).select({ siteId: t.controls.siteId }).from(t.controls).where(eq(t.controls.id, n));
      return c;
    },
  },
  prevention_plan: {
    screen: 'prevention',
    async siteOf(id) {
      const [p] = await (await getDb()).select({ siteId: t.preventionPlans.siteId }).from(t.preventionPlans).where(eq(t.preventionPlans.id, id));
      return p;
    },
  },
  contractor: {
    screen: 'prevention',
    async siteOf(id) {
      const [c] = await (await getDb()).select({ id: t.contractors.id }).from(t.contractors).where(eq(t.contractors.id, id));
      return c && { siteId: null };
    },
  },
};

const NOT_FOUND = 'Historique introuvable.';

/** Historique (les entrées les plus récentes d'abord) d'une fiche que la personne connectée peut lire. */
export async function loadEntityHistory(entity: HistoryEntity, id: string): Promise<{ entries: ChangeEntry[] } | { error: string }> {
  const rule = typeof entity === 'string' && Object.hasOwn(RULES, entity) ? RULES[entity] : undefined;
  if (!rule || typeof id !== 'string' || !id || id.length > 64) return { error: NOT_FOUND };
  const { role } = await getSession();
  if (!canSee(role, rule.screen)) return { error: NOT_FOUND };
  const row = await rule.siteOf(id);
  if (!row || !(await siteFilter('site'))(row.siteId)) return { error: NOT_FOUND };
  return { entries: await loadChangeLog(entity, id) };
}
