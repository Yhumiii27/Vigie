'use server';

import { revalidatePath } from 'next/cache';
import { and, count, eq, isNull, ne } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  BSD_NUMBER, BSD_REFUSALS, BSD_STATUS_KEYS, CONSUMPTION_KINDS, bsdRefusalErrors, QUALIFICATION_KEYS, TREATMENT_KEYS, WASTE_UNIT_KEYS, defaultQualification, isHazardousCode, isTransitCode,
  normalizeEwc, qualificationError, qualificationLabel, resolveMentions,
} from '@/components/environment/model';
import { fmtDate } from '@/lib/dates';
import { today } from '@/lib/today';
import { formReader, type FormState } from '@/lib/forms';
import { STEP_CLOSED, canEdit } from '@/lib/domain';
import { requireApprover, requireInSite, requireManager } from '@/lib/guard';
import { currentPersonId } from '@/lib/session';
import { fmtSiret, isEuVatNumber, isSiret, normalizeSiret } from '@/lib/siret';
import { diffFields, logChange } from './changelog';
import { nextEntityReference } from './references';

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
  transporterSiret: 'SIRET du transporteur', transporterAddress: 'Adresse du transporteur', transporterReceipt: 'N° de récépissé',
  pickupAddress: 'Adresse de prise en charge', qualification: 'Qualification du traitement final',
  bsdNumber: 'N° de bordereau', bsdStatus: 'Statut du bordereau', notes: 'Observations', eventId: 'Événement lié',
  bsdRefusedQuantity: 'Quantité refusée', bsdRefusalReason: 'Motif du refus',
} as const;

const STREAM_LABELS = {
  label: 'Libellé', ewcCode: 'Code déchet', treatmentCode: 'Code de traitement', qualification: 'Qualification du traitement final',
  channel: 'Filière de traitement', collector: 'Collecteur', collectorSiret: 'SIRET du collecteur', collectorAddress: 'Adresse du collecteur',
  collectorReceipt: 'N° de récépissé (collecteur)', destination: 'Installation de destination', destinationSiret: "SIRET de l'installation",
  destinationAddress: "Adresse de l'installation", pop: 'POP', siteId: 'Site', unit: 'Unité',
} as const;

/** Valeur affichée au journal : dates jj/mm/aaaa, cases Oui / Non. */
const fmtLog = (v: unknown) =>
  v == null || v === '' ? null : typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmtDate(String(v)) : String(v);

/** Qualification et SIRET d'un enregistrement tels que le journal les affiche (libellé, « NNN NNN NNN NNNNN »). */
const forLog = <T extends Record<string, unknown>>(row: T, sirets: (keyof T)[]): T => ({
  ...row,
  ...('qualification' in row ? { qualification: qualificationLabel(row.qualification as string | null) } : {}),
  ...Object.fromEntries(sirets.map((k) => [k, row[k] ? fmtSiret(String(row[k])) : row[k]])),
});

async function siteIds() {
  const db = await getDb();
  return (await db.select({ id: t.sites.id }).from(t.sites)).map((s) => s.id);
}

const SIRET_INVALID = 'SIRET invalide : 14 chiffres, clé de contrôle incorrecte.';
const COMPANY_ID_INVALID = "Identifiant invalide : SIRET (14 chiffres) ou n° de TVA intracommunautaire d'une entreprise étrangère.";

/**
 * Identifiant d'un établissement (registre des déchets) : SIRET, ou n° de TVA intracommunautaire d'une entreprise
 * étrangère (`foreign` : transporteur, installation). Vide = non renseigné (mention signalée manquante au registre).
 */
function readCompanyId(f: ReturnType<typeof formReader>, name: string, { foreign }: { foreign: boolean }): string | null {
  const v = normalizeSiret(f.str(name, { max: 40 }));
  if (!v) return null;
  if (isSiret(v) || (foreign && isEuVatNumber(v))) return v;
  f.fail(name, foreign ? COMPANY_ID_INVALID : SIRET_INVALID);
  return null;
}

