'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, max } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import { fromParisLocal, referenceNow, toParisLocal } from '@/lib/dates';
import { canSeeEventType, canSee } from '@/lib/domain';
import { formReader, type FormState } from '@/lib/forms';
import { requireInSite } from '@/lib/guard';
import { getSession } from '@/lib/session';
import { today } from '@/lib/today';
import {
  DGI_READ_DENIED, DGI_RECORD_DENIED, DGI_SIGN_DENIED, canHandleDgi, canReadDgi, canRecordDgi, canSignDgi, reportedAtError,
} from '@/lib/rules/dgi';
import { QHSE_ONLY } from '@/lib/edit-rights';
import { logChange } from './changelog';

// Registre des dangers graves et imminents (CNF-01) : avis consigné par un membre du CSE (signé à la saisie) ou recopié par
// l'animateur QHSE (à signer ensuite par un membre du CSE), mesures de l'employeur et clôture par l'animateur QHSE,
// annulation motivée d'une saisie erronée (jamais supprimé). Site du périmètre de la personne (requireInSite) ; journal
// `dgi_notice` dans la transaction de chaque écriture. Accès : canReadDgi (src/lib/rules/dgi.ts), jamais par le seul écran.

const NOTICE_MISSING = 'Avis introuvable.';
const CANCELLED = 'Avis annulé : il reste au registre en consultation seule.';
const CLOSED = 'Avis clos : il reste au registre en consultation seule.';

const fail = (field: string, message: string): FormState => ({ error: 'Certains champs sont à corriger.', fieldErrors: { [field]: message } });

/** Avis chargé pour une écriture : lecteur du registre, site du périmètre et sélectionné, ni annulé ni clos. */
async function loadNotice(id: number | null) {
  const session = await getSession();
  if (!canReadDgi(session)) return { session, notice: null, error: DGI_READ_DENIED } as const;
  if (!id) return { session, notice: null, error: NOTICE_MISSING } as const;
  const db = await getDb();
  const [notice] = await db.select().from(t.dgiNotices).where(eq(t.dgiNotices.id, id));
  if (!notice) return { session, notice: null, error: NOTICE_MISSING } as const;
  const siteError = await requireInSite(notice.siteId);
  if (siteError) return { session, notice: null, error: siteError } as const;
  if (notice.cancelledAt) return { session, notice: null, error: CANCELLED } as const;
  if (notice.closedAt) return { session, notice: null, error: CLOSED } as const;
  return { session, notice, error: null } as const;
}

/**
 * Consigne un avis de danger grave et imminent au registre du site : date et heure, postes concernés, nature et cause du
 * danger, noms des travailleurs exposés, représentant du CSE, événement lié (facultatif, du même site). Saisi par un membre
 * du CSE : signé d'emblée par lui ; recopié par l'animateur QHSE : à signer par un membre du CSE.
 */
export async function recordDgiNotice(_prev: FormState, fd: FormData): Promise<FormState> {
  const session = await getSession();
  if (!canRecordDgi(session)) return { error: canReadDgi(session) ? DGI_RECORD_DENIED : DGI_READ_DENIED };
  const f = formReader(fd);
  const siteId = f.str('siteId', { required: true });
  const reportedLocal = f.str('reportedAt', { required: true });
  const workstations = f.str('workstations', { required: true, max: 500 });
  const danger = f.str('danger', { required: true, max: 4000 });
  const exposedWorkers = f.str('exposedWorkers', { required: true, max: 2000 });
  const representativeName = f.str('representativeName', { required: true, max: 120 });
  const eventId = f.opt('eventId');
  const nowLocal = toParisLocal(referenceNow(today()));
  const dateError = reportedAtError(reportedLocal || null, nowLocal);
  if (dateError) f.fail('reportedAt', dateError);
  if (!f.ok) return f.state();
  const siteError = await requireInSite(siteId, { create: true });
  if (siteError) return { error: siteError, fieldErrors: { siteId: 'Site non autorisé.' } };
  const db = await getDb();
  if (eventId) {
    const [ev] = await db.select({ siteId: t.events.siteId, type: t.events.type }).from(t.events).where(eq(t.events.id, eventId));
    // Événement d'un autre site, maladie professionnelle (hors rôles habilités), ou écran fermé : même réponse.
    if (!ev || ev.siteId !== siteId || !canSee(session.role, 'events') || !canSeeEventType(session.role, ev.type)) return fail('eventId', 'Événement introuvable sur ce site.');
  }
  const reportedAt = fromParisLocal(reportedLocal)!;
  const signs = session.cse;
  const id = await db.transaction(async (tx) => {
    const [{ last }] = await tx.select({ last: max(t.dgiNotices.number) }).from(t.dgiNotices).where(eq(t.dgiNotices.siteId, siteId));
    const number = (last ?? 0) + 1;
    const [row] = await tx.insert(t.dgiNotices).values({
      siteId, number, reportedAt, workstations, danger, exposedWorkers, representativeName, eventId,
      createdById: session.user.id, ...(signs ? { signedAt: new Date(), signedById: session.user.id } : {}),
    }).returning({ id: t.dgiNotices.id });
    await logChange(tx, {
      entityType: 'dgi_notice', entityId: row.id, action: 'create', byId: session.user.id,
      summary: `Avis n° ${number} consigné au registre des dangers graves et imminents${signs ? ' et signé par le représentant du CSE' : ' (à signer par un membre du CSE)'}`,
    });
    return row.id;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(id), message: signs ? 'Avis consigné et signé.' : 'Avis consigné : à signer par un membre du CSE.' };
}

/** Signature d'un avis recopié par l'animateur QHSE, par un membre du CSE (horodatée, sa session seulement). */
export async function signDgiNotice(_prev: FormState, fd: FormData): Promise<FormState> {
  const f = formReader(fd);
  const { session, notice, error } = await loadNotice(f.int('id', { min: 1 }));
  if (!notice) return { error };
  if (!canSignDgi(session)) return { error: DGI_SIGN_DENIED };
  if (notice.signedAt) return { error: 'Avis déjà signé.' };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.dgiNotices).set({ signedAt: new Date(), signedById: session.user.id }).where(and(eq(t.dgiNotices.id, notice.id)));
    await logChange(tx, { entityType: 'dgi_notice', entityId: notice.id, action: 'sign', byId: session.user.id, summary: `Avis n° ${notice.number} signé par le représentant du CSE` });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(notice.id), message: 'Avis signé.' };
}

