// Rappel du mercredi par e-mail (docs/specs/actions-qse.md § 15.2, ACT-33) : tâche planifiée (src/db/scheduler.ts,
// inscrite par src/db/index.ts quand un transport existe) et lecture des actions d'un responsable, partagée avec la cloche
// (src/lib/data/notifications.ts, ACT-32). Module sans 'server-only' ni session : utilisable par le planificateur, les
// scripts et les tests (date du jour et instant passés explicitement).
//
// Règles (D13 du plan) :
// - envoi le mercredi de la semaine ISO en cours seulement, à partir de l'heure configurée (VIGIE_REMINDER_TIME, Paris)
//   jusqu'à 23:59 ; aucun rattrapage les jours suivants (l'élément de la cloche existe toujours) ;
// - un envoi par personne et par semaine (table action_reminder_sends, clé primaire réclamée par insert … on conflict do
//   nothing), même après un redémarrage ou avec plusieurs instances ; échec → nouvel essai au passage suivant, 5 essais au
//   plus ; envoi resté « en_cours » plus de 30 min (processus arrêté pendant l'envoi) → repris : un doublon rare est accepté ;
// - destinataires : personnes présentes à l'effectif avec au moins une action ouverte ou Terminée, sur tous les sites (D19 :
//   la fiche s'ouvre pour son responsable quel que soit son périmètre) ; sans adresse : « sans_adresse », rappel dans
//   Vigie seulement ;
// - lien : config().publicUrl (obligatoire hors démonstration ; http://localhost:3200 en démonstration) et non
//   publicOrigin(), qui a besoin d'une requête (écart enregistré D13 ; même valeur hors démonstration).

import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import * as t from '@/db/schema';
import type { Db, DbOrTx } from '@/db/types';
import { fromParisLocal, isoWeekKey, parisDay, toParisLocal } from './dates';
import type { VigieConfig } from './env';
import type { MailTransport } from './mail/transport';
import { hasLeft } from './people';
import {
  REMINDER_AVANCEMENTS, isReminderDue, reminderRows, reminderWeek, renderReminderEmail, type ReminderAction, type ReminderRows,
} from './action-reminder';

/** Nombre maximal d'essais d'envoi par personne et par semaine. */
export const REMINDER_MAX_ATTEMPTS = 5;
/** Envoi « en_cours » considéré comme interrompu au-delà de ce délai (repris au passage suivant). */
export const REMINDER_STALE_MS = 30 * 60_000;
/** Longueur maximale du message d'erreur conservé au journal d'envoi. */
const ERROR_MAX = 500;
/**
 * Adresse utilisable comme destinataire : une seule adresse, sans espace, retour à la ligne ni chevron (aucune injection
 * d'en-tête possible par un futur transport SMTP, ACT-34). Autre valeur de people.email : traitée comme une absence.
 */
