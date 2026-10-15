// Valeurs proposées au formulaire d'action par l'écran Documents maîtrisés (docs/specs/actions-qse.md § 12, plan du
// paquet 1, flux E2) : règle pure, testée dans action-defaults.test.ts. La création reste réservée au service QHSE
// (ACT-22) : l'écran ne propose ces valeurs qu'à lui.
//
// Source « Revue documentaire » imposée, domaine Qualité. Élément lié : la révision en cours (docversion:<id>) quand elle
// n'a pas encore d'action — l'action porte aussi son document (actions.document_id, posé à la création seulement, D15) —,
// sinon le document lui-même (document:<id>, ACT-01). Site du document ; document commun à tous les sites : site choisi
// par le QHSE.

import type { ActionDefaults } from '@/lib/action-view';
import { addDays, fmtDate } from '@/lib/dates';
import { ORIGIN_REF_MAX } from '@/lib/domain';

/** Délai proposé entre la date cible et la vérification d'efficacité planifiée. */
export const VERIFY_AFTER_DAYS = 30;

type DocLike = {
  id: string; title: string; ownerId: string; siteId: string | null; actionTitle: string; dueSoon: boolean; overdue: boolean; nextReviewOn: string | null;
  pending: { id: number; version: string; action: unknown } | null;
};

/**
 * Action d'un document : `review` = revue périodique (détail « Revue périodique de … », date cible = prochaine revue si
 * elle approche, problème = revue dépassée ou proche) ; sinon action libre sur le document (détail à saisir).
 */
export function documentActionDefaults(doc: DocLike, opts: { review: boolean; suggestedDueOn: string }): ActionDefaults {
  const onVersion = doc.pending && !doc.pending.action ? doc.pending : null;
  const dueOn = opts.review && doc.dueSoon && doc.nextReviewOn ? doc.nextReviewOn : opts.suggestedDueOn;
  const problem = opts.review && doc.nextReviewOn && (doc.overdue || doc.dueSoon)
    ? `Revue périodique de ${doc.id} « ${doc.title} » ${doc.overdue ? 'dépassée' : 'à réaliser'} (prévue le ${fmtDate(doc.nextReviewOn)}).`
    : `${doc.id} « ${doc.title} »`;
  return {
    source: 'revue_documentaire',
    lockSource: true,
    link: onVersion ? `docversion:${onVersion.id}` : `document:${doc.id}`,
    linkLabel: onVersion ? `${doc.id} · version ${onVersion.version}` : `Document · ${doc.id}`,
    originRef: doc.id.slice(0, ORIGIN_REF_MAX),
    domain: 'qualite',
    problem,
    detail: opts.review ? doc.actionTitle : undefined,
    pilotId: doc.ownerId,
    dueOn,
    verifyDueOn: addDays(dueOn, VERIFY_AFTER_DAYS),
    siteId: doc.siteId ?? undefined,
  };
}
