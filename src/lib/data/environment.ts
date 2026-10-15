import 'server-only';
import { cache } from 'react';
import { asc, isNotNull } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import type { ChangeEntry } from '@/components/ChangeLog';
import {
  BSD_PENDING, BSD_STALE_DAYS, BSD_STATUS, BSD_STATUS_KEYS, CONSUMPTION_KINDS, READING_DUE_DAY, REGISTER_MENTIONS_FROM, entryRef, fmtQty, isBsdStatus,
  isHazardousCode, isRecovery, monthLong, monthShort, qualificationLabel, registerGaps, resolveMentions, shiftMonth, streamGaps, toRegisterQuantity, toTonnes,
  treatmentLabel, type BsdStatus, type ConsumptionKind,
} from '@/components/environment/model';
import { hrefWith } from '@/components/ui';
import { addDays, daysBetween, fmtDate, fmtDayMonth } from '../dates';
import { today } from '@/lib/today';
import type { ActionDefaults } from '../action-view';
import { EVENT_STEPS, ORIGIN_REF_MAX, REQUIREMENT_EVAL, isClosedActionStatus, severityTone, type TodoItem, type Tone } from '../domain';
import { actionView, isOpen, lcfirst, loadActions, loadEvents, loadPeople, type ActionRow } from '../queries';
import { currentSiteId, siteFilter, type SiteScope } from '../session';
import { loadChangeLogs } from './changelog';

// ─── Environnement et déchets ───────────────────────────────────────────────
// Registre chronologique des déchets sortants (C. env. R. 541-43, arrêté du 31 mai 2021),
// bordereaux Trackdéchets des déchets dangereux (R. 541-45) et consommations d'énergie et d'eau.
// Les indicateurs sont calculés à partir du registre et des relevés, jamais stockés.

export type StreamView = {
  id: string;
  siteId: string;
  site: string;
  label: string;
  ewcCode: string;
  hazardous: boolean;
  unit: string;
  treatmentCode: string;
  treatmentLabel: string;
  recovery: boolean;
  channel: string;
  collector: string;
  destination: string;
  /** Mentions de l'arrêté du 31 mai 2021 proposées par défaut à chaque enlèvement (copiées à l'inscription). */
  pop: boolean;
  qualification: string | null;
  qualificationLabel: string | null;
  collectorSiret: string | null;
  collectorAddress: string | null;
  collectorReceipt: string | null;
  destinationSiret: string | null;
  destinationAddress: string | null;
  /** Valeurs par défaut absentes (streamGaps) : chaque enlèvement devrait les compléter. */
  gaps: string[];
  /** Enlèvements inscrits au registre, toutes années confondues. */
  entryCount: number;
  /** Enlèvements annulés, restés au registre : avec entryCount, verrouillent le site et l'unité et empêchent la suppression. */
  cancelledCount: number;
  /** Quantités (dans l'unité de la filière) de l'année affichée et de l'année précédente. */
  yearQty: number;
  prevQty: number;
  /** Année précédente arrêtée à la même date (année en cours), sinon année complète : base de comparaison. */
  prevPeriodQty: number;
  yearCount: number;
  lastRemovedOn: string | null;
  /** Actions du plan rattachées à la filière ou à l'un de ses enlèvements (source « Déchets »), abandonnées exclues. */
  actions: EnvAction[];
  /** Actions créées depuis la filière (wasteStreamId), abandonnées et autres sites compris : empêchent la suppression. */
  sourceActionCount: number;
  /** Journal des modifications de la filière (création, valeurs par défaut des mentions…). */
  history: ChangeEntry[];
};

/** Action rattachée : libellé court (actionLabel du détail), avancement affiché (« En retard » le cas échéant), date cible. */
export type EnvAction = {
  id: string; label: string; statusLabel: string; tone: Tone; dueOn: string; pilot: string; ref: string;
  /** Source de l'action (ACT-01) : filière ou enlèvement du registre. */
  wasteStreamId: string | null; wasteEntryId: number | null;
};

