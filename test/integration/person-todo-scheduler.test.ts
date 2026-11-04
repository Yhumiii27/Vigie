import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it, vi } from 'vitest';
import { cookieJar } from '../next-mocks';
import { actAs, freshDemoDatabase } from '../helpers';
import { getDb } from '@/db';
import { PERSON_TODO_TASK, SHARED_REFERENCES_TASK, personTodoTask, sharedReferencesTask, scheduledTasks, startScheduler, type ScheduledTask } from '@/db/scheduler';
import type { Db } from '@/db/types';
import { DEMO_ROLE_PEOPLE } from '@/lib/demo';
import type { Role } from '@/lib/domain';
import { parseConfig } from '@/lib/env';
import { computePersonTodo, latestPersonTodo } from '@/lib/data/person-todo';
import { loadVisibleTodo } from '@/lib/data/todo';
import { markServerRuntime, serverRuntime } from '@/lib/server-runtime';

// PRD-12 (classe 1, lot A) : échéances calculées hors requête utilisateur, par personne (responsable désignée), pour un
// futur canal sortant ; aucune écriture en base ni envoi. Tâche planifiée du serveur Next.js seulement, passages dans le
// contexte racine (jamais celui de la requête qui a ouvert la base).

// Contexte racine pris ici, hors de tout contexte asynchrone (comme instrumentation-node au démarrage du serveur).
const request = new AsyncLocalStorage<string>();
markServerRuntime();

freshDemoDatabase();

describe('PRD-12 : échéances par personne sans session', () => {
  it('calcul sans cookie ni session : mêmes échéances que « Mes échéances » de chaque rôle de démonstration', async () => {
    cookieJar.clear();
    const digest = await computePersonTodo();
    expect(digest.today).toBe('2026-10-09');
    expect(digest.people.length).toBeGreaterThan(1);
    expect(latestPersonTodo()).toBe(digest);
    for (const [role, personId] of Object.entries(DEMO_ROLE_PEOPLE) as [Role, string][]) {
      actAs(role, 'all');
      const mine = (await loadVisibleTodo()).filter((i) => i.ownerIds?.includes(personId)).map((i) => i.key).sort();
      const computed = (digest.people.find((p) => p.personId === personId)?.items ?? []).map((i) => i.key).sort();
      expect(computed, role).toEqual(mine);
      cookieJar.clear();
    }
  });

  it('rôle de chaque personne : dernier rôle connu ; aucune donnée de santé hors animateur QHSE et direction', async () => {
    const digest = await computePersonTodo();
    for (const p of digest.people) {
      if (p.role !== 'Animateur QHSE' && p.role !== 'Direction') expect(p.items.some((i) => i.health), p.name).toBe(false);
      expect(p.items.every((i) => i.ownerIds?.includes(p.personId))).toBe(true);
      expect(p.late).toBe(p.items.filter((i) => i.overdue || i.date < digest.today).length);
    }
    expect(digest.people.find((p) => p.personId === 'clefevre')?.role).toBe('Animateur QHSE');
  });
});

describe('PRD-12 : tâche planifiée', () => {
  it('inscrite dans le serveur Next.js (instrumentation) seulement, avec ou sans transport d’e-mail', () => {
    expect(serverRuntime()).toBeDefined();
    expect(scheduledTasks(parseConfig({ VIGIE_DEMO: '1', VIGIE_MAIL_TRANSPORT: 'aucun' })).map((t) => t.name)).toEqual([PERSON_TODO_TASK, SHARED_REFERENCES_TASK]);
  });

  it('référentiels partagés (lot 0 de M-02) : une fois par nuit, à partir de 2 h (Paris), jamais le jour du démarrage', async () => {
    const db = await getDb();
    const { schema: t } = await import('@/db');
    const count = async () => (await db.select().from(t.syncRuns)).length;
    const task = sharedReferencesTask(new Date('2026-10-09T10:00:00Z'));
    const n0 = await count();
    await task.run(db, new Date('2026-10-09T23:30:00Z')); // 01 h 30 à Paris le 10/10 : trop tôt
    expect(await count()).toBe(n0);
    await task.run(db, new Date('2026-10-10T00:30:00Z')); // 02 h 30 à Paris
    expect(await count()).toBe(n0 + 6);
    await task.run(db, new Date('2026-10-10T12:00:00Z')); // même jour : rien
    expect(await count()).toBe(n0 + 6);
  });

  it('calcul au premier passage puis au plus une fois par heure', async () => {
    const task = personTodoTask();
    const db = await getDb();
    const t0 = new Date('2026-10-09T08:00:00Z');
    await task.run(db, t0);
    const first = latestPersonTodo()!;
    expect(first.computedAt).toEqual(t0);
    await task.run(db, new Date('2026-10-09T08:30:00Z'));
    expect(latestPersonTodo()).toBe(first);
    await task.run(db, new Date('2026-10-09T09:00:00Z'));
    expect(latestPersonTodo()!.computedAt).toEqual(new Date('2026-10-09T09:00:00Z'));
  });

  it('passages dans le contexte racine, jamais dans celui de la requête qui a ouvert la base', async () => {
    const seen: (string | undefined)[] = [];
    const probe: ScheduledTask = { name: 'sonde', run: async () => { seen.push(request.getStore()); } };
    const stop = request.run('requête de Claire', () => startScheduler({} as Db, [probe], 60_000));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await stop();
    expect(seen).toEqual([undefined]);
  });
});
