'use server';

import { revalidatePath } from 'next/cache';
import { and, count, eq, isNull, ne } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  BSD_NUMBER, BSD_STATUS_KEYS, CONSUMPTION_KINDS, TREATMENT_KEYS, WASTE_UNIT_KEYS, isHazardousCode, normalizeEwc,
} from '@/components/environment/model';
import { fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { formReader, nextRef, type FormState } from '@/lib/forms';
import { STEP_CLOSED, canEdit } from '@/lib/domain';
import { requireInSite, requireManager } from '@/lib/guard';
import { currentPersonId } from '@/lib/session';
import { diffFields, logChange } from './changelog';

const MAX_QUANTITY = 9_999_999_999;
const MAX_CONSUMPTION = 999_999_999;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Saisie réservée aux rôles qui ont accès à l'écran « Environnement et déchets » (hors salariés et lecture seule). */
async function requireEnvManager(): Promise<string | null> {
  const { session, error } = await requireManager();
  return error ?? (canEdit(session.role, 'env') ? null : 'Votre rôle ne permet pas cette modification.');
}

const ENTRY_LABELS = {
  streamId: 'Filière', removedOn: "Date d'enlèvement", quantity: 'Quantité', transporter: 'Transporteur',
  bsdNumber: 'N° de bordereau', bsdStatus: 'Statut du bordereau', notes: 'Observations', eventId: 'Événement lié',
} as const;

async function siteIds() {
  const db = await getDb();
  return (await db.select({ id: t.sites.id }).from(t.sites)).map((s) => s.id);
}

// ─── Registre des déchets ───────────────────────────────────────────────────

/**
 * Inscrit ou modifie un enlèvement au registre chronologique. Le site est celui de la filière ;
 * le transporteur vaut par défaut le collecteur de la filière. Le code déchet, le code de traitement
 * et l'exutoire de la filière sont copiés à l'inscription (et à chaque changement de filière). Un numéro
 * de BSD ne peut figurer que sur un seul enlèvement non annulé. L'événement lié est un événement environnemental
 * ouvert du site de la filière (un lien existant est conservé tel quel, même si l'événement a été clôturé depuis).
 */
export async function saveWasteEntry(_prev: FormState, fd: FormData): Promise<FormState> {
  const error = await requireEnvManager();
  if (error) return { error };
  const db = await getDb();
  const f = formReader(fd);
  const id = f.int('id', { min: 1 });
  const streamId = f.str('streamId', { required: true });
  const removedOn = f.date('removedOn', { required: true });
  const rawQuantity = f.num('quantity', { required: true, min: 0 });
  // Arrondi au centième (échelle de la colonne) avant contrôle : 0,004 serait enregistré 0.
  const quantity = rawQuantity == null ? null : Math.round(rawQuantity * 100) / 100;
  let transporter = f.str('transporter', { max: 160 });
  const bsdNumber = f.str('bsdNumber', { max: 40 }).replace(/\s+/g, '').toUpperCase() || null;
  let bsdStatus = f.oneOf('bsdStatus', BSD_STATUS_KEYS);
  const notes = f.str('notes', { max: 1000 }) || null;
  const eventId = f.opt('eventId');

  if (removedOn && removedOn > today()) f.fail('removedOn', "Le registre consigne les déchets sortis : date postérieure à aujourd'hui.");
  if (removedOn && removedOn < '2000-01-01') f.fail('removedOn', 'Date invalide.');
  if (quantity != null && quantity <= 0) f.fail('quantity', 'Quantité strictement positive attendue (0,01 minimum).');
  if (quantity != null && quantity > MAX_QUANTITY) f.fail('quantity', 'Quantité trop élevée.');
  if (bsdNumber && !BSD_NUMBER.test(bsdNumber)) f.fail('bsdNumber', 'Lettres, chiffres et tirets (ex. BSD-20260312-7KQ4P2XR).');
  if (bsdStatus && !bsdNumber) f.fail('bsdNumber', 'Numéro du bordereau requis pour indiquer son statut.');
  if (bsdNumber && !bsdStatus) bsdStatus = 'emis';

  const [current] = id ? await db.select().from(t.wasteEntries).where(eq(t.wasteEntries.id, id)) : [];
  if (id && !current) return { error: 'Enlèvement introuvable.' };
  if (current?.cancelledAt) return { error: "Enlèvement annulé : il n'est plus modifiable." };
  const [stream] = streamId ? await db.select().from(t.wasteStreams).where(eq(t.wasteStreams.id, streamId)) : [];
  if (streamId && !stream) f.fail('streamId', 'Filière inconnue.');
  if (stream && !transporter) transporter = stream.collector;
  // Nouveau lien (ou enlèvement passé sur une filière d'un autre site) : mêmes règles que la liste proposée par le formulaire.
  const relinked = eventId !== (current?.eventId ?? null);
  if (eventId && (relinked || (stream && stream.siteId !== current?.siteId))) {
    const [ev] = await db.select({ type: t.events.type, siteId: t.events.siteId, step: t.events.step, dismissedAt: t.events.dismissedAt })
      .from(t.events).where(eq(t.events.id, eventId));
    if (!ev) f.fail('eventId', 'Événement introuvable.');
    else if (ev.type !== 'ENV') f.fail('eventId', 'Seul un événement environnemental peut être lié.');
    else if (stream && ev.siteId !== stream.siteId) f.fail('eventId', "Événement d'un autre site que la filière.");
    else if (relinked && (ev.dismissedAt || ev.step >= STEP_CLOSED)) f.fail('eventId', 'Événement clôturé ou classé sans suite.');
  }

  if (bsdNumber) {
    // Un enlèvement annulé (erreur de filière, doublon) libère son numéro pour l'inscription corrigée.
    const [dup] = await db.select({ id: t.wasteEntries.id, removedOn: t.wasteEntries.removedOn, streamId: t.wasteEntries.streamId })
      .from(t.wasteEntries)
      .where(and(eq(t.wasteEntries.bsdNumber, bsdNumber), isNull(t.wasteEntries.cancelledAt), id ? ne(t.wasteEntries.id, id) : undefined));
    if (dup) f.fail('bsdNumber', `Bordereau déjà inscrit pour l'enlèvement du ${fmtDate(dup.removedOn)}.`);
  }
  if (!f.ok) return f.state();
  const siteError = (current && (await requireInSite(current.siteId))) || (await requireInSite(stream!.siteId, { create: !current || current.siteId !== stream!.siteId }));
  if (siteError) return { error: siteError };

  // Copies figées du code déchet, du code de traitement et de l'exutoire : prises sur la filière à l'inscription,
  // reprises seulement si l'enlèvement change de filière (modifier la filière ne réécrit pas le registre).
  const frozen = !current || current.streamId !== stream!.id
    ? { ewcCode: stream!.ewcCode, treatmentCode: stream!.treatmentCode, destination: stream!.destination }
    : {};
  const values = {
    siteId: stream!.siteId, streamId: stream!.id, removedOn: removedOn!, quantity: quantity!,
    transporter, bsdNumber, bsdStatus: bsdNumber ? bsdStatus : null, notes, eventId, ...frozen,
  };
  const label = `${stream!.label} du ${fmtDate(removedOn!)}`;
  const savedId = await db.transaction(async (tx) => {
    if (current) {
      const [row] = await tx.update(t.wasteEntries).set(values).where(and(eq(t.wasteEntries.id, current.id), isNull(t.wasteEntries.cancelledAt)))
        .returning({ id: t.wasteEntries.id });
      if (!row) return null;
      const details = diffFields(current, values, ENTRY_LABELS, (v) => (v == null || v === '' ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmtDate(String(v)) : String(v)));
      if (details.length) await logChange(tx, { entityType: 'waste_entry', entityId: row.id, action: 'update', summary: 'Enlèvement modifié', details });
      return row.id;
    }
    const [row] = await tx.insert(t.wasteEntries).values(values).returning({ id: t.wasteEntries.id });
    await logChange(tx, { entityType: 'waste_entry', entityId: row.id, action: 'create', summary: `Inscription au registre : ${label}` });
    return row.id;
  });
  if (savedId == null) return { error: 'Enlèvement annulé entre-temps : rouvrez le registre.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(savedId) };
}

/**
 * Annule un enlèvement inscrit par erreur (doublon, saisie erronée) : la ligne reste au registre avec qui, quand
 * et pourquoi (R. 541-43, conservation 3 ans), mais sort des indicateurs, des échéances et de l'export.
 */
export async function cancelWasteEntry(_prev: FormState, fd: FormData): Promise<FormState> {
  const error = await requireEnvManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.int('id', { required: true, min: 1 });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [entry] = await db.select().from(t.wasteEntries).where(eq(t.wasteEntries.id, id!));
  if (!entry) return { error: 'Enlèvement introuvable.' };
  if (entry.cancelledAt) return { error: 'Cet enlèvement est déjà annulé.' };
  const siteError = await requireInSite(entry.siteId);
  if (siteError) return { error: siteError };
  const done = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.wasteEntries).set({ cancelledAt: new Date(), cancelledById: await currentPersonId(), cancelReason: reason })
      .where(and(eq(t.wasteEntries.id, entry.id), isNull(t.wasteEntries.cancelledAt))).returning({ id: t.wasteEntries.id });
    if (!row) return false;
    await logChange(tx, { entityType: 'waste_entry', entityId: entry.id, action: 'cancel', summary: 'Enlèvement annulé', reason });
    return true;
  });
  if (!done) return { error: 'Cet enlèvement est déjà annulé.' };
  revalidatePath('/', 'layout');
  return { ok: true, id: String(entry.id) };
}

