import '../next-mocks';
import { describe, expect, it } from 'vitest';
import { getDb, schema as t } from '@/db';
import { READ_STATE_RETENTION_DAYS, REMINDER_READ_PREFIX, REMINDER_READ_RETENTION_DAYS, purgeReadStates } from '@/db/maintenance';
import { REMINDER_KEY_PREFIX } from '@/lib/domain';
import { freshDemoDatabase } from '../helpers';

// TDB-10 : purge des états lus périmés (notification_reads), des notifications lues anciennes et du journal d'envoi du
// rappel du mercredi, par la maintenance horaire ; jamais un enregistrement métier tracé ni une notification non lue.

freshDemoDatabase();

const NOW = new Date('2026-10-09T08:30:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('purge des états lus (TDB-10)', () => {
  it('préfixe des clés du rappel identique à celui de l’application', () => {
    expect(REMINDER_READ_PREFIX).toBe(REMINDER_KEY_PREFIX);
    expect([READ_STATE_RETENTION_DAYS, REMINDER_READ_RETENTION_DAYS]).toEqual([365, 14]);
  });

  it('supprime les seules lignes périmées, garde le reste et le journal des modifications', async () => {
    const db = await getDb();
    const changes = (await db.select().from(t.changeLog)).length;
    await db.delete(t.notificationReads);
    await db.insert(t.notificationReads).values([
      { personId: 'clefevre', itemKey: 'Action|/actions?action=A-1|A-1 · ancienne|danger|2025-01-10', readAt: daysAgo(400) },
      { personId: 'clefevre', itemKey: 'Action|/actions?action=A-2|A-2 · récente|danger|2026-09-01', readAt: daysAgo(30) },
      { personId: 'clefevre', itemKey: `${REMINDER_KEY_PREFIX}2026-W38`, readAt: daysAgo(20) },
      { personId: 'clefevre', itemKey: `${REMINDER_KEY_PREFIX}2026-W41`, readAt: daysAgo(2) },
    ]);
    const [oldRead, recentRead, oldUnread] = await db.insert(t.notifications).values([
      { personId: 'clefevre', type: 'action_confiee', entityType: 'action', entityId: 'A-198', title: 'Ancienne lue', href: '/actions?action=A-198', createdAt: daysAgo(420), readAt: daysAgo(400) },
      { personId: 'clefevre', type: 'action_confiee', entityType: 'action', entityId: 'A-198', title: 'Récente lue', href: '/actions?action=A-198', createdAt: daysAgo(40), readAt: daysAgo(30) },
      { personId: 'clefevre', type: 'action_confiee', entityType: 'action', entityId: 'A-198', title: 'Ancienne non lue', href: '/actions?action=A-198', createdAt: daysAgo(500) },
    ]).returning({ id: t.notifications.id });
    await db.insert(t.actionReminderSends).values([
      { personId: 'clefevre', week: '2025-W39', status: 'envoye', createdAt: daysAgo(380) },
      { personId: 'clefevre', week: '2026-W40', status: 'envoye', createdAt: daysAgo(9) },
    ]);

    expect(await purgeReadStates(db, NOW)).toEqual({ reads: 2, notifications: 1, sends: 1 });
    expect((await db.select().from(t.notificationReads)).map((r) => r.itemKey).sort()).toEqual([
      'Action|/actions?action=A-2|A-2 · récente|danger|2026-09-01', `${REMINDER_KEY_PREFIX}2026-W41`,
    ]);
    const ids = (await db.select({ id: t.notifications.id }).from(t.notifications)).map((r) => r.id);
    expect(ids).not.toContain(oldRead.id);
    expect(ids).toEqual(expect.arrayContaining([recentRead.id, oldUnread.id]));
    expect((await db.select().from(t.actionReminderSends)).map((r) => r.week).filter((w) => w.startsWith('2025') || w === '2026-W40')).toEqual(['2026-W40']);
    expect((await db.select().from(t.changeLog)).length).toBe(changes);
    // Idempotente.
    expect(await purgeReadStates(db, NOW)).toEqual({ reads: 0, notifications: 0, sends: 0 });
  });
});
