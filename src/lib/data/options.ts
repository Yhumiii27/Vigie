import 'server-only';
import { cache } from 'react';
import { asc } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { ORIGINS } from '../domain';

export type Option = readonly [value: string, label: string];

/** Listes de choix partagées par les formulaires (personnes, sites, projets Keystone, origines). */
export const loadFormOptions = cache(async () => {
  const db = await getDb();
  const [people, sites, projects] = await Promise.all([
    db.select().from(t.people).orderBy(asc(t.people.sort)),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
    db.select().from(t.keystoneProjects).orderBy(asc(t.keystoneProjects.id)),
  ]);
  return {
    people: people.map((p) => [p.id, `${p.name} — ${p.job}`] as Option),
    sites: sites.map((s) => [s.id, s.label] as Option),
    projects: projects.map((p) => [`${p.id} · ${p.client}`, `${p.id} · ${p.client} — ${p.title}`] as Option),
    origins: Object.entries(ORIGINS).map(([k, o]) => [k, o.label] as Option),
  };
});
export type FormOptions = Awaited<ReturnType<typeof loadFormOptions>>;