// ─── Registre des déchets ───────────────────────────────────────────────────

/**
 * Inscrit ou modifie un enlèvement au registre chronologique. Le site est celui de la filière ;
 * le transporteur vaut par défaut le collecteur de la filière, avec ses mentions (SIRET, adresse, récépissé). Le code
 * déchet, le code de traitement, l'exutoire et ses mentions (SIRET, adresse), la mention POP et la qualification du
 * traitement final de la filière sont copiés à l'inscription (et à chaque changement de filière). Un numéro
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
  let transporterSiret = readCompanyId(f, 'transporterSiret', { foreign: true });
  let transporterAddress = f.str('transporterAddress', { max: 300 }) || null;
  let transporterReceipt = f.str('transporterReceipt', { max: 60 }) || null;
  const pickupAddress = f.str('pickupAddress', { max: 300 }) || null;
  const qualificationInput = f.oneOf('qualification', QUALIFICATION_KEYS);
  const bsdNumber = f.str('bsdNumber', { max: 40 }).replace(/\s+/g, '').toUpperCase() || null;
  let bsdStatus = f.oneOf('bsdStatus', BSD_STATUS_KEYS);
  // DOC-12 : refus total ou partiel du déchet par l'installation (motif, quantité refusée).
  const rawRefused = f.num('bsdRefusedQuantity', { min: 0 });
  const refusedInput = rawRefused == null ? null : Math.round(rawRefused * 100) / 100;
  const refusalInput = f.str('bsdRefusalReason', { max: 300 }) || null;
  const notes = f.str('notes', { max: 1000 }) || null;
  const eventId = f.opt('eventId');

  if (removedOn && removedOn > today()) f.fail('removedOn', "Le registre consigne les déchets sortis : date postérieure à aujourd'hui.");
  if (removedOn && removedOn < '2000-01-01') f.fail('removedOn', 'Date invalide.');
  if (quantity != null && quantity <= 0) f.fail('quantity', 'Quantité strictement positive attendue (0,01 minimum).');
  if (quantity != null && quantity > MAX_QUANTITY) f.fail('quantity', 'Quantité trop élevée.');
  if (bsdNumber && !BSD_NUMBER.test(bsdNumber)) f.fail('bsdNumber', 'Lettres, chiffres et tirets (ex. BSD-20260312-7KQ4P2XR).');
  if (bsdStatus && !bsdNumber) f.fail('bsdNumber', 'Numéro du bordereau requis pour indiquer son statut.');
  if (bsdNumber && !bsdStatus) bsdStatus = 'emis';
  for (const [k, msg] of Object.entries(bsdRefusalErrors(bsdNumber ? bsdStatus : null, quantity, refusedInput, refusalInput))) f.fail(k, msg);
  const refused = bsdNumber && bsdStatus && BSD_REFUSALS.includes(bsdStatus);
  const bsdRefusedQuantity = refused ? (bsdStatus === 'refuse' ? quantity : refusedInput) : null;
  const bsdRefusalReason = refused ? refusalInput : null;

  const [current] = id ? await db.select().from(t.wasteEntries).where(eq(t.wasteEntries.id, id)) : [];
  if (id && !current) return { error: 'Enlèvement introuvable.' };
  if (current?.cancelledAt) return { error: "Enlèvement annulé : il n'est plus modifiable." };
  const [stream] = streamId ? await db.select().from(t.wasteStreams).where(eq(t.wasteStreams.id, streamId)) : [];
  if (streamId && !stream) f.fail('streamId', 'Filière inconnue.');
  // Filière archivée (DOC-09) : plus de nouvel enlèvement ; un enlèvement déjà inscrit dessus reste modifiable.
  else if (stream?.archivedAt && stream.id !== current?.streamId) f.fail('streamId', 'Filière archivée : réactivez-la ou choisissez une filière en service.');
  if (stream && !transporter) transporter = stream.collector;
  // Transporteur = collecteur de la filière : ses mentions (SIRET, adresse, récépissé) complètent celles laissées vides.
  if (stream && transporter === stream.collector) {
    transporterSiret ??= stream.collectorSiret;
    transporterAddress ??= stream.collectorAddress;
    transporterReceipt ??= stream.collectorReceipt;
  }
  // Copies figées (code de traitement, exutoire, mentions) : prises sur la filière à l'inscription et à chaque changement
  // de filière ; sinon celles de l'enlèvement, complétées si vides par la valeur de la filière qui vaut pour lui.
  const frozen = !!stream && (!current || current.streamId !== stream.id);
  const resolved = stream && current && !frozen ? resolveMentions(current, stream) : null;
  const treatmentCode = stream ? (frozen ? stream.treatmentCode : current?.treatmentCode ?? stream.treatmentCode) : null;
  const qualification = qualificationInput ?? (frozen ? stream?.qualification ?? null : current?.qualification ?? resolved?.qualification ?? null);
  const badQualification = treatmentCode ? qualificationError(treatmentCode, qualification) : null;
  if (badQualification) f.fail('qualification', badQualification);
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

  // Copies figées du code déchet, du code de traitement, de l'exutoire et de ses mentions : prises sur la filière à
  // l'inscription, reprises seulement si l'enlèvement change de filière (modifier la filière ne réécrit pas le registre) ;
  // une copie vide d'une inscription antérieure est complétée, jamais remplacée.
  const copies = frozen
    ? {
      ewcCode: stream!.ewcCode, treatmentCode: stream!.treatmentCode, destination: stream!.destination, pop: stream!.pop,
      destinationSiret: stream!.destinationSiret, destinationAddress: stream!.destinationAddress,
    }
    : { pop: resolved!.pop, destinationSiret: resolved!.destinationSiret, destinationAddress: resolved!.destinationAddress };
  const values = {
    siteId: stream!.siteId, streamId: stream!.id, removedOn: removedOn!, quantity: quantity!,
    transporter, transporterSiret, transporterAddress, transporterReceipt, pickupAddress, qualification,
    bsdNumber, bsdStatus: bsdNumber ? bsdStatus : null, bsdRefusedQuantity, bsdRefusalReason, notes, eventId, ...copies,
  };
  const label = `${stream!.label} du ${fmtDate(removedOn!)}`;
  const savedId = await db.transaction(async (tx) => {
    if (current) {
      const [row] = await tx.update(t.wasteEntries).set(values).where(and(eq(t.wasteEntries.id, current.id), isNull(t.wasteEntries.cancelledAt)))
        .returning({ id: t.wasteEntries.id });
      if (!row) return null;
      const details = diffFields(forLog(current, ['transporterSiret']), forLog(values, ['transporterSiret']), ENTRY_LABELS, fmtLog);
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
 * Le code déchet, le code de traitement, l'exutoire et les mentions de l'arrêté du 31 mai 2021 (collecteur, installation,
 * qualification, POP) restent modifiables : chaque enlèvement en conserve la copie faite à son inscription (registre, BSD
 * exigés par R. 541-45 et taux de valorisation passés inchangés). Création et modifications journalisées (waste_stream).
 */