export type EntryView = {
  id: number;
  siteId: string;
  site: string;
  streamId: string;
  stream: string;
  /** Code déchet, code de traitement et exutoire : copies enregistrées à l'inscription (à défaut, ceux de la filière). */
  ewcCode: string;
  /** Code déchet avec astérisque ou filière dangereuse. */
  hazardous: boolean;
  unit: string;
  quantity: number;
  /** Masse en tonnes (null pour une quantité en volume). */
  tonnes: number | null;
  removedOn: string;
  year: number;
  /** SIRET de l'établissement (site de l'enlèvement), mention du registre. */
  siteSiret: string | null;
  transporter: string;
  destination: string;
  channel: string;
  treatmentCode: string;
  recovery: boolean;
  /**
   * Mentions de l'arrêté du 31 mai 2021 : copie de l'enlèvement, à défaut valeur de la filière quand elle vaut pour lui
   * (transporteur resté le collecteur, même installation, même code de traitement : resolveMentions).
   */
  pop: boolean;
  qualification: string | null;
  qualificationLabel: string | null;
  pickupAddress: string | null;
  transporterSiret: string | null;
  transporterAddress: string | null;
  transporterReceipt: string | null;
  destinationSiret: string | null;
  destinationAddress: string | null;
  /** Mentions obligatoires manquantes (registerGaps) ; vide pour un enlèvement annulé ou antérieur à 2022. */
  gaps: string[];
  bsdNumber: string | null;
  bsdStatus: BsdStatus | null;
  bsdLabel: string | null;
  bsdTone: Tone;
  /** Déchet dangereux sans bordereau Trackdéchets. */
  missingBsd: boolean;
  /** Bordereau encore brouillon, émis ou collecté plus de BSD_STALE_DAYS jours après l'enlèvement. */
  staleBsd: boolean;
  /** Jours écoulés depuis l'enlèvement. */
  age: number;
  notes: string | null;
  /** Référence d'origine d'une nouvelle action rattachée (« FD-11 · 19/08/2026 », suffixée « · n° 42 » si la filière a plusieurs enlèvements ce jour-là). */
  ref: string;
  eventId: string | null;
  /** Annulation tracée (doublon, erreur de saisie) : la ligne reste au registre, hors indicateurs et export. */
  cancelled: { at: string; by: string; reason: string } | null;
};

/** Enlèvement de l'écran, avec ses actions, son événement d'origine et son historique. */
export type EntryDetail = EntryView & { actions: EnvAction[]; event: { id: string; title: string } | null; history: ChangeEntry[] };

/** Événement proposé dans le champ « Événement lié » d'un enlèvement. */
export type EventOption = { id: string; label: string; siteId: string };

export type ConsumptionRecord = { siteId: string; month: string; kind: ConsumptionKind; value: number };

const KIND_KEYS = new Set<string>(CONSUMPTION_KINDS.map((k) => k.key));
const WASTE_REQUIREMENT = /R\.\s?541-4|déchet/i;

/**
 * Filières, registre et relevés du site sélectionné (scope 'site' ; « Tous les sites » consolide) ou de tout le périmètre
 * (scope 'perimeter' : échéances, TDB-05).
 */