// ─── Filières ───────────────────────────────────────────────────────────────

/**
 * Crée ou modifie une filière déchets. « Dangereux » découle du code (astérisque).
 * Dès qu'un enlèvement est inscrit, le site et l'unité sont verrouillés : les enlèvements n'en gardent pas
 * de copie, les modifier réécrirait le registre chronologique (R. 541-43) et les quantités passées.
 * Le code déchet, le code de traitement et l'exutoire restent modifiables : chaque enlèvement en conserve
 * la copie faite à son inscription (registre, BSD exigés par R. 541-45 et taux de valorisation passés inchangés).
 */
export async function saveWasteStream(_prev: FormState, fd: FormData): Promise<FormState> {
  const error = await requireEnvManager();
  if (error) return { error };
  const db = await getDb();
  const sites = await siteIds();
  const f = formReader(fd);
  const id = f.opt('id');
  const [current] = id ? await db.select().from(t.wasteStreams).where(eq(t.wasteStreams.id, id)) : [];
  if (id && !current) return { error: 'Filière introuvable (supprimée entre-temps ?).' };
  const currentSiteError = current ? await requireInSite(current.siteId) : null;
  if (currentSiteError) return { error: currentSiteError };
  const [{ n: used }] = current
    ? await db.select({ n: count() }).from(t.wasteEntries).where(eq(t.wasteEntries.streamId, current.id))
    : [{ n: 0 }];
  const locked = used > 0;

  const label = f.str('label', { required: true, max: 120 });
  const rawCode = f.str('ewcCode', { required: true, max: 20 });
  const treatmentCode = f.oneOf('treatmentCode', TREATMENT_KEYS, { required: true });
  const channel = f.str('channel', { required: true, max: 80 });
  const collector = f.str('collector', { required: true, max: 160 });
  const destination = f.str('destination', { required: true, max: 200 });
  const siteId = locked ? current!.siteId : f.oneOf('siteId', sites, { required: true });
  const unit = locked ? current!.unit : f.oneOf('unit', WASTE_UNIT_KEYS, { required: true });

  const ewcCode = rawCode ? normalizeEwc(rawCode) : null;
  if (rawCode && !ewcCode) f.fail('ewcCode', 'Code à 6 chiffres de la liste européenne, suivi de * si dangereux (ex. 13 01 10*).');
  if (siteId && label) {
    const same = await db.select({ id: t.wasteStreams.id, label: t.wasteStreams.label }).from(t.wasteStreams).where(eq(t.wasteStreams.siteId, siteId));
    if (same.some((s) => s.id !== id && s.label.toLocaleLowerCase('fr') === label.toLocaleLowerCase('fr'))) f.fail('label', 'Une filière porte déjà ce libellé sur ce site.');
  }
  if (!f.ok) return f.state();
  if (!current || current.siteId !== siteId) {
    const siteError = await requireInSite(siteId, { create: true });
    if (siteError) return { error: siteError, fieldErrors: { siteId: 'Site non autorisé.' } };
  }

  const values = {
    label, ewcCode: ewcCode!, hazardous: isHazardousCode(ewcCode!), treatmentCode: treatmentCode!, channel, collector, destination,
    siteId: siteId!, unit: unit!,
  };
  let savedId = id;
  if (current) {
    await db.update(t.wasteStreams).set(values).where(eq(t.wasteStreams.id, current.id));
  } else {
    const ids = (await db.select({ id: t.wasteStreams.id }).from(t.wasteStreams)).map((s) => s.id);
    savedId = nextRef(ids, 'FD-', 2);
    await db.insert(t.wasteStreams).values({ id: savedId, ...values });
  }
  revalidatePath('/', 'layout');
  return { ok: true, id: savedId ?? undefined };
}

