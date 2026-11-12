'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { MY_SPACE_PATH } from '@/lib/auth/paths';
import { config } from '@/lib/config';
import { fmtDate } from '@/lib/dates';
import { formReader, type FormState } from '@/lib/forms';
import { requireEditor, requireInSite } from '@/lib/guard';
import { log } from '@/lib/log';
import { createTransport } from '@/lib/mail/transport';
import { hasLeft } from '@/lib/people';
import { publicOrigin } from '@/lib/public-url';
import { loadPeople } from '@/lib/queries';
import {
  MY_TALKS_ANCHOR, TALK_DURATION_MAX, TALK_PARTICIPANTS_MAX, attendanceEmail, isMailAddress, sheetBlocker, talkDateError,
} from '@/lib/rules/safety-talks';
import { getSession } from '@/lib/session';
import { today } from '@/lib/today';
import { diffFields, logChange } from './changelog';
import { nextEntityReference } from './references';
import { VERSION_FIELD, assertFresh, freshWrite } from './versions';

// Causeries et quarts d'heure sécurité (CNF-09) : saisie, modification et annulation motivée par l'encadrement qui saisit
// la prévention (requireEditor('prevention') : QHSE, direction, chefs de service et de projet), sur un site du périmètre
// (requireInSite) ; envoi de la feuille d'émargement aux participants qui n'ont pas signé (notification de la cloche et
// e-mail par le transport configuré : « aucun » = cloche seulement, dit à l'envoi) ; signature par le participant lui-même
// (sa session seulement, horodatée). Journal `safety_talk` dans la transaction de chaque écriture.

const TALK_MISSING = 'Causerie introuvable.';
const LABELS = { siteId: 'Site', heldOn: 'Date', theme: 'Thème', animatorId: 'Animateur', durationMinutes: 'Durée (min)', notes: 'Notes' } as const;

const requireTalkEditor = () => requireEditor('prevention');

/** Causerie modifiable : existante, du site sélectionné et du périmètre, non annulée. */
async function editableTalk(id: string) {
  const db = await getDb();
  const [talk] = await db.select().from(t.safetyTalks).where(eq(t.safetyTalks.id, id));
  if (!talk) return { talk: null, error: TALK_MISSING } as const;
  const siteError = await requireInSite(talk.siteId);
  if (siteError) return { talk: null, error: siteError } as const;
  if (talk.cancelledAt) return { talk: null, error: 'Causerie annulée : consultation seule.' } as const;
  return { talk, error: null } as const;
}

/**
 * Crée ou modifie une causerie : site, date, thème, animateur (personne présente), durée, participants (personnes présentes,
 * au plus 200), notes. Un participant qui a signé ne se retire plus (refus) ; un participant retiré avant sa signature sort
 * de la feuille (journal).
 */
