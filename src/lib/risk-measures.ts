// Mesures de maîtrise d'un risque du DUERP liées à un élément de Vigie (DUE-19) — règles pures, sans import serveur :
// validité calculée à l'affichage (fiche du risque, échéances), jamais stockée.

import { fmtDate } from './dates';
import { CONTROL_RESULTS, isBlockingControlResult, type ControlResult, type MeasureLinkKind, type Tone } from './domain';

/** Faits nécessaires au calcul, selon l'élément lié. */
export type MeasureFacts =
  | { kind: 'control'; archived: boolean; nextOn: string; lastResult: string | null }
  | { kind: 'document'; inForce: boolean; nextReviewOn: string | null }
  | { kind: 'title'; archived: boolean; required: number; lapsed: number };

/**
 * État d'une mesure liée : `valid` = false la signale (fiche du risque, échéance au responsable QHSE du site) —
 * - contrôle : équipement réformé, contrôle dépassé, ou dernier résultat défavorable / mise à l'arrêt / hors tolérance ;
 * - document : plus aucune version en vigueur (retiré, jamais approuvé) ; une revue périodique dépassée est signalée sans
 *   invalider la mesure (le document reste applicable, son échéance est portée par l'écran Documents) ;
 * - habilitation : titre retiré du suivi, ou titre requis expiré, jamais suivi ou sans prérequis valide chez un salarié du
 *   site de l'unité (aucun salarié ne le détient comme exigence : signalé sans invalider).
 */
export function measureState(f: MeasureFacts, now: string): { valid: boolean; label: string; tone: Tone } {
  if (f.kind === 'control') {
    if (f.archived) return { valid: false, label: 'Équipement réformé', tone: 'danger' };
    if (isBlockingControlResult(f.lastResult)) return { valid: false, label: `Dernier contrôle : ${CONTROL_RESULTS[f.lastResult as ControlResult].label.toLowerCase()}`, tone: 'danger' };
    if (f.nextOn < now) return { valid: false, label: `Contrôle dépassé depuis le ${fmtDate(f.nextOn)}`, tone: 'danger' };
    return { valid: true, label: `À jour · prochain contrôle le ${fmtDate(f.nextOn)}`, tone: 'ok' };
  }
  if (f.kind === 'document') {
    if (!f.inForce) return { valid: false, label: 'Plus aucune version en vigueur', tone: 'danger' };
    if (f.nextReviewOn && f.nextReviewOn < now) return { valid: true, label: `En vigueur · revue périodique dépassée depuis le ${fmtDate(f.nextReviewOn)}`, tone: 'warn' };
    return { valid: true, label: 'Version en vigueur', tone: 'ok' };
  }
  if (f.archived) return { valid: false, label: 'Titre retiré du suivi', tone: 'danger' };
  if (f.lapsed > 0) return { valid: false, label: `${f.lapsed} salarié${f.lapsed > 1 ? 's' : ''} du site sans titre valide`, tone: 'danger' };
  if (!f.required) return { valid: true, label: 'Exigé d’aucun salarié du site', tone: 'warn' };
  return { valid: true, label: `${f.required} salarié${f.required > 1 ? 's' : ''} du site à jour`, tone: 'ok' };
}

/** Liaison en cours d'un risque à un élément (cible selon le type), pour la fiche du risque. */
export type MeasureView = {
  id: number;
  kind: MeasureLinkKind;
  targetId: string;
  label: string;
  /** Lien vers l'élément (null : écran fermé au rôle). */
  href: string | null;
  valid: boolean;
  state: string;
  tone: Tone;
};