/** Mesures prises par l'employeur (animateur QHSE) : texte obligatoire ; une nouvelle saisie remplace la précédente (journal). */
export async function saveDgiMeasures(_prev: FormState, fd: FormData): Promise<FormState> {
  const f = formReader(fd);
  const measures = f.str('measures', { required: true, max: 4000 });
  const { session, notice, error } = await loadNotice(f.int('id', { min: 1 }));
  if (!notice) return { error };
  if (!canHandleDgi(session)) return { error: QHSE_ONLY };
  if (!f.ok) return f.state();
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.dgiNotices).set({ measures, measuresAt: new Date(), measuresById: session.user.id }).where(eq(t.dgiNotices.id, notice.id));
    await logChange(tx, {
      entityType: 'dgi_notice', entityId: notice.id, action: 'update', byId: session.user.id,
      summary: notice.measures ? `Mesures de l'employeur modifiées (avis n° ${notice.number})` : `Mesures de l'employeur consignées (avis n° ${notice.number})`,
      ...(notice.measures ? { details: [{ field: 'Mesures prises', from: notice.measures, to: measures }] } : {}),
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(notice.id), message: 'Mesures consignées.' };
}

/** Clôture d'un avis signé dont les mesures de l'employeur sont consignées (animateur QHSE). */
export async function closeDgiNotice(_prev: FormState, fd: FormData): Promise<FormState> {
  const f = formReader(fd);
  const { session, notice, error } = await loadNotice(f.int('id', { min: 1 }));
  if (!notice) return { error };
  if (!canHandleDgi(session)) return { error: QHSE_ONLY };
  if (!notice.signedAt) return { error: 'Avis non signé par le représentant du CSE : faites-le signer avant de le clore.' };
  if (!notice.measuresAt) return { error: 'Consignez les mesures prises par l’employeur avant de clore l’avis.' };
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.dgiNotices).set({ closedAt: new Date(), closedById: session.user.id }).where(eq(t.dgiNotices.id, notice.id));
    await logChange(tx, { entityType: 'dgi_notice', entityId: notice.id, action: 'status', byId: session.user.id, summary: `Avis n° ${notice.number} clos` });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(notice.id), message: 'Avis clos.' };
}

/** Annule un avis saisi par erreur (motif obligatoire ; jamais supprimé, numéro jamais réattribué) : animateur QHSE. */
export async function cancelDgiNotice(_prev: FormState, fd: FormData): Promise<FormState> {
  const f = formReader(fd);
  const reason = f.reason();
  const { session, notice, error } = await loadNotice(f.int('id', { min: 1 }));
  if (!notice) return { error };
  if (!canHandleDgi(session)) return { error: QHSE_ONLY };
  if (!f.ok) return f.state();
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(t.dgiNotices).set({ cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: reason }).where(eq(t.dgiNotices.id, notice.id));
    await logChange(tx, { entityType: 'dgi_notice', entityId: notice.id, action: 'cancel', byId: session.user.id, reason, summary: `Avis n° ${notice.number} annulé` });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: String(notice.id), message: 'Avis annulé.' };
}
