import 'server-only';
import { cache } from 'react';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { canApprove, canEdit, type TodoItem } from '@/lib/domain';
import { readCursusPeople } from '@/lib/foreign/cursus';
import { PERSON_CATEGORIES, SOURCES, unavailableMessage, type PersonCategory } from '@/lib/foreign/labels';
import { hasLeft, toAttach } from '@/lib/people';
import { getSession, siteFilter } from '@/lib/session';
import { today } from '@/lib/today';
import type { Option } from './options';
import { loadQhseLeads } from './leads';

// Personnes lues dans Cursus (D01 de Matrix, décision CV-10 du 03/11/2026) : vue « Personnel (Cursus) » de l'écran
// Habilitations (fiches à rattacher, fiches absentes de Cursus, dernier rafraîchissement) et échéances du QHSE.

/** Vue des fiches du personnel (`/habilitations?vue=personnel`). */
export const PEOPLE_VIEW_PATH = '/habilitations?vue=personnel';

export type PeopleAdminRow = { id: string; name: string; job: string; siteId: string | null; email: string | null; lastRole: string | null };
export type PeopleAdmin = {
  /** Fiches sans matricule (saisies avant D01 ou créées à la connexion Entra), à rattacher. */
  toAttach: PeopleAdminRow[];
  /** Fiches tenues par Cursus que sa vue ne publie plus (jamais supprimées). */
  absent: (PeopleAdminRow & { matricule: string; siteMatricule: string | null })[];
  /** Matricules proposés au rattachement : non portés par une fiche, ou portés par une fiche créée par le rafraîchissement. */
  choices: Option[];
  message: string | null;
  /** Dernier passage du rafraîchissement des personnes. */
  lastRun: { at: string; status: string; added: number; updated: number; removed: number } | null;
  counts: { cursus: number; interim: number; external: number };
};

/** Vue « Personnel (Cursus) » : QHSE et direction (rattachement), fiches du périmètre ; null pour les autres rôles. */
export async function loadPeopleAdmin(): Promise<PeopleAdmin | null> {
  const { role } = await getSession();
  if (!canApprove(role) || !canEdit(role, 'skills')) return null;
  const db = await getDb();
  const now = today();
  const [keep, people, read, runs, created] = await Promise.all([
    siteFilter('perimeter'),
    db.select({
      id: t.people.id, name: t.people.name, job: t.people.job, siteId: t.people.siteId, email: t.people.email, lastRole: t.people.lastRole,
      matricule: t.people.matricule, replacedById: t.people.replacedById, leftOn: t.people.leftOn, cursusState: t.people.cursusState,
      category: t.people.category, entraObjectId: t.people.entraObjectId, siteMatricule: t.people.siteMatricule,
    }).from(t.people).orderBy(asc(t.people.name)),
    readCursusPeople(db),
    db.select().from(t.syncRuns).where(eq(t.syncRuns.source, SOURCES.people.view)).orderBy(desc(t.syncRuns.startedAt), desc(t.syncRuns.id)).limit(1),
    // Fiches créées par le rafraîchissement (journal « create » sans auteur) : leur matricule reste proposé (attachPerson
    // vérifie qu'elles n'ont aucun historique propre).
    db.select({ id: t.changeLog.entityId }).from(t.changeLog).where(and(eq(t.changeLog.entityType, 'person'), eq(t.changeLog.action, 'create'), isNull(t.changeLog.byId))),
  ]);
  const bySync = new Set(created.map((c) => c.id));
  const row = (p: (typeof people)[number]): PeopleAdminRow => ({ id: p.id, name: p.name, job: p.job, siteId: p.siteId, email: p.email, lastRole: p.lastRole });
  const holders = new Map(people.filter((p) => p.matricule).map((p) => [p.matricule!, p]));
  const choices: Option[] = read.ok ? read.rows.filter((r) => {
    const h = holders.get(r.matricule);
    return !h || (bySync.has(h.id) && !h.entraObjectId);
  }).map((r) => [r.matricule, `${r.name} · ${r.matricule}${r.siteMatricule ? ` · ${r.siteMatricule}` : ''}${r.category ? ` · ${PERSON_CATEGORIES[r.category as PersonCategory].label.toLowerCase()}` : ''}${r.siteCode ? ` · ${r.siteCode}` : ''}`] as Option)
    .sort((a, b) => a[1].localeCompare(b[1], 'fr')) : [];
  const run = runs[0];
  const present = people.filter((p) => p.matricule && !hasLeft(p, now));
  return {
    toAttach: people.filter((p) => toAttach(p, now) && keep(p.siteId)).map(row),
    absent: people.filter((p) => p.matricule && p.cursusState === 'absent' && !hasLeft(p, now) && keep(p.siteId)).map((p) => ({ ...row(p), matricule: p.matricule!, siteMatricule: p.siteMatricule })),
    choices,
    message: read.ok ? null : unavailableMessage('people'),
    lastRun: run ? { at: (run.finishedAt ?? run.startedAt).toISOString(), status: run.status, added: run.added, updated: run.updated, removed: run.removed } : null,
    counts: {
      cursus: present.length,
      interim: present.filter((p) => p.category === 'interimaire').length,
      external: present.filter((p) => p.category === 'exterieur').length,
    },
  };
}

