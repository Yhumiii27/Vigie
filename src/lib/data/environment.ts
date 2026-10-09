import 'server-only';
import { cache } from 'react';
import { asc } from 'drizzle-orm';
import { getDb, schema as t } from '@/db';
import {
  BSD_STATUS, BSD_STATUS_KEYS, CONSUMPTION_KINDS, fmtQty, isBsdStatus, isHazardousCode, isRecovery, monthShort, shiftMonth, toTonnes, treatmentLabel,
  type BsdStatus, type ConsumptionKind,
} from '@/components/environment/model';
import { addDays, daysBetween, fmtDate, fmtDayMonth, today } from '../dates';
import { EVENT_STEPS, REQUIREMENT_EVAL, canSee, columnOf, severityTone, type TodoItem, type Tone } from '../domain';
import { actionColumn, isOpen, lcfirst, loadActions, loadEvents, loadPeople } from '../queries';
import { currentSiteId, getSession, inSite } from '../session';

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
  /** Enlèvements inscrits au registre, toutes années confondues. */
  entryCount: number;
  /** Quantités (dans l'unité de la filière) de l'année affichée et de l'année précédente. */
  yearQty: number;
  prevQty: number;
  /** Année précédente arrêtée à la même date (année en cours), sinon année complète : base de comparaison. */
  prevPeriodQty: number;
  yearCount: number;
  lastRemovedOn: string | null;
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
  transporter: string;
  destination: string;
  channel: string;
  treatmentCode: string;
  recovery: boolean;
  bsdNumber: string | null;
  bsdStatus: BsdStatus | null;
  bsdLabel: string | null;
  bsdTone: Tone;
  /** Déchet dangereux sans bordereau Trackdéchets. */
  missingBsd: boolean;
  notes: string | null;
};

export type ConsumptionRecord = { siteId: string; month: string; kind: ConsumptionKind; value: number };

const KIND_KEYS = new Set<string>(CONSUMPTION_KINDS.map((k) => k.key));
const WASTE_REQUIREMENT = /R\.\s?541-4|déchet/i;

/** Filières, registre et relevés du site sélectionné (« Tous les sites » consolide). */
const loadEnvironmentBase = cache(async () => {
  const db = await getDb();
  const [site, sites, streamRows, entryRows, consumptionRows] = await Promise.all([
    currentSiteId(),
    db.select().from(t.sites).orderBy(asc(t.sites.sort)),
    db.select().from(t.wasteStreams),
    db.select().from(t.wasteEntries),
    db.select().from(t.consumptions),
  ]);
  const siteLabel = new Map(sites.map((s) => [s.id, s.label]));
  const streams = streamRows.filter((s) => inSite(site, s.siteId));
  const streamById = new Map(streamRows.map((s) => [s.id, s]));

  const entries: EntryView[] = entryRows
    .filter((e) => inSite(site, e.siteId))
    .flatMap((e) => {
      const s = streamById.get(e.streamId);
      if (!s) return [];
      // Copies figées à l'inscription, à défaut les valeurs actuelles de la filière.
      const ewcCode = e.ewcCode ?? s.ewcCode;
      const treatmentCode = e.treatmentCode ?? s.treatmentCode;
      const hazardous = isHazardousCode(ewcCode) || s.hazardous;
      const status = isBsdStatus(e.bsdStatus) ? e.bsdStatus : null;
      const missingBsd = hazardous && !e.bsdNumber;
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
        transporter: e.transporter,
        destination: e.destination ?? s.destination,
        channel: s.channel,
        treatmentCode,
        recovery: isRecovery(treatmentCode),
        bsdNumber: e.bsdNumber,
        bsdStatus: status,
        bsdLabel: missingBsd ? 'BSD manquant' : status ? BSD_STATUS[status].label : null,
        bsdTone: missingBsd ? 'danger' : status ? BSD_STATUS[status].tone : 'neutral',
        missingBsd,
        notes: e.notes,
      } satisfies EntryView];
    })
    .sort((a, b) => b.removedOn.localeCompare(a.removedOn) || b.id - a.id);

  const consumptions: ConsumptionRecord[] = consumptionRows
    .filter((c) => inSite(site, c.siteId) && KIND_KEYS.has(c.kind))
    .map((c) => ({ siteId: c.siteId, month: c.month, kind: c.kind as ConsumptionKind, value: c.value }));

  const scopeSites = sites.filter((s) => inSite(site, s.id)).map((s) => ({ id: s.id, label: s.label }));
  return { site, sites: scopeSites, siteLabel, streams, entries, consumptions };
});