const loadEnvironmentBase = cache(async (scope: SiteScope = 'site') => {
  const db = await getDb();
  const now = today();
  const [site, keep, sites, streamRows, entryRows, consumptionRows, people] = await Promise.all([
    currentSiteId(),
    siteFilter(scope),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
    db.select().from(t.wasteStreams),
    db.select().from(t.wasteEntries),
    db.select().from(t.consumptions),
    loadPeople(),
  ]);
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));
  const siteSiret = new Map(sites.map((s) => [s.id, s.siret]));
  const streams = streamRows.filter((s) => keep(s.siteId));
  const streamById = new Map(streamRows.map((s) => [s.id, s]));
  // Enlèvements d'une même filière le même jour (annulés compris) : la référence courte « FD-11 · 19/08/2026 » ne suffit plus.
  const sameDay = new Map<string, number[]>();
  [...entryRows].sort((a, b) => a.id - b.id).forEach((e) => {
    const key = `${e.streamId}|${e.removedOn}`;
    sameDay.set(key, [...(sameDay.get(key) ?? []), e.id]);
  });

  const all: EntryView[] = entryRows
    .filter((e) => keep(e.siteId))
    .flatMap((e) => {
      const s = streamById.get(e.streamId);
      if (!s) return [];
      // Copies figées à l'inscription, à défaut les valeurs actuelles de la filière.
      const ewcCode = e.ewcCode ?? s.ewcCode;
      const treatmentCode = e.treatmentCode ?? s.treatmentCode;
      const hazardous = isHazardousCode(ewcCode) || s.hazardous;
      const status = isBsdStatus(e.bsdStatus) ? e.bsdStatus : null;
      const live = !e.cancelledAt;
      const missingBsd = live && hazardous && !e.bsdNumber;
      const age = daysBetween(e.removedOn, now);
      const group = sameDay.get(`${e.streamId}|${e.removedOn}`) ?? [e.id];
      const short = entryRef(s.id, e.removedOn);
      const long = entryRef(s.id, e.removedOn, e.id);
      const mentions = resolveMentions(e, s);
      const destination = e.destination ?? s.destination;
      const siret = siteSiret.get(e.siteId) ?? null;
      return [{
        id: e.id,
        siteId: e.siteId,
        site: siteLabel.get(e.siteId) ?? e.siteId,
        streamId: s.id,
        stream: s.label,
        ewcCode,
        hazardous,
        unit: s.unit,
        quantity: e.quantity,
        tonnes: toTonnes(e.quantity, s.unit),
        removedOn: e.removedOn,
        year: +e.removedOn.slice(0, 4),
        siteSiret: siret,
        transporter: e.transporter,
        destination,
        channel: s.channel,
        treatmentCode,
        recovery: isRecovery(treatmentCode),
        ...mentions,
        qualificationLabel: qualificationLabel(mentions.qualification),
        pickupAddress: e.pickupAddress,
        gaps: live ? registerGaps({ removedOn: e.removedOn, siteSiret: siret, ...mentions }) : [],
        bsdNumber: e.bsdNumber,
        bsdStatus: status,
        bsdLabel: missingBsd ? 'BSD manquant' : status ? BSD_STATUS[status].label : null,
        bsdTone: missingBsd ? 'danger' : status ? BSD_STATUS[status].tone : 'neutral',
        missingBsd,
        staleBsd: live && hazardous && !!e.bsdNumber && !!status && BSD_PENDING.includes(status) && age > BSD_STALE_DAYS,
        age,
        notes: e.notes,
        ref: group.length > 1 ? long : short,
        eventId: e.eventId,
        cancelled: e.cancelledAt
          ? { at: e.cancelledAt.toISOString(), by: e.cancelledById ? people.get(e.cancelledById)?.name ?? e.cancelledById : '—', reason: e.cancelReason ?? '' }
          : null,
      } satisfies EntryView];
    })
    .sort((a, b) => b.removedOn.localeCompare(a.removedOn) || b.id - a.id);
  const entries = all.filter((e) => !e.cancelled);
  const cancelled = all.filter((e) => e.cancelled);

  const consumptions: ConsumptionRecord[] = consumptionRows
    .filter((c) => keep(c.siteId) && KIND_KEYS.has(c.kind))
    .map((c) => ({ siteId: c.siteId, month: c.month, kind: c.kind as ConsumptionKind, value: c.value }));

  // Sites archivés : plus de relevés attendus (leur registre reste consultable sous « Tous les sites »).
  const scopeSites = sites.filter((s) => !s.archivedAt && keep(s.id)).map((s) => ({ id: s.id, label: s.label }));
  // Graphiques et tableaux : sites actifs, plus les sites archivés qui ont des relevés (mêmes données que les cumuls annuels).
  const withReadings = new Set(consumptions.map((c) => c.siteId));
  const consumptionSites = sites.filter((s) => keep(s.id) && (!s.archivedAt || withReadings.has(s.id)))
    .map((s) => ({ id: s.id, label: s.label, archived: !!s.archivedAt }));
  // Registre : établissements du périmètre, actifs ou archivés avec des enlèvements (registre conservé 3 ans, R. 541-43).
  const withEntries = new Set(entries.map((e) => e.siteId));
  const registrySites = sites.filter((s) => keep(s.id) && (!s.archivedAt || withEntries.has(s.id)))
    .map((s) => ({ id: s.id, label: s.label, siret: s.siret, archived: !!s.archivedAt }));
  return { now, site, sites: scopeSites, consumptionSites, registrySites, siteLabel, streams, entries, cancelled, consumptions, people };
});

/** Exigences en vigueur de la veille relatives aux déchets (R. 541-43 / R. 541-45…), toute l'entreprise ; un texte abrogé (archivé) est écarté. */
const loadWasteRequirements = cache(async () => {
  const db = await getDb();
  const rows = await db.select().from(t.requirements).orderBy(asc(t.requirements.sort), asc(t.requirements.id));
  return rows.filter((r) => !r.archivedAt && (WASTE_REQUIREMENT.test(r.text) || WASTE_REQUIREMENT.test(r.domain)));
});

const sum = (values: number[]) => values.reduce((n, v) => n + v, 0);
const tonnesOf = (rows: EntryView[]) => sum(rows.map((e) => e.tonnes ?? 0));

// ─── Écran « Environnement et déchets » ─────────────────────────────────────