/**
 * Échéances des fiches du personnel (D01), au responsable QHSE du site (animateurs QHSE si le poste est vacant), pour le
 * QHSE et la direction seulement (seuls à rattacher) : fiche à rattacher (`personne-a-rattacher|<id>`), fiche que Cursus
 * ne publie plus (`cursus-personne-absente|<id>`), et une seule échéance commune quand la vue des personnes n'a pas pu être
 * lue au dernier rafraîchissement (`cursus-personnes-indisponible`). Clés stables (TDB-07) : sans date ni nom.
 */
export const loadPeopleSignals = cache(async (): Promise<{ todo: TodoItem[] }> => {
  const { role } = await getSession();
  if (!canApprove(role)) return { todo: [] };
  const db = await getDb();
  const now = today();
  const [keep, leads, people, runs] = await Promise.all([
    siteFilter('perimeter'),
    loadQhseLeads(),
    db.select({
      id: t.people.id, name: t.people.name, siteId: t.people.siteId, matricule: t.people.matricule, replacedById: t.people.replacedById,
      leftOn: t.people.leftOn, cursusState: t.people.cursusState,
    }).from(t.people).orderBy(asc(t.people.sort), asc(t.people.name)),
    db.select({ status: t.syncRuns.status }).from(t.syncRuns).where(eq(t.syncRuns.source, SOURCES.people.view))
      .orderBy(desc(t.syncRuns.startedAt), desc(t.syncRuns.id)).limit(1),
  ]);
  const todo: TodoItem[] = [];
  if (runs[0] && runs[0].status !== 'ok') {
    const lead = leads.forSite(null);
    todo.push({
      kind: 'Personnel', key: 'cursus-personnes-indisponible', who: lead.who, ownerIds: lead.ownerIds, siteId: null, href: PEOPLE_VIEW_PATH,
      date: now, tone: 'warn', title: 'Personnes de Cursus indisponibles : fiches du personnel non mises à jour',
    });
  }
  for (const p of people) {
    if (!keep(p.siteId)) continue;
    const lead = leads.forSite(p.siteId);
    const base = { kind: 'Personnel', who: lead.who, ownerIds: lead.ownerIds, siteId: p.siteId, href: PEOPLE_VIEW_PATH, date: now, tone: 'warn' as const };
    if (toAttach(p, now)) todo.push({ ...base, key: `personne-a-rattacher|${p.id}`, title: `${p.name} — fiche sans matricule Cursus : à rattacher` });
    else if (p.matricule && p.cursusState === 'absent' && !hasLeft(p, now)) {
      todo.push({ ...base, key: `cursus-personne-absente|${p.id}`, title: `${p.name} — absent(e) de Cursus : vérifier auprès du service RH` });
    }
  }
  return { todo };
});
