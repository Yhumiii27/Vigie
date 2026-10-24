import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db';
import type { Db } from '@/db/types';
import { SCHEDULER_INTERVAL_MS, WEEKLY_REMINDER_TASK, scheduledTasks, startScheduler, type ScheduledTask } from '@/db/scheduler';
import { parseConfig, resetConfig } from '@/lib/env';

// Tâches planifiées (PRD-12) : passage immédiat puis toutes les 10 minutes, erreurs journalisées, arrêt qui attend le
// passage en cours ; registre de la configuration (rappel du mercredi seulement avec un transport d'e-mail) ; ouverture de
// la base : une minuterie de plus que la maintenance quand le registre n'est pas vide et VIGIE_SCHEDULER=1.

const db = {} as Db;
const flush = () => new Promise((r) => setImmediate(r));

afterEach(() => { vi.useRealTimers(); });

describe('startScheduler', () => {
  it('un passage immédiat, puis un à chaque intervalle ; arrêt : plus de passage', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const run = vi.fn<ScheduledTask['run']>(async () => {});
    const stop = startScheduler(db, [{ name: 'essai', run }]);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toBe(db);
    expect(run.mock.calls[0][1]).toBeInstanceOf(Date);
    vi.advanceTimersByTime(SCHEDULER_INTERVAL_MS - 1);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    await stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(SCHEDULER_INTERVAL_MS * 3);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('erreur d’une tâche : journalisée, jamais levée ; les autres tâches passent', async () => {
    const error = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const ok = vi.fn(async () => {});
    const stop = startScheduler(db, [{ name: 'cassée', run: async () => { throw new Error('boum'); } }, { name: 'saine', run: ok }], 60_000);
    await flush();
    await stop();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/Tâche planifiée « cassée » en erreur[\s\S]*boum/));
    error.mockRestore();
  });

  it('arrêt : attend la fin du passage en cours ; un passage ne chevauche pas le précédent', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let release!: () => void;
    let calls = 0;
    const slow: ScheduledTask = { name: 'lente', run: () => { calls++; return new Promise<void>((r) => { release = r; }); } };
    const stop = startScheduler(db, [slow]);
    await flush();
    vi.advanceTimersByTime(SCHEDULER_INTERVAL_MS);
    await flush();
    expect(calls).toBe(1); // passage précédent pas fini : pas de nouveau passage
    let stopped = false;
    const stopping = stop().then(() => { stopped = true; });
    await flush();
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
  });
});

describe('scheduledTasks', () => {
  it('rappel du mercredi avec le transport « fichier », registre vide avec « aucun »', () => {
    expect(scheduledTasks(parseConfig({ VIGIE_DEMO: '1' })).map((x) => x.name)).toEqual([WEEKLY_REMINDER_TASK]);
    expect(scheduledTasks(parseConfig({ VIGIE_DEMO: '1', VIGIE_MAIL_TRANSPORT: 'aucun' }))).toEqual([]);
    expect(scheduledTasks(parseConfig({ VIGIE_PUBLIC_URL: 'https://vigie.exemple.fr', VIGIE_SESSION_SECRET: 'x'.repeat(48), VIGIE_REPORT_SECRET: 'y'.repeat(48) }))).toEqual([]);
  });
});

describe('ouverture de la base', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vigie-test-scheduler-'));
  const saved = { ...process.env };
  afterAll(async () => {
    await closeDb();
    for (const k of ['DATABASE_URL', 'VIGIE_DEMO', 'VIGIE_DATA_DIR', 'VIGIE_SCHEDULER', 'VIGIE_MAIL_TRANSPORT', 'VIGIE_MAIL_DIR', 'VIGIE_UPLOAD_DIR', 'VIGIE_TODAY']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetConfig();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Minuteries périodiques créées par l'ouverture de la base (maintenance horaire : 1). */
  async function timersAtOpen(env: Record<string, string>) {
    await closeDb();
    Object.assign(process.env, {
      VIGIE_DEMO: '1', VIGIE_DATA_DIR: 'memory://', VIGIE_TODAY: '2026-10-09', VIGIE_UPLOAD_DIR: path.join(dir, 'uploads'), VIGIE_MAIL_DIR: path.join(dir, 'mails'), ...env,
    });
    delete process.env.DATABASE_URL;
    resetConfig();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await getDb();
    const count = vi.getTimerCount();
    await closeDb();
    const left = vi.getTimerCount();
    vi.useRealTimers();
    return { count, left };
  }

  // Chaque cas ouvre une base de démonstration complète (jeu et pièces jointes) : délai large sur une machine chargée.
  const OPEN_TIMEOUT = 120_000;
  it('VIGIE_SCHEDULER=1 et transport « fichier » : une minuterie de plus ; arrêtée à la fermeture', async () => {
    expect(await timersAtOpen({ VIGIE_SCHEDULER: '1', VIGIE_MAIL_TRANSPORT: 'fichier' })).toEqual({ count: 2, left: 0 });
  }, OPEN_TIMEOUT);
  it('transport « aucun » (registre vide) : maintenance seule', async () => {
    expect(await timersAtOpen({ VIGIE_SCHEDULER: '1', VIGIE_MAIL_TRANSPORT: 'aucun' })).toEqual({ count: 1, left: 0 });
  }, OPEN_TIMEOUT);
  it('VIGIE_SCHEDULER=0 : maintenance seule', async () => {
    expect(await timersAtOpen({ VIGIE_SCHEDULER: '0', VIGIE_MAIL_TRANSPORT: 'fichier' })).toEqual({ count: 1, left: 0 });
  }, OPEN_TIMEOUT);
});