export async function loadEnvironment(requestedYear?: number) {
  const now = today();
  const currentYear = +now.slice(0, 4);
  const [{ site, sites, consumptionSites, registrySites, siteLabel, streams, entries, cancelled, consumptions, people }, events, actions, requirements, streamSources] = await Promise.all([
    loadEnvironmentBase(), loadEvents(), loadActions(), loadWasteRequirements(),
    // Sources des actions (abandonnées comprises) : seule la présence compte, pour verrouiller la suppression d'une filière.
    getDb().then((db) => db.select({ streamId: t.actions.wasteStreamId }).from(t.actions).where(isNotNull(t.actions.wasteStreamId))),
  ]);

  const years = [...new Set([currentYear, ...entries.map((e) => e.year)])].filter((y) => y <= currentYear).sort((a, b) => b - a);
  const year = requestedYear && requestedYear >= 2000 && requestedYear <= currentYear ? requestedYear : currentYear;
  const isCurrent = year === currentYear;
  const periodNote = isCurrent ? `au ${fmtDayMonth(now)}` : 'année complète';

  // ── Registre de l'année
  const yearEntries = entries.filter((e) => e.year === year);
  const sameDayPrev = `${year - 1}${now.slice(4)}`;
  const prevEntries = entries.filter((e) => e.year === year - 1 && (!isCurrent || e.removedOn <= sameDayPrev));
  const totalT = tonnesOf(yearEntries);
  const prevT = tonnesOf(prevEntries);
  const hazardousT = tonnesOf(yearEntries.filter((e) => e.hazardous));
  const recoveryT = tonnesOf(yearEntries.filter((e) => e.recovery));
  const volumeCount = yearEntries.filter((e) => e.tonnes == null).length;
  const missing = yearEntries.filter((e) => e.missingBsd);
  const missingOther = entries.filter((e) => e.missingBsd && e.year !== year);
  const stale = yearEntries.filter((e) => e.staleBsd);
  const staleOther = entries.filter((e) => e.staleBsd && e.year !== year);

  // ── Actions rattachées par leur source (colonnes posées à la création, ACT-01) : filière (wasteStreamId) ou enlèvement
  // (wasteEntryId) ; une filière liste aussi les actions de ses enlèvements, annulés compris.
  const brief = (a: ActionRow): EnvAction => {
    const v = actionView(a, people, now);
    return {
      id: a.id, label: v.label, statusLabel: v.statusLabel, tone: v.tone, dueOn: a.dueOn, pilot: v.pilot, ref: a.originRef,
      wasteStreamId: a.wasteStreamId, wasteEntryId: a.wasteEntryId,
    };
  };
  const envActions = actions.filter((a) => a.wasteStreamId || a.wasteEntryId != null)
    .sort((a, b) => b.id.localeCompare(a.id, 'fr', { numeric: true })).map(brief);
  const streamOfEntry = new Map([...entries, ...cancelled].map((e) => [e.id, e.streamId]));
  const streamActions = (id: string) => envActions
    .filter((a) => a.wasteStreamId === id || (a.wasteEntryId != null && streamOfEntry.get(a.wasteEntryId) === id));

  // ── Filières avec cumuls annuels
  const streamHistory = await loadChangeLogs('waste_stream', streams.map((s) => s.id));
  const streamViews: StreamView[] = streams.map((s) => {
    const mine = entries.filter((e) => e.streamId === s.id);
    const inYear = mine.filter((e) => e.year === year);
    return {
      id: s.id, siteId: s.siteId, site: siteLabel.get(s.siteId) ?? s.siteId, label: s.label, ewcCode: s.ewcCode, hazardous: s.hazardous,
      unit: s.unit, treatmentCode: s.treatmentCode, treatmentLabel: treatmentLabel(s.treatmentCode), recovery: isRecovery(s.treatmentCode),
      channel: s.channel, collector: s.collector, destination: s.destination,
      pop: s.pop, qualification: s.qualification, qualificationLabel: qualificationLabel(s.qualification),
      collectorSiret: s.collectorSiret, collectorAddress: s.collectorAddress, collectorReceipt: s.collectorReceipt,
      destinationSiret: s.destinationSiret, destinationAddress: s.destinationAddress,
      gaps: streamGaps(s),
      entryCount: mine.length,
      cancelledCount: cancelled.filter((e) => e.streamId === s.id).length,
      yearQty: sum(inYear.map((e) => e.quantity)),
      prevQty: sum(mine.filter((e) => e.year === year - 1).map((e) => e.quantity)),
      prevPeriodQty: sum(mine.filter((e) => e.year === year - 1 && (!isCurrent || e.removedOn <= sameDayPrev)).map((e) => e.quantity)),
      yearCount: inYear.length,
      lastRemovedOn: mine[0]?.removedOn ?? null,
      actions: streamActions(s.id),
      sourceActionCount: streamSources.filter((a) => a.streamId === s.id).length,
      history: streamHistory.get(s.id) ?? [],
    };
  }).sort((a, b) => a.siteId.localeCompare(b.siteId) || Number(b.hazardous) - Number(a.hazardous) || a.id.localeCompare(b.id, 'fr', { numeric: true }));

  // ── Consommations : 12 derniers mois et cumul de l'année comparé à N-1 sur les mêmes mois
  const currentMonth = `${now.slice(0, 7)}-01`;
  const value = new Map(consumptions.map((c) => [`${c.siteId}|${c.month}|${c.kind}`, c.value]));
  const latest = consumptions.map((c) => c.month).filter((m) => m <= currentMonth).sort().at(-1);
  const lastMonth = latest && latest > shiftMonth(currentMonth, -1) ? latest : shiftMonth(currentMonth, -1);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(lastMonth, i - 11));

  const compare = (kind: ConsumptionKind) => {
    const keys = consumptions.filter((c) => c.kind === kind && c.month.startsWith(`${year}-`) && c.month <= currentMonth);
    const cur = sum(keys.map((c) => c.value));
    const prevValues = keys.map((c) => value.get(`${c.siteId}|${year - 1}${c.month.slice(4)}|${kind}`));
    const comparable = keys.length > 0 && prevValues.every((v) => v != null);
    const prev = comparable ? sum(prevValues as number[]) : null;
    const lastKey = keys.map((c) => c.month).sort().at(-1);
    return {
      current: cur, previous: prev, delta: prev ? (cur - prev) / prev : null,
      period: lastKey ? (lastKey.slice(5, 7) === '01' ? monthShort(lastKey) : `janv.–${monthShort(lastKey)}`) : null,
    };
  };

  const consumptionKinds = CONSUMPTION_KINDS.map((k) => {
    const bars = months.map((month) => {
      const vals = consumptionSites.map((s) => value.get(`${s.id}|${month}|${k.key}`)).filter((v): v is number => v != null);
      return { month, value: vals.length ? sum(vals) : null };
    });
    return { ...k, bars, total12: sum(bars.map((b) => b.value ?? 0)), ...compare(k.key) };
  });
  const consumptionTables = consumptionSites.map((s) => {
    const rows = months.map((month) => ({
      month,
      values: Object.fromEntries(CONSUMPTION_KINDS.map((k) => [k.key, value.get(`${s.id}|${month}|${k.key}`) ?? null])) as Record<ConsumptionKind, number | null>,
    })).reverse();
    const totals = Object.fromEntries(CONSUMPTION_KINDS.map((k) => [k.key, sum(rows.map((r) => r.values[k.key] ?? 0))])) as Record<ConsumptionKind, number>;
    // Site archivé : plus de relevés attendus, les mois vides ne sont pas des manques.
    const missingMonths = s.archived ? 0 : rows.filter((r) => CONSUMPTION_KINDS.every((k) => r.values[k.key] == null)).length;
    return { siteId: s.id, site: s.label, archived: s.archived, rows, totals, missingMonths };
  }).filter((tb) => !tb.archived || tb.rows.some((r) => CONSUMPTION_KINDS.some((k) => r.values[k.key] != null)));
  const electricity = consumptionKinds.find((k) => k.key === 'electricite')!;

  // ── Événements environnementaux ouverts
  const envEvents = events.filter((e) => e.type === 'ENV' && isOpen(e)).map((e) => ({
    id: e.id, title: e.title, occurredOn: e.occurredOn, location: e.location, status: EVENT_STEPS[e.step],
    days: daysBetween(e.occurredOn, now), severity: e.severity, severityTone: severityTone(e.severity),
  }));
  const envClosed12 = events.filter((e) => e.type === 'ENV' && !isOpen(e) && daysBetween(e.occurredOn, now) <= 365).length;

  // ── Enlèvements de l'année (annulés compris, pour le filtre « Annulés ») avec actions, événement et historique
  const eventById = new Map(events.map((e) => [e.id, e]));
  const shownEntries = [...yearEntries, ...cancelled.filter((e) => e.year === year)];
  const history = await loadChangeLogs('waste_entry', shownEntries.map((e) => e.id));
  const details: EntryDetail[] = shownEntries.map((e) => {
    const ev = e.eventId ? eventById.get(e.eventId) : undefined;
    return {
      ...e,
      actions: envActions.filter((a) => a.wasteEntryId === e.id),
      event: e.eventId ? { id: e.eventId, title: ev?.title ?? '' } : null,
      history: history.get(String(e.id)) ?? [],
    };
  });
  // Événement lié (formulaire d'enlèvement) : événements environnementaux ouverts, proposés pour les filières de leur site.
  const eventOptions: EventOption[] = events.filter((e) => e.type === 'ENV' && isOpen(e)).map((e) => ({ id: e.id, label: `${e.id} · ${e.title}`, siteId: e.siteId }));

  // ── Exigences de la veille et action « BSD manquants »
  const actionById = new Map(actions.map((a) => [a.id, a]));
  const reqViews = requirements.map((r) => {
    const ev = REQUIREMENT_EVAL[r.evaluation] ?? { label: r.evaluation, tone: 'neutral' as Tone };
    return { id: r.id, text: r.text, label: ev.label, tone: ev.tone, note: r.evaluationNote };
  });
  const bsdRequirement = requirements.find((r) => /R\.\s?541-45/.test(r.text)) ?? requirements[0];
  // Action « BSD manquants » : retrouvée par le rattachement de l'exigence de la veille (requirements.action_id), tant
  // qu'elle n'est pas close ; plus par son origine ni par sa référence d'origine (paquet 1 Actions QSE).
  const reqAction = bsdRequirement?.actionId ? actionById.get(bsdRequirement.actionId) : undefined;
  const existing = reqAction && !isClosedActionStatus(reqAction.status) ? reqAction : undefined;
  const listed = [...missing].reverse().slice(0, 6).map((e) => `${fmtDayMonth(e.removedOn)} · ${lcfirst(e.stream)} · ${fmtQty(e.quantity, e.unit)}`);
  const bsdDueOn = addDays(now, 15);
  // Création réservée au service QHSE (la page ne transmet ces valeurs et le formulaire qu'à lui). Source « Déchets »
  // proposée ; avec l'exigence de la veille (requirement:<id>), « Veille réglementaire » est aussi admise (D20 révisée) ;
  // sans exigence, aucun élément lié (toute source, référence d'origine obligatoire). Site sélectionné ; « Tous les
  // sites » : site choisi par le QHSE.
  const bsdLink = bsdRequirement && !existing ? `requirement:${bsdRequirement.id}` : undefined;
  const bsdActionDefaults: ActionDefaults = {
    source: 'dechets',
    ...(bsdLink ? { sourceChoices: ['dechets', 'veille'] as const, link: bsdLink, linkLabel: `Exigence · ${bsdRequirement!.text}` } : {}),
    originRef: `Registre des déchets ${year}`.slice(0, ORIGIN_REF_MAX),
    domain: 'environnement',
    problem: missing.length
      ? `${missing.length} enlèvement${missing.length > 1 ? 's' : ''} de déchets dangereux sans bordereau Trackdéchets : ${listed.join(' ; ')}${missing.length > listed.length ? ' ; …' : ''} (C. env. R. 541-45).`
      : `Bordereaux Trackdéchets manquants au registre des déchets ${year} (C. env. R. 541-45).`,
    detail: `Compléter les BSD manquants du registre des déchets ${year} : ${missing.length > 1 ? 'obtenir les numéros auprès des collecteurs' : 'obtenir le numéro auprès du collecteur'} et régulariser dans Trackdéchets`,
    siteId: site ?? undefined,
    pilotId: bsdRequirement?.pilotId ?? undefined,
    dueOn: bsdDueOn,
    verifyDueOn: addDays(bsdDueOn, 30),
  };

  // ── Bordereaux de l'année (déchets dangereux)
  const hazardousYear = yearEntries.filter((e) => e.hazardous);
  const bsdStats = [
    ...BSD_STATUS_KEYS.map((k) => ({ key: k as string, label: BSD_STATUS[k].label, tone: BSD_STATUS[k].tone, n: hazardousYear.filter((e) => e.bsdStatus === k && e.bsdNumber).length })),
    { key: 'manquant', label: 'Manquants', tone: 'danger' as Tone, n: missing.length },
  ];

  const kpis = {
    evacuated: { tonnes: totalT, count: yearEntries.length, prevTonnes: prevEntries.length ? prevT : null, volumeCount },
    hazardous: { share: totalT ? hazardousT / totalT : null, tonnes: hazardousT },
    recovery: { share: totalT ? recoveryT / totalT : null, tonnes: recoveryT },
    missing: { count: missing.length, other: missingOther.length, otherYears: [...new Set(missingOther.map((e) => e.year))].sort() },
    stale: { count: stale.length, other: staleOther.length, otherYears: [...new Set(staleOther.map((e) => e.year))].sort() },
    electricity: { current: electricity.current, previous: electricity.previous, delta: electricity.delta, period: electricity.period },
  };

  return {
    now, year, years, currentYear, isCurrent, periodNote, showSite: site === null, sites, registrySites,
    streams: streamViews, entries: details, kpis, bsdStats, eventOptions,
    consumption: { maxMonth: currentMonth, kinds: consumptionKinds, tables: consumptionTables, records: consumptions },
    envEvents, envClosed12, requirements: reqViews,
    bsdAction: existing ? brief(existing) : null,
    bsdActionDefaults,
  };
}
export type EnvironmentData = Awaited<ReturnType<typeof loadEnvironment>>;

