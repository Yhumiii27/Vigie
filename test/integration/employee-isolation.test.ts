import { describe, expect, it } from 'vitest';
import { actAs, freshDemoDatabase } from '../helpers';
import { eq } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { loadLinkedAction, loadActionPlan } from '@/lib/data/actions';
import { loadCounters } from '@/lib/data/counters';
import { loadEventDetail, loadMyReport, loadMyReports, loadVisibleEvents } from '@/lib/data/events';
import { loadNotifications } from '@/lib/data/notifications';
import { loadSkillMatrix } from '@/lib/data/skills';
import { loadVisibleTodo } from '@/lib/data/todo';
import { canReadAttachment, type Attachment } from '@/lib/uploads';

// Cloisonnement du rôle Salarié (QUA-06) : chaque chargement ne lui renvoie que ses propres données — sa ligne de
// la matrice des habilitations, ses signalements nominatifs, les actions dont il est pilote, ses échéances — tous sites
// confondus. La charge RSC des pages construites est vérifiée par test/e2e/employee-payload.test.ts.

freshDemoDatabase();

const ME = 'tnguyen';
const asEmployee = () => actAs('Salarié', 'all');

describe('Salarié : ses données seulement', () => {
  it('matrice des habilitations : sa ligne, ses alertes et affectations ; ni personnel non suivi ni sortis', async () => {
    actAs('Animateur QHSE', 'all');
    const all = await loadSkillMatrix();
    expect(all.self).toBe(false);
    expect(new Set(all.rows.map((r) => r.person.id)).size).toBeGreaterThan(5);
    asEmployee();
    const mine = await loadSkillMatrix();
    expect(mine.self).toBe(true);
    expect(mine.rows.map((r) => r.person.id)).toEqual([ME]);
    expect(mine.alerts.length).toBeGreaterThan(0);
    expect([...mine.alerts, ...mine.lapses, ...mine.archive].every((x) => x.person.id === ME)).toBe(true);
    expect(mine.others).toEqual([]);
    expect(mine.departed).toEqual([]);
    expect(JSON.stringify(mine)).not.toMatch(/\[M\. Girard\]|\[P\. Roux\]|\[K\. Bernard\]|\[Y\. Lambert\]/);
  });

  it('plan d’actions : les actions dont il est pilote, sur tous les filtres ; lien direct vers une autre action introuvable', async () => {
    asEmployee();
    for (const scope of ['', 'historique', 'annulees'] as const) {
      const { all, pilots } = await loadActionPlan({ scope });
      expect(all.every((a) => a.pilotId === ME)).toBe(true);
      expect(pilots.every(([id]) => id === ME)).toBe(true);
    }
    expect((await loadActionPlan()).all.map((a) => a.id)).toContain('A-215');
    expect(await loadLinkedAction('A-214')).toEqual({ action: null, elsewhere: null }); // même événement, autre pilote
    expect(await loadLinkedAction('A-206')).toEqual({ action: null, elsewhere: null }); // autre site, autre pilote
    expect((await loadLinkedAction('A-215')).action?.id).toBe('A-215');
  });

  it('la source d’une action de son signalement reste lisible, celle d’un signalement d’autrui est masquée', async () => {
    const db = await getDb();
    // Action dont il est pilote, issue du signalement d'un collègue (EV-2026-130, [P. Roux]).
    await db.insert(t.actions).values({
      id: 'A-950', title: 'Contrôler la dérive outil au poste CU-2', origin: 'ev', originRef: 'EV-2026-130', eventId: 'EV-2026-130', siteId: 'ville-a',
      pilotId: ME, dueOn: '2026-10-30', status: 'todo', kind: 'C',
    });
    actAs('Animateur QHSE', 'all');
    expect(JSON.stringify((await loadActionPlan()).all.find((a) => a.id === 'A-950'))).toContain("Cotes hors tolérance sur l'arbre de malaxeur");
    asEmployee();
    const plan = await loadActionPlan();
    const other = plan.all.find((a) => a.id === 'A-950')!;
    const own = plan.all.find((a) => a.id === 'A-215')!;
    expect(JSON.stringify(other)).not.toContain("Cotes hors tolérance sur l'arbre de malaxeur");
    expect(JSON.stringify(own)).toContain('EV-2026-131');
  });

  it('« Mes signalements » : ses signalements nominatifs, jamais ceux des autres', async () => {
    asEmployee();
    const db = await getDb();
    const declared = (await db.select({ id: t.events.id, anonymous: t.events.anonymous }).from(t.events).where(eq(t.events.declarantId, ME)))
      .filter((e) => !e.anonymous).map((e) => e.id).sort();
    const reports = await loadMyReports();
    expect(reports.map((r) => r.id).sort()).toEqual(declared);
    expect(declared.length).toBeGreaterThan(2);
    expect(await loadMyReport('EV-2026-130')).toBeNull(); // déclaré par [P. Roux]
    expect(await loadMyReport('EV-2026-119')).toBeNull(); // accident de [A. Martin] (données de santé)
    const own = await loadMyReport('EV-2026-131');
    expect(own).toMatchObject({ id: 'EV-2026-131' });
    // Retour d'information : ni pilote ni analyse des causes.
    expect(own).not.toHaveProperty('pilotId');
    expect(JSON.stringify(own)).not.toContain('Élingue textile usée');
  });

  it('événements (/evenements) : ses signalements nominatifs ; la fiche d’un autre événement est introuvable', async () => {
    actAs('Animateur QHSE', 'all');
    const all = await loadVisibleEvents();
    expect(all.some((e) => e.declarantId !== ME)).toBe(true);
    expect((await loadEventDetail('EV-2026-130'))?.event.id).toBe('EV-2026-130');
    asEmployee();
    const mine = await loadVisibleEvents();
    expect(mine.length).toBeGreaterThan(2);
    expect(mine.every((e) => e.declarantId === ME && !e.anonymous)).toBe(true);
    expect(await loadEventDetail('EV-2026-130')).toBeNull(); // déclaré par [P. Roux]
    expect(await loadEventDetail('EV-2026-119')).toBeNull(); // accident de [A. Martin]
    expect((await loadEventDetail('EV-2026-131'))?.event.id).toBe('EV-2026-131');
  });

  it('échéances, notifications et badges : les siennes seulement', async () => {
    actAs('Animateur QHSE', 'all');
    const everyone = await loadVisibleTodo();
    asEmployee();
    const todo = await loadVisibleTodo();
    expect(todo.length).toBeGreaterThan(0);
    expect(todo.length).toBeLessThan(everyone.length);
    expect(todo.every((x) => (x.ownerIds ? x.ownerIds.includes(ME) : x.who.includes('[T. Nguyen]')))).toBe(true);
    expect(todo.some((x) => x.health)).toBe(false);
    expect(JSON.stringify(todo)).not.toMatch(/\[M\. Girard\]|\[A\. Martin\]|\[K\. Bernard\]/);
    const notifications = await loadNotifications();
    expect(notifications.every((n) => todo.some((x) => x.title === n.title))).toBe(true);
    const { badges } = await loadCounters();
    expect(badges.todo).toBe(todo.length);
    expect(Object.keys(badges).every((k) => ['todo', 'events', 'actions', 'skills', 'docs'].includes(k))).toBe(true);
  });

  it('pièces jointes : ses signalements, ses actions, ses formations', async () => {
    const db = await getDb();
    const [qMine] = await db.select({ id: t.qualifications.id }).from(t.qualifications).where(eq(t.qualifications.personId, ME));
    const [qOther] = await db.select({ id: t.qualifications.id }).from(t.qualifications).where(eq(t.qualifications.personId, 'mgirard'));
    const row = (entityType: string, entityId: string | number, uploadedBy: string | null = null): Attachment => ({
      id: 'x', entityType, entityId: String(entityId), fileName: 'f.pdf', mimeType: 'application/pdf', size: 1, storagePath: 'x', uploadedBy, createdAt: new Date(),
    });
    const s = { role: 'Salarié' as const, user: { id: ME }, allowedSiteIds: null };
    expect(await canReadAttachment(row('event', 'EV-2026-131'), s)).toBe(true);
    expect(await canReadAttachment(row('event', 'EV-2026-130'), s)).toBe(false);
    expect(await canReadAttachment(row('event', 'EV-2026-130', ME), s)).toBe(true); // fichier qu'il a lui-même joint
    expect(await canReadAttachment(row('action', 'A-215'), s)).toBe(true);
    expect(await canReadAttachment(row('action', 'A-214'), s)).toBe(false);
    expect(await canReadAttachment(row('qualification', qMine.id), s)).toBe(true);
    expect(await canReadAttachment(row('qualification', qOther.id), s)).toBe(false);
    expect(await canReadAttachment(row('prevention_plan', 'PP-2026-013'), s)).toBe(false);
    expect(await canReadAttachment(row('control_record', 1), s)).toBe(false);
    expect(await canReadAttachment(row('inconnu', 1), s)).toBe(false);
  });
});
