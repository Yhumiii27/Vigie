// Liste du poste de garde (PRV-25, décision CV-10 du 03/11/2026) : arrivées et départs à venir sur un site, d'après les
// présences prévues déclarées dans Cursus et validées par les RH (cursus.pub_presences_prevues). Règles pures, sans import
// serveur (vue /prevention?vue=poste-de-garde et impression /prevention/poste-de-garde/imprimer). Aucune donnée de santé,
// aucune donnée personnelle au-delà de ce que la liste exige (nom, matricule, matricule de site, entreprise, dates, objet).
//
// Personne d'une présence (lot 14 de Cursus, publication en attente du propriétaire et de Matrix) : rapprochée par
// people.matricule (matricule Cursus « EMP-… », proposition principale), sinon par people.site_matricule (variante où la
// présence porte le matricule de site « I… » / « E… », ou colonne `matricule_site` de la présence).
//
// Plan de prévention ou permis rapproché sans deviner : même site, même entreprise (nom de l'entreprise extérieure de Vigie
// égal au nom publié par Cursus, à la casse, aux accents, aux crochets et à la ponctuation près — companyKey) et dates qui
// se recoupent ; plan ou permis annulé exclu. Aucun rapprochement par la personne (les plans ne nomment pas les
// intervenants) ; entreprise absente (salarié) ou sans homonyme exact : rien n'est proposé. Accueil sécurité : non affiché
// (C-13 ouverte, Vigie n'en tient pas la donnée).

import { canManage, canSee, type Role } from '../domain';
import { SITE_MATRICULE_RE, companyKey } from './people-sync';

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
  ref: string; matricule: string | null; siteMatricule?: string | null; siteCode: string | null; company: string | null; from: string; to: string; purpose: string | null;
  status: 'validee' | 'annulee';
};
export type GatePlan = { id: string; siteId: string; company: string; from: string; to: string };
/** Fiche du cache people (D01) : matricule Cursus et matricule de site. */
export type GatePerson = { matricule: string | null; siteMatricule: string | null; name: string };

export type GateRow = {
  ref: string;
  /** Nom d'après le cache de Vigie (matricule, puis matricule de site) ; null : personne inconnue de Vigie. */
  name: string | null;
  /** Matricule Cursus (« EMP-… ») de la fiche, sinon celui de la présence quand ce n'est pas un matricule de site. */
  matricule: string | null;
  /** Matricule de site (« I… » / « E… ») de la fiche, sinon celui publié avec la présence ; null pour un salarié. */
  siteMatricule: string | null;
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
 * Résout la personne d'une présence : `matricule` comparé à people.matricule, puis à people.site_matricule (variante), puis
 * `siteMatricule` de la présence comparé à people.site_matricule. Matricule et matricule de site affichés : ceux de la fiche,
 * sinon ceux de la présence.
 */
export function gatePersonResolver(people: readonly GatePerson[]) {
  const byMatricule = new Map(people.flatMap((p) => (p.matricule ? [[p.matricule, p] as const] : [])));
  const bySite = new Map(people.flatMap((p) => (p.siteMatricule ? [[p.siteMatricule, p] as const] : [])));
  return (p: Pick<GatePresence, 'matricule' | 'siteMatricule'>): Pick<GateRow, 'name' | 'matricule' | 'siteMatricule'> => {
    const isSite = !!p.matricule && SITE_MATRICULE_RE.test(p.matricule);
    const person = (p.matricule ? byMatricule.get(p.matricule) ?? bySite.get(p.matricule) : undefined) ?? (p.siteMatricule ? bySite.get(p.siteMatricule) : undefined);
    return {
      name: person?.name ?? null,
      matricule: person?.matricule ?? (isSite ? null : p.matricule),
      siteMatricule: person?.siteMatricule ?? p.siteMatricule ?? (isSite ? p.matricule : null),
    };
  };
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
  people: readonly GatePerson[];
  plans: readonly GatePlan[];
  permits: readonly GatePlan[];
}): GateHouseList {
  const { today, to } = input;
  const inWindow = (d: string) => d >= today && d <= to;
  const resolve = gatePersonResolver(input.people);
  const rows = input.presences.flatMap((p) => {
    const siteLabel = p.siteCode ? input.sites.get(p.siteCode) : undefined;
    if (!p.siteCode || siteLabel === undefined) return [];
    const row: GateRow & { status: GatePresence['status'] } = {
      ref: p.ref, ...resolve(p), company: p.company, siteId: p.siteCode, siteLabel,
      from: p.from, to: p.to, purpose: p.purpose, status: p.status,
      plans: p.status === 'validee' ? matchInterventions(p, input.plans) : [],
      permits: p.status === 'validee' ? matchInterventions(p, input.permits) : [],
    };
    return [row];
  });
  const label = (r: GateRow) => r.name ?? r.siteMatricule ?? r.matricule ?? '';
  const byName = (a: GateRow, b: GateRow) => label(a).localeCompare(label(b), 'fr') || a.ref.localeCompare(b.ref);
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
