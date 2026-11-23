import { heldTitleState, type HeldFacts } from './skills';
import type { SkillState } from '@/lib/domain';

// Intervenants d'un plan de prévention (PRV-23, réponse du service QHSE du 09/11/2026 : « alerte si l'intervenant n'a pas
// son accueil sécurité à jour lors de la création du plan de prévention et le service QSSE doit pouvoir mettre un véto si
// l'intervenant n'a pas ses habilitations à jour »). Règles pures : état de l'accueil sécurité (titres suivis marqués
// « accueil sécurité », training_titles.safety_induction) et des titres requis de la personne (qualification_requirements),
// d'après les titres détenus publiés par Cursus (D09) ; veto et blocages de la signature du plan et de la délivrance d'un
// permis. Rien n'est stocké : calculé à l'affichage, à l'écriture et pour les échéances.

/** État de l'accueil sécurité d'un intervenant. */
export type InductionState =
  /** Titre d'accueil sécurité valide (au moins un des titres marqués). */
  | 'ok'
  /** Aucun titre d'accueil valide (jamais suivi, expiré, suspendu). */
  | 'missing'
  /** Titres détenus de Cursus indisponibles : ni alerte ni blocage, « donnée indisponible ». */
  | 'unknown'
  /** Aucun titre suivi n'est marqué « accueil sécurité » : rien à contrôler. */
  | 'none';

export const INDUCTION_LABELS: Record<InductionState, { label: string; tone: 'ok' | 'danger' | 'neutral' | 'warn' }> = {
  ok: { label: 'Accueil sécurité à jour', tone: 'ok' },
  missing: { label: 'Accueil sécurité non à jour', tone: 'danger' },
  unknown: { label: 'Accueil sécurité : donnée indisponible (Cursus)', tone: 'warn' },
  none: { label: 'Aucun titre « accueil sécurité » désigné', tone: 'neutral' },
};

/** États d'une case qui valent « titre utilisable » (valide, ou à renouveler sous 90 jours). */
const USABLE: readonly SkillState[] = ['v', 's'];

export type WorkerFacts = {
  /** Titres d'accueil sécurité suivis (identifiants). */
  inductionTitleIds: readonly string[];
  /** Titres requis de la personne, avec leur intitulé. */
  required: readonly { titleId: string; label: string }[];
  /** Titres détenus de la personne, par titre (cursus.pub_titres_detenus). */
  held: ReadonlyMap<string, HeldFacts>;
  /** Titres détenus lus (false : Cursus indisponible). */
  heldOk: boolean;
};

export type WorkerCheck = {
  induction: InductionState;
  /** Titres requis non utilisables (intitulés), vide si tous sont à jour ou si la source est indisponible. */
  lapsedTitles: string[];
  /** Titres requis : null si la source est indisponible, sinon tous à jour (ou aucun requis). */
  titlesValid: boolean | null;
};

/** Accueil sécurité et titres requis d'un intervenant, à la date `now`. */
export function workerCheck(f: WorkerFacts, now: string): WorkerCheck {
  if (!f.heldOk) return { induction: f.inductionTitleIds.length ? 'unknown' : 'none', lapsedTitles: [], titlesValid: null };
  const usable = (titleId: string) => USABLE.includes(heldTitleState(true, f.held.get(titleId), now).state);
  const induction: InductionState = !f.inductionTitleIds.length ? 'none' : f.inductionTitleIds.some(usable) ? 'ok' : 'missing';
  const lapsedTitles = f.required.filter((r) => !usable(r.titleId)).map((r) => r.label);
  return { induction, lapsedTitles, titlesValid: lapsedTitles.length === 0 };
}

/**
 * Veto possible (service QHSE) : titres requis non à jour, accueil sécurité manquant, ou donnée de Cursus indisponible
 * (contrôle impossible). Un intervenant dont tout est à jour ne se met pas sous veto.
 */
export function vetoAllowed(c: WorkerCheck): boolean {
  return c.titlesValid !== true || c.induction === 'missing' || c.induction === 'unknown';
}
export const VETO_NOT_ALLOWED = 'Habilitations et accueil sécurité à jour : aucun veto à poser sur cet intervenant.';

/** Avertissement (non bloquant) : intervenants sans accueil sécurité à jour ; message « donnée indisponible » sinon. */
export function inductionWarning(workers: readonly { name: string; check: WorkerCheck }[]): string | null {
  const missing = workers.filter((w) => w.check.induction === 'missing').map((w) => w.name);
  if (missing.length) return `Accueil sécurité non à jour : ${missing.join(', ')}.`;
  if (workers.some((w) => w.check.induction === 'unknown')) return 'Accueil sécurité des intervenants : donnée indisponible (Cursus), à vérifier.';
  return null;
}

/** Refus de la signature du plan ou de la délivrance d'un permis tant qu'un veto est en cours. */
export function vetoBlocker(vetoed: readonly string[], verb: 'signer le plan' | 'délivrer le permis'): string | null {
  if (!vetoed.length) return null;
  return `Veto du service QHSE en cours sur ${vetoed.length > 1 ? 'les intervenants' : "l'intervenant"} ${vetoed.join(', ')} : impossible de ${verb} tant qu'il n'est pas levé.`;
}
