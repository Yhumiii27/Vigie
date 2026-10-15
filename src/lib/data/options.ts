import 'server-only';
import { cache } from 'react';
import { asc } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { today } from '@/lib/today';
import { actionLabel } from '../action-rules';
import { isClosedActionStatus } from '../domain';
import { writableSites } from '../guard';
import { ALL_SITES, getSession, inPerimeter, inSite } from '../session';

import type { Option } from '../form-options';

// Option et withCurrent vivent dans src/lib/form-options.ts (sans server-only, utilisables par les composants client).
export { withCurrent, type Option } from '../form-options';

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Listes de choix partagées par les formulaires.
 * - people : personnes présentes à l'effectif (sorties exclues) ; un formulaire de modification qui affiche une personne
 *   sortie doit l'ajouter lui-même à la liste (voir `withCurrent`).
 * - sites : sites qu'accepte requireInSite pour une création ou un changement de site (writableSites, SEC-02, EVT-23) :
 *   le site sélectionné, ou sous « Tous les sites » les sites actifs du périmètre (archivés et hors périmètre exclus).
 *   Un enregistrement d'un autre site (ou d'un site archivé) garde son site affiché par son identifiant (`withCurrent`).
 * - allSites : le choix « Tous les sites » (élément commun à tous les sites) est admis — périmètre complet seulement.
 * - actions : actions du site sélectionné et du périmètre qui ne sont pas closes (ni Vérifiées ni Abandonnées,
 *   isClosedActionStatus), « A-n · libellé » (actionLabel du détail, 80 caractères au plus), pour LinkActionButton.
 * Les éléments liables du formulaire d'action (événements, constats, risques…) sont chargés par le plan lui-même
 * (loadActionTargets, src/lib/data/actions.ts) : plus de listes `origins` ni `events` ici.
 */
export const loadFormOptions = cache(async () => {
  const db = await getDb();
  const now = today();
  const [people, writable, projects, actions, session] = await Promise.all([
    db.select({ id: t.people.id, name: t.people.name, job: t.people.job, leftOn: t.people.leftOn }).from(t.people).orderBy(asc(t.people.sort)),
    writableSites(),
    db.select().from(t.keystoneProjects).orderBy(asc(t.keystoneProjects.id)),
    db.select({ id: t.actions.id, detail: t.actions.detail, siteId: t.actions.siteId, status: t.actions.status }).from(t.actions),
    getSession(),
  ]);
  const site = session.site.id === ALL_SITES ? null : session.site.id;
  // Défense en profondeur : le site sélectionné appartient déjà au périmètre, « Tous les sites » au périmètre complet.
  const visible = (siteId: string | null) => inSite(site, siteId) && inPerimeter(session.allowedSiteIds, siteId);
  return {
    people: people.filter((p) => !p.leftOn || p.leftOn > now).map((p) => [p.id, `${p.name} — ${p.job}`] as Option),
    sites: writable.sites.map((s) => [s.id, s.label] as Option),
    allSites: writable.allSites,
    projects: projects.map((p) => [`${p.id} · ${p.client}`, `${p.id} · ${p.client} — ${p.title}`] as Option),
    actions: actions
      .filter((a) => !isClosedActionStatus(a.status) && visible(a.siteId))
      .sort((a, b) => b.id.localeCompare(a.id, 'fr', { numeric: true }))
      .map((a) => [a.id, clip(`${a.id} · ${actionLabel(a.detail)}`)] as Option),
  };
});
export type FormOptions = Awaited<ReturnType<typeof loadFormOptions>>;