// ─── Signaux (échéances, notifications, badge) ───────────────────────────────

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Lien vers le registre filtré, sur l'année concernée. */
const registerHref = (year: number, currentYear: number, vue: string) =>
  hrefWith('/environnement', {}, { annee: year === currentYear ? undefined : String(year), vue });

/** Années touchées par site, de la plus ancienne à la plus récente (puis dans l'ordre des sites), avec leurs enlèvements. */
const bySiteYear = (rows: EntryView[], siteOrder: string[]) => {
  const map = new Map<string, { siteId: string; site: string; year: number; rows: EntryView[] }>();
  rows.forEach((e) => {
    const key = `${e.siteId}|${e.year}`;
    const group = map.get(key) ?? { siteId: e.siteId, site: e.site, year: e.year, rows: [] };
    group.rows.push(e);
    map.set(key, group);
  });
  const rank = (id: string) => { const i = siteOrder.indexOf(id); return i < 0 ? siteOrder.length : i; };
  return [...map.values()].sort((a, b) => a.year - b.year || rank(a.siteId) - rank(b.siteId));
};

/**
 * Échéances du domaine (une par année du registre et par site, `count` = éléments concernés pour le badge) :
 * - BSD manquants : déchets dangereux sans bordereau Trackdéchets (R. 541-45), en retard dès l'enlèvement ;
 * - BSD non finalisés : bordereau brouillon, émis ou collecté plus de 30 j après l'enlèvement (traitement final non attesté) ;
 * - mentions incomplètes (arrêté du 31 mai 2021, à partir de 2022) : SIRET, adresse, récépissé, qualification… manquants,
 *   dans « À traiter » sans compter dans le badge (count 0) ;
 * - relevés de consommation : mois échu sans aucun relevé, attendu avant le 15 du mois suivant.
 * Tous les sites du périmètre (TDB-05, siteId du site) ; visibilité selon le rôle : visibleTodo.
 */
