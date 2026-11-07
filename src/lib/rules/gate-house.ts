// Liste du poste de garde (PRV-25, décision CV-10 du 03/11/2026) : arrivées et départs à venir sur un site, d'après les
// présences prévues déclarées dans Cursus et validées par les RH (cursus.pub_presences_prevues). Règles pures, sans import
// serveur (vue /prevention?vue=poste-de-garde et impression /prevention/poste-de-garde/imprimer). Aucune donnée de santé,
// aucune donnée personnelle au-delà de ce que la liste exige (nom, matricule, entreprise, dates, objet).
//
// Plan de prévention ou permis rapproché sans deviner : même site, même entreprise (nom de l'entreprise extérieure de Vigie
// égal au nom publié par Cursus, à la casse, aux accents, aux crochets et à la ponctuation près — companyKey) et dates qui
// se recoupent ; plan ou permis annulé exclu. Aucun rapprochement par la personne (les plans ne nomment pas les
// intervenants) ; entreprise absente (salarié) ou sans homonyme exact : rien n'est proposé. Accueil sécurité : non affiché
// (C-13 ouverte, Vigie n'en tient pas la donnée).

import { canManage, canSee, type Role } from '../domain';
import { companyKey } from './people-sync';

/** Horizons proposés (jours à venir, `?horizon=`), défaut 7 jours. */
export const GATE_HOUSE_HORIZONS = [1, 7, 14, 30] as const;
export const GATE_HOUSE_DEFAULT_HORIZON = 7;
/** Vue de l'écran Prévention (`/prevention?vue=poste-de-garde`) et impression. */
export const GATE_HOUSE_VIEW = 'poste-de-garde';
export const GATE_HOUSE_PATH = `/prevention?vue=${GATE_HOUSE_VIEW}`;
export const GATE_HOUSE_PRINT_PATH = '/prevention/poste-de-garde/imprimer';

/** Lecteurs : animateur QHSE, direction et encadrement de l'écran Prévention (jamais le Salarié). */
export const canReadGateHouse = (role: Role) => canManage(role) && canSee(role, 'prevention');

/** Horizon demandé par l'URL, parmi GATE_HOUSE_HORIZONS (sinon le défaut). */
export function parseHorizon(raw: string | undefined): number {
  const n = Number(raw);
  return (GATE_HOUSE_HORIZONS as readonly number[]).includes(n) ? n : GATE_HOUSE_DEFAULT_HORIZON;
}

export type GatePresence = {
  ref: string; matricule: string | null; siteCode: string | null; company: string | null; from: string; to: string; purpose: string | null;
  status: 'validee' | 'annulee';
};
export type GatePlan = { id: string; siteId: string; company: string; from: string; to: string };

export type GateRow = {
  ref: string;
  /** Nom d'après le cache de Vigie (matricule) ; null : matricule inconnu de Vigie. */
  name: string | null;
  matricule: string | null;
  company: string | null;
  siteId: string;
  siteLabel: string;
  from: string;
  to: string;
  purpose: string | null;
  /** Plans de prévention et permis rapprochés (même site, même entreprise, dates recoupées). */
  plans: string[];
  permits: string[];
};

export type GateHouseList = { arrivals: GateRow[]; departures: GateRow[]; cancelled: GateRow[]; from: string; to: string };

/** Plans (ou permis) de la même entreprise, sur le même site, dont les dates recoupent la présence. */
export function matchInterventions(p: Pick<GatePresence, 'siteCode' | 'company' | 'from' | 'to'>, items: readonly GatePlan[]): string[] {
  const key = companyKey(p.company);
  if (!key || !p.siteCode) return [];
  return items.filter((x) => x.siteId === p.siteCode && companyKey(x.company) === key && x.from <= p.to && x.to >= p.from).map((x) => x.id).sort();
}

/**
 * Arrivées et départs des `horizon` prochains jours (aujourd'hui compris) des présences validées, sur les sites gardés
 * (`sites` : identifiant → libellé des sites suivis du site sélectionné et du périmètre) ; présences annulées de la période
 * à part. Tri par date puis par nom.
 */
export function gateHouseList(input: {
  presences: readonly GatePresence[];
  today: string;
  to: string;
  sites: ReadonlyMap<string, string>;
  names: ReadonlyMap<string, string>;
  plans: readonly GatePlan[];
  permits: readonly GatePlan[];
}): GateHouseList {
  const { today, to } = input;
  const inWindow = (d: string) => d >= today && d <= to;
  const rows = input.presences.flatMap((p) => {
    const siteLabel = p.siteCode ? input.sites.get(p.siteCode) : undefined;
    if (!p.siteCode || siteLabel === undefined) return [];
    const row: GateRow & { status: GatePresence['status'] } = {
      ref: p.ref, name: p.matricule ? input.names.get(p.matricule) ?? null : null, matricule: p.matricule, company: p.company, siteId: p.siteCode, siteLabel,
      from: p.from, to: p.to, purpose: p.purpose, status: p.status,
      plans: p.status === 'validee' ? matchInterventions(p, input.plans) : [],
      permits: p.status === 'validee' ? matchInterventions(p, input.permits) : [],
    };
    return [row];
  });
  const byName = (a: GateRow, b: GateRow) => (a.name ?? a.matricule ?? '').localeCompare(b.name ?? b.matricule ?? '', 'fr') || a.ref.localeCompare(b.ref);
  const strip = (r: GateRow & { status: string }): GateRow => {
    const { status, ...row } = r;
    void status;
    return row;
  };
  const valid = rows.filter((r) => r.status === 'validee');
  return {
    from: today, to,
    arrivals: valid.filter((r) => inWindow(r.from)).sort((a, b) => a.from.localeCompare(b.from) || byName(a, b)).map(strip),
    departures: valid.filter((r) => inWindow(r.to)).sort((a, b) => a.to.localeCompare(b.to) || byName(a, b)).map(strip),
    cancelled: rows.filter((r) => r.status === 'annulee' && (inWindow(r.from) || inWindow(r.to))).sort((a, b) => a.from.localeCompare(b.from) || byName(a, b)).map(strip),
  };
}