const RECIPIENT = /^[^\s<>@",;]+@[^\s<>@",;]+\.[^\s<>@",;]+$/;
/** Origine de Vigie en démonstration sans VIGIE_PUBLIC_URL (port de développement). */
export const DEMO_BASE_URL = 'http://localhost:3200';

/** Actions du rappel (ouvertes + Terminées) des personnes indiquées, tous sites (requête sans session). */
export async function reminderActionsOf(db: DbOrTx, personIds: readonly string[]): Promise<(ReminderAction & { pilotId: string })[]> {
  if (!personIds.length) return [];
  return db.select({ id: t.actions.id, detail: t.actions.detail, status: t.actions.status, dueOn: t.actions.dueOn, siteId: t.actions.siteId, pilotId: t.actions.pilotId })
    .from(t.actions)
    .where(and(inArray(t.actions.pilotId, [...personIds]), inArray(t.actions.status, [...REMINDER_AVANCEMENTS])));
}

/** Libellés des sites (archivés compris) par identifiant. */
export async function siteLabels(db: DbOrTx): Promise<Map<string, string>> {
  const rows = await db.select({ id: t.sites.id, label: t.sites.label }).from(t.sites);
  return new Map(rows.map((s) => [s.id, s.label]));
}

/** Rappel d'une personne à la date `todayIso` (cloche, ACT-32) : lignes, nombre d'actions, retards. */
export async function reminderFor(db: DbOrTx, personId: string, todayIso: string): Promise<ReminderRows> {
  const [actions, sites] = await Promise.all([reminderActionsOf(db, [personId]), siteLabels(db)]);
  return reminderRows(actions, todayIso, sites);
}

export type ReminderJobConfig = Pick<VigieConfig, 'reminderTime' | 'publicUrl' | 'demo' | 'mailFrom'>;
export type ReminderJobResult = { due: boolean; week?: string; sent: number; failed: number; withoutAddress: number; skipped: number };

/** Journal du serveur (console par défaut ; les tests le remplacent). */
export type ReminderLog = { info(m: string): void; error(m: string): void };

/**
 * Passage de la tâche d'envoi : rien hors du créneau (mercredi, heure configurée atteinte) ; sinon, pour chaque
 * destinataire, réclame l'envoi de la semaine (nouveau, échec à retenter, ou « en_cours » interrompu), puis envoie et
 * consigne le résultat. `todayIso` : date du jour Vigie (VIGIE_TODAY en démonstration) ; `now` : instant de référence
 * (heure de Paris comparée à l'heure configurée). Une ligne au journal du serveur quand quelque chose a été fait.
 */
export async function runWeeklyReminder(db: Db, opts: {
  now: Date; todayIso: string; cfg: ReminderJobConfig; transport: MailTransport; log?: ReminderLog;
}): Promise<ReminderJobResult> {
  const { now, todayIso, cfg, transport, log = console } = opts;
  const result: ReminderJobResult = { due: false, sent: 0, failed: 0, withoutAddress: 0, skipped: 0 };
  if (!isReminderDue(todayIso, now, cfg.reminderTime)) return result;
  const baseUrl = (cfg.publicUrl ?? (cfg.demo ? DEMO_BASE_URL : null))?.replace(/\/+$/, '');
  const { day } = reminderWeek(todayIso);
  const week = isoWeekKey(day);
  Object.assign(result, { due: true, week });
  if (!baseUrl) {
    // Impossible hors démonstration (VIGIE_PUBLIC_URL obligatoire, src/lib/env.ts) : garde-fou.
    log.error('[vigie] Rappel du mercredi : adresse publique de Vigie inconnue (VIGIE_PUBLIC_URL), aucun e-mail envoyé.');
    return result;
  }

  const actions = await db.select({ id: t.actions.id, detail: t.actions.detail, status: t.actions.status, dueOn: t.actions.dueOn, siteId: t.actions.siteId, pilotId: t.actions.pilotId })
    .from(t.actions).where(inArray(t.actions.status, [...REMINDER_AVANCEMENTS]));
  const pilots = [...new Set(actions.map((a) => a.pilotId))];
  if (!pilots.length) return result;
  const [people, sites] = await Promise.all([
    db.select({ id: t.people.id, name: t.people.name, email: t.people.email, leftOn: t.people.leftOn }).from(t.people)
      .where(inArray(t.people.id, pilots)).orderBy(asc(t.people.sort), asc(t.people.id)),
    siteLabels(db),
  ]);

  for (const person of people.filter((p) => !hasLeft(p, todayIso))) {
    const rows = reminderRows(actions.filter((a) => a.pilotId === person.id), todayIso, sites);
    if (!rows.count) continue;
    const trimmed = person.email?.trim() || null;
    const email = trimmed && RECIPIENT.test(trimmed) ? trimmed : null;
    const counts = { actionCount: rows.count, lateCount: rows.late, email: trimmed };
    if (!(await claim(db, person.id, week, now, counts))) {
      result.skipped++;
      continue;
    }
    if (!email) {
      await finish(db, person.id, week, { status: 'sans_adresse' });
      result.withoutAddress++;
      continue;
    }
    const mail = renderReminderEmail({ person, rows, baseUrl, day });
    try {
      await transport.send({ id: `rappel-${week}-${person.id}`, to: email, from: cfg.mailFrom, ...mail });
      await finish(db, person.id, week, { status: 'envoye', sentAt: new Date(), error: null });
      result.sent++;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX);
      await finish(db, person.id, week, { status: 'echec', error: message });
      result.failed++;
    }
  }
  if (result.sent || result.failed || result.withoutAddress) {
    const line = `[vigie] Rappel du mercredi : semaine ${week}, ${result.sent} e-mail(s) envoyé(s), ${result.withoutAddress} sans adresse, ${result.failed} échec(s).`;
    if (result.failed) log.error(line);
    else log.info(line);
  }
  return result;
}

/**
 * Réclame l'envoi de la semaine pour une personne : première fois (insertion), sinon échec à retenter (moins de 5 essais)
 * ou envoi « en_cours » interrompu depuis plus de 30 min. Faux si un autre passage (ou une autre instance) l'a déjà fait.
 */
async function claim(db: Db, personId: string, week: string, now: Date, counts: { actionCount: number; lateCount: number; email: string | null }): Promise<boolean> {
  const inserted = await db.insert(t.actionReminderSends)
    .values({ personId, week, status: 'en_cours', attempts: 1, ...counts, createdAt: now, updatedAt: now })
    .onConflictDoNothing().returning({ personId: t.actionReminderSends.personId });
  if (inserted.length) return true;
  const s = t.actionReminderSends;
  const reclaimed = await db.update(s)
    .set({ status: 'en_cours', attempts: sql`${s.attempts} + 1`, updatedAt: now, ...counts })
    .where(and(eq(s.personId, personId), eq(s.week, week), or(
      and(eq(s.status, 'echec'), lt(s.attempts, REMINDER_MAX_ATTEMPTS)),
      and(eq(s.status, 'en_cours'), lt(s.updatedAt, new Date(now.getTime() - REMINDER_STALE_MS))),
    )))
    .returning({ personId: s.personId });
  return reclaimed.length > 0;
}

async function finish(db: Db, personId: string, week: string, patch: Partial<typeof t.actionReminderSends.$inferInsert>) {
  await db.update(t.actionReminderSends).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(t.actionReminderSends.personId, personId), eq(t.actionReminderSends.week, week)));
}

/**
 * Instant de référence d'un passage : l'instant réel, ou, avec une date du jour figée (VIGIE_TODAY, démonstration), cette
 * date à l'heure réelle de Paris (comme referenceNow de src/lib/dates.ts).
 */
export function reminderClock(cfg: Pick<VigieConfig, 'today'>, real: Date): { todayIso: string; now: Date } {
  if (!cfg.today) return { todayIso: parisDay(real), now: real };
  return { todayIso: cfg.today, now: fromParisLocal(`${cfg.today}T${toParisLocal(real).slice(11)}`) ?? real };
}