/** Exigences de la veille relatives aux déchets (R. 541-43 / R. 541-45…), toute l'entreprise. */
const loadWasteRequirements = cache(async () => {
  const db = await getDb();
  const rows = await db.select().from(t.requirements).orderBy(asc(t.requirements.sort), asc(t.requirements.id));
  return rows.filter((r) => WASTE_REQUIREMENT.test(r.text) || WASTE_REQUIREMENT.test(r.domain));
});

const sum = (values: number[]) => values.reduce((n, v) => n + v, 0);
const tonnesOf = (rows: EntryView[]) => sum(rows.map((e) => e.tonnes ?? 0));

// ─── Écran « Environnement et déchets » ─────────────────────────────────────

export async function loadEnvironment(requestedYear?: number) {
  const now = today();
  const currentYear = +now.slice(0, 4);
  const [{ site, sites, siteLabel, streams, entries, consumptions }, events, people, actions, requirements] = await Promise.all([
    loadEnvironmentBase(), loadEvents(), loadPeople(), loadActions(), loadWasteRequirements(),
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

  // ── Filières avec cumuls annuels
  const streamViews: StreamView[] = streams.map((s) => {
    const mine = entries.filter((e) => e.streamId === s.id);
    const inYear = mine.filter((e) => e.year === year);
    return {
      id: s.id, siteId: s.siteId, site: siteLabel.get(s.siteId) ?? s.siteId, label: s.label, ewcCode: s.ewcCode, hazardous: s.hazardous,
      unit: s.unit, treatmentCode: s.treatmentCode, treatmentLabel: treatmentLabel(s.treatmentCode), recovery: isRecovery(s.treatmentCode),
      channel: s.channel, collector: s.collector, destination: s.destination,
      entryCount: mine.length,
      yearQty: sum(inYear.map((e) => e.quantity)),
      prevQty: sum(mine.filter((e) => e.year === year - 1).map((e) => e.quantity)),
      prevPeriodQty: sum(mine.filter((e) => e.year === year - 1 && (!isCurrent || e.removedOn <= sameDayPrev)).map((e) => e.quantity)),
      yearCount: inYear.length,
      lastRemovedOn: mine[0]?.removedOn ?? null,
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
      const vals = sites.map((s) => value.get(`${s.id}|${month}|${k.key}`)).filter((v): v is number => v != null);
      return { month, value: vals.length ? sum(vals) : null };
    });
    return { ...k, bars, total12: sum(bars.map((b) => b.value ?? 0)), ...compare(k.key) };
  });
  const consumptionTables = sites.map((s) => {
    const rows = months.map((month) => ({
      month,
      values: Object.fromEntries(CONSUMPTION_KINDS.map((k) => [k.key, value.get(`${s.id}|${month}|${k.key}`) ?? null])) as Record<ConsumptionKind, number | null>,
    })).reverse();
    const totals = Object.fromEntries(CONSUMPTION_KINDS.map((k) => [k.key, sum(rows.map((r) => r.values[k.key] ?? 0))])) as Record<ConsumptionKind, number>;
    const missingMonths = rows.filter((r) => CONSUMPTION_KINDS.every((k) => r.values[k.key] == null)).length;
    return { siteId: s.id, site: s.label, rows, totals, missingMonths };
  });
  const electricity = consumptionKinds.find((k) => k.key === 'electricite')!;

  // ── Événements environnementaux ouverts
  const envEvents = events.filter((e) => e.type === 'ENV' && isOpen(e)).map((e) => ({
    id: e.id, title: e.title, occurredOn: e.occurredOn, location: e.location, status: EVENT_STEPS[e.step],
    days: daysBetween(e.occurredOn, now), severity: e.severity, severityTone: severityTone(e.severity),
  }));
  const envClosed12 = events.filter((e) => e.type === 'ENV' && !isOpen(e) && daysBetween(e.occurredOn, now) <= 365).length;

  // ── Exigences de la veille et action « BSD manquants »
  const actionById = new Map(actions.map((a) => [a.id, a]));
  const reqViews = requirements.map((r) => {
    const ev = REQUIREMENT_EVAL[r.evaluation] ?? { label: r.evaluation, tone: 'neutral' as Tone };
    return { id: r.id, text: r.text, label: ev.label, tone: ev.tone, note: r.evaluationNote };
  });
  const bsdRequirement = requirements.find((r) => /R\.\s?541-45/.test(r.text)) ?? requirements[0];
  const originRef = `Registre des déchets ${year}`;
  const brief = (a: (typeof actions)[number]) => {
    const col = actionColumn(a, now);
    const c = columnOf(col);
    return { id: a.id, title: a.title, statusLabel: c.status, tone: c.tone, dueOn: a.dueOn, pilot: people.get(a.pilotId)?.name ?? '—' };
  };
  const reqAction = bsdRequirement?.actionId ? actionById.get(bsdRequirement.actionId) : undefined;
  const existing = actions.find((a) => a.origin === 'env' && a.originRef === originRef && actionColumn(a, now) !== 'done')
    ?? (reqAction && actionColumn(reqAction, now) !== 'done' ? reqAction : undefined);
  const listed = [...missing].reverse().slice(0, 6).map((e) => `${fmtDayMonth(e.removedOn)} · ${lcfirst(e.stream)} · ${fmtQty(e.quantity, e.unit)}`);
  const bsdActionDefaults = {
    title: `Compléter les BSD manquants du registre des déchets ${year}`,
    description: missing.length
      ? `${missing.length} enlèvement${missing.length > 1 ? 's' : ''} de déchets dangereux sans bordereau Trackdéchets : ${listed.join(' ; ')}${missing.length > listed.length ? ' ; …' : ''}. ${missing.length > 1 ? 'Obtenir les numéros auprès des collecteurs' : 'Obtenir le numéro auprès du collecteur'} et régulariser dans Trackdéchets (C. env. R. 541-45).`
      : null,
    origin: 'env',
    originRef,
    siteId: site,
    pilotId: bsdRequirement?.pilotId ?? undefined,
    dueOn: addDays(now, 15),
    kind: 'C' as const,
    lockOrigin: true,
    // Rattache l'action à l'exigence de la veille si celle-ci n'en porte pas d'ouverte.
    link: bsdRequirement && (!bsdRequirement.actionId || (reqAction && actionColumn(reqAction, now) === 'done')) ? `requirement:${bsdRequirement.id}` : undefined,
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
    electricity: { current: electricity.current, previous: electricity.previous, delta: electricity.delta, period: electricity.period },
  };

  return {
    now, year, years, currentYear, isCurrent, periodNote, showSite: site === null, sites,
    streams: streamViews, entries: yearEntries, kpis, bsdStats,
    consumption: { maxMonth: currentMonth, kinds: consumptionKinds, tables: consumptionTables, records: consumptions },
    envEvents, envClosed12, requirements: reqViews,
    bsdAction: existing ? brief(existing) : null,
    bsdActionDefaults,
  };
}
export type EnvironmentData = Awaited<ReturnType<typeof loadEnvironment>>;

// ─── Signaux (badge de navigation, échéances) ───────────────────────────────

/**
 * Badge = enlèvements de déchets dangereux sans BSD ; une échéance du jour tant qu'il en reste.
 * Rien pour les rôles sans accès à l'écran : l'échéance les renverrait vers leur accueil.
 */
export async function loadEnvironmentSignals(): Promise<{ badge: number; todo: TodoItem[] }> {
  const { role } = await getSession();
  if (!canSee(role, 'env')) return { badge: 0, todo: [] };
  const [{ entries }, requirements, people] = await Promise.all([loadEnvironmentBase(), loadWasteRequirements(), loadPeople()]);
  const n = entries.filter((e) => e.missingBsd).length;
  if (!n) return { badge: 0, todo: [] };
  const pilotId = (requirements.find((r) => /R\.\s?541-45/.test(r.text)) ?? requirements[0])?.pilotId;
  return {
    badge: n,
    todo: [{
      date: today(),
      kind: 'Déchets',
      tone: 'danger',
      title: `Compléter les BSD manquants (${n})`,
      who: pilotId ? people.get(pilotId)?.name ?? '' : '',
      href: '/environnement',
    }],
  };
}

// ─── Export du registre (CSV) ───────────────────────────────────────────────

const CSV_HEADERS = [
  "Date d'enlèvement", 'Dénomination du déchet', 'Code déchet', 'Dangereux', 'Quantité', 'Unité', 'Code de traitement', 'Opération de traitement',
  'Filière de traitement', 'Transporteur', 'Installation de destination', 'N° de bordereau (BSD)', 'Statut du bordereau', 'Site', 'Observations',
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
  const lines = [CSV_HEADERS, ...rows.map((e) => [
    fmtDate(e.removedOn), e.stream, e.ewcCode, e.hazardous ? 'Oui' : 'Non', e.quantity, e.unit, e.treatmentCode, treatmentLabel(e.treatmentCode),
    e.channel, e.transporter, e.destination, e.bsdNumber ?? (e.missingBsd ? 'MANQUANT' : ''), e.bsdStatus ? BSD_STATUS[e.bsdStatus].label : '',
    e.site, e.notes ?? '',
  ])];
  const scope = site ? fileSlug((siteLabel.get(site) ?? site).split(' — ')[0]) : 'tous-sites';
  return {
    csv: `﻿${lines.map((l) => l.map(csvCell).join(';')).join('\r\n')}\r\n`,
    fileName: `registre-dechets_${year}_${scope}.csv`,
  };
}
