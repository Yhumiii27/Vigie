import 'server-only';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { canSee } from '../domain';
import { hasLeft } from '../people';
import { loadPeople, loadSiteRows } from '../queries';
import { signatureRate, talkStats, type TalkStatsRow } from '../rules/safety-talks';
import { getSession, siteFilter } from '../session';
import { today } from '@/lib/today';
import { entityVersions } from '@/server/versions';
import { toParisLocal, parisDay } from '../dates';
import { shortSiteLabel } from './todo';

// Causeries et quarts d'heure sécurité (CNF-09) : vue « Causeries » de l'écran Prévention (site sélectionné et périmètre,
// comme les plans), fiche imprimable (feuille d'émargement avec les heures de signature) et feuilles à signer de la
// personne connectée (« Mon espace »). Indicateurs calculés à l'affichage (talkStats), jamais stockés.

export type SafetyTalkView = {
  id: string; version: string; siteId: string; site: string; heldOn: string; theme: string;
  animatorId: string; animator: string; durationMinutes: number; notes: string;
  participants: { personId: string; name: string; signedAt: string | null; notified: boolean }[];
  rate: number | null;
  sheetSentAt: string | null;
  cancelled: { on: string; by: string; reason: string } | null;
};

async function readTalks(ids?: readonly string[]) {
  const db = await getDb();
  const talks = await (ids ? db.select().from(t.safetyTalks).where(inArray(t.safetyTalks.id, [...ids])) : db.select().from(t.safetyTalks))
    .then((rows) => rows.sort((a, b) => b.heldOn.localeCompare(a.heldOn) || b.id.localeCompare(a.id, 'fr', { numeric: true })));
  const parts = talks.length ? await db.select().from(t.safetyTalkParticipants).where(inArray(t.safetyTalkParticipants.talkId, talks.map((x) => x.id))) : [];
  return { db, talks, parts };
}

/** Causeries du site sélectionné (périmètre), annulées comprises, avec leurs participants, et les indicateurs. */
export async function loadSafetyTalks() {
  const [{ role }, keep, people, sites] = await Promise.all([getSession(), siteFilter('site'), loadPeople(), loadSiteRows()]);
  if (!canSee(role, 'prevention')) return null;
  const { db, talks, parts } = await readTalks();
  const visible = talks.filter((x) => keep(x.siteId));
  const versions = await entityVersions(db, 'safety_talk', visible.map((x) => x.id));
  const name = (id: string | null) => (id ? people.get(id)?.name ?? id : '');
  const siteOf = new Map(sites.map((s) => [s.id, shortSiteLabel(s.label)]));
  const views = visible.map((x): SafetyTalkView => {
    const participants = parts.filter((p) => p.talkId === x.id)
      .map((p) => ({ personId: p.personId, name: name(p.personId), signedAt: p.signedAt ? toParisLocal(p.signedAt) : null, notified: !!p.notifiedAt }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return {
      id: x.id, version: versions.get(x.id) ?? '0', siteId: x.siteId, site: siteOf.get(x.siteId) ?? x.siteId, heldOn: x.heldOn, theme: x.theme,
      animatorId: x.animatorId, animator: name(x.animatorId), durationMinutes: x.durationMinutes, notes: x.notes,
      participants, rate: signatureRate(participants), sheetSentAt: x.sheetSentAt ? toParisLocal(x.sheetSentAt) : null,
      cancelled: x.cancelledAt ? { on: parisDay(x.cancelledAt), by: name(x.cancelledById), reason: x.cancelReason ?? '' } : null,
    };
  });
  const stats: (TalkStatsRow & { site: string })[] = talkStats(views.map((v) => ({ siteId: v.siteId, heldOn: v.heldOn, cancelled: !!v.cancelled, participants: v.participants })))
    .map((r) => ({ ...r, site: siteOf.get(r.siteId) ?? r.siteId }));
  const now = today();
  // Personnes proposées (animateur, participants) : présentes, du site de la causerie ou sans site (filtré côté navigateur).
  const choices: (readonly [string, string, string | null])[] = [...people.values()].filter((p) => !hasLeft(p, now))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .map((p) => [p.id, [p.name, p.company].filter(Boolean).join(' · '), p.siteId] as const);
  return { talks: views, stats, choices, now };
}

/** Une causerie du site sélectionné et du périmètre (feuille d'émargement imprimable), null sinon. */
export async function loadSafetyTalk(id: string) {
  const all = await loadSafetyTalks();
  return all?.talks.find((x) => x.id === id) ?? null;
}

/** Feuilles d'émargement de la personne connectée (« Mon espace ») : à signer, puis les signées de l'année écoulée. */
export async function loadMyTalks() {
  const { user } = await getSession();
  const db = await getDb();
  const rows = await db.select({ talk: t.safetyTalks, signedAt: t.safetyTalkParticipants.signedAt, notifiedAt: t.safetyTalkParticipants.notifiedAt })
    .from(t.safetyTalkParticipants).innerJoin(t.safetyTalks, eq(t.safetyTalks.id, t.safetyTalkParticipants.talkId))
    .where(eq(t.safetyTalkParticipants.personId, user.id)).orderBy(desc(t.safetyTalks.heldOn), asc(t.safetyTalks.id));
  const people = await loadPeople();
  const now = today();
  const since = `${Number(now.slice(0, 4)) - 1}${now.slice(4)}`;
  return rows.filter((r) => !r.talk.cancelledAt && r.talk.heldOn <= now && (!r.signedAt || r.talk.heldOn >= since)).map((r) => ({
    id: r.talk.id, theme: r.talk.theme, heldOn: r.talk.heldOn, animator: people.get(r.talk.animatorId)?.name ?? '',
    signedAt: r.signedAt ? toParisLocal(r.signedAt) : null, requested: !!r.notifiedAt,
  }));
}
export type MyTalk = Awaited<ReturnType<typeof loadMyTalks>>[number];
