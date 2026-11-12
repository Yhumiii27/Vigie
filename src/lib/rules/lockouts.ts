// Consignations et isolations (PRV-22, réponses du service QHSE du 09/11/2026) : règles pures, sans dépendance serveur,
// partagées par les server actions (src/server/lockouts.ts), la délivrance et la clôture d'un permis (src/server/permits.ts),
// les chargements, les échéances et les composants. Champs génériques en attendant la procédure PR-QHSE-005 (à venir).

import type { Tone } from '../domain';

export type LockoutEnergy = 'electrique' | 'mecanique' | 'hydraulique' | 'pneumatique' | 'fluide' | 'chimique' | 'thermique' | 'autre';
export const LOCKOUT_ENERGIES: Record<LockoutEnergy, string> = {
  electrique: 'Électrique', mecanique: 'Mécanique', hydraulique: 'Hydraulique', pneumatique: 'Pneumatique',
  fluide: 'Fluide (gaz, vapeur, liquide)', chimique: 'Chimique', thermique: 'Thermique', autre: 'Autre',
};
export const LOCKOUT_ENERGY_KEYS = Object.keys(LOCKOUT_ENERGIES) as LockoutEnergy[];

export type LockoutStatus = 'preparee' | 'posee' | 'verifiee' | 'levee' | 'annulee';
export const LOCKOUT_STATUSES: Record<LockoutStatus, { label: string; tone: Tone }> = {
  preparee: { label: 'Préparée', tone: 'neutral' },
  posee: { label: 'Posée, à vérifier', tone: 'warn' },
  verifiee: { label: 'Vérifiée', tone: 'ok' },
  levee: { label: 'Levée', tone: 'neutral' },
  annulee: { label: 'Annulée', tone: 'neutral' },
};
export const LOCKOUT_STATUS_KEYS = Object.keys(LOCKOUT_STATUSES) as LockoutStatus[];
export const isLockoutStatus = (v: unknown): v is LockoutStatus => typeof v === 'string' && Object.hasOwn(LOCKOUT_STATUSES, v);

/** Consignation en vigueur : ni levée ni annulée. */
export const isActiveLockout = (l: { status: string }) => l.status !== 'levee' && l.status !== 'annulee';

export type IsolationPoint = { label: string; device: string };
export const POINTS_MAX = 30;
export const POINT_TEXT_MAX = 120;

/**
 * Points d'isolement saisis un par ligne : « repère ; n° de cadenas ou dispositif » (le dispositif est facultatif). Lignes
 * vides ignorées. Erreur : aucun point, trop de points, texte trop long.
 */
export function parseIsolationPoints(text: string): { points: IsolationPoint[]; error: string | null } {
  const points = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [label, ...rest] = line.split(';');
    return { label: label.trim(), device: rest.join(';').trim() };
  }).filter((p) => p.label);
  if (!points.length) return { points, error: 'Indiquez au moins un point d’isolement (un par ligne).' };
  if (points.length > POINTS_MAX) return { points, error: `${POINTS_MAX} points d’isolement au plus.` };
  if (points.some((p) => p.label.length > POINT_TEXT_MAX || p.device.length > POINT_TEXT_MAX)) {
    return { points, error: `Repère et dispositif : ${POINT_TEXT_MAX} caractères au plus chacun.` };
  }
  return { points, error: null };
}

/** Points lus en base (jsonb), ignorés s'ils sont mal formés. */
export function readPoints(raw: unknown): IsolationPoint[] {
  return Array.isArray(raw)
    ? raw.filter((p): p is IsolationPoint => !!p && typeof p === 'object' && typeof (p as IsolationPoint).label === 'string')
      .map((p) => ({ label: p.label, device: typeof p.device === 'string' ? p.device : '' }))
    : [];
}

/** Points remis en texte (formulaire de modification). */
export const pointsText = (points: readonly IsolationPoint[]) => points.map((p) => (p.device ? `${p.label} ; ${p.device}` : p.label)).join('\n');

