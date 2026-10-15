'use client';

// STUB paquet 1 (Foundation) — implémenté par le flux B.
// Signatures finales (plan § 2.13). Ancienne implémentation : git show 22778e2:src/components/actions/ActionDetail.tsx.

import type { ActionDetailView, ActionFormOptions } from '@/lib/action-view';
import type { ActionRights } from '@/lib/action-rules';

export type ActionDetailProps = {
  detail: ActionDetailView; rights: ActionRights; options: ActionFormOptions; currentUserId: string; today: string; verifyDefault: string;
};

/** Fiche d'une action (problème, action, planification, source, vérification, coûts, fil, preuves, historique). */
export function ActionDetail(props: ActionDetailProps) {
  return <p className="vg-muted">{props.detail.id} · {props.detail.label} — fiche en cours de réécriture (paquet 1).</p>;
}