export async function saveWasteStream(_prev: FormState, fd: FormData): Promise<FormState> {
  const error = await requireEnvManager();
  if (error) return { error };
  const db = await getDb();
  const sites = await siteIds();
  const f = formReader(fd);
  const id = f.opt('id');
  const [current] = id ? await db.select().from(t.wasteStreams).where(eq(t.wasteStreams.id, id)) : [];
  if (id && !current) return { error: 'Filière introuvable.' };
  if (current?.archivedAt) return { error: 'Filière archivée : réactivez-la pour la modifier.' };
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
  // Mentions de l'arrêté du 31 mai 2021, copiées sur chaque enlèvement à son inscription.
  const pop = f.bool('pop');
  const collectorSiret = readCompanyId(f, 'collectorSiret', { foreign: true });
  const collectorAddress = f.str('collectorAddress', { max: 300 }) || null;
  const collectorReceipt = f.str('collectorReceipt', { max: 60 }) || null;
  const destinationSiret = readCompanyId(f, 'destinationSiret', { foreign: true });
  const destinationAddress = f.str('destinationAddress', { max: 300 }) || null;
  // Qualification : proposée d'après le code de traitement, à préciser à chaque enlèvement pour une opération de transit.
  const chosen = f.oneOf('qualification', QUALIFICATION_KEYS);
  const qualification = chosen ?? (treatmentCode && !isTransitCode(treatmentCode) ? defaultQualification(treatmentCode) : null);
  const badQualification = treatmentCode ? qualificationError(treatmentCode, qualification) : null;
  if (badQualification) f.fail('qualification', badQualification);

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
    siteId: siteId!, unit: unit!, pop, qualification, collectorSiret, collectorAddress, collectorReceipt, destinationSiret, destinationAddress,
  };
  const savedId = await db.transaction(async (tx) => {
    if (current) {
      const siteLabels = new Map((await tx.select({ id: t.sites.id, label: t.sites.label }).from(t.sites)).map((s) => [s.id, s.label]));
      const view = <T extends { siteId: string }>(row: T) => ({ ...forLog(row, ['collectorSiret', 'destinationSiret'] as (keyof T)[]), siteId: siteLabels.get(row.siteId) ?? row.siteId });
      const details = diffFields(view(current), view({ ...current, ...values }), STREAM_LABELS, fmtLog);
      await tx.update(t.wasteStreams).set(values).where(eq(t.wasteStreams.id, current.id));
      if (details.length) await logChange(tx, { entityType: 'waste_stream', entityId: current.id, action: 'update', summary: 'Filière modifiée', details });
      return current.id;
    }
    const newId = await nextEntityReference(tx, 'waste_stream', 'FD-', 2);
    await tx.insert(t.wasteStreams).values({ id: newId, ...values });
    await logChange(tx, { entityType: 'waste_stream', entityId: newId, action: 'create', summary: `Filière créée : ${label}` });
    return newId;
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: savedId };
}

