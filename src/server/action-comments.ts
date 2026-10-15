'use server';

// STUB paquet 1 (Foundation) — implémenté par le flux A.
// Signatures finales (plan § 2.13 ; champs postés : § 2.14).

import type { FormState } from '@/lib/forms';

const STUB = 'Fonction en cours de réécriture (paquet 1).';

/** Ajoute un commentaire au fil d'une action, avec ses preuves éventuelles (ACT-24, ACT-25) : responsable ou QHSE. */
export async function addActionComment(_prev: FormState, fd: FormData): Promise<FormState> {
  void _prev;
  void fd;
  return { error: STUB };
}

/** Retire un commentaire (motif obligatoire) : son auteur ou le QHSE ; texte conservé en base, jamais renvoyé (D23). */
export async function withdrawActionComment(_prev: FormState, fd: FormData): Promise<FormState> {
  void _prev;
  void fd;
  return { error: STUB };
}
