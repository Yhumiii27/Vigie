// Opérations simultanées (SIMOPS, PRV-22) : vue en lecture de l'écran Prévention (?vue=simops&jour=) qui liste, par zone de la
// carte du site et par heure, les permis valables et les activités de la carte du jour, avec les consignations des permis.
// Règles pures (sans dépendance serveur) : créneau d'une opération dans la journée, regroupement par zone, heures où au moins
// deux opérations se recouvrent dans une même zone. La coactivité de la carte (detectConflicts, PRV-10) reste inchangée.

export const SIMOPS_VIEW = 'simops';
export const simopsHref = (day?: string) => `/prevention?vue=${SIMOPS_VIEW}${day ? `&jour=${day}` : ''}`;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Jour demandé (?jour=AAAA-MM-JJ) s'il est valide, sinon le jour même. */
export const parseSimopsDay = (raw: string | undefined, today: string) => (raw && DAY.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) ? raw : today);

/** Créneau dans la journée, en minutes depuis minuit (fin exclue). */
export type Slot = { from: number; to: number };
export const WHOLE_DAY: Slot = { from: 0, to: 24 * 60 };

const minutesOf = (local: string) => Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));

/**
 * Créneau d'un permis le jour `day` d'après sa validité en heure de Paris (« AAAA-MM-JJTHH:mm ») : null s'il n'est pas
 * valable ce jour-là.
 */
export function permitSlot(validFrom: string, validTo: string, day: string): Slot | null {
  const fromDay = validFrom.slice(0, 10);
  const toDay = validTo.slice(0, 10);
  if (fromDay > day || toDay < day) return null;
  const from = fromDay < day ? 0 : minutesOf(validFrom);
  const to = toDay > day ? WHOLE_DAY.to : minutesOf(validTo);
  return to > from ? { from, to } : null;
}

/**
 * Créneau d'une activité de la carte d'après sa plage horaire libre (« 7 h 30 – 12 h », « 14h-17h ») ; journée entière
 * quand la plage est absente ou illisible.
 */
export function activitySlot(hours: string | null | undefined): Slot {
  const m = (hours ?? '').match(/(\d{1,2})\s*h\s*(\d{2})?\s*(?:–|-|à)\s*(\d{1,2})\s*h\s*(\d{2})?/i);
  if (!m) return WHOLE_DAY;
  const from = Number(m[1]) * 60 + Number(m[2] ?? 0);
  const to = Number(m[3]) * 60 + Number(m[4] ?? 0);
  return from < to && to <= WHOLE_DAY.to ? { from, to } : WHOLE_DAY;
}

export const fmtMinutes = (m: number) => {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h} h${min ? ` ${String(min).padStart(2, '0')}` : ''}`;
};
export const fmtSlot = (s: Slot) => (s.from === 0 && s.to === WHOLE_DAY.to ? 'Toute la journée' : `${fmtMinutes(s.from)} – ${fmtMinutes(s.to)}`);

export type SimopsOperation = { key: string; zoneId: number | null; slot: Slot };

/**
 * Heures où au moins deux opérations d'une même zone se recouvrent : plages d'heures entières fusionnées
 * ([8, 12] = de 8 h à 12 h). Une opération couvre l'heure h si son créneau recoupe [h, h + 1).
 */
export function overlapHours(slots: readonly Slot[]): [number, number][] {
  const counts = Array.from({ length: 24 }, (_, h) => slots.filter((s) => s.from < (h + 1) * 60 && s.to > h * 60).length);
  const ranges: [number, number][] = [];
  counts.forEach((n, h) => {
    if (n < 2) return;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === h) last[1] = h + 1;
    else ranges.push([h, h + 1]);
  });
  return ranges;
}

/** Deux créneaux se recouvrent. */
export const slotsOverlap = (a: Slot, b: Slot) => a.from < b.to && b.from < a.to;

/**
 * Opérations simultanées d'une zone : pour chaque opération, les clés des autres opérations de la zone dont le créneau la
 * recoupe. Les opérations sans zone ne sont jamais rapprochées (lieu inconnu).
 */
export function simultaneous(ops: readonly SimopsOperation[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of ops) {
    out.set(a.key, a.zoneId == null ? [] : ops.filter((b) => b !== a && b.zoneId === a.zoneId && slotsOverlap(a.slot, b.slot)).map((b) => b.key));
  }
  return out;
}

export const fmtHourRanges = (ranges: readonly [number, number][]) => ranges.map(([a, b]) => `${a} h – ${b} h`).join(', ');