/**
 * Archive une filière (DOC-09 : jamais supprimée) : motif obligatoire. Elle n'est plus proposée pour un nouvel enlèvement ;
 * ses enlèvements (registre conservé 3 ans, R. 541-43), ses actions et son historique restent consultables.
 */
export async function archiveWasteStream(_prev: FormState, fd: FormData): Promise<FormState> {
  const error = await requireEnvManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [stream] = await db.select().from(t.wasteStreams).where(eq(t.wasteStreams.id, id));
  if (!stream) return { error: 'Filière introuvable.' };
  if (stream.archivedAt) return { error: 'Cette filière est déjà archivée.' };
  const siteError = await requireInSite(stream.siteId);
  if (siteError) return { error: siteError };
  const byId = await currentPersonId();
  const archived = await db.transaction(async (tx) => {
    const [row] = await tx.update(t.wasteStreams).set({ archivedAt: new Date(), archivedById: byId, archiveReason: reason })
      .where(and(eq(t.wasteStreams.id, id), isNull(t.wasteStreams.archivedAt))).returning({ id: t.wasteStreams.id });
    if (row) await logChange(tx, { entityType: 'waste_stream', entityId: id, action: 'archive', summary: `Filière archivée : ${stream.label}`, reason, byId });
    return !!row;
  });
  if (!archived) return { error: 'Cette filière est déjà archivée.' };
  revalidatePath('/', 'layout');
  return { ok: true, id };
}