/** Supprime une filière qui ne porte aucun enlèvement (le registre est conservé tel quel). */
export async function deleteWasteStream(id: string): Promise<{ error?: string }> {
  const error = await requireEnvManager();
  if (error) return { error };
  if (typeof id !== 'string' || !id) return { error: 'Filière introuvable.' };
  const db = await getDb();
  const [stream] = await db.select({ siteId: t.wasteStreams.siteId }).from(t.wasteStreams).where(eq(t.wasteStreams.id, id));
  if (!stream) return { error: 'Filière introuvable (déjà supprimée ?).' };
  const siteError = await requireInSite(stream.siteId);
  if (siteError) return { error: siteError };
  // Les enlèvements annulés comptent aussi : ils restent au registre et référencent la filière.
  const [{ n }] = await db.select({ n: count() }).from(t.wasteEntries).where(eq(t.wasteEntries.streamId, id));
  if (n > 0) return { error: `Cette filière porte ${n} enlèvement${n > 1 ? 's' : ''} au registre : elle ne peut pas être supprimée.` };
  const deleted = await db.delete(t.wasteStreams).where(eq(t.wasteStreams.id, id)).returning({ id: t.wasteStreams.id });
  if (!deleted.length) return { error: 'Filière introuvable (déjà supprimée ?).' };
  revalidatePath('/', 'layout');
  return {};
}