/** Poseur et vérificateur : deux personnes distinctes. */
export function lockoutPeopleError(applierId: string | null, verifierId: string | null): string | null {
  return applierId && verifierId && applierId === verifierId ? 'Le vérificateur doit être une autre personne que le poseur.' : null;
}

/** Transitions admises : préparée → posée → vérifiée → levée ; une consignation posée non vérifiée peut aussi être levée. */
const NEXT: Record<'poser' | 'verifier' | 'lever', { from: LockoutStatus[]; to: LockoutStatus }> = {
  poser: { from: ['preparee'], to: 'posee' },
  verifier: { from: ['posee'], to: 'verifiee' },
  lever: { from: ['posee', 'verifiee'], to: 'levee' },
};
export type LockoutStep = keyof typeof NEXT;
export function lockoutStepError(status: string, step: LockoutStep): string | null {
  if (NEXT[step].from.includes(status as LockoutStatus)) return null;
  if (status === 'annulee') return 'Consignation annulée : consultation seule.';
  if (status === 'levee') return 'Consignation déjà levée.';
  return {
    poser: 'Seule une consignation préparée se pose.',
    verifier: status === 'preparee' ? 'La consignation doit être posée avant d’être vérifiée.' : 'Consignation déjà vérifiée.',
    lever: 'Seule une consignation posée se lève.',
  }[step];
}
export const stepTarget = (step: LockoutStep): LockoutStatus => NEXT[step].to;

/**
 * Vérification : par le vérificateur désigné ou par l'animateur QHSE, jamais par la personne qui a posé (poseur désigné).
 */
export function verifyRightError(who: { userId: string; qhse: boolean }, l: { verifierId: string; applierId: string }): string | null {
  if (who.userId === l.applierId) return 'Le poseur ne vérifie pas sa propre consignation.';
  if (who.userId !== l.verifierId && !who.qhse) return 'Vérification réservée au vérificateur désigné ou à l’animateur QHSE.';
  return null;
}

/** Délivrance du permis refusée tant qu'une consignation en vigueur n'est pas vérifiée (préparée ou posée) : message, ou null. */
export function lockoutDeliverBlocker(lockouts: readonly { id: string; status: string }[]): string | null {
  const pending = lockouts.filter((l) => l.status === 'preparee' || l.status === 'posee');
  if (!pending.length) return null;
  return `Consignation${pending.length > 1 ? 's' : ''} ${pending.map((l) => l.id).join(', ')} non vérifiée${pending.length > 1 ? 's' : ''} : le permis ne se délivre qu’une fois toutes ses consignations posées et vérifiées.`;
}

/** Clôture du permis refusée tant qu'une consignation n'est pas levée (ou annulée) : message, ou null. */
export function lockoutCloseBlocker(lockouts: readonly { id: string; status: string }[]): string | null {
  const open = lockouts.filter(isActiveLockout);
  if (!open.length) return null;
  return `Consignation${open.length > 1 ? 's' : ''} ${open.map((l) => l.id).join(', ')} non levée${open.length > 1 ? 's' : ''} : levez-la${open.length > 1 ? 's' : ''} (ou annulez une consignation jamais posée) avant de clore le permis.`;
}

export type LockoutSignalKind = 'verification' | 'levee';
/**
 * Échéance d'une consignation (pure) : posée ou préparée mais non vérifiée alors que la validité du permis a commencé
 * (« verification ») ; non levée alors que le permis est terminé (validité échue, clos ou annulé : « levee »). Null sinon.
 */
export function lockoutSignal(l: { status: string }, permit: { status: string; validFrom: Date; validTo: Date }, nowMs: number): LockoutSignalKind | null {
  if (!isActiveLockout(l)) return null;
  const ended = permit.status === 'clos' || permit.status === 'annule' || permit.validTo.getTime() <= nowMs;
  if (ended && l.status !== 'preparee') return 'levee';
  if (!ended && (l.status === 'preparee' || l.status === 'posee') && permit.validFrom.getTime() <= nowMs) return 'verification';
  return null;
}
