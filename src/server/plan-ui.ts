'use server';

// STUB paquet 1 (Foundation) — implémenté par le flux A.
// Signatures finales (plan § 2.13 ; champs postés : § 2.14). Ancienne implémentation : git show 22778e2:src/server/plan-ui.ts
// (cancelAction y est remplacée par abandonAction).

import type { FormState } from '@/lib/forms';

const STUB = 'Fonction en cours de réécriture (paquet 1).';

/** Change l'avancement (transitions de MOVE_KINDS : step, report, resume, finish, unfinish), QHSE seulement (ACT-21). */
export async function moveAction(_prev: FormState, fd: FormData): Promise<FormState> {
  void _prev;
  void fd;
  return { error: STUB };
}

/** Vérification d'efficacité d'une action Terminée, actions de suite comprises (ACT-23). */
export async function verifyAction(_prev: FormState, fd: FormData): Promise<FormState> {
  void _prev;
  void fd;
  return { error: STUB };
}

/** Rouvre une action Vérifiée (retour à Terminée — à vérifier, motif obligatoire). */
export async function reopenAction(_prev: FormState, fd: FormData): Promise<FormState> {
  void _prev;
  void fd;
  return { error: STUB };
}

/** Abandonne une action ouverte, Reportée ou Terminée (motif obligatoire, liens détachés). */
export async function abandonAction(_prev: FormState, fd: FormData): Promise<FormState> {
  void _prev;
  void fd;
  return { error: STUB };
}