/** Réactive une filière archivée (motif obligatoire) ; son site doit être actif et dans le périmètre. */
export async function restoreWasteStream(_prev: FormState, fd: FormData): Promise<FormState> {
  const error = await requireEnvManager();
  if (error) return { error };
  const f = formReader(fd);
  const id = f.str('id', { required: true });
  const reason = f.reason();
  if (!f.ok) return f.state();
  const db = await getDb();
  const [stream] = await db.select().from(t.wasteStreams).where(eq(t.wasteStreams.id, id));
  if (!stream) return { error: 'Filière introuvable.' };
  if (!stream.archivedAt) return { error: "Cette filière n'est pas archivée." };
  const siteError = await requireInSite(stream.siteId, { create: true });
  if (siteError) return { error: siteError };
  const byId = await currentPersonId();
  await db.transaction(async (tx) => {
    await tx.update(t.wasteStreams).set({ archivedAt: null, archivedById: null, archiveReason: null }).where(eq(t.wasteStreams.id, id));
    await logChange(tx, { entityType: 'waste_stream', entityId: id, action: 'restore', summary: `Filière réactivée : ${stream.label}`, reason, byId });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id };
}

// ─── Établissement ──────────────────────────────────────────────────────────

/**
 * SIRET d'un site (établissement), première mention du registre des déchets (arrêté du 31 mai 2021) : animateur QHSE et
 * direction. Un site archivé reste modifiable : son registre est dû 3 ans (R. 541-43). Vide = SIRET retiré.
 */
export async function saveSiteSiret(_prev: FormState, fd: FormData): Promise<FormState> {
  const { error } = await requireApprover();
  if (error) return { error };
  const f = formReader(fd);
  const siteId = f.str('siteId', { required: true });
  const siret = readCompanyId(f, 'siret', { foreign: false });
  if (!f.ok) return f.state();
  const db = await getDb();
  const [site] = await db.select({ id: t.sites.id, siret: t.sites.siret }).from(t.sites).where(eq(t.sites.id, siteId));
  if (!site) return { error: 'Site inconnu.', fieldErrors: { siteId: 'Site inconnu.' } };
  const siteError = await requireInSite(site.id);
  if (siteError) return { error: siteError };
  if ((site.siret ?? null) === siret) return { ok: true, id: site.id };

  await db.transaction(async (tx) => {
    await tx.update(t.sites).set({ siret }).where(eq(t.sites.id, site.id));
    await logChange(tx, {
      entityType: 'site', entityId: site.id, action: 'update',
      summary: !siret ? "SIRET de l'établissement retiré" : site.siret ? "SIRET de l'établissement modifié" : "SIRET de l'établissement renseigné",
      details: [{ field: 'SIRET', from: site.siret ? fmtSiret(site.siret) : null, to: siret ? fmtSiret(siret) : null }],
    });
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: site.id };
}

// ─── Consommations ──────────────────────────────────────────────────────────

const fmtNumber = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const monthLabel = (iso: string) => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

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
    // DOC-10 : relevés du mois journalisés (valeur précédente → nouvelle), dans la transaction de l'écriture.
    const before = new Map((await tx.select().from(t.consumptions).where(and(eq(t.consumptions.siteId, siteId!), eq(t.consumptions.month, month!))))
      .map((c) => [c.kind, c.value]));
    const details: { field: string; from: string | null; to: string | null }[] = [];
    for (const { kind, value } of values) {
      const key = and(eq(t.consumptions.siteId, siteId!), eq(t.consumptions.month, month!), eq(t.consumptions.kind, kind));
      const v = value == null ? null : Math.round(value * 100) / 100;
      const prev = before.get(kind) ?? null;
      if (v === prev) continue;
      const k = CONSUMPTION_KINDS.find((c) => c.key === kind)!;
      details.push({ field: `${k.label} (${k.unit})`, from: prev == null ? null : fmtNumber(prev), to: v == null ? null : fmtNumber(v) });
      if (v == null) {
        await tx.delete(t.consumptions).where(key);
      } else {
        await tx.insert(t.consumptions).values({ siteId: siteId!, month: month!, kind, value: v })
          .onConflictDoUpdate({ target: [t.consumptions.siteId, t.consumptions.month, t.consumptions.kind], set: { value: v } });
      }
    }
    if (details.length) {
      await logChange(tx, {
        entityType: 'consumption', entityId: `${siteId}|${month}`, action: before.size ? 'update' : 'create',
        summary: `Relevés de ${monthLabel(month!)} ${before.size ? 'modifiés' : 'saisis'}`, details,
      });
    }
  });
  revalidatePath('/', 'layout');
  return { ok: true, id: `${siteId}|${month}` };
}