export const loadEnvironmentSignals = cache(async (): Promise<{ badge?: number; todo: TodoItem[] }> => {
  const [{ now, sites, siteLabel, entries, consumptions, people }, requirements] = await Promise.all([loadEnvironmentBase('perimeter'), loadWasteRequirements()]);
  const currentYear = +now.slice(0, 4);
  const pilotId = (requirements.find((r) => /R\.\s?541-45/.test(r.text)) ?? requirements[0])?.pilotId ?? null;
  const owner = { who: pilotId ? people.get(pilotId)?.name ?? '' : '', ownerIds: pilotId ? [pilotId] : undefined };
  const todo: TodoItem[] = [];

  const siteOrder = [...siteLabel.keys()];
  const short = (label: string) => label.split(' — ')[0];
  for (const { siteId, site, year, rows } of bySiteYear(entries.filter((e) => e.missingBsd), siteOrder)) {
    todo.push({
      date: now, kind: 'Déchets', tone: 'danger', overdue: true, count: rows.length, ...owner, siteId,
      title: `Registre des déchets ${year} · ${plural(rows.length, 'BSD manquant', 'BSD manquants')} · ${short(site)}`,
      href: registerHref(year, currentYear, 'bsd-manquants'),
    });
  }

  for (const { siteId, site, year, rows } of bySiteYear(entries.filter((e) => e.staleBsd), siteOrder)) {
    const oldest = rows.reduce((a, b) => (a.removedOn <= b.removedOn ? a : b));
    todo.push({
      date: addDays(oldest.removedOn, BSD_STALE_DAYS), kind: 'Déchets', tone: 'warn', overdue: true, count: rows.length, ...owner, siteId,
      title: `Registre des déchets ${year} · ${plural(rows.length, 'BSD non finalisé', 'BSD non finalisés')} plus de ${BSD_STALE_DAYS} j après l'enlèvement · ${short(site)}`,
      href: registerHref(year, currentYear, 'bsd-en-attente'),
    });
  }

  // Mentions de l'arrêté du 31 mai 2021 (à partir de 2022) : à traiter, sans compter dans le badge (count 0).
  const fromYear = +REGISTER_MENTIONS_FROM.slice(0, 4);
  for (const { siteId, site, year, rows } of bySiteYear(entries.filter((e) => e.gaps.length && e.year >= fromYear), siteOrder)) {
    todo.push({
      date: now, kind: 'Déchets', tone: 'warn', count: 0, ...owner, siteId,
      title: `Registre des déchets ${year} · ${plural(rows.length, 'enlèvement aux mentions incomplètes', 'enlèvements aux mentions incomplètes')} · ${short(site)}`,
      href: registerHref(year, currentYear, 'mentions-incompletes'),
    });
  }

  // Relevés : sur les 12 derniers mois échus, à partir du premier relevé du site (un site sans relevé n'est pas suivi).
  const currentMonth = `${now.slice(0, 7)}-01`;
  const recorded = new Set(consumptions.map((c) => `${c.siteId}|${c.month}`));
  for (const s of sites) {
    const first = consumptions.filter((c) => c.siteId === s.id).map((c) => c.month).sort()[0];
    if (!first) continue;
    const missing = Array.from({ length: 12 }, (_, i) => shiftMonth(currentMonth, i - 12))
      .filter((m) => m >= first && !recorded.has(`${s.id}|${m}`));
    if (!missing.length) continue;
    const due = `${shiftMonth(missing[0], 1).slice(0, 8)}${String(READING_DUE_DAY).padStart(2, '0')}`;
    const site = s.label.split(' — ')[0];
    todo.push({
      date: due, kind: 'Consommations', tone: due < now ? 'danger' : 'warn', overdue: due < now, count: missing.length, who: '', siteId: s.id,
      title: missing.length === 1 ? `Relevés de ${monthLong(missing[0])} · ${site}` : `Relevés manquants (${missing.length} mois depuis ${monthLong(missing[0])}) · ${site}`,
      href: '/environnement?onglet=consommations',
    });
  }
  return { todo };
});

