// Valeurs proposées au formulaire d'action par l'écran Environnement et déchets (docs/specs/actions-qse.md § 12, plan
// du paquet 1, flux E2, amendements du 15/10/2026) : règles pures, testées dans action-defaults.test.ts. La création
// reste réservée au service QHSE (ACT-22) : l'écran ne propose ces valeurs qu'à lui.
//
// Source « Déchets » imposée (seule source admise pour une filière ou un enlèvement, admissibleSources), domaine
// Environnement, élément lié explicite (wastestream:<id> ou wasteentry:<id> : pose actions.waste_stream_id ou
// waste_entry_id à la création, ACT-01), site de la filière ou de l'enlèvement. L'action « BSD manquants » du registre
// (exigence de la veille) est préparée par le chargement (loadEnvironment, bsdActionDefaults).

import type { ActionDefaults } from '@/lib/action-view';
import { addDays, fmtDate } from '@/lib/dates';
import { ORIGIN_REF_MAX } from '@/lib/domain';
import { fmtQty } from './model';

/** Délai proposé entre la date cible et la vérification d'efficacité planifiée. */
export const VERIFY_AFTER_DAYS = 30;
/** Date cible proposée : dans 30 jours. */
export const DUE_AFTER_DAYS = 30;

const base = (today: string): Pick<ActionDefaults, 'source' | 'lockSource' | 'domain' | 'dueOn' | 'verifyDueOn'> => {
  const dueOn = addDays(today, DUE_AFTER_DAYS);
  return { source: 'dechets', lockSource: true, domain: 'environnement', dueOn, verifyDueOn: addDays(dueOn, VERIFY_AFTER_DAYS) };
};

type StreamLike = { id: string; label: string; ewcCode: string; destination: string; siteId: string };

/** Action sur une filière de déchets. */
export function streamActionDefaults(stream: StreamLike, today: string): ActionDefaults {
  return {
    ...base(today),
    link: `wastestream:${stream.id}`,
    linkLabel: `Filière · ${stream.id} · ${stream.label}`,
    originRef: stream.id.slice(0, ORIGIN_REF_MAX),
    problem: `Filière ${stream.id} · ${stream.label} (${stream.ewcCode}) · exutoire ${stream.destination}.`,
    siteId: stream.siteId,
  };
}

type EntryLike = {
  id: number; ref: string; siteId: string; stream: string; removedOn: string; quantity: number; unit: string; bsdNumber: string | null; staleBsd: boolean;
};

/** Action sur un enlèvement du registre ; bordereau non finalisé : « Obtenir le certificat de traitement ». */
export function entryActionDefaults(entry: EntryLike, today: string): ActionDefaults {
  return {
    ...base(today),
    link: `wasteentry:${entry.id}`,
    linkLabel: `Enlèvement · ${entry.ref}`,
    originRef: entry.ref.slice(0, ORIGIN_REF_MAX),
    problem: `Enlèvement du ${fmtDate(entry.removedOn)} · ${entry.stream} · ${fmtQty(entry.quantity, entry.unit)}${entry.bsdNumber ? ` · ${entry.bsdNumber}` : ''}.`,
    detail: entry.staleBsd && entry.bsdNumber ? `Obtenir le certificat de traitement du ${entry.bsdNumber}` : undefined,
    siteId: entry.siteId,
  };
}