// ─── Consommations ──────────────────────────────────────────────────────────

/**
 * Saisit les relevés d'un mois pour un site (électricité, gaz, eau). Une valeur saisie remplace
 * la précédente ; un champ vidé efface le relevé correspondant.
 */
export async function saveConsumptionMonth(_prev: FormState, fd: FormData): Promise<FormState> {
  const error = await requireEnvManager();
  if (error) return { error };
  const sites = await siteIds();
  const f = formReader(fd);
  const siteId = f.oneOf('siteId', sites, { required: true });
  const rawMonth = f.str('month', { required: true });
  const values = CONSUMPTION_KINDS.map((k) => ({ kind: k.key, value: f.num(k.key, { min: 0 }) }));

  const m = MONTH.exec(rawMonth);
  const month = m ? `${m[1]}-${m[2]}-01` : null;
  if (rawMonth && !month) f.fail('month', 'Mois invalide.');
  if (month && month > `${today().slice(0, 7)}-01`) f.fail('month', 'Mois à venir : saisissez les relevés une fois le mois commencé.');
  if (month && month < '2000-01-01') f.fail('month', 'Mois invalide.');
  values.forEach((v) => { if (v.value != null && v.value > MAX_CONSUMPTION) f.fail(v.kind, 'Valeur trop élevée.'); });
  if (!f.ok) return f.state();
  const siteError = await requireInSite(siteId, { create: true });
  if (siteError) return { error: siteError };

  const db = await getDb();
  const existing = await db.select({ kind: t.consumptions.kind }).from(t.consumptions)
    .where(and(eq(t.consumptions.siteId, siteId!), eq(t.consumptions.month, month!)));
  if (values.every((v) => v.value == null) && !existing.length) {
    return { error: 'Saisissez au moins un relevé.', fieldErrors: { [CONSUMPTION_KINDS[0].key]: 'Valeur attendue.' } };
  }

  await db.transaction(async (tx) => {
    for (const { kind, value } of values) {
      const key = and(eq(t.consumptions.siteId, siteId!), eq(t.consumptions.month, month!), eq(t.consumptions.kind, kind));
      if (value == null) {
        await tx.delete(t.consumptions).where(key);
      } else {
        const v = Math.round(value * 100) / 100;
        await tx.insert(t.consumptions).values({ siteId: siteId!, month: month!, kind, value: v })
          .onConflictDoUpdate({ target: [t.consumptions.siteId, t.consumptions.month, t.consumptions.kind], set: { value: v } });
      }
    }
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: `${siteId}|${month}` };
}