export async function saveSafetyTalk(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireTalkEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.opt('id');
  const siteId = f.str('siteId', { required: true });
  const heldOn = f.date('heldOn', { required: true });
  const theme = f.str('theme', { required: true, max: 200 });
  const animatorId = f.str('animatorId', { required: true });
  const durationMinutes = f.int('durationMinutes', { required: true, min: 1, max: TALK_DURATION_MAX });
  const notes = f.str('notes', { max: 4000 });
  const participantIds = [...new Set(f.list('participants'))];
  const dateError = heldOn ? talkDateError(heldOn, today()) : null;
  if (dateError) f.fail('heldOn', dateError);
  if (participantIds.length > TALK_PARTICIPANTS_MAX) f.fail('participants', `${TALK_PARTICIPANTS_MAX} participants au plus.`);
  const people = await loadPeople();
  const now = today();
  const present = (pid: string) => { const p = people.get(pid); return !!p && !hasLeft(p, now); };
  if (!f.ok) return f.state();

  const db = await getDb();
  const current = id ? await editableTalk(id) : null;
  if (current && !current.talk) return { error: current.error };
  const before = current?.talk ?? null;
  if (!before || before.siteId !== siteId) {
    const siteError = await requireInSite(siteId, { create: true });
    if (siteError) return { error: siteError, fieldErrors: { siteId: 'Site non autorisé.' } };
  }
  // Animateur ou participant sorti de l'effectif : seulement s'il est déjà porté par la causerie (valeur enregistrée).
  const existing = before ? await db.select().from(t.safetyTalkParticipants).where(eq(t.safetyTalkParticipants.talkId, before.id)) : [];
  if (!present(animatorId) && animatorId !== before?.animatorId) f.fail('animatorId', 'Personne inconnue ou sortie de l’effectif.');
  if (participantIds.some((pid) => !present(pid) && !existing.some((e) => e.personId === pid))) f.fail('participants', 'Participant inconnu ou sorti de l’effectif.');
  const removedSigned = existing.filter((e) => e.signedAt && !participantIds.includes(e.personId));
  if (removedSigned.length) f.fail('participants', `Émargement déjà signé : ${removedSigned.map((e) => people.get(e.personId)?.name ?? e.personId).join(', ')} ne peut plus être retiré.`);
  if (!f.ok) return f.state();

  const values = { siteId, heldOn: heldOn!, theme, animatorId, durationMinutes: durationMinutes!, notes };
  const name = (pid: string) => people.get(pid)?.name ?? pid;
  if (before) {
    const added = participantIds.filter((pid) => !existing.some((e) => e.personId === pid));
    const removed = existing.filter((e) => !participantIds.includes(e.personId)).map((e) => e.personId);
    const details = [
      ...diffFields({ ...before, animatorId: name(before.animatorId) }, { ...before, ...values, animatorId: name(values.animatorId) }, LABELS, (v) => (v == null || v === '' ? null : String(v))),
      ...(added.length ? [{ field: 'Participants ajoutés', from: null, to: added.map(name).join(', ') }] : []),
      ...(removed.length ? [{ field: 'Participants retirés', from: removed.map(name).join(', '), to: null }] : []),
    ];
    const stale = await freshWrite(() => db.transaction(async (tx) => {
      await assertFresh(tx, 'safety_talk', before.id, fd.get(VERSION_FIELD));
      await tx.update(t.safetyTalks).set(values).where(eq(t.safetyTalks.id, before.id));
      if (removed.length) await tx.delete(t.safetyTalkParticipants).where(and(eq(t.safetyTalkParticipants.talkId, before.id), inArray(t.safetyTalkParticipants.personId, removed), isNull(t.safetyTalkParticipants.signedAt)));
      if (added.length) await tx.insert(t.safetyTalkParticipants).values(added.map((personId) => ({ talkId: before.id, personId })));
      if (details.length) await logChange(tx, { entityType: 'safety_talk', entityId: before.id, action: 'update', byId: session.user.id, summary: 'Causerie modifiée', details });
    }));
    if (stale) return { error: stale };
    revalidatePath('/', 'layout');
    return { ok: true, id: before.id };
  }
  const newId = await db.transaction(async (tx) => {
    const ref = await nextEntityReference(tx, 'safety_talk', 'CS-', 3);
    await tx.insert(t.safetyTalks).values({ id: ref, ...values, createdById: session.user.id });
    if (participantIds.length) await tx.insert(t.safetyTalkParticipants).values(participantIds.map((personId) => ({ talkId: ref, personId })));
    await logChange(tx, {
      entityType: 'safety_talk', entityId: ref, action: 'create', byId: session.user.id,
      summary: `Causerie « ${theme} » du ${fmtDate(values.heldOn)} enregistrée (${participantIds.length} participant${participantIds.length > 1 ? 's' : ''})`,
    });
    return ref;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: newId };
}

/** Annule une causerie saisie par erreur ou qui n'a pas eu lieu (motif ; jamais supprimée). */
export async function cancelSafetyTalk(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireTalkEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const { talk, error: talkError } = await editableTalk(id);
  if (!talk) return { error: talkError };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.safetyTalks).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.safetyTalks.id, talk.id));
    await logChange(tx, { entityType: 'safety_talk', entityId: talk.id, action: 'cancel', byId: session.user.id, reason, summary: `Causerie « ${talk.theme} » annulée` });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: talk.id, message: 'Causerie annulée.' };
}

/**
 * Envoie la feuille d'émargement aux participants qui n'ont pas encore signé : une notification de la cloche chacun
 * (« Mon espace »), et un e-mail à ceux dont l'adresse est connue quand un transport est configuré (VIGIE_MAIL_TRANSPORT).
 * Renvoi possible (nouvelle notification aux seuls non-signataires). Échec d'un e-mail : compté, jamais bloquant.
 */
