import { count, eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';

// Outils communs des tests du flux A (écritures du plan d'actions QSE) : champs d'une nouvelle action, lecture d'une
// action, insertion brute d'une action de test (autre site, reprise…). À importer après '../next-mocks' et '../helpers'.
// Jeu de démonstration au 09/10/2026 : numéros jusqu'à A-222 (compteur 222) ; [C. Lefèvre] animatrice QHSE (seule
// personne « Animateur QHSE » de l'annuaire), [S. Benali] Chef de service, [T. Nguyen] Salarié (responsable de A-215).

/** Champs valides d'une nouvelle action sans élément lié (source libre, référence d'origine), site A. */
export const NEW_ACTION = {
  source: 'comex', originRef: 'COMEX du 08/10/2026', pilotId: 'sbenali', priority: 'moyen_terme', dueOn: '2026-11-15', domain: 'securite',
  problem: 'Problème constaté au COMEX.', detail: 'Mettre en place le suivi mensuel\nAvec un indicateur partagé.', verifyDueOn: '2026-12-01',
  siteId: 'ville-a', riskLevel: '', estimatedCost: '', actualCost: '',
} as const;

/** Une action du plan. */
export async function actionRow(id: string) {
  const [a] = await (await getDb()).select().from(t.actions).where(eq(t.actions.id, id));
  return a;
}

/** Nombre d'actions du plan. */
export async function actionCount() {
  return (await (await getDb()).select({ n: count() }).from(t.actions))[0].n;
}

/** Nombre d'entrées du journal (toutes entités). */
export async function logCount() {
  return (await (await getDb()).select({ n: count() }).from(t.changeLog))[0].n;
}

/** Notifications d'une personne (plus récentes en dernier). */
export async function notificationsOf(personId: string) {
  return (await getDb()).select().from(t.notifications).where(eq(t.notifications.personId, personId)).orderBy(t.notifications.id);
}

/** Insère une action de test (hors serveur) : valeurs complètes par défaut, site A, À faire. */
export async function insertAction(id: string, values: Partial<typeof t.actions.$inferInsert> = {}) {
  await (await getDb()).insert(t.actions).values({
    id, openedOn: '2026-10-01', pilotId: 'sbenali', status: 'a_faire', priority: 'moyen_terme', dueOn: '2026-11-30', initialDueOn: '2026-11-30',
    source: 'comex', originRef: 'COMEX de test', domain: 'securite', problem: 'Problème de test', detail: `Action de test ${id}`,
    verifyDueOn: '2026-12-15', siteId: 'ville-a', ...values,
  });
  return actionRow(id);
}

/** Formulaire de modification d'une action à partir de son état (valeurs actuelles), à surcharger. */
export function editFields(a: typeof t.actions.$inferSelect, extra: Record<string, string> = {}): Record<string, string> {
  const s = (v: unknown) => (v == null ? '' : String(v));
  return {
    id: a.id, from: a.status, source: s(a.source), pilotId: a.pilotId, priority: s(a.priority), dueOn: a.dueOn, domain: s(a.domain), problem: s(a.problem),
    detail: a.detail, verifyDueOn: s(a.verifyDueOn), riskLevel: s(a.riskLevel), estimatedCost: s(a.estimatedCost), actualCost: s(a.actualCost),
    siteId: s(a.siteId), doneOn: s(a.doneOn), verifyMethod: s(a.verifyMethod), efficacyNote: s(a.efficacyNote), hours: s(a.hours), ...extra,
  };
}
