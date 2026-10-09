import 'server-only';
import { cache } from 'react';
import { asc, desc } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { today } from '../dates';
import { ORIGINS, STEP_CLOSED, isOpenActionStatus } from '../domain';
import { currentSiteId, inSite } from '../session';

export type Option = readonly [value: string, label: string];

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Listes de choix partagées par les formulaires.
 * - people : personnes présentes à l'effectif (sorties exclues) ; un formulaire de modification qui affiche une personne
 *   sortie doit l'ajouter lui-même à la liste (voir `withCurrent`).
 * - sites : sites actifs (archivés exclus).
 * - events : événements du site sélectionné, ni clôturés ni classés sans suite (sélecteur « Événement lié »).
 * - actions : actions ouvertes du site sélectionné (ni clôturées ni annulées), pour LinkActionButton.
 */
export const loadFormOptions = cache(async () => {
  const db = await getDb();
  const now = today();
  const [people, sites, projects, events, actions, site] = await Promise.all([
    db.select().from(t.people).orderBy(asc(t.people.sort)),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
    db.select().from(t.keystoneProjects).orderBy(asc(t.keystoneProjects.id)),
    db.select({ id: t.events.id, title: t.events.title, siteId: t.events.siteId, step: t.events.step, dismissedAt: t.events.dismissedAt }).from(t.events).orderBy(desc(t.events.id)),
    db.select({ id: t.actions.id, title: t.actions.title, siteId: t.actions.siteId, status: t.actions.status }).from(t.actions),
    currentSiteId(),
  ]);
  return {
    people: people.filter((p) => !p.leftOn || p.leftOn > now).map((p) => [p.id, `${p.name} — ${p.job}`] as Option),
    sites: sites.filter((s) => !s.archivedAt).map((s) => [s.id, s.label] as Option),
    projects: projects.map((p) => [`${p.id} · ${p.client}`, `${p.id} · ${p.client} — ${p.title}`] as Option),
    origins: Object.entries(ORIGINS).map(([k, o]) => [k, o.label] as Option),
    events: events
      .filter((e) => !e.dismissedAt && e.step < STEP_CLOSED && inSite(site, e.siteId))
      .map((e) => [e.id, clip(`${e.id} · ${e.title}`)] as Option),
    actions: actions
      .filter((a) => isOpenActionStatus(a.status) && inSite(site, a.siteId))
      .sort((a, b) => b.id.localeCompare(a.id, 'fr', { numeric: true }))
      .map((a) => [a.id, clip(`${a.id} · ${a.title}`)] as Option),
  };
});
export type FormOptions = Awaited<ReturnType<typeof loadFormOptions>>;

/** Ajoute à une liste de choix la valeur déjà enregistrée si elle n'y figure plus (personne sortie, site archivé…). */
export const withCurrent = (options: readonly Option[], value: string | null | undefined, label: string | undefined) =>
  value && !options.some(([v]) => v === value) ? [...options, [value, label ?? value] as Option] : options;
