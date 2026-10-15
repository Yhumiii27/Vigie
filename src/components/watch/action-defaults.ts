// Valeurs proposées au formulaire d'action par l'écran Veille (docs/specs/actions-qse.md § 12, plan du paquet 1, flux E2) :
// règles pures, sans dépendance serveur, testées dans action-defaults.test.ts. La création reste réservée au service QHSE
// (ACT-22) : l'écran ne propose ces valeurs qu'à lui.
//
// - exigence en écart ou en analyse d'écart : source « Veille réglementaire » imposée, exigence liée (requirement:<id>),
//   domaine proposé d'après le domaine de l'exigence, site choisi par le QHSE (exigence commune à l'entreprise, § 13) ;
// - contrôle périodique (réserves à lever, contrôle dépassé) : source « Contrôle réglementaire » imposée, contrôle lié
//   (control:<id>), site du contrôle.
// Vérification planifiée proposée 30 jours après la date cible (modifiable).

import type { ActionDefaults } from '@/lib/action-view';
import { addDays, fmtDate } from '@/lib/dates';
import { ORIGIN_REF_MAX, REQUIREMENT_EVAL, proposedDomain } from '@/lib/domain';

/** Délai proposé entre la date cible et la vérification d'efficacité planifiée. */
export const VERIFY_AFTER_DAYS = 30;

type RequirementLike = {
  id: number; text: string; domain: string; summary: string; evaluation: string; evaluationNote: string | null; pilotId: string | null; dueOn: string | null;
};

/**
 * Action d'une exigence en écart ou en analyse d'écart : problème = texte, évaluation et précision, puis ce qu'exige le
 * texte ; détail = « verbe d'action + objet » (Analyser l'écart / Traiter l'écart « constat » / Mettre en conformité :
 * texte) ; date cible = date d'application à venir, sinon dans 30 jours.
 */
export function requirementActionDefaults(r: RequirementLike, today: string): ActionDefaults {
  const note = r.evaluationNote ? ` « ${r.evaluationNote} »` : '';
  const verb = r.evaluation === 'analyse' ? "Analyser l'écart" : note ? "Traiter l'écart" : 'Mettre en conformité';
  const evaluation = REQUIREMENT_EVAL[r.evaluation]?.label ?? r.evaluation;
  const dueOn = r.dueOn && r.dueOn > today ? r.dueOn : addDays(today, 30);
  return {
    source: 'veille',
    lockSource: true,
    link: `requirement:${r.id}`,
    linkLabel: `Exigence · ${r.text}`,
    originRef: r.text.slice(0, ORIGIN_REF_MAX),
    domain: proposedDomain({ requirementDomain: r.domain }),
    problem: [`${r.text} — ${evaluation}${r.evaluationNote ? ` : ${r.evaluationNote}` : ''}.`, r.summary.trim()].filter(Boolean).join('\n'),
    detail: `${verb}${note} : ${r.text}`,
    pilotId: r.pilotId ?? undefined,
    dueOn,
    verifyDueOn: addDays(dueOn, VERIFY_AFTER_DAYS),
  };
}

type ControlLike = {
  id: number; equipment: string; controlType: string; periodMonths: number; organization: string; reserves: string | null;
  responsibleId: string | null; nextOn: string; siteId: string | null;
};

const equipShort = (equipment: string) => equipment.split(' — ')[0];
const months = (n: number) => (n === 1 ? 'mois' : `${n} mois`);

function controlBase(c: ControlLike): ActionDefaults {
  return {
    source: 'controle_reglementaire',
    lockSource: true,
    link: `control:${c.id}`,
    linkLabel: `${c.controlType} · ${c.equipment}`,
    originRef: c.equipment.slice(0, ORIGIN_REF_MAX),
    pilotId: c.responsibleId ?? undefined,
    // Site du contrôle (« Tous les sites » : choisi par le QHSE).
    siteId: c.siteId ?? undefined,
  };
}

/** Levée des réserves : « Lever les réserves « … » : équipement », date cible au plus tard dans 30 jours (prochain contrôle s'il précède). */
export function controlReserveDefaults(c: ControlLike, today: string): ActionDefaults {
  const limit = addDays(today, 30);
  const dueOn = c.nextOn > today && c.nextOn < limit ? c.nextOn : limit;
  return {
    ...controlBase(c),
    problem: `Réserves du contrôle « ${c.controlType} » (${c.organization}) : ${c.reserves ?? ''}.`,
    detail: `Lever les réserves « ${c.reserves ?? ''} » : ${equipShort(c.equipment)}`,
    dueOn,
    verifyDueOn: addDays(dueOn, VERIFY_AFTER_DAYS),
  };
}

/** Contrôle dépassé sans action : « Réaliser le contrôle « … » : équipement », sous 15 jours (VEI-02). */
export function controlOverdueDefaults(c: ControlLike, today: string): ActionDefaults {
  const dueOn = addDays(today, 15);
  return {
    ...controlBase(c),
    problem: `Contrôle « ${c.controlType} » dépassé depuis le ${fmtDate(c.nextOn)} (tous les ${months(c.periodMonths)}, ${c.organization}).`,
    detail: `Réaliser le contrôle « ${c.controlType} » : ${equipShort(c.equipment)}`,
    dueOn,
    verifyDueOn: addDays(dueOn, VERIFY_AFTER_DAYS),
  };
}