export async function sendAttendanceSheet(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, error } = await requireTalkEditor();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  if (!f.ok) return f.state();
  const { talk, error: talkError } = await editableTalk(id);
  if (!talk) return { error: talkError };
  const db = await getDb();
  const participants = await db.select().from(t.safetyTalkParticipants).where(eq(t.safetyTalkParticipants.talkId, talk.id));
  const blocked = sheetBlocker({ heldOn: talk.heldOn, cancelled: false, participants: participants.length }, today());
  if (blocked) return { error: blocked };
  const pending = participants.filter((p) => !p.signedAt);
  if (!pending.length) return { error: 'Tous les participants ont déjà signé.' };
  const people = await loadPeople();
  const [site] = await db.select({ label: t.sites.label }).from(t.sites).where(eq(t.sites.id, talk.siteId));
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const p of pending) {
      await tx.insert(t.notifications).values({
        personId: p.personId, type: 'causerie_emargement', entityType: 'safety_talk', entityId: talk.id, byId: session.user.id,
        title: `Feuille d'émargement à signer : ${talk.theme} (${fmtDate(talk.heldOn)})`, href: `${MY_SPACE_PATH}#${MY_TALKS_ANCHOR}`,
      });
    }
    await tx.update(t.safetyTalkParticipants).set({ notifiedAt: now }).where(and(eq(t.safetyTalkParticipants.talkId, talk.id), isNull(t.safetyTalkParticipants.signedAt)));
    await tx.update(t.safetyTalks).set({ sheetSentAt: now, sheetSentById: session.user.id }).where(eq(t.safetyTalks.id, talk.id));
    await logChange(tx, {
      entityType: 'safety_talk', entityId: talk.id, action: 'send', byId: session.user.id,
      summary: `Feuille d'émargement envoyée à ${pending.length} participant${pending.length > 1 ? 's' : ''}`,
    });
  });
  // E-mails, après la transaction (jamais d'envoi pour une écriture annulée).
  const c = config();
  const transport = createTransport(c);
  let mailed = 0;
  let failed = 0;
  let noAddress = 0;
  if (transport) {
    const link = `${await publicOrigin()}${MY_SPACE_PATH}#${MY_TALKS_ANCHOR}`;
    const animator = people.get(talk.animatorId)?.name ?? '';
    for (const p of pending) {
      const person = people.get(p.personId);
      const to = [person?.cursusEmail, person?.email].find(isMailAddress);
      if (!to) { noAddress++; continue; }
      try {
        await transport.send({ id: `causerie-${talk.id}-${p.personId}-${now.getTime()}`, to, from: c.mailFrom, ...attendanceEmail({ id: talk.id, theme: talk.theme, heldOn: talk.heldOn, site: site?.label ?? talk.siteId, animator, link }) });
        mailed++;
      } catch (err) {
        failed++;
        log.error('safety-talk.mail', "Échec d'envoi d'une feuille d'émargement", { talk: talk.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  log.info('safety-talk.sheet', "Feuille d'émargement envoyée", { talk: talk.id, notified: pending.length, mailed, failed, noAddress });
  revalidatePath('/', 'layout');
  const mail = !transport ? 'aucun e-mail (envoi d’e-mails non configuré)'
    : `${mailed} e-mail${mailed > 1 ? 's' : ''}${noAddress ? `, ${noAddress} sans adresse` : ''}${failed ? `, ${failed} en échec` : ''}`;
  return { ok: true, id: talk.id, message: `Feuille d'émargement envoyée à ${pending.length} participant${pending.length > 1 ? 's' : ''} (cloche ; ${mail}).` };
}

/** Signature de la feuille d'émargement par le participant lui-même (sa session), horodatée ; toute personne connectée. */
export async function signSafetyTalk(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await getSession();
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  if (!f.ok) return f.state();
  const db = await getDb();
  const [row] = await db.select({ talk: t.safetyTalks, signedAt: t.safetyTalkParticipants.signedAt }).from(t.safetyTalkParticipants)
    .innerJoin(t.safetyTalks, eq(t.safetyTalks.id, t.safetyTalkParticipants.talkId))
    .where(and(eq(t.safetyTalkParticipants.talkId, id), eq(t.safetyTalkParticipants.personId, session.user.id)));
  // Causerie d'autrui ou inconnue : même réponse, rien n'est révélé.
  if (!row) return { error: TALK_MISSING };
  if (row.talk.cancelledAt) return { error: 'Causerie annulée.' };
  if (row.signedAt) return { error: 'Feuille d’émargement déjà signée.' };
  if (row.talk.heldOn > today()) return { error: 'La feuille d’émargement se signe une fois la causerie tenue.' };
  await db.transaction(async (tx) => {
    await tx.update(t.safetyTalkParticipants).set({ signedAt: new Date() })
      .where(and(eq(t.safetyTalkParticipants.talkId, id), eq(t.safetyTalkParticipants.personId, session.user.id), isNull(t.safetyTalkParticipants.signedAt)));
    await tx.update(t.notifications).set({ readAt: new Date() })
      .where(and(eq(t.notifications.personId, session.user.id), eq(t.notifications.entityType, 'safety_talk'), eq(t.notifications.entityId, id), isNull(t.notifications.readAt)));
    await logChange(tx, { entityType: 'safety_talk', entityId: id, action: 'sign', byId: session.user.id, summary: `Émargement signé par ${session.user.name}` });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id, message: 'Feuille d’émargement signée.' };
}