// ─── Export du registre (CSV) ───────────────────────────────────────────────

/** Colonnes du registre, dans l'ordre des mentions de l'arrêté du 31 mai 2021 (art. 2). */
const CSV_HEADERS = [
  "Date d'expédition (enlèvement)", 'Établissement', "SIRET de l'établissement", 'Adresse de prise en charge', 'Dénomination usuelle du déchet',
  'Code déchet', 'Dangereux', 'POP', 'Quantité', 'Unité', 'Quantité (t ou m³)', 'Unité du registre',
  'Transporteur', 'SIRET du transporteur', 'Adresse du transporteur', 'N° de récépissé du transporteur',
  'N° de bordereau (BSD)', 'Statut du bordereau',
  'Installation de destination', "SIRET de l'installation", "Adresse de l'installation",
  'Code de traitement', 'Opération de traitement', 'Qualification du traitement final', 'Filière de traitement',
  'Mentions manquantes', 'Observations',
];

function csvCell(v: string | number) {
  if (typeof v === 'number') return String(v).replace('.', ',');
  // Neutralise les formules à l'ouverture dans un tableur (=, +, @, -x).
  const s = /^[=+@\t\r]|^-(?=\S)/.test(v) ? `'${v}` : v;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const fileSlug = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'tous-sites';

/** Registre chronologique de l'année (site sélectionné) : CSV UTF-8 avec BOM, séparateur « ; ». */
export async function loadWasteRegisterCsv(year: number) {
  const { site, siteLabel, entries } = await loadEnvironmentBase();
  const rows = entries.filter((e) => e.year === year).sort((a, b) => a.removedOn.localeCompare(b.removedOn) || a.id - b.id);
  const lines = [CSV_HEADERS, ...rows.map((e) => {
    const register = toRegisterQuantity(e.quantity, e.unit);
    return [
      fmtDate(e.removedOn), e.site, e.siteSiret ?? '', e.pickupAddress ?? '', e.stream,
      e.ewcCode, e.hazardous ? 'Oui' : 'Non', e.pop ? 'Oui' : 'Non', e.quantity, e.unit, register?.quantity ?? '', register?.unit ?? '',
      e.transporter, e.transporterSiret ?? '', e.transporterAddress ?? '', e.transporterReceipt ?? '',
      e.bsdNumber ?? (e.missingBsd ? 'MANQUANT' : ''), e.bsdStatus ? BSD_STATUS[e.bsdStatus].label : '',
      e.destination, e.destinationSiret ?? '', e.destinationAddress ?? '',
      e.treatmentCode, treatmentLabel(e.treatmentCode), e.qualificationLabel ?? '', e.channel,
      e.gaps.join(' · '), e.notes ?? '',
    ];
  })];
  const scope = site ? fileSlug((siteLabel.get(site) ?? site).split(' — ')[0]) : 'tous-sites';
  return {
    csv: `﻿${lines.map((l) => l.map(csvCell).join(';')).join('\r\n')}\r\n`,
    fileName: `registre-dechets_${year}_${scope}.csv`,
  };
}
