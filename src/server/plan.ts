'use server';

// STUB paquet 1 (Foundation) — implémenté par le flux A.
// Signatures finales (plan § 2.13 ; champs postés : § 2.14). Ancienne implémentation : git show 22778e2:src/server/plan.ts.

import type { FormState } from '@/lib/forms';

const STUB = 'Fonction en cours de réécriture (paquet 1).';

/** Crée (QHSE seulement, ACT-22) ou modifie une action du plan d'actions QSE (ACT-20). */
export async function saveAction(_prev: FormState, fd: FormData): Promise<FormState> {
  void _prev;
  void fd;
  return { error: STUB };
}

/** Joint des preuves à une action (ACT-25) : responsable ou QHSE, jamais sur une action abandonnée. */
export async function addActionFiles(fd: FormData): Promise<{ error?: string; count?: number }> {
  void fd;
  return { error: STUB };
}

/** Retire une preuve ajoutée par erreur (seule suppression physique admise, spec § 10). */
export async function removeActionFile(attachmentId: string): Promise<{ error?: string }> {
  void attachmentId;
  return { error: STUB };
}
